import { AppError } from '../errors/AppError';
import { ErrorCodes } from '../errors/codes';
import { GCM_TAG_LENGTH_BITS, type CipherAlgorithm } from '../types/crypto';
import { asBufferSource } from './encoding';

export function cipherName(_alg: CipherAlgorithm): 'AES-GCM' {
  return 'AES-GCM';
}

export async function importAesGcmKey(
  raw: Uint8Array,
  keyBits: 128 | 256,
  usages: KeyUsage[] = ['encrypt', 'decrypt'],
  extractable = false,
): Promise<CryptoKey> {
  if (raw.length * 8 !== keyBits) {
    throw new AppError(ErrorCodes.VALIDATION, 'AES 密钥长度不匹配', { stage: 'validation' });
  }
  return crypto.subtle.importKey(
    'raw',
    asBufferSource(raw),
    { name: 'AES-GCM', length: keyBits },
    extractable,
    usages,
  );
}

export async function encryptAesGcm(
  key: CryptoKey,
  iv: Uint8Array,
  plaintext: Uint8Array,
  additionalData?: Uint8Array,
): Promise<Uint8Array> {
  const params: AesGcmParams = {
    name: 'AES-GCM',
    iv: asBufferSource(iv),
    tagLength: GCM_TAG_LENGTH_BITS,
    ...(additionalData ? { additionalData: asBufferSource(additionalData) } : {}),
  };
  return new Uint8Array(
    await crypto.subtle.encrypt(params, key, asBufferSource(plaintext)),
  );
}

export async function decryptAesGcm(
  key: CryptoKey,
  iv: Uint8Array,
  ciphertext: Uint8Array,
  additionalData?: Uint8Array,
): Promise<Uint8Array> {
  const params: AesGcmParams = {
    name: 'AES-GCM',
    iv: asBufferSource(iv),
    tagLength: GCM_TAG_LENGTH_BITS,
    ...(additionalData ? { additionalData: asBufferSource(additionalData) } : {}),
  };
  try {
    return new Uint8Array(
      await crypto.subtle.decrypt(params, key, asBufferSource(ciphertext)),
    );
  } catch (error) {
    throw new AppError(ErrorCodes.AUTH_TAG, 'AES-GCM 认证失败，密文或被篡改', {
      stage: 'decrypt',
      cause: error,
    });
  }
}
