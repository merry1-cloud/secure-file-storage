# 03 · 密钥生命周期与密钥管理

## 1. 密钥层级

```
主口令 P（UTF-8 NFC，完整参与 KDF，不截断）
  │ PBKDF2-HMAC-SHA-256(P, vaultSalt, iterations) 或 scrypt
  ▼
IKM (256 bit)
  │ HKDF-SHA-256，域分离
  ├─ VMK           → 用于为每个文件派生 fileKEK
  ├─ keyringKey    → AES-GCM 包装 RSA 私钥
  └─ KCVKey        → 计算/校验 KCV，并计算密钥环完整性 HMAC

每文件：
fileSalt(16B) + VMK --HKDF("SFV-FILE-KEK-v1")--> fileKEK
DEK(32/16B 随机) --AES-GCM(fileKEK, AAD=fileId)--> wrappedDEK
DEK --AES-GCM(分块 IV/AAD)--> 文件密文

RSA-3072 私钥 PKCS#8 --AES-GCM(keyringKey, AAD="SFV-RSA-PRIV-v1")--> wrappedPrivateKey
RSA 公钥 --自签名 X.509--> 证书；SHA-256(DER) = 指纹
```

**为什么这样分层**

- KDF 只跑一次解锁；文件多时不需要每文件一次 PBKDF2。
- 每个文件独立 DEK/fileSalt；一个文件的密钥泄露不会直接泄露其他文件。
- 换口令只重包 DEK 和私钥，不重新加密内容。
- 容器携带 KDF 参数、vaultSalt、fileSalt、KCV，脱离原 IDB 仍可凭原口令解密。

## 2. 密钥环记录（IndexedDB `keys/primary`）

| 字段 | 说明 |
| --- | --- |
| `publicKeyJwk` | RSA 公钥（明文，公开） |
| `certPem` / `certFingerprint` / `certSubject` / `certSerialNumber` / 有效期 | 自签名 X.509 信息 |
| `wrappedPrivateKey` / `privateKeyIv` | AES-GCM 包装的 PKCS#8 |
| `kdf` | 算法、salt、迭代/N/r/p、dkLen |
| `kcv` | HMAC-SHA-256(KCVKey, "SFV-KCV-VALUE-v1" \|\| salt) |
| `integrity` | HMAC(KCVKey, 元数据/包装私钥/证书的规范化串)，防止本地静默替换 |
| `displayName` / `createdAt` / `version` | 展示与版本 |

**不存**：主口令、VMK、fileKEK、DEK、明文私钥。

**运行时**：解锁后 VMK/keyringKey 仅存在内存；私钥导入为不可导出 `CryptoKey`（usage=sign）。锁定/自动锁定清空引用。

## 3. 生命周期状态

| 状态 | 触发 | 密钥材料位置 |
| --- | --- | --- |
| Created | 创建保管库，生成 RSA/cert | wrapped 私钥 + 证书入 IDB；会话解锁 |
| Active | 解锁，签名/加解密 | VMK/keyringKey/私钥在内存 |
| Locked | 手动锁定 / 自动锁定 / 刷新页面 | 仅 wrapped 私钥在 IDB |
| Exported | 导出 `.sfkey` | 原密钥环不变；另生成加密导出文件 |
| BackedUp | 创建 `.sfbackup` | 原密钥环不变；备份包含私钥/证书/信任库 |
| Restored | 从 `.sfbackup`/`.sfkey` 恢复 | 新保管库或替换当前签名密钥；旧证书保留信任 |
| Rotated | 通过导入/恢复另一把密钥实现 | 旧证书保留，旧文件仍可验证；无独立“一键轮换”按钮 |
| Revoked/Deleted | 从信任库移除 / 删除保管库（未提供一键删库） | 移除后该证书签名的容器验证失败 |

## 4. 操作流程

### 4.1 创建保管库

1. 校验口令（≥8 位，建议 12+）；生成 16B `vaultSalt`。
2. PBKDF2/scrypt → IKM → HKDF → VMK/keyringKey/KCVKey/KCV。
3. 生成 RSA-3072 密钥对；用私钥生成自签名 X.509（有效期 2 年，`digitalSignature`，非 CA）。
4. 导出 PKCS#8，AES-GCM 包装；计算密钥环 HMAC；写入 IDB。
5. 证书加入信任库（source=self）；建立会话。
6. 审计 `vault.create`。

### 4.2 解锁

1. 读取密钥环，PBKDF2/scrypt → IKM → HKDF。
2. 重新计算 KCV，常数时间比较；错误 → `E_WRONG_PASSWORD`。
3. 重新计算密钥环 HMAC；不匹配 → `E_KEY_MISMATCH`（本地数据被替换/损坏）。
4. 解包私钥，做一次签名/验签自检（私钥 ↔ 证书公钥）。
5. 建立会话；失败/成功后写审计（不含口令）。

