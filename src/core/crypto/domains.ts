/**
 * 所有 KDF/HKDF/AAD 的域分离标签集中在这里，避免不同用途复用同一输入。
 */
export const DOMAINS = {
  manifest: 'SFV-MANIFEST-v1\n',
  dekWrap: 'SFV-DEK-v1',
  chunk: 'SFV-CHUNK-v1',
  keyringWrap: 'SFV-RSA-PRIV-v1',
  vmkInfo: 'SFV-VMK-v1',
  keyringKdfInfo: 'SFV-KEYRING-v1',
  fileKekInfo: 'SFV-FILE-KEK-v1',
  kcvKeyInfo: 'SFV-KCV-KEY-v1',
  kcvValue: 'SFV-KCV-VALUE-v1',
  keyringIntegrity: 'SFV-KEYRING-INTEGRITY-v1',
  exportKeyAesInfo: 'SFV-EXPORT-KEY-AES-v1',
  exportKeyKcvInfo: 'SFV-EXPORT-KEY-KCV-v1',
  exportKeyAad: 'SFV-EXPORT-KEY-v1',
  backupAesInfo: 'SFV-BACKUP-AES-v1',
  backupKcvInfo: 'SFV-BACKUP-KCV-v1',
  backupAad: 'SFV-BACKUP-v1',
} as const;
