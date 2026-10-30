import type { CipherAlgorithm, HashAlgorithm, KdfParams } from './crypto';
import type { Manifest } from './manifest';
import type { VerificationReport } from './verification';

export interface FileInput {
  name: string;
  mime: string;
  size: number;
  blob: Blob;
}

export interface EncryptOptions {
  cipher: CipherAlgorithm;
  hashAlg: HashAlgorithm;
  kdfParams: KdfParams;
  kcv: string;
}

export interface EncryptTimings {
  totalMs: number;
  hashMs: number;
  encryptMs: number;
  wrapMs: number;
  signMs: number;
}

export interface EncryptFileResult {
  manifest: Manifest;
  headerBytes: ArrayBuffer;
  signature: ArrayBuffer;
  timings: EncryptTimings;
}

export interface DecryptFileResult {
  blob: Blob;
  filename: string;
  mime: string;
  digestBase64: string;
  report: VerificationReport;
}

export interface FileSource {
  manifest: Manifest;
  headerBytes: Uint8Array;
  signature: Uint8Array;
  getChunk(index: number): Promise<Uint8Array>;
  getChunkBlob?(index: number): Blob;
}

export interface StoredFileSummary {
  id: string;
  fileName: string;
  size: number;
  mime: string;
  createdAt: number;
  cipherAlg: CipherAlgorithm;
  hashAlg: HashAlgorithm;
  signerFingerprint: string;
  origin: 'local' | 'imported';
  chunkCount: number;
}
