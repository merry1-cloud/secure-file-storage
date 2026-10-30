import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const baseUrl = process.env.SFV_URL ?? 'http://127.0.0.1:4173';
const edgePath =
  process.env.EDGE_PATH ??
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const sourcePassword = 'SourceVaultPassword!123';
const restoredPassword = 'RestoredVaultPassword!456';
const changedPassword = 'ChangedVaultPassword!789';
const backupPassphrase = 'OfflineBackupPassphrase!456';
const artifacts = path.resolve('artifacts');
fs.mkdirSync(artifacts, { recursive: true });
const backupPath = path.join(artifacts, 'restore-backup.sfbackup');
const containerPath = path.join(artifacts, 'restore-container.sfv');

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

function log(step) {
  console.log(`\n▶ ${step}`);
}

async function createVault(page, name, password) {
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await page.getByText('创建保管库').first().waitFor();
  await page.getByLabel('显示名称', { exact: true }).fill(name);
  await page.getByLabel('主口令', { exact: true }).fill(password);
  await page.getByLabel('确认主口令', { exact: true }).fill(password);
  await page.locator('input[type="checkbox"]').check();
  await page.getByRole('button', { name: /创建并生成 RSA 密钥/ }).click();
  await page.getByText('加密文件库', { exact: true }).waitFor({ timeout: 90_000 });
}

async function encryptFile(page, name, content) {
  await page.locator('input[type="file"]').first().setInputFiles({
    name,
    mimeType: 'text/plain',
    buffer: Buffer.from(content),
  });
  await page.getByText('加密并签名文件', { exact: true }).waitFor();
  await page.getByRole('button', { name: '开始加密' }).click();
  await page.getByText('已完成', { exact: true }).first().waitFor({ timeout: 60_000 });
  await page.getByRole('button', { name: '关闭' }).click();
  await page.getByText(name, { exact: true }).first().waitFor({ timeout: 30_000 });
}

async function exportContainer(page, fileName, savePath) {
  const row = page.getByRole('row').filter({ hasText: fileName }).first();
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 90_000 }),
    row.getByRole('button', { name: '导出' }).click(),
  ]);
  await download.saveAs(savePath);
  console.log(`  exported: ${savePath}`);
}

async function createBackup(page, password) {
  await page.getByText('密钥管理', { exact: true }).click();
  await page.getByText('签名证书', { exact: true }).waitFor();
  await page.getByRole('button', { name: /创建密钥备份/ }).click();
  await page.getByLabel(/当前保管库主口令/).fill(password);
  await page.getByLabel(/备份口令（独立口令/).fill(backupPassphrase);
  await page.getByLabel('确认备份口令', { exact: true }).fill(backupPassphrase);
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 120_000 }),
    page.getByRole('button', { name: '生成备份文件' }).click(),
  ]);
  await download.saveAs(backupPath);
  console.log(`  backup: ${backupPath}`);
  await page.getByText('密钥备份已创建', { exact: false }).first().waitFor({ timeout: 30_000 });
}

async function restoreVault(page) {
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await page.getByText('从备份恢复', { exact: true }).click();
  const pane = page.locator('.ant-tabs-tabpane-active');
  await pane.locator('input[type="file"]').setInputFiles(backupPath);
  await pane.getByLabel('备份口令', { exact: true }).fill(backupPassphrase);
  await pane.getByLabel('显示名称', { exact: true }).fill('Restored Vault');
  await pane.getByLabel('新主口令', { exact: true }).fill(restoredPassword);
  await pane.getByLabel('确认新主口令', { exact: true }).fill(restoredPassword);
  await pane.locator('input[type="checkbox"]').check();
  await pane.getByRole('button', { name: /解密备份并建立保管库/ }).click();
  await page.getByText('加密文件库', { exact: true }).waitFor({ timeout: 120_000 });
}

async function unlock(page, password) {
  await page.getByText('已锁定', { exact: true }).waitFor({ timeout: 30_000 });
  await page.getByLabel('主口令', { exact: true }).fill(password);
  await page.getByRole('button', { name: '解锁保管库' }).click();
  await page.getByText('加密文件库', { exact: true }).waitFor({ timeout: 60_000 });
}

async function decryptWith(page, fileName, password, expectSuccess) {
  const row = page.getByRole('row').filter({ hasText: fileName }).first();
  await row.getByRole('button', { name: '解密' }).click();
  const passwordField = page.getByPlaceholder(
    /保管库主口令|容器创建时的保管库口令/,
  );
  await passwordField.waitFor({ timeout: 30_000 });
  await passwordField.fill(password);
  await page.getByRole('button', { name: '解密并下载' }).click();
  if (expectSuccess) {
    await page.getByText('验证通过，文件已开始下载', { exact: true }).waitFor({ timeout: 120_000 });
  } else {
    await page.getByText('解密或验证失败，已阻止输出明文', { exact: true }).waitFor({ timeout: 120_000 });
  }
  await page.getByRole('button', { name: '关闭' }).click();
}

