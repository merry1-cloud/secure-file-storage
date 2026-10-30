# 07 · 测试计划与现场测试用例

## 1. 自动化测试

### 1.1 单元/集成测试（Vitest）

```bash
npm test
```

当前结果：**3 个测试文件、25 个测试全部通过**（约 3 秒）。

| 文件 | 覆盖 |
| --- | --- |
| `tests/unit/crypto.kat.test.ts` | SHA-256/SHA-1 KAT；PBKDF2 公开向量与 Node 对照；scrypt RFC 7914；AES-GCM round-trip/AAD/篡改；RSA 签名/验签/SPKI；大缓冲区随机数 |
| `tests/unit/vaultFlow.test.ts` | 小文件/空文件/4 MiB+1 多块 round-trip；DEK 包装/解包；错误口令；密文翻转；签名替换；头部修改；截断；分块重排；跨文件分块；证书未信任；SHA-1 内容哈希 |
| `tests/unit/benchmark.test.ts` | 1 MiB 性能基准核心流程可完成 |

### 1.2 浏览器冒烟（Playwright + 本机 Edge）

先启动生产预览：

```bash
npm run build
npm run preview -- --host 127.0.0.1 --port 4173
```

另开终端：

```bash
npx -y node@20 scripts/ui-smoke.mjs
npx -y node@20 scripts/restore-smoke.mjs
npx -y node@20 scripts/key-export-smoke.mjs
npx -y node@20 scripts/dragdrop-smoke.mjs
npx -y node@20 scripts/benchmark-report.mjs
```

**`ui-smoke.mjs` 已通过**：

1. 创建保管库（PBKDF2 600k，生成 RSA-3072/证书）。
2. 通过文件选择器上传并加密 `smoke.txt`。
3. 正确口令解密并下载，验证报告全部通过。
4. 错误口令失败，显示 `E_WRONG_PASSWORD`，不下载。
5. 篡改实验室：翻转密文，符合预期 `E_AUTH_TAG`。
6. 篡改实验室：替换签名，符合预期 `E_SIGNATURE`。
7. 密钥管理：创建 `.sfbackup` 并下载。
8. 性能测试：1 MB 基础基准通过并保存结果。
9. 审计日志显示创建/加密/解密/篡改/备份/性能记录。

**`restore-smoke.mjs` 已通过**：

1. 源保管库加密文件、导出 `.sfv`、创建 `.sfbackup`。
2. 全新浏览器上下文从备份恢复（新主口令）。
3. 刷新后重新解锁，验证密钥环 HMAC 完整性。
4. 导入旧 `.sfv`，用原容器口令解密成功。
5. 本机新建 `local.txt`，修改主口令（重包 1 个本地文件、跳过 1 个导入容器）。
6. 新口令解密 `local.txt` 成功；旧口令失败（`E_WRONG_PASSWORD`）。
7. 旧导入容器仍可用原口令解密。
8. 审计包含恢复备份、修改主口令、E_WRONG_PASSWORD 失败记录。

**`key-export-smoke.mjs` 已通过**：加密导出 `.sfkey` → 重新导入并切换签名密钥 → 成功提示。

**`dragdrop-smoke.mjs` 已通过**：

1. 用真实 `DataTransfer` 构造两个文件，依次触发 `dragenter`/`dragover`/`drop`。
2. 加密对话框收到两个文件；加密、签名、入库成功。
3. 篡改实验室“替换签名者证书”→ 符合预期 `E_CERT_UNTRUSTED`。

**`benchmark-report.mjs` 已通过**：1/10/100 MB + scrypt + 端到端，导出 `artifacts/benchmark-report.md`。

### 1.3 证据文件

