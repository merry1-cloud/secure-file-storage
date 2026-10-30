import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const baseUrl = process.env.SFV_URL ?? 'http://127.0.0.1:4173';
const edgePath =
  process.env.EDGE_PATH ??
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const password = 'CorrectHorseBatteryStaple!123';
const backupPassphrase = 'OfflineBackupPassphrase!456';
const artifacts = path.resolve('artifacts');
fs.mkdirSync(artifacts, { recursive: true });

async function waitForServer() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(baseUrl);
      if (response.ok) return;
    } catch {
      // retry
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Server not ready: ${baseUrl}`);
}

function log(step) {
  console.log(`\n▶ ${step}`);
}

async function main() {
  await waitForServer();
  const browser = await chromium.launch({
    executablePath: edgePath,
    headless: true,
  });
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
    log('打开应用并创建保管库');
    await page.goto(baseUrl, { waitUntil: 'networkidle' });
    await page.getByText('创建保管库').first().waitFor();
    await page.getByLabel('显示名称', { exact: true }).fill('Smoke Test Vault');
    await page.getByLabel('主口令', { exact: true }).fill(password);
    await page.getByLabel('确认主口令', { exact: true }).fill(password);
    await page.locator('input[type="checkbox"]').check();
    await page.getByRole('button', { name: /创建并生成 RSA 密钥/ }).click();
    await page.getByText('加密文件库', { exact: true }).waitFor({ timeout: 90_000 });
    await page.screenshot({ path: path.join(artifacts, '01-vault-empty.png'), fullPage: true });

    log('通过文件选择器上传并加密');
    await page.locator('input[type="file"]').first().setInputFiles({
      name: 'smoke.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('hello secure file vault — smoke test'),
    });
    await page.getByText('加密并签名文件', { exact: true }).waitFor();
    await page.getByRole('button', { name: '开始加密' }).click();
    await page.getByText('已完成', { exact: true }).first().waitFor({ timeout: 60_000 });
    await page.getByRole('button', { name: '关闭' }).click();
    await page.getByText('smoke.txt', { exact: true }).first().waitFor({ timeout: 30_000 });
    await page.screenshot({ path: path.join(artifacts, '02-vault-encrypted.png'), fullPage: true });

    log('正确口令解密并下载');
    const row = page.getByRole('row').filter({ hasText: 'smoke.txt' }).first();
    await row.getByRole('button', { name: '解密' }).click();
    await page.getByText('解密、验签与完整性校验', { exact: true }).waitFor();
    const passwordInput = page.getByPlaceholder('保管库主口令');
    await passwordInput.waitFor({ timeout: 30_000 });
    await passwordInput.fill(password);
    const downloadPromise = page.waitForEvent('download', { timeout: 90_000 });
    await page.getByRole('button', { name: '解密并下载' }).click();
    const download = await downloadPromise;
    await page.getByText('验证通过，文件已开始下载', { exact: true }).waitFor({ timeout: 90_000 });
    console.log(`  download: ${download.suggestedFilename()}`);
    await page.screenshot({ path: path.join(artifacts, '03-decrypt-success.png'), fullPage: true });
    await page.getByRole('button', { name: '关闭' }).click();

    log('错误口令解密应失败且不下载');
    await row.getByRole('button', { name: '解密' }).click();
    await page.getByPlaceholder('保管库主口令').waitFor();
    await page.getByPlaceholder('保管库主口令').fill('wrong-password-123');
    await page.getByRole('button', { name: '解密并下载' }).click();
    await page.getByText('解密或验证失败，已阻止输出明文', { exact: true }).waitFor({ timeout: 90_000 });
    await page.screenshot({ path: path.join(artifacts, '04-wrong-password.png'), fullPage: true });
    await page.getByRole('button', { name: '关闭' }).click();

    log('篡改实验室：篡改密文');
    await page.getByText('篡改实验室', { exact: true }).click();
    await page.getByText('选择攻击场景', { exact: true }).waitFor();
    const targetItem = page.locator('.ant-form-item').filter({ hasText: '目标文件' });
    await targetItem.locator('.ant-select').click();
    await page.locator('.ant-select-item-option').filter({ hasText: 'smoke.txt' }).click();
    await page.getByPlaceholder('输入正确口令').fill(password);
    await page.getByRole('button', { name: '运行攻击测试' }).click();
    await page.locator('.lab-result-card').waitFor({ timeout: 90_000 });
    await page.getByText('符合预期', { exact: true }).waitFor({ timeout: 90_000 });
    await page.screenshot({ path: path.join(artifacts, '05-tamper-ciphertext.png'), fullPage: true });

    log('篡改实验室：替换签名');
    const kindItem = page.locator('.ant-form-item').filter({ hasText: '篡改类型' });
    await kindItem.locator('.ant-select').click();
    await page.getByTitle('替换签名', { exact: true }).click();
    await page.getByRole('button', { name: '运行攻击测试' }).click();
    await page.locator('.lab-result-card').waitFor({ timeout: 90_000 });
    await page.getByText('符合预期', { exact: true }).waitFor({ timeout: 90_000 });
    await page.screenshot({ path: path.join(artifacts, '06-tamper-signature.png'), fullPage: true });

    log('密钥管理：创建备份');
    await page.getByText('密钥管理', { exact: true }).click();
    await page.getByText('签名证书', { exact: true }).waitFor();
    await page.getByRole('button', { name: /创建密钥备份/ }).click();
    await page.getByLabel(/当前保管库主口令/).fill(password);
    await page.getByLabel(/备份口令（独立口令/).fill(backupPassphrase);
    await page.getByLabel('确认备份口令', { exact: true }).fill(backupPassphrase);
    const backupDownloadPromise = page.waitForEvent('download', { timeout: 120_000 });
    await page.getByRole('button', { name: '生成备份文件' }).click();
    const backupDownload = await backupDownloadPromise;
    console.log(`  backup: ${backupDownload.suggestedFilename()}`);
    await page.getByText('密钥备份已创建', { exact: false }).first().waitFor({ timeout: 30_000 });
    await page.screenshot({ path: path.join(artifacts, '07-keys-backup.png'), fullPage: true });

    log('性能测试：1 MB 基础基准');
    await page.getByText('性能测试', { exact: true }).click();
    await page.getByText('测试参数', { exact: true }).waitFor();
    await page.getByText('10 MB', { exact: true }).click();
    await page.getByText('100 MB', { exact: true }).click();
    await page.getByText('scrypt', { exact: true }).click();
    await page.getByText('端到端加密/解密', { exact: true }).click();
    await page.getByRole('button', { name: '开始性能测试' }).click();
    await page.getByText('测试结果', { exact: true }).waitFor({ timeout: 180_000 });
    await page.screenshot({ path: path.join(artifacts, '08-benchmark.png'), fullPage: true });

    log('审计日志');
    await page.getByText('审计日志', { exact: true }).click();
    await page.getByText('操作审计', { exact: true }).waitFor();
    await page.getByText('创建保管库', { exact: true }).first().waitFor({ timeout: 30_000 });
    await page.screenshot({ path: path.join(artifacts, '09-audit.png'), fullPage: true });

    if (pageErrors.length > 0) {
      throw new Error(`Page errors:\n${pageErrors.join('\n')}`);
    }
    console.log('\n✅ UI smoke test passed');
  } catch (error) {
    await page
      .screenshot({ path: path.join(artifacts, 'failure.png'), fullPage: true })
      .catch(() => undefined);
    const buttons = await page.locator('button').allTextContents().catch(() => []);
    const modals = await page.locator('.ant-modal').count().catch(() => 0);
    console.log('\nDebug: visible buttons:', JSON.stringify(buttons));
    console.log('Debug: modal count:', modals);
    throw error;
  } finally {
    if (consoleErrors.length > 0) {
      console.log('\nConsole errors:');
      for (const error of consoleErrors) console.log(`  - ${error}`);
    }
    await browser.close();
  }
}

main().catch((error) => {
  console.error('\n❌ UI smoke test failed');
  console.error(error);
  process.exitCode = 1;
});
