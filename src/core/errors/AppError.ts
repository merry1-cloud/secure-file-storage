import { ERROR_MESSAGES, ErrorCodes, type ErrorCode } from './codes';
import type { VerificationReport, VerifyStage } from '../types/verification';

export interface AppErrorOptions {
  stage?: VerifyStage;
  details?: Record<string, unknown>;
  report?: VerificationReport;
  cause?: unknown;
}

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly stage: VerifyStage;
  readonly details?: Record<string, unknown>;
  readonly report?: VerificationReport;

  constructor(code: ErrorCode, message?: string, options: AppErrorOptions = {}) {
    super(message ?? ERROR_MESSAGES[code], options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'AppError';
    this.code = code;
    this.stage = options.stage ?? 'unknown';
    this.details = options.details;
    this.report = options.report;
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

export function toAppError(
  error: unknown,
  fallbackCode: ErrorCode = ErrorCodes.UNKNOWN,
  stage: VerifyStage = 'unknown',
): AppError {
  if (isAppError(error)) return error;
  if (error instanceof DOMException && (error.name === 'QuotaExceededError' || error.code === 22)) {
    return new AppError(ErrorCodes.QUOTA, ERROR_MESSAGES.E_QUOTA, { stage, cause: error });
  }
  const message = error instanceof Error ? error.message : String(error);
  return new AppError(fallbackCode, message || ERROR_MESSAGES[fallbackCode], { stage, cause: error });
}

export interface SerializedAppError {
  code: ErrorCode;
  message: string;
  stage: VerifyStage;
  details?: Record<string, unknown>;
  report?: VerificationReport;
}

export function serializeAppError(error: unknown): SerializedAppError {
  const appError = toAppError(error);
  return {
    code: appError.code,
    message: appError.message,
    stage: appError.stage,
    details: appError.details,
    report: appError.report,
  };
}

export function deserializeAppError(serialized: SerializedAppError): AppError {
  return new AppError(serialized.code, serialized.message, {
    stage: serialized.stage,
    details: serialized.details,
    report: serialized.report,
  });
}