| 文件 | 内容 |
| --- | --- |
| `artifacts/01-vault-empty.png` | 初次进入文件库 |
| `artifacts/02-vault-encrypted.png` | 加密对话框与已完成文件 |
| `artifacts/03-decrypt-success.png` | 正确口令解密 + 全阶段报告 |
| `artifacts/04-wrong-password.png` | 错误口令失败、不产生明文 |
| `artifacts/05-tamper-ciphertext.png` | 篡改密文 `E_AUTH_TAG` |
| `artifacts/06-tamper-signature.png` | 替换签名 `E_SIGNATURE` |
| `artifacts/07-keys-backup.png` | 密钥备份 |
| `artifacts/08-benchmark.png` | 1 MB 性能结果 |
| `artifacts/09-audit.png` | 审计日志 |
| `artifacts/10-source-vault.png` | 源保管库（备份前） |
| `artifacts/12-imported-decrypt.png` | 导入旧容器并用原口令解密 |
| `artifacts/13-password-changed.png` | 改口令重包结果 |
| `artifacts/14-new-password-decrypt.png` | 新口令解密本地文件 |
| `artifacts/15-audit-lifecycle.png` | 恢复/改口令/错误口令审计 |
| `artifacts/16-benchmark-full.png` | 1/10/100 MB 完整性能页 |
| `artifacts/benchmark-report.md` | 完整性能数据（可直接进报告） |
| `artifacts/17-key-export-import.png` | 私钥导出/导入 |
| `artifacts/18-dragdrop.png` | 真实拖拽两个文件加密入库 |
| `artifacts/19-tamper-certificate.png` | 替换签名者证书 `E_CERT_UNTRUSTED` |

> 这些证据由本地脚本生成，包含测试口令/测试密钥；不要把 `artifacts/*.sfbackup`、`*.sfkey` 当作真实生产密钥。提交报告时可直接使用截图与性能 Markdown。

## 2. 现场测试用例矩阵

| 编号 | 场景 | 操作 | 预期结果 | 证据 |
| --- | --- | --- | --- | --- |
| T01 | 错误口令解密失败 | 选中文件→解密→输入错误口令 | S3 失败，`E_WRONG_PASSWORD`；无下载；原文件仍可正确解密 | `04-wrong-password.png` |
| T02 | 篡改密文失败 | 实验室→目标文件→“篡改密文 1 字节”→输入正确口令→运行 | S5 失败，`E_AUTH_TAG`；无明文；可导出被篡改 `.sfv` | `05-tamper-ciphertext.png` |
| T03 | 替换签名失败 | 实验室→“替换签名”→运行 | S2 失败，`E_SIGNATURE`；不进入口令/解密 | `06-tamper-signature.png` |
| T04 | 拖拽文件加解密成功 | 拖入普通文件→加密；拖入 `.sfv`→导入；解密下载 | 文件入库；下载内容哈希一致 | 录屏/截图 + 系统 SHA-256 |
| T05 | 修改头部字段失败 | 实验室→“修改头部文件名” | 签名失败 `E_SIGNATURE`（或非规范 `E_NON_CANONICAL`） | 安全实验室报告 |
| T06 | 截断容器失败 | 实验室→“截断容器” | 解析失败 `E_CONTAINER_PARSE` | 报告 |
| T07 | 交换/跨文件分块失败 | 实验室→“交换两个分块”/“跨文件替换分块” | S5 `E_AUTH_TAG` | 报告 |
| T08 | 替换签名者证书失败 | 实验室→“替换签名者证书” | S1 `E_CERT_UNTRUSTED`；显示攻击者指纹 | 报告/截图 |
| T09 | 私钥导出/导入 | 导出 `.sfkey`（错误口令应失败）；重新导入 | 私钥不以明文落盘；错误口令失败；正确导入成功 | `17-key-export-import.png` |
| T10 | 备份/恢复 | 创建 `.sfbackup`→新浏览器上下文恢复→刷新→解锁→导入旧容器解密 | 恢复成功；刷新后可用新口令解锁；旧容器用原口令解密 | `restore-smoke.mjs` 输出 |
| T11 | SHA-1 弱碰撞演示（可选） | 对比 SHAttered 两个 PDF 的 SHA-1/SHA-256；用 SHA-1 选项加密 | SHA-1 相同、SHA-256 不同；UI 红色警告；签名仍 SHA-256 | 哈希对照截图 |
| T12 | 大文件性能 | 性能页跑 1/10/100 MB + 端到端 | 有进度、可取消；导出 Markdown | `benchmark-report.md` |
| T13 | 锁定/自动锁定 | 手动锁定；等待自动锁定；尝试解密 | 需重新输入口令；会话密钥清除 | 截图 |
| T14 | 恶意容器健壮性 | 导入随机字节/超长 header/超大 KDF 参数/未知算法 | 不崩溃；稳定错误码；参数上限拒绝 | 单元测试/手工 |
| T15 | 边界文件 | 空文件、Unicode 文件名、长文件名、同名文件 | 均可处理；文件名清洗；fileId 区分 | 单元测试 + 手工 |
| T16 | 错误口令后恢复 | T01 失败后再输入正确口令 | 正常解密；无状态污染 | 截图 |

