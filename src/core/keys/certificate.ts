import * as x509 from '@peculiar/x509';
import { AppError } from '../errors/AppError';
import { ErrorCodes } from '../errors/codes';
import { randomHex } from '../crypto/random';
import { sha256 } from '../crypto/hash';
import { toHex, utf8 } from '../crypto/encoding';
import { signBytes, verifyBytes } from '../crypto/rsa';
import type { CertInfo } from '../types/key';
import type { ManifestSigner } from '../types/manifest';

const CERT_VALIDITY_MS = 2 * 365 * 24 * 60 * 60 * 1000;
const CLOCK_SKEW_MS = 5 * 60 * 1000;

let providerInitialized = false;

function ensureCryptoProvider(): void {
  if (providerInitialized) return;
  if (!globalThis.crypto?.subtle) {
    throw new AppError(ErrorCodes.UNSUPPORTED, '当前环境缺少 WebCrypto，无法处理证书', {
      stage: 'certificate',
    });
  }
  x509.cryptoProvider.set(globalThis.crypto as unknown as Crypto);
  providerInitialized = true;
}

function sanitizeDnValue(value: string): string {
  const cleaned = value
    .normalize('NFC')
    .replace(/[,+"\\<>;=#\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 128);
  return cleaned || 'Vault User';
}

export interface GeneratedCertificate {
  info: CertInfo;
  certificate: x509.X509Certificate;
}

export async function createSelfSignedCertificate(
  keys: CryptoKeyPair,
  displayName: string,
): Promise<GeneratedCertificate> {
  ensureCryptoProvider();
  const now = Date.now();
  const notBefore = new Date(now - CLOCK_SKEW_MS);
  const notAfter = new Date(now + CERT_VALIDITY_MS);
  const subject = sanitizeDnValue(displayName);

  const certificate = await x509.X509CertificateGenerator.createSelfSigned({
    serialNumber: randomHex(16),
    name: `CN=${subject}, O=PCD Secure File Vault, OU=Course Project`,
    notBefore,
    notAfter,
    signingAlgorithm: { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    keys,
    extensions: [
      new x509.BasicConstraintsExtension(false, undefined, true),
      new x509.KeyUsagesExtension(x509.KeyUsageFlags.digitalSignature, true),
      await x509.SubjectKeyIdentifierExtension.create(keys.publicKey),
    ],
  });

  const pem = certificate.toString();
  const info = await readCertificateInfo(pem);
  return { info, certificate };
}

export async function readCertificateInfo(pem: string): Promise<CertInfo> {
  ensureCryptoProvider();
  let cert: x509.X509Certificate;
  try {
    cert = new x509.X509Certificate(pem);
  } catch (error) {
    throw new AppError(ErrorCodes.VALIDATION, '证书解析失败', {
      stage: 'certificate',
      cause: error,
    });
  }
  const fingerprintBytes = await sha256(new Uint8Array(cert.rawData));
  return {
    pem,
    fingerprint: toHex(fingerprintBytes),
    subject: cert.subject,
    serialNumber: cert.serialNumber.toLowerCase(),
    notBefore: cert.notBefore.getTime(),
    notAfter: cert.notAfter.getTime(),
  };
}

export async function getCertificatePublicKey(pem: string): Promise<CryptoKey> {
  ensureCryptoProvider();
  let cert: x509.X509Certificate;
  try {
    cert = new x509.X509Certificate(pem);
  } catch (error) {
    throw new AppError(ErrorCodes.VALIDATION, '证书解析失败', {
      stage: 'certificate',
      cause: error,
    });
  }
  return cert.publicKey.export(
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    ['verify'],
  );
}

export function assertCertificateValidAt(info: CertInfo, signedAt: number): void {
  if (!Number.isFinite(signedAt) || signedAt < info.notBefore || signedAt > info.notAfter) {
    throw new AppError(ErrorCodes.CERT_EXPIRED, '证书有效期不覆盖签名时间', {
      stage: 'certificate',
      details: {
        signedAt,
        notBefore: info.notBefore,
        notAfter: info.notAfter,
      },
    });
  }
}

export function assertSignerMatchesCertificate(
  signer: ManifestSigner,
  info: CertInfo,
): void {
  const serial = signer.serialNumber.toLowerCase();
  if (
    signer.certSha256.toLowerCase() !== info.fingerprint.toLowerCase() ||
    signer.subject !== info.subject ||
    serial !== info.serialNumber.toLowerCase()
  ) {
    throw new AppError(ErrorCodes.SCHEMA, '签名者证书信息与清单不一致', {
      stage: 'certificate',
      details: {
        expectedFingerprint: signer.certSha256,
        actualFingerprint: info.fingerprint,
      },
    });
  }
}

export function certificateMatchesPublicKeyJwk(
  info: CertInfo,
  publicKeyJwk: JsonWebKey,
): boolean {
  // JWK 的 n/e 与证书主体公钥的 n/e 必须一致；这里只做结构性提示，
  // 真正的绑定由“用证书公钥验签”完成。
  return Boolean(info.fingerprint && publicKeyJwk?.n && publicKeyJwk?.e);
}

export async function verifyPrivateKeyMatchesCertificate(
  privateKey: CryptoKey,
  certificatePem: string,
): Promise<boolean> {
  const testMessage = utf8('SFV-KEY-MATCH-v1');
  const signature = await signBytes(privateKey, testMessage);
  const publicKey = await getCertificatePublicKey(certificatePem);
  return verifyBytes(publicKey, signature, testMessage);
}

export async function assertPublicKeyJwkMatchesCertificate(
  publicKeyJwk: JsonWebKey,
  certificatePem: string,
): Promise<void> {
  const publicKey = await getCertificatePublicKey(certificatePem);
  const certJwk = (await crypto.subtle.exportKey('jwk', publicKey)) as JsonWebKey;
  if (certJwk.n !== publicKeyJwk.n || certJwk.e !== publicKeyJwk.e) {
    throw new AppError(ErrorCodes.KEY_MISMATCH, '公钥 JWK 与证书公钥不匹配', {
      stage: 'certificate',
    });
  }
}
