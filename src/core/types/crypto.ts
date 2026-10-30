export type HashAlgorithm = 'SHA-256' | 'SHA-1';
export type CipherAlgorithm = 'AES-256-GCM' | 'AES-128-GCM';
export type SignatureAlgorithm = 'RSASSA-PKCS1-v1_5-SHA-256';

export interface Pbkdf2Params {
  algorithm: 'PBKDF2-HMAC-SHA256';
  salt: string;
  iterations: number;
  dkLen: 32;
}

export interface ScryptParams {
  algorithm: 'scrypt';
  salt: string;
  N: number;
  r: number;
  p: number;
  dkLen: 32;
}

export type KdfParams = Pbkdf2Params | ScryptParams;

export type Pbkdf2Template = Omit<Pbkdf2Params, 'salt'>;
export type ScryptTemplate = Omit<ScryptParams, 'salt'>;
export type KdfTemplate = Pbkdf2Template | ScryptTemplate;

export type KdfProfileId =
  | 'pbkdf2-standard'
  | 'pbkdf2-fast'
  | 'scrypt-standard'
  | 'scrypt-low';

export interface KdfProfile {
  id: KdfProfileId;
  label: string;
  description: string;
  memoryMiB: number;
  params: KdfTemplate;
}

export const KDF_PROFILES: Record<KdfProfileId, KdfProfile> = {
  'pbkdf2-standard': {
    id: 'pbkdf2-standard',
    label: 'PBKDF2 · 600,000 次（推荐）',
    description: '600,000 次迭代（推荐）',
    memoryMiB: 0,
    params: { algorithm: 'PBKDF2-HMAC-SHA256', iterations: 600_000, dkLen: 32 },
  },
  'pbkdf2-fast': {
    id: 'pbkdf2-fast',
    label: 'PBKDF2 · 300,000 次（低配）',
    description: '300,000 次迭代（低配）',
    memoryMiB: 0,
    params: { algorithm: 'PBKDF2-HMAC-SHA256', iterations: 300_000, dkLen: 32 },
  },
  'scrypt-standard': {
    id: 'scrypt-standard',
    label: 'scrypt · N=2^17（抗 GPU）',
    description: '128 MiB 内存（抗 GPU）',
    memoryMiB: 128,
    params: { algorithm: 'scrypt', N: 131_072, r: 8, p: 1, dkLen: 32 },
  },
  'scrypt-low': {
    id: 'scrypt-low',
    label: 'scrypt · N=2^15（低内存）',
    description: '32 MiB 内存（低配）',
    memoryMiB: 32,
    params: { algorithm: 'scrypt', N: 32_768, r: 8, p: 1, dkLen: 32 },
  },
};

export const DEFAULT_KDF_PROFILE_ID: KdfProfileId = 'pbkdf2-standard';

export const APP_VERSION = '0.1.0';
export const CONTAINER_MAGIC = 'SFV1';
export const CONTAINER_VERSION = 1;
export const DEFAULT_CHUNK_SIZE = 4 * 1024 * 1024;
export const GCM_TAG_LENGTH_BYTES = 16;
export const GCM_TAG_LENGTH_BITS = 128;
export const GCM_IV_LENGTH_BYTES = 12;
export const FILE_NONCE_BYTES = 8;
export const SALT_BYTES = 16;
export const KCV_BYTES = 32;
export const MAX_HEADER_BYTES = 1024 * 1024;
export const MIN_SIGNATURE_BYTES = 256;
export const MAX_SIGNATURE_BYTES = 512;
export const MAX_CHUNK_COUNT = 4096;
export const MAX_FILE_BYTES = 4 * 1024 * 1024 * 1024;
export const MIN_PBKDF2_ITERATIONS = 10_000;
export const MAX_PBKDF2_ITERATIONS = 5_000_000;
export const MIN_SCRYPT_N = 2 ** 14;
export const MAX_SCRYPT_N = 2 ** 20;
export const MAX_SCRYPT_R = 16;
export const MAX_SCRYPT_P = 4;

export const CIPHER_KEY_BITS: Record<CipherAlgorithm, 128 | 256> = {
  'AES-128-GCM': 128,
  'AES-256-GCM': 256,
};

export const HASH_BYTES: Record<HashAlgorithm, 32 | 20> = {
  'SHA-256': 32,
  'SHA-1': 20,
};

export const SIGNATURE_ALGORITHM: SignatureAlgorithm = 'RSASSA-PKCS1-v1_5-SHA-256';
