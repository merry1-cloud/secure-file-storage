import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const baseUrl = process.env.SFV_URL ?? 'http://127.0.0.1:4173';
const edgePath =
  process.env.EDGE_PATH ??
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const password = 'KeyExportVaultPassword!123';
const exportPassphrase = 'PrivateKeyExportPassphrase!456';
const artifacts = path.resolve('artifacts');
fs.mkdirSync(artifacts, { recursive: true });
const keyPath = path.join(artifacts, 'key-export.sfkey');

async function waitForServer() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(baseUrl);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('server not ready');
}

const browser = await chromium.launch({ executablePath: edgePath, headless: true });
const context = await browser.newContext({
  acceptDownloads: true,
  viewport: { width: 1440, height: 1000 },
});
const page = await context.newPage();
const errors = [];
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(message.text());
});
page.on('pageerror', (error) => errors.push(error.message));

try {
  await waitForServer();
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await page.getByText('创建保管库').first().waitFor();
  await page.getByLabel('显示名称', { exact: true }).fill('Key Export Vault');
  await page.getByLabel('主口令', { exact: true }).fill(password);
  await page.getByLabel('确认主口令', { exact: true }).fill(password);
  await page.locator('input[type="checkbox"]').check();
  await page.getByRole('button', { name: /创建并生成 RSA 密钥/ }).click();
  await page.getByText('加密文件库', { exact: true }).waitFor({ timeout: 90_000 });

  await page.getByText('密钥管理', { exact: true }).click();
  await page.getByText('签名证书', { exact: true }).waitFor();

  console.log('exporting private key');
  await page.getByRole('button', { name: /加密导出 RSA 私钥/ }).click();
  await page.getByLabel(/当前保管库主口令/).fill(password);
  await page.getByLabel(/导出口令（独立/).fill(exportPassphrase);
  await page.getByLabel('确认导出口令', { exact: true }).fill(exportPassphrase);
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 120_000 }),
    page.getByRole('button', { name: '加密导出私钥' }).click(),
  ]);
  await download.saveAs(keyPath);
  console.log(`exported: ${keyPath}`);
  await page.getByText('私钥已加密导出', { exact: false }).first().waitFor({ timeout: 30_000 });

  console.log('re-importing private key');
  await page.getByRole('button', { name: /导入私钥（.sfkey）/ }).click();
  await page.locator('.ant-modal input[type="file"]').setInputFiles(keyPath);
  await page.getByLabel('导出时设置的私钥口令', { exact: true }).fill(exportPassphrase);
  await page.getByLabel('当前保管库主口令', { exact: true }).fill(password);
  await page.getByRole('button', { name: '导入并切换签名密钥' }).click();
  await page.getByText('私钥导入成功', { exact: false }).first().waitFor({ timeout: 120_000 });
  await page.screenshot({ path: path.join(artifacts, '17-key-export-import.png'), fullPage: true });

  if (errors.length > 0) throw new Error(`Console errors: ${errors.join(' | ')}`);
  console.log('\n✅ key export / import smoke test passed');
} catch (error) {
  console.error('key export/import failed', error);
  await page.screenshot({ path: path.join(artifacts, 'key-export-failure.png'), fullPage: true }).catch(() => {});
  const body = await page.locator('body').innerText().catch(() => '');
  console.log(body.slice(-2000));
  process.exitCode = 1;
} finally {
  await browser.close();
}
