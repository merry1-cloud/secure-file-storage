import type {
  BackupBundle,
  BackupPayload,
  CertInfo,
  TrustedCert,
} from '../types/key';
import type { KdfParams } from '../types/crypto';
import { APP_VERSION, GCM_IV_LENGTH_BYTES } from '../types/crypto';
import { AppError } from '../errors/AppError';
import { ErrorCodes } from '../errors/codes';
import {
  createKdfParams,
  derivePassphraseKeys,
  verifyPasswordAndUnlock,
} from '../crypto/kdf';
import { DOMAINS } from '../crypto/domains';
import {
  concatBytes,
  constantTimeEqual,
  fromBase64,
  secureZero,
  toBase64,
  utf8,
} from '../crypto/encoding';
import { randomBytes } from '../crypto/random';
import { decryptAesGcm, encryptAesGcm } from '../crypto/aesGcm';
import { sha256 } from '../crypto/hash';
import { verifyKcv } from '../crypto/keyCheck';
import {
  exportPrivateKeyPkcs8,
  importPrivateKeyPkcs8,
} from '../crypto/rsa';
import { canonicalJson, type JsonValue } from '../manifest/canonicalize';
import { getPrimaryKeyring } from '../storage/repositories/keyRepo';
import { listTrustedCerts } from '../storage/repositories/trustRepo';
import { verifyKeyringIntegrity } from './keyringIntegrity';
import { unwrapPrivateKey } from '../envelope/wrapPrivateKey';
import {
  assertPublicKeyJwkMatchesCertificate,
  readCertificateInfo,
  verifyPrivateKeyMatchesCertificate,
} from './certificate';
import { assertStrongPassphrase } from '../validation/passwordPolicy';
import {
  assertBundleKdf,
  backupBundleSchema,
  backupPayloadSchema,
  parseJsonWithSchema,
} from '../validation/bundleSchemas';

function backupAad(payloadSha256: string): Uint8Array {
  return concatBytes(utf8(DOMAINS.backupAad), utf8(payloadSha256));
}

function payloadBytes(payload: BackupPayload): Uint8Array {
  return utf8(canonicalJson(payload as unknown as JsonValue));
}

export interface CreateBackupInput {
  masterPassword: string;
  backupPassphrase: string;
}

export async function createBackup(input: CreateBackupInput): Promise<BackupBundle> {
  const record = await getPrimaryKeyring();
  if (!record) {
    throw new AppError(ErrorCodes.NO_VAULT, '尚未创建保管库', { stage: 'validation' });
  }
  const material = await verifyPasswordAndUnlock(
    input.masterPassword,
    record.kdf,
    record.kcv,
  );
  if (!(await verifyKeyringIntegrity(material.kcvKey, record))) {
    throw new AppError(ErrorCodes.KEY_MISMATCH, '密钥环完整性校验失败', {
      stage: 'unwrap',
    });
  }
  const backupPassphrase = assertStrongPassphrase(input.backupPassphrase);
  const privateKey = await unwrapPrivateKey(
    material.keyringKey,
    record.wrappedPrivateKey,
    record.privateKeyIv,
    true,
  );
  const pkcs8 = await exportPrivateKeyPkcs8(privateKey);
  const trustedCerts = await listTrustedCerts();
  const payload: BackupPayload = {
    privateKeyPkcs8: toBase64(pkcs8),
    publicKeyJwk: record.publicKeyJwk,
    certPem: record.certPem,
    certSha256: record.certFingerprint.toLowerCase(),
    displayName: record.displayName,
    trustedCerts,
  };
  const plaintext = payloadBytes(payload);
  try {
    const digest = await sha256(plaintext);
    const payloadSha256 = toBase64(digest);
    const backupKdf: KdfParams = createKdfParams('pbkdf2-standard');
    assertBundleKdf(backupKdf);
    const keys = await derivePassphraseKeys(
      backupPassphrase,
      backupKdf,
      DOMAINS.backupAesInfo,
      DOMAINS.backupKcvInfo,
    );
    const iv = randomBytes(GCM_IV_LENGTH_BYTES);
    const ciphertext = await encryptAesGcm(
      keys.aesKey,
      iv,
      plaintext,
      backupAad(payloadSha256),
    );
    return {
      kind: 'sfbackup',
      formatVersion: 1,
      createdAt: Date.now(),
      appVersion: APP_VERSION,
      kdf: backupKdf,
      kcv: keys.kcv,
      iv: toBase64(iv),
      ciphertext: toBase64(ciphertext),
      payloadSha256,
    };
  } finally {
    secureZero(pkcs8);
    secureZero(plaintext);
  }
}

