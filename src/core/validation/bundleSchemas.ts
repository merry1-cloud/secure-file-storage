import { z, type ZodType } from 'zod';
import { AppError } from '../errors/AppError';
import type { ErrorCode } from '../errors/codes';
import { base64ByteLength } from '../crypto/encoding';
import { SALT_BYTES, type KdfParams } from '../types/crypto';
import { assertKdfParams } from './limits';

const b64 = (byteLength: number) =>
  z.string().refine((value) => base64ByteLength(value) === byteLength, {
    message: `必须为 ${byteLength} 字节的 Base64`,
  });

const nonEmptyBase64 = z
  .string()
  .min(4)
  .refine((value) => base64ByteLength(value) !== null && base64ByteLength(value)! > 0, {
    message: 'Base64 数据不能为空',
  });

export const kdfParamsSchema = z.discriminatedUnion('algorithm', [
  z
    .object({
      algorithm: z.literal('PBKDF2-HMAC-SHA256'),
      salt: b64(SALT_BYTES),
      iterations: z.number().int(),
      dkLen: z.literal(32),
    })
    .strict(),
  z
    .object({
      algorithm: z.literal('scrypt'),
      salt: b64(SALT_BYTES),
      N: z.number().int(),
      r: z.number().int(),
      p: z.number().int(),
      dkLen: z.literal(32),
    })
    .strict(),
]);

export const publicKeyJwkSchema = z
  .object({
    kty: z.literal('RSA'),
    n: z.string().min(1),
    e: z.string().min(1),
  })
  .passthrough();

export const trustedCertSchema = z
  .object({
    fingerprint: z.string().regex(/^[0-9a-f]{64}$/i),
    subject: z.string().min(1).max(512),
    pem: z.string().min(32),
    addedAt: z.number().int().positive(),
    source: z.enum(['self', 'imported', 'manual']),
  })
  .strict();

export const exportKeyBundleSchema = z
  .object({
    kind: z.literal('sfkey'),
    formatVersion: z.literal(1),
    createdAt: z.number().int().positive(),
    kdf: kdfParamsSchema,
    kcv: b64(32),
    iv: b64(12),
    ciphertext: nonEmptyBase64,
    certPem: z.string().min(32),
    publicKeyJwk: publicKeyJwkSchema,
    certSha256: z.string().regex(/^[0-9a-f]{64}$/i),
  })
  .strict();

export const backupBundleSchema = z
  .object({
    kind: z.literal('sfbackup'),
    formatVersion: z.literal(1),
    createdAt: z.number().int().positive(),
    appVersion: z.string().min(1).max(32),
    kdf: kdfParamsSchema,
    kcv: b64(32),
    iv: b64(12),
    ciphertext: nonEmptyBase64,
    payloadSha256: b64(32),
  })
  .strict();

export const backupPayloadSchema = z
  .object({
    privateKeyPkcs8: nonEmptyBase64,
    publicKeyJwk: publicKeyJwkSchema,
    certPem: z.string().min(32),
    certSha256: z.string().regex(/^[0-9a-f]{64}$/i),
    displayName: z.string().min(1).max(128),
    trustedCerts: z.array(trustedCertSchema).max(100),
  })
  .strict();

export function assertBundleKdf(kdf: KdfParams): void {
  assertKdfParams(kdf);
}

export function parseJsonWithSchema<T>(
  text: string,
  schema: ZodType<T>,
  code: ErrorCode,
  message: string,
): T {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    throw new AppError(code, message, { stage: 'validation', cause: error });
  }
  const result = schema.safeParse(json);
  if (!result.success) {
    throw new AppError(code, message, {
      stage: 'validation',
      details: {
        issues: result.error.issues.slice(0, 8).map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      },
    });
  }
  return result.data;
}
