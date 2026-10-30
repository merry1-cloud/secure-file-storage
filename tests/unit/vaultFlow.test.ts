import { beforeAll, describe, expect, it } from 'vitest';
import { deriveFileKek } from '@/core/crypto/kdf';
import { fromBase64, toBase64, utf8 } from '@/core/crypto/encoding';
import { createAndWrapDek, unwrapDek } from '@/core/envelope/wrapDek';
import {
  buildContainerBlob,
  parseContainer,
} from '@/core/vault/container';
import { sourceFromParsedContainer } from '@/core/vault/source';
import { verifyContainer } from '@/core/vault/verifyContainer';
import { decryptFile } from '@/core/vault/decryptFile';
import { encodeManifest } from '@/core/manifest/canonicalize';
import { randomBytes } from '@/core/crypto/random';
import {
  createTestPattern,
  createTestVaultContext,
  encryptFixture,
  type TestVaultContext,
} from '../helpers/vaultFixture';

const trustAll = { isTrusted: () => true };

async function expectDecryptFailure(
  fixture: Awaited<ReturnType<typeof encryptFixture>>,
  code: string,
  password = 'wrong password',
): Promise<void> {
  const verified = await verifyContainer(fixture.blob, trustAll);
  const decrypted = decryptFile(sourceFromParsedContainer(verified.parsed), {
    password,
    report: verified.report,
  });
  await expect(decrypted).rejects.toMatchObject({ code });
}

