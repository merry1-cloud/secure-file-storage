# SecureFile Vault — 安全文件存储系统

课程项目 3：一个**纯前端**的安全文件存储系统。用户拖拽文件后，系统在浏览器内完成 AES-GCM 分块加密、SHA-256/SHA-1 完整性哈希、PBKDF2/scrypt 口令派生、RSA-3072 签名与 X.509 证书认证；解密时严格按“解析 → 校验证书 → 验签 → 校验口令 → 解包 DEK → AES-GCM → 内容哈希”执行，任一阶段失败都不会生成明文下载文件。

> 这是一个课程演示项目，不是生产级密码产品。自签名证书、SHA-1 演示、JS 内存擦除、元数据明文等局限见 [docs/06-security-limitations.md](docs/06-security-limitations.md)。

## 功能与题目要求对应

| 题目要求 | 实现 |
| --- | --- |
| AES 等对称加密 | AES-256-GCM（默认）/ AES-128-GCM；4 MiB 分块；每文件独立随机 DEK |
| SHA-256 / SHA-1 完整性 | 流式 SHA-256 默认，SHA-1 可选并标注不安全；解密时重算哈希并与签名清单比对 |
| PBKDF2/scrypt 派生，不截断口令 | PBKDF2-HMAC-SHA-256 600,000 次（默认）或 scrypt N=2^17；完整 UTF-8 NFC 口令参与 KDF |
| RSA 公私钥数字签名 | RSA-3072 + RSASSA-PKCS1-v1_5 + SHA-256，签名覆盖规范化清单 |
| 下载时验签，现场篡改必须失败 | 先验证书与签名，再解密；安全实验室可一键翻转密文、替换签名/证书、改头部、截断/重排分块 |
| 密钥管理（至少两项） | 四项全做：加密存储、私钥加密导出、备份/恢复、自签名 X.509 证书 + SHA-256 指纹信任库 |
| 错误口令解密失败 | KCV（HMAC-SHA-256）在派生后立即校验，错误口令精确失败；不尝试解密 |
| 拖拽文件加解密 | 文件库 DropZone 支持多文件拖拽；`.sfv` 容器拖入后走导入/验签流程 |
| 性能数据（大文件） | 内置性能页：1/10/100 MB AES/哈希/RSA/端到端；结果可导出 Markdown/CSV |
| 安全局限 | 报告素材与文档列出 SHA-1、TOFU、内存、元数据、抗回滚等至少 6 条 |

## 技术栈

- React 18 + TypeScript（strict）+ Vite 5
- Ant Design 5（中文界面）
- WebCrypto：AES-GCM、PBKDF2、HKDF、HMAC、RSA
- `hash-wasm`：流式 SHA-256/SHA-1、scrypt
- `@peculiar/x509`：自签名 X.509 证书生成/解析
- IndexedDB + `idb`：密文分块、密钥环、信任库、审计、性能结果
- `zod`：容器/备份/导出文件严格 schema 校验
- Web Worker：分块加解密、哈希、验签、性能测试，避免阻塞界面
- Vitest：25 个单元/集成测试

## 快速开始

环境建议：

- **Node 20/22 LTS 推荐**。项目本身可在 Node 18.18 上开发、构建与跑单元测试（Vite 5.4）。
- 浏览器：Chrome / Edge 最新版；WebCrypto 需要 `https://` 或 `http://localhost`。
- 首次运行 `npm install`。

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # 25 个单元/集成测试
npm run typecheck  # 应用 + 测试 TypeScript 检查
npm run build      # 生产构建
npm run preview    # 预览生产构建
```

> 直接在 `file://` 打开 `dist/index.html` 不可用：浏览器会禁用 WebCrypto/IndexedDB 的部分能力。请使用 Vite dev/preview。

## 桌面版（Windows 单文件 exe）

除了浏览器版，本项目还提供 Electron 桌面版，打包成**单个便携 exe**，目标电脑不需要 Node、Python 或浏览器。

```bash
# 开发模式下启动桌面窗口（会先构建 dist）
npm run electron:run

# 打包便携版 exe
npm run electron:dist
```

输出文件：

```text
release/SecureFileVault-0.1.0-portable.exe
```

把该 exe 拷到另一台 Windows 10/11 x64 电脑，双击即可运行。

**重要说明：**

- 桌面版数据在 `C:\Users\<用户名>\AppData\Roaming\SecureFileVault`，不在浏览器 IndexedDB 里。浏览器版和桌面版是两套独立保管库。
- 迁移数据：在旧版本里导出 `.sfbackup` 和 `.sfv`，在桌面版里“从备份恢复”+ 拖入 `.sfv`。
- 删除 `SecureFileVault` 数据目录会丢失保管库；请定期备份。
- exe 未做商业代码签名，首次运行可能出现 Windows SmartScreen “未知发布者”提示，可点“更多信息 → 仍要运行”。部分杀毒软件也可能对未签名 Electron 包误报。
- exe 约 77 MB，因为内含 Chromium；不需要安装 WebView2/Node。
- 桌面版通过固定的 `app://secure-file-vault` 安全协议加载，WebCrypto、Web Worker、IndexedDB 与浏览器版一致；刷新/重启后是同一个保管库。

## 使用流程

1. **创建保管库**：设置显示名称、主口令、KDF 档位（PBKDF2 600k / 300k / scrypt 2^17 / 2^15）。系统生成 RSA-3072 密钥对与自签名 X.509 证书，并自动加入信任库。
2. **拖拽加密**：把普通文件拖入文件库，选择 AES-128/256-GCM 与 SHA-256/SHA-1，点击“开始加密”。系统逐块加密、流式哈希、签名清单，并以 pending→commit 两阶段写入 IndexedDB。
3. **解密下载**：点击文件“解密”，先解析/验证书/验签，再输入口令。验证报告逐阶段显示通过/失败与耗时；失败不会生成下载文件。
4. **密钥管理**：导出证书/公钥、加密导出 RSA 私钥（`.sfkey`）、创建密钥备份（`.sfbackup`）、从备份/私钥恢复、修改主口令并重包本地文件 DEK。
5. **篡改实验室**：对内存副本执行 9 类攻击，查看“预期 vs 实际”阶段与错误码；可导出被篡改的 `.sfv` 用十六进制编辑器复现。
6. **性能测试**：选择 1/10/100 MB，跑 AES/哈希/PBKDF2/scrypt/RSA/端到端基准，导出 Markdown/CSV。
7. **审计日志**：查看加密、解密、验证、导入/导出、改口令、篡改实验等元数据；可导出 JSON。

## 数据与备份

- 所有密文、密钥环、信任库、审计日志保存在浏览器 **IndexedDB**；没有后端，不会上传服务器。
- 主口令、VMK、DEK 不写入磁盘；解锁后以不可导出的 `CryptoKey` 形式存在于内存。
- **清除站点数据会丢失保管库和文件**。请定期：
  - 用“创建密钥备份”导出 `.sfbackup`；
  - 用文件“导出”逐个导出 `.sfv` 容器；
  - 或加密导出 `.sfkey`。
- 备份文件不包含文件内容，只包含密钥、证书与信任库。
- 导入的外部 `.sfv` 容器使用**容器创建时的原口令**解密；修改本机主口令不会改变导入容器。

## 项目结构

```
src/
  core/                 纯 TypeScript 领域层（无 React）
    crypto/             AES/PBKDF2/scrypt/HKDF/HMAC/SHA/RSA/编码/随机
    envelope/           VMK/fileKEK/DEK、私钥包装、文件密钥解包
    manifest/           zod schema、规范化 JSON、签名/验签
    vault/              容器格式、分块加密/解密、验证流水线、导入导出、篡改
    keys/               密钥环、X.509 证书、信任库、导出/备份/恢复、改口令
    storage/            IndexedDB schema 与 repos（文件/分块/密钥/信任/审计/基准）
    benchmark/          性能基准实现
    validation/         参数上限、口令策略、bundle schema
    audit/              审计服务
  workers/              Worker 协议、加解密任务、进度/取消
  features/             React 页面：文件库/密钥/篡改实验室/性能/审计/设置
  components/           布局与通用 UI（指纹、验证报告、密码强度）
  store/                Zustand：会话/文件库/设置
  lib/                  格式化、下载、错误、报告
  styles/               全局样式
docs/                   威胁模型/生命周期/参数/性能/局限/测试/演示
tests/                  Vitest 单元与集成测试
scripts/                Playwright + Edge 浏览器冒烟/性能脚本
electron/               Electron 主进程（桌面窗口、app:// 静态协议、CSP）
build/                  应用图标（icon.png / icon.ico）
release/                electron-builder 输出的便携 exe（本地生成）
artifacts/              测试截图、完整性能报告、演示用导出文件（本地生成）
```

