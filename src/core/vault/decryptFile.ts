import { AppError } from '../errors/AppError';
import { ErrorCodes } from '../errors/codes';
import { GCM_TAG_LENGTH_BYTES } from '../types/crypto';
import type { DecryptFileResult, FileSource } from '../types/file';
import type { VerificationReport } from '../types/verification';
import {
  concatBytes,
  constantTimeEqual,
  fromBase64,
  secureZero,
  toBase64,
  uint32BE,
} from '../crypto/encoding';
import { createStreamingHasher } from '../crypto/hash';
import { deriveFileKek, verifyPasswordAndUnlock } from '../crypto/kdf';
import { decryptAesGcm } from '../crypto/aesGcm';
import { chunkAad } from '../crypto/aad';
import { unwrapDek } from '../envelope/wrapDek';
import { chunkPlaintextLength } from './container';
import { ReportBuilder } from './report';

export interface DecryptOptions {
  password?: string;
  /** 已解锁会话的 VMK；与 password 二选一。 */
  vmk?: CryptoKey;
  /** 已经通过的 S0–S2 报告，用于串联完整验证链。 */
  report?: VerificationReport;
  onProgress?: (progress: { done: number; total: number }) => void;
  isCancelled?: () => boolean;
}

export async function decryptFile(
  source: FileSource,
  options: DecryptOptions,
): Promise<DecryptFileResult> {
  const manifest = source.manifest;
  const report = new ReportBuilder(options.report?.stages ?? []);

  if (options.isCancelled?.()) {
    throw new AppError(ErrorCodes.CANCELLED, '解密已取消', { stage: 'decrypt' });
  }

  let vmk: CryptoKey;
  if (options.password) {
    const material = await report.run('password', () =>
      verifyPasswordAndUnlock(options.password!, manifest.kdf, manifest.kcv),
    );
    vmk = material.vmk;
  } else if (options.vmk) {
    vmk = options.vmk;
    const alreadyVerified = options.report?.stages.some(
      (stage) => stage.stage === 'password' && stage.status === 'ok',
    );
    if (!alreadyVerified) {
      report.addSkipped('password', '使用当前已解锁会话密钥');
    }
  } else {
    throw new AppError(ErrorCodes.WRONG_PASSWORD, '需要输入保管库口令', {
      stage: 'password',
      report: report.snapshot(false, '缺少口令'),
    });
  }

  const fileKek = await deriveFileKek(vmk, fromBase64(manifest.fileSalt));
  const dekKey = await report.run('unwrap', () =>
    unwrapDek(
      fileKek,
      manifest.wrappedDek,
      manifest.wrapIv,
      manifest.fileId,
      manifest.cipher.keyBits,
    ),
  );

  const hasher = await createStreamingHasher(manifest.hash.alg);
  const plaintextParts: Uint8Array[] = [];
  const fileNonce = fromBase64(manifest.cipher.fileNonce);
  const chunkCount = manifest.cipher.chunkCount;
  const chunkSize = manifest.cipher.chunkSize;
  let processed = 0;

  try {
    await report.run('decrypt', async () => {
      try {
        for (let index = 0; index < chunkCount; index += 1) {
          if (options.isCancelled?.()) {
            throw new AppError(ErrorCodes.CANCELLED, '解密已取消', { stage: 'decrypt' });
          }
          const plaintextLength = chunkPlaintextLength(
            manifest.size,
            chunkCount,
            chunkSize,
            index,
          );
          const ciphertext = await source.getChunk(index);
          if (ciphertext.length !== plaintextLength + GCM_TAG_LENGTH_BYTES) {
            throw new AppError(ErrorCodes.CHUNK_ORDER, `第 ${index} 块密文长度异常`, {
              stage: 'decrypt',
              details: { index, actual: ciphertext.length, expected: plaintextLength + 16 },
            });
          }
          const iv = concatBytes(fileNonce, uint32BE(index));
          const aad = chunkAad({
            fileId: manifest.fileId,
            index,
            chunkCount,
            plaintextLength,
            fileNonce,
          });
          let plaintext: Uint8Array;
          try {
            plaintext = await decryptAesGcm(dekKey, iv, ciphertext, aad);
          } catch (error) {
            if (error instanceof AppError && error.code === ErrorCodes.AUTH_TAG) {
              throw new AppError(error.code, error.message, {
                stage: error.stage,
                details: { ...error.details, chunkIndex: index },
                report: error.report,
                cause: error,
              });
            }
            throw error;
          }
          if (plaintext.length !== plaintextLength) {
            throw new AppError(ErrorCodes.CHUNK_ORDER, `第 ${index} 块明文长度异常`, {
              stage: 'decrypt',
            });
          }
          hasher.update(plaintext);
          plaintextParts.push(plaintext);
          processed += plaintext.length;
          options.onProgress?.({ done: processed, total: manifest.size });
        }
      } catch (error) {
        plaintextParts.forEach(secureZero);
        throw error;
      }
    });

    await report.run('integrity', () => {
      const digest = hasher.digest();
      let expected: Uint8Array;
      try {
        expected = fromBase64(manifest.hash.contentHash);
      } catch (error) {
        throw new AppError(ErrorCodes.HASH_MISMATCH, '签名清单中的内容哈希不合法', {
          stage: 'integrity',
          cause: error,
        });
      }
      if (!constantTimeEqual(digest, expected)) {
        throw new AppError(ErrorCodes.HASH_MISMATCH, '文件内容哈希与签名清单不一致', {
          stage: 'integrity',
        });
      }
    });
  } catch (error) {
    plaintextParts.forEach(secureZero);
    throw error;
  }

  const blob = await report.run(
    'output',
    () =>
      new Blob(plaintextParts as unknown as BlobPart[], {
        type: manifest.mime || 'application/octet-stream',
      }),
  );
  plaintextParts.forEach(secureZero);

  return {
    blob,
    filename: manifest.filename,
    mime: manifest.mime,
    digestBase64: manifest.hash.contentHash,
    report: report.finish('解密、AES-GCM 认证与内容完整性校验通过'),
  };
}
