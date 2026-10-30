import { _electron as electron } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const password = 'ElectronVaultPassword!123';
const artifacts = path.resolve('artifacts');
const userData = path.join(artifacts, 'electron-userdata');
fs.mkdirSync(artifacts, { recursive: true });
fs.rmSync(userData, { recursive: true, force: true });

const electronEnv = {
  ...process.env,
  SFV_USER_DATA: userData,
};
delete electronEnv.ELECTRON_RUN_AS_NODE;

const packagedExe = process.env.ELECTRON_APP_EXE
  ? path.resolve(process.env.ELECTRON_APP_EXE)
  : undefined;
const app = await electron.launch({
  ...(packagedExe
    ? { executablePath: packagedExe, args: [] }
    : { args: ['.'] }),
  cwd: process.cwd(),
  env: electronEnv,
});

const page = await app.firstWindow();
const consoleErrors = [];
const pageErrors = [];
page.on('console', (message) => {
  if (message.type() === 'error') consoleErrors.push(message.text());
});
page.on('pageerror', (error) => pageErrors.push(error.message));

try {
  await page.waitForLoadState('domcontentloaded');
  console.log('url:', page.url());
  const envInfo = await page.evaluate(() => ({
    secure: window.isSecureContext,
    subtle: typeof crypto.subtle,
    indexedDB: typeof indexedDB,
    origin: location.origin,
    ua: navigator.userAgent,
  }));
  console.log('environment:', envInfo);
  if (!envInfo.secure) throw new Error('Electron custom protocol is not a secure context');
  if (envInfo.subtle !== 'object') throw new Error('WebCrypto subtle is unavailable');
  if (envInfo.indexedDB !== 'object') throw new Error('IndexedDB is unavailable');

  await page.getByText('创建保管库').first().waitFor({ timeout: 30_000 });
  await page.getByLabel('显示名称', { exact: true }).fill('Electron Vault');
  await page.getByLabel('主口令', { exact: true }).fill(password);
  await page.getByLabel('确认主口令', { exact: true }).fill(password);
  await page.locator('input[type="checkbox"]').check();
  await page.getByRole('button', { name: /创建并生成 RSA 密钥/ }).click();
  await page.getByText('加密文件库', { exact: true }).waitFor({ timeout: 90_000 });
  console.log('vault created');

  await page.locator('input[type="file"]').first().setInputFiles({
    name: 'electron-demo.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('Electron desktop smoke test'),
  });
  await page.getByText('加密并签名文件', { exact: true }).waitFor();
  await page.getByRole('button', { name: '开始加密' }).click();
  await page.getByText('已完成', { exact: true }).first().waitFor({ timeout: 60_000 });
  await page.getByRole('button', { name: '关闭' }).click();
  await page.getByText('electron-demo.txt', { exact: true }).first().waitFor({ timeout: 30_000 });
  console.log('file encrypted');

  const row = page.getByRole('row').filter({ hasText: 'electron-demo.txt' }).first();
  await row.getByRole('button', { name: '解密' }).click();
  await page.getByPlaceholder('保管库主口令').waitFor({ timeout: 30_000 });
  await page.getByPlaceholder('保管库主口令').fill(password);
  await page.getByRole('button', { name: '解密并下载' }).click();
  await page.getByText('验证通过，文件已开始下载', { exact: true }).waitFor({ timeout: 90_000 });
  console.log('file decrypted and download triggered');
  await page.screenshot({ path: path.join(artifacts, '20-electron.png'), fullPage: true });

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByText('已锁定', { exact: true }).waitFor({ timeout: 30_000 });
  await page.getByLabel('主口令', { exact: true }).fill(password);
  await page.getByRole('button', { name: '解锁保管库' }).click();
  await page.getByText('加密文件库', { exact: true }).waitFor({ timeout: 60_000 });
  console.log('reload + unlock passed (IndexedDB origin stable)');

  if (consoleErrors.length > 0) {
    throw new Error(`Console errors: ${consoleErrors.join(' | ')}`);
  }
  if (pageErrors.length > 0) {
    throw new Error(`Page errors: ${pageErrors.join(' | ')}`);
  }
  console.log('\n✅ Electron smoke test passed');
} catch (error) {
  console.error('\n❌ Electron smoke test failed');
  console.error(error);
  await page
    .screenshot({ path: path.join(artifacts, 'electron-failure.png'), fullPage: true })
    .catch(() => undefined);
  const body = await page.locator('body').innerText().catch(() => '');
  console.log(body.slice(-2500));
  process.exitCode = 1;
} finally {
  if (consoleErrors.length > 0) {
    console.log('Console errors:', consoleErrors);
  }
  await app.close().catch(() => undefined);
  fs.rmSync(userData, { recursive: true, force: true });
}
