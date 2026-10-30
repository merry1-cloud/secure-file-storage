# 01 · 整体架构与模块划分

## 1. 目标与非目标

**目标**

- 纯前端、单保管库、多文件的加密保险箱。
- 用户可选择对称算法（AES-128/256-GCM）、完整性哈希（SHA-256/SHA-1）与 KDF 档位。
- 文件内容分块加密，支持大文件进度、取消与 IndexedDB 流式写入。
- 每个文件有独立随机 DEK；主口令通过 PBKDF2/scrypt + HKDF 派生保管库密钥。
- RSA-3072 对规范化清单签名；下载先验证书/签名，再解密，最后核对内容哈希。
- 四项密钥管理：安全存储、私钥加密导出、备份/恢复、自签名 X.509 + 指纹信任。
- 安全实验室：内存副本上一键复现篡改、错误口令、证书替换等攻击。
- 性能页、审计页、中文 GUI、文件拖拽。

**非目标**

- 服务端、多用户权限、云同步、真实 CA/PKI、抗回滚、安全删除、隐藏元数据、抗已失陷终端。
- 生产级侧信道/内存擦除保证。
- 对超大文件（>4 GiB 或超出浏览器配额）的分卷/流式落盘。

## 2. 分层架构

```
┌──────────────────────────────────────────────────────────────┐
│ React UI（Ant Design 5，中文）                                 │
│ 文件库 / 密钥管理 / 篡改实验室 / 性能 / 审计 / 设置              │
│ features + components + hooks                                 │
└───────────────────────────┬──────────────────────────────────┘
                            │ Zustand: session / vault / settings
┌───────────────────────────▼──────────────────────────────────┐
│ 应用编排层                                                     │
│ useEncryptJob / useDecryptJob / Key dialogs / Audit            │
│ 只做任务编排、进度、错误映射；不实现密码学                        │
└───────────────┬──────────────────────────────┬───────────────┘
                │                              │
┌───────────────▼──────────────┐   ┌───────────▼───────────────┐
│ crypto.worker.ts             │   │ 主线程 KDF / 密钥管理        │
│ 分块 AES-GCM、流式哈希、验签、  │   │ PBKDF2/scrypt/HKDF、解锁、   │
│ 容器解析、性能基准              │   │ 导出/备份/恢复/改口令/证书    │
│ 进度、取消、CryptoKey 传递      │   │ 口令不发送到 worker           │
└───────────────┬──────────────┘   └───────────┬───────────────┘
                │                              │
┌───────────────▼──────────────────────────────▼───────────────┐
│ core 领域层（纯 TypeScript，可在 Node 中单测）                  │
│ crypto primitives / envelope / manifest / vault / keys        │
│ storage repositories（IndexedDB 适配器）                        │
│ validation（zod schema、上限、口令策略）                         │
└──────────────────────────────────────────────────────────────┘
```

### 模块职责

| 模块 | 职责 | 明确不做 |
| --- | --- | --- |
| `core/crypto` | AES-GCM、PBKDF2、scrypt、HKDF、HMAC、SHA-256/SHA-1、RSA、随机、编码 | 不读写 IndexedDB、不涉及 React |
| `core/envelope` | VMK/fileKEK/DEK 层级、DEK 包装/解包/重包、私钥包装/解包 | 不管理 UI 状态 |
| `core/manifest` | zod 严格 schema、规范化 JSON、清单签名/验签 | 不加密文件分块 |
| `core/vault` | 容器格式、分块加密/解密、验证流水线、导入导出、篡改矩阵 | 不渲染界面 |
| `core/keys` | 密钥环、证书、信任库、私钥导出/导入、备份/恢复、改口令 | 不直接操作 React |
| `core/storage` | IndexedDB schema、文件/分块/密钥/信任/审计/基准 repo | 不含密码学逻辑 |
| `core/validation` | 参数上限、口令策略、bundle schema、文件名清洗 | 不静默吞错 |
| `core/benchmark` | KDF/AES/哈希/RSA/端到端基准 | 不依赖 DOM |
| `workers` | 任务协议、进度、取消、CryptoKey 传递、Worker 客户端 | 不接收明文口令 |
| `features` | 页面、表单、拖拽、验证报告、密钥流程 | 不直接调用 WebCrypto |
| `store` | 会话锁定、文件列表、设置（持久化到 localStorage 的仅非敏感项） | 不持久化密钥/口令 |
| `lib` | 格式化、下载、错误映射、报告导出 | 不实现密码学 |

**硬性规则**

- 任何密码学操作只出现在 `core/**`。
- React 组件不直接调用 `crypto.subtle`。
- Worker 不 import antd，不接收口令字符串。
- 存储层不 import crypto；vault/keys 通过 repo 接口访问存储。
- 每个文件单一职责，避免“万能文件”。

## 3. 密钥层级

