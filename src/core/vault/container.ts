import { AppError } from '../errors/AppError';
import { ErrorCodes } from '../errors/codes';
import {
  CONTAINER_MAGIC,
  CONTAINER_VERSION,
  GCM_TAG_LENGTH_BYTES,
  MAX_HEADER_BYTES,
} from '../types/crypto';
import type { Manifest } from '../types/manifest';
import {
  asArrayBuffer,
  concatBytes,
  constantTimeEqual,
  utf8,
} from '../crypto/encoding';
import { parseHeaderBytes } from '../manifest/canonicalize';
import { assertHeaderLength, assertSignatureLength } from '../validation/limits';

export interface ParsedContainer {
  blob: Blob;
  headerBytes: Uint8Array;
  manifest: Manifest;
  signature: Uint8Array;
  prefixLength: number;
  chunkCount: number;
  chunkSize: number;
  getChunkBlob(index: number): Blob;
  getChunk(index: number): Promise<Uint8Array>;
}

const MAGIC_BYTES = utf8(CONTAINER_MAGIC);

export async function readBlobRange(blob: Blob, start: number, end: number): Promise<Uint8Array> {
  if (start < 0 || end < start || end > blob.size) {
    throw new AppError(ErrorCodes.CONTAINER_PARSE, '读取范围越界', { stage: 'parse' });
  }
  return new Uint8Array(await blob.slice(start, end).arrayBuffer());
}

export function chunkPlaintextLength(
  size: number,
  chunkCount: number,
  chunkSize: number,
  index: number,
): number {
  if (index < 0 || index >= chunkCount) {
    throw new AppError(ErrorCodes.CHUNK_ORDER, '分块索引越界', {
      stage: 'parse',
      details: { index, chunkCount },
    });
  }
  if (index < chunkCount - 1) return chunkSize;
  return size - (chunkCount - 1) * chunkSize;
}

export async function parseContainer(input: Blob | Uint8Array): Promise<ParsedContainer> {
  const blob = input instanceof Blob ? input : new Blob([asArrayBuffer(input)]);
  if (blob.size < 14) {
    throw new AppError(ErrorCodes.CONTAINER_PARSE, '容器长度不足', { stage: 'parse' });
  }

  const prefix = await readBlobRange(blob, 0, 12);
  if (!constantTimeEqual(prefix.subarray(0, 4), MAGIC_BYTES)) {
    throw new AppError(ErrorCodes.CONTAINER_PARSE, '容器 magic 不匹配', { stage: 'parse' });
  }
  const view = new DataView(asArrayBuffer(prefix), prefix.byteOffset, prefix.byteLength);
  const version = view.getUint16(4, false);
  const flags = view.getUint16(6, false);
  const headerLength = view.getUint32(8, false);
  if (version !== CONTAINER_VERSION) {
    throw new AppError(ErrorCodes.CONTAINER_PARSE, `不支持的容器版本 ${version}`, {
      stage: 'parse',
    });
  }
  if (flags !== 0) {
    throw new AppError(ErrorCodes.CONTAINER_PARSE, '容器 flags 非零', { stage: 'parse' });
  }
  assertHeaderLength(headerLength);
  if (12 + headerLength + 2 > blob.size) {
    throw new AppError(ErrorCodes.CONTAINER_PARSE, '容器头长度越界', { stage: 'parse' });
  }

  const headerBytes = await readBlobRange(blob, 12, 12 + headerLength);
  const manifest = parseHeaderBytes(headerBytes);

  const signatureLengthBytes = await readBlobRange(blob, 12 + headerLength, 12 + headerLength + 2);
  const signatureLength = new DataView(
    asArrayBuffer(signatureLengthBytes),
    signatureLengthBytes.byteOffset,
    2,
  ).getUint16(0, false);
  assertSignatureLength(signatureLength);

  const signatureStart = 12 + headerLength + 2;
  const prefixLength = signatureStart + signatureLength;
  if (prefixLength > blob.size) {
    throw new AppError(ErrorCodes.CONTAINER_PARSE, '签名长度越界', { stage: 'parse' });
  }
  const signature = await readBlobRange(blob, signatureStart, prefixLength);

  const chunkCount = manifest.cipher.chunkCount;
  const chunkSize = manifest.cipher.chunkSize;
  const expectedLength = prefixLength + manifest.size + chunkCount * GCM_TAG_LENGTH_BYTES;
  if (blob.size !== expectedLength) {
    throw new AppError(ErrorCodes.CONTAINER_PARSE, '容器总长度与清单不一致', {
      stage: 'parse',
      details: {
        expectedLength,
        actualLength: blob.size,
      },
    });
  }

  const parsed: ParsedContainer = {
    blob,
    headerBytes,
    manifest,
    signature,
    prefixLength,
    chunkCount,
    chunkSize,
    getChunkBlob(index: number): Blob {
      const plainLength = chunkPlaintextLength(
        manifest.size,
        chunkCount,
        chunkSize,
        index,
      );
      const offset = prefixLength + index * (chunkSize + GCM_TAG_LENGTH_BYTES);
      return blob.slice(offset, offset + plainLength + GCM_TAG_LENGTH_BYTES);
    },
    async getChunk(index: number): Promise<Uint8Array> {
      return new Uint8Array(await parsed.getChunkBlob(index).arrayBuffer());
    },
  };
  return parsed;
}

export function buildContainerPrefix(
  headerBytes: Uint8Array,
  signature: Uint8Array,
): Uint8Array {
  assertHeaderLength(headerBytes.length);
  assertSignatureLength(signature.length);
  if (headerBytes.length > MAX_HEADER_BYTES) {
    throw new AppError(ErrorCodes.VALIDATION, '容器头超过上限', { stage: 'validation' });
  }
  const out = new Uint8Array(12 + headerBytes.length + 2 + signature.length);
  out.set(MAGIC_BYTES, 0);
  const view = new DataView(asArrayBuffer(out));
  view.setUint16(4, CONTAINER_VERSION, false);
  view.setUint16(6, 0, false);
  view.setUint32(8, headerBytes.length, false);
  out.set(headerBytes, 12);
  view.setUint16(12 + headerBytes.length, signature.length, false);
  out.set(signature, 12 + headerBytes.length + 2);
  return out;
}

export function buildContainerBlob(
  headerBytes: Uint8Array,
  signature: Uint8Array,
  chunks: Array<BlobPart | Uint8Array>,
): Blob {
  const prefix = buildContainerPrefix(headerBytes, signature);
  const parts: BlobPart[] = [
    asArrayBuffer(prefix),
    ...chunks.map((part) => (part instanceof Uint8Array ? asArrayBuffer(part) : part)),
  ];
  return new Blob(parts, { type: 'application/octet-stream' });
}

export function buildContainerFromChunkBlobs(
  headerBytes: Uint8Array,
  signature: Uint8Array,
  chunks: Blob[],
): Blob {
  return buildContainerBlob(headerBytes, signature, chunks);
}
