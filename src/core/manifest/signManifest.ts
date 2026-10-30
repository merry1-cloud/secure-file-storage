import { signBytes, verifyBytes } from '../crypto/rsa';
import type { Manifest } from '../types/manifest';
import { encodeManifest, manifestSigningInput } from './canonicalize';

export interface SignedManifest {
  headerBytes: Uint8Array;
  signature: Uint8Array;
}

export async function signManifest(
  manifest: Manifest,
  privateKey: CryptoKey,
): Promise<SignedManifest> {
  const headerBytes = encodeManifest(manifest);
  const signature = await signBytes(privateKey, manifestSigningInput(headerBytes));
  return { headerBytes, signature };
}

export async function verifyManifestSignature(
  headerBytes: Uint8Array,
  signature: Uint8Array,
  publicKey: CryptoKey,
): Promise<boolean> {
  return verifyBytes(publicKey, signature, manifestSigningInput(headerBytes));
}
