import { CONTAINER_VERSION } from '../types/crypto';
import { concatBytes, uint32BE, utf8 } from './encoding';
import { DOMAINS } from './domains';

export function dekWrapAad(fileId: string): Uint8Array {
  return concatBytes(utf8(DOMAINS.dekWrap), utf8(fileId), Uint8Array.of(CONTAINER_VERSION));
}

export function keyringWrapAad(): Uint8Array {
  return utf8(DOMAINS.keyringWrap);
}

export interface ChunkAadInput {
  fileId: string;
  index: number;
  chunkCount: number;
  plaintextLength: number;
  fileNonce: Uint8Array;
}

export function chunkAad(input: ChunkAadInput): Uint8Array {
  return concatBytes(
    utf8(DOMAINS.chunk),
    utf8(input.fileId),
    uint32BE(input.index),
    uint32BE(input.chunkCount),
    uint32BE(input.plaintextLength),
    input.fileNonce,
  );
}
