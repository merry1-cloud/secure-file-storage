import type {
  CipherAlgorithm,
  HashAlgorithm,
  KdfParams,
} from '@/core/types/crypto';
import type {
  EncryptFileResult,
  EncryptTimings,
} from '@/core/types/file';
import type { Manifest, ManifestSigner } from '@/core/types/manifest';
import type { VerificationReport } from '@/core/types/verification';
import type { SerializedAppError } from '@/core/errors/AppError';
import type {
  BenchmarkOptions,
  BenchmarkRunResult,
} from '@/core/benchmark/benchmarkService';

export interface EncryptJobPayload {
  file: {
    name: string;
    mime: string;
    size: number;
    blob: Blob;
  };
  fileId: string;
  options: {
    cipher: CipherAlgorithm;
    hashAlg: HashAlgorithm;
    kdfParams: KdfParams;
    kcv: string;
  };
  vmk: CryptoKey;
  signingKey: CryptoKey;
  signer: ManifestSigner;
}

export type DecryptSourcePayload =
  | { kind: 'vault'; fileId: string }
  | { kind: 'container'; blob: Blob };

export interface DecryptJobPayload {
  source: DecryptSourcePayload;
  vmk: CryptoKey;
  initialReport?: VerificationReport;
}

export interface StoreContainerPayload {
  blob: Blob;
}

export interface ExportContainerPayload {
  fileId: string;
}

export interface BenchmarkPayload {
  options: BenchmarkOptions;
}

export type WorkerRequest =
  | ({ type: 'encryptFile'; jobId: string } & EncryptJobPayload)
  | ({ type: 'decryptFile'; jobId: string } & DecryptJobPayload)
  | ({ type: 'storeContainer'; jobId: string } & StoreContainerPayload)
  | ({ type: 'exportContainer'; jobId: string } & ExportContainerPayload)
  | ({ type: 'benchmark'; jobId: string } & BenchmarkPayload)
  | { type: 'cancel'; jobId: string };

export interface EncryptedJobResult {
  manifest: Manifest;
  timings: EncryptTimings;
  headerBytes: ArrayBuffer;
  signature: ArrayBuffer;
}

export interface DecryptedJobResult {
  blob: Blob;
  filename: string;
  mime: string;
  digestBase64: string;
  report: VerificationReport;
}

export interface StoredContainerJobResult {
  fileId: string;
  fileName: string;
  size: number;
}

export interface ExportedContainerJobResult {
  blob: Blob;
  fileName: string;
}

export type { BenchmarkEnvironment } from '@/core/benchmark/benchmarkService';

export interface BenchmarkJobResult extends BenchmarkRunResult {}

export type WorkerResult =
  | EncryptedJobResult
  | DecryptedJobResult
  | StoredContainerJobResult
  | ExportedContainerJobResult
  | BenchmarkJobResult
  | EncryptFileResult;

export interface WorkerProgressEvent {
  type: 'progress';
  jobId: string;
  stage: string;
  done: number;
  total: number;
}

export interface WorkerDoneEvent {
  type: 'done';
  jobId: string;
  result: WorkerResult;
}

export interface WorkerErrorEvent {
  type: 'error';
  jobId: string;
  error: SerializedAppError;
}

export type WorkerResponse = WorkerProgressEvent | WorkerDoneEvent | WorkerErrorEvent;
