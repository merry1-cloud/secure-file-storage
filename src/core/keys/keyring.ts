import type {
  CertInfo,
  CreateVaultInput,
  KeyringRecord,
  PublicKeyringInfo,
  TrustedCert,
  UnlockedSession,
} from '../types/key';
import type { KdfProfileId } from '../types/crypto';
import { AppError } from '../errors/AppError';
import { ErrorCodes } from '../errors/codes';
import { secureZero } from '../crypto/encoding';
import { createKdfParams, deriveUnlockMaterial, verifyPasswordAndUnlock } from '../crypto/kdf';
import {
  exportPrivateKeyPkcs8,
  exportPublicKeyJwk,
  generateRsaKeyPair,
  importPrivateKeyPkcs8,
} from '../crypto/rsa';
import {
  createSelfSignedCertificate,
  readCertificateInfo,
  verifyPrivateKeyMatchesCertificate,
} from './certificate';
import { unwrapPrivateKey, wrapPrivateKey } from '../envelope/wrapPrivateKey';
import { computeKeyringIntegrity, verifyKeyringIntegrity } from './keyringIntegrity';
import { assertPassword, sanitizeFilename } from '../validation/limits';
import {
  getPrimaryKeyring,
  savePrimaryKeyring,
} from '../storage/repositories/keyRepo';
import {
  addTrustedCert,
  removeTrustedCert,
} from '../storage/repositories/trustRepo';

function sanitizeDisplayName(value: string): string {
  return (
    value
      .normalize('NFC')
      .replace(/[\u0000-\u001f\u007f]/g, ' ')
      .trim()
      .slice(0, 64) || 'Vault User'
  );
}

function sessionFromRecord(
  record: KeyringRecord,
  vmk: CryptoKey,
  keyringKey: CryptoKey,
  privateKey: CryptoKey,
  cert: CertInfo,
): UnlockedSession {
  return {
    displayName: record.displayName,
    vmk,
    keyringKey,
    privateKey,
    publicKeyJwk: record.publicKeyJwk,
    cert,
    kdfParams: record.kdf,
    kcv: record.kcv,
  };
}

export async function createVault(input: CreateVaultInput): Promise<UnlockedSession> {
  const existing = await getPrimaryKeyring();
  if (existing) {
    throw new AppError(ErrorCodes.VALIDATION, '保管库已存在，请先解锁', {
      stage: 'validation',
    });
  }

  const password = assertPassword(input.password);
  const displayName = sanitizeDisplayName(input.displayName);
  const kdf = createKdfParams(input.kdfProfileId);
  const material = await deriveUnlockMaterial(password, kdf);
  const keyPair = await generateRsaKeyPair();
  const generatedCert = await createSelfSignedCertificate(keyPair, displayName);
  if (!(await verifyPrivateKeyMatchesCertificate(keyPair.privateKey, generatedCert.info.pem))) {
    throw new AppError(ErrorCodes.KEY_MISMATCH, '新生成的私钥与证书不匹配', {
      stage: 'certificate',
    });
  }
  const publicKeyJwk = await exportPublicKeyJwk(keyPair.publicKey);
  const pkcs8 = await exportPrivateKeyPkcs8(keyPair.privateKey);

  try {
    const wrapped = await wrapPrivateKey(material.keyringKey, pkcs8);
    const baseRecord: Omit<KeyringRecord, 'integrity'> = {
      id: 'primary',
      version: 1,
      displayName,
      publicKeyJwk,
      certPem: generatedCert.info.pem,
      certFingerprint: generatedCert.info.fingerprint,
      certSubject: generatedCert.info.subject,
      certSerialNumber: generatedCert.info.serialNumber,
      certNotBefore: generatedCert.info.notBefore,
      certNotAfter: generatedCert.info.notAfter,
      wrappedPrivateKey: wrapped.wrappedPrivateKey,
      privateKeyIv: wrapped.privateKeyIv,
      kdf,
      kcv: material.kcv,
      createdAt: Date.now(),
    };
    const integrity = await computeKeyringIntegrity(material.kcvKey, baseRecord);
    const record: KeyringRecord = { ...baseRecord, integrity };

    await addTrustedCert({
      fingerprint: generatedCert.info.fingerprint,
      subject: generatedCert.info.subject,
      pem: generatedCert.info.pem,
      addedAt: Date.now(),
      source: 'self',
    });
    try {
      await savePrimaryKeyring(record);
    } catch (error) {
      await removeTrustedCert(generatedCert.info.fingerprint).catch(() => undefined);
      throw error;
    }

    const privateKey = await importPrivateKeyPkcs8(pkcs8, false);
    return sessionFromRecord(record, material.vmk, material.keyringKey, privateKey, generatedCert.info);
  } finally {
    secureZero(pkcs8);
  }
}

