export type VerifyStage =
  | 'parse'
  | 'certificate'
  | 'signature'
  | 'password'
  | 'unwrap'
  | 'encrypt'
  | 'decrypt'
  | 'integrity'
  | 'output'
  | 'kdf'
  | 'validation'
  | 'storage'
  | 'unknown';

export type StageStatus = 'ok' | 'failed' | 'skipped';

export interface VerificationStageResult {
  stage: VerifyStage;
  status: StageStatus;
  durationMs: number;
  detail?: string;
  code?: string;
}

export interface VerificationReport {
  ok: boolean;
  stages: VerificationStageResult[];
  errorCode?: string;
  summary: string;
}

export const STAGE_LABELS: Record<VerifyStage, string> = {
  parse: '解析容器',
  certificate: '校验证书',
  signature: '验证签名',
  password: '校验口令',
  unwrap: '解包文件密钥',
  encrypt: '加密内容',
  decrypt: '解密内容',
  integrity: '完整性校验',
  output: '生成下载',
  kdf: '密钥派生',
  validation: '参数校验',
  storage: '本地存储',
  unknown: '未知阶段',
};
