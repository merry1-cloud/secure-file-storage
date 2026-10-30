import { deleteDB, openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { AppError } from '../errors/AppError';
import { ErrorCodes } from '../errors/codes';
import type {
  AuditRecord,
  BenchmarkRecord,
  StoredChunkRecord,
  StoredFileRecord,
  StoredKeyringRecord,
  TrustedCertRecord,
} from './schema';

export const DB_NAME = 'secure-file-vault';
export const DB_VERSION = 1;

export interface SecureVaultDB extends DBSchema {
  files: {
    key: string;
    value: StoredFileRecord;
    indexes: { 'by-createdAt': number; 'by-status': string };
  };
  chunks: {
    key: [string, number];
    value: StoredChunkRecord;
    indexes: { 'by-file': string };
  };
  keys: {
    key: string;
    value: StoredKeyringRecord;
  };
  trust: {
    key: string;
    value: TrustedCertRecord;
    indexes: { 'by-addedAt': number };
  };
  audit: {
    key: number;
    value: AuditRecord;
    indexes: { 'by-timestamp': number };
  };
  benchmarks: {
    key: string;
    value: BenchmarkRecord;
    indexes: { 'by-createdAt': number };
  };
  settings: {
    key: string;
    value: unknown;
  };
}

let dbPromise: Promise<IDBPDatabase<SecureVaultDB>> | null = null;

export function getDb(): Promise<IDBPDatabase<SecureVaultDB>> {
  if (!dbPromise) {
    dbPromise = openDB<SecureVaultDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('files')) {
          const files = db.createObjectStore('files', { keyPath: 'id' });
          files.createIndex('by-createdAt', 'createdAt');
          files.createIndex('by-status', 'status');
        }
        if (!db.objectStoreNames.contains('chunks')) {
          const chunks = db.createObjectStore('chunks', { keyPath: ['fileId', 'index'] });
          chunks.createIndex('by-file', 'fileId');
        }
        if (!db.objectStoreNames.contains('keys')) {
          db.createObjectStore('keys', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('trust')) {
          const trust = db.createObjectStore('trust', { keyPath: 'fingerprint' });
          trust.createIndex('by-addedAt', 'addedAt');
        }
        if (!db.objectStoreNames.contains('audit')) {
          const audit = db.createObjectStore('audit', { keyPath: 'id', autoIncrement: true });
          audit.createIndex('by-timestamp', 'timestamp');
        }
        if (!db.objectStoreNames.contains('benchmarks')) {
          const benchmarks = db.createObjectStore('benchmarks', { keyPath: 'id' });
          benchmarks.createIndex('by-createdAt', 'createdAt');
        }
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings', { keyPath: 'key' });
        }
      },
      blocked() {
        console.warn('IndexedDB upgrade 被其他标签页阻塞');
      },
      blocking() {
        console.warn('当前标签页阻塞了其他标签页的 IndexedDB 升级');
      },
      terminated() {
        dbPromise = null;
      },
    });
  }
  return dbPromise;
}

export async function resetDbConnectionForTests(): Promise<void> {
  if (dbPromise) {
    const db = await dbPromise.catch(() => null);
    db?.close();
  }
  dbPromise = null;
}

export async function deleteVaultDatabase(): Promise<void> {
  await resetDbConnectionForTests();
  await deleteDB(DB_NAME);
}

export function mapStorageError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  if (
    error instanceof DOMException &&
    (error.name === 'QuotaExceededError' || error.code === 22)
  ) {
    return new AppError(ErrorCodes.QUOTA, '本地存储空间不足', {
      stage: 'storage',
      cause: error,
    });
  }
  const message = error instanceof Error ? error.message : String(error);
  return new AppError(ErrorCodes.STORAGE, `本地存储操作失败：${message}`, {
    stage: 'storage',
    cause: error,
  });
}

export async function storageGuard<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    throw mapStorageError(error);
  }
}
