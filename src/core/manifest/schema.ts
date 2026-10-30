import { z } from 'zod';
import {
  CIPHER_KEY_BITS,
  DEFAULT_CHUNK_SIZE,
  HASH_BYTES,
  MAX_CHUNK_COUNT,
  MAX_FILE_BYTES,
  SALT_BYTES,
  type CipherAlgorithm,
  type HashAlgorithm,
} from '../types/crypto';
import type { Manifest } from '../types/manifest';
import { AppError } from '../errors/AppError';
import { ErrorCodes } from '../errors/codes';
import { base64ByteLength } from '../crypto/encoding';
import { assertKdfParams } from '../validation/limits';

const b64 = (byteLength: number) =>
  z.string().refine((value) => base64ByteLength(value) === byteLength, {
    message: `必须为 ${byteLength} 字节的 Base64`,
  });

const hex = (length: number) =>
  z.string().regex(new RegExp(`^[0-9a-fA-F]{${length}}$`), {
    message: `必须为 ${length} 位十六进制`,
  });

const pbkdf2Schema = z
  .object({
    algorithm: z.literal('PBKDF2-HMAC-SHA256'),
    salt: b64(SALT_BYTES),
    iterations: z.number().int(),
    dkLen: z.literal(32),
  })
  .strict();

const scryptSchema = z
  .object({
    algorithm: z.literal('scrypt'),
    salt: b64(SALT_BYTES),
    N: z.number().int(),
    r: z.number().int(),
    p: z.number().int(),
    dkLen: z.literal(32),
  })
  .strict();

const kdfSchema = z.discriminatedUnion('algorithm', [pbkdf2Schema, scryptSchema]);

const signerSchema = z
  .object({
    subject: z.string().min(1).max(512),
    serialNumber: z.string().regex(/^[0-9a-fA-F]{1,128}$/),
    certPem: z
      .string()
      .min(32)
      .max(8192)
      .refine((value) => value.includes('BEGIN CERTIFICATE'), {
        message: '证书 PEM 格式不合法',
      }),
    certSha256: hex(64),
  })
  .strict();

const cipherSchema = z
  .object({
    alg: z.enum(['AES-256-GCM', 'AES-128-GCM']),
    keyBits: z.union([z.literal(128), z.literal(256)]),
    chunkSize: z.literal(DEFAULT_CHUNK_SIZE),
    chunkCount: z.number().int().min(0).max(MAX_CHUNK_COUNT),
    fileNonce: b64(8),
  })
  .strict();

const hashSchema = z
  .object({
    alg: z.enum(['SHA-256', 'SHA-1']),
    contentHash: z.string(),
  })
  .strict();

export const manifestSchema = z
  .object({
    formatVersion: z.literal(1),
    fileId: z.string().uuid(),
    filename: z.string().min(1).max(200),
    mime: z.string().max(255),
    size: z.number().int().min(0).max(MAX_FILE_BYTES),
    createdAt: z.number().int().positive().max(8.64e15),
    signedAt: z.number().int().positive().max(8.64e15),
    cipher: cipherSchema,
    hash: hashSchema,
    kdf: kdfSchema,
    fileSalt: b64(SALT_BYTES),
    kcv: b64(32),
    wrappedDek: z.string(),
    wrapIv: b64(12),
    signer: signerSchema,
    signatureAlg: z.literal('RSASSA-PKCS1-v1_5-SHA-256'),
    appVersion: z.string().min(1).max(32),
  })
  .strict()
  .superRefine((manifest, ctx) => {
    const expectedBits = CIPHER_KEY_BITS[manifest.cipher.alg as CipherAlgorithm];
    if (manifest.cipher.keyBits !== expectedBits) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: '密钥位数与算法不匹配' });
    }
    const expectedChunks =
      manifest.size === 0 ? 0 : Math.ceil(manifest.size / manifest.cipher.chunkSize);
    if (manifest.cipher.chunkCount !== expectedChunks) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: '分块数量与文件大小不一致' });
    }
    const expectedHashBytes = HASH_BYTES[manifest.hash.alg as HashAlgorithm];
    if (base64ByteLength(manifest.hash.contentHash) !== expectedHashBytes) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: '内容哈希长度与算法不匹配' });
    }
    const expectedDekBytes = manifest.cipher.keyBits / 8 + 16;
    if (base64ByteLength(manifest.wrappedDek) !== expectedDekBytes) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'wrappedDek 长度与密钥位数不匹配' });
    }
  });

export function parseManifestObject(value: unknown): Manifest {
  const result = manifestSchema.safeParse(value);
  if (!result.success) {
    throw new AppError(ErrorCodes.SCHEMA, '容器清单字段不合法', {
      stage: 'parse',
      details: {
        issues: result.error.issues.slice(0, 8).map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      },
    });
  }
  try {
    assertKdfParams(result.data.kdf);
  } catch (error) {
    if (error instanceof AppError) {
      throw new AppError(error.code, error.message, {
        stage: 'validation',
        details: error.details,
        cause: error,
      });
    }
    throw error;
  }
  return result.data as Manifest;
}
