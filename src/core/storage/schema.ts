import type { CipherAlgorithm, HashAlgorithm } from '../types/crypto';
import type { Manifest } from '../types/manifest';
import type { KeyringRecord, TrustedCert } from '../types/key';
import type { AuditEntry } from '../types/audit';

export interface StoredFileRecord {
  id: string;
  origin: 'local' | 'imported';
  status: 'pending' | 'committed';
  createdAt: number;
  updatedAt: number;
  fileName: string;
  size: number;
  mime: string;
  cipherAlg: CipherAlgorithm;
  hashAlg: HashAlgorithm;
  chunkCount: number;
  manifest?: Manifest;
  headerBytes?: ArrayBuffer;
  signature?: ArrayBuffer;
  signerFingerprint?: string;
}

export interface StoredChunkRecord {
  fileId: string;
  index: number;
  data: Blob;
}

export interface StoredKeyringRecord extends KeyringRecord {}

export interface TrustedCertRecord extends TrustedCert {}

export interface AuditRecord extends AuditEntry {
  id?: number;
}

export interface BenchmarkResult {
  name: string;
  sizeBytes?: number;
  durationMs: number;
  throughputMBps?: number;
  iterations?: number;
  note?: string;
}

export interface BenchmarkRecord {
  id: string;
  createdAt: number;
  environment: Record<string, string | number | boolean>;
  results: BenchmarkResult[];
}
