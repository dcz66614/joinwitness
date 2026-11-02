/**
 * P008 倍行镜 JoinWitness — Worker 协议与 UI 调用封装
 *
 * 遵循项目书 §4、§8、FR09 与实施计划 P008-T010：
 * - 协议：{jobId, scenario} / {jobId, audit | error}
 * - 过期响应防护：旧响应永不覆盖新输入 (STALE 语义)
 * - 单一 Worker：维护唯一 Dedicated Web Worker 实例，不产生嵌套 Worker
 * - 无数据联网：全链路纯内存计算，无网络请求
 * - 操作状态流转：IDLE -> RUNNING -> COMPLETE | ERROR | STALE
 */

import type { Audit } from '../core/types.js';
import {
  handleWorkerMessage,
  WORKER_ERROR_CODES,
  type WorkerErrorPayload,
  type WorkerRequest,
  type WorkerResponse,
  type WorkerSuccessResponse,
  type WorkerErrorResponse,
  type WorkerErrorCode,
} from './analyze.worker.js';

export {
  WORKER_ERROR_CODES,
  type WorkerErrorPayload,
  type WorkerRequest,
  type WorkerResponse,
  type WorkerSuccessResponse,
  type WorkerErrorResponse,
  type WorkerErrorCode,
};

/**
 * UI 调用返回结果类型（携带严格 STALE 语义）
 */
export interface CompleteAnalysisResult {
  status: 'COMPLETE';
  jobId: number | string;
  audit: Audit;
  isStale: false;
  error?: undefined;
}

export interface StaleAnalysisResult {
  status: 'STALE';
  jobId: number | string;
  isStale: true;
  supersededBy?: number | string | undefined;
  audit?: undefined;
  error?: undefined;
}

export interface ErrorAnalysisResult {
  status: 'ERROR';
  jobId: number | string;
  error: WorkerErrorPayload;
  isStale: false;
  audit?: undefined;
}

export type AnalysisResult =
  | CompleteAnalysisResult
  | StaleAnalysisResult
  | ErrorAnalysisResult;

/**
 * 客户端操作状态枚举与完整状态快照
 */
export type AnalysisStatus =
  | 'IDLE'
  | 'VALIDATING'
  | 'RUNNING'
  | 'COMPLETE'
  | 'ERROR'
  | 'STALE';

export interface AnalysisClientState {
  status: AnalysisStatus;
  currentJobId: number | string | null;
  latestCompletedJobId: number | string | null;
  audit: Audit | null;
  error: WorkerErrorPayload | null;
  isStale: boolean;
}

/**
 * Web Worker 通用接口抽象
 */
export interface WorkerLike {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  addEventListener(type: string, listener: (ev: MessageEvent<any>) => void): void;
  removeEventListener(type: string, listener: (ev: MessageEvent<any>) => void): void;
  terminate?(): void;
}

export type WorkerFactory = () => WorkerLike;

/**
 * 浏览器原生 Dedicated Web Worker 工厂
 */
export function createBrowserWorker(): WorkerLike {
  return new Worker(new URL('./analyze.worker.ts', import.meta.url), {
    type: 'module',
  });
}

/**
 * 进程内模拟 Worker（用于 Node/Vitest 等非 Worker 宿主环境）
 * 使用 structuredClone 模拟跨 Worker 内存隔离与序列化
 */
export function createInProcessWorker(): WorkerLike {
  const listeners: Set<(ev: MessageEvent<any>) => void> = new Set();
  let terminated = false;

  return {
    postMessage(message: unknown): void {
      if (terminated) return;
      const clonedReq = structuredClone(message);
      // 异步宏任务调度，模拟真实 Web Worker 事件循环
      setTimeout(async () => {
        if (terminated) return;
        const response = await handleWorkerMessage(clonedReq);
        if (terminated) return;
        const clonedRes = structuredClone(response);
        const event = { data: clonedRes } as MessageEvent<any>;
        for (const listener of Array.from(listeners)) {
          try {
            listener(event);
          } catch (e) {
            console.error('[SimulatedWorker] listener error:', e);
          }
        }
      }, 0);
    },
    addEventListener(_type: string, listener: (ev: MessageEvent<any>) => void): void {
      listeners.add(listener);
    },
    removeEventListener(_type: string, listener: (ev: MessageEvent<any>) => void): void {
      listeners.delete(listener);
    },
    terminate(): void {
      terminated = true;
      listeners.clear();
    },
  };
}

/**
 * 默认 Worker 工厂：优先浏览器 Worker，缺省环境回退至进程内模拟 Worker
 */
export function createDefaultWorker(): WorkerLike {
  if (typeof Worker !== 'undefined') {
    return createBrowserWorker();
  }
  return createInProcessWorker();
}

export interface AnalysisClientOptions {
  workerFactory?: WorkerFactory;
}

