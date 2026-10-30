import { AppError, toAppError } from '../errors/AppError';
import { ErrorCodes } from '../errors/codes';
import type {
  VerificationReport,
  VerificationStageResult,
  VerifyStage,
} from '../types/verification';

export function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function roundMs(value: number): number {
  return Math.round(value * 10) / 10;
}

export class ReportBuilder {
  private readonly stages: VerificationStageResult[];

  constructor(initialStages: VerificationStageResult[] = []) {
    this.stages = [...initialStages];
  }

  async run<T>(stage: VerifyStage, fn: () => Promise<T> | T): Promise<T> {
    const start = nowMs();
    try {
      const value = await fn();
      this.stages.push({
        stage,
        status: 'ok',
        durationMs: roundMs(nowMs() - start),
      });
      return value;
    } catch (error) {
      const appError = toAppError(error, ErrorCodes.UNKNOWN, stage);
      this.stages.push({
        stage,
        status: 'failed',
        durationMs: roundMs(nowMs() - start),
        detail: appError.message,
        code: appError.code,
      });
      const report = this.snapshot(false, appError.message);
      throw new AppError(appError.code, appError.message, {
        stage: appError.stage,
        details: appError.details,
        report,
        cause: appError,
      });
    }
  }

  addOk(stage: VerifyStage, durationMs: number, detail?: string): void {
    this.stages.push({ stage, status: 'ok', durationMs: roundMs(durationMs), detail });
  }

  addSkipped(stage: VerifyStage, detail?: string): void {
    this.stages.push({ stage, status: 'skipped', durationMs: 0, detail });
  }

  get stageResults(): readonly VerificationStageResult[] {
    return this.stages;
  }

  snapshot(ok: boolean, summary: string): VerificationReport {
    const failed = [...this.stages].reverse().find((stage) => stage.status === 'failed');
    return {
      ok,
      stages: this.stages.map((stage) => ({ ...stage })),
      errorCode: failed?.code,
      summary,
    };
  }

  finish(summary: string): VerificationReport {
    return this.snapshot(true, summary);
  }
}
