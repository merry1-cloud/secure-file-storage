import { AppError, serializeAppError } from '@/core/errors/AppError';
import { ErrorCodes } from '@/core/errors/codes';
import { encryptFile } from '@/core/vault/encryptFile';
import { decryptFile } from '@/core/vault/decryptFile';
import { loadStoredSource, exportContainerBlob, importContainerToVault } from '@/core/vault/importExport';
import { parseContainer } from '@/core/vault/container';
import { sourceFromParsedContainer } from '@/core/vault/source';
import { createPendingFile, commitFile, deleteFileCascade } from '@/core/storage/repositories/fileRepo';
import { putChunk } from '@/core/storage/repositories/chunkRepo';
import { runBenchmark } from '@/core/benchmark/benchmarkService';
import type {
  DecryptJobPayload,
  EncryptJobPayload,
  ExportContainerPayload,
  BenchmarkPayload,
  StoreContainerPayload,
  WorkerRequest,
  WorkerResponse,
  WorkerResult,
} from './protocol';

interface WorkerScope {
  postMessage(message: WorkerResponse): void;
  addEventListener(
    type: 'message',
    listener: (event: MessageEvent<WorkerRequest>) => void,
  ): void;
}

const scope = globalThis as unknown as WorkerScope;
const cancelled = new Set<string>();

function post(message: WorkerResponse): void {
  scope.postMessage(message);
}

function progress(jobId: string, stage: string, done: number, total: number): void {
  post({ type: 'progress', jobId, stage, done, total });
}

function isCancelled(jobId: string): boolean {
  return cancelled.has(jobId);
}

async function handleEncrypt(jobId: string, payload: EncryptJobPayload): Promise<WorkerResult> {
  const chunkCount =
    payload.file.blob.size === 0
      ? 0
      : Math.ceil(payload.file.blob.size / (4 * 1024 * 1024));
  await createPendingFile({
    id: payload.fileId,
    fileName: payload.file.name,
    size: payload.file.blob.size,
    mime: payload.file.mime,
    cipherAlg: payload.options.cipher,
    hashAlg: payload.options.hashAlg,
    chunkCount,
    origin: 'local',
  });

  try {
    const result = await encryptFile({
      file: payload.file,
      fileId: payload.fileId,
      options: payload.options,
      vmk: payload.vmk,
      signingPrivateKey: payload.signingKey,
      signer: payload.signer,
      onChunk: async (index, ciphertext) => {
        await putChunk(
          payload.fileId,
          index,
          new Blob([ciphertext as unknown as BlobPart], {
            type: 'application/octet-stream',
          }),
        );
      },
      onProgress: ({ stage, done, total }) => progress(jobId, stage, done, total),
      isCancelled: () => isCancelled(jobId),
    });

    if (isCancelled(jobId)) {
      throw new AppError(ErrorCodes.CANCELLED, '加密已取消', { stage: 'encrypt' });
    }

    await commitFile({
      id: payload.fileId,
      origin: 'local',
      status: 'committed',
      createdAt: result.manifest.createdAt,
      updatedAt: Date.now(),
      fileName: result.manifest.filename,
      size: result.manifest.size,
      mime: result.manifest.mime,
      cipherAlg: result.manifest.cipher.alg,
      hashAlg: result.manifest.hash.alg,
      chunkCount: result.manifest.cipher.chunkCount,
      manifest: result.manifest,
      headerBytes: result.headerBytes,
      signature: result.signature,
      signerFingerprint: result.manifest.signer.certSha256,
    });

    return {
      manifest: result.manifest,
      timings: result.timings,
      headerBytes: result.headerBytes,
      signature: result.signature,
    };
  } catch (error) {
    await deleteFileCascade(payload.fileId).catch(() => undefined);
    throw error;
  }
}

async function handleDecrypt(jobId: string, payload: DecryptJobPayload): Promise<WorkerResult> {
  const source =
    payload.source.kind === 'vault'
      ? (await loadStoredSource(payload.source.fileId)).source
      : sourceFromParsedContainer(await parseContainer(payload.source.blob));

  const result = await decryptFile(source, {
    vmk: payload.vmk,
    report: payload.initialReport,
    onProgress: ({ done, total }) => progress(jobId, 'decrypt', done, total),
    isCancelled: () => isCancelled(jobId),
  });

  return {
    blob: result.blob,
    filename: result.filename,
    mime: result.mime,
    digestBase64: result.digestBase64,
    report: result.report,
  };
}

async function handleStoreContainer(
  jobId: string,
  payload: StoreContainerPayload,
): Promise<WorkerResult> {
  const record = await importContainerToVault(payload.blob, {
    trust: { isTrusted: () => true },
    onProgress: ({ done, total }) => progress(jobId, 'storeContainer', done, total),
    isCancelled: () => isCancelled(jobId),
  });
  return { fileId: record.id, fileName: record.fileName, size: record.size };
}

async function handleExport(
  _jobId: string,
  payload: ExportContainerPayload,
): Promise<WorkerResult> {
  const { blob, record } = await exportContainerBlob(payload.fileId);
  return { blob, fileName: record.fileName };
}

async function handleBenchmark(
  jobId: string,
  payload: BenchmarkPayload,
): Promise<WorkerResult> {
  return runBenchmark({
    ...payload.options,
    onProgress: ({ stage, done, total }) => progress(jobId, stage, done, total),
    isCancelled: () => isCancelled(jobId),
  });
}

async function handle(request: WorkerRequest): Promise<void> {
  if (request.type === 'cancel') {
    cancelled.add(request.jobId);
    return;
  }
  const { jobId } = request;
  try {
    let result: WorkerResult;
    switch (request.type) {
      case 'encryptFile':
        result = await handleEncrypt(jobId, request);
        break;
      case 'decryptFile':
        result = await handleDecrypt(jobId, request);
        break;
      case 'storeContainer':
        result = await handleStoreContainer(jobId, request);
        break;
      case 'exportContainer':
        result = await handleExport(jobId, request);
        break;
      case 'benchmark':
        result = await handleBenchmark(jobId, request);
        break;
      default:
        throw new AppError(ErrorCodes.WORKER, '未知的后台任务类型');
    }
    post({ type: 'done', jobId, result });
  } catch (error) {
    post({ type: 'error', jobId, error: serializeAppError(error) });
  } finally {
    cancelled.delete(jobId);
  }
}

scope.addEventListener('message', (event) => {
  void handle(event.data);
});