interface PendingJob {
  seq: number;
  jobId: number | string;
  resolve: (res: AnalysisResult) => void;
  reject: (err: unknown) => void;
}

/**
 * AnalysisClient — 唯一 Dedicated Web Worker 管理器与过期响应防护客户端
 */
export class AnalysisClient {
  private worker: WorkerLike | null = null;
  private workerCount: number = 0;
  private readonly workerFactory: WorkerFactory;

  private state: AnalysisClientState = {
    status: 'IDLE',
    currentJobId: null,
    latestCompletedJobId: null,
    audit: null,
    error: null,
    isStale: false,
  };

  private readonly listeners: Set<(state: AnalysisClientState) => void> = new Set();
  private seqCounter: number = 0;
  private latestDispatchedSeq: number = 0;
  private latestDispatchedJobId: number | string | null = null;
  private readonly pendingJobs: Map<number | string, PendingJob> = new Map();
  private readonly boundOnWorkerMessage: (ev: MessageEvent<unknown>) => void;

  constructor(options?: AnalysisClientOptions) {
    this.workerFactory = options?.workerFactory ?? createDefaultWorker;
    this.boundOnWorkerMessage = this.handleWorkerMessage.bind(this);
  }

  /**
   * 确保全局唯一 Worker 实例，严格遵循“只一个 Worker”原则
   */
  private getOrCreateWorker(): WorkerLike {
    if (!this.worker) {
      this.worker = this.workerFactory();
      this.workerCount++;
      this.worker.addEventListener('message', this.boundOnWorkerMessage);
    }
    return this.worker;
  }

  /**
   * 获取当前创建过的 Worker 实例数（用于验证唯一 Worker）
   */
  public getWorkerCount(): number {
    return this.workerCount;
  }

  /**
   * 检查当前是否存在活跃 Worker 实例
   */
  public hasActiveWorker(): boolean {
    return this.worker !== null;
  }

  /**
   * 获取当前状态快照
   */
  public getState(): AnalysisClientState {
    return { ...this.state };
  }

  /**
   * 订阅状态变更
   */
  public subscribe(listener: (state: AnalysisClientState) => void): () => void {
    this.listeners.add(listener);
    listener(this.getState());
    return () => {
      this.listeners.delete(listener);
    };
  }

  private updateState(patch: Partial<AnalysisClientState>): void {
    this.state = {
      ...this.state,
      ...patch,
    };
    const current = this.getState();
    for (const listener of Array.from(this.listeners)) {
      try {
        listener(current);
      } catch (err) {
        console.error('[AnalysisClient] State listener error:', err);
      }
    }
  }

  /**
   * 标记当前结果过期 (STALE)
   *
   * 项目书 §4: 修改输入、换预设或重新导入立即使旧结果标为 STALE，旧图表不得伪装为当前结果；
   * 通过 jobId 忽略过期 Worker 消息。
   */
  public markStale(): void {
    this.updateState({
      status: 'STALE',
      isStale: true,
      error: null,
    });

    // 终止所有当前处于等待中的旧任务，向调用者传递 STALE 语义
    for (const [id, pending] of Array.from(this.pendingJobs.entries())) {
      pending.resolve({
        status: 'STALE',
        jobId: pending.jobId,
        isStale: true,
      });
      this.pendingJobs.delete(id);
    }
  }

  /**
   * 触发异步分析执行
   *
   * 防串版核心逻辑：
   * 1. 分配单调递增序列号 seq，标记为最新任务 latestDispatchedJobId / latestDispatchedSeq。
   * 2. 旧任务立即标为 STALE 并从待处理队列中剥离，旧响应永不覆盖新输入。
   * 3. 投递消息给唯一 Worker 实例。
   */
  public async runAnalysis(req: WorkerRequest): Promise<AnalysisResult> {
    const seq = ++this.seqCounter;
    const jobId = req.jobId;

    // 1. 废弃所有早于当前任务的挂起请求（返回 STALE 语义）
    for (const [oldJobId, pending] of Array.from(this.pendingJobs.entries())) {
      pending.resolve({
        status: 'STALE',
        jobId: pending.jobId,
        isStale: true,
        supersededBy: jobId,
      });
      this.pendingJobs.delete(oldJobId);
    }

    this.latestDispatchedSeq = seq;
    this.latestDispatchedJobId = jobId;

    // 2. 更新操作状态为 RUNNING
    this.updateState({
      status: 'RUNNING',
      currentJobId: jobId,
      isStale: false,
      error: null,
    });

    const worker = this.getOrCreateWorker();

    return new Promise<AnalysisResult>((resolve, reject) => {
      this.pendingJobs.set(jobId, {
        seq,
        jobId,
        resolve,
        reject,
      });

      try {
        worker.postMessage({
          jobId,
          scenario: req.scenario,
        });
      } catch (postErr) {
        this.pendingJobs.delete(jobId);
        const errPayload: WorkerErrorPayload = {
          code: WORKER_ERROR_CODES.ANALYSIS_ERROR,
          message: postErr instanceof Error ? postErr.message : String(postErr),
        };
        this.updateState({
          status: 'ERROR',
          currentJobId: jobId,
          error: errPayload,
          isStale: false,
        });
        resolve({
          status: 'ERROR',
          jobId,
          error: errPayload,
          isStale: false,
        });
      }
    });
  }

