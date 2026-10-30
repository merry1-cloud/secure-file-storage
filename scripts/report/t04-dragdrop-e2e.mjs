import { chromium } from 'playwright-core';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const baseUrl = process.env.SFV_URL ?? 'http://127.0.0.1:4173';
const edgePath =
  process.env.EDGE_PATH ??
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const password = 'ReportT04Password!123';
const artifacts = path.resolve('artifacts');
const evidenceDir = path.join(artifacts, 'report-evidence');
const shotsDir = path.resolve('docs/report-assets/screenshots');
const downloadsDir = path.join(evidenceDir, 't04-downloads');
for (const dir of [artifacts, evidenceDir, shotsDir, downloadsDir]) {
  fs.mkdirSync(dir, { recursive: true });
}

const smallText = 'T04 drag-drop round trip: 安全文件存储系统。\n';
const largeBytes = Buffer.alloc(4 * 1024 * 1024 + 12345, 0x5a);
const sha256 = (data) => createHash('sha256').update(data).digest('hex');
const expectedSmall = sha256(Buffer.from(smallText, 'utf8'));
const expectedLarge = sha256(largeBytes);

async function waitForServer() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(baseUrl);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Server not ready: ${baseUrl}`);
}

async function dragFiles(page, files) {
  const transfer = await page.evaluateHandle((items) => {
    const dataTransfer = new DataTransfer();
    for (const item of items) {
      let bytes;
      if (item.kind === 'base64') {
        const binary = atob(item.data);
        bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
      } else {
        bytes = new TextEncoder().encode(item.data);
      }
      dataTransfer.items.add(new File([bytes], item.name, { type: item.mime }));
    }
    return dataTransfer;
  }, files);
  const dropzone = page.locator('.dropzone');
  await dropzone.dispatchEvent('dragenter', { dataTransfer: transfer });
  await dropzone.dispatchEvent('dragover', { dataTransfer: transfer });
  await dropzone.dispatchEvent('drop', { dataTransfer: transfer });
}

async function decryptRow(page, row, expectedHash, outputName, screenshotName) {
  await row.getByRole('button', { name: '解密' }).click();
  await page.getByText('解密、验签与完整性校验', { exact: true }).waitFor();
  const passwordInput = page.locator('.ant-modal-content input[type="password"]').last();
  await passwordInput.waitFor({ timeout: 30_000 });
  await passwordInput.fill(password);
  const downloadPromise = page.waitForEvent('download', { timeout: 90_000 });
  await page.getByRole('button', { name: '解密并下载' }).click();
  const download = await downloadPromise;
  const outPath = path.join(downloadsDir, outputName);
  await download.saveAs(outPath);
  await page.getByText('验证通过，文件已开始下载', { exact: true }).waitFor({ timeout: 90_000 });
  await page.screenshot({ path: path.join(shotsDir, screenshotName), fullPage: true });
  const actual = sha256(fs.readFileSync(outPath));
  if (actual !== expectedHash) {
    throw new Error(`${outputName} SHA-256 mismatch: ${actual} != ${expectedHash}`);
  }
  await page.getByRole('button', { name: '关闭' }).click();
  return { file: outPath, sha256: actual };
}

const browser = await chromium.launch({ executablePath: edgePath, headless: true });
const context = await browser.newContext({
  acceptDownloads: true,
  viewport: { width: 1440, height: 1000 },
});
const page = await context.newPage();
const consoleErrors = [];
const pageErrors = [];
page.on('console', (message) => {
  if (message.type() === 'error') consoleErrors.push(message.text());
});
page.on('pageerror', (error) => pageErrors.push(error.message));

try {
  await waitForServer();
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await page.getByText('创建保管库').first().waitFor();
  await page.getByLabel('显示名称', { exact: true }).fill('Report T04 Vault');
  await page.getByLabel('主口令', { exact: true }).fill(password);
  await page.getByLabel('确认主口令', { exact: true }).fill(password);
  await page.locator('input[type="checkbox"]').check();
  await page.getByRole('button', { name: /创建并生成 RSA 密钥/ }).click();
  await page.getByText('加密文件库', { exact: true }).waitFor({ timeout: 90_000 });
  console.log('vault created');

  // T04: real DataTransfer, one small file + one >4 MiB multi-chunk file.
  console.log('dragging two files (one >4 MiB)');
  await dragFiles(page, [
    { kind: 'text', name: 't04-drag-small.txt', mime: 'text/plain', data: smallText },
    {
      kind: 'base64',
      name: 't04-drag-large.bin',
      mime: 'application/octet-stream',
      data: largeBytes.toString('base64'),
    },
  ]);
  await page.getByText('加密并签名文件', { exact: true }).waitFor({ timeout: 30_000 });
  await page.getByRole('button', { name: '开始加密' }).click();
  await page.getByText('已完成', { exact: true }).first().waitFor({ timeout: 120_000 });
  await page.getByRole('button', { name: '关闭' }).click();
  await page.getByText('t04-drag-small.txt', { exact: true }).first().waitFor({ timeout: 30_000 });
  await page.getByText('t04-drag-large.bin', { exact: true }).first().waitFor({ timeout: 30_000 });
  await page.screenshot({ path: path.join(shotsDir, 't04-dragdrop-encrypted.png'), fullPage: true });
  console.log('drag-drop encryption done');

  // Export the small local file as .sfv, then drag the .sfv back into the dropzone.
  const smallRow = page.getByRole('row').filter({ hasText: 't04-drag-small.txt' }).first();
  const exportPromise = page.waitForEvent('download', { timeout: 90_000 });
  await smallRow.getByRole('button', { name: '导出' }).click();
  const exportDownload = await exportPromise;
  const sfvPath = path.join(evidenceDir, 't04-drag-small.sfv');
  await exportDownload.saveAs(sfvPath);
  await page.getByText('容器已导出', { exact: false }).first().waitFor({ timeout: 30_000 });
  console.log(`exported ${sfvPath}`);

  // Import deduplicates by fileId, so remove the local copy first; the exported
  // container is the artifact we re-import through the dropzone.
  await smallRow.getByRole('button', { name: '删除' }).click();
  await page
    .locator('.ant-popover')
    .getByRole('button', { name: '删除', exact: true })
    .click();
  await page.getByText('文件已删除', { exact: false }).first().waitFor({ timeout: 30_000 });
  await page.getByText('t04-drag-small.txt', { exact: true }).first().waitFor({ state: 'detached' }).catch(() => undefined);
  console.log('local small file deleted before re-import');

  const sfvBase64 = fs.readFileSync(sfvPath).toString('base64');
  await dragFiles(page, [
    {
      kind: 'base64',
      name: 't04-drag-small.sfv',
      mime: 'application/octet-stream',
      data: sfvBase64,
    },
  ]);
  await page.waitForTimeout(2500);
  const messages = await page.locator('.ant-message-notice-content').allTextContents();
  console.log('messages after .sfv drop:', messages);
  console.log('modal count after .sfv drop:', await page.locator('.ant-modal').count());
  await page.screenshot({ path: path.join(shotsDir, 't04-after-sfv-drop.png'), fullPage: true });
  await page.getByText(/已导入 t04-drag-small\.txt/).first().waitFor({ timeout: 90_000 });
  const importedRow = page
    .getByRole('row')
    .filter({ hasText: 't04-drag-small.txt' })
    .filter({ hasText: '导入' })
    .first();
  await importedRow.waitFor({ timeout: 30_000 });
  await page.screenshot({ path: path.join(shotsDir, 't04-sfv-imported.png'), fullPage: true });
  console.log('drag-in .sfv import done');

  // Decrypt the imported .sfv via the normal wizard and compare the download hash.
  const importedResult = await decryptRow(
    page,
    importedRow,
    expectedSmall,
    't04-imported-small.txt',
    't04-imported-decrypt.png',
  );

  // Decrypt the local multi-chunk file as well.
  const largeRow = page.getByRole('row').filter({ hasText: 't04-drag-large.bin' }).first();
  const largeResult = await decryptRow(
    page,
    largeRow,
    expectedLarge,
    't04-drag-large.bin',
    't04-large-decrypt.png',
  );

  if (consoleErrors.length > 0) throw new Error(`Console errors: ${consoleErrors.join(' | ')}`);
  if (pageErrors.length > 0) throw new Error(`Page errors: ${pageErrors.join(' | ')}`);

  const summary = {
    pass: true,
    password: '[test-only]',
    small: { expectedSha256: expectedSmall, downloaded: importedResult, size: smallText.length },
    large: {
      expectedSha256: expectedLarge,
      downloaded: largeResult,
      size: largeBytes.length,
      chunks: Math.ceil(largeBytes.length / (4 * 1024 * 1024)),
    },
    screenshots: [
      'docs/report-assets/screenshots/t04-dragdrop-encrypted.png',
      'docs/report-assets/screenshots/t04-sfv-imported.png',
      'docs/report-assets/screenshots/t04-imported-decrypt.png',
      'docs/report-assets/screenshots/t04-large-decrypt.png',
    ],
    note: 'Decryption is initiated from the table/DecryptWizard, not by dropping a normal file.',
  };
  fs.writeFileSync(path.join(evidenceDir, 't04-summary.json'), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
  console.log('\n✅ T04 drag-drop / import / decrypt / SHA-256 test passed');
} catch (error) {
  console.error('\n❌ T04 test failed');
  console.error(error);
  await page
    .screenshot({ path: path.join(shotsDir, 't04-failure.png'), fullPage: true })
    .catch(() => undefined);
  const body = await page.locator('body').innerText().catch(() => '');
  console.log(body.slice(-3000));
  process.exitCode = 1;
} finally {
  await browser.close();
}
