import type { BenchmarkRecord } from '../schema';
import { getDb, storageGuard } from '../db';

export async function saveBenchmark(record: BenchmarkRecord): Promise<void> {
  return storageGuard(async () => {
    const db = await getDb();
    await db.put('benchmarks', record);
  });
}

export async function listBenchmarks(): Promise<BenchmarkRecord[]> {
  return storageGuard(async () => {
    const db = await getDb();
    const records = await db.getAll('benchmarks');
    return records.sort((a, b) => b.createdAt - a.createdAt);
  });
}

export async function clearBenchmarks(): Promise<void> {
  return storageGuard(async () => {
    const db = await getDb();
    await db.clear('benchmarks');
  });
}