### 4.3 自动锁定

- 默认 10 分钟无操作；可在设置中改为 0–120 分钟。
- 锁定清除 Zustand 会话中的 CryptoKey 引用，关闭页面即天然清除。
- Worker 中已克隆的 CryptoKey 不会被主线程锁定影响；一个已经在运行的大文件任务可能继续完成（见安全局限）。

### 4.4 私钥导出（`.sfkey`）

- 需要重新输入主口令（验证 KCV + 密钥环 HMAC）。
- 解包私钥为可导出 CryptoKey，导出 PKCS#8。
- 使用独立的导出口令 + 新的 PBKDF2 600k salt + AES-256-GCM 重新加密。
- 文件包含 KDF 参数、KCV、IV、密文、证书、公钥 JWK、证书指纹。
- 错误导出口令 → KCV/`E_WRONG_EXPORT_PASSPHRASE`；GCM 损坏 → `E_SCHEMA`。
- 导入：导出文件 → 解密 → 导入私钥 → 私钥/证书/公钥 JWK 三方匹配 → 用当前主口令重新包装。
- 风险：导出文件可离线暴力破解；导出口令丢失不可恢复；不要明文传输。

### 4.5 备份/恢复（`.sfbackup`）

- 创建备份需要主口令重新验证；解包私钥后，将私钥 PKCS#8、证书、公钥、信任库、显示名打包为规范化 JSON，计算 SHA-256。
- 整个载荷用**独立的备份口令** + PBKDF2 600k + AES-256-GCM 加密；`payloadSha256` 也进入 AAD。
- 备份**不包含文件内容**；文件请用 `.sfv` 逐个导出。
- 恢复：
  - 新浏览器：备份口令解密 → 校验载荷哈希、证书/私钥/JWK 匹配 → 用新主口令建立新保管库。
  - 已有保管库：备份口令解密 → 当前主口令重新包装 → 替换签名密钥，旧证书保留信任。
- 风险：备份文件 + 弱口令可离线破解；备份过期；备份口令丢失不可恢复；没有远程吊销。

### 4.6 修改主口令 / 修改 KDF

1. 校验旧口令 + 旧密钥环 HMAC。
2. 生成新 salt（或新 KDF 档位参数）→ 新 VMK/keyringKey/KCVKey/KCV。
3. 解包 RSA 私钥，重新包装。
4. 对每个**本地**文件：解包 DEK → 用新 VMK + 原 fileSalt 派生新 fileKEK → 重包 DEK → 更新清单 `kdf/kcv/wrappedDek/wrapIv/signedAt` → 用 RSA 私钥重新签名 → 更新 headerBytes/signature。
5. 在一个 IDB 事务中写入文件更新与密钥环。
6. **导入的外部容器不重包**：它们保留原 KDF/KCV/签名，继续使用原容器口令。
7. 已导出的 `.sfv` 仍使用导出时旧口令；需要重新导出或保留旧口令。
8. 审计记录重包/跳过的文件数量。

### 4.7 证书信任与轮换

- 创建时自动信任当前证书；导入 `.sfv` 时若指纹未知，弹出 TOFU 确认，显示完整 SHA-256 指纹。
- 信任库保留历史证书；当前证书不可移除，避免本机文件全部失效。
- 通过导入/恢复另一把 `.sfkey`/`.sfbackup` 可替换签名密钥（等效轮换）；旧证书仍在信任库，旧文件仍可验证。
- 没有 CRL/OCSP；移除信任是唯一的“撤销”方式。

### 4.8 删除

- 文件删除：删除元数据与所有分块；无法保证 SSD/浏览器缓存中的物理删除。
- 密钥删除：当前 UI 未提供一键删库；可通过浏览器清除站点数据。此操作不可恢复，需备份。
- 安全删除不是本项目目标。

## 5. 关键风险与控制

| 风险 | 控制 | 残余 |
| --- | --- | --- |
| 弱口令离线猜测 | PBKDF2 600k/scrypt 128MiB；口令强度提示 | 用户仍可选弱口令 |
| KCV 校验 oracle | KDF 成本仍主导；KCV 不存密钥 | 离线验证更快 |
| 本地密钥环被替换 | HMAC 完整性 + 私钥/证书自检 | 可拒绝服务；无法在不知道口令时伪造 |
| 导出/备份文件泄露 | 独立强口令 + AEAD | 弱口令可破解 |
| 忘记口令 | 备份/导出的私钥 | 无 Escrow/找回 |
| 证书替换 | 指纹固定 + 显式 TOFU | 用户盲目信任 |
| 旧容器重放 | 无 | 抗回滚未实现 |
| 删除残留 | 无 | 安全删除未实现 |
| 多标签页/自动锁定 | 15 分钟 pending 清理；事务提交 | 并发/运行中任务未强制取消 |
