import type { AuditEntry } from '../../types/audit';
import { getDb, storageGuard } from '../db';

export async function addAuditEntry(entry: AuditEntry): Promise<number> {
  return storageGuard(async () => {
    const db = await getDb();
    const id = await db.add('audit', entry);
    return Number(id);
  });
}

export async function listAuditEntries(limit = 200): Promise<AuditEntry[]> {
  return storageGuard(async () => {
    const db = await getDb();
    const records = await db.getAll('audit');
    return records.sort((a, b) => b.timestamp - a.timestamp).slice(0, limit);
  });
}

export async function clearAuditEntries(): Promise<void> {
  return storageGuard(async () => {
    const db = await getDb();
    await db.clear('audit');
  });
}
