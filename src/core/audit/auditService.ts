import type { AuditAction, AuditEntry, AuditResult } from '../types/audit';
import { addAuditEntry, listAuditEntries } from '../storage/repositories/auditRepo';

export interface AuditOptions {
  fileId?: string;
  stage?: string;
  errorCode?: string;
  detail?: Record<string, string | number | boolean | null>;
}

export async function logAudit(
  action: AuditAction,
  result: AuditResult,
  options: AuditOptions = {},
): Promise<void> {
  const entry: AuditEntry = {
    timestamp: Date.now(),
    action,
    result,
    fileId: options.fileId,
    stage: options.stage,
    errorCode: options.errorCode,
    detail: options.detail,
  };
  try {
    await addAuditEntry(entry);
  } catch (error) {
    // 审计失败不应阻断主流程；控制台保留线索，但绝不记录密钥/口令。
    console.warn('审计日志写入失败', error);
  }
}

export async function listAudit(limit = 200): Promise<AuditEntry[]> {
  return listAuditEntries(limit);
}