describe('分块加密 / 验签 / 解密完整链路', () => {
  let context: TestVaultContext;

  beforeAll(async () => {
    context = await createTestVaultContext();
  });

  it('小文件 round-trip，内容与哈希一致', async () => {
    const payload = utf8('安全文件存储系统 — hello world');
    const fixture = await encryptFixture(context, 'hello.txt', payload);
    const verified = await verifyContainer(fixture.blob, trustAll);
    expect(verified.parsed.manifest.fileId).toBe(fixture.fileId);
    const result = await decryptFile(sourceFromParsedContainer(verified.parsed), {
      password: context.password,
      report: verified.report,
    });
    const plaintext = new Uint8Array(await result.blob.arrayBuffer());
    expect(toBase64(plaintext)).toBe(toBase64(payload));
    expect(result.report.ok).toBe(true);
    expect(result.report.stages.map((stage) => stage.stage)).toEqual(
      expect.arrayContaining(['parse', 'certificate', 'signature', 'password', 'unwrap', 'decrypt', 'integrity', 'output']),
    );
  });

  it('空文件 round-trip', async () => {
    const fixture = await encryptFixture(context, 'empty.bin', new Uint8Array(0));
    const verified = await verifyContainer(fixture.blob, trustAll);
    const result = await decryptFile(sourceFromParsedContainer(verified.parsed), {
      password: context.password,
      report: verified.report,
    });
    expect(result.blob.size).toBe(0);
  });

  it('多分块文件（4 MiB + 1 B）round-trip', async () => {
    const payload = createTestPattern(4 * 1024 * 1024 + 1);
    const fixture = await encryptFixture(context, '多分块 文件.bin', payload);
    expect(fixture.manifest.cipher.chunkCount).toBe(2);
    const verified = await verifyContainer(fixture.blob, trustAll);
    const result = await decryptFile(sourceFromParsedContainer(verified.parsed), {
      password: context.password,
      report: verified.report,
    });
    const plaintext = new Uint8Array(await result.blob.arrayBuffer());
    expect(plaintext.length).toBe(payload.length);
    expect(toBase64(plaintext.slice(0, 64))).toBe(toBase64(payload.slice(0, 64)));
    expect(toBase64(plaintext.slice(-64))).toBe(toBase64(payload.slice(-64)));
  });

  it('DEK 包装 / 解包 / 重包', async () => {
    const fileId = '11111111-1111-4111-8111-111111111111';
    const fileSalt = randomBytes(16);
    const fileKek = await deriveFileKek(context.material.vmk, fileSalt);
    const wrapped = await createAndWrapDek(fileKek, fileId, 256);
    const unwrapped = await unwrapDek(fileKek, wrapped.wrappedDek, wrapped.wrapIv, fileId, 256);
    expect(unwrapped.algorithm.name).toBe('AES-GCM');
  });

  it('错误口令在 password 阶段失败', async () => {
    const fixture = await encryptFixture(context, 'wrong-pass.txt', utf8('data'));
    await expectDecryptFailure(fixture, 'E_WRONG_PASSWORD');
  });

  it('篡改密文 1 bit：验签通过，GCM 阶段失败', async () => {
    const fixture = await encryptFixture(context, 'tamper-ct.bin', createTestPattern(1024));
    const parsed = await parseContainer(fixture.blob);
    const chunks: Uint8Array[] = [];
    for (let index = 0; index < parsed.chunkCount; index += 1) {
      const chunk = new Uint8Array(await parsed.getChunkBlob(index).arrayBuffer());
      if (index === 0) chunk[0] ^= 0x01;
      chunks.push(chunk);
    }
    const tampered = buildContainerBlob(parsed.headerBytes, parsed.signature, chunks);
    const verified = await verifyContainer(tampered, trustAll);
    expect(verified.report.ok).toBe(true);
    await expect(
      decryptFile(sourceFromParsedContainer(verified.parsed), {
        password: context.password,
        report: verified.report,
      }),
    ).rejects.toMatchObject({ code: 'E_AUTH_TAG' });
  });

  it('替换签名：在 signature 阶段失败', async () => {
    const fixture = await encryptFixture(context, 'sig.bin', utf8('data'));
    const parsed = await parseContainer(fixture.blob);
    const badSignature = randomBytes(256);
    const chunks: Uint8Array[] = [];
    for (let index = 0; index < parsed.chunkCount; index += 1) {
      chunks.push(new Uint8Array(await parsed.getChunkBlob(index).arrayBuffer()));
    }
    const tampered = buildContainerBlob(parsed.headerBytes, badSignature, chunks);
    await expect(verifyContainer(tampered, trustAll)).rejects.toMatchObject({
      code: 'E_SIGNATURE',
    });
  });

  it('修改头部字段：在 signature 阶段失败', async () => {
    const fixture = await encryptFixture(context, 'original.txt', utf8('data'));
    const parsed = await parseContainer(fixture.blob);
    const modifiedManifest = { ...parsed.manifest, filename: 'evil.txt' };
    const modifiedHeader = encodeManifest(modifiedManifest);
    const chunks: Uint8Array[] = [];
    for (let index = 0; index < parsed.chunkCount; index += 1) {
      chunks.push(new Uint8Array(await parsed.getChunkBlob(index).arrayBuffer()));
    }
    const tampered = buildContainerBlob(modifiedHeader, parsed.signature, chunks);
    await expect(verifyContainer(tampered, trustAll)).rejects.toMatchObject({
      code: 'E_SIGNATURE',
    });
  });

  it('截断容器：parse 阶段失败', async () => {
    const fixture = await encryptFixture(context, 'truncate.bin', createTestPattern(512));
    const truncated = fixture.blob.slice(0, fixture.blob.size - 5);
    await expect(verifyContainer(truncated, trustAll)).rejects.toMatchObject({
      code: 'E_CONTAINER_PARSE',
    });
  });

  it('交换分块顺序：GCM 阶段失败', async () => {
    const fixture = await encryptFixture(
      context,
      'reorder.bin',
      createTestPattern(4 * 1024 * 1024 + 100),
    );
    const parsed = await parseContainer(fixture.blob);
    expect(parsed.chunkCount).toBe(2);
    const chunk0 = new Uint8Array(await parsed.getChunkBlob(0).arrayBuffer());
    const chunk1 = new Uint8Array(await parsed.getChunkBlob(1).arrayBuffer());
    const tampered = buildContainerBlob(parsed.headerBytes, parsed.signature, [chunk1, chunk0]);
    const verified = await verifyContainer(tampered, trustAll);
    await expect(
      decryptFile(sourceFromParsedContainer(verified.parsed), {
        password: context.password,
        report: verified.report,
      }),
    ).rejects.toMatchObject({ code: 'E_AUTH_TAG' });
  });

  it('跨文件替换分块：GCM 阶段失败', async () => {
    const first = await encryptFixture(context, 'first.bin', createTestPattern(2048, 1));
    const second = await encryptFixture(context, 'second.bin', createTestPattern(2048, 2));
    const firstParsed = await parseContainer(first.blob);
    const secondParsed = await parseContainer(second.blob);
    const secondChunk = new Uint8Array(await secondParsed.getChunkBlob(0).arrayBuffer());
    const tampered = buildContainerBlob(
      firstParsed.headerBytes,
      firstParsed.signature,
      [secondChunk],
    );
    const verified = await verifyContainer(tampered, trustAll);
    await expect(
      decryptFile(sourceFromParsedContainer(verified.parsed), {
        password: context.password,
        report: verified.report,
      }),
    ).rejects.toMatchObject({ code: 'E_AUTH_TAG' });
  });

  it('未知证书在 certificate 阶段失败', async () => {
    const fixture = await encryptFixture(context, 'trust.bin', utf8('data'));
    await expect(
      verifyContainer(fixture.blob, { isTrusted: () => false }),
    ).rejects.toMatchObject({ code: 'E_CERT_UNTRUSTED' });
  });

  it('SHA-1 内容哈希选项仍可工作，签名摘要仍是 SHA-256', async () => {
    const payload = utf8('sha1 integrity demo');
    const fixture = await encryptFixture(context, 'sha1.txt', payload, 'SHA-1');
    expect(fixture.manifest.hash.alg).toBe('SHA-1');
    const verified = await verifyContainer(fixture.blob, trustAll);
    const result = await decryptFile(sourceFromParsedContainer(verified.parsed), {
      password: context.password,
      report: verified.report,
    });
    expect(new Uint8Array(await result.blob.arrayBuffer())).toEqual(payload);
  });
});
