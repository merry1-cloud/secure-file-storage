import type {
  CipherAlgorithm,
  HashAlgorithm,
  KdfParams,
  SignatureAlgorithm,
} from './crypto';

export interface ManifestSigner {
  subject: string;
  serialNumber: string;
  certPem: string;
  certSha256: string;
}

export interface ManifestCipher {
  alg: CipherAlgorithm;
  keyBits: 128 | 256;
  chunkSize: number;
  chunkCount: number;
  fileNonce: string;
}

export interface ManifestHash {
  alg: HashAlgorithm;
  contentHash: string;
}

export interface Manifest {
  formatVersion: 1;
  fileId: string;
  filename: string;
  mime: string;
  size: number;
  createdAt: number;
  signedAt: number;
  cipher: ManifestCipher;
  hash: ManifestHash;
  kdf: KdfParams;
  fileSalt: string;
  kcv: string;
  wrappedDek: string;
  wrapIv: string;
  signer: ManifestSigner;
  signatureAlg: SignatureAlgorithm;
  appVersion: string;
}
