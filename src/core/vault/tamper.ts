import type { ErrorCode } from '../errors/codes';
import type { VerifyStage } from '../types/verification';
import type { Manifest } from '../types/manifest';
import { AppError } from '../errors/AppError';
import { ErrorCodes } from '../errors/codes';
import { base64ByteLength, fromBase64, toBase64 } from '../crypto/encoding';
import { randomBytes } from '../crypto/random';
import {
  exportPrivateKeyPkcs8,
  generateRsaKeyPair,
  importPrivateKeyPkcs8,
} from '../crypto/rsa';
import { createSelfSignedCertificate } from '../keys/certificate';
import { encodeManifest } from '../manifest/canonicalize';
import { signManifest } from '../manifest/signManifest';
import { buildContainerBlob, parseContainer, type ParsedContainer } from './container';

export type TamperKind =
  | 'ciphertext-bit-flip'
  | 'replace-signature'
  | 'modify-filename'
  | 'downgrade-hash'
  | 'truncate'
  | 'swap-chunks'
  | 'replace-chunk-cross-file'
  | 'replace-certificate'
  | 'wrong-password';

export interface TamperOutcome {
  kind: TamperKind;
  label: string;
  description: string;
  expectedStage: VerifyStage;
  expectedCode: ErrorCode;
  blob?: Blob;
}

export interface TamperOptions {
  otherContainer?: Blob;
  signature?: Uint8Array;
}

export const TAMPER_LABELS: Record<TamperKind, string> = {
  'ciphertext-bit-flip': '篡改密文 1 字节',
  'replace-signature': '替换签名',
  'modify-filename': '修改头部文件名',
  'downgrade-hash': '降级哈希算法 SHA-256 → SHA-1',
  truncate: '截断容器',
  'swap-chunks': '交换两个分块',
  'replace-chunk-cross-file': '跨文件替换分块',
  'replace-certificate': '替换签名者证书',
  'wrong-password': '使用错误口令解密',
};

function adjustLength(input: Uint8Array, length: number): Uint8Array {
  if (input.length === length) return input;
  const out = new Uint8Array(length);
  if (input.length === 0) return out;
  for (let index = 0; index < length; index += 1) {
    out[index] = input[index % input.length];
  }
  return out;
}

async function allChunks(parsed: ParsedContainer): Promise<Uint8Array[]> {
  const chunks: Uint8Array[] = [];
  for (let index = 0; index < parsed.chunkCount; index += 1) {
    chunks.push(new Uint8Array(await parsed.getChunkBlob(index).arrayBuffer()));
  }
  return chunks;
}

function rebuild(
  parsed: ParsedContainer,
  headerBytes: Uint8Array,
  signature: Uint8Array,
  chunks: Uint8Array[],
): Blob {
  return buildContainerBlob(headerBytes, signature, chunks);
}

async function replaceCertificate(
  parsed: ParsedContainer,
  chunks: Uint8Array[],
): Promise<{ headerBytes: Uint8Array; signature: Uint8Array; manifest: Manifest }> {
  const attackerPair = await generateRsaKeyPair(2048);
  const attackerCert = await createSelfSignedCertificate(attackerPair, 'Attacker');
  const attackerPkcs8 = await exportPrivateKeyPkcs8(attackerPair.privateKey);
  const attackerSigningKey = await importPrivateKeyPkcs8(attackerPkcs8, false);
  const modifiedManifest: Manifest = {
    ...parsed.manifest,
    signer: {
      subject: attackerCert.info.subject,
      serialNumber: attackerCert.info.serialNumber,
      certPem: attackerCert.info.pem,
      certSha256: attackerCert.info.fingerprint,
    },
    signedAt: Date.now(),
  };
  const signed = await signManifest(modifiedManifest, attackerSigningKey);
  return {
    headerBytes: signed.headerBytes,
    signature: signed.signature,
    manifest: modifiedManifest,
  };
}

