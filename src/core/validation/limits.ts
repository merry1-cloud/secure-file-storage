import {
  DEFAULT_CHUNK_SIZE,
  MAX_CHUNK_COUNT,
  MAX_FILE_BYTES,
  MAX_HEADER_BYTES,
  MAX_PBKDF2_ITERATIONS,
  MAX_SCRYPT_N,
  MAX_SCRYPT_P,
  MAX_SCRYPT_R,
  MAX_SIGNATURE_BYTES,
  MIN_PBKDF2_ITERATIONS,
  MIN_SCRYPT_N,
  MIN_SIGNATURE_BYTES,
  SALT_BYTES,
  type KdfParams,
} from '../types/crypto';
import { AppError } from '../errors/AppError';
import { ErrorCodes } from '../errors/codes';
import { base64ByteLength, isBase64String, normalizePassword } from '../crypto/encoding';

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_RECOMMENDED_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 1024;
export const FILENAME_MAX_LENGTH = 200;

export function isPowerOfTwo(value: number): boolean {
  return Number.isInteger(value) && value > 0 && (value & (value - 1)) === 0;
}

export function assertKdfParams(params: KdfParams): void {
  if (!params || (params.algorithm !== 'PBKDF2-HMAC-SHA256' && params.algorithm !== 'scrypt')) {
    throw new AppError(ErrorCodes.KDF_LIMIT, '不支持的 KDF 算法', { stage: 'validation' });
  }
  if (!isBase64String(params.salt) || base64ByteLength(params.salt) !== SALT_BYTES) {
    throw new AppError(ErrorCodes.KDF_LIMIT, 'KDF salt 必须为 16 字节 Base64', {
      stage: 'validation',
    });
  }
  if (params.dkLen !== 32) {
    throw new AppError(ErrorCodes.KDF_LIMIT, 'KDF 输出长度必须为 32 字节', {
      stage: 'validation',
    });
  }
  if (params.algorithm === 'PBKDF2-HMAC-SHA256') {
    if (
      !Number.isInteger(params.iterations) ||
      params.iterations < MIN_PBKDF2_ITERATIONS ||
      params.iterations > MAX_PBKDF2_ITERATIONS
    ) {
      throw new AppError(
        ErrorCodes.KDF_LIMIT,
        `PBKDF2 迭代次数必须在 ${MIN_PBKDF2_ITERATIONS.toLocaleString()}–${MAX_PBKDF2_ITERATIONS.toLocaleString()} 之间`,
        { stage: 'validation' },
      );
    }
    return;
  }
  if (!isPowerOfTwo(params.N) || params.N < MIN_SCRYPT_N || params.N > MAX_SCRYPT_N) {
    throw new AppError(ErrorCodes.KDF_LIMIT, 'scrypt N 必须是允许范围内的 2 的幂', {
      stage: 'validation',
    });
  }
  if (!Number.isInteger(params.r) || params.r < 1 || params.r > MAX_SCRYPT_R) {
    throw new AppError(ErrorCodes.KDF_LIMIT, 'scrypt r 参数超出范围', { stage: 'validation' });
  }
  if (!Number.isInteger(params.p) || params.p < 1 || params.p > MAX_SCRYPT_P) {
    throw new AppError(ErrorCodes.KDF_LIMIT, 'scrypt p 参数超出范围', { stage: 'validation' });
  }
}

export function assertFileSize(size: number): void {
  if (!Number.isSafeInteger(size) || size < 0) {
    throw new AppError(ErrorCodes.VALIDATION, '文件大小不合法', { stage: 'validation' });
  }
  if (size > MAX_FILE_BYTES) {
    throw new AppError(
      ErrorCodes.FILE_TOO_LARGE,
      `文件超过上限 ${(MAX_FILE_BYTES / 1024 / 1024 / 1024).toFixed(0)} GiB`,
      { stage: 'validation' },
    );
  }
}

export function expectedChunkCount(size: number, chunkSize = DEFAULT_CHUNK_SIZE): number {
  if (size === 0) return 0;
  return Math.ceil(size / chunkSize);
}

export function assertChunkCount(chunkCount: number, size: number, chunkSize = DEFAULT_CHUNK_SIZE): void {
  if (!Number.isInteger(chunkCount) || chunkCount < 0) {
    throw new AppError(ErrorCodes.CHUNK_ORDER, '分块数量不合法', { stage: 'validation' });
  }
  const expected = expectedChunkCount(size, chunkSize);
  if (chunkCount !== expected) {
    throw new AppError(ErrorCodes.CHUNK_ORDER, '分块数量与文件大小不一致', {
      stage: 'validation',
      details: { chunkCount, expected },
    });
  }
  if (chunkCount > MAX_CHUNK_COUNT) {
    throw new AppError(ErrorCodes.CHUNK_ORDER, '分块数量超过上限', { stage: 'validation' });
  }
}

export function assertChunkSize(chunkSize: number): void {
  if (chunkSize !== DEFAULT_CHUNK_SIZE) {
    throw new AppError(ErrorCodes.VALIDATION, '不支持的分块大小', {
      stage: 'validation',
      details: { chunkSize },
    });
  }
}

export function assertHeaderLength(headerLength: number): void {
  if (!Number.isInteger(headerLength) || headerLength <= 0 || headerLength > MAX_HEADER_BYTES) {
    throw new AppError(ErrorCodes.CONTAINER_PARSE, '容器头长度非法', { stage: 'parse' });
  }
}

export function assertSignatureLength(signatureLength: number): void {
  if (
    !Number.isInteger(signatureLength) ||
    signatureLength < MIN_SIGNATURE_BYTES ||
    signatureLength > MAX_SIGNATURE_BYTES
  ) {
    throw new AppError(ErrorCodes.CONTAINER_PARSE, '签名长度非法', { stage: 'parse' });
  }
}

export function sanitizeFilename(name: string): string {
  const cleaned = normalizePassword(name)
    .replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, '_')
    .replace(/^[.\s]+|[.\s]+$/g, '')
    .slice(0, FILENAME_MAX_LENGTH)
    .trim();
  return cleaned || 'unnamed';
}

export function sanitizeMime(mime: string): string {
  const cleaned = String(mime || '')
    .replace(/[\r\n\u0000-\u001f\u007f]/g, '')
    .slice(0, 255)
    .trim();
  return cleaned || 'application/octet-stream';
}

export function assertPassword(password: string): string {
  const normalized = normalizePassword(password);
  if (normalized.length < PASSWORD_MIN_LENGTH) {
    throw new AppError(ErrorCodes.PASSWORD_POLICY, `口令至少需要 ${PASSWORD_MIN_LENGTH} 个字符`, {
      stage: 'validation',
    });
  }
  if (normalized.length > PASSWORD_MAX_LENGTH) {
    throw new AppError(ErrorCodes.PASSWORD_POLICY, `口令不能超过 ${PASSWORD_MAX_LENGTH} 个字符`, {
      stage: 'validation',
    });
  }
  return normalized;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KiB', 'MiB', 'GiB', 'TiB'];
  let value = bytes;
  let unit = -1;
  do {
    value /= 1024;
    unit += 1;
  } while (value >= 1024 && unit < units.length - 1);
  return `${value.toFixed(value >= 100 ? 0 : value >= 10 ? 1 : 2)} ${units[unit]}`;
}
