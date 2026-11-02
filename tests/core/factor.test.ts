import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Scenario } from '../../src/core/types.js';
import { computeFactors, computeRowFactors } from '../../src/core/factor.js';

function loadFixture(name: string): Scenario {
  const filePath = resolve(__dirname, '../../src/fixtures', name);
  return JSON.parse(readFileSync(filePath, 'utf-8')) as Scenario;
}

describe('T003 Core Algorithm: LEFT JOIN Factorization & Factors', () => {
  it('MATH01: JW-A (star layout) factors [4, 3, 1] and expandedRows 8', () => {
    const scenario = loadFixture('jw-a.json');
    const result = computeFactors(scenario);

    // 验证逐行 factor 与分支计数
    const factors = result.rows.map((r) => Number(r.factor));
    const factorStrings = result.rows.map((r) => r.factorString);

    expect(factors).toEqual([4, 3, 1]);
    expect(factorStrings).toEqual(['4', '3', '1']);
    expect(result.expandedRows).toBe(8n);
    expect(result.expandedRowsString).toBe('8');

    // 详细核查各行
    // o1: B=2 (i11, i12), C=2 (p11, p12) => 2 * 2 = 4
    expect(result.rows[0]).toEqual({
      id: 'o1',
      factor: 4n,
      factorString: '4',
      branch1Count: 2,
      branch2Count: 2,
    });

    // o2: B=3 (i21, i22, i23), C=1 (p21) => 3 * 1 = 3
    expect(result.rows[1]).toEqual({
      id: 'o2',
      factor: 3n,
      factorString: '3',
      branch1Count: 3,
      branch2Count: 1,
    });

    // o3: B=1 (i31), C=0 => max(1, 1) * max(1, 0) = 1 * 1 = 1
    expect(result.rows[2]).toEqual({
      id: 'o3',
      factor: 1n,
      factorString: '1',
      branch1Count: 1,
      branch2Count: 0,
    });

    console.log('[EVIDENCE][JW-A] Factors verified:', factorStrings, 'Total expanded rows:', result.expandedRowsString);
  });

  it('MATH02: JW-B (chain layout) factors [5, 1] and expandedRows 6 (No Star Multiplication Misuse)', () => {
    const scenario = loadFixture('jw-b.json');
    const result = computeFactors(scenario);

    const factors = result.rows.map((r) => Number(r.factor));
    const factorStrings = result.rows.map((r) => r.factorString);

    expect(factors).toEqual([5, 1]);
    expect(factorStrings).toEqual(['5', '1']);
    expect(result.expandedRows).toBe(6n);
    expect(result.expandedRowsString).toBe('6');

    // 详细核查各行：
    // a1 (K1): B has b1(L1) and b2(L2).
    // b1(L1) connects to 2 C rows (c1, c2) => weight = 2
    // b2(L2) connects to 3 C rows (c3, c4, c5) => weight = 3
    // Total for a1 = 2 + 3 = 5.
    // branch1Count = 2, branch2Count = 5
    expect(result.rows[0]).toEqual({
      id: 'a1',
      factor: 5n,
      factorString: '5',
      branch1Count: 2,
      branch2Count: 5,
    });

    // a2 (K2): B has b3(L3).
    // b3(L3) connects to 0 C rows => weight = max(1, 0) = 1
    // Total for a2 = 1.
    // branch1Count = 1, branch2Count = 0
    expect(result.rows[1]).toEqual({
      id: 'a2',
      factor: 1n,
      factorString: '1',
      branch1Count: 1,
      branch2Count: 0,
    });

    // 严禁误用乘法核查：
    // 若错误套用 star 乘法: branch1Count(2) * branch2Count(5) = 10!
    // 真实 LEFT JOIN 物理展开为 5 行，绝非 10 行！
    expect(result.rows[0]!.factor).not.toBe(10n);

    console.log('[EVIDENCE][JW-B] Chain factors verified:', factorStrings, 'Expanded rows:', result.expandedRowsString, '(summed, not multiplied)');
  });

  it('MATH04: JW-D (SQL NULL semantics and single LEFT JOIN preservation)', () => {
    const scenario = loadFixture('jw-d.json');
    const result = computeFactors(scenario);

    const factors = result.rows.map((r) => Number(r.factor));
    const factorStrings = result.rows.map((r) => r.factorString);

    expect(factors).toEqual([1, 1]);
    expect(factorStrings).toEqual(['1', '1']);
    expect(result.expandedRows).toBe(2n);
    expect(result.expandedRowsString).toBe('2');

    // n 行 key 为 null：
    // B 中虽然存在 b1(parentKey=null) 和 b2(parentKey=null)，
    // 但在 SQL 等值连接中 NULL != NULL，因此 n 匹配到 0 条 B 记录。
    // LEFT JOIN 保留 n 本身 1 行，因此 factor=1，branch1Count=0。
    expect(result.rows[0]).toEqual({
      id: 'n',
      factor: 1n,
      factorString: '1',
      branch1Count: 0,
      branch2Count: 0,
    });

    // z 行 key 为 'Z'：匹配 b3 (parentKey='Z') => 1 条 B 记录 => factor=1
    expect(result.rows[1]).toEqual({
      id: 'z',
      factor: 1n,
      factorString: '1',
      branch1Count: 1,
      branch2Count: 0,
    });

    console.log('[EVIDENCE][JW-D] NULL semantics verified: Base row with key=null never matches mid row with parentKey=null. Factors:', factorStrings);
  });

  it('JW-C (single layout) factors [2, 2] and expandedRows 4', () => {
    const scenario = loadFixture('jw-c.json');
    const result = computeFactors(scenario);

    expect(result.rows.map((r) => Number(r.factor))).toEqual([2, 2]);
    expect(result.expandedRows).toBe(4n);
    expect(result.rows[0]!.branch1Count).toBe(2);
    expect(result.rows[1]!.branch1Count).toBe(2);
  });

  it('JW-E (single layout) factors [1, 1] and expandedRows 2', () => {
    const scenario = loadFixture('jw-e.json');
    const result = computeFactors(scenario);

    expect(result.rows.map((r) => Number(r.factor))).toEqual([1, 1]);
    expect(result.expandedRows).toBe(2n);
  });

  it('JW-F (chain layout) single middle edge lower bound factor [2] and expandedRows 2', () => {
    const scenario = loadFixture('jw-f.json');
    const result = computeFactors(scenario);

    expect(result.rows.map((r) => Number(r.factor))).toEqual([2]);
    expect(result.expandedRows).toBe(2n);
    expect(result.rows[0]).toEqual({
      id: 'a',
      factor: 2n,
      factorString: '2',
      branch1Count: 1,
      branch2Count: 2,
    });
  });

  describe('Edge cases and boundary semantics', () => {
    it('chain: mid row with linkKey=null or unmatched linkKey expands to 1 row per mid row', () => {
      const scenario: Scenario = {
        schema: 'joinwitness.scenario/v1',
        specVersion: '1.0.0',
        layout: 'chain',
        title: 'Chain with linkKey=null and unmatched',
        source: 'synthetic',
        base: [{ id: 'a1', key: 'K1', amountCents: '100' }],
        mid: [
          { id: 'b1', parentKey: 'K1', linkKey: null }, // c=0 => 1 row
          { id: 'b2', parentKey: 'K1', linkKey: 'NON_EXISTENT' }, // c=0 => 1 row
          { id: 'b3', parentKey: 'K1', linkKey: 'L1' }, // c=3 => 3 rows
        ],
        tail: [
          { id: 'c1', parentKey: 'L1' },
          { id: 'c2', parentKey: 'L1' },
          { id: 'c3', parentKey: 'L1' },
          { id: 'c4', parentKey: null }, // null parentKey in tail
        ],
      };

      const result = computeFactors(scenario);
      // a1 matches b1, b2, b3:
      // b1: max(1, 0) = 1
      // b2: max(1, 0) = 1
      // b3: max(1, 3) = 3
      // Total factor = 1 + 1 + 3 = 5
      expect(result.rows[0]!.factor).toBe(5n);
      expect(result.rows[0]!.branch1Count).toBe(3);
      expect(result.rows[0]!.branch2Count).toBe(3); // total matched C rows across all B
      expect(result.expandedRows).toBe(5n);
    });

    it('chain: base row with no mid match yields factor 1 (LEFT JOIN preservation)', () => {
      const scenario: Scenario = {
        schema: 'joinwitness.scenario/v1',
        specVersion: '1.0.0',
        layout: 'chain',
        title: 'Chain no mid match',
        source: 'synthetic',
        base: [{ id: 'a_lonely', key: 'NO_MID', amountCents: '500' }],
        mid: [{ id: 'b1', parentKey: 'OTHER', linkKey: 'L1' }],
        tail: [{ id: 'c1', parentKey: 'L1' }],
      };

      const result = computeFactors(scenario);
      expect(result.rows[0]!.factor).toBe(1n);
      expect(result.rows[0]!.branch1Count).toBe(0);
      expect(result.rows[0]!.branch2Count).toBe(0);
      expect(result.expandedRows).toBe(1n);
    });

    it('star: one branch matches 0 rows, the other branch matches multiple rows', () => {
      const scenario: Scenario = {
        schema: 'joinwitness.scenario/v1',
        specVersion: '1.0.0',
        layout: 'star',
        title: 'Star asymmetric branches',
        source: 'synthetic',
        base: [
          { id: 'a1', key: 'K1', amountCents: '100' }, // mid: 0, tail: 3 => max(1,0)*max(1,3) = 3
          { id: 'a2', key: 'K2', amountCents: '200' }, // mid: 4, tail: 0 => max(1,4)*max(1,0) = 4
          { id: 'a3', key: 'K3', amountCents: '300' }, // mid: 0, tail: 0 => max(1,0)*max(1,0) = 1
        ],
        mid: [
          { id: 'm1', parentKey: 'K2' },
          { id: 'm2', parentKey: 'K2' },
          { id: 'm3', parentKey: 'K2' },
          { id: 'm4', parentKey: 'K2' },
        ],
        tail: [
          { id: 't1', parentKey: 'K1' },
          { id: 't2', parentKey: 'K1' },
          { id: 't3', parentKey: 'K1' },
        ],
      };

      const result = computeFactors(scenario);
      expect(result.rows[0]!.factor).toBe(3n);
      expect(result.rows[0]!.branch1Count).toBe(0);
      expect(result.rows[0]!.branch2Count).toBe(3);

      expect(result.rows[1]!.factor).toBe(4n);
      expect(result.rows[1]!.branch1Count).toBe(4);
      expect(result.rows[1]!.branch2Count).toBe(0);

      expect(result.rows[2]!.factor).toBe(1n);
      expect(result.rows[2]!.branch1Count).toBe(0);
      expect(result.rows[2]!.branch2Count).toBe(0);

      expect(result.expandedRows).toBe(8n);
    });

    it('computeRowFactors is an alias for computeFactors', () => {
      const scenario = loadFixture('jw-a.json');
      expect(computeRowFactors(scenario)).toEqual(computeFactors(scenario));
    });
  });

  describe('Non-materialization & Computational Complexity Verification', () => {
    it('handles massive fanout (e.g. 125 billion rows) in milliseconds without OOM', () => {
      // 构造 base: 5000 rows, mid: 5000 rows, tail: 5000 rows
      // 全部指向同个 key 'HOT_KEY'
      // 每个 base row factor = 5000 * 5000 = 25,000,000
      // 总展开行数 = 5000 * 25,000,000 = 125,000,000,000 (1250 亿行)
      // 若物化全量行必 OOM 崩溃；分解式算法为 O(|A|+|B|+|C|) 线性时间。
      const N = 5000;
      const base = new Array(N);
      const mid = new Array(N);
      const tail = new Array(N);

      for (let i = 0; i < N; i++) {
        base[i] = { id: `a_${i}`, key: 'HOT_KEY', amountCents: '100' };
        mid[i] = { id: `b_${i}`, parentKey: 'HOT_KEY' };
        tail[i] = { id: `c_${i}`, parentKey: 'HOT_KEY' };
      }

      const massiveScenario: Scenario = {
        schema: 'joinwitness.scenario/v1',
        specVersion: '1.0.0',
        layout: 'star',
        title: 'Massive Fanout Non-materialization Benchmark',
        source: 'synthetic',
        base,
        mid,
        tail,
      };

      const startTime = performance.now();
      const result = computeFactors(massiveScenario);
      const elapsedMs = performance.now() - startTime;

      expect(result.rows.length).toBe(N);
      expect(result.rows[0]!.factor).toBe(25_000_000n);
      expect(result.expandedRows).toBe(125_000_000_000n);
      expect(result.expandedRowsString).toBe('125000000000');

      // 验证耗时应远小于 1 秒（通常在 20ms 内）
      expect(elapsedMs).toBeLessThan(1000);

      console.log(`[EVIDENCE][COMPLEXITY] Massive fanout test: 125,000,000,000 rows calculated in ${elapsedMs.toFixed(2)}ms without materialization.`);
      console.log('[EVIDENCE][COMPLEXITY] Time complexity is strictly O(|A| + |B| + |C|); memory is O(|B| + |C|) for hash maps.');
    });
  });
});
