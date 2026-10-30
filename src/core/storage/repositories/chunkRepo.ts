import { AppError } from '../../errors/AppError';
import { ErrorCodes } from '../../errors/codes';
import { getDb, storageGuard } from '../db';

function assertIndex(index: number): void {
  if (!Number.isInteger(index) || index < 0) {
    throw new AppError(ErrorCodes.VALIDATION, '分块索引不合法', { stage: 'storage' });
  }
}

export async function putChunk(fileId: string, index: number, data: Blob): Promise<void> {
  assertIndex(index);
  return storageGuard(async () => {
    const db = await getDb();
    await db.put('chunks', { fileId, index, data });
  });
}

export async function getChunk(fileId: string, index: number): Promise<Blob | undefined> {
  assertIndex(index);
  return storageGuard(async () => {
    const db = await getDb();
    const record = await db.get('chunks', [fileId, index]);
    return record?.data;
  });
}

export async function getChunks(fileId: string): Promise<Blob[]> {
  return storageGuard(async () => {
    const db = await getDb();
    const records = await db.getAllFromIndex('chunks', 'by-file', fileId);
    return records.sort((a, b) => a.index - b.index).map((record) => record.data);
  });
}

export async function countChunks(fileId: string): Promise<number> {
  return storageGuard(async () => {
    const db = await getDb();
    return db.countFromIndex('chunks', 'by-file', fileId);
  });
}

export async function deleteChunks(fileId: string): Promise<void> {
  return storageGuard(async () => {
    const db = await getDb();
    await db.delete('chunks', IDBKeyRange.bound([fileId, 0], [fileId, Number.MAX_SAFE_INTEGER]));
  });
}
