import type { KeyringRecord } from '../types/key';
import { DOMAINS } from '../crypto/domains';
import {
  concatBytes,
  constantTimeEqual,
  fromBase64,
  toBase64,
  utf8,
} from '../crypto/encoding';
import { hmacSha256 } from '../crypto/hmac';
import { canonicalJson, type JsonValue } from '../manifest/canonicalize';

export type KeyringIntegrityInput = Omit<KeyringRecord, 'integrity'>;

export function keyringIntegrityPayload(record: KeyringIntegrityInput): string {
  return canonicalJson({
    id: record.id,
    version: record.version,
    displayName: record.displayName,
    publicKeyJwk: record.publicKeyJwk as unknown as JsonValue,
    certPem: record.certPem,
    certFingerprint: record.certFingerprint,
    certSubject: record.certSubject,
    certSerialNumber: record.certSerialNumber,
    certNotBefore: record.certNotBefore,
    certNotAfter: record.certNotAfter,
    wrappedPrivateKey: toBase64(new Uint8Array(record.wrappedPrivateKey)),
    privateKeyIv: toBase64(new Uint8Array(record.privateKeyIv)),
    kdf: record.kdf as unknown as JsonValue,
    kcv: record.kcv,
    createdAt: record.createdAt,
  });
}

export async function computeKeyringIntegrity(
  kcvKey: CryptoKey,
  record: KeyringIntegrityInput,
): Promise<string> {
  const mac = await hmacSha256(
    kcvKey,
    concatBytes(utf8(DOMAINS.keyringIntegrity), utf8(keyringIntegrityPayload(record))),
  );
  return toBase64(mac);
}

export async function verifyKeyringIntegrity(
  kcvKey: CryptoKey,
  record: KeyringRecord,
): Promise<boolean> {
  try {
    const expected = await computeKeyringIntegrity(kcvKey, record);
    return constantTimeEqual(fromBase64(expected), fromBase64(record.integrity));
  } catch {
    return false;
  }
}
