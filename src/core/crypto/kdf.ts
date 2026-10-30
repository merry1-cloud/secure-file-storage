import { scrypt as wasmScrypt } from 'hash-wasm';
import {
  KDF_PROFILES,
  SALT_BYTES,
  type KdfParams,
  type KdfProfileId,
} from '../types/crypto';
import { AppError } from '../errors/AppError';
import { ErrorCodes } from '../errors/codes';
import { assertKdfParams } from '../validation/limits';
import {
  asBufferSource,
  fromBase64,
  normalizePassword,
  secureZero,
  utf8,
} from './encoding';
import { randomBase64 } from './random';
import { computeKcv, verifyKcv } from './keyCheck';
import { DOMAINS } from './domains';

export interface UnlockMaterial {
  vmk: CryptoKey;
  keyringKey: CryptoKey;
  kcvKey: CryptoKey;
  kcv: string;
}

function getSubtle(): SubtleCrypto {
  if (!globalThis.crypto?.subtle) {
    throw new AppError(ErrorCodes.UNSUPPORTED, '当前环境缺少 WebCrypto', { stage: 'validation' });
  }
  return globalThis.crypto.subtle;
}

export function createKdfParams(profileId: KdfProfileId): KdfParams {
  const profile = KDF_PROFILES[profileId];
  if (!profile) {
    throw new AppError(ErrorCodes.VALIDATION, '未知的 KDF 档位', { stage: 'validation' });
  }
  return { ...profile.params, salt: randomBase64(SALT_BYTES) } as KdfParams;
}

export function cloneKdfParamsWithNewSalt(params: KdfParams): KdfParams {
  if (params.algorithm === 'PBKDF2-HMAC-SHA256') {
    return {
      algorithm: params.algorithm,
      iterations: params.iterations,
      dkLen: params.dkLen,
      salt: randomBase64(SALT_BYTES),
    };
  }
  return {
    algorithm: params.algorithm,
    N: params.N,
    r: params.r,
    p: params.p,
    dkLen: params.dkLen,
    salt: randomBase64(SALT_BYTES),
  };
}

export async function deriveIkm(password: string, params: KdfParams): Promise<Uint8Array> {
  assertKdfParams(params);
  const subtle = getSubtle();
  const passwordBytes = utf8(normalizePassword(password));
  const salt = fromBase64(params.salt);
  try {
    if (params.algorithm === 'PBKDF2-HMAC-SHA256') {
      const baseKey = await subtle.importKey(
        'raw',
        asBufferSource(passwordBytes),
        'PBKDF2',
        false,
        ['deriveBits'],
      );
      const bits = await subtle.deriveBits(
        {
          name: 'PBKDF2',
          salt: asBufferSource(salt),
          iterations: params.iterations,
          hash: 'SHA-256',
        },
        baseKey,
        params.dkLen * 8,
      );
      return new Uint8Array(bits);
    }

    const result = (await wasmScrypt({
      password: passwordBytes,
      salt,
      costFactor: params.N,
      blockSize: params.r,
      parallelism: params.p,
      hashLength: params.dkLen,
      outputType: 'binary',
    })) as unknown;
    if (result instanceof Uint8Array) return result;
    if (typeof result === 'string') return utf8(result);
    throw new AppError(ErrorCodes.UNKNOWN, 'scrypt 返回了意外的结果类型', { stage: 'kdf' });
  } finally {
    secureZero(passwordBytes);
  }
}

async function importHkdfKey(ikm: Uint8Array): Promise<CryptoKey> {
  return getSubtle().importKey('raw', asBufferSource(ikm), 'HKDF', false, [
    'deriveBits',
    'deriveKey',
  ]);
}

async function deriveAesKey(
  ikm: Uint8Array,
  salt: Uint8Array,
  info: string,
): Promise<CryptoKey> {
  const subtle = getSubtle();
  const hkdfKey = await importHkdfKey(ikm);
  return subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: asBufferSource(salt),
      info: asBufferSource(utf8(info)),
    },
    hkdfKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

async function deriveHmacKey(
  ikm: Uint8Array,
  salt: Uint8Array,
  info: string,
): Promise<CryptoKey> {
  const subtle = getSubtle();
  const hkdfKey = await importHkdfKey(ikm);
  return subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: asBufferSource(salt),
      info: asBufferSource(utf8(info)),
    },
    hkdfKey,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

async function deriveVmk(ikm: Uint8Array, salt: Uint8Array): Promise<CryptoKey> {
  const subtle = getSubtle();
  const hkdfKey = await importHkdfKey(ikm);
  const bits = await subtle.deriveBits(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: asBufferSource(salt),
      info: asBufferSource(utf8(DOMAINS.vmkInfo)),
    },
    hkdfKey,
    256,
  );
  const raw = new Uint8Array(bits);
  try {
    return await subtle.importKey('raw', asBufferSource(raw), 'HKDF', false, [
      'deriveBits',
      'deriveKey',
    ]);
  } finally {
    secureZero(raw);
  }
}

export async function deriveUnlockMaterial(
  password: string,
  params: KdfParams,
): Promise<UnlockMaterial> {
  const salt = fromBase64(params.salt);
  const ikm = await deriveIkm(password, params);
  try {
    const [vmk, keyringKey, kcvKey] = await Promise.all([
      deriveVmk(ikm, salt),
      deriveAesKey(ikm, salt, DOMAINS.keyringKdfInfo),
      deriveHmacKey(ikm, salt, DOMAINS.kcvKeyInfo),
    ]);
    const kcv = await computeKcv(kcvKey, salt);
    return { vmk, keyringKey, kcvKey, kcv };
  } finally {
    secureZero(ikm);
  }
}

export async function verifyPasswordAndUnlock(
  password: string,
  params: KdfParams,
  expectedKcv: string,
): Promise<UnlockMaterial> {
  const material = await deriveUnlockMaterial(password, params);
  if (!verifyKcv(expectedKcv, material.kcv)) {
    throw new AppError(ErrorCodes.WRONG_PASSWORD, '口令错误', { stage: 'password' });
  }
  return material;
}

export async function deriveFileKek(vmk: CryptoKey, fileSalt: Uint8Array): Promise<CryptoKey> {
  return getSubtle().deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: asBufferSource(fileSalt),
      info: asBufferSource(utf8(DOMAINS.fileKekInfo)),
    },
    vmk,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/** 导出/备份包使用独立的口令 KDF，派生 AES-GCM 与 HMAC 两把用途隔离的密钥。 */
export async function derivePassphraseKeys(
  passphrase: string,
  params: KdfParams,
  aesInfo: string,
  kcvInfo: string,
): Promise<{ aesKey: CryptoKey; kcvKey: CryptoKey; kcv: string }> {
  const salt = fromBase64(params.salt);
  const ikm = await deriveIkm(passphrase, params);
  try {
    const [aesKey, kcvKey] = await Promise.all([
      deriveAesKey(ikm, salt, aesInfo),
      deriveHmacKey(ikm, salt, kcvInfo),
    ]);
    const kcv = await computeKcv(kcvKey, salt);
    return { aesKey, kcvKey, kcv };
  } finally {
    secureZero(ikm);
  }
}
