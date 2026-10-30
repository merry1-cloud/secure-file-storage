import { AppError } from '../errors/AppError';
import { ErrorCodes } from '../errors/codes';
import { DOMAINS } from '../crypto/domains';
import { concatBytes, constantTimeEqual, fromUtf8, utf8 } from '../crypto/encoding';
import type { Manifest } from '../types/manifest';
import { parseManifestObject } from './schema';

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export function canonicalJson(value: JsonValue): string {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new AppError(ErrorCodes.VALIDATION, '清单包含非有限数字', { stage: 'validation' });
    }
    return JSON.stringify(value);
  }
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  if (typeof value === 'object') {
    const keys = Object.keys(value).sort();
    const entries = keys.map((key) => {
      const item = (value as Record<string, JsonValue>)[key];
      return `${JSON.stringify(key)}:${canonicalJson(item)}`;
    });
    return `{${entries.join(',')}}`;
  }
  throw new AppError(ErrorCodes.VALIDATION, '清单包含不支持的值类型', {
    stage: 'validation',
  });
}

export function encodeManifest(manifest: Manifest): Uint8Array {
  const parsed = parseManifestObject(manifest);
  return utf8(canonicalJson(parsed as unknown as JsonValue));
}

export function manifestSigningInput(headerBytes: Uint8Array): Uint8Array {
  return concatBytes(utf8(DOMAINS.manifest), headerBytes);
}

export function parseHeaderBytes(headerBytes: Uint8Array): Manifest {
  let raw: string;
  try {
    raw = fromUtf8(headerBytes);
  } catch (error) {
    throw new AppError(ErrorCodes.CONTAINER_PARSE, '容器头不是合法 UTF-8', {
      stage: 'parse',
      cause: error,
    });
  }
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    throw new AppError(ErrorCodes.CONTAINER_PARSE, '容器头不是合法 JSON', {
      stage: 'parse',
      cause: error,
    });
  }
  const manifest = parseManifestObject(value);
  const canonical = encodeManifest(manifest);
  if (!constantTimeEqual(canonical, headerBytes)) {
    throw new AppError(ErrorCodes.NON_CANONICAL, '容器头不是规范编码，可能已被修改', {
      stage: 'parse',
    });
  }
  return manifest;
}
