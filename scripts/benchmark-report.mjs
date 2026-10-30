import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const baseUrl = process.env.SFV_URL ?? 'http://127.0.0.1:4173';
const edgePath =
  process.env.EDGE_PATH ??
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const password = 'BenchmarkReportPassword!123';
const artifacts = path.resolve('artifacts');
fs.mkdirSync(artifacts, { recursive: true });

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
  viewport: { width: 1440, height: 1200 },
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
  await page.getByLabel('显示名称', { exact: true }).fill('Benchmark Report Vault');
  await page.getByLabel('主口令', { exact: true }).fill(password);
  await page.getByLabel('确认主口令', { exact: true }).fill(password);
  await page.locator('input[type="checkbox"]').check();
  await page.getByRole('button', { name: /创建并生成 RSA 密钥/ }).click();
  await page.getByText('加密文件库', { exact: true }).waitFor({ timeout: 90_000 });

  await page.getByText('性能测试', { exact: true }).click();
  await page.getByText('测试参数', { exact: true }).waitFor();
  console.log('starting full benchmark (1/10/100 MB, scrypt, end-to-end)…');
  await page.getByRole('button', { name: '开始性能测试' }).click();
  await page.getByText('测试结果', { exact: true }).waitFor({ timeout: 600_000 });
  await page.screenshot({ path: path.join(artifacts, '16-benchmark-full.png'), fullPage: true });

  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 60_000 }),
    page.getByRole('button', { name: '导出 Markdown' }).click(),
  ]);
  const output = path.join(artifacts, 'benchmark-report.md');
  await download.saveAs(output);
  console.log(`saved ${output}`);
  console.log(fs.readFileSync(output, 'utf8'));
} catch (error) {
  console.error('benchmark report failed', error);
  await page.screenshot({ path: path.join(artifacts, 'benchmark-full-failure.png'), fullPage: true }).catch(() => {});
  const body = await page.locator('body').innerText().catch(() => '');
  console.log(body.slice(-3000));
  process.exitCode = 1;
} finally {
  if (errors.length > 0) {
    console.log('console/page errors:', errors);
  }
  await browser.close();
}
