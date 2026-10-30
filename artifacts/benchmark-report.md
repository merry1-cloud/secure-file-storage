# 安全文件存储系统性能测试

- 时间：2026/10/26 10:49:02
- 环境：Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/156.0.0.0 Safari/537.36 Edg/156.0.0.0
- 逻辑核心：16 · 设备内存：16 GiB · crossOriginIsolated：false

| 项目 | 文件大小 | 中位耗时 | 吞吐 | 迭代 | 备注 |
| --- | ---: | ---: | ---: | ---: | --- |
| AES-256-GCM 加密 | 1.00 MiB | 1.1 ms | 909.1 MiB/s | — |  |
| AES-256-GCM 解密 | 1.00 MiB | 1.2 ms | 833.3 MiB/s | — |  |
| SHA-256 流式哈希 | 1.00 MiB | 3.4 ms | 294.1 MiB/s | — |  |
| SHA-1 流式哈希 | 1.00 MiB | 1.6 ms | 625.0 MiB/s | — |  |
| AES-256-GCM 加密 | 10.0 MiB | 11.4 ms | 877.2 MiB/s | — |  |
| AES-256-GCM 解密 | 10.0 MiB | 12.1 ms | 826.4 MiB/s | — |  |
| SHA-256 流式哈希 | 10.0 MiB | 33.5 ms | 298.5 MiB/s | — |  |
| SHA-1 流式哈希 | 10.0 MiB | 17.7 ms | 565.0 MiB/s | — |  |
| AES-256-GCM 加密 | 100 MiB | 121.7 ms | 821.7 MiB/s | — |  |
| AES-256-GCM 解密 | 100 MiB | 223.2 ms | 448.0 MiB/s | — |  |
| SHA-256 流式哈希 | 100 MiB | 765.7 ms | 130.6 MiB/s | — |  |
| SHA-1 流式哈希 | 100 MiB | 365.3 ms | 273.7 MiB/s | — |  |
| PBKDF2-HMAC-SHA256 100,000 次 | — | 31.1 ms | — | 100000 | 含 HKDF 派生 VMK/keyringKey/KCV |
| PBKDF2-HMAC-SHA256 300,000 次 | — | 78.4 ms | — | 300000 | 含 HKDF 派生 VMK/keyringKey/KCV |
| PBKDF2-HMAC-SHA256 600,000 次 | — | 177.8 ms | — | 600000 | 含 HKDF 派生 VMK/keyringKey/KCV |
| PBKDF2-HMAC-SHA256 1,000,000 次 | — | 297.5 ms | — | 1000000 | 含 HKDF 派生 VMK/keyringKey/KCV |
| PBKDF2 迭代次数选择结论 | — | — | — | — | 600k ≈ 178 ms（本机实测） |
| scrypt N=2^15 r=8 p=1 | — | 144.6 ms | — | 1 | 内存约 32 MiB |
| scrypt N=2^17 r=8 p=1 | — | 637.2 ms | — | 1 | 内存约 128 MiB |
| RSA-3072 密钥生成 | — | 469.8 ms | — | 2 |  |
| RSA-3072 PKCS#1 v1.5 签名 | — | 6.6 ms | — | 20 |  |
| RSA-3072 PKCS#1 v1.5 验签 | — | 0.10 ms | — | 20 |  |
| 端到端加密（读取+哈希+AES+签名） | 1.00 MiB | 25.8 ms | 38.8 MiB/s | — |  |
| 端到端解密（AES+完整性） | 1.00 MiB | 14.9 ms | 67.3 MiB/s | — |  |
| 端到端加密（读取+哈希+AES+签名） | 10.0 MiB | 141.5 ms | 70.7 MiB/s | — |  |
| 端到端解密（AES+完整性） | 10.0 MiB | 130.7 ms | 76.5 MiB/s | — |  |
| 端到端加密（读取+哈希+AES+签名） | 100 MiB | 1.23 s | 81.5 MiB/s | — |  |
| 端到端解密（AES+完整性） | 100 MiB | 1.16 s | 86.2 MiB/s | — |  |