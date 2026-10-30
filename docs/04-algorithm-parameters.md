# 04 · 算法参数与格式

## 1. 参数总表

| 用途 | 算法/参数 | 说明 |
| --- | --- | --- |
| 对称加密 | AES-256-GCM（默认）；AES-128-GCM 可选 | AEAD，128 位认证标签 |
| 分块大小 | 4 MiB | 控制内存、进度、分块篡改定位 |
| GCM IV | 96 位 = 64 位随机 fileNonce + 32 位块计数器 | 同一 DEK 下唯一；单文件最多 2^32 块 |
| 分块 AAD | `SFV-CHUNK-v1` + fileId + index + chunkCount + plaintextLength + fileNonce | 绑定位置/长度/文件 |
| DEK 包装 AAD | `SFV-DEK-v1` + fileId + 容器版本 | 防止跨文件替换 wrappedDEK |
| 内容哈希 | SHA-256 默认；SHA-1 可选（红色警告） | 流式；签名摘要始终 SHA-256 |
| 口令 KDF | PBKDF2-HMAC-SHA-256，600,000 次，16B salt，256-bit 输出 | OWASP 2023 推荐量级 |
| 可选 KDF | scrypt N=2^17, r=8, p=1（128 MiB）；低配 N=2^15（32 MiB） | 抗 GPU/ASIC 更强 |
| 密钥分离 | PBKDF2/scrypt 输出 → HKDF-SHA-256，info 域分离 | VMK / keyringKey / KCVKey |
| 文件密钥 | 每文件随机 DEK 32/16 B；fileSalt 16 B | 文件间隔离 |
| KCV | HMAC-SHA-256(KCVKey, 域标签 + vaultSalt) | 错误口令精确失败 |
| 密钥环完整性 | HMAC-SHA-256(KCVKey, 规范化密钥环字段) | 检测本地静默替换 |
| 签名 | RSA-3072，RSASSA-PKCS1-v1_5 + SHA-256 | 384 B 签名 |
| 证书 | 自签名 X.509，SHA-256 指纹，有效期 2 年 | `basicConstraints CA=false`，`keyUsage digitalSignature` |
| 随机源 | `crypto.getRandomValues`，>65,536 B 分段 | salt/IV/DEK/serial/fileId |
| 口令处理 | UTF-8 NFC，8–1024 字符，完整参与 KDF，不截断 | 最大长度防 DoS |
| 容器头 | 规范化 JSON，≤1 MiB | 固定 schema、排序键、逐字节对比 |
| 分块/文件上限 | chunkCount ≤ 4096；文件 ≤4 GiB | 浏览器配额另有限制 |

## 2. 为什么用 AES-GCM + 分块

- GCM 同时提供机密性与完整性；无需另做 HMAC。
- 4 MiB 分块让 WebCrypto 每次只处理有限内存，可显示进度、取消，并能定位被篡改的块。
- IV 由 64 位随机 `fileNonce` + 32 位计数器组成；每个文件独立 DEK，故不重用密钥/IV。
- AAD 覆盖 fileId、index、chunkCount、明文长度、fileNonce：
  - 换块/删块/截断/跨文件搬块都会使 GCM 认证失败。
  - 只改头部长度字段也会在容器解析阶段失败。
- 每文件独立 `fileSalt` + HKDF 派生 `fileKEK`，避免所有文件共用一把包装密钥。

## 3. PBKDF2 / scrypt 与口令

- 主口令先做 NFC 规范化，编码为 UTF-8，完整参与 KDF；不做截断/取前 N 位。
- PBKDF2-HMAC-SHA-256 600,000 次，salt 16 B；输出 256 bit IKM。
- HKDF-SHA-256 用同一 vaultSalt，但不同 `info` 派生：
  - VMK；keyringKey；KCVKey。
- scrypt 可选 N=2^17/r=8/p=1（约 128 MiB）或 N=2^15（约 32 MiB）；参数在导入时做上限校验，防止恶意容器用 N=2^30 造成 DoS。
- 口令策略：至少 8 位（建议 12+），最多 1024 字符；UI 只做字符集熵估算，不做字典/泄露口令检测（局限）。
- KCV 允许 UI 精确区分“口令错误”和“数据损坏”，但等于给离线攻击者一个快速校验值；抗暴力仍取决于 KDF 成本与口令强度。

## 4. 规范化清单与签名

签名输入：

```
UTF8("SFV-MANIFEST-v1\n") || headerBytes
```

`headerBytes` 是清单的规范化 JSON（键排序、无空白、固定 schema）。验签前先：

1. 严格 zod schema 校验（拒绝未知字段/类型/越界值）；
2. 重新规范化并逐字节比较，拒绝重复键/非规范编码；
3. 解析证书，校验 `signer.certSha256/subject/serialNumber` 与证书一致；
4. 校验证书有效期覆盖 `signedAt`；
5. 校验证书指纹在信任库；
6. 用证书公钥验证 RSA 签名。

清单字段（全部被签名）：

