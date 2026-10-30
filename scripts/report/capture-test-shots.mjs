import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const baseUrl = process.env.SFV_URL ?? 'http://127.0.0.1:4173';
const edgePath =
  process.env.EDGE_PATH ??
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const password = 'ReportShotsPassword!123';
const shots = path.resolve('docs/report-assets/screenshots');
fs.mkdirSync(shots, { recursive: true });

async function waitForServer() {
  for (let i = 0; i < 80; i += 1) {
    try {
      if ((await fetch(baseUrl)).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('server not ready');
}

async function cleanShot(page, name) {
  await page.evaluate(() => {
    document.querySelectorAll('.ant-message').forEach((node) => node.remove());
  });
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(shots, name), fullPage: true });
  console.log('wrote', name);
}

const browser = await chromium.launch({ executablePath: edgePath, headless: true });
const context = await browser.newContext({
  acceptDownloads: true,
  viewport: { width: 1440, height: 1050 },
});
const page = await context.newPage();
try {
  await waitForServer();
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await page.getByText('创建保管库').first().waitFor();
  await page.getByLabel('显示名称', { exact: true }).fill('Report Demo Vault');
  await page.getByLabel('主口令', { exact: true }).fill(password);
  await page.getByLabel('确认主口令', { exact: true }).fill(password);
  await page.locator('input[type="checkbox"]').check();
  await page.getByRole('button', { name: /创建并生成 RSA 密钥/ }).click();
  await page.getByText('加密文件库', { exact: true }).waitFor({ timeout: 90_000 });

  await page.locator('input[type="file"]').first().setInputFiles({
    name: 'report-demo.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('安全文件存储系统 · 报告现场测试演示文件。\n'),
  });
  await page.getByText('加密并签名文件', { exact: true }).waitFor();
  await page.getByRole('button', { name: '开始加密' }).click();
  await page.getByText('已完成', { exact: true }).first().waitFor({ timeout: 60_000 });
  await page.getByRole('button', { name: '关闭' }).click();
  await page.getByText('report-demo.txt', { exact: true }).first().waitFor({ timeout: 30_000 });

  const row = page.getByRole('row').filter({ hasText: 'report-demo.txt' }).first();
  await row.getByRole('button', { name: '解密' }).click();
  await page.getByPlaceholder('保管库主口令').waitFor();
  await page.getByPlaceholder('保管库主口令').fill('definitely-wrong-password');
  await page.getByRole('button', { name: '解密并下载' }).click();
  await page.getByText('解密或验证失败，已阻止输出明文', { exact: true }).waitFor({ timeout: 90_000 });
  await cleanShot(page, 't01-wrong-password.png');
  await page.getByRole('button', { name: '关闭' }).click();

  await page.getByText('篡改实验室', { exact: true }).click();
  await page.getByText('选择攻击场景', { exact: true }).waitFor();
  const target = page.locator('.ant-form-item').filter({ hasText: '目标文件' });
  await target.locator('.ant-select').click();
  await page.locator('.ant-select-item-option').filter({ hasText: 'report-demo.txt' }).click();
  await page.getByPlaceholder('输入正确口令').fill(password);
  await page.getByRole('button', { name: '运行攻击测试' }).click();
  await page.locator('.lab-result-card').waitFor({ timeout: 90_000 });
  await page.getByText('符合预期', { exact: true }).waitFor({ timeout: 90_000 });
  await cleanShot(page, 't02-tamper-ciphertext.png');

  const kind = page.locator('.ant-form-item').filter({ hasText: '篡改类型' });
  await kind.locator('.ant-select').click();
  await page.getByTitle('替换签名', { exact: true }).click();
  await page.getByRole('button', { name: '运行攻击测试' }).click();
  await page.locator('.lab-result-card').waitFor({ timeout: 90_000 });
  await page.getByText('符合预期', { exact: true }).waitFor({ timeout: 90_000 });
  await cleanShot(page, 't03-tamper-signature.png');
  console.log('\n✅ report screenshots captured');
} catch (error) {
  console.error('screenshot capture failed', error);
  await page.screenshot({ path: path.join(shots, 'capture-failure.png'), fullPage: true }).catch(() => undefined);
  process.exitCode = 1;
} finally {
  await browser.close();
}
