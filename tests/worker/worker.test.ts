/**
 * P008 倍行镜 JoinWitness — Worker 协议与过期响应防护测试
 *
 * 遵循项目书 §4、§8、FR09 与实施计划 P008-T010：
 * - 协议验证：{jobId, scenario} / {jobId, audit | error}
 * - 错误码测试：INVALID_REQUEST, VALIDATION_ERROR, ANALYSIS_ERROR
 * - 同步抢占：jobId=1 后紧跟发 jobId=2，只呈现最新的结果，旧请求返回 STALE 语义
 * - 异步抢占：慢任务 jobId=1 后发快任务 jobId=2，乱序到达时旧响应永不覆盖新输入
 * - 手动 STALE 失效：markStale 立即生效，旧 Worker 响应不得伪装为当前结果
 * - 单一 Worker：全局复用唯一 Dedicated Web Worker，不创建第二个或嵌套 Worker
 * - 无数据联网：全链路计算零网络调用 (0 fetch calls)
 * - 错误恢复：故障场景报错后，后续有效请求可平滑恢复至 COMPLETE
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import jwA from '../../src/fixtures/jw-a.json';
import jwB from '../../src/fixtures/jw-b.json';
import jwC from '../../src/fixtures/jw-c.json';
import jwD from '../../src/fixtures/jw-d.json';
import {
  handleWorkerMessage,
  WORKER_ERROR_CODES,
  type WorkerResponse,
  type WorkerRequest,
} from '../../src/workers/analyze.worker.js';
import {
  AnalysisClient,
  runAnalysis,
  markStale,
  getClientState,
  resetAnalysisClient,
  type WorkerLike,
  type AnalysisClientState,
} from '../../src/workers/workerProtocol.js';

describe('T010 Dedicated Web Worker Protocol & Stale Protection', () => {
  beforeEach(() => {
    resetAnalysisClient();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    resetAnalysisClient();
    vi.restoreAllMocks();
  });

  describe('1. Worker Protocol Contract & Computation Integrity', () => {
    it('accepts {jobId, scenario} and returns {jobId, audit} with full schema and witness for JW-A', async () => {
      const response = await handleWorkerMessage({
        jobId: 1,
        scenario: jwA,
      });

      expect(response.jobId).toBe(1);
      expect(response.error).toBeUndefined();
      expect(response.audit).toBeDefined();

      const audit = response.audit!;
      expect(audit.schema).toBe('joinwitness.audit/v1');
      expect(typeof audit.scenarioSha256).toBe('string');
      expect(audit.scenarioSha256.length).toBe(64);
      expect(audit.baseRows).toBe(3);
      expect(audit.expandedRows).toBe('8');
      expect(audit.safeSumCents).toBe('8600');
      expect(audit.naiveSumCents).toBe('28400');
      expect(audit.deltaCents).toBe('19800');
      expect(audit.unsafeBaseRows).toBe(2);

      // 验证最少行数见证集已挂载 (JW-A star 布局见证 3 行)
      expect(audit.witness.kind).toBe('NUMERIC_AND_STRUCTURAL');
      expect(audit.witness.rowIds.base.length).toBe(1);
      expect(audit.witness.rowIds.mid.length).toBe(2);

      console.log(
        `[EVIDENCE][PROTOCOL] Worker JW-A computed successfully: expandedRows=${audit.expandedRows}, safeSum=${audit.safeSumCents}, naiveSum=${audit.naiveSumCents}, witnessKind=${audit.witness.kind}`
      );
    });

    it('correctly handles chain layout (JW-B) with factorized branch sums', async () => {
      const response = await handleWorkerMessage({
        jobId: 'chain-job-99',
        scenario: jwB,
      });

      expect(response.jobId).toBe('chain-job-99');
      expect(response.error).toBeUndefined();
      expect(response.audit).toBeDefined();

      const audit = response.audit!;
      expect(audit.expandedRows).toBe('6');
      expect(audit.safeSumCents).toBe('3700');
      expect(audit.naiveSumCents).toBe('15700');
      expect(audit.deltaCents).toBe('12000');
      expect(audit.unsafeBaseRows).toBe(1);

      console.log(
        `[EVIDENCE][PROTOCOL] Worker JW-B chain verified: jobId=${response.jobId}, safeSum=${audit.safeSumCents}, naiveSum=${audit.naiveSumCents}`
      );
    });

    it('correctly handles zero delta with negative cancellation (JW-C)', async () => {
      const response = await handleWorkerMessage({
        jobId: 3,
        scenario: jwC,
      });

      expect(response.jobId).toBe(3);
      const audit = response.audit!;
      expect(audit.safeSumCents).toBe('0');
      expect(audit.naiveSumCents).toBe('0');
      expect(audit.deltaCents).toBe('0');
      expect(audit.unsafeBaseRows).toBe(2);

      console.log(
        `[EVIDENCE][PROTOCOL] Worker JW-C verified: delta=0 with unsafeBaseRows=2`
      );
    });

    it('preserves both numeric and string jobIds verbatim', async () => {
      const resNum = await handleWorkerMessage({ jobId: 42, scenario: jwD });
      expect(resNum.jobId).toBe(42);

      const resStr = await handleWorkerMessage({ jobId: 'alpha-beta-gamma', scenario: jwD });
      expect(resStr.jobId).toBe('alpha-beta-gamma');

      console.log(`[EVIDENCE][JOB_ID] Preserved numeric 42 and string 'alpha-beta-gamma'`);
    });
  });

  describe('2. Error Codes & Boundary Rejection', () => {
    it('returns INVALID_REQUEST when request envelope is null, non-object or missing jobId', async () => {
      const resNull = await handleWorkerMessage(null);
      expect(resNull.error?.code).toBe(WORKER_ERROR_CODES.INVALID_REQUEST);

      const resNoJob = await handleWorkerMessage({ scenario: jwA });
      expect(resNoJob.error?.code).toBe(WORKER_ERROR_CODES.INVALID_REQUEST);

      const resNoScenario = await handleWorkerMessage({ jobId: 10 });
      expect(resNoScenario.error?.code).toBe(WORKER_ERROR_CODES.INVALID_REQUEST);

      console.log(`[EVIDENCE][ERROR_CODE] INVALID_REQUEST verified for missing fields`);
    });

    it('returns VALIDATION_ERROR with structured error details when scenario schema is violated', async () => {
      const badScenario = {
        ...jwA,
        layout: 'circular_join', // 非法布局
      };

      const response = await handleWorkerMessage({
        jobId: 101,
        scenario: badScenario,
      });

      expect(response.jobId).toBe(101);
      expect(response.audit).toBeUndefined();
      expect(response.error).toBeDefined();
      expect(response.error?.code).toBe(WORKER_ERROR_CODES.VALIDATION_ERROR);
      expect(response.error?.message).toContain('Scenario validation failed');
      expect(Array.isArray(response.error?.details)).toBe(true);

      console.log(
        `[EVIDENCE][ERROR_CODE] VALIDATION_ERROR verified: code=${response.error?.code}, message=${response.error?.message}`
      );
    });

    it('returns VALIDATION_ERROR when base table is empty', async () => {
      const emptyBase = {
        ...jwA,
        base: [],
      };

      const response = await handleWorkerMessage({
        jobId: 102,
        scenario: emptyBase,
      });

      expect(response.error?.code).toBe(WORKER_ERROR_CODES.VALIDATION_ERROR);
      expect(response.error?.message).toContain('base');

      console.log(`[EVIDENCE][ERROR_CODE] Empty base table rejected with VALIDATION_ERROR`);
    });

    it('returns VALIDATION_ERROR when amount format is invalid', async () => {
      const badAmount = {
        ...jwA,
        base: [
          { id: 'b1', key: 'K1', amountCents: '12.34' }, // 分必须是整数形式字符串
        ],
      };

      const response = await handleWorkerMessage({
        jobId: 103,
        scenario: badAmount,
      });

      expect(response.error?.code).toBe(WORKER_ERROR_CODES.VALIDATION_ERROR);
      console.log(`[EVIDENCE][ERROR_CODE] Fractional cents rejected with VALIDATION_ERROR`);
    });
  });

  describe('3. Synchronous Superseding & STALE Semantics', () => {
    it('dispatches jobId=1 then immediately jobId=2: jobId=1 returns STALE and only jobId=2 is presented in client state', async () => {
      const client = new AnalysisClient();

      const stateTransitions: string[] = [];
      client.subscribe((state) => {
        stateTransitions.push(`${state.status}:job=${state.currentJobId}`);
      });

      // 同一事件循环帧连续触发 jobId=1 与 jobId=2
      const promise1 = client.runAnalysis({ jobId: 1, scenario: jwA });
      const promise2 = client.runAnalysis({ jobId: 2, scenario: jwB });

      const [res1, res2] = await Promise.all([promise1, promise2]);

      // 1. 验证 Promise 决议结果：res1 呈现 STALE 语义，res2 呈现 COMPLETE 语义
      expect(res1.status).toBe('STALE');
      expect(res1.isStale).toBe(true);
      expect(res1.jobId).toBe(1);
      expect(res1.supersededBy).toBe(2);
      expect(res1.audit).toBeUndefined();

      expect(res2.status).toBe('COMPLETE');
      expect(res2.isStale).toBe(false);
      expect(res2.jobId).toBe(2);
      expect(res2.audit).toBeDefined();
      expect(res2.audit?.expandedRows).toBe('6'); // JW-B

      // 2. 验证客户端当前呈现状态严格为最新的 jobId=2，旧响应绝不覆盖
      const finalState = client.getState();
      expect(finalState.status).toBe('COMPLETE');
      expect(finalState.currentJobId).toBe(2);
      expect(finalState.latestCompletedJobId).toBe(2);
      expect(finalState.isStale).toBe(false);
      expect(finalState.audit?.expandedRows).toBe('6');

      console.log(
        `[EVIDENCE][STALE_SYNC] Sync superseding verified: Job 1 returned STALE, Job 2 completed with expandedRows=6. State transitions: ${stateTransitions.join(' -> ')}`
      );

      client.terminate();
    });
  });

  describe('4. Asynchronous Superseding & Out-Of-Order Worker Responses', () => {
    it('guarantees an older delayed response (jobId=1) arriving AFTER a newer response (jobId=2) never overwrites state', async () => {
      // 构造具备人工时序延迟的 Worker，使 Job 1 慢速 (50ms)，Job 2 快速 (10ms)
      const listeners: Set<(ev: MessageEvent<any>) => void> = new Set();
      const mockWorker: WorkerLike = {
        postMessage(message: unknown): void {
          const req = message as WorkerRequest;
          const delay = req.jobId === 1 ? 50 : 10;
          setTimeout(async () => {
            const resp = await handleWorkerMessage(req);
            for (const l of Array.from(listeners)) {
              l({ data: resp } as MessageEvent<any>);
            }
          }, delay);
        },
        addEventListener(_type: string, listener: (ev: MessageEvent<any>) => void): void {
          listeners.add(listener);
        },
        removeEventListener(_type: string, listener: (ev: MessageEvent<any>) => void): void {
          listeners.delete(listener);
        },
      };

      const client = new AnalysisClient({
        workerFactory: () => mockWorker,
      });

      // 先投递 jobId=1
      const p1 = client.runAnalysis({ jobId: 1, scenario: jwA });

      // 稍作微小延迟后投递 jobId=2 (此时两者都在 Worker 异步飞行中)
      await new Promise((r) => setTimeout(r, 5));
      const p2 = client.runAnalysis({ jobId: 2, scenario: jwB });

      const [r1, r2] = await Promise.all([p1, p2]);

      expect(r1.status).toBe('STALE');
      expect(r1.isStale).toBe(true);

      expect(r2.status).toBe('COMPLETE');
      expect(r2.jobId).toBe(2);
      expect(r2.audit?.expandedRows).toBe('6');

      // 等待超过 60ms 确保慢速 Job 1 无论以何种方式完成，其消息都已送达并被处理
      await new Promise((r) => setTimeout(r, 60));

      // 核心断言：旧响应永不覆盖新输入！状态仍保持为 Job 2 的结果
      const finalState = client.getState();
      expect(finalState.status).toBe('COMPLETE');
      expect(finalState.currentJobId).toBe(2);
      expect(finalState.latestCompletedJobId).toBe(2);
      expect(finalState.audit?.expandedRows).toBe('6');
      expect(finalState.isStale).toBe(false);

      console.log(
        `[EVIDENCE][STALE_ASYNC] Out-of-order response dropped safely: Job 1 finished late but did not overwrite Job 2`
      );

      client.terminate();
    });
  });

  describe('5. Manual Stale Invalidation (markStale) Semantics', () => {
    it('immediately marks state as STALE upon user input change and discards in-flight worker results', async () => {
      // 构造受控延迟 Worker，使响应在 30ms 后到达
      const listeners: Set<(ev: MessageEvent<any>) => void> = new Set();
      const mockWorker: WorkerLike = {
        postMessage(message: unknown): void {
          setTimeout(async () => {
            const resp = await handleWorkerMessage(message);
            for (const l of Array.from(listeners)) {
              l({ data: resp } as MessageEvent<any>);
            }
          }, 30);
        },
        addEventListener(_type: string, listener: (ev: MessageEvent<any>) => void): void {
          listeners.add(listener);
        },
        removeEventListener(_type: string, listener: (ev: MessageEvent<any>) => void): void {
          listeners.delete(listener);
        },
      };

      const client = new AnalysisClient({
        workerFactory: () => mockWorker,
      });

      const p1 = client.runAnalysis({ jobId: 1, scenario: jwA });
      expect(client.getState().status).toBe('RUNNING');

      // 用户修改了输入或切换预设：立即标记 STALE
      client.markStale();

      const staleState = client.getState();
      expect(staleState.status).toBe('STALE');
      expect(staleState.isStale).toBe(true);

      const r1 = await p1;
      expect(r1.status).toBe('STALE');
      expect(r1.isStale).toBe(true);

      // 等待 Worker 真正返回
      await new Promise((r) => setTimeout(r, 50));

      // 验证旧结果不得伪装为当前结果：状态保持 STALE，不能变为 COMPLETE
      const afterArrivedState = client.getState();
      expect(afterArrivedState.status).toBe('STALE');
      expect(afterArrivedState.isStale).toBe(true);

      console.log(
        `[EVIDENCE][MARK_STALE] Input invalidation verified: in-flight result safely suppressed from becoming COMPLETE`
      );

      client.terminate();
    });
  });

  describe('6. Error Recovery & Error Stale Protection', () => {
    it('smoothly recovers from an error job when subsequent valid job is submitted', async () => {
      const client = new AnalysisClient();

      // 1. 发送非法场景
      const r1 = await client.runAnalysis({
        jobId: 'err-1',
        scenario: { ...jwA, layout: 'unknown_topology' },
      });

      expect(r1.status).toBe('ERROR');
      expect(r1.error?.code).toBe(WORKER_ERROR_CODES.VALIDATION_ERROR);
      expect(client.getState().status).toBe('ERROR');

      // 2. 发送合法场景恢复
      const r2 = await client.runAnalysis({
        jobId: 'rec-2',
        scenario: jwA,
      });

      expect(r2.status).toBe('COMPLETE');
      expect(r2.audit?.expandedRows).toBe('8');
      expect(client.getState().status).toBe('COMPLETE');
      expect(client.getState().error).toBeNull();

      console.log(`[EVIDENCE][RECOVERY] Error recovered to COMPLETE successfully`);

      client.terminate();
    });

    it('suppresses an older error when a newer job was already dispatched', async () => {
      const listeners: Set<(ev: MessageEvent<any>) => void> = new Set();
      const mockWorker: WorkerLike = {
        postMessage(message: unknown): void {
          const req = message as WorkerRequest;
          const delay = req.jobId === 'bad-1' ? 40 : 10;
          setTimeout(async () => {
            const resp = await handleWorkerMessage(req);
            for (const l of Array.from(listeners)) {
              l({ data: resp } as MessageEvent<any>);
            }
          }, delay);
        },
        addEventListener(_type: string, listener: (ev: MessageEvent<any>) => void): void {
          listeners.add(listener);
        },
        removeEventListener(_type: string, listener: (ev: MessageEvent<any>) => void): void {
          listeners.delete(listener);
        },
      };

      const client = new AnalysisClient({ workerFactory: () => mockWorker });

      const p1 = client.runAnalysis({
        jobId: 'bad-1',
        scenario: { ...jwA, layout: 'bad' },
      });
      const p2 = client.runAnalysis({
        jobId: 'good-2',
        scenario: jwA,
      });

      const [r1, r2] = await Promise.all([p1, p2]);

      expect(r1.status).toBe('STALE'); // 旧错误被标为 STALE
      expect(r2.status).toBe('COMPLETE'); // 新请求成功
      expect(client.getState().status).toBe('COMPLETE'); // 客户端未被旧错误污染

      console.log(
        `[EVIDENCE][STALE_ERROR] Older error suppressed by newer job: client state stays COMPLETE`
      );

      client.terminate();
    });
  });

  describe('7. Singleton Worker Guarantee ("只一个 Worker")', () => {
    it('creates exactly one worker instance across multiple concurrent and sequential runs', async () => {
      let createdInstances = 0;

      const mockWorkerFactory = (): WorkerLike => {
        createdInstances++;
        const listeners: Set<(ev: MessageEvent<any>) => void> = new Set();
        return {
          postMessage(message: unknown): void {
            setTimeout(async () => {
              const resp = await handleWorkerMessage(message);
              for (const l of Array.from(listeners)) {
                l({ data: resp } as MessageEvent<any>);
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
            listeners.clear();
          },
        };
      };

      const client = new AnalysisClient({ workerFactory: mockWorkerFactory });

      // 连续并发触发 8 次任务
      const promises = Array.from({ length: 8 }, (_, i) =>
        client.runAnalysis({ jobId: i + 1, scenario: jwA })
      );

      await Promise.all(promises);

      // 再次顺序触发 3 次任务
      await client.runAnalysis({ jobId: 100, scenario: jwB });
      await client.runAnalysis({ jobId: 101, scenario: jwC });
      await client.runAnalysis({ jobId: 102, scenario: jwD });

      // 严格断言：只创建了一个 Worker 实例！
      expect(createdInstances).toBe(1);
      expect(client.getWorkerCount()).toBe(1);

      console.log(
        `[EVIDENCE][SINGLETON] Verified exactly 1 Worker created across 11 requests: createdInstances=${createdInstances}`
      );

      client.terminate();
    });
  });

  describe('8. Zero Network Leaks Guarantee ("无数据联网")', () => {
    it('guarantees zero network calls (0 fetch calls) during entire analysis and worker execution', async () => {
      // 挂载全局 fetch spy
      const fetchSpy = vi.fn();
      vi.stubGlobal('fetch', fetchSpy);

      const client = new AnalysisClient();

      await client.runAnalysis({ jobId: 'net-test-1', scenario: jwA });
      await client.runAnalysis({ jobId: 'net-test-2', scenario: jwB });
      await client.runAnalysis({ jobId: 'net-test-3', scenario: jwC });

      // 严格断言：fetch 调用次数为 0
      expect(fetchSpy).toHaveBeenCalledTimes(0);

      console.log(
        `[EVIDENCE][ZERO_NETWORK] Zero network data calls verified: fetchSpy call count is 0`
      );

      client.terminate();
    });
  });

  describe('9. Standalone Helper Functions (runAnalysis, markStale, getClientState)', () => {
    it('provides global singleton ergonomics via runAnalysis and markStale', async () => {
      const p1 = runAnalysis({ jobId: 501, scenario: jwA });
      const p2 = runAnalysis({ jobId: 502, scenario: jwB });

      const [r1, r2] = await Promise.all([p1, p2]);

      expect(r1.status).toBe('STALE');
      expect(r2.status).toBe('COMPLETE');

      const state = getClientState();
      expect(state.status).toBe('COMPLETE');
      expect(state.currentJobId).toBe(502);

      markStale();
      expect(getClientState().status).toBe('STALE');
      expect(getClientState().isStale).toBe(true);

      console.log(
        `[EVIDENCE][STANDALONE] Global runAnalysis, markStale, getClientState verified`
      );
    });
  });
});
