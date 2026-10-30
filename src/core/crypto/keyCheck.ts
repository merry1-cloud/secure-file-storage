import { concatBytes, constantTimeEqual, fromBase64, toBase64, utf8 } from './encoding';
import { hmacSha256 } from './hmac';
import { DOMAINS } from './domains';

/**
 * Key Check Value：用 HMAC 对固定标签+盐计算校验值。
 * 它只能区分“口令错误”与“数据损坏”，不能替代 KDF 的抗暴力能力。
 */
export async function computeKcv(kcvKey: CryptoKey, salt: Uint8Array): Promise<string> {
  const mac = await hmacSha256(kcvKey, concatBytes(utf8(DOMAINS.kcvValue), salt));
  return toBase64(mac);
}

export function verifyKcv(expectedBase64: string, actualBase64: string): boolean {
  try {
    return constantTimeEqual(fromBase64(expectedBase64), fromBase64(actualBase64));
  } catch {
    return false;
  }
}