export async function unlockVault(password: string): Promise<UnlockedSession> {
  const record = await getPrimaryKeyring();
  if (!record) {
    throw new AppError(ErrorCodes.NO_VAULT, '尚未创建保管库', { stage: 'password' });
  }
  const material = await verifyPasswordAndUnlock(password, record.kdf, record.kcv);

  const integrityOk = await verifyKeyringIntegrity(material.kcvKey, record);
  if (!integrityOk) {
    throw new AppError(ErrorCodes.KEY_MISMATCH, '密钥环完整性校验失败，本地密钥数据可能被替换', {
      stage: 'unwrap',
    });
  }

  const cert = await readCertificateInfo(record.certPem);
  if (cert.fingerprint.toLowerCase() !== record.certFingerprint.toLowerCase()) {
    throw new AppError(ErrorCodes.KEY_MISMATCH, '证书指纹与密钥环记录不一致', {
      stage: 'certificate',
    });
  }

  const privateKey = await unwrapPrivateKey(
    material.keyringKey,
    record.wrappedPrivateKey,
    record.privateKeyIv,
    false,
  );
  const matches = await verifyPrivateKeyMatchesCertificate(privateKey, record.certPem);
  if (!matches) {
    throw new AppError(ErrorCodes.KEY_MISMATCH, '私钥与证书公钥不匹配', {
      stage: 'unwrap',
    });
  }

  return sessionFromRecord(record, material.vmk, material.keyringKey, privateKey, cert);
}

export async function loadPublicKeyringInfo(): Promise<PublicKeyringInfo | undefined> {
  const record = await getPrimaryKeyring();
  if (!record) return undefined;
  const cert = await readCertificateInfo(record.certPem);
  return {
    displayName: record.displayName,
    publicKeyJwk: record.publicKeyJwk,
    cert,
    kdfParams: record.kdf,
    createdAt: record.createdAt,
  };
}

export async function getKeyringRecord(): Promise<KeyringRecord | undefined> {
  return getPrimaryKeyring();
}

export interface InstallRestoredKeyInput {
  pkcs8: Uint8Array;
  certInfo: CertInfo;
  publicKeyJwk: JsonWebKey;
  displayName: string;
  password: string;
  kdfProfileId: KdfProfileId;
  trustedCerts?: TrustedCert[];
}

/**
 * 用于“新浏览器/无保管库”恢复备份：用备份中的私钥和证书建立新保管库。
 */