export async function tamperContainer(
  blob: Blob,
  kind: TamperKind,
  options: TamperOptions = {},
): Promise<TamperOutcome> {
  const label = TAMPER_LABELS[kind];
  if (kind === 'wrong-password') {
    return {
      kind,
      label,
      description: '不修改容器，使用错误口令走解密流程；KCV 校验应失败且不产生明文。',
      expectedStage: 'password',
      expectedCode: ErrorCodes.WRONG_PASSWORD,
    };
  }

  const parsed = await parseContainer(blob);
  const chunks = await allChunks(parsed);

  if (kind === 'truncate') {
    return {
      kind,
      label,
      description: '删除容器尾部 1 字节，破坏长度字段与分块结构。',
      expectedStage: 'parse',
      expectedCode: ErrorCodes.CONTAINER_PARSE,
      blob: blob.slice(0, Math.max(0, blob.size - 1)),
    };
  }

  if (kind === 'ciphertext-bit-flip') {
    if (chunks.length === 0) {
      throw new AppError(ErrorCodes.VALIDATION, '空文件没有密文分块可篡改', {
        stage: 'validation',
      });
    }
    chunks[0][0] ^= 0x01;
    return {
      kind,
      label,
      description: '翻转第 0 个密文分块的首字节；签名仍有效，但 AES-GCM tag 应失败。',
      expectedStage: 'decrypt',
      expectedCode: ErrorCodes.AUTH_TAG,
      blob: rebuild(parsed, parsed.headerBytes, parsed.signature, chunks),
    };
  }

  if (kind === 'replace-signature') {
    const signature = options.signature
      ? adjustLength(options.signature, parsed.signature.length)
      : randomBytes(parsed.signature.length);
    return {
      kind,
      label,
      description: '用随机/其他文件的签名替换原签名；RSA 验签应失败。',
      expectedStage: 'signature',
      expectedCode: ErrorCodes.SIGNATURE,
      blob: rebuild(parsed, parsed.headerBytes, signature, chunks),
    };
  }

  if (kind === 'modify-filename') {
    const modified = {
      ...parsed.manifest,
      filename: `${parsed.manifest.filename}.evil`,
    };
    const headerBytes = encodeManifest(modified);
    return {
      kind,
      label,
      description: '修改头部文件名但保留旧签名；规范化清单被签名字段覆盖，验签应失败。',
      expectedStage: 'signature',
      expectedCode: ErrorCodes.SIGNATURE,
      blob: rebuild(parsed, headerBytes, parsed.signature, chunks),
    };
  }

  if (kind === 'downgrade-hash') {
    const modified: Manifest = {
      ...parsed.manifest,
      hash: {
        alg: 'SHA-1',
        contentHash: toBase64(new Uint8Array(20)),
      },
    };
    const headerBytes = encodeManifest(modified);
    return {
      kind,
      label,
      description: '把内容哈希算法降级为 SHA-1 并替换哈希值；旧签名不覆盖新字段，验签应失败。',
      expectedStage: 'signature',
      expectedCode: ErrorCodes.SIGNATURE,
      blob: rebuild(parsed, headerBytes, parsed.signature, chunks),
    };
  }

  if (kind === 'swap-chunks') {
    if (chunks.length < 2) {
      throw new AppError(ErrorCodes.VALIDATION, '文件只有一个分块，无法交换', {
        stage: 'validation',
      });
    }
    const swapped = [...chunks];
    [swapped[0], swapped[1]] = [swapped[1], swapped[0]];
    return {
      kind,
      label,
      description: '交换第 0/1 个密文分块；AAD 绑定块索引，GCM 应失败。',
      expectedStage: 'decrypt',
      expectedCode: ErrorCodes.AUTH_TAG,
      blob: rebuild(parsed, parsed.headerBytes, parsed.signature, swapped),
    };
  }

  if (kind === 'replace-chunk-cross-file') {
    if (!options.otherContainer) {
      throw new AppError(ErrorCodes.VALIDATION, '需要另一个容器才能做跨文件分块替换', {
        stage: 'validation',
      });
    }
    if (chunks.length === 0) {
      throw new AppError(ErrorCodes.VALIDATION, '空文件没有分块可替换', { stage: 'validation' });
    }
    const other = await parseContainer(options.otherContainer);
    if (other.chunkCount === 0) {
      throw new AppError(ErrorCodes.VALIDATION, '另一个容器没有分块', { stage: 'validation' });
    }
    const otherChunk = new Uint8Array(await other.getChunkBlob(0).arrayBuffer());
    chunks[0] = adjustLength(otherChunk, chunks[0].length);
    return {
      kind,
      label,
      description: '用另一个文件的第 0 块替换本文件第 0 块；AAD 绑定 fileId，GCM 应失败。',
      expectedStage: 'decrypt',
      expectedCode: ErrorCodes.AUTH_TAG,
      blob: rebuild(parsed, parsed.headerBytes, parsed.signature, chunks),
    };
  }

  if (kind === 'replace-certificate') {
    const replaced = await replaceCertificate(parsed, chunks);
    return {
      kind,
      label,
      description: '攻击者用自己的 RSA 密钥和自签名证书重签头部；内容签名可验证，但证书指纹未信任。',
      expectedStage: 'certificate',
      expectedCode: ErrorCodes.CERT_UNTRUSTED,
      blob: rebuild(parsed, replaced.headerBytes, replaced.signature, chunks),
    };
  }

  throw new AppError(ErrorCodes.VALIDATION, '未知的篡改类型', { stage: 'validation' });
}

/** 给界面显示用：判断签名长度是否是合法 Base64 的辅助。 */
export function signatureBase64Length(signature: string): number | null {
  return base64ByteLength(signature);
}

export function decodeSignatureBase64(signature: string): Uint8Array {
  return fromBase64(signature);
}
