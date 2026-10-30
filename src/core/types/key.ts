import type { KdfParams } from './crypto';

export interface CertInfo {
  pem: string;
  fingerprint: string;
  subject: string;
  serialNumber: string;
  notBefore: number;
  notAfter: number;
}

export interface KeyringRecord {
  id: 'primary';
  version: 1;
  displayName: string;
  publicKeyJwk: JsonWebKey;
  certPem: string;
  certFingerprint: string;
  certSubject: string;
  certSerialNumber: string;
  certNotBefore: number;
  certNotAfter: number;
  wrappedPrivateKey: ArrayBuffer;
  privateKeyIv: ArrayBuffer;
  kdf: KdfParams;
  kcv: string;
  /** HMAC(KCVKey, 域分离标签 || 规范化密钥环字段)，防止本地存储被静默替换。 */
  integrity: string;
  createdAt: number;
}

export interface PublicKeyringInfo {
  displayName: string;
  publicKeyJwk: JsonWebKey;
  cert: CertInfo;
  kdfParams: KdfParams;
  createdAt: number;
}

export interface UnlockedSession {
  displayName: string;
  vmk: CryptoKey;
  keyringKey: CryptoKey;
  privateKey: CryptoKey;
  publicKeyJwk: JsonWebKey;
  cert: CertInfo;
  kdfParams: KdfParams;
  kcv: string;
}

export type TrustSource = 'self' | 'imported' | 'manual';

export interface TrustedCert {
  fingerprint: string;
  subject: string;
  pem: string;
  addedAt: number;
  source: TrustSource;
}

export interface CreateVaultInput {
  displayName: string;
  password: string;
  kdfProfileId: import('./crypto').KdfProfileId;
}

export interface PrivateKeyExportBundle {
  kind: 'sfkey';
  formatVersion: 1;
  createdAt: number;
  kdf: KdfParams;
  kcv: string;
  iv: string;
  ciphertext: string;
  certPem: string;
  publicKeyJwk: JsonWebKey;
  certSha256: string;
}

export interface BackupPayload {
  privateKeyPkcs8: string;
  publicKeyJwk: JsonWebKey;
  certPem: string;
  certSha256: string;
  displayName: string;
  trustedCerts: TrustedCert[];
}

export interface BackupBundle {
  kind: 'sfbackup';
  formatVersion: 1;
  createdAt: number;
  appVersion: string;
  kdf: KdfParams;
  kcv: string;
  iv: string;
  ciphertext: string;
  payloadSha256: string;
}
