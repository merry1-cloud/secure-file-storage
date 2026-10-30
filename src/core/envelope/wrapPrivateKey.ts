import { AppError } from '../errors/AppError';
import { ErrorCodes } from '../errors/codes';
import { GCM_IV_LENGTH_BYTES } from '../types/crypto';
import { keyringWrapAad } from '../crypto/aad';
import { decryptAesGcm, encryptAesGcm } from '../crypto/aesGcm';
import { secureZero, toArrayBuffer } from '../crypto/encoding';
import { randomBytes } from '../crypto/random';
import { importPrivateKeyPkcs8 } from '../crypto/rsa';

export interface WrappedPrivateKey {
  wrappedPrivateKey: ArrayBuffer;
  privateKeyIv: ArrayBuffer;
}

export async function wrapPrivateKey(
  keyringKey: CryptoKey,
  pkcs8: Uint8Array,
): Promise<WrappedPrivateKey> {
  const iv = randomBytes(GCM_IV_LENGTH_BYTES);
  const wrapped = await encryptAesGcm(keyringKey, iv, pkcs8, keyringWrapAad());
  return {
    wrappedPrivateKey: toArrayBuffer(wrapped),
    privateKeyIv: toArrayBuffer(iv),
  };
}

export async function unwrapPrivateKey(
  keyringKey: CryptoKey,
  wrappedPrivateKey: ArrayBuffer,
  privateKeyIv: ArrayBuffer,
  extractable = false,
): Promise<CryptoKey> {
  let pkcs8: Uint8Array;
  try {
    pkcs8 = await decryptAesGcm(
      keyringKey,
      new Uint8Array(privateKeyIv),
      new Uint8Array(wrappedPrivateKey),
      keyringWrapAad(),
    );
  } catch (error) {
    throw new AppError(ErrorCodes.KEY_MISMATCH, '私钥解包失败，密钥环可能已损坏', {
      stage: 'unwrap',
      cause: error,
    });
  }
  try {
    return await importPrivateKeyPkcs8(pkcs8, extractable);
  } finally {
    secureZero(pkcs8);
  }
}
