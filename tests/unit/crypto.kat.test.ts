import { describe, expect, it } from 'vitest';
import { pbkdf2 as nodePbkdf2 } from 'node:crypto';
import { promisify } from 'node:util';
import { scrypt as wasmScrypt } from 'hash-wasm';
import { hashBytes } from '@/core/crypto/hash';
import { asBufferSource, toBase64, toHex, utf8 } from '@/core/crypto/encoding';
import { deriveIkm } from '@/core/crypto/kdf';
import { encryptAesGcm, decryptAesGcm, importAesGcmKey } from '@/core/crypto/aesGcm';
import {
  generateRsaKeyPair,
  signBytes,
  verifyBytes,
  exportPublicKeySpki,
  importPublicKeySpki,
} from '@/core/crypto/rsa';
import { randomBytes } from '@/core/crypto/random';
import type { KdfParams } from '@/core/types/crypto';

const pbkdf2Async = promisify(nodePbkdf2);

describe('安全随机数', () => {
  it('randomBytes 支持大于 65,536 字节的缓冲区', () => {
    const bytes = randomBytes(1024 * 1024);
    expect(bytes.length).toBe(1024 * 1024);
    expect(bytes.some((byte) => byte !== 0)).toBe(true);
  });
});

describe('哈希已知答案', () => {
  it('SHA-256("abc")', async () => {
    const digest = await hashBytes(utf8('abc'), 'SHA-256');
    expect(toHex(digest)).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('SHA-1("abc")', async () => {
    const digest = await hashBytes(utf8('abc'), 'SHA-1');
    expect(toHex(digest)).toBe('a9993e364706816aba3e25717850c26c9cd0d89d');
  });
});

describe('PBKDF2 / scrypt', () => {
  it('WebCrypto PBKDF2 1 次迭代与公开向量一致', async () => {
    const salt = utf8('salt');
    const key = await crypto.subtle.importKey(
      'raw',
      asBufferSource(utf8('password')),
      'PBKDF2',
      false,
      ['deriveBits'],
    );
    const bits = await crypto.subtle.deriveBits(
      {
        name: 'PBKDF2',
        salt: asBufferSource(salt),
        iterations: 1,
        hash: 'SHA-256',
      },
      key,
      256,
    );
    expect(toHex(new Uint8Array(bits))).toBe(
      '120fb6cffcf8b32c43e7225256c4f837a86548c92ccc35480805987cb70be17b',
    );
  });

  it('deriveIkm 与 Node PBKDF2 在 10,000 次迭代下一致', async () => {
    const params: KdfParams = {
      algorithm: 'PBKDF2-HMAC-SHA256',
      salt: toBase64(utf8('test-salt-16byte')),
      iterations: 10_000,
      dkLen: 32,
    };
    const expected = (await pbkdf2Async('password', utf8('test-salt-16byte'), 10_000, 32, 'sha256')) as Buffer;
    const actual = await deriveIkm('password', params);
    expect(toHex(actual)).toBe(expected.toString('hex'));
  });

  it('scrypt RFC 7914 向量（hash-wasm 原语）', async () => {
    const result = (await wasmScrypt({
      password: '',
      salt: '',
      costFactor: 16,
      blockSize: 1,
      parallelism: 1,
      hashLength: 64,
      outputType: 'binary',
    })) as Uint8Array;
    expect(toHex(result)).toBe(
      '77d6576238657b203b19ca42c18a0497f16b4844e3074ae8dfdffa3fede21442' +
        'fcd0069ded0948f8326a753a0fc81f17e8d3e0fb2e0d3628cf35e20c38d18906',
    );
  });

  it('deriveIkm 拒绝超范围 KDF 参数', async () => {
    await expect(
      deriveIkm('password', {
        algorithm: 'PBKDF2-HMAC-SHA256',
        salt: toBase64(utf8('test-salt-16byte')),
        iterations: 1,
        dkLen: 32,
      }),
    ).rejects.toMatchObject({ code: 'E_KDF_LIMIT' });
  });
});

describe('AES-256-GCM', () => {
  it('加密/解密 round-trip，且 AAD 被绑定', async () => {
    const raw = randomBytes(32);
    const key = await importAesGcmKey(raw, 256);
    const iv = randomBytes(12);
    const plaintext = utf8('hello 安全文件');
    const aad = utf8('file-1');
    const ciphertext = await encryptAesGcm(key, iv, plaintext, aad);
    expect(ciphertext.length).toBe(plaintext.length + 16);
    const decrypted = await decryptAesGcm(key, iv, ciphertext, aad);
    expect(toHex(decrypted)).toBe(toHex(plaintext));
    await expect(decryptAesGcm(key, iv, ciphertext, utf8('file-2'))).rejects.toMatchObject({
      code: 'E_AUTH_TAG',
    });
  });

  it('篡改 1 bit 后认证失败', async () => {
    const key = await importAesGcmKey(randomBytes(32), 256);
    const iv = randomBytes(12);
    const ciphertext = await encryptAesGcm(key, iv, utf8('data'));
    ciphertext[0] ^= 1;
    await expect(decryptAesGcm(key, iv, ciphertext)).rejects.toMatchObject({
      code: 'E_AUTH_TAG',
    });
  });
});

describe('RSA 签名与证书', () => {
  it('签名/验签成功，替换签名失败', async () => {
    const pair = await generateRsaKeyPair(2048);
    const data = utf8('manifest bytes');
    const signature = await signBytes(pair.privateKey, data);
    expect(await verifyBytes(pair.publicKey, signature, data)).toBe(true);
    expect(await verifyBytes(pair.publicKey, signature, utf8('other'))).toBe(false);
    const tampered = signature.slice();
    tampered[0] ^= 1;
    expect(await verifyBytes(pair.publicKey, tampered, data)).toBe(false);
  });

  it('公钥 SPKI 导出/导入后仍可验签', async () => {
    const pair = await generateRsaKeyPair(2048);
    const data = utf8('spki roundtrip');
    const signature = await signBytes(pair.privateKey, data);
    const spki = await exportPublicKeySpki(pair.publicKey);
    const imported = await importPublicKeySpki(spki);
    expect(await verifyBytes(imported, signature, data)).toBe(true);
  });
});
