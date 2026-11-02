import { describe, it, expect } from 'vitest';
import type { Scenario, BaseRow, MidRow, TailRow } from '../../src/core/types.js';
import { validateScenario } from '../../src/core/validate.js';
import { computeFactors } from '../../src/core/factor.js';
import { computeAmountAudit } from '../../src/core/amount.js';
import { analyze } from '../../src/core/analyze.js';

describe('T007 Core Scale & Non-Materialization (MATH09 & Large Scenarios)', () => {
  describe('MATH09: Massive Fanout Non-Materialization Guarantee', () => {
    it('calculates 125 BILLION expanded rows in milliseconds without materializing Cartesian product', () => {
      // 5,000 base rows, 5,000 mid rows (key K), 5,000 tail rows (key K)
      // Star layout: each base row matches 5,000 mid and 5,000 tail rows
      // Factor per row: 5,000 * 5,000 = 25,000,000
      // Total expanded rows: 5,000 * 25,000,000 = 125,000,000,000 (125 Billion)
      const baseRows: BaseRow[] = Array.from({ length: 5000 }, (_, i) => ({
        id: `base_${i}`,
        key: 'KEY_MASSIVE',
        amountCents: '100',
      }));

      const midRows: MidRow[] = Array.from({ length: 5000 }, (_, i) => ({
        id: `mid_${i}`,
        parentKey: 'KEY_MASSIVE',
      }));

      const tailRows: TailRow[] = Array.from({ length: 5000 }, (_, i) => ({
        id: `tail_${i}`,
        parentKey: 'KEY_MASSIVE',
      }));

      const scenario: Scenario = {
        schema: 'joinwitness.scenario/v1',
        specVersion: '1.0.0',
        layout: 'star',
        title: 'Massive Fanout 125 Billion Rows',
        source: 'synthetic',
        base: baseRows,
        mid: midRows,
        tail: tailRows,
      };

      // Force GC if available or record baseline heap
      if (typeof global.gc === 'function') {
        global.gc();
      }
      const initialHeap = process.memoryUsage().heapUsed;
      const startTime = performance.now();

      const factorResult = computeFactors(scenario);
      const amountResult = computeAmountAudit(scenario, factorResult);

      const elapsedMs = performance.now() - startTime;
      const finalHeap = process.memoryUsage().heapUsed;
      const heapDeltaBytes = finalHeap - initialHeap;
      const heapDeltaMB = heapDeltaBytes / (1024 * 1024);

      // Verify exact mathematical values
      expect(factorResult.expandedRows).toBe(125_000_000_000n);
      expect(factorResult.expandedRowsString).toBe('125000000000');
      expect(amountResult.safeSumCents).toBe('500000'); // 5000 * 100
      expect(amountResult.naiveSumCents).toBe('12500000000000'); // 125,000,000,000 * 100
      expect(amountResult.deltaCents).toBe('12499999500000');
      expect(amountResult.unsafeBaseRows).toBe(5000);

      // Non-materialization evidence:
      // Materializing 125 billion rows would take > 1 TB RAM and minutes/hours
      // JoinWitness factorization must finish in < 500ms and use < 60MB heap delta
      expect(elapsedMs).toBeLessThan(500);
      expect(heapDeltaMB).toBeLessThan(60);

      console.log(
        `[EVIDENCE][NON_MATERIALIZATION] 125 Billion rows computed in ${elapsedMs.toFixed(2)}ms, heap delta: ${heapDeltaMB.toFixed(2)}MB`
      );
    });

    it('handles chain layout massive fanout without Cartesian explosion', () => {
      // Chain layout: 1 base row matches 5,000 mid rows, each mid row links to 1 tail row
      // f = 5,000 * 1 = 5,000
      const midRows: MidRow[] = Array.from({ length: 5000 }, (_, i) => ({
        id: `mid_${i}`,
        parentKey: 'BASE_KEY',
        linkKey: `LINK_${i % 100}`, // 100 distinct link keys
      }));

      // 5,000 tail rows distributed across 100 link keys (50 tail rows per link)
      const tailRows: TailRow[] = Array.from({ length: 5000 }, (_, i) => ({
        id: `tail_${i}`,
        parentKey: `LINK_${i % 100}`,
      }));

      const scenario: Scenario = {
        schema: 'joinwitness.scenario/v1',
        specVersion: '1.0.0',
        layout: 'chain',
        title: 'Chain Layout Scale Scenario',
        source: 'synthetic',
        base: [{ id: 'b0', key: 'BASE_KEY', amountCents: '1000' }],
        mid: midRows,
        tail: tailRows,
      };

      const startTime = performance.now();
      const factorResult = computeFactors(scenario);
      const elapsedMs = performance.now() - startTime;

      // Each mid row has 50 matching tail rows, so c_b = 50
      // f_0 = 5000 * 50 = 250,000
      expect(factorResult.expandedRows).toBe(250_000n);
      expect(factorResult.rows[0]!.factor).toBe(250_000n);
      expect(elapsedMs).toBeLessThan(100);
    });
  });

  describe('Boundary Scale Performance (5,000 / 5,000 / 5,000 limits)', () => {
    it('validates and analyzes maximum capacity scenario within strict time budget (<= 1s)', async () => {
      // 5,000 base, 5,000 mid, 5,000 tail
      const baseRows: BaseRow[] = Array.from({ length: 5000 }, (_, i) => ({
        id: `b_${i.toString().padStart(4, '0')}`,
        key: `K_${i % 1000}`,
        amountCents: `${(i % 1000) * 100}`,
      }));

      const midRows: MidRow[] = Array.from({ length: 5000 }, (_, i) => ({
        id: `m_${i.toString().padStart(4, '0')}`,
        parentKey: `K_${i % 1000}`,
      }));

      const tailRows: TailRow[] = Array.from({ length: 5000 }, (_, i) => ({
        id: `t_${i.toString().padStart(4, '0')}`,
        parentKey: `K_${i % 1000}`,
      }));

      const scenario: Scenario = {
        schema: 'joinwitness.scenario/v1',
        specVersion: '1.0.0',
        layout: 'star',
        title: 'Max Capacity 15,000 Rows',
        source: 'synthetic',
        base: baseRows,
        mid: midRows,
        tail: tailRows,
      };

      // Validation check
      const valStart = performance.now();
      const valResult = validateScenario(scenario);
      const valTime = performance.now() - valStart;
      expect(valResult.valid).toBe(true);
      expect(valTime).toBeLessThan(300);

      // Core analysis (skip witness search for raw core scale, witness tested separately)
      const analyzeStart = performance.now();
      const audit = await analyze(scenario, { skipWitness: true });
      const analyzeTime = performance.now() - analyzeStart;

      expect(audit.baseRows).toBe(5000);
      expect(audit.rows).toHaveLength(5000);
      expect(BigInt(audit.expandedRows) >= 5000n).toBe(true);
      expect(analyzeTime).toBeLessThan(1000);

      console.log(
        `[EVIDENCE][SCALE_MAX] 15,000 rows (5k/5k/5k) validated in ${valTime.toFixed(2)}ms, analyzed in ${analyzeTime.toFixed(2)}ms`
      );
    });

    // Note (TASK-P008-T007-FIX):
    // 算法本身无性能问题（bench 脚本实测 1250 亿行计数仅 3.67ms、堆增量 3.41MB）。
    // 在共享 4 核 VM 环境下受宿主负载抖动影响，原 50ms 墙钟阈值偶发超时（实测偶发 61.67ms）。
    // 将两处墙钟断言由 50ms 放宽至 200ms，既能稳健防止抖动，又足以证明毫秒级非物化性能（远低于物化量级与 2s/5s 目标）。
    it('handles 5,000 base rows with 0 mid and 0 tail rows in under 200ms', () => {
      const baseRows: BaseRow[] = Array.from({ length: 5000 }, (_, i) => ({
        id: `b_${i}`,
        key: `K_${i}`,
        amountCents: '100',
      }));

      const scenario: Scenario = {
        schema: 'joinwitness.scenario/v1',
        specVersion: '1.0.0',
        layout: 'single',
        title: 'Zero Mid Scale Scenario',
        source: 'synthetic',
        base: baseRows,
        mid: [],
        tail: [],
      };

      const start = performance.now();
      const factors = computeFactors(scenario);
      const amount = computeAmountAudit(scenario, factors);
      const elapsed = performance.now() - start;

      expect(factors.expandedRows).toBe(5000n);
      expect(amount.safeSumCents).toBe('500000');
      expect(amount.naiveSumCents).toBe('500000');
      expect(amount.deltaCents).toBe('0');
      expect(amount.unsafeBaseRows).toBe(0);
      expect(elapsed).toBeLessThan(200);
    });

    it('handles 5,000 base rows with all-NULL keys in under 200ms', () => {
      const baseRows: BaseRow[] = Array.from({ length: 5000 }, (_, i) => ({
        id: `b_${i}`,
        key: null,
        amountCents: '250',
      }));

      const midRows: MidRow[] = Array.from({ length: 5000 }, (_, i) => ({
        id: `m_${i}`,
        parentKey: null,
      }));

      const scenario: Scenario = {
        schema: 'joinwitness.scenario/v1',
        specVersion: '1.0.0',
        layout: 'single',
        title: 'All Null Keys Scale Scenario',
        source: 'synthetic',
        base: baseRows,
        mid: midRows,
        tail: [],
      };

      const start = performance.now();
      const factors = computeFactors(scenario);
      const amount = computeAmountAudit(scenario, factors);
      const elapsed = performance.now() - start;

      // NULL never matches NULL, so each base row has factor 1
      expect(factors.expandedRows).toBe(5000n);
      expect(amount.safeSumCents).toBe('1250000');
      expect(amount.naiveSumCents).toBe('1250000');
      expect(amount.deltaCents).toBe('0');
      expect(amount.unsafeBaseRows).toBe(0);
      expect(elapsed).toBeLessThan(200);
    });
  });
});
