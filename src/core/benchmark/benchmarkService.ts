import type { BenchmarkResult } from '../storage/schema';
import type { KdfParams } from '../types/crypto';
import type { ManifestSigner } from '../types/manifest';
import { AppError } from '../errors/AppError';
import { ErrorCodes } from '../errors/codes';
import { deriveUnlockMaterial } from '../crypto/kdf';
import { toBase64 } from '../crypto/encoding';
import { randomBytes } from '../crypto/random';
import { createStreamingHasher } from '../crypto/hash';
import { importAesGcmKey, encryptAesGcm, decryptAesGcm } from '../crypto/aesGcm';
import {
  exportPrivateKeyPkcs8,
  generateRsaKeyPair,
  importPrivateKeyPkcs8,
  signBytes,
  verifyBytes,
} from '../crypto/rsa';
import { createSelfSignedCertificate } from '../keys/certificate';
import { encryptFile } from '../vault/encryptFile';
import { verifyContainer } from '../vault/verifyContainer';
import { sourceFromParsedContainer } from '../vault/source';
import { decryptFile } from '../vault/decryptFile';
import { buildContainerBlob } from '../vault/container';
import { nowMs } from '../vault/report';

export interface BenchmarkOptions {
  sizesBytes: number[];
  includeScrypt?: boolean;
  includeEndToEnd?: boolean;
  iterations?: number;
  onProgress?: (progress: { stage: string; done: number; total: number }) => void;
  isCancelled?: () => boolean;
}

export interface BenchmarkEnvironment {
  userAgent: string;
  hardwareConcurrency: number;
  deviceMemoryGb?: number;
  crossOriginIsolated?: boolean;
}

export interface BenchmarkRunResult {
  results: BenchmarkResult[];
  environment: BenchmarkEnvironment;
}