```
主口令 P（UTF-8 NFC，完整参与，不截断）
        │ PBKDF2-HMAC-SHA-256(P, vaultSalt, 600k) 或 scrypt(N=2^17)
        ▼
      IKM（256 bit，用后 best-effort 清零）
        │ HKDF-SHA-256，info 域分离
        ├── "SFV-VMK-v1"        → VMK（非可导出 HKDF CryptoKey）
        ├── "SFV-KEYRING-v1"    → keyringKey（AES-GCM，包装 RSA 私钥）
        └── "SFV-KCV-KEY-v1"    → KCVKey（HMAC-SHA-256，口令校验值）

每个文件：
fileSalt(16B 随机)
VMK + fileSalt --HKDF("SFV-FILE-KEK-v1")--> fileKEK（AES-GCM）
DEK(32/16B 随机) --AES-GCM(fileKEK, wrapIv, AAD=fileId)--> wrappedDEK
DEK --AES-GCM(chunk IV, AAD=fileId/index/chunkCount/len/fileNonce)--> 密文

RSA 私钥(PKCS#8) --AES-GCM(keyringKey, AAD="SFV-RSA-PRIV-v1")--> wrappedPrivateKey
RSA 公钥 → 自签名 X.509 证书；SHA-256(DER) = 指纹
```

设计理由：

- PBKDF2/scrypt 只在解锁/口令验证时运行一次；文件间通过随机 `fileSalt` + HKDF 做密钥隔离。
- 换主口令只需解开并重包 `wrappedDEK` 和 RSA 私钥，不需要重新加密文件内容。
- 容器携带 `vaultSalt`、KDF 参数、`fileSalt`、`KCV`，可脱离原 IndexedDB，在另一实例凭原口令解密。
- 导入的外部容器不需要重新加密；其清单中的 KDF/KCV 仍指向原保管库口令。

## 4. 上传数据流

1. DropZone 产生 `File[]`；`.sfv` 进入导入，普通文件进入加密对话框。
2. 主线程从会话取 VMK 与 RSA 私钥 CryptoKey（不可导出）。
3. Worker 生成/接收 `fileId`、`fileNonce`、`fileSalt`，派生 `fileKEK`，生成随机 DEK 并包装。
4. 每 4 MiB 一块：读取 → 流式哈希 → 构造 IV/AAD → AES-GCM → 通过 `putChunk` 写入 IndexedDB。
5. 全部块完成后，主/Worker 构造规范化清单，RSA 签名，`commitFile` 写入元数据/签名。
6. 失败/取消：删除该 fileId 的 pending 元数据与分块；启动时清理 15 分钟前的遗留 pending。

## 5. 下载数据流

1. 主线程从 IndexedDB 读取清单/签名/分块（或从导入容器读取）。
2. `verifyContainer` / `verifyEnvelope`：
   - S0 解析容器（导入容器）或读取已解析清单（本地文件）；
   - S1 解析证书 → 指纹必须等于清单 `signer.certSha256` → 有效期覆盖 `signedAt` → 信任库固定；
   - S2 用证书公钥验证 RSA 签名；失败不进入解密。
3. 主线程执行 KDF/KCV 校验（或使用已解锁会话 VMK）。
4. Worker 派生 `fileKEK`、解包 DEK、逐块 AES-GCM 解密、流式重算内容哈希。
5. 哈希与签名清单一致才组装 Blob 并下载；任何阶段失败都不产生明文文件。
6. 验证报告逐阶段记录耗时、状态、错误码，可复制 Markdown/JSON 用于报告。

## 6. Worker 协议

- 请求：`encryptFile`、`decryptFile`、`storeContainer`、`exportContainer`、`benchmark`、`cancel`。
- 事件：`progress`（stage/done/total）、`done`、`error`（稳定错误码 + 阶段 + 报告）。
- 口令**不进入 Worker**：主线程完成 PBKDF2/scrypt/KCV 后，只传 VMK CryptoKey。
- CryptoKey 通过 structured clone 传入；Chrome/Edge 支持。若 Worker 不可用，当前版本会给出明确错误，不静默降级。
- 取消：Worker 在块边界检查取消标志；加密任务取消后删除 pending 文件与分块。

## 7. IndexedDB schema

| Store | Key | 内容 |
| --- | --- | --- |
| `files` | `id` | 状态 pending/committed、文件名/大小/MIME、算法、清单、headerBytes、signature、签名者指纹、来源 |
| `chunks` | `[fileId, index]` | 加密分块 Blob（含 GCM tag） |
| `keys` | `'primary'` | 公钥 JWK、证书 PEM、指纹、加密后的 PKCS#8、KDF 参数、KCV、密钥环 HMAC 完整性 |
| `trust` | `fingerprint` | 信任证书（主题、PEM、来源、加入时间） |
| `audit` | autoIncrement | 操作、结果、阶段、错误码、文件 ID、详情（无密钥/口令） |
| `benchmarks` | `id` | 环境、结果数组 |
| `settings` | `key` | 非敏感设置（当前主要使用 localStorage） |

## 8. 失败语义

- 任何验证阶段失败都抛出带 `code`、`stage`、`report` 的 `AppError`；UI 展示失败阶段与错误码。
- 失败场景不会创建下载 Blob；解密中的明文分块数组在失败分支中被 best-effort 清零。
- 加密失败/取消会回滚 pending 文件与分块。
- 审计失败不阻断主流程，仅 `console.warn`；日志不含秘密。

## 9. 扩展点

- 存储适配器接口可替换为 HTTP/后端存储（当前纯前端）。
- `KDF_PROFILES` 可增加参数档位；`KdfParams` 联合类型可扩展 Argon2（需引入库）。
- 信任库已支持多证书；RSA 轮换可通过导入/恢复另一把 `.sfkey`/`.sfbackup` 实现，旧证书保留以验证旧文件。
- 审计可增加哈希链或远程不可篡改存储。
