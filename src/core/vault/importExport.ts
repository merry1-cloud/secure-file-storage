import { AppError } from '../errors/AppError';
import { ErrorCodes } from '../errors/codes';
import type { FileSource } from '../types/file';
import type { StoredFileRecord } from '../storage/schema';
import { toArrayBuffer } from '../crypto/encoding';
import { getFile } from '../storage/repositories/fileRepo';
import { commitFile, createPendingFile } from '../storage/repositories/fileRepo';
import { deleteFileCascade } from '../storage/repositories/fileRepo';
import { getChunk, getChunks, putChunk } from '../storage/repositories/chunkRepo';
import {
  buildContainerFromChunkBlobs,
  parseContainer,
  type ParsedContainer,
} from './container';
import { sourceFromStored } from './source';
import { verifyContainer, verifyEnvelope, type TrustChecker, type VerifiedEnvelope } from './verifyContainer';

export interface LoadedStoredSource {
  record: StoredFileRecord;
  source: FileSource;
}

function requireCommitted(record: StoredFileRecord | undefined): StoredFileRecord {
  if (!record || record.status !== 'committed') {
    throw new AppError(ErrorCodes.STORAGE, '文件记录不存在或尚未完成', {
      stage: 'storage',
    });
  }
  if (!record.manifest || !record.headerBytes || !record.signature) {
    throw new AppError(ErrorCodes.STORAGE, '文件记录缺少清单或签名', {
      stage: 'storage',
    });
  }
  return record;
}

export async function loadStoredSource(fileId: string): Promise<LoadedStoredSource> {
  const record = requireCommitted(await getFile(fileId));
  const source = sourceFromStored({
    manifest: record.manifest!,
    headerBytes: new Uint8Array(record.headerBytes!),
    signature: new Uint8Array(record.signature!),
    getChunkBlob: async (index: number) => {
      const blob = await getChunk(fileId, index);
      if (!blob) {
        throw new AppError(ErrorCodes.STORAGE, `缺少第 ${index} 个分块`, {
          stage: 'storage',
          details: { fileId, index },
        });
      }
      return blob;
    },
  });
  return { record, source };
}

export async function verifyStoredFile(
  fileId: string,
  trust: TrustChecker,
): Promise<VerifiedEnvelope & { record: StoredFileRecord }> {
  const { record, source } = await loadStoredSource(fileId);
  const verified = await verifyEnvelope(source, trust);
  return { ...verified, record };
}

export async function exportContainerBlob(fileId: string): Promise<{ blob: Blob; record: StoredFileRecord }> {
  const record = requireCommitted(await getFile(fileId));
  const chunks = await getChunks(fileId);
  if (chunks.length !== record.chunkCount) {
    throw new AppError(ErrorCodes.STORAGE, '分块数量与文件记录不一致', {
      stage: 'storage',
      details: { expected: record.chunkCount, actual: chunks.length },
    });
  }
  const blob = buildContainerFromChunkBlobs(
    new Uint8Array(record.headerBytes!),
    new Uint8Array(record.signature!),
    chunks,
  );
  return { blob, record };
}

export async function inspectContainer(
  blob: Blob,
  trust: TrustChecker,
): Promise<VerifiedEnvelope & { parsed: ParsedContainer }> {
  return verifyContainer(blob, trust);
}

export interface ImportContainerOptions {
  trust: TrustChecker;
  onProgress?: (progress: { done: number; total: number }) => void;
  isCancelled?: () => boolean;
}

export async function importContainerToVault(
  blob: Blob,
  options: ImportContainerOptions,
): Promise<StoredFileRecord> {
  const verified = await verifyContainer(blob, options.trust);
  const parsed = verified.parsed;
  const manifest = parsed.manifest;

  const existing = await getFile(manifest.fileId);
  if (existing) {
    throw new AppError(ErrorCodes.VALIDATION, '该容器已经导入过', {
      stage: 'storage',
      details: { fileId: manifest.fileId },
    });
  }

  await createPendingFile({
    id: manifest.fileId,
    fileName: manifest.filename,
    size: manifest.size,
    mime: manifest.mime,
    cipherAlg: manifest.cipher.alg,
    hashAlg: manifest.hash.alg,
    chunkCount: manifest.cipher.chunkCount,
    origin: 'imported',
  });

  try {
    for (let index = 0; index < manifest.cipher.chunkCount; index += 1) {
      if (options.isCancelled?.()) {
        throw new AppError(ErrorCodes.CANCELLED, '容器导入已取消', {
          stage: 'storage',
        });
      }
      await putChunk(manifest.fileId, index, parsed.getChunkBlob(index));
      options.onProgress?.({
        done: index + 1,
        total: manifest.cipher.chunkCount,
      });
    }
    const record: StoredFileRecord = {
      id: manifest.fileId,
      origin: 'imported',
      status: 'committed',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      fileName: manifest.filename,
      size: manifest.size,
      mime: manifest.mime,
      cipherAlg: manifest.cipher.alg,
      hashAlg: manifest.hash.alg,
      chunkCount: manifest.cipher.chunkCount,
      manifest,
      headerBytes: toArrayBuffer(parsed.headerBytes),
      signature: toArrayBuffer(parsed.signature),
      signerFingerprint: manifest.signer.certSha256,
    };
    await commitFile(record);
    return record;
  } catch (error) {
    await deleteFileCascade(manifest.fileId).catch(() => undefined);
    throw error;
  }
}

export async function deleteStoredFile(fileId: string): Promise<void> {
  await deleteFileCascade(fileId);
}

export async function readContainerFromFile(file: File): Promise<Blob> {
  return file;
}

export async function parseContainerForLab(
  blob: Blob,
): Promise<ParsedContainer> {
  return parseContainer(blob);
}
