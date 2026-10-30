import type { VerificationReport, VerificationStageResult } from '@/core/types/verification';
import { stageLabel } from './format';

const STATUS_LABEL: Record<VerificationStageResult['status'], string> = {
  ok: '通过',
  failed: '失败',
  skipped: '跳过',
};

export function reportToMarkdown(report: VerificationReport, title = '验证报告'): string {
  const lines: string[] = [];
  lines.push(`# ${title}`);
  lines.push('');
  lines.push(`- 结果：${report.ok ? '通过' : '失败'}`);
  if (report.errorCode) lines.push(`- 错误码：${report.errorCode}`);
  lines.push(`- 摘要：${report.summary}`);
  lines.push('');
  lines.push('| 阶段 | 状态 | 耗时 | 详情 |');
  lines.push('| --- | --- | ---: | --- |');
  for (const stage of report.stages) {
    lines.push(
      `| ${stageLabel(stage.stage)} | ${STATUS_LABEL[stage.status]} | ${stage.durationMs.toFixed(1)} ms | ${(stage.detail ?? stage.code ?? '').replace(/\|/g, '\\|')} |`,
    );
  }
  const total = report.stages.reduce((sum, stage) => sum + stage.durationMs, 0);
  lines.push('');
  lines.push(`总耗时：${total.toFixed(1)} ms`);
  return lines.join('\n');
}

export function reportToJson(report: VerificationReport): string {
  return JSON.stringify(report, null, 2);
}
