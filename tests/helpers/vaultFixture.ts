import {
  APP_VERSION,
  DEFAULT_CHUNK_SIZE,
  SIGNATURE_ALGORITHM,
  type HashAlgorithm,
  type KdfParams,
} from '@/core/types/crypto';
import type { ManifestSigner } from '@/core/types/manifest';
import { deriveUnlockMaterial, type UnlockMaterial } from '@/core/crypto/kdf';
import {
  exportPrivateKeyPkcs8,
  generateRsaKeyPair,
  importPrivateKeyPkcs8,
} from '@/core/crypto/rsa';
import { randomBase64, randomUuid } from '@/core/crypto/random';
import { createSelfSignedCertificate, type GeneratedCertificate } from '@/core/keys/certificate';
import { encryptFile } from '@/core/vault/encryptFile';
import { buildContainerBlob } from '@/core/vault/container';

export const TEST_PASSWORD = 'correct horse battery staple';

export interface TestVaultContext {
  password: string;
  kdf: KdfParams;
  material: UnlockMaterial;
  certificate: GeneratedCertificate;
  signer: ManifestSigner;
  privateKey: CryptoKey;
}

export async function createTestVaultContext(): Promise<TestVaultContext> {
  const password = TEST_PASSWORD;
  const kdf: KdfParams = {
    algorithm: 'PBKDF2-HMAC-SHA256',
    salt: randomBase64(16),
    iterations: 10_000,
    dkLen: 32,
  };
  const material = await deriveUnlockMaterial(password, kdf);
  const keyPair = await generateRsaKeyPair(2048);
  const certificate = await createSelfSignedCertificate(keyPair, 'Test User');
  const pkcs8 = await exportPrivateKeyPkcs8(keyPair.privateKey);
  const privateKey = await importPrivateKeyPkcs8(pkcs8, false);
  const signer: ManifestSigner = {
    subject: certificate.info.subject,
    serialNumber: certificate.info.serialNumber,
    certPem: certificate.info.pem,
    certSha256: certificate.info.fingerprint,
  };
  return { password, kdf, material, certificate, signer, privateKey };
}

export interface EncryptedFixture {
  fileId: string;
  blob: Blob;
  chunks: Uint8Array[];
  manifest: import('@/core/types/manifest').Manifest;
  headerBytes: Uint8Array;
  signature: Uint8Array;
}

export async function encryptFixture(
  context: TestVaultContext,
  name: string,
  data: Uint8Array,
  hashAlg: HashAlgorithm = 'SHA-256',
): Promise<EncryptedFixture> {
  const fileId = randomUuid();
  const blob = new Blob([data as unknown as BlobPart]);
  const chunks: Uint8Array[] = [];
  const result = await encryptFile({
    file: { name, mime: 'application/octet-stream', size: blob.size, blob },
    fileId,
    options: {
      cipher: 'AES-256-GCM',
      hashAlg,
      kdfParams: context.kdf,
      kcv: context.material.kcv,
    },
    vmk: context.material.vmk,
    signingPrivateKey: context.privateKey,
    signer: context.signer,
    onChunk(index, ciphertext) {
      chunks[index] = ciphertext;
    },
  });
  const headerBytes = new Uint8Array(result.headerBytes);
  const signature = new Uint8Array(result.signature);
  const container = buildContainerBlob(headerBytes, signature, chunks);
  return {
    fileId,
    blob: container,
    chunks,
    manifest: result.manifest,
    headerBytes,
    signature,
  };
}

export function createTestPattern(size: number, seed = 7): Uint8Array {
  const out = new Uint8Array(size);
  let value = seed;
  for (let index = 0; index < size; index += 1) {
    value = (value * 1103515245 + 12345) & 0x7fffffff;
    out[index] = value & 0xff;
  }
  return out;
}

export { APP_VERSION, DEFAULT_CHUNK_SIZE, SIGNATURE_ALGORITHM };
