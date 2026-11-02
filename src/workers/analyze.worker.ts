/**
 * P008 倍行镜 JoinWitness — 唯一 Dedicated Web Worker 内核
 *
 * 遵循项目书 §4、§8、FR09 与实施计划 P008-T010：
 * - 协议：{jobId, scenario} / {jobId, audit | error}
 * - 纯计算无网络：仅引用核心验证与分析纯函数，零网络传输
 * - 单一 Worker：无嵌套 Worker 创建
 * - 结构与金额见证：挂载 findMinimalWitness 产出完整 Audit
 */

import { validateScenario } from '../core/validate.js';
import { analyze } from '../core/analyze.js';
import { findMinimalWitness } from '../core/witness.js';
import type { Audit } from '../core/types.js';

export const WORKER_ERROR_CODES = {
  INVALID_REQUEST: 'INVALID_REQUEST',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  ANALYSIS_ERROR: 'ANALYSIS_ERROR',
  WORKER_TERMINATED: 'WORKER_TERMINATED',
  STALE: 'STALE',
  UNKNOWN_ERROR: 'UNKNOWN_ERROR',
} as const;

export type WorkerErrorCode =
  (typeof WORKER_ERROR_CODES)[keyof typeof WORKER_ERROR_CODES];

export interface WorkerErrorPayload {
  code: string;
  message: string;
  details?: unknown;
}

export interface WorkerRequest {
  jobId: number | string;
  scenario: unknown;
}

export interface WorkerSuccessResponse {
  jobId: number | string;
  audit: Audit;
  error?: undefined;
}

export interface WorkerErrorResponse {
  jobId: number | string;
  error: WorkerErrorPayload;
  audit?: undefined;
}

export type WorkerResponse = WorkerSuccessResponse | WorkerErrorResponse;

/**
 * Worker 消息处理纯逻辑入口，供 Dedicated Web Worker 与模拟 Worker 环境复用
 */
export async function handleWorkerMessage(req: unknown): Promise<WorkerResponse> {
  // 1. 校验外层请求结构
  if (!req || typeof req !== 'object') {
    return {
      jobId: 'unknown',
      error: {
        code: WORKER_ERROR_CODES.INVALID_REQUEST,
        message: 'Request payload must be a non-null object.',
      },
    };
  }

  const { jobId, scenario } = req as Record<string, unknown>;

  if (
    jobId === undefined ||
    jobId === null ||
    (typeof jobId !== 'number' && typeof jobId !== 'string')
  ) {
    return {
      jobId: 'unknown',
      error: {
        code: WORKER_ERROR_CODES.INVALID_REQUEST,
        message: 'Request must have a valid jobId (number or string).',
      },
    };
  }

  if (scenario === undefined || scenario === null) {
    return {
      jobId,
      error: {
        code: WORKER_ERROR_CODES.INVALID_REQUEST,
        message: 'Request must contain a scenario object.',
      },
    };
  }

  // 2. 严格校验场景输入契约 (schema / ID / 布局 / 金额)
  const validationResult = validateScenario(scenario);
  if (!validationResult.ok) {
    return {
      jobId,
      error: {
        code: WORKER_ERROR_CODES.VALIDATION_ERROR,
        message: `Scenario validation failed: ${validationResult.errors
          .map((e) => `${e.path}: ${e.message}`)
          .join('; ')}`,
        details: validationResult.errors,
      },
    };
  }

  // 3. 执行核心分析计算（挂接最少行数见证构造器）
  try {
    const audit = await analyze(validationResult.scenario, {
      witnessFinder: findMinimalWitness,
    });
    return {
      jobId,
      audit,
    };
  } catch (err: unknown) {
    return {
      jobId,
      error: {
        code: WORKER_ERROR_CODES.ANALYSIS_ERROR,
        message: err instanceof Error ? err.message : String(err),
      },
    };
  }
}

// Dedicated Web Worker 运行时消息监听
if (typeof self !== 'undefined' && typeof self.addEventListener === 'function') {
  self.addEventListener('message', async (event: MessageEvent<unknown>) => {
    try {
      const response = await handleWorkerMessage(event.data);
      self.postMessage(response);
    } catch (err: unknown) {
      const fallbackJobId =
        event.data && typeof event.data === 'object' && 'jobId' in event.data
          ? (event.data as Record<string, unknown>).jobId
          : 'unknown';
      const fallbackError: WorkerResponse = {
        jobId:
          typeof fallbackJobId === 'number' || typeof fallbackJobId === 'string'
            ? fallbackJobId
            : 'unknown',
        error: {
          code: WORKER_ERROR_CODES.UNKNOWN_ERROR,
          message: err instanceof Error ? err.message : String(err),
        },
      };
      self.postMessage(fallbackError);
    }
  });
}
