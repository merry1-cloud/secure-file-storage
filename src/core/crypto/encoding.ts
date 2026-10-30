import { AppError } from '../errors/AppError';
import { ErrorCodes } from '../errors/codes';

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

export function utf8(value: string): Uint8Array {
  return encoder.encode(value);
}

export function fromUtf8(bytes: Uint8Array): string {
  try {
    return decoder.decode(bytes);
  } catch (error) {
    throw new AppError(ErrorCodes.VALIDATION, '字节序列不是合法的 UTF-8', {
      stage: 'validation',
      cause: error,
    });
  }
}

/**
 * TypeScript 5.9 的 DOM 类型把 BufferSource 收窄为 ArrayBuffer 视图；
 * 本项目的字节数组都由普通 ArrayBuffer 支撑，这里做一次安全收窄。
 */
export function asBufferSource(bytes: Uint8Array): BufferSource {
  return bytes as unknown as BufferSource;
}

export function asArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer as ArrayBuffer;
}

export function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

export function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const end = Math.min(bytes.length, i + chunkSize);
    for (let j = i; j < end; j += 1) {
      binary += String.fromCharCode(bytes[j]);
    }
  }
  return btoa(binary);
}

export function fromBase64(value: string): Uint8Array {
  if (!isBase64String(value)) {
    throw new AppError(ErrorCodes.VALIDATION, 'Base64 编码不合法', { stage: 'validation' });
  }
  let binary: string;
  try {
    binary = atob(value);
  } catch (error) {
    throw new AppError(ErrorCodes.VALIDATION, 'Base64 解码失败', {
      stage: 'validation',
      cause: error,
    });
  }
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

export function isBase64String(value: string): boolean {
  if (typeof value !== 'string' || value.length % 4 !== 0) return false;
  return /^[A-Za-z0-9+/]*={0,2}$/.test(value);
}

export function base64ByteLength(value: string): number | null {
  if (!isBase64String(value)) return null;
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  return (value.length / 4) * 3 - padding;
}

export function toHex(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) {
    out += byte.toString(16).padStart(2, '0');
  }
  return out;
}

export function fromHex(value: string): Uint8Array {
  if (!isHex(value) || value.length % 2 !== 0) {
    throw new AppError(ErrorCodes.VALIDATION, '十六进制编码不合法', { stage: 'validation' });
  }
  const out = new Uint8Array(value.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = Number.parseInt(value.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export function isHex(value: string): boolean {
  return typeof value === 'string' && /^[0-9a-fA-F]*$/.test(value);
}

export function uint32BE(value: number): Uint8Array {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, value, false);
  return out;
}

export function readUint32BE(bytes: Uint8Array, offset = 0): number {
  if (offset + 4 > bytes.length) {
    throw new AppError(ErrorCodes.CONTAINER_PARSE, '容器长度字段越界', { stage: 'parse' });
  }
  return new DataView(asArrayBuffer(bytes), bytes.byteOffset + offset, 4).getUint32(0, false);
}

export function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
}

/** 尽力而为的内存擦除；JS 无法保证 GC 前一定生效。 */
export function secureZero(bytes: Uint8Array): void {
  bytes.fill(0);
}

export function normalizePassword(password: string): string {
  return password.normalize('NFC');
}

export function derToPem(der: Uint8Array, label: string): string {
  const base64 = toBase64(der);
  const lines = base64.match(/.{1,64}/g) ?? [];
  return `-----BEGIN ${label}-----\n${lines.join('\n')}\n-----END ${label}-----`;
}

export function pemToDer(pem: string): Uint8Array {
  const match = pem.match(/-----BEGIN [^-]+-----([\s\S]*?)-----END [^-]+-----/);
  if (!match) {
    throw new AppError(ErrorCodes.VALIDATION, 'PEM 格式不合法', { stage: 'validation' });
  }
  return fromBase64(match[1].replace(/\s+/g, ''));
}
