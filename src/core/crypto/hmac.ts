import { asBufferSource } from './encoding';

export async function hmacSha256(key: CryptoKey, data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(
    await crypto.subtle.sign('HMAC', key, asBufferSource(data)),
  );
}

export async function importHmacSha256Key(raw: Uint8Array, extractable = false): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    asBufferSource(raw),
    { name: 'HMAC', hash: 'SHA-256' },
    extractable,
    ['sign', 'verify'],
  );
}
