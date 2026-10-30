import { AppError } from '../errors/AppError';
import { ErrorCodes } from '../errors/codes';
import { toBase64, toHex } from './encoding';

function getCrypto(): Crypto {
  if (!globalThis.crypto?.getRandomValues) {
    throw new AppError(ErrorCodes.UNSUPPORTED, '当前环境缺少安全随机数生成器', {
      stage: 'validation',
    });
  }
  return globalThis.crypto;
}

/** getRandomValues 单次最多 65,536 字节；大缓冲区必须分段填充。 */
const GET_RANDOM_VALUES_MAX = 65_536;

export function randomBytes(length: number): Uint8Array {
  if (!Number.isInteger(length) || length <= 0) {
    throw new AppError(ErrorCodes.VALIDATION, '随机字节长度不合法', { stage: 'validation' });
  }
  const out = new Uint8Array(length);
  const cryptoObj = getCrypto();
  for (let offset = 0; offset < length; offset += GET_RANDOM_VALUES_MAX) {
    cryptoObj.getRandomValues(
      out.subarray(offset, Math.min(length, offset + GET_RANDOM_VALUES_MAX)),
    );
  }
  return out;
}

export function randomBase64(length: number): string {
  return toBase64(randomBytes(length));
}

export function randomHex(length: number): string {
  return toHex(randomBytes(length));
}

export function randomUuid(): string {
  const cryptoObj = getCrypto();
  if (typeof cryptoObj.randomUUID === 'function') {
    return cryptoObj.randomUUID();
  }
  const bytes = randomBytes(16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = toHex(bytes);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function randomIndex(maxExclusive: number): number {
  if (!Number.isInteger(maxExclusive) || maxExclusive <= 0) return 0;
  const view = new DataView(randomBytes(4).buffer);
  return view.getUint32(0, false) % maxExclusive;
}
