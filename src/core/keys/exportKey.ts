import type { CertInfo, PrivateKeyExportBundle } from '../types/key';
import type { KdfParams } from '../types/crypto';
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
  fromBase64,
  secureZero,
  toBase64,
  utf8,
} from '../crypto/encoding';
import { randomBytes } from '../crypto/random';
import { GCM_IV_LENGTH_BYTES } from '../types/crypto';
import { decryptAesGcm, encryptAesGcm } from '../crypto/aesGcm';
import { verifyKcv } from '../crypto/keyCheck';
import {
  exportPrivateKeyPkcs8,
  importPrivateKeyPkcs8,
} from '../crypto/rsa';
import { getPrimaryKeyring } from '../storage/repositories/keyRepo';
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
  exportKeyBundleSchema,
  parseJsonWithSchema,
} from '../validation/bundleSchemas';

function exportAad(certFingerprint: string): Uint8Array {
  return concatBytes(utf8(DOMAINS.exportKeyAad), utf8(certFingerprint.toLowerCase()));
}

export interface CreatePrivateKeyExportInput {
  masterPassword: string;
  exportPassphrase: string;
}

export async function createPrivateKeyExport(
  input: CreatePrivateKeyExportInput,
): Promise<PrivateKeyExportBundle> {
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
  const exportPassphrase = assertStrongPassphrase(input.exportPassphrase);
  const privateKey = await unwrapPrivateKey(
    material.keyringKey,
    record.wrappedPrivateKey,
    record.privateKeyIv,
    true,
  );
  const pkcs8 = await exportPrivateKeyPkcs8(privateKey);
  try {
    const exportKdf: KdfParams = createKdfParams('pbkdf2-standard');
    assertBundleKdf(exportKdf);
    const keys = await derivePassphraseKeys(
      exportPassphrase,
      exportKdf,
      DOMAINS.exportKeyAesInfo,
      DOMAINS.exportKeyKcvInfo,
    );
    const iv = randomBytes(GCM_IV_LENGTH_BYTES);
    const ciphertext = await encryptAesGcm(
      keys.aesKey,
      iv,
      pkcs8,
      exportAad(record.certFingerprint),
    );
    return {
      kind: 'sfkey',
      formatVersion: 1,
      createdAt: Date.now(),
      kdf: exportKdf,
      kcv: keys.kcv,
      iv: toBase64(iv),
      ciphertext: toBase64(ciphertext),
      certPem: record.certPem,
      publicKeyJwk: record.publicKeyJwk,
      certSha256: record.certFingerprint.toLowerCase(),
    };
  } finally {
    secureZero(pkcs8);
  }
}

export interface ImportedPrivateKeyMaterial {
  pkcs8: Uint8Array;
  certInfo: CertInfo;
  publicKeyJwk: JsonWebKey;
}

export async function importPrivateKeyExport(
  bundleText: string,
  exportPassphrase: string,
): Promise<ImportedPrivateKeyMaterial> {
  const bundle = parseJsonWithSchema(
    bundleText,
    exportKeyBundleSchema,
    ErrorCodes.SCHEMA,
    '私钥导出文件格式不合法',
  );
  assertBundleKdf(bundle.kdf as KdfParams);
  const certInfo = await readCertificateInfo(bundle.certPem);
  if (certInfo.fingerprint.toLowerCase() !== bundle.certSha256.toLowerCase()) {
    throw new AppError(ErrorCodes.KEY_MISMATCH, '导出文件中的证书指纹不匹配', {
      stage: 'certificate',
    });
  }

  const keys = await derivePassphraseKeys(
    exportPassphrase,
    bundle.kdf as KdfParams,
    DOMAINS.exportKeyAesInfo,
    DOMAINS.exportKeyKcvInfo,
  );
  if (!verifyKcv(bundle.kcv, keys.kcv)) {
    throw new AppError(ErrorCodes.WRONG_EXPORT_PASSPHRASE, '私钥导出口令错误', {
      stage: 'password',
    });
  }

  let pkcs8: Uint8Array;
  try {
    pkcs8 = await decryptAesGcm(
      keys.aesKey,
      fromBase64(bundle.iv),
      fromBase64(bundle.ciphertext),
      exportAad(bundle.certSha256),
    );
  } catch (error) {
    throw new AppError(ErrorCodes.SCHEMA, '私钥导出文件已损坏或被篡改', {
      stage: 'unwrap',
      cause: error,
    });
  }

  try {
    const privateKey = await importPrivateKeyPkcs8(pkcs8, true);
    const matches = await verifyPrivateKeyMatchesCertificate(privateKey, bundle.certPem);
    if (!matches) {
      throw new AppError(ErrorCodes.KEY_MISMATCH, '私钥与证书公钥不匹配', {
        stage: 'unwrap',
      });
    }
    const publicKeyJwk = bundle.publicKeyJwk as JsonWebKey;
    await assertPublicKeyJwkMatchesCertificate(publicKeyJwk, bundle.certPem);
    return { pkcs8, certInfo, publicKeyJwk };
  } catch (error) {
    secureZero(pkcs8);
    throw error;
  }
}
