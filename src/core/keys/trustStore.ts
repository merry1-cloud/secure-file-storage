import type { CertInfo, TrustSource, TrustedCert } from '../types/key';
import {
  addTrustedCert,
  getTrustedCert,
  isTrustedCert,
  listTrustedCerts,
  removeTrustedCert,
} from '../storage/repositories/trustRepo';

export async function trustCertificate(
  info: CertInfo,
  source: TrustSource,
): Promise<TrustedCert> {
  const record: TrustedCert = {
    fingerprint: info.fingerprint.toLowerCase(),
    subject: info.subject,
    pem: info.pem,
    addedAt: Date.now(),
    source,
  };
  await addTrustedCert(record);
  return record;
}

export async function isCertificateTrusted(fingerprint: string): Promise<boolean> {
  return isTrustedCert(fingerprint);
}

export async function getTrustedCertificate(
  fingerprint: string,
): Promise<TrustedCert | undefined> {
  return getTrustedCert(fingerprint);
}

export async function listTrustedCertificates(): Promise<TrustedCert[]> {
  return listTrustedCerts();
}

export async function untrustCertificate(fingerprint: string): Promise<void> {
  await removeTrustedCert(fingerprint);
}