function checkCancelled(options: BenchmarkOptions): void {
  if (options.isCancelled?.()) {
    throw new AppError(ErrorCodes.CANCELLED, '性能测试已取消', { stage: 'validation' });
  }
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

async function measure(
  fn: () => Promise<void>,
  iterations: number,
  warmup = true,
): Promise<number> {
  if (warmup) await fn();
  const times: number[] = [];
  for (let index = 0; index < iterations; index += 1) {
    const start = nowMs();
    await fn();
    times.push(nowMs() - start);
  }
  return median(times);
}

function throughputMBps(sizeBytes: number, durationMs: number): number | undefined {
  if (sizeBytes <= 0 || durationMs <= 0) return undefined;
  return sizeBytes / 1024 / 1024 / (durationMs / 1000);
}

function makeData(sizeBytes: number, seed: Uint8Array): Uint8Array {
  if (sizeBytes <= seed.length) return seed.slice(0, sizeBytes);
  const out = new Uint8Array(sizeBytes);
  for (let offset = 0; offset < sizeBytes; offset += seed.length) {
    out.set(seed.subarray(0, Math.min(seed.length, sizeBytes - offset)), offset);
  }
  return out;
}

function getEnvironment(): BenchmarkEnvironment {
  const nav = globalThis.navigator as
    | (Navigator & { deviceMemory?: number })
    | undefined;
  return {
    userAgent: nav?.userAgent ?? 'unknown',
    hardwareConcurrency: nav?.hardwareConcurrency ?? 0,
    deviceMemoryGb: nav?.deviceMemory,
    crossOriginIsolated: globalThis.crossOriginIsolated,
  };
}

async function setupEndToEnd(): Promise<{
  vmk: CryptoKey;
  kcv: string;
  kdf: KdfParams;
  signingKey: CryptoKey;
  signer: ManifestSigner;
}> {
  const password = 'benchmark-password';
  const kdf: KdfParams = {
    algorithm: 'PBKDF2-HMAC-SHA256',
    salt: toBase64(randomBytes(16)),
    iterations: 10_000,
    dkLen: 32,
  };
  const material = await deriveUnlockMaterial(password, kdf);
  const pair = await generateRsaKeyPair(3072);
  const cert = await createSelfSignedCertificate(pair, 'Benchmark Runner');
  const pkcs8 = await exportPrivateKeyPkcs8(pair.privateKey);
  const signingKey = await importPrivateKeyPkcs8(pkcs8, false);
  return {
    vmk: material.vmk,
    kcv: material.kcv,
    kdf,
    signingKey,
    signer: {
      subject: cert.info.subject,
      serialNumber: cert.info.serialNumber,
      certPem: cert.info.pem,
      certSha256: cert.info.fingerprint,
    },
  };
}

export async function runBenchmark(
  options: BenchmarkOptions,
): Promise<BenchmarkRunResult> {
  const results: BenchmarkResult[] = [];
  const totalSteps =
    options.sizesBytes.length * 4 +
    6 +
    (options.includeScrypt ? 2 : 0) +
    (options.includeEndToEnd ? options.sizesBytes.length * 2 : 0);
  let doneSteps = 0;

  const report = (stage: string): void => {
    doneSteps += 1;
    options.onProgress?.({ stage, done: doneSteps, total: totalSteps });
  };

  const seed = randomBytes(1024 * 1024);
  const rawKey = await importAesGcmKey(randomBytes(32), 256);

  for (const sizeBytes of options.sizesBytes) {
    checkCancelled(options);
    const data = makeData(sizeBytes, seed);
    const iv = randomBytes(12);

    const aesEncryptMs = await measure(
      async () => {
        await encryptAesGcm(rawKey, iv, data);
      },
      options.iterations ?? 3,
    );
    results.push({
      name: 'AES-256-GCM 加密',
      sizeBytes,
      durationMs: aesEncryptMs,
      throughputMBps: throughputMBps(sizeBytes, aesEncryptMs),
    });
    report(`AES 加密 ${sizeBytes}`);

    const ciphertext = await encryptAesGcm(rawKey, iv, data);
    const aesDecryptMs = await measure(
      async () => {
        await decryptAesGcm(rawKey, iv, ciphertext);
      },
      options.iterations ?? 3,
    );
    results.push({
      name: 'AES-256-GCM 解密',
      sizeBytes,
      durationMs: aesDecryptMs,
      throughputMBps: throughputMBps(sizeBytes, aesDecryptMs),
    });
    report(`AES 解密 ${sizeBytes}`);

    for (const alg of ['SHA-256', 'SHA-1'] as const) {
      const hashMs = await measure(async () => {
        const hasher = await createStreamingHasher(alg);
        const chunkSize = 4 * 1024 * 1024;
        for (let offset = 0; offset < data.length; offset += chunkSize) {
          hasher.update(data.subarray(offset, Math.min(data.length, offset + chunkSize)));
        }
        hasher.digest();
      }, options.iterations ?? 3);
      results.push({
        name: `${alg} 流式哈希`,
        sizeBytes,
        durationMs: hashMs,
        throughputMBps: throughputMBps(sizeBytes, hashMs),
      });
      report(`${alg} ${sizeBytes}`);
    }
  }

  checkCancelled(options);
  const kdfTimings: Array<{ iterations: number; ms: number }> = [];
  for (const iterations of [100_000, 300_000, 600_000, 1_000_000]) {
    checkCancelled(options);
    const params: KdfParams = {
      algorithm: 'PBKDF2-HMAC-SHA256',
      salt: toBase64(randomBytes(16)),
      iterations,
      dkLen: 32,
    };
    const ms = await measure(
      async () => {
        await deriveUnlockMaterial('benchmark-password', params);
      },
      1,
      false,
    );
    kdfTimings.push({ iterations, ms });
    results.push({
      name: `PBKDF2-HMAC-SHA256 ${iterations.toLocaleString()} 次`,
      durationMs: ms,
      iterations,
      note: '含 HKDF 派生 VMK/keyringKey/KCV',
    });
    report(`PBKDF2 ${iterations}`);
  }
  results.push({
    name: 'PBKDF2 迭代次数选择结论',
    durationMs: 0,
    note: `600k ≈ ${kdfTimings.find((item) => item.iterations === 600_000)?.ms.toFixed(0) ?? '?'} ms（本机实测）`,
  });

  if (options.includeScrypt) {
    for (const N of [32_768, 131_072]) {
      checkCancelled(options);
      const params: KdfParams = {
        algorithm: 'scrypt',
        salt: toBase64(randomBytes(16)),
        N,
        r: 8,
        p: 1,
        dkLen: 32,
      };
      const ms = await measure(
        async () => {
          await deriveUnlockMaterial('benchmark-password', params);
        },
        1,
        false,
      );
      results.push({
        name: `scrypt N=2^${Math.log2(N)} r=8 p=1`,
        durationMs: ms,
        iterations: 1,
        note: `内存约 ${(128 * N * 8 / 1024 / 1024).toFixed(0)} MiB`,
      });
      report(`scrypt N=${N}`);
    }
  }

  checkCancelled(options);
  const keygenMs = await measure(
    async () => {
      await generateRsaKeyPair(3072);
    },
    2,
    false,
  );
  results.push({
    name: 'RSA-3072 密钥生成',
    durationMs: keygenMs,
    iterations: 2,
  });

  const pair = await generateRsaKeyPair(3072);
  const message = randomBytes(1024);
  const signature = await signBytes(pair.privateKey, message);
  const signMs = await measure(
    async () => {
      await signBytes(pair.privateKey, message);
    },
    20,
  );
  results.push({
    name: 'RSA-3072 PKCS#1 v1.5 签名',
    durationMs: signMs,
    iterations: 20,
  });
  const verifyMs = await measure(
    async () => {
      await verifyBytes(pair.publicKey, signature, message);
    },
    20,
  );
  results.push({
    name: 'RSA-3072 PKCS#1 v1.5 验签',
    durationMs: verifyMs,
    iterations: 20,
  });

  if (options.includeEndToEnd) {
    const setup = await setupEndToEnd();
    for (const sizeBytes of options.sizesBytes) {
      checkCancelled(options);
      const data = makeData(sizeBytes, seed);
      const iterations = sizeBytes >= 50 * 1024 * 1024 ? 1 : 2;
      const capture: {
        value: {
          headerBytes: Uint8Array;
          signature: Uint8Array;
          chunks: Uint8Array[];
        } | null;
      } = { value: null };

      const encryptMs = await measure(
        async () => {
          const chunks: Uint8Array[] = [];
          const fileId = crypto.randomUUID();
          const result = await encryptFile({
            file: {
              name: `benchmark-${sizeBytes}.bin`,
              mime: 'application/octet-stream',
              size: data.length,
              blob: new Blob([data as unknown as BlobPart]),
            },
            fileId,
            options: {
              cipher: 'AES-256-GCM',
              hashAlg: 'SHA-256',
              kdfParams: setup.kdf,
              kcv: setup.kcv,
            },
            vmk: setup.vmk,
            signingPrivateKey: setup.signingKey,
            signer: setup.signer,
            onChunk(index, ciphertext) {
              chunks[index] = ciphertext;
            },
          });
          capture.value = {
            headerBytes: new Uint8Array(result.headerBytes),
            signature: new Uint8Array(result.signature),
            chunks,
          };
        },
        iterations,
        false,
      );
      results.push({
        name: '端到端加密（读取+哈希+AES+签名）',
        sizeBytes,
        durationMs: encryptMs,
        throughputMBps: throughputMBps(sizeBytes, encryptMs),
      });
      report(`端到端加密 ${sizeBytes}`);

      const last = capture.value;
      if (!last) throw new AppError(ErrorCodes.UNKNOWN, '基准数据缺失');
      const container = buildContainerBlob(
        last.headerBytes,
        last.signature,
        last.chunks,
      );
      const verified = await verifyContainer(container, { isTrusted: () => true });
      const decryptMs = await measure(
        async () => {
          await decryptFile(sourceFromParsedContainer(verified.parsed), {
            vmk: setup.vmk,
          });
        },
        iterations,
        false,
      );
      results.push({
        name: '端到端解密（AES+完整性）',
        sizeBytes,
        durationMs: decryptMs,
        throughputMBps: throughputMBps(sizeBytes, decryptMs),
      });
      report(`端到端解密 ${sizeBytes}`);
    }
  }

  return { results, environment: getEnvironment() };
}
