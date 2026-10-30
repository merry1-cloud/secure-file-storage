import { createSHA1, createSHA256 } from 'hash-wasm';
import type { HashAlgorithm } from '../types/crypto';
import { asBufferSource } from './encoding';

export interface StreamingHasher {
  update(data: Uint8Array): void;
  digest(): Uint8Array;
}

export async function createStreamingHasher(alg: HashAlgorithm): Promise<StreamingHasher> {
  const hasher = alg === 'SHA-256' ? await createSHA256() : await createSHA1();
  hasher.init();
  return {
    update(data: Uint8Array): void {
      hasher.update(data);
    },
    digest(): Uint8Array {
      return hasher.digest('binary') as Uint8Array;
    },
  };
}

export async function hashBytes(data: Uint8Array, alg: HashAlgorithm): Promise<Uint8Array> {
  const hasher = await createStreamingHasher(alg);
  hasher.update(data);
  return hasher.digest();
}

/** 用于证书指纹等小数据；固定 SHA-256。 */
export async function sha256(data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', asBufferSource(data)));
}
