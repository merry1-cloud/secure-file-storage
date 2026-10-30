import type { CipherAlgorithm, HashAlgorithm } from '../../types/crypto';
import { getDb, storageGuard } from '../db';
import type { StoredFileRecord } from '../schema';

export interface CreatePendingFileInput {
  id: string;
  fileName: string;
  size: number;
  mime: string;
  cipherAlg: CipherAlgorithm;
  hashAlg: HashAlgorithm;
  chunkCount: number;
  origin?: 'local' | 'imported';
}

export async function createPendingFile(input: CreatePendingFileInput): Promise<StoredFileRecord> {
  return storageGuard(async () => {
    const db = await getDb();
    const now = Date.now();
    const record: StoredFileRecord = {
      id: input.id,
      origin: input.origin ?? 'local',
      status: 'pending',
      createdAt: now,
      updatedAt: now,
      fileName: input.fileName,
      size: input.size,
      mime: input.mime,
      cipherAlg: input.cipherAlg,
      hashAlg: input.hashAlg,
      chunkCount: input.chunkCount,
    };
    await db.put('files', record);
    return record;
  });
}

export async function commitFile(record: StoredFileRecord): Promise<void> {
  return storageGuard(async () => {
    const db = await getDb();
    await db.put('files', { ...record, status: 'committed', updatedAt: Date.now() });
  });
}

export async function getFile(id: string): Promise<StoredFileRecord | undefined> {
  return storageGuard(async () => {
    const db = await getDb();
    return db.get('files', id);
  });
}

export async function listCommittedFiles(): Promise<StoredFileRecord[]> {
  return storageGuard(async () => {
    const db = await getDb();
    const records = await db.getAllFromIndex('files', 'by-status', 'committed');
    return records.sort((a, b) => b.createdAt - a.createdAt);
  });
}

export async function listPendingFiles(): Promise<StoredFileRecord[]> {
  return storageGuard(async () => {
    const db = await getDb();
    return db.getAllFromIndex('files', 'by-status', 'pending');
  });
}

export async function deleteFileCascade(fileId: string): Promise<void> {
  return storageGuard(async () => {
    const db = await getDb();
    const tx = db.transaction(['files', 'chunks'], 'readwrite');
    await tx.objectStore('chunks').delete(
      IDBKeyRange.bound([fileId, 0], [fileId, Number.MAX_SAFE_INTEGER]),
    );
    await tx.objectStore('files').delete(fileId);
    await tx.done;
  });
}

/**
 * 清理崩溃/取消后遗留的 pending 文件。
 * 默认只清理 15 分钟前的记录，避免多标签页同时操作时误删其他标签页正在加密的任务。
 */
export async function cleanupPendingFiles(maxAgeMs = 15 * 60 * 1000): Promise<number> {
  const pending = await listPendingFiles();
  const cutoff = Date.now() - maxAgeMs;
  let removed = 0;
  for (const record of pending) {
    if (record.updatedAt >= cutoff) continue;
    await deleteFileCascade(record.id);
    removed += 1;
  }
  return removed;
}
