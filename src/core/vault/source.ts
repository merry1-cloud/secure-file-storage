import type { FileSource } from '../types/file';
import type { Manifest } from '../types/manifest';
import type { ParsedContainer } from './container';

export function sourceFromParsedContainer(parsed: ParsedContainer): FileSource {
  return {
    manifest: parsed.manifest,
    headerBytes: parsed.headerBytes,
    signature: parsed.signature,
    getChunk: parsed.getChunk,
    getChunkBlob: parsed.getChunkBlob,
  };
}

export interface StoredSourceInput {
  manifest: Manifest;
  headerBytes: Uint8Array;
  signature: Uint8Array;
  getChunkBlob(index: number): Blob | Promise<Blob>;
}

export function sourceFromStored(input: StoredSourceInput): FileSource {
  return {
    manifest: input.manifest,
    headerBytes: input.headerBytes,
    signature: input.signature,
    async getChunk(index: number): Promise<Uint8Array> {
      const blob = await input.getChunkBlob(index);
      return new Uint8Array(await blob.arrayBuffer());
    },
  };
}
