import { getDb, storageGuard } from '../db';
import type { StoredKeyringRecord } from '../schema';

export async function getPrimaryKeyring(): Promise<StoredKeyringRecord | undefined> {
  return storageGuard(async () => {
    const db = await getDb();
    return db.get('keys', 'primary');
  });
}

export async function savePrimaryKeyring(record: StoredKeyringRecord): Promise<void> {
  return storageGuard(async () => {
    const db = await getDb();
    await db.put('keys', record);
  });
}

export async function deletePrimaryKeyring(): Promise<void> {
  return storageGuard(async () => {
    const db = await getDb();
    await db.delete('keys', 'primary');
  });
}