## 测试与证据

### 单元/集成测试

```bash
npm test
```

覆盖：SHA-256/SHA-1 KAT、AES-GCM round-trip/篡改、PBKDF2 公开向量与 Node 对照、scrypt RFC 7914、RSA 签名/验签、容器 round-trip（空文件/单块/跨块）、错误口令、密文翻转、签名替换、头部修改、截断、分块重排、跨文件分块、证书未信任、SHA-1 内容哈希、随机数大缓冲区、性能基准核心流程。

### 浏览器冒烟（可选，需要 Node 20 + Edge）

先启动生产预览：

```bash
npm run build
npm run preview -- --host 127.0.0.1 --port 4173
```

另开终端：

```bash
# 全流程：创建、拖拽加密、正确/错误口令、篡改密文、替换签名、备份、性能、审计
npx -y node@20 scripts/ui-smoke.mjs

# 备份恢复 + 导入旧容器 + 修改主口令重包 + 旧口令失败 + 审计
npx -y node@20 scripts/restore-smoke.mjs

# 私钥 .sfkey 加密导出与重新导入
npx -y node@20 scripts/key-export-smoke.mjs

# 真实 DataTransfer 拖拽（两个文件）+ 替换签名者证书
npx -y node@20 scripts/dragdrop-smoke.mjs

# 1/10/100 MB 完整性能报告（导出 artifacts/benchmark-report.md）
npx -y node@20 scripts/benchmark-report.mjs

# Electron 桌面窗口冒烟（创建、加密、解密、刷新解锁）
npm run test:electron
```

也可以使用 `npm run test:ui`、`npm run test:ui:restore`、`npm run test:ui:key-export`、`npm run test:ui:dragdrop`、`npm run benchmark:report`（脚本内部用 `npx -y node@20`）。

脚本默认使用 `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`，可用 `EDGE_PATH` 覆盖；`playwright-core` 作为 devDependency 安装。若本机 Node 已是 20+，可直接 `node scripts/...`。

截图与性能报告在 `artifacts/`，可直接用于课程报告。手工测试矩阵见 [docs/07-test-plan.md](docs/07-test-plan.md)。

## 文档

- [01 架构与模块划分](docs/01-architecture.md)
- [02 威胁模型](docs/02-threat-model.md)
- [03 密钥生命周期](docs/03-key-lifecycle.md)
- [04 算法参数](docs/04-algorithm-parameters.md)
- [05 性能数据](docs/05-performance.md)
- [06 安全局限](docs/06-security-limitations.md)
- [07 现场测试计划](docs/07-test-plan.md)
- [08 现场演示脚本](docs/08-demo-script.md)
- [09 报告写作提纲](docs/09-report-outline.md)

## 已知安全局限（摘要）

1. SHA-1 已有实际碰撞（SHAttered），仅作演示/兼容；签名摘要始终 SHA-256。
2. 自签名 X.509 + TOFU：没有 CA 身份背书、没有 CRL/OCSP 吊销；首次信任可能被替换证书利用。
3. JS/浏览器无法保证密钥、口令、明文在 GC 前被擦除；XSS/恶意扩展可绕过。
4. 文件名、大小、MIME 等元数据以明文存储/出现在容器头中。
5. 没有抗回滚/新鲜性：旧的合法容器可被重放。
6. 安全删除无法保证（IndexedDB/SSD 磨损均衡）。
7. RSA 使用 PKCS#1 v1.5 而非 PSS（为证书生成/验证兼容性）；报告给出迁移讨论。
8. 证书有效期与 `signedAt` 依赖本机时钟。
9. PBKDF2 离线猜测、KCV 校验 oracle、无 HSM/速率限制。
10. 纯前端没有服务端访问控制；单用户、单保管库。

完整分析见 [docs/06-security-limitations.md](docs/06-security-limitations.md)。
