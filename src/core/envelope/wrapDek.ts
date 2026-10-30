import { AppError } from '../errors/AppError';
import { ErrorCodes } from '../errors/codes';
import { GCM_IV_LENGTH_BYTES } from '../types/crypto';
import { dekWrapAad } from '../crypto/aad';
import { decryptAesGcm, encryptAesGcm, importAesGcmKey } from '../crypto/aesGcm';
import {
  fromBase64,
  secureZero,
  toBase64,
} from '../crypto/encoding';
import { randomBytes } from '../crypto/random';

export interface WrappedDek {
  dekKey: CryptoKey;
  wrappedDek: string;
  wrapIv: string;
}

export async function createAndWrapDek(
  fileKek: CryptoKey,
  fileId: string,
  keyBits: 128 | 256,
): Promise<WrappedDek> {
  const raw = randomBytes(keyBits / 8);
  try {
    const dekKey = await importAesGcmKey(raw, keyBits, ['encrypt', 'decrypt']);
    const iv = randomBytes(GCM_IV_LENGTH_BYTES);
    const wrapped = await encryptAesGcm(fileKek, iv, raw, dekWrapAad(fileId));
    return {
      dekKey,
      wrappedDek: toBase64(wrapped),
      wrapIv: toBase64(iv),
    };
  } finally {
    secureZero(raw);
  }
}

export async function rewrapDek(
  oldFileKek: CryptoKey,
  newFileKek: CryptoKey,
  wrappedDek: string,
  wrapIv: string,
  fileId: string,
): Promise<{ wrappedDek: string; wrapIv: string }> {
  let raw: Uint8Array;
  try {
    raw = await decryptAesGcm(
      oldFileKek,
      fromBase64(wrapIv),
      fromBase64(wrappedDek),
      dekWrapAad(fileId),
    );
  } catch (error) {
    throw new AppError(ErrorCodes.DEK_UNWRAP, '旧文件密钥解包失败，无法重包', {
      stage: 'unwrap',
      cause: error,
    });
  }
  try {
    const newIv = randomBytes(GCM_IV_LENGTH_BYTES);
    const ciphertext = await encryptAesGcm(
      newFileKek,
      newIv,
      raw,
      dekWrapAad(fileId),
    );
    return {
      wrappedDek: toBase64(ciphertext),
      wrapIv: toBase64(newIv),
    };
  } finally {
    secureZero(raw);
  }
}

export async function unwrapDek(
  fileKek: CryptoKey,
  wrappedDek: string,
  wrapIv: string,
  fileId: string,
  keyBits: 128 | 256,
): Promise<CryptoKey> {
  let raw: Uint8Array;
  try {
    raw = await decryptAesGcm(
      fileKek,
      fromBase64(wrapIv),
      fromBase64(wrappedDek),
      dekWrapAad(fileId),
    );
  } catch (error) {
    throw new AppError(ErrorCodes.DEK_UNWRAP, '文件密钥解包失败', {
      stage: 'unwrap',
      cause: error,
    });
  }
  try {
    return await importAesGcmKey(raw, keyBits, ['encrypt', 'decrypt']);
  } finally {
    secureZero(raw);
  }
}
