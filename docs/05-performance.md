# 05 · 性能数据

## 1. 测试环境

| 项目 | 值 |
| --- | --- |
| 时间 | 2026-10-26 10:49（本机） |
| 浏览器 | Microsoft Edge 156.0.0.0（HeadlessChrome/156，Windows 11） |
| 逻辑核心 | 16 |
| 设备内存 | 16 GiB |
| 页面 | 生产构建 + `vite preview`（localhost，安全上下文） |
| 数据集 | 1 / 10 / 100 MiB，随机 1 MiB 种子重复拼接 |
| 统计 | 预热 1 次 + 正式 3 次取中位数（端到端 1/10 MB 2 次、100 MB 1 次） |

> 这是开发机上的参考数据。报告应在本机重新跑一次“性能测试”页并导出 Markdown，使用自己的环境数据。

## 2. 完整结果

原始文件：[`artifacts/benchmark-report.md`](../artifacts/benchmark-report.md)

| 项目 | 文件大小 | 中位耗时 | 吞吐 | 迭代 | 备注 |
| --- | ---: | ---: | ---: | ---: | --- |
| AES-256-GCM 加密 | 1 MiB | 1.1 ms | 909.1 MiB/s | — | |
| AES-256-GCM 解密 | 1 MiB | 1.2 ms | 833.3 MiB/s | — | |
| SHA-256 流式哈希 | 1 MiB | 3.4 ms | 294.1 MiB/s | — | |
| SHA-1 流式哈希 | 1 MiB | 1.6 ms | 625.0 MiB/s | — | |
| AES-256-GCM 加密 | 10 MiB | 11.4 ms | 877.2 MiB/s | — | |
| AES-256-GCM 解密 | 10 MiB | 12.1 ms | 826.4 MiB/s | — | |
| SHA-256 流式哈希 | 10 MiB | 33.5 ms | 298.5 MiB/s | — | |
| SHA-1 流式哈希 | 10 MiB | 17.7 ms | 565.0 MiB/s | — | |
| AES-256-GCM 加密 | 100 MiB | 121.7 ms | 821.7 MiB/s | — | |
| AES-256-GCM 解密 | 100 MiB | 223.2 ms | 448.0 MiB/s | — | |
| SHA-256 流式哈希 | 100 MiB | 765.7 ms | 130.6 MiB/s | — | |
| SHA-1 流式哈希 | 100 MiB | 365.3 ms | 273.7 MiB/s | — | |
| PBKDF2-HMAC-SHA256 100,000 次 | — | 31.1 ms | — | 100000 | 含 HKDF 派生 VMK/keyringKey/KCV |
| PBKDF2-HMAC-SHA256 300,000 次 | — | 78.4 ms | — | 300000 | 同上 |
| PBKDF2-HMAC-SHA256 600,000 次 | — | 177.8 ms | — | 600000 | 同上 |
| PBKDF2-HMAC-SHA256 1,000,000 次 | — | 297.5 ms | — | 1000000 | 同上 |
| scrypt N=2^15 r=8 p=1 | — | 144.6 ms | — | 1 | 内存约 32 MiB |
| scrypt N=2^17 r=8 p=1 | — | 637.2 ms | — | 1 | 内存约 128 MiB |
| RSA-3072 密钥生成 | — | 469.8 ms | — | 2 | |
| RSA-3072 PKCS#1 v1.5 签名 | — | 6.6 ms | — | 20 | |
| RSA-3072 PKCS#1 v1.5 验签 | — | 0.10 ms | — | 20 | |
| 端到端加密（读取+哈希+AES+签名） | 1 MiB | 25.8 ms | 38.8 MiB/s | — | 内存分块 sink，不含 IDB 写入 |
| 端到端解密（AES+完整性） | 1 MiB | 14.9 ms | 67.3 MiB/s | — | 不含下载落盘 |
| 端到端加密（读取+哈希+AES+签名） | 10 MiB | 141.5 ms | 70.7 MiB/s | — | |
| 端到端解密（AES+完整性） | 10 MiB | 130.7 ms | 76.5 MiB/s | — | |
| 端到端加密（读取+哈希+AES+签名） | 100 MiB | 1.23 s | 81.5 MiB/s | — | |
| 端到端解密（AES+完整性） | 100 MiB | 1.16 s | 86.2 MiB/s | — | |

## 3. 结果解读

- **AES-GCM 原生吞吐很高**：1–10 MiB 约 0.8–0.9 GiB/s；100 MiB 加密 122 ms（822 MiB/s），解密 223 ms（448 MiB/s）。解密变慢与 100 MiB 数据/Blob/GC 的内存压力有关，不是算法本身变慢。
- **SHA-1 比 SHA-256 快约 2 倍**，但 SHA-1 已有实际碰撞（SHAttered）。本项目把它作为“弱哈希演示”选项，签名摘要仍固定 SHA-256，不随内容哈希降级。
- **PBKDF2 600k 在 Edge 上约 178 ms**，1M 约 298 ms；适合交互式解锁。若目标机器较慢，可使用 300k 档，或在报告里给出实测。
- **scrypt N=2^17 约 637 ms、约 128 MiB 内存**，抗 GPU 更强；低配设备可选 N=2^15（约 145 ms、32 MiB）。
- **RSA-3072 密钥生成约 470 ms**（只发生一次），签名约 6.6 ms，验签约 0.1 ms；每次加密都要签名，但相对文件 IO 很小。
- **端到端 100 MiB 加密约 1.23 s（81.5 MiB/s），解密约 1.16 s（86.2 MiB/s）**。这个数字包含 Blob 读取、流式哈希、AES-GCM、RSA 签名/完整性校验，但不含 IndexedDB 写入/读取与浏览器下载落盘；实际 UI 操作会额外增加 IDB 时间。
- 分块固定 4 MiB；100 MiB = 25 块。分块过小会增加每块 GCM/JS 开销，过大则影响内存、进度粒度与取消响应。

## 4. 与安全参数的关系

- 默认 PBKDF2 600k 在实测机上解锁约 0.18 s；10 分钟自动锁定不会造成明显操作负担。
- 如果选择 scrypt 2^17，解锁约 0.64 s、128 MiB 内存；低配浏览器可能触发卡顿，建议 2^15。
- RSA-3072 只在创建保管库时生成一次；用户感知约半秒。签名/验签不是性能瓶颈。
- 大文件的主要成本是哈希 + AES + Blob/IDB；KDF 只与解锁次数有关。

## 5. 复现方式

1. `npm run build && npm run preview -- --host 127.0.0.1 --port 4173`
2. 打开 `http://127.0.0.1:4173`，创建保管库。
3. 侧边栏“性能测试”，勾选 1/10/100 MB、scrypt、端到端。
4. 点击“开始性能测试”，完成后“导出 Markdown”。
5. 或运行脚本（需要 Node 20 + Edge）：

```bash
npx -y node@20 scripts/benchmark-report.mjs
# 输出 artifacts/benchmark-report.md
```

## 6. 测量方法说明

- 原始 AES/哈希基准：在同一进程/Worker 中重复操作内存数据，预热后取中位数。
- 端到端基准：使用真实的 `encryptFile` / `verifyContainer` / `decryptFile` 流程；分块通过内存 sink 收集，不写 IndexedDB，以隔离存储 I/O 对密码学性能的影响。
- 未测量：浏览器下载落盘时间、IndexedDB 写入/读取、UI 渲染、自动锁定、KDF 与 IDB 并发。
- 环境中 `crossOriginIsolated=false`；未使用 SharedArrayBuffer/多线程 WASM。
- Headless 环境可能影响 CPU 调度；报告数据以本机实测为准。