export interface RestoredBackupMaterial {
  pkcs8: Uint8Array;
  certInfo: CertInfo;
  publicKeyJwk: JsonWebKey;
  displayName: string;
  trustedCerts: TrustedCert[];
}

export async function restoreBackup(
  bundleText: string,
  backupPassphrase: string,
): Promise<RestoredBackupMaterial> {
  const bundle = parseJsonWithSchema(
    bundleText,
    backupBundleSchema,
    ErrorCodes.BACKUP_PARSE,
    '备份文件格式不合法',
  );
  assertBundleKdf(bundle.kdf as KdfParams);

  const keys = await derivePassphraseKeys(
    backupPassphrase,
    bundle.kdf as KdfParams,
    DOMAINS.backupAesInfo,
    DOMAINS.backupKcvInfo,
  );
  if (!verifyKcv(bundle.kcv, keys.kcv)) {
    throw new AppError(ErrorCodes.WRONG_BACKUP_PASSPHRASE, '备份口令错误', {
      stage: 'password',
    });
  }

  let plaintext: Uint8Array;
  try {
    plaintext = await decryptAesGcm(
      keys.aesKey,
      fromBase64(bundle.iv),
      fromBase64(bundle.ciphertext),
      backupAad(bundle.payloadSha256),
    );
  } catch (error) {
    throw new AppError(ErrorCodes.BACKUP_PARSE, '备份文件已损坏或被篡改', {
      stage: 'unwrap',
      cause: error,
    });
  }

  try {
    let text: string;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(plaintext);
    } catch (error) {
      throw new AppError(ErrorCodes.BACKUP_PARSE, '备份载荷不是合法 UTF-8', {
        stage: 'parse',
        cause: error,
      });
    }

    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch (error) {
      throw new AppError(ErrorCodes.BACKUP_PARSE, '备份载荷不是合法 JSON', {
        stage: 'parse',
        cause: error,
      });
    }
    const parsed = backupPayloadSchema.safeParse(json);
    if (!parsed.success) {
      throw new AppError(ErrorCodes.BACKUP_PARSE, '备份载荷字段不合法', {
        stage: 'parse',
        details: {
          issues: parsed.error.issues.slice(0, 8).map((issue) => ({
            path: issue.path.join('.'),
            message: issue.message,
          })),
        },
      });
    }
    const payload = parsed.data as unknown as BackupPayload;
    const canonical = payloadBytes(payload);
    try {
      const actualHash = await sha256(canonical);
      if (!constantTimeEqual(actualHash, fromBase64(bundle.payloadSha256))) {
        throw new AppError(ErrorCodes.BACKUP_PARSE, '备份载荷校验失败', {
          stage: 'integrity',
        });
      }
    } finally {
      secureZero(canonical);
    }

    const certInfo = await readCertificateInfo(payload.certPem);
    if (certInfo.fingerprint.toLowerCase() !== payload.certSha256.toLowerCase()) {
      throw new AppError(ErrorCodes.KEY_MISMATCH, '备份中的证书指纹不匹配', {
        stage: 'certificate',
      });
    }
    const pkcs8 = fromBase64(payload.privateKeyPkcs8);
    try {
      const privateKey = await importPrivateKeyPkcs8(pkcs8, true);
      if (!(await verifyPrivateKeyMatchesCertificate(privateKey, payload.certPem))) {
        throw new AppError(ErrorCodes.KEY_MISMATCH, '备份私钥与证书不匹配', {
          stage: 'unwrap',
        });
      }
      await assertPublicKeyJwkMatchesCertificate(
        payload.publicKeyJwk as JsonWebKey,
        payload.certPem,
      );
      return {
        pkcs8,
        certInfo,
        publicKeyJwk: payload.publicKeyJwk as JsonWebKey,
        displayName: payload.displayName,
        trustedCerts: payload.trustedCerts as TrustedCert[],
      };
    } catch (error) {
      secureZero(pkcs8);
      throw error;
    }
  } finally {
    secureZero(plaintext);
  }
}
