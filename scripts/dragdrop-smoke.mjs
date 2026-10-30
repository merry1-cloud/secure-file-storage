import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const baseUrl = process.env.SFV_URL ?? 'http://127.0.0.1:4173';
const edgePath =
  process.env.EDGE_PATH ??
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const password = 'DragDropVaultPassword!123';
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
  await page.getByLabel('显示名称', { exact: true }).fill('DragDrop Vault');
  await page.getByLabel('主口令', { exact: true }).fill(password);
  await page.getByLabel('确认主口令', { exact: true }).fill(password);
  await page.locator('input[type="checkbox"]').check();
  await page.getByRole('button', { name: /创建并生成 RSA 密钥/ }).click();
  await page.getByText('加密文件库', { exact: true }).waitFor({ timeout: 90_000 });

  console.log('dispatching real dragenter/dragover/drop with two files');
  const dataTransfer = await page.evaluateHandle(() => {
    const transfer = new DataTransfer();
    transfer.items.add(
      new File(['dragged file one'], 'dragged-one.txt', { type: 'text/plain' }),
    );
    transfer.items.add(
      new File(['dragged file two'], '拖拽 文件二.txt', { type: 'text/plain' }),
    );
    return transfer;
  });
  const dropzone = page.locator('.dropzone');
  await dropzone.dispatchEvent('dragenter', { dataTransfer });
  await dropzone.dispatchEvent('dragover', { dataTransfer });
  await dropzone.dispatchEvent('drop', { dataTransfer });
  await page.getByText('加密并签名文件', { exact: true }).waitFor({ timeout: 30_000 });
  await page.getByRole('button', { name: '开始加密' }).click();
  await page.getByText('已完成', { exact: true }).first().waitFor({ timeout: 60_000 });
  await page.getByRole('button', { name: '关闭' }).click();
  await page.getByText('dragged-one.txt', { exact: true }).first().waitFor({ timeout: 30_000 });
  await page.getByText('拖拽 文件二.txt', { exact: true }).first().waitFor({ timeout: 30_000 });
  await page.waitForTimeout(900);
  await page.screenshot({ path: path.join(artifacts, '18-dragdrop.png'), fullPage: true });

  console.log('testing certificate replacement tamper');
  await page.getByText('篡改实验室', { exact: true }).click();
  await page.getByText('选择攻击场景', { exact: true }).waitFor();
  const targetItem = page.locator('.ant-form-item').filter({ hasText: '目标文件' });
  await targetItem.locator('.ant-select').click();
  await page.locator('.ant-select-item-option').filter({ hasText: 'dragged-one.txt' }).click();
  const kindItem = page.locator('.ant-form-item').filter({ hasText: '篡改类型' });
  await kindItem.locator('.ant-select').click();
  await page.getByTitle('替换签名者证书', { exact: true }).click();
  await page.getByRole('button', { name: '运行攻击测试' }).click();
  await page.locator('.lab-result-card').waitFor({ timeout: 90_000 });
  await page.getByText('符合预期', { exact: true }).waitFor({ timeout: 90_000 });
  await page.getByText('E_CERT_UNTRUSTED', { exact: true }).first().waitFor();
  await page.screenshot({ path: path.join(artifacts, '19-tamper-certificate.png'), fullPage: true });

  if (errors.length > 0) throw new Error(`Console errors: ${errors.join(' | ')}`);
  console.log('\n✅ drag-drop and certificate tamper smoke test passed');
} catch (error) {
  console.error('drag-drop/cert test failed', error);
  await page.screenshot({ path: path.join(artifacts, 'dragdrop-failure.png'), fullPage: true }).catch(() => {});
  const body = await page.locator('body').innerText().catch(() => '');
  console.log(body.slice(-2500));
  process.exitCode = 1;
} finally {
  await browser.close();
}
