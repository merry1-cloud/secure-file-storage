import { isAppError } from '@/core/errors/AppError';
import type { VerificationReport } from '@/core/types/verification';

export function errorText(error: unknown): string {
  if (isAppError(error)) {
    return error.code ? `${error.message}（${error.code}）` : error.message;
  }
  if (error instanceof Error) return error.message;
  return String(error);
}

export function errorCode(error: unknown): string | undefined {
  return isAppError(error) ? error.code : undefined;
}

export function errorReport(error: unknown): VerificationReport | undefined {
  return isAppError(error) ? error.report : undefined;
}

export function isErrorCode(error: unknown, code: string): boolean {
  return isAppError(error) && error.code === code;
}