  /**
   * 处理 Worker 返回的消息并执行过期防护裁决
   */
  private handleWorkerMessage(ev: MessageEvent<unknown>): void {
    const data = ev.data as WorkerResponse | undefined;
    if (!data || typeof data !== 'object') {
      return;
    }

    const { jobId } = data;
    const pending = this.pendingJobs.get(jobId);

    // 过期响应裁决 (STALE 防护)
    const isJobOutdated =
      !pending ||
      pending.seq < this.latestDispatchedSeq ||
      jobId !== this.latestDispatchedJobId ||
      this.state.isStale;

    if (isJobOutdated) {
      // 若该响应已被后发任务抢占，旧响应绝不覆盖当前状态
      if (pending) {
        this.pendingJobs.delete(jobId);
        pending.resolve({
          status: 'STALE',
          jobId,
          isStale: true,
          supersededBy: this.latestDispatchedJobId ?? undefined,
        });
      }
      return;
    }

    // 属于最新合法任务，执行状态更新与 Promise 决议
    this.pendingJobs.delete(jobId);

    if (data.error) {
      this.updateState({
        status: 'ERROR',
        currentJobId: jobId,
        latestCompletedJobId: jobId,
        error: data.error,
        audit: null,
        isStale: false,
      });
      pending.resolve({
        status: 'ERROR',
        jobId,
        error: data.error,
        isStale: false,
      });
    } else {
      this.updateState({
        status: 'COMPLETE',
        currentJobId: jobId,
        latestCompletedJobId: jobId,
        audit: data.audit,
        error: null,
        isStale: false,
      });
      pending.resolve({
        status: 'COMPLETE',
        jobId,
        audit: data.audit,
        isStale: false,
      });
    }
  }

  /**
   * 终止 Worker 实例并重置队列
   */
  public terminate(): void {
    if (this.worker) {
      this.worker.removeEventListener('message', this.boundOnWorkerMessage);
      if (typeof this.worker.terminate === 'function') {
        this.worker.terminate();
      }
      this.worker = null;
    }

    for (const [id, pending] of Array.from(this.pendingJobs.entries())) {
      pending.resolve({
        status: 'ERROR',
        jobId: pending.jobId,
        error: {
          code: WORKER_ERROR_CODES.WORKER_TERMINATED,
          message: 'Dedicated worker was terminated before task finished.',
        },
        isStale: false,
      });
      this.pendingJobs.delete(id);
    }

    this.updateState({
      status: 'IDLE',
      currentJobId: null,
      isStale: false,
    });
  }

  /**
   * 重置状态（供测试隔离或 UI 清空）
   */
  public reset(): void {
    this.terminate();
    this.workerCount = 0;
    this.seqCounter = 0;
    this.latestDispatchedSeq = 0;
    this.latestDispatchedJobId = null;
    this.state = {
      status: 'IDLE',
      currentJobId: null,
      latestCompletedJobId: null,
      audit: null,
      error: null,
      isStale: false,
    };
  }
}

// 全局单例 Client 实例（保障单一 Worker 架构）
let defaultClient: AnalysisClient | null = null;

export function getAnalysisClient(options?: AnalysisClientOptions): AnalysisClient {
  if (!defaultClient) {
    defaultClient = new AnalysisClient(options);
  }
  return defaultClient;
}

export function resetAnalysisClient(): void {
  if (defaultClient) {
    defaultClient.terminate();
    defaultClient = null;
  }
}

/**
 * 高级 UI 封装入口：runAnalysis({jobId, scenario})
 *
 * 合同（项目书 §8、FR09）：
 * runAnalysis({jobId,scenario}) | UI → Worker → {jobId,audit} | 仅显示最新 jobId 的响应，失败有错误码
 */
export async function runAnalysis(
  req: WorkerRequest,
  options?: AnalysisClientOptions
): Promise<AnalysisResult> {
  const client = getAnalysisClient(options);
  return client.runAnalysis(req);
}

/**
 * 标记当前分析结果为 STALE
 */
export function markStale(): void {
  getAnalysisClient().markStale();
}

/**
 * 读取当前分析状态快照
 */
export function getClientState(): AnalysisClientState {
  return getAnalysisClient().getState();
}
