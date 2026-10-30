export type AuditAction =
  | 'vault.create'
  | 'vault.unlock'
  | 'vault.lock'
  | 'file.encrypt'
  | 'file.decrypt'
  | 'file.import'
  | 'file.export'
  | 'file.delete'
  | 'file.verify'
  | 'key.export'
  | 'key.backup'
  | 'key.restore'
  | 'key.rotate'
  | 'password.change'
  | 'tamper.test'
  | 'benchmark.run';

export type AuditResult = 'success' | 'failure';

export interface AuditEntry {
  id?: number;
  timestamp: number;
  action: AuditAction;
  result: AuditResult;
  fileId?: string;
  stage?: string;
  errorCode?: string;
  detail?: Record<string, string | number | boolean | null>;
}
