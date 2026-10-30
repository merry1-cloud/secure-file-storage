import { AppError } from '../errors/AppError';
import { ErrorCodes } from '../errors/codes';
import type { CertInfo } from '../types/key';
import type { Manifest } from '../types/manifest';
import type { VerificationReport, VerificationStageResult } from '../types/verification';
import {
  assertCertificateValidAt,
  assertSignerMatchesCertificate,
  getCertificatePublicKey,
  readCertificateInfo,
} from '../keys/certificate';
import { verifyManifestSignature } from '../manifest/signManifest';
import { parseContainer, type ParsedContainer } from './container';
import { ReportBuilder } from './report';

export interface TrustChecker {
  isTrusted(fingerprint: string): boolean | Promise<boolean>;
}

export interface EnvelopeSource {
  manifest: Manifest;
  headerBytes: Uint8Array;
  signature: Uint8Array;
}

export interface VerifiedEnvelope {
  source: EnvelopeSource;
  certInfo: CertInfo;
  publicKey: CryptoKey;
  report: VerificationReport;
}

export interface VerifiedContainer extends VerifiedEnvelope {
  parsed: ParsedContainer;
}

async function verifyEnvelopeWithReport(
  source: EnvelopeSource,
  trust: TrustChecker,
  report: ReportBuilder,
): Promise<VerifiedEnvelope> {
  const certificate = await report.run('certificate', async () => {
    const info = await readCertificateInfo(source.manifest.signer.certPem);
    assertSignerMatchesCertificate(source.manifest.signer, info);
    assertCertificateValidAt(info, source.manifest.signedAt);
    const trusted = await trust.isTrusted(info.fingerprint);
    if (!trusted) {
      throw new AppError(ErrorCodes.CERT_UNTRUSTED, '签名者证书未受信任', {
        stage: 'certificate',
        details: {
          fingerprint: info.fingerprint,
          subject: info.subject,
          serialNumber: info.serialNumber,
          notBefore: info.notBefore,
          notAfter: info.notAfter,
          certPem: info.pem,
        },
      });
    }
    const publicKey = await getCertificatePublicKey(info.pem);
    return { info, publicKey };
  });

  await report.run('signature', async () => {
    const valid = await verifyManifestSignature(
      source.headerBytes,
      source.signature,
      certificate.publicKey,
    );
    if (!valid) {
      throw new AppError(ErrorCodes.SIGNATURE, 'RSA 签名验证失败', {
        stage: 'signature',
      });
    }
  });

  return {
    source,
    certInfo: certificate.info,
    publicKey: certificate.publicKey,
    report: report.finish('容器解析、证书信任与 RSA 签名验证通过'),
  };
}

export async function verifyEnvelope(
  source: EnvelopeSource,
  trust: TrustChecker,
  initialStages: VerificationStageResult[] = [],
): Promise<VerifiedEnvelope> {
  return verifyEnvelopeWithReport(source, trust, new ReportBuilder(initialStages));
}

export async function verifyParsedContainer(
  parsed: ParsedContainer,
  trust: TrustChecker,
  report: ReportBuilder = new ReportBuilder(),
): Promise<VerifiedContainer> {
  const verified = await verifyEnvelopeWithReport(parsed, trust, report);
  return { ...verified, parsed };
}

export async function verifyContainer(
  input: Blob | Uint8Array,
  trust: TrustChecker,
  initialStages: VerificationStageResult[] = [],
): Promise<VerifiedContainer> {
  const report = new ReportBuilder(initialStages);
  const parsed = await report.run('parse', () => parseContainer(input));
  const verified = await verifyEnvelopeWithReport(parsed, trust, report);
  return { ...verified, parsed };
}
