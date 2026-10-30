import { AppError } from '../errors/AppError';
import { ErrorCodes } from '../errors/codes';
import { asBufferSource, derToPem } from './encoding';

export const RSA_MODULUS_LENGTH = 3072;
export const RSA_PUBLIC_EXPONENT = new Uint8Array([1, 0, 1]);

export async function generateRsaKeyPair(
  modulusLength: number = RSA_MODULUS_LENGTH,
): Promise<CryptoKeyPair> {
  const algorithm: RsaHashedKeyGenParams = {
    name: 'RSASSA-PKCS1-v1_5',
    modulusLength,
    publicExponent: RSA_PUBLIC_EXPONENT,
    hash: 'SHA-256',
  };
  const result = (await crypto.subtle.generateKey(algorithm, true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair;
  if (!('privateKey' in result)) {
    throw new AppError(ErrorCodes.UNKNOWN, 'RSA 密钥生成结果异常');
  }
  return result;
}

export async function signBytes(
  privateKey: CryptoKey,
  data: Uint8Array,
): Promise<Uint8Array> {
  return new Uint8Array(
    await crypto.subtle.sign(
      { name: 'RSASSA-PKCS1-v1_5' },
      privateKey,
      asBufferSource(data),
    ),
  );
}

export async function verifyBytes(
  publicKey: CryptoKey,
  signature: Uint8Array,
  data: Uint8Array,
): Promise<boolean> {
  try {
    return await crypto.subtle.verify(
      { name: 'RSASSA-PKCS1-v1_5' },
      publicKey,
      asBufferSource(signature),
      asBufferSource(data),
    );
  } catch {
    return false;
  }
}

export async function exportPrivateKeyPkcs8(key: CryptoKey): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.exportKey('pkcs8', key));
}

export async function importPrivateKeyPkcs8(
  pkcs8: Uint8Array,
  extractable = false,
): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'pkcs8',
    asBufferSource(pkcs8),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    extractable,
    ['sign'],
  );
}

export async function exportPublicKeyJwk(key: CryptoKey): Promise<JsonWebKey> {
  return crypto.subtle.exportKey('jwk', key);
}

export async function importPublicKeyJwk(jwk: JsonWebKey): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    true,
    ['verify'],
  );
}

export async function exportPublicKeySpki(key: CryptoKey): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.exportKey('spki', key));
}

export async function importPublicKeySpki(spki: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'spki',
    asBufferSource(spki),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    true,
    ['verify'],
  );
}

export function spkiToPem(spki: Uint8Array): string {
  return derToPem(spki, 'PUBLIC KEY');
}
