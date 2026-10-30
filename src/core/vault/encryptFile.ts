import {
  APP_VERSION,
  DEFAULT_CHUNK_SIZE,
  GCM_IV_LENGTH_BYTES,
  SALT_BYTES,
  SIGNATURE_ALGORITHM,
  CIPHER_KEY_BITS,
  type CipherAlgorithm,
} from '../types/crypto';
import type { Manifest, ManifestSigner } from '../types/manifest';
import type { EncryptFileResult, EncryptOptions, EncryptTimings, FileInput } from '../types/file';
import { AppError } from '../errors/AppError';
import { ErrorCodes } from '../errors/codes';
import {
  concatBytes,
  normalizePassword,
  secureZero,
  toArrayBuffer,
  toBase64,
  uint32BE,
} from '../crypto/encoding';
import { randomBytes } from '../crypto/random';
import { createStreamingHasher } from '../crypto/hash';
import { deriveFileKek } from '../crypto/kdf';
import { encryptAesGcm } from '../crypto/aesGcm';
import { chunkAad } from '../crypto/aad';
import { createAndWrapDek } from '../envelope/wrapDek';
import { signManifest } from '../manifest/signManifest';
import {
  assertChunkCount,
  assertFileSize,
  assertKdfParams,
  sanitizeFilename,
  sanitizeMime,
} from '../validation/limits';
import { nowMs } from './report';

export interface EncryptFileInput {
  file: FileInput;
  fileId: string;
  options: EncryptOptions;
  vmk: CryptoKey;
  signingPrivateKey: CryptoKey;
  signer: ManifestSigner;
  onChunk(index: number, ciphertext: Uint8Array): Promise<void> | void;
  onProgress?: (progress: { stage: 'hash' | 'encrypt'; done: number; total: number }) => void;
  isCancelled?: () => boolean;
}

export async function encryptFile(input: EncryptFileInput): Promise<EncryptFileResult> {
  const startedAt = nowMs();
  const { file, options } = input;
  const size = file.blob.size;
  assertFileSize(size);
  assertKdfParams(options.kdfParams);
  if (!Number.isInteger(CIPHER_KEY_BITS[options.cipher])) {
    throw new AppError(ErrorCodes.VALIDATION, '不支持的加密算法', { stage: 'validation' });
  }

  const chunkCount = size === 0 ? 0 : Math.ceil(size / DEFAULT_CHUNK_SIZE);
  assertChunkCount(chunkCount, size, DEFAULT_CHUNK_SIZE);

  const fileSalt = randomBytes(SALT_BYTES);
  const fileNonce = randomBytes(8);
  const keyBits = CIPHER_KEY_BITS[options.cipher as CipherAlgorithm];
  const fileKek = await deriveFileKek(input.vmk, fileSalt);

  const wrapStart = nowMs();
  const wrapped = await createAndWrapDek(fileKek, input.fileId, keyBits);
  const wrapMs = nowMs() - wrapStart;

  const hasher = await createStreamingHasher(options.hashAlg);
  const chunkCiphertexts: Uint8Array[] = [];
  let hashMs = 0;
  let encryptMs = 0;
  let processed = 0;

  for (let index = 0; index < chunkCount; index += 1) {
    if (input.isCancelled?.()) {
      throw new AppError(ErrorCodes.CANCELLED, '加密已取消', { stage: 'decrypt' });
    }
    const start = index * DEFAULT_CHUNK_SIZE;
    const end = Math.min(size, start + DEFAULT_CHUNK_SIZE);
    const plaintext = new Uint8Array(await file.blob.slice(start, end).arrayBuffer());
    const plaintextLength = plaintext.length;

    const hashStart = nowMs();
    hasher.update(plaintext);
    hashMs += nowMs() - hashStart;

    const iv = concatBytes(fileNonce, uint32BE(index));
    const aad = chunkAad({
      fileId: input.fileId,
      index,
      chunkCount,
      plaintextLength,
      fileNonce,
    });

    try {
      const encryptStart = nowMs();
      const ciphertext = await encryptAesGcm(wrapped.dekKey, iv, plaintext, aad);
      encryptMs += nowMs() - encryptStart;
      if (ciphertext.length !== plaintextLength + 16) {
        throw new AppError(ErrorCodes.CHUNK_ORDER, 'AES-GCM 输出长度异常', {
          stage: 'encrypt',
        });
      }
      chunkCiphertexts.push(ciphertext);
      await input.onChunk(index, ciphertext);
    } finally {
      secureZero(plaintext);
    }

    processed += plaintextLength;
    input.onProgress?.({ stage: 'encrypt', done: processed, total: size });
  }

  if (input.isCancelled?.()) {
    chunkCiphertexts.forEach(secureZero);
    throw new AppError(ErrorCodes.CANCELLED, '加密已取消', { stage: 'encrypt' });
  }

  const contentHash = toBase64(hasher.digest());
  const createdAt = Date.now();
  const manifest: Manifest = {
    formatVersion: 1,
    fileId: input.fileId,
    filename: sanitizeFilename(file.name),
    mime: sanitizeMime(file.mime),
    size,
    createdAt,
    signedAt: Date.now(),
    cipher: {
      alg: options.cipher,
      keyBits,
      chunkSize: DEFAULT_CHUNK_SIZE,
      chunkCount,
      fileNonce: toBase64(fileNonce),
    },
    hash: {
      alg: options.hashAlg,
      contentHash,
    },
    kdf: options.kdfParams,
    fileSalt: toBase64(fileSalt),
    kcv: options.kcv,
    wrappedDek: wrapped.wrappedDek,
    wrapIv: wrapped.wrapIv,
    signer: input.signer,
    signatureAlg: SIGNATURE_ALGORITHM,
    appVersion: APP_VERSION,
  };

  const signStart = nowMs();
  const signed = await signManifest(manifest, input.signingPrivateKey);
  const signMs = nowMs() - signStart;

  const timings: EncryptTimings = {
    totalMs: nowMs() - startedAt,
    hashMs,
    encryptMs,
    wrapMs,
    signMs,
  };

  return {
    manifest,
    headerBytes: toArrayBuffer(signed.headerBytes),
    signature: toArrayBuffer(signed.signature),
    timings,
  };
}

/**
 * 规范化文件名/口令共用 NFC；这里导出给调用方做显示层预处理。
 */
export function normalizeForDisplay(value: string): string {
  return normalizePassword(value);
}