## 3. 现场操作要点

### T01 错误口令

1. 文件库选择一个文件 → 解密。
2. 等待“验证通过（证书/签名）”后，输入错误口令。
3. 预期：红色“解密或验证失败，已阻止输出明文”，报告显示“校验口令 失败 `E_WRONG_PASSWORD`”；浏览器没有下载文件。
4. 关闭后重新解密，输入正确口令 → 成功。

### T02 篡改密文

1. 侧边栏“篡改实验室”→ 目标文件 → 篡改类型“篡改密文 1 字节”。
2. 输入**正确**保管库口令（因为需要走到 GCM 阶段）。
3. 运行 → 结果卡片“符合预期”，实际阶段“解密内容”，`E_AUTH_TAG`。
4. 可点“导出被篡改容器”，用十六进制编辑器展示被翻转载荷；原文件未被修改。

### T03 替换签名

1. 篡改类型“替换签名”→ 运行。
2. 预期：实际阶段“验证签名”，`E_SIGNATURE`；不需要口令。

### T04 拖拽

1. 从资源管理器一次拖入 2–3 个文件（含一个 >4 MiB 文件以展示多分块）。
2. 加密设置选 AES-256-GCM / SHA-256 → 开始。
3. 加密完成后，选中文件 → 解密 → 输入正确口令 → 下载。
4. 用系统 `certutil -hashfile <file> SHA256`（Windows）对比原始文件与下载文件。

### T08 证书替换

1. 篡改类型“替换签名者证书”→ 运行。
2. 预期：实际阶段“校验证书”，`E_CERT_UNTRUSTED`；报告里能看到攻击者证书的 SHA-256 指纹。
3. 解释：即使攻击者用自己的 RSA 私钥重签了头部，信任库指纹固定会拦截。

### T10 备份恢复

1. 密钥管理 → 创建备份（主口令 + 备份口令）。
2. 关闭/新开无痕窗口（或清除站点数据）→ “从备份恢复” → 备份口令 + 新主口令。
3. 恢复后刷新页面 → 用新主口令解锁。
4. 把之前导出的 `.sfv` 拖入 → 导入 → 用**原容器口令**解密。
5. 说明：备份不含文件内容；导入容器不重包。

## 4. 验收标准

- [x] T01–T04 全部通过；失败场景不产生明文下载。
- [x] 单元测试 25/25 通过；`npm run typecheck` 通过；`npm run build` 通过。
- [x] 浏览器冒烟：创建、加密、正确/错误口令、篡改密文、替换签名、备份、性能、审计。
- [x] 备份恢复/刷新解锁/导入旧容器/改口令重包/旧口令失败。
- [x] `.sfkey` 导出/导入。
- [x] 真实 DataTransfer 拖拽双文件加密 + 替换签名者证书。
- [x] 1/10/100 MB 性能数据导出。
- [x] 审计日志可导出，不含口令/密钥。

## 5. 测试环境

- Windows 11，Node 18.18（应用/单元测试）、Node 20.20（Playwright 脚本）。
- Edge 156 headless，1440×1000 视口。
- 生产构建 + `vite preview`（localhost 安全上下文）。
- 测试口令均为示例口令，不用于真实数据。
