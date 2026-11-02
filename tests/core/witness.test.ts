import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Scenario } from '../../src/core/types.js';
import { validateScenario } from '../../src/core/validate.js';
import { computeFactors } from '../../src/core/factor.js';
import {
  analyze,
  registerWitnessFinder,
  getRegisteredWitnessFinder,
} from '../../src/core/analyze.js';
import {
  findMinimalWitness,
  buildWitnessScenario,
  verifyWitnessMinimality,
  type ScenarioSubset,
} from '../../src/core/witness.js';

function loadFixture(name: string): Scenario {
  const filePath = resolve(__dirname, '../../src/fixtures', name);
  return JSON.parse(readFileSync(filePath, 'utf-8')) as Scenario;
}

afterEach(() => {
  // 恢复全局注册状态
  registerWitnessFinder(null);
});

describe('T005 Core Algorithm: Minimal Structural Witness (findMinimalWitness)', () => {
  describe('MATH06 & Golden Presets: JW-A through JW-F', () => {
    it('JW-A (star layout): minimal witness of exactly 3 rows (o1, i11, i12)', async () => {
      const jwA = loadFixture('jw-a.json');
      const subset = findMinimalWitness(jwA);

      // 验证见证行数与结构
      expect(subset.rowCount).toBe(3);
      expect(subset.kind).toBe('NUMERIC_AND_STRUCTURAL');
      expect(subset.rowIds.base).toEqual(['o1']);
      expect(subset.rowIds.mid).toEqual(['i11', 'i12']);
      expect(subset.rowIds.tail).toEqual([]);

      // 验证子场景存在且完全符合 Scenario v1 契约
      expect(subset.scenario).not.toBeNull();
      const valRes = validateScenario(subset.scenario!);
      expect(valRes.valid).toBe(true);

      // 重新运行 analyze(subscenario)，断言 unsafeBaseRows === 1
      const subAudit = await analyze(subset.scenario!);
      expect(subAudit.unsafeBaseRows).toBe(1);
      expect(subAudit.expandedRows).toBe('2');
      expect(subAudit.rows[0]?.factor).toBe('2');
      expect(subAudit.rows[0]?.amountCents).toBe('5000');
      expect(subAudit.deltaCents).toBe('5000');

      // 验证最小性：移除任一见证行后不再倍行
      const minCheck = verifyWitnessMinimality(jwA, subset);
      expect(minCheck.isMinimal).toBe(true);
      expect(minCheck.violations).toEqual([]);

      // 细粒度断言：删除关联侧任意一条见证行
      const withoutI11: Scenario = {
        ...subset.scenario!,
        mid: subset.scenario!.mid.filter((r) => r.id !== 'i11'),
      };
      const fWithoutI11 = computeFactors(withoutI11);
      expect(fWithoutI11.rows[0]?.factorString).toBe('1');
      expect(fWithoutI11.expandedRowsString).toBe('1');

      const withoutI12: Scenario = {
        ...subset.scenario!,
        mid: subset.scenario!.mid.filter((r) => r.id !== 'i12'),
      };
      const fWithoutI12 = computeFactors(withoutI12);
      expect(fWithoutI12.rows[0]?.factorString).toBe('1');
      expect(fWithoutI12.expandedRowsString).toBe('1');

      console.log(`[EVIDENCE][JW-A] 3-row witness verified: base=[${subset.rowIds.base}], mid=[${subset.rowIds.mid}], tail=[${subset.rowIds.tail}], factor=2`);
    });

    it('JW-F (chain layout): minimal witness of exactly 4 rows (a, b, c1, c2)', async () => {
      const jwF = loadFixture('jw-f.json');
      const subset = findMinimalWitness(jwF);

      // 验证见证行数与结构
      expect(subset.rowCount).toBe(4);
      expect(subset.kind).toBe('NUMERIC_AND_STRUCTURAL');
      expect(subset.rowIds.base).toEqual(['a']);
      expect(subset.rowIds.mid).toEqual(['b']);
      expect(subset.rowIds.tail).toEqual(['c1', 'c2']);

      // 验证子场景存在且通过校验
      expect(subset.scenario).not.toBeNull();
      const valRes = validateScenario(subset.scenario!);
      expect(valRes.valid).toBe(true);

      // 重新运行 analyze(subscenario)，断言 unsafeBaseRows === 1
      const subAudit = await analyze(subset.scenario!);
      expect(subAudit.unsafeBaseRows).toBe(1);
      expect(subAudit.expandedRows).toBe('2');
      expect(subAudit.rows[0]?.factor).toBe('2');
      expect(subAudit.deltaCents).toBe('1000');

      // 验证最小性：链式单中间边 4 行下界
      const minCheck = verifyWitnessMinimality(jwF, subset);
      expect(minCheck.isMinimal).toBe(true);
      expect(minCheck.violations).toEqual([]);

      // 细粒度断言：删除关联侧 mid 或 tail 任一行后无倍行
      const withoutB: Scenario = {
        ...subset.scenario!,
        mid: [],
      };
      const fWithoutB = computeFactors(withoutB);
      expect(fWithoutB.rows[0]?.factorString).toBe('1');

      const withoutC1: Scenario = {
        ...subset.scenario!,
        tail: subset.scenario!.tail.filter((r) => r.id !== 'c1'),
      };
      const fWithoutC1 = computeFactors(withoutC1);
      expect(fWithoutC1.rows[0]?.factorString).toBe('1');

      const withoutC2: Scenario = {
        ...subset.scenario!,
        tail: subset.scenario!.tail.filter((r) => r.id !== 'c2'),
      };
      const fWithoutC2 = computeFactors(withoutC2);
      expect(fWithoutC2.rows[0]?.factorString).toBe('1');

      console.log(`[EVIDENCE][JW-F] 4-row witness verified: base=[${subset.rowIds.base}], mid=[${subset.rowIds.mid}], tail=[${subset.rowIds.tail}], factor=2`);
    });

    it('JW-B (chain layout): minimal witness of 3 rows (a1, b1, b2) because A has 2 matching B rows', async () => {
      const jwB = loadFixture('jw-b.json');
      const subset = findMinimalWitness(jwB);

      // JW-B 中 a1 拥有 2 条 B 匹配 (b1, b2)，故构成 3 行见证 (A+2B)，优于 4 行 (A+1B+2C)
      expect(subset.rowCount).toBe(3);
      expect(subset.kind).toBe('NUMERIC_AND_STRUCTURAL');
      expect(subset.rowIds.base).toEqual(['a1']);
      expect(subset.rowIds.mid).toEqual(['b1', 'b2']);
      expect(subset.rowIds.tail).toEqual([]);

      const valRes = validateScenario(subset.scenario!);
      expect(valRes.valid).toBe(true);

      const subAudit = await analyze(subset.scenario!);
      expect(subAudit.unsafeBaseRows).toBe(1);
      expect(subAudit.rows[0]?.factor).toBe('2');

      const minCheck = verifyWitnessMinimality(jwB, subset);
      expect(minCheck.isMinimal).toBe(true);
      expect(minCheck.violations).toEqual([]);
    });

    it('JW-C (single layout): negative amount cancellation still yields 3-row witness (x, bx1, bx2)', async () => {
      const jwC = loadFixture('jw-c.json');
      const subset = findMinimalWitness(jwC);

      // JW-C 全局 Δ=0，但存在倍行结构，见证仍优先挑选非零金额并按 ID 排序（x < y）
      expect(subset.rowCount).toBe(3);
      expect(subset.kind).toBe('NUMERIC_AND_STRUCTURAL');
      expect(subset.rowIds.base).toEqual(['x']);
      expect(subset.rowIds.mid).toEqual(['bx1', 'bx2']);
      expect(subset.rowIds.tail).toEqual([]);

      const minCheck = verifyWitnessMinimality(jwC, subset);
      expect(minCheck.isMinimal).toBe(true);
    });

    it('JW-D (single layout with SQL NULL keys): no duplication returns NONE', () => {
      const jwD = loadFixture('jw-d.json');
      const subset = findMinimalWitness(jwD);

      expect(subset.rowCount).toBe(0);
      expect(subset.kind).toBe('NONE');
      expect(subset.scenario).toBeNull();
      expect(subset.rowIds.base).toEqual([]);
      expect(subset.rowIds.mid).toEqual([]);
      expect(subset.rowIds.tail).toEqual([]);

      const minCheck = verifyWitnessMinimality(jwD, subset);
      expect(minCheck.isMinimal).toBe(true);
      expect(minCheck.baseDuplicationDetected).toBe(false);

      console.log(`[EVIDENCE][JW-D] NULL keys safe: witness kind is NONE`);
    });

    it('JW-E (single layout with 1-to-1 matches): no duplication returns NONE', () => {
      const jwE = loadFixture('jw-e.json');
      const subset = findMinimalWitness(jwE);

      expect(subset.rowCount).toBe(0);
      expect(subset.kind).toBe('NONE');
      expect(subset.scenario).toBeNull();
      expect(subset.rowIds.base).toEqual([]);
      expect(subset.rowIds.mid).toEqual([]);
      expect(subset.rowIds.tail).toEqual([]);
    });
  });

  describe('Optimality Constraints: Non-zero Amount vs Row Count vs ID Ordering', () => {
    it('prefers non-zero amount base row when candidate row counts are identical (3 vs 3)', () => {
      const scenario: Scenario = {
        schema: 'joinwitness.scenario/v1',
        specVersion: '1.0.0',
        layout: 'single',
        title: 'Zero vs Non-Zero Amount Tie',
        source: 'synthetic',
        base: [
          { id: 'a_zero', key: 'K1', amountCents: '0' },
          { id: 'b_nonzero', key: 'K2', amountCents: '500' },
        ],
        mid: [
          { id: 'm1', parentKey: 'K1' },
          { id: 'm2', parentKey: 'K1' },
          { id: 'm3', parentKey: 'K2' },
          { id: 'm4', parentKey: 'K2' },
        ],
        tail: [],
      };

      const subset = findMinimalWitness(scenario);
      expect(subset.rowCount).toBe(3);
      // 虽然 a_zero 字典序更小 ('a_zero' < 'b_nonzero')，但 b_nonzero 金额非零，优先选中
      expect(subset.rowIds.base).toEqual(['b_nonzero']);
      expect(subset.rowIds.mid).toEqual(['m3', 'm4']);
      expect(subset.kind).toBe('NUMERIC_AND_STRUCTURAL');
    });

    it('marks STRUCTURAL_ONLY when all duplicating candidates have amountCents === "0"', () => {
      const scenario: Scenario = {
        schema: 'joinwitness.scenario/v1',
        specVersion: '1.0.0',
        layout: 'single',
        title: 'Pure Structural Duplication',
        source: 'synthetic',
        base: [{ id: 'a0', key: 'K', amountCents: '0' }],
        mid: [
          { id: 'm1', parentKey: 'K' },
          { id: 'm2', parentKey: 'K' },
        ],
        tail: [],
      };

      const subset = findMinimalWitness(scenario);
      expect(subset.rowCount).toBe(3);
      expect(subset.kind).toBe('STRUCTURAL_ONLY');
      expect(subset.rowIds.base).toEqual(['a0']);
      expect(subset.rowIds.mid).toEqual(['m1', 'm2']);
    });

    it('CRITICAL: Non-zero amount preference MUST NOT break row count optimality (3 rows with 0 cents strictly beats 4 rows with 5000 cents)', () => {
      // 在 chain 布局中：
      // - row 'z_three' 拥有 2 个 mid 匹配，构成 3 行见证 (A+2B)，但金额为 0
      // - row 'nz_four' 拥有 1 个 mid 匹配和 2 个 tail 匹配，构成 4 行见证 (A+1B+2C)，金额为 5000
      // 依项目书 §6.2：“偏好非零金额基表（不牺牲最少行数）”，3 行绝对优先于 4 行！
      const scenario: Scenario = {
        schema: 'joinwitness.scenario/v1',
        specVersion: '1.0.0',
        layout: 'chain',
        title: '3-row zero beats 4-row nonzero',
        source: 'synthetic',
        base: [
          { id: 'nz_four', key: 'K_CHAIN_4', amountCents: '5000' },
          { id: 'z_three', key: 'K_CHAIN_3', amountCents: '0' },
        ],
        mid: [
          // z_three 的 2 条 mid 边 -> 3 行见证
          { id: 'm_three_1', parentKey: 'K_CHAIN_3', linkKey: 'L_UNUSED_1' },
          { id: 'm_three_2', parentKey: 'K_CHAIN_3', linkKey: 'L_UNUSED_2' },
          // nz_four 的 1 条 mid 边
          { id: 'm_four_1', parentKey: 'K_CHAIN_4', linkKey: 'L_CHAIN_4' },
        ],
        tail: [
          // 连在 m_four_1 后面的 2 条 tail 边 -> 4 行见证
          { id: 't_four_1', parentKey: 'L_CHAIN_4' },
          { id: 't_four_2', parentKey: 'L_CHAIN_4' },
        ],
      };

      const subset = findMinimalWitness(scenario);

      // 验证必须是 3 行，绝不能因为金额非零而贪婪选择 4 行！
      expect(subset.rowCount).toBe(3);
      expect(subset.rowIds.base).toEqual(['z_three']);
      expect(subset.rowIds.mid).toEqual(['m_three_1', 'm_three_2']);
      expect(subset.rowIds.tail).toEqual([]);
      expect(subset.kind).toBe('STRUCTURAL_ONLY');

      console.log(`[EVIDENCE][OPTIMALITY] Row-count priority strictly honored: 3-row zero (z_three) preferred over 4-row nonzero (nz_four)`);
    });

    it('uses ASCII ID tuple as deterministic tie-breaker when row count and non-zero amount match', () => {
      const scenario: Scenario = {
        schema: 'joinwitness.scenario/v1',
        specVersion: '1.0.0',
        layout: 'single',
        title: 'Deterministic Tie Breaking',
        source: 'synthetic',
        base: [
          { id: 'row_beta', key: 'KB', amountCents: '100' },
          { id: 'row_alpha', key: 'KA', amountCents: '100' },
        ],
        mid: [
          { id: 'mb2', parentKey: 'KB' },
          { id: 'mb1', parentKey: 'KB' },
          { id: 'ma2', parentKey: 'KA' },
          { id: 'ma1', parentKey: 'KA' },
        ],
        tail: [],
      };

      const subset = findMinimalWitness(scenario);
      expect(subset.rowIds.base).toEqual(['row_alpha']);
      // 保持原始 mid 出现的相对顺序 (ma2 先于 ma1)
      expect(subset.rowIds.mid).toEqual(['ma2', 'ma1']);
    });

    it('is completely deterministic across 10 repeated runs', () => {
      const jwA = loadFixture('jw-a.json');
      const first = findMinimalWitness(jwA);
      for (let i = 0; i < 10; i++) {
        const next = findMinimalWitness(jwA);
        expect(next.rowIds).toEqual(first.rowIds);
        expect(next.kind).toEqual(first.kind);
        expect(next.rowCount).toEqual(first.rowCount);
      }
    });

    it('star layout chooses minimal ASCII tuple between mid branch and tail branch', () => {
      // 基表同时在 mid 和 tail 分支都有 2 条匹配
      const scenario: Scenario = {
        schema: 'joinwitness.scenario/v1',
        specVersion: '1.0.0',
        layout: 'star',
        title: 'Star Branch Tie Breaking',
        source: 'synthetic',
        base: [{ id: 'a1', key: 'K', amountCents: '1000' }],
        mid: [
          { id: 'z_mid_1', parentKey: 'K' },
          { id: 'z_mid_2', parentKey: 'K' },
        ],
        tail: [
          { id: 'a_tail_1', parentKey: 'K' },
          { id: 'a_tail_2', parentKey: 'K' },
        ],
      };

      const subset = findMinimalWitness(scenario);
      // 'a_tail_1' < 'z_mid_1'，故 tail 分支 tuple 更小，被选为见证
      expect(subset.rowCount).toBe(3);
      expect(subset.rowIds.base).toEqual(['a1']);
      expect(subset.rowIds.mid).toEqual([]);
      expect(subset.rowIds.tail).toEqual(['a_tail_1', 'a_tail_2']);
    });

    it('B01 Regression: chain layout with empty string linkKey ("") correctly yields 4-row witness (factor=2, expandedRows=2)', async () => {
      const scenario: Scenario = {
        schema: 'joinwitness.scenario/v1',
        specVersion: '1.0.0',
        layout: 'chain',
        title: 'B01 Empty String LinkKey Regression',
        source: 'synthetic',
        base: [{ id: 'a1', key: 'k1', amountCents: '1000' }],
        mid: [{ id: 'b1', parentKey: 'k1', linkKey: '' }],
        tail: [
          { id: 'c1', parentKey: '' },
          { id: 'c2', parentKey: '' },
        ],
      };

      // 验证 factor 计算：1 A -> 1 B -> 2 C => factor = 2, expandedRows = 2
      const factorRes = computeFactors(scenario);
      expect(factorRes.rows[0]?.factorString).toBe('2');
      expect(factorRes.expandedRowsString).toBe('2');

      // 验证 findMinimalWitness 不会将 "" 当作无连接键跳过，返回 4 行见证
      const subset = findMinimalWitness(scenario);
      expect(subset.rowCount).toBe(4);
      expect(subset.kind).toBe('NUMERIC_AND_STRUCTURAL');
      expect(subset.rowIds.base).toEqual(['a1']);
      expect(subset.rowIds.mid).toEqual(['b1']);
      expect(subset.rowIds.tail).toEqual(['c1', 'c2']);
      expect(subset.scenario).not.toBeNull();

      // 验证完整审计分析与因子的严格一致性
      const audit = await analyze(scenario, { witnessFinder: findMinimalWitness });
      expect(audit.unsafeBaseRows).toBe(1);
      expect(audit.expandedRows).toBe('2');
      expect(audit.rows[0]?.factor).toBe('2');
      expect(audit.witness.kind).toBe('NUMERIC_AND_STRUCTURAL');
      expect(audit.witness.rowIds.base).toEqual(['a1']);
      expect(audit.witness.rowIds.mid).toEqual(['b1']);
      expect(audit.witness.rowIds.tail).toEqual(['c1', 'c2']);

      // 验证最小性：移除 mid 或任一 tail 行后不再倍行
      const minCheck = verifyWitnessMinimality(scenario, subset);
      expect(minCheck.isMinimal).toBe(true);
      expect(minCheck.violations).toEqual([]);
    });

    it('B01 Regression: chain layout with NULL linkKey correctly skips match and returns NONE witness', async () => {
      const scenario: Scenario = {
        schema: 'joinwitness.scenario/v1',
        specVersion: '1.0.0',
        layout: 'chain',
        title: 'B01 NULL LinkKey Control',
        source: 'synthetic',
        base: [{ id: 'a1', key: 'k1', amountCents: '1000' }],
        mid: [{ id: 'b1', parentKey: 'k1', linkKey: null }],
        tail: [
          { id: 'c1', parentKey: null },
          { id: 'c2', parentKey: null },
        ],
      };

      // 验证 factor 计算：SQL NULL 互不相连，无倍行 (factor = 1, expandedRows = 1)
      const factorRes = computeFactors(scenario);
      expect(factorRes.rows[0]?.factorString).toBe('1');
      expect(factorRes.expandedRowsString).toBe('1');

      // 验证 findMinimalWitness 正确跳过 NULL 键并返回 NONE
      const subset = findMinimalWitness(scenario);
      expect(subset.rowCount).toBe(0);
      expect(subset.kind).toBe('NONE');
      expect(subset.rowIds.base).toEqual([]);
      expect(subset.rowIds.mid).toEqual([]);
      expect(subset.rowIds.tail).toEqual([]);
      expect(subset.scenario).toBeNull();

      const audit = await analyze(scenario, { witnessFinder: findMinimalWitness });
      expect(audit.unsafeBaseRows).toBe(0);
      expect(audit.expandedRows).toBe('1');
      expect(audit.witness.kind).toBe('NONE');
    });

    it('B01 Regression: chain layout with all empty string keys (key="", parentKey="", linkKey="")', async () => {
      const scenario: Scenario = {
        schema: 'joinwitness.scenario/v1',
        specVersion: '1.0.0',
        layout: 'chain',
        title: 'B01 All Empty String Keys',
        source: 'synthetic',
        base: [{ id: 'a1', key: '', amountCents: '500' }],
        mid: [{ id: 'b1', parentKey: '', linkKey: '' }],
        tail: [
          { id: 'c1', parentKey: '' },
          { id: 'c2', parentKey: '' },
        ],
      };

      const factorRes = computeFactors(scenario);
      expect(factorRes.rows[0]?.factorString).toBe('2');
      expect(factorRes.expandedRowsString).toBe('2');

      const subset = findMinimalWitness(scenario);
      expect(subset.rowCount).toBe(4);
      expect(subset.kind).toBe('NUMERIC_AND_STRUCTURAL');
      expect(subset.rowIds.base).toEqual(['a1']);
      expect(subset.rowIds.mid).toEqual(['b1']);
      expect(subset.rowIds.tail).toEqual(['c1', 'c2']);

      const minCheck = verifyWitnessMinimality(scenario, subset);
      expect(minCheck.isMinimal).toBe(true);
      expect(minCheck.violations).toEqual([]);
    });
  });

  describe('Integration with analyze() & Worker / Registration Contract', () => {
    it('works as a witnessFinder option passed to analyze()', async () => {
      const jwA = loadFixture('jw-a.json');
      const audit = await analyze(jwA, {
        witnessFinder: findMinimalWitness,
      });

      expect(audit.witness.kind).toBe('NUMERIC_AND_STRUCTURAL');
      expect(audit.witness.rowIds.base).toEqual(['o1']);
      expect(audit.witness.rowIds.mid).toEqual(['i11', 'i12']);
      expect(audit.witness.rowIds.tail).toEqual([]);
    });

    it('works via global registerWitnessFinder', async () => {
      registerWitnessFinder(findMinimalWitness);
      expect(getRegisteredWitnessFinder()).toBe(findMinimalWitness);

      const jwF = loadFixture('jw-f.json');
      const audit = await analyze(jwF);

      expect(audit.witness.kind).toBe('NUMERIC_AND_STRUCTURAL');
      expect(audit.witness.rowIds.base).toEqual(['a']);
      expect(audit.witness.rowIds.mid).toEqual(['b']);
      expect(audit.witness.rowIds.tail).toEqual(['c1', 'c2']);
    });
  });

  describe('Helper Functions & Contract Edge Cases', () => {
    it('buildWitnessScenario returns null for kind NONE', () => {
      const jwD = loadFixture('jw-d.json');
      const noneWitness = findMinimalWitness(jwD);
      const built = buildWitnessScenario(jwD, noneWitness);
      expect(built).toBeNull();
    });

    it('buildWitnessScenario builds exact subset matching witness IDs', () => {
      const jwA = loadFixture('jw-a.json');
      const subset = findMinimalWitness(jwA);
      const built = buildWitnessScenario(jwA, subset);

      expect(built).not.toBeNull();
      expect(built!.base.map((r) => r.id)).toEqual(['o1']);
      expect(built!.mid.map((r) => r.id)).toEqual(['i11', 'i12']);
      expect(built!.tail).toHaveLength(0);
    });

    it('verifyWitnessMinimality catches non-minimal or invalid scenarios', () => {
      // 构造一个多余行未裁剪的伪见证
      const fakeSubset: ScenarioSubset = {
        kind: 'NUMERIC_AND_STRUCTURAL',
        rowCount: 5, // 不符合 3 或 4 行要求
        rowIds: {
          base: ['o1'],
          mid: ['i11', 'i12', 'i13'],
          tail: [],
        },
        witness: {
          kind: 'NUMERIC_AND_STRUCTURAL',
          rowIds: { base: ['o1'], mid: ['i11', 'i12', 'i13'], tail: [] },
        },
        scenario: {
          schema: 'joinwitness.scenario/v1',
          specVersion: '1.0.0',
          layout: 'single',
          title: 'Fake',
          source: 'synthetic',
          base: [{ id: 'o1', key: 'K', amountCents: '100' }],
          mid: [
            { id: 'i11', parentKey: 'K' },
            { id: 'i12', parentKey: 'K' },
            { id: 'i13', parentKey: 'K' },
          ],
          tail: [],
        },
      };

      const res = verifyWitnessMinimality(fakeSubset.scenario!, fakeSubset);
      expect(res.isMinimal).toBe(false);
      // 包含多余行，移除任一行后依然有倍行
      expect(res.violations.length).toBeGreaterThan(0);
    });
  });

  describe('Exhaustive Brute-Force Subset Enumeration (MATH06 & §6.2 Verification for <= 9 rows)', () => {
    /**
     * 独立子集枚举器：
     * 不调用 findMinimalWitness 内部逻辑，直接穷举所有可能的输入行删除子集，
     * 验证是否存在更少行数能导致任何 baseRow factor > 1。
     */
    function findGlobalMinimalRowCountByExhaustiveSearch(scenario: Scenario): number {
      const totalRows = scenario.base.length + scenario.mid.length + scenario.tail.length;
      if (totalRows > 12) {
        throw new Error('Scenario too large for exhaustive search');
      }

      // 按子集大小 k = 1, 2, 3, 4 从小到大枚举
      for (let k = 1; k <= 4; k++) {
        // base 至少取 1 行（否则无基表行可产生倍行）
        for (let bCount = 1; bCount <= Math.min(k, scenario.base.length); bCount++) {
          const baseSubsets = combinations(scenario.base, bCount);
          for (const bSub of baseSubsets) {
            const remaining = k - bCount;
            // mid 取 mCount 行 (0 .. remaining)
            for (let mCount = 0; mCount <= Math.min(remaining, scenario.mid.length); mCount++) {
              const tCount = remaining - mCount;
              if (tCount > scenario.tail.length) continue;

              const midSubsets = combinations(scenario.mid, mCount);
              const tailSubsets = combinations(scenario.tail, tCount);

              for (const mSub of midSubsets) {
                for (const tSub of tailSubsets) {
                  const testSub: Scenario = {
                    schema: scenario.schema,
                    specVersion: scenario.specVersion,
                    layout: scenario.layout,
                    title: 'Brute force sub',
                    source: scenario.source,
                    base: bSub,
                    mid: mSub,
                    tail: tSub,
                  };

                  const fRes = computeFactors(testSub);
                  const hasDuplication = fRes.rows.some((r) => r.factor > 1n);
                  if (hasDuplication) {
                    return k; // 找到了大小为 k 的倍行子集，且是全局最少
                  }
                }
              }
            }
          }
        }
      }

      return -1; // 不存在 <= 4 行的倍行
    }

    function combinations<T>(arr: readonly T[], k: number): T[][] {
      if (k === 0) return [[]];
      if (arr.length < k) return [];
      const head = arr[0]!;
      const tail = arr.slice(1);
      const res: T[][] = [];
      for (const c of combinations(tail, k - 1)) {
        res.push([head, ...c]);
      }
      for (const c of combinations(tail, k)) {
        res.push(c);
      }
      return res;
    }

    it('confirms JW-F has global theoretical lower bound of 4 rows via independent brute-force', () => {
      const jwF = loadFixture('jw-f.json');
      // JW-F 共有 1 base + 1 mid + 2 tail = 4 行
      const bruteMin = findGlobalMinimalRowCountByExhaustiveSearch(jwF);
      expect(bruteMin).toBe(4);

      const algWitness = findMinimalWitness(jwF);
      expect(algWitness.rowCount).toBe(bruteMin);
      console.log(`[EVIDENCE][BRUTE_FORCE] JW-F global minimal row count verified by independent combinatorics: ${bruteMin}`);
    });

    it('confirms JW-C has global theoretical lower bound of 3 rows via independent brute-force', () => {
      const jwC = loadFixture('jw-c.json');
      // JW-C 共有 2 base + 4 mid = 6 行
      const bruteMin = findGlobalMinimalRowCountByExhaustiveSearch(jwC);
      expect(bruteMin).toBe(3);

      const algWitness = findMinimalWitness(jwC);
      expect(algWitness.rowCount).toBe(bruteMin);
      console.log(`[EVIDENCE][BRUTE_FORCE] JW-C global minimal row count verified by independent combinatorics: ${bruteMin}`);
    });
  });
});
