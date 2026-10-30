import type { KeyringRecord, UnlockedSession } from '../types/key';
import type { KdfProfileId } from '../types/crypto';
import type { StoredFileRecord } from '../storage/schema';
import { AppError } from '../errors/AppError';
import { ErrorCodes } from '../errors/codes';
import {
  cloneKdfParamsWithNewSalt,
  createKdfParams,
  deriveFileKek,
  deriveUnlockMaterial,
  verifyPasswordAndUnlock,
} from '../crypto/kdf';
import { fromBase64, secureZero, toArrayBuffer } from '../crypto/encoding';
import {
  exportPrivateKeyPkcs8,
  importPrivateKeyPkcs8,
} from '../crypto/rsa';
import { unwrapPrivateKey, wrapPrivateKey } from '../envelope/wrapPrivateKey';
import { rewrapDek } from '../envelope/wrapDek';
import { signManifest } from '../manifest/signManifest';
import { computeKeyringIntegrity, verifyKeyringIntegrity } from './keyringIntegrity';
import { readCertificateInfo, verifyPrivateKeyMatchesCertificate } from './certificate';
import { assertPassword } from '../validation/limits';
import { getPrimaryKeyring } from '../storage/repositories/keyRepo';
import { listCommittedFiles } from '../storage/repositories/fileRepo';
import { getDb } from '../storage/db';

export interface ChangePasswordInput {
  oldPassword: string;
  newPassword: string;
  newKdfProfileId?: KdfProfileId;
}

export interface ChangePasswordResult {
  session: UnlockedSession;
  rekeyedFiles: number;
  skippedImportedFiles: number;
}

export async function changeMasterPassword(
  input: ChangePasswordInput,
): Promise<ChangePasswordResult> {
  const record = await getPrimaryKeyring();
  if (!record) {
    throw new AppError(ErrorCodes.NO_VAULT, '尚未创建保管库', { stage: 'validation' });
  }
  const oldMaterial = await verifyPasswordAndUnlock(input.oldPassword, record.kdf, record.kcv);
  if (!(await verifyKeyringIntegrity(oldMaterial.kcvKey, record))) {
    throw new AppError(ErrorCodes.KEY_MISMATCH, '旧密钥环完整性校验失败', {
      stage: 'unwrap',
    });
  }
  const newPassword = assertPassword(input.newPassword);
  const newKdf = input.newKdfProfileId
    ? createKdfParams(input.newKdfProfileId)
    : cloneKdfParamsWithNewSalt(record.kdf);
  const newMaterial = await deriveUnlockMaterial(newPassword, newKdf);

  const oldPrivateKey = await unwrapPrivateKey(
    oldMaterial.keyringKey,
    record.wrappedPrivateKey,
    record.privateKeyIv,
    true,
  );
  const pkcs8 = await exportPrivateKeyPkcs8(oldPrivateKey);
  try {
    if (!(await verifyPrivateKeyMatchesCertificate(oldPrivateKey, record.certPem))) {
      throw new AppError(ErrorCodes.KEY_MISMATCH, '私钥与证书不匹配', {
        stage: 'unwrap',
      });
    }
    const wrappedPrivate = await wrapPrivateKey(newMaterial.keyringKey, pkcs8);
    const signingKey = await importPrivateKeyPkcs8(pkcs8, false);

    const { integrity: _oldIntegrity, ...recordWithoutIntegrity } = record;
    const baseRecord: Omit<KeyringRecord, 'integrity'> = {
      ...recordWithoutIntegrity,
      kdf: newKdf,
      kcv: newMaterial.kcv,
      wrappedPrivateKey: wrappedPrivate.wrappedPrivateKey,
      privateKeyIv: wrappedPrivate.privateKeyIv,
    };
    const integrity = await computeKeyringIntegrity(newMaterial.kcvKey, baseRecord);
    const newRecord: KeyringRecord = { ...baseRecord, integrity };

    const files = await listCommittedFiles();
    const updates: StoredFileRecord[] = [];
    let skippedImportedFiles = 0;

    for (const file of files) {
      if (file.origin === 'imported') {
        skippedImportedFiles += 1;
        continue;
      }
      if (!file.manifest || !file.headerBytes || !file.signature) {
        throw new AppError(ErrorCodes.STORAGE, '本地文件记录缺少清单/签名', {
          stage: 'storage',
          details: { fileId: file.id },
        });
      }
      const fileSalt = fromBase64(file.manifest.fileSalt);
      const oldFileKek = await deriveFileKek(oldMaterial.vmk, fileSalt);
      const newFileKek = await deriveFileKek(newMaterial.vmk, fileSalt);
      const rewrapped = await rewrapDek(
        oldFileKek,
        newFileKek,
        file.manifest.wrappedDek,
        file.manifest.wrapIv,
        file.manifest.fileId,
      );
      const updatedManifest = {
        ...file.manifest,
        kdf: newKdf,
        kcv: newMaterial.kcv,
        wrappedDek: rewrapped.wrappedDek,
        wrapIv: rewrapped.wrapIv,
        signedAt: Date.now(),
      };
      const signed = await signManifest(updatedManifest, signingKey);
      updates.push({
        ...file,
        manifest: updatedManifest,
        headerBytes: toArrayBuffer(signed.headerBytes),
        signature: toArrayBuffer(signed.signature),
        updatedAt: Date.now(),
      });
    }

    const db = await getDb();
    const tx = db.transaction(['files', 'keys'], 'readwrite');
    for (const file of updates) {
      void tx.objectStore('files').put(file);
    }
    void tx.objectStore('keys').put(newRecord);
    await tx.done;

    const cert = await readCertificateInfo(record.certPem);
    const session: UnlockedSession = {
      displayName: record.displayName,
      vmk: newMaterial.vmk,
      keyringKey: newMaterial.keyringKey,
      privateKey: signingKey,
      publicKeyJwk: record.publicKeyJwk,
      cert,
      kdfParams: newKdf,
      kcv: newMaterial.kcv,
    };
    return {
      session,
      rekeyedFiles: updates.length,
      skippedImportedFiles,
    };
  } finally {
    secureZero(pkcs8);
  }
}
