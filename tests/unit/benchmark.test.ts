import { describe, expect, it } from 'vitest';
import { runBenchmark } from '@/core/benchmark/benchmarkService';

describe('性能测试核心流程', () => {
  it('1 MB 基础基准可完成并返回结果', async () => {
    const result = await runBenchmark({
      sizesBytes: [1024 * 1024],
      includeScrypt: false,
      includeEndToEnd: false,
      iterations: 1,
    });
    expect(result.results.length).toBeGreaterThan(0);
    expect(result.results.some((row) => row.name.includes('AES-256-GCM'))).toBe(true);
    expect(result.results.some((row) => row.name.includes('PBKDF2'))).toBe(true);
    expect(result.results.some((row) => row.name.includes('RSA-3072'))).toBe(true);
  }, 120_000);
});
