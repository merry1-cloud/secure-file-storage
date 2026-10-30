import { AppError, deserializeAppError } from '@/core/errors/AppError';
import { ErrorCodes } from '@/core/errors/codes';
import { randomUuid } from '@/core/crypto/random';
import type {
  BenchmarkJobResult,
  DecryptedJobResult,
  EncryptedJobResult,
  ExportedContainerJobResult,
  StoredContainerJobResult,
  WorkerProgressEvent,
  WorkerRequest,
  WorkerResponse,
} from './protocol';
import type { BenchmarkOptions } from '@/core/benchmark/benchmarkService';
import type { EncryptJobPayload, DecryptJobPayload } from './protocol';

export interface JobProgress {
  stage: string;
  done: number;
  total: number;
}

export interface JobHandle<T> {
  jobId: string;
  promise: Promise<T>;
  cancel(): void;
}

interface PendingJob {
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
  onProgress?: (progress: JobProgress) => void;
}

let worker: Worker | null = null;
const pending = new Map<string, PendingJob>();

function getWorker(): Worker {
  if (typeof Worker === 'undefined') {
    throw new AppError(ErrorCodes.UNSUPPORTED, '当前浏览器不支持 Web Worker', {
      stage: 'unknown',
    });
  }
  if (!worker) {
    worker = new Worker(new URL('./crypto.worker.ts', import.meta.url), {
      type: 'module',
      name: 'secure-vault-crypto',
    });
    worker.addEventListener('message', (event: MessageEvent<WorkerResponse>) => {
      const message = event.data;
      const job = pending.get(message.jobId);
      if (!job) return;
      if (message.type === 'progress') {
        job.onProgress?.({
          stage: message.stage,
          done: message.done,
          total: message.total,
        });
      } else if (message.type === 'done') {
        pending.delete(message.jobId);
        job.resolve(message.result);
      } else {
        pending.delete(message.jobId);
        job.reject(deserializeAppError(message.error));
      }
    });
    worker.addEventListener('error', (event) => {
      const error = new AppError(
        ErrorCodes.WORKER,
        `后台加密任务异常：${event.message || 'unknown'}`,
        { stage: 'unknown' },
      );
      for (const [jobId, job] of pending) {
        pending.delete(jobId);
        job.reject(error);
      }
      worker?.terminate();
      worker = null;
    });
  }
  return worker;
}

function startJob<T>(
  buildRequest: (jobId: string) => WorkerRequest,
  onProgress?: (progress: JobProgress) => void,
): JobHandle<T> {
  const jobId = randomUuid();
  const workerInstance = getWorker();
  const promise = new Promise<T>((resolve, reject) => {
    pending.set(jobId, {
      resolve: resolve as (value: unknown) => void,
      reject,
      onProgress,
    });
    workerInstance.postMessage(buildRequest(jobId));
  });
  return {
    jobId,
    promise,
    cancel() {
      workerInstance.postMessage({ type: 'cancel', jobId });
    },
  };
}

export function startEncryptJob(
  payload: EncryptJobPayload,
  onProgress?: (progress: JobProgress) => void,
): JobHandle<EncryptedJobResult> {
  return startJob<EncryptedJobResult>(
    (jobId) => ({ type: 'encryptFile', jobId, ...payload }),
    onProgress,
  );
}

export function startDecryptJob(
  payload: DecryptJobPayload,
  onProgress?: (progress: JobProgress) => void,
): JobHandle<DecryptedJobResult> {
  return startJob<DecryptedJobResult>(
    (jobId) => ({ type: 'decryptFile', jobId, ...payload }),
    onProgress,
  );
}

export function startStoreContainerJob(
  blob: Blob,
  onProgress?: (progress: JobProgress) => void,
): JobHandle<StoredContainerJobResult> {
  return startJob<StoredContainerJobResult>(
    (jobId) => ({ type: 'storeContainer', jobId, blob }),
    onProgress,
  );
}

export function startExportContainerJob(
  fileId: string,
): JobHandle<ExportedContainerJobResult> {
  return startJob<ExportedContainerJobResult>((jobId) => ({
    type: 'exportContainer',
    jobId,
    fileId,
  }));
}

export function startBenchmarkJob(
  options: BenchmarkOptions,
  onProgress?: (progress: JobProgress) => void,
): JobHandle<BenchmarkJobResult> {
  return startJob<BenchmarkJobResult>(
    (jobId) => ({ type: 'benchmark', jobId, options }),
    onProgress,
  );
}

export function cancelJob(jobId: string): void {
  try {
    worker?.postMessage({ type: 'cancel', jobId });
  } catch {
    // 忽略已终止 worker 的取消。
  }
}

export function resetWorkerForTests(): void {
  worker?.terminate();
  worker = null;
  pending.clear();
}

export type { WorkerProgressEvent };
