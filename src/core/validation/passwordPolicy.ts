import { normalizePassword } from '../crypto/encoding';
import { AppError } from '../errors/AppError';
import { ErrorCodes } from '../errors/codes';
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  PASSWORD_RECOMMENDED_LENGTH,
} from './limits';

export interface PasswordAssessment {
  ok: boolean;
  message?: string;
  score: 0 | 1 | 2 | 3 | 4;
  label: string;
  entropyBits: number;
}

export function assessPassword(password: string): PasswordAssessment {
  const value = normalizePassword(password);
  if (value.length < PASSWORD_MIN_LENGTH) {
    return {
      ok: false,
      message: `口令至少需要 ${PASSWORD_MIN_LENGTH} 个字符`,
      score: 0,
      label: '太短',
      entropyBits: 0,
    };
  }
  if (value.length > PASSWORD_MAX_LENGTH) {
    return {
      ok: false,
      message: `口令不能超过 ${PASSWORD_MAX_LENGTH} 个字符`,
      score: 0,
      label: '过长',
      entropyBits: 0,
    };
  }

  let pool = 0;
  if (/[a-z]/.test(value)) pool += 26;
  if (/[A-Z]/.test(value)) pool += 26;
  if (/[0-9]/.test(value)) pool += 10;
  if (/[^A-Za-z0-9]/.test(value)) pool += 32;
  const entropyBits = pool > 0 ? value.length * Math.log2(pool) : 0;

  let score: 0 | 1 | 2 | 3 | 4;
  if (entropyBits < 40) score = 0;
  else if (entropyBits < 60) score = 1;
  else if (entropyBits < 80) score = 2;
  else if (entropyBits < 100) score = 3;
  else score = 4;

  const labels = ['很弱', '弱', '一般', '强', '很强'] as const;
  const message = `建议 ${PASSWORD_RECOMMENDED_LENGTH} 位以上。`;

  return { ok: true, score, label: labels[score], entropyBits, message };
}

export function assertStrongPassphrase(passphrase: string, minLength = 12): string {
  const value = normalizePassword(passphrase);
  if (value.length < minLength) {
    throw new AppError(
      ErrorCodes.PASSWORD_POLICY,
      `导出口令/备份口令至少需要 ${minLength} 个字符`,
      { stage: 'validation' },
    );
  }
  if (value.length > PASSWORD_MAX_LENGTH) {
    throw new AppError(
      ErrorCodes.PASSWORD_POLICY,
      `口令不能超过 ${PASSWORD_MAX_LENGTH} 个字符`,
      { stage: 'validation' },
    );
  }
  return value;
}