- `formatVersion`、`fileId`、`filename`、`mime`、`size`、`createdAt`、`signedAt`
- `cipher`: `alg`、`keyBits`、`chunkSize`、`chunkCount`、`fileNonce`
- `hash`: `alg`、`contentHash`
- `kdf`: 算法、salt、迭代/N/r/p、dkLen
- `fileSalt`、`kcv`、`wrappedDek`、`wrapIv`
- `signer`: `subject`、`serialNumber`、`certPem`、`certSha256`
- `signatureAlg`（只允许 `RSASSA-PKCS1-v1_5-SHA-256`）
- `appVersion`

**为什么签清单而不是直接签密文**

- 签名同时覆盖算法、KDF 参数、wrappedDEK、内容哈希和证书指纹，防止算法降级/参数替换。
- 密文本身由 GCM tag 完整性保护；明文哈希再与签名值比对，形成“签名者当时认证的内容”这一语义。
- 先验签后解密：签名失败时不接触明文/不派生 DEK。

## 5. 验证顺序

| 阶段 | 动作 | 错误码 |
| --- | --- | --- |
| S0 解析 | magic/version/长度/总大小/schema/规范化字节 | `E_CONTAINER_PARSE` / `E_SCHEMA` / `E_NON_CANONICAL` |
| S1 证书 | 解析、指纹/主题/序列匹配、有效期、信任库 | `E_CERT_UNTRUSTED` / `E_CERT_EXPIRED` |
| S2 签名 | 证书公钥验 RSA 签名 | `E_SIGNATURE` |
| S3 口令 | KDF → HKDF → KCV 常数时间比较 | `E_WRONG_PASSWORD` |
| S4 解包 | VMK+fileSalt → fileKEK → DEK（AAD=fileId） | `E_DEK_UNWRAP` |
| S5 解密 | 逐块 AES-GCM（IV/AAD 重建） | `E_AUTH_TAG` / `E_CHUNK_ORDER` |
| S6 完整性 | 流式重算内容哈希，与签名清单比对 | `E_HASH_MISMATCH` |
| S7 输出 | 组装 Blob、下载、审计 | `E_DOWNLOAD` |

失败即中止；S5/S6 失败时不会创建下载 Blob。

## 6. `.sfv` 容器格式

```
偏移 0      magic "SFV1"（4 B）
偏移 4      formatVersion u16（1）
偏移 6      flags u16（0）
偏移 8      headerLength u32（≤1 MiB）
偏移 12     header（规范化 JSON UTF-8）
其后        signatureLength u16 + signature（RSA-3072 为 384 B）
其后        chunk 0 .. chunk N-1（密文，含 16 B GCM tag）
```

- 总长度 = headerPrefix + `size` + `chunkCount × 16`，必须精确匹配。
- 最后一块明文长度 = `size - (chunkCount-1) × chunkSize`。
- 空文件 `chunkCount=0`，只包含头部/签名；内容哈希为空内容的 SHA-256/SHA-1。
- IndexedDB 中分块独立存储；导出时按序拼成 Blob；导入时解析并写回分块。
- 容器头保留原始字节；验签使用原始字节，不重新序列化签名字段。

## 7. RSA / X.509 参数

- RSA-3072，e=65537；RSASSA-PKCS1-v1_5 + SHA-256。
- 私有实现选择 PKCS#1 v1.5 的原因：`@peculiar/x509` 的自签名证书生成与 WebCrypto 的 RSA-PSS 组合兼容性更复杂；PKCS#1 v1.5 在正确实现下仍安全。
- 报告建议：现代系统优先 RSA-PSS（或 Ed25519/ECDSA）；本项目在“安全局限”中说明。
- 自签名证书：CN=显示名，O=PCD Secure File Vault，OU=Course Project；序列号 16B 随机；有效期 2 年；非 CA；`digitalSignature`；Subject Key Identifier。
- 指纹：SHA-256(DER)，小写十六进制；UI 分组显示，支持复制。
- 验证证书有效期时使用清单 `signedAt`，而非当前时间；允许验证旧文件，但依赖本机时钟。

## 8. 随机数

- `crypto.getRandomValues` 是唯一随机源。
- 单次调用上限 65,536 B；`randomBytes` 已实现分段填充，支持大缓冲区（性能基准种子）。
- salt 16 B、fileNonce 8 B、wrapIv 12 B、DEK 16/32 B、证书序列号 16 B、fileId UUIDv4。
- 绝不用 `Math.random()`。

## 9. 参数上限（防 DoS）

| 参数 | 范围 |
| --- | --- |
| PBKDF2 iterations | 10,000–5,000,000 |
| scrypt N | 2^14–2^20，必须为 2 的幂 |
| scrypt r / p | r≤16，p≤4 |
| dkLen | 32 |
| header | ≤1 MiB |
| chunkCount | ≤4096 |
| file size | ≤4 GiB |
| 签名长度 | 256–512 B（RSA-2048/3072/4096） |
| 口令 | 8–1024 字符 |
