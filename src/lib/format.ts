import type { KdfParams } from '@/core/types/crypto';
import type { AuditAction } from '@/core/types/audit';
import { STAGE_LABELS, type VerifyStage } from '@/core/types/verification';

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KiB', 'MiB', 'GiB', 'TiB'];
  let value = bytes;
  let unit = -1;
  do {
    value /= 1024;
    unit += 1;
  } while (value >= 1024 && unit < units.length - 1);
  return `${value.toFixed(value >= 100 ? 0 : value >= 10 ? 1 : 2)} ${units[unit]}`;
}

export function formatDate(timestamp: number): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return '—';
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date(timestamp));
}

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  if (ms < 1) return `${ms.toFixed(2)} ms`;
  if (ms < 1000) return `${ms.toFixed(1)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

export function groupFingerprint(fingerprint: string): string {
  return (fingerprint.match(/.{1,4}/g) ?? []).join(' ').toUpperCase();
}

export function shortFingerprint(fingerprint: string): string {
  if (!fingerprint) return '—';
  if (fingerprint.length <= 20) return fingerprint.toUpperCase();
  return `${fingerprint.slice(0, 8).toUpperCase()}…${fingerprint.slice(-8).toUpperCase()}`;
}

export function kdfLabel(params: KdfParams): string {
  if (params.algorithm === 'PBKDF2-HMAC-SHA256') {
    return `PBKDF2-HMAC-SHA256 · ${params.iterations.toLocaleString()} 次`;
  }
  return `scrypt · N=2^${Math.log2(params.N)} · r=${params.r} · p=${params.p}`;
}

export function kdfShortLabel(params: KdfParams): string {
  if (params.algorithm === 'PBKDF2-HMAC-SHA256') {
    return `PBKDF2 ${Math.round(params.iterations / 1000)}k`;
  }
  return `scrypt 2^${Math.log2(params.N)}`;
}

export function stageLabel(stage: VerifyStage | string): string {
  return STAGE_LABELS[stage as VerifyStage] ?? stage;
}

export const AUDIT_ACTION_LABELS: Record<AuditAction, string> = {
  'vault.create': '创建保管库',
  'vault.unlock': '解锁保管库',
  'vault.lock': '锁定保管库',
  'file.encrypt': '加密文件',
  'file.decrypt': '解密文件',
  'file.import': '导入容器',
  'file.export': '导出容器',
  'file.delete': '删除文件',
  'file.verify': '验证文件',
  'key.export': '导出私钥',
  'key.backup': '创建备份',
  'key.restore': '恢复备份',
  'key.rotate': '轮换密钥',
  'password.change': '修改主口令',
  'tamper.test': '篡改实验',
  'benchmark.run': '性能测试',
};

export function auditActionLabel(action: AuditAction | string): string {
  return AUDIT_ACTION_LABELS[action as AuditAction] ?? action;
}

export function toPercent(value: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((value / total) * 100)));
}
