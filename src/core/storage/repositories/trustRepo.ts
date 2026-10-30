import type { TrustedCert } from '../../types/key';
import { getDb, storageGuard } from '../db';

export async function addTrustedCert(cert: TrustedCert): Promise<void> {
  return storageGuard(async () => {
    const db = await getDb();
    await db.put('trust', cert);
  });
}

export async function isTrustedCert(fingerprint: string): Promise<boolean> {
  return storageGuard(async () => {
    const db = await getDb();
    const record = await db.get('trust', fingerprint.toLowerCase());
    return Boolean(record);
  });
}

export async function getTrustedCert(
  fingerprint: string,
): Promise<TrustedCert | undefined> {
  return storageGuard(async () => {
    const db = await getDb();
    return db.get('trust', fingerprint.toLowerCase());
  });
}

export async function listTrustedCerts(): Promise<TrustedCert[]> {
  return storageGuard(async () => {
    const db = await getDb();
    const records = await db.getAll('trust');
    return records.sort((a, b) => b.addedAt - a.addedAt);
  });
}

export async function removeTrustedCert(fingerprint: string): Promise<void> {
  return storageGuard(async () => {
    const db = await getDb();
    await db.delete('trust', fingerprint.toLowerCase());
  });
}