async function main() {
  await waitForServer();
  const browser = await chromium.launch({ executablePath: edgePath, headless: true });
  const consoleErrors = [];
  const pageErrors = [];

  const contextA = await browser.newContext({
    acceptDownloads: true,
    viewport: { width: 1440, height: 1000 },
  });
  const pageA = await contextA.newPage();
  pageA.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  pageA.on('pageerror', (error) => pageErrors.push(error.message));

  try {
    log('源保管库：创建、加密、导出容器、创建备份');
    await createVault(pageA, 'Source Vault', sourcePassword);
    await encryptFile(pageA, 'restore.txt', 'data that must survive backup restore');
    await exportContainer(pageA, 'restore.txt', containerPath);
    await createBackup(pageA, sourcePassword);
    await pageA.screenshot({ path: path.join(artifacts, '10-source-vault.png'), fullPage: true });
  } finally {
    await contextA.close();
  }

  const contextB = await browser.newContext({
    acceptDownloads: true,
    viewport: { width: 1440, height: 1000 },
  });
  const page = await contextB.newPage();
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));

  try {
    log('新浏览器上下文：从备份恢复');
    await restoreVault(page);
    await page.screenshot({ path: path.join(artifacts, '11-restored-vault.png'), fullPage: true });

    log('刷新后重新解锁（验证密钥环完整性）');
    await page.reload({ waitUntil: 'networkidle' });
    await unlock(page, restoredPassword);

    log('导入旧 .sfv 容器并用原口令解密');
    await page.locator('input[type="file"]').first().setInputFiles(containerPath);
    await page.getByText('restore.txt', { exact: true }).first().waitFor({ timeout: 90_000 });
    await decryptWith(page, 'restore.txt', sourcePassword, true);
    await page.screenshot({ path: path.join(artifacts, '12-imported-decrypt.png'), fullPage: true });

    log('在本机新建文件并修改主口令');
    await encryptFile(page, 'local.txt', 'local file encrypted by restored vault');
    await page.getByText('密钥管理', { exact: true }).click();
    await page.getByText('签名证书', { exact: true }).waitFor();
    await page.getByRole('button', { name: /修改主口令/ }).click();
    await page.getByLabel('当前主口令', { exact: true }).fill(restoredPassword);
    await page.getByLabel('新主口令', { exact: true }).fill(changedPassword);
    await page.getByLabel('确认新主口令', { exact: true }).fill(changedPassword);
    await page
      .locator('.ant-modal-footer button')
      .filter({ hasText: '修改主口令' })
      .click();
    await page.getByText(/主口令已更新/).first().waitFor({ timeout: 120_000 });
    await page.screenshot({ path: path.join(artifacts, '13-password-changed.png'), fullPage: true });

    log('新口令可解密本地文件，旧口令失败');
    await page.getByText('文件库', { exact: true }).click();
    await page.getByText('local.txt', { exact: true }).first().waitFor();
    await decryptWith(page, 'local.txt', changedPassword, true);
    await decryptWith(page, 'local.txt', restoredPassword, false);
    await page.screenshot({ path: path.join(artifacts, '14-new-password-decrypt.png'), fullPage: true });

    log('旧导入容器仍使用原口令解密');
    await decryptWith(page, 'restore.txt', sourcePassword, true);

    log('审计日志包含恢复与改口令');
    await page.getByText('审计日志', { exact: true }).click();
    await page.getByText('操作审计', { exact: true }).waitFor();
    await page.getByText('恢复备份', { exact: true }).first().waitFor({ timeout: 30_000 });
    await page.getByText('修改主口令', { exact: true }).first().waitFor({ timeout: 30_000 });
    await page.screenshot({ path: path.join(artifacts, '15-audit-lifecycle.png'), fullPage: true });

    if (pageErrors.length > 0) {
      throw new Error(`Page errors:\n${pageErrors.join('\n')}`);
    }
    console.log('\n✅ restore / rekey smoke test passed');
  } catch (error) {
    await page
      .screenshot({ path: path.join(artifacts, 'restore-failure.png'), fullPage: true })
      .catch(() => undefined);
    const body = await page.locator('body').innerText().catch(() => '');
    console.log('\nDebug body tail:\n', body.slice(-2000));
    throw error;
  } finally {
    if (consoleErrors.length > 0) {
      console.log('\nConsole errors:');
      for (const error of consoleErrors) console.log(`  - ${error}`);
    }
    await contextB.close();
    await browser.close();
  }
}

main().catch((error) => {
  console.error('\n❌ restore / rekey smoke test failed');
  console.error(error);
  process.exitCode = 1;
});