export async function installRestoredKey(
  input: InstallRestoredKeyInput,
): Promise<UnlockedSession> {
  const existing = await getPrimaryKeyring();
  if (existing) {
    throw new AppError(ErrorCodes.VALIDATION, '已存在保管库，请在密钥管理中恢复', {
      stage: 'validation',
    });
  }
  const password = assertPassword(input.password);
  const displayName = sanitizeDisplayName(input.displayName);
  const kdf = createKdfParams(input.kdfProfileId);
  const material = await deriveUnlockMaterial(password, kdf);
  try {
    const wrapped = await wrapPrivateKey(material.keyringKey, input.pkcs8);
    const baseRecord: Omit<KeyringRecord, 'integrity'> = {
      id: 'primary',
      version: 1,
      displayName,
      publicKeyJwk: input.publicKeyJwk,
      certPem: input.certInfo.pem,
      certFingerprint: input.certInfo.fingerprint,
      certSubject: input.certInfo.subject,
      certSerialNumber: input.certInfo.serialNumber,
      certNotBefore: input.certInfo.notBefore,
      certNotAfter: input.certInfo.notAfter,
      wrappedPrivateKey: wrapped.wrappedPrivateKey,
      privateKeyIv: wrapped.privateKeyIv,
      kdf,
      kcv: material.kcv,
      createdAt: Date.now(),
    };
    const integrity = await computeKeyringIntegrity(material.kcvKey, baseRecord);
    const record: KeyringRecord = { ...baseRecord, integrity };

    await addTrustedCert({
      fingerprint: input.certInfo.fingerprint,
      subject: input.certInfo.subject,
      pem: input.certInfo.pem,
      addedAt: Date.now(),
      source: 'imported',
    });
    for (const trusted of input.trustedCerts ?? []) {
      await addTrustedCert(trusted);
    }
    await savePrimaryKeyring(record);
    const privateKey = await importPrivateKeyPkcs8(input.pkcs8, false);
    return sessionFromRecord(record, material.vmk, material.keyringKey, privateKey, input.certInfo);
  } finally {
    secureZero(input.pkcs8);
  }
}

export async function replaceSigningKeyWithRestored(
  currentPassword: string,
  restored: {
    pkcs8: Uint8Array;
    certInfo: CertInfo;
    publicKeyJwk: JsonWebKey;
    displayName: string;
    trustedCerts?: TrustedCert[];
  },
): Promise<UnlockedSession> {
  const record = await getPrimaryKeyring();
  if (!record) {
    throw new AppError(ErrorCodes.NO_VAULT, '尚未创建保管库', { stage: 'password' });
  }
  const material = await verifyPasswordAndUnlock(currentPassword, record.kdf, record.kcv);
  const integrityOk = await verifyKeyringIntegrity(material.kcvKey, record);
  if (!integrityOk) {
    throw new AppError(ErrorCodes.KEY_MISMATCH, '当前密钥环完整性校验失败', {
      stage: 'unwrap',
    });
  }
  try {
    const wrapped = await wrapPrivateKey(material.keyringKey, restored.pkcs8);
    const baseRecord: Omit<KeyringRecord, 'integrity'> = {
      ...record,
      displayName: sanitizeDisplayName(restored.displayName || record.displayName),
      publicKeyJwk: restored.publicKeyJwk,
      certPem: restored.certInfo.pem,
      certFingerprint: restored.certInfo.fingerprint,
      certSubject: restored.certInfo.subject,
      certSerialNumber: restored.certInfo.serialNumber,
      certNotBefore: restored.certInfo.notBefore,
      certNotAfter: restored.certInfo.notAfter,
      wrappedPrivateKey: wrapped.wrappedPrivateKey,
      privateKeyIv: wrapped.privateKeyIv,
      createdAt: Date.now(),
    };
    const integrity = await computeKeyringIntegrity(material.kcvKey, baseRecord);
    const newRecord: KeyringRecord = { ...baseRecord, integrity };
    await addTrustedCert({
      fingerprint: restored.certInfo.fingerprint,
      subject: restored.certInfo.subject,
      pem: restored.certInfo.pem,
      addedAt: Date.now(),
      source: 'imported',
    });
    for (const trusted of restored.trustedCerts ?? []) {
      await addTrustedCert(trusted);
    }
    await savePrimaryKeyring(newRecord);
    const privateKey = await importPrivateKeyPkcs8(restored.pkcs8, false);
    return sessionFromRecord(
      newRecord,
      material.vmk,
      material.keyringKey,
      privateKey,
      restored.certInfo,
    );
  } finally {
    secureZero(restored.pkcs8);
  }
}

/** 用于测试/界面显示：确保文件名清洗逻辑一致。 */
export function normalizedDisplayName(name: string): string {
  return sanitizeFilename(name);
}
