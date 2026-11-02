import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Scenario, RowAudit } from '../../src/core/types.js';
import {
  computeAmountAudit,
  computeAmounts,
  sortRowAudits,
  compareRowAuditDiscrepancy,
  formatDeltaPercentage,
  calculateDeltaRatio,
} from '../../src/core/amount.js';
import { analyze, computeScenarioSha256 } from '../../src/core/analyze.js';
import { serializeScenario, parseScenarioJson } from '../../src/io/json.js';

function loadFixture(name: string): Scenario {
  const filePath = resolve(__dirname, '../../src/fixtures', name);
  return JSON.parse(readFileSync(filePath, 'utf-8')) as Scenario;
}

describe('T004 Core Algorithm: BigInt Amount Attribution & Sorting', () => {
  it('MATH01: JW-A (star layout) amounts 8600/28400/19800, unsafe=2, row attribution and discrepancy sort', () => {
    const scenario = loadFixture('jw-a.json');
    const result = computeAmountAudit(scenario);

    // 全局汇总验证
    expect(result.safeSumCents).toBe('8600');
    expect(result.naiveSumCents).toBe('28400');
    expect(result.deltaCents).toBe('19800');
    expect(result.unsafeBaseRows).toBe(2);
    expect(result.deltaRatio).toBe('+230.23%');

    // 逐行归因与排序验证（按 |delta| 降序）：
    // o1: amount 5000, factor 4 => naive 20000, delta 15000 (|15000|)
    // o2: amount 2400, factor 3 => naive 7200, delta 4800 (|4800|)
    // o3: amount 1200, factor 1 => naive 1200, delta 0 (|0|)
    expect(result.rows).toHaveLength(3);

    expect(result.rows[0]).toEqual({
      id: 'o1',
      factor: '4',
      amountCents: '5000',
      naiveContributionCents: '20000',
      deltaCents: '15000',
      branch1Count: 2,
      branch2Count: 2,
    });

    expect(result.rows[1]).toEqual({
      id: 'o2',
      factor: '3',
      amountCents: '2400',
      naiveContributionCents: '7200',
      deltaCents: '4800',
      branch1Count: 3,
      branch2Count: 1,
    });

    expect(result.rows[2]).toEqual({
      id: 'o3',
      factor: '1',
      amountCents: '1200',
      naiveContributionCents: '1200',
      deltaCents: '0',
      branch1Count: 1,
      branch2Count: 0,
    });

    // 打印金标日志证据
    console.log(
      `[EVIDENCE][JW-A] safeSumCents=${result.safeSumCents}, naiveSumCents=${result.naiveSumCents}, deltaCents=${result.deltaCents}, unsafeBaseRows=${result.unsafeBaseRows}`
    );
  });

  it('MATH02: JW-B (chain layout) amounts 3700/15700/12000 and unsafe=1', () => {
    const scenario = loadFixture('jw-b.json');
    const result = computeAmountAudit(scenario);

    // a1: amount 3000, factor 5 => naive 15000, delta 12000
    // a2: amount 700, factor 1 => naive 700, delta 0
    // safeSum = 3700, naiveSum = 15700, delta = 12000, unsafeBaseRows = 1
    expect(result.safeSumCents).toBe('3700');
    expect(result.naiveSumCents).toBe('15700');
    expect(result.deltaCents).toBe('12000');
    expect(result.unsafeBaseRows).toBe(1);
    expect(result.deltaRatio).toBe('+324.32%');

    expect(result.rows[0]?.id).toBe('a1');
    expect(result.rows[0]?.deltaCents).toBe('12000');
    expect(result.rows[1]?.id).toBe('a2');
    expect(result.rows[1]?.deltaCents).toBe('0');

    console.log(
      `[EVIDENCE][JW-B] safeSumCents=${result.safeSumCents}, naiveSumCents=${result.naiveSumCents}, deltaCents=${result.deltaCents}, unsafeBaseRows=${result.unsafeBaseRows}`
    );
  });

  it('MATH03: JW-C (negative amounts cancel out) amounts 0/0/0, unsafeBaseRows=2, deltaRatio=N/A, tie-breaker stable sort', () => {
    const scenario = loadFixture('jw-c.json');
    const result = computeAmountAudit(scenario);

    // x: amount -3000, factor 2 => naive -6000, delta -3000
    // y: amount 3000, factor 2 => naive 6000, delta 3000
    // S_safe = 0, S_naive = 0, Δ = 0, unsafeBaseRows = 2
    expect(result.safeSumCents).toBe('0');
    expect(result.naiveSumCents).toBe('0');
    expect(result.deltaCents).toBe('0');
    expect(result.unsafeBaseRows).toBe(2);

    // 零分母比例保护：若 S_safe = 0 则标为 N/A，不能为 NaN 或 Infinity
    expect(result.deltaRatio).toBe('N/A');

    // 破平局排序：|-3000| == |3000| == 3000，按稳定 ID 升序排列：'x' < 'y'
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]?.id).toBe('x');
    expect(result.rows[0]?.deltaCents).toBe('-3000');
    expect(result.rows[1]?.id).toBe('y');
    expect(result.rows[1]?.deltaCents).toBe('3000');

    console.log(
      `[EVIDENCE][JW-C] safeSumCents=${result.safeSumCents}, naiveSumCents=${result.naiveSumCents}, deltaCents=${result.deltaCents}, unsafeBaseRows=${result.unsafeBaseRows}, deltaRatio=${result.deltaRatio}`
    );
  });

  it('MATH04: JW-D (SQL NULL semantics with LEFT JOIN) amounts 1900/1900/0, unsafe=0', () => {
    const scenario = loadFixture('jw-d.json');
    const result = computeAmountAudit(scenario);

    // n: amount 900, factor 1 => delta 0
    // z: amount 1000, factor 1 => delta 0
    expect(result.safeSumCents).toBe('1900');
    expect(result.naiveSumCents).toBe('1900');
    expect(result.deltaCents).toBe('0');
    expect(result.unsafeBaseRows).toBe(0);
    expect(result.deltaRatio).toBe('0.00%');
  });

  it('MATH05: JW-E (SUM DISTINCT counterexample) amounts 2400/2400/0, unsafe=0', () => {
    const scenario = loadFixture('jw-e.json');
    const result = computeAmountAudit(scenario);

    // r1: 1200, r2: 1200, both factor 1 => safe 2400, naive 2400, delta 0
    expect(result.safeSumCents).toBe('2400');
    expect(result.naiveSumCents).toBe('2400');
    expect(result.deltaCents).toBe('0');
    expect(result.unsafeBaseRows).toBe(0);
  });

  it('JW-F: chain layout single middle edge lower bound amounts 1000/2000/1000, unsafe=1', () => {
    const scenario = loadFixture('jw-f.json');
    const result = computeAmountAudit(scenario);

    // a: 1000, factor 2 => naive 2000, delta 1000
    expect(result.safeSumCents).toBe('1000');
    expect(result.naiveSumCents).toBe('2000');
    expect(result.deltaCents).toBe('1000');
    expect(result.unsafeBaseRows).toBe(1);
    expect(result.deltaRatio).toBe('+100.00%');
  });

  describe('Discrepancy Sorting & Stable ID Tie-Breaker', () => {
    it('sorts rows by absolute delta descending, independent of sign', () => {
      const rows: RowAudit[] = [
        {
          id: 'r_small_pos',
          factor: '2',
          amountCents: '100',
          naiveContributionCents: '200',
          deltaCents: '100',
          branch1Count: 2,
          branch2Count: 0,
        },
        {
          id: 'r_large_neg',
          factor: '3',
          amountCents: '-5000',
          naiveContributionCents: '-15000',
          deltaCents: '-10000',
          branch1Count: 3,
          branch2Count: 0,
        },
        {
          id: 'r_med_pos',
          factor: '2',
          amountCents: '2500',
          naiveContributionCents: '5000',
          deltaCents: '2500',
          branch1Count: 2,
          branch2Count: 0,
        },
      ];

      const sorted = sortRowAudits(rows);
      expect(sorted.map((r) => r.id)).toEqual(['r_large_neg', 'r_med_pos', 'r_small_pos']);
    });

    it('breaks ties using stable UTF-8 / ASCII ID ascending order', () => {
      const rows: RowAudit[] = [
        {
          id: 'gamma',
          factor: '2',
          amountCents: '1000',
          naiveContributionCents: '2000',
          deltaCents: '1000',
          branch1Count: 2,
          branch2Count: 0,
        },
        {
          id: 'alpha',
          factor: '2',
          amountCents: '-1000',
          naiveContributionCents: '-2000',
          deltaCents: '-1000',
          branch1Count: 2,
          branch2Count: 0,
        },
        {
          id: 'beta',
          factor: '2',
          amountCents: '1000',
          naiveContributionCents: '2000',
          deltaCents: '1000',
          branch1Count: 2,
          branch2Count: 0,
        },
      ];

      // All three have |delta| = 1000.
      // Ascending ID order: 'alpha' < 'beta' < 'gamma'
      const sorted = sortRowAudits(rows);
      expect(sorted.map((r) => r.id)).toEqual(['alpha', 'beta', 'gamma']);
    });

    it('breaks ties among zero-delta rows deterministically by ID', () => {
      const rows: RowAudit[] = [
        {
          id: 'z_row',
          factor: '1',
          amountCents: '500',
          naiveContributionCents: '500',
          deltaCents: '0',
          branch1Count: 1,
          branch2Count: 0,
        },
        {
          id: 'a_row',
          factor: '1',
          amountCents: '300',
          naiveContributionCents: '300',
          deltaCents: '0',
          branch1Count: 1,
          branch2Count: 0,
        },
      ];

      const sorted = sortRowAudits(rows);
      expect(sorted.map((r) => r.id)).toEqual(['a_row', 'z_row']);
    });

    it('compareRowAuditDiscrepancy returns 0 only when both |delta| and id are identical', () => {
      const row1: RowAudit = {
        id: 'row1',
        factor: '2',
        amountCents: '100',
        naiveContributionCents: '200',
        deltaCents: '100',
        branch1Count: 2,
        branch2Count: 0,
      };
      const row2: RowAudit = {
        id: 'row1',
        factor: '3',
        amountCents: '50',
        naiveContributionCents: '150',
        deltaCents: '100',
        branch1Count: 3,
        branch2Count: 0,
      };
      expect(compareRowAuditDiscrepancy(row1, row2)).toBe(0);
    });
  });

  describe('Zero Denominator N/A and Percentage Formatting', () => {
    it('returns N/A when safeSum is 0', () => {
      expect(formatDeltaPercentage('0', '0')).toBe('N/A');
      expect(formatDeltaPercentage('0', '19800')).toBe('N/A');
      expect(formatDeltaPercentage('0', '-5000')).toBe('N/A');
      expect(calculateDeltaRatio(0n, 100n)).toBe('N/A');
      expect(calculateDeltaRatio('0', '0')).toBe('N/A');
    });

    it('computes exact half-up percentages without any floating point numbers', () => {
      // 19800 / 8600 * 100 = 230.232558...% => +230.23%
      expect(formatDeltaPercentage('8600', '19800', 2)).toBe('+230.23%');

      // 100 / 300 * 100 = 33.3333...% => +33.33%
      expect(formatDeltaPercentage('300', '100', 2)).toBe('+33.33%');

      // 200 / 300 * 100 = 66.6666...% => +66.67%
      expect(formatDeltaPercentage('300', '200', 2)).toBe('+66.67%');

      // Zero delta with non-zero safeSum
      expect(formatDeltaPercentage('5000', '0', 2)).toBe('0.00%');
      expect(formatDeltaPercentage('5000', '0', 0)).toBe('0%');

      // Negative delta with positive safeSum
      expect(formatDeltaPercentage('10000', '-3000', 2)).toBe('-30.00%');

      // Negative delta with negative safeSum => positive percentage
      expect(formatDeltaPercentage('-10000', '-3000', 2)).toBe('+30.00%');

      // Positive delta with negative safeSum => negative percentage
      expect(formatDeltaPercentage('-10000', '3000', 2)).toBe('-30.00%');
    });
  });

  describe('MATH08: BigInt Precision Limits & Extreme Numbers (> 2^53)', () => {
    it('handles amounts and totals exceeding JavaScript safe integer limit (9,007,199,254,740,991) with 100% precision', () => {
      // Number.MAX_SAFE_INTEGER is 9_007_199_254_740_991 (approx 9e15)
      // We test with a 38-digit integer: ~10^37
      const hugeAmount1 = '12345678901234567890123456789012345678';
      const hugeAmount2 = '-98765432101234567890123456789012345678';

      const scenario: Scenario = {
        schema: 'joinwitness.scenario/v1',
        specVersion: '1.0.0',
        layout: 'single',
        title: 'Extreme BigInt Precision Test',
        source: 'synthetic',
        base: [
          { id: 'huge_pos', key: 'K1', amountCents: hugeAmount1 },
          { id: 'huge_neg', key: 'K2', amountCents: hugeAmount2 },
        ],
        mid: [
          { id: 'm1', parentKey: 'K1' },
          { id: 'm2', parentKey: 'K1' },
          { id: 'm3', parentKey: 'K1' }, // K1 matches 3 => factor 3
          { id: 'm4', parentKey: 'K2' },
          { id: 'm5', parentKey: 'K2' }, // K2 matches 2 => factor 2
        ],
        tail: [],
      };

      const result = computeAmountAudit(scenario);

      const v1 = BigInt(hugeAmount1);
      const v2 = BigInt(hugeAmount2);

      const expectedSafe = (v1 + v2).toString();
      const expectedNaive = (v1 * 3n + v2 * 2n).toString();
      const expectedDelta = (v1 * 2n + v2 * 1n).toString();

      expect(result.safeSumCents).toBe(expectedSafe);
      expect(result.naiveSumCents).toBe(expectedNaive);
      expect(result.deltaCents).toBe(expectedDelta);
      expect(result.unsafeBaseRows).toBe(2);

      // Verify row level exact strings (sorted by |delta| descending):
      // |delta(huge_neg)| = |-98765432101234567890123456789012345678| (~9.87e37)
      // |delta(huge_pos)| = |24691357802469135780246913578024691356| (~2.46e37)
      // Therefore huge_neg comes first!
      expect(result.rows[0]?.id).toBe('huge_neg');
      expect(result.rows[0]?.naiveContributionCents).toBe((v2 * 2n).toString());
      expect(result.rows[0]?.deltaCents).toBe((v2 * 1n).toString());

      expect(result.rows[1]?.id).toBe('huge_pos');
      expect(result.rows[1]?.naiveContributionCents).toBe((v1 * 3n).toString());
      expect(result.rows[1]?.deltaCents).toBe((v1 * 2n).toString());

      // Assert strings are definitely well beyond 2^53
      expect(BigInt(result.safeSumCents) < 0n).toBe(true);
      expect(result.rows[0]?.deltaCents.length).toBeGreaterThan(30);

      // Verify JSON lossless serialization and deserialization
      const serialized = JSON.stringify(result);
      const deserialized = JSON.parse(serialized);
      expect(deserialized.safeSumCents).toBe(expectedSafe);
      expect(deserialized.naiveSumCents).toBe(expectedNaive);
      expect(deserialized.deltaCents).toBe(expectedDelta);

      console.log(
        `[EVIDENCE][PRECISION_LIMIT] Verified 38-digit BigInt math without floating point loss: safeSum=${result.safeSumCents}, deltaSum=${result.deltaCents}`
      );
    });

    it('handles zero amount rows with structural replication (unsafeBaseRows incremented)', () => {
      const scenario: Scenario = {
        schema: 'joinwitness.scenario/v1',
        specVersion: '1.0.0',
        layout: 'single',
        title: 'Zero Amount with Structural Replication',
        source: 'synthetic',
        base: [
          { id: 'zero_amount', key: 'K0', amountCents: '0' },
          { id: 'normal_amount', key: 'K1', amountCents: '1000' },
        ],
        mid: [
          { id: 'm1', parentKey: 'K0' },
          { id: 'm2', parentKey: 'K0' },
          { id: 'm3', parentKey: 'K1' },
        ],
        tail: [],
      };

      const result = computeAmountAudit(scenario);

      // zero_amount has factor 2 > 1 => unsafeBaseRows includes it even though amount is 0!
      // normal_amount has factor 1 => safe
      expect(result.unsafeBaseRows).toBe(1);
      expect(result.safeSumCents).toBe('1000');
      expect(result.naiveSumCents).toBe('1000');
      expect(result.deltaCents).toBe('0');

      const zeroRow = result.rows.find((r) => r.id === 'zero_amount');
      expect(zeroRow?.factor).toBe('2');
      expect(zeroRow?.deltaCents).toBe('0');
      expect(zeroRow?.naiveContributionCents).toBe('0');
    });
  });

  describe('Core Integration: analyze() Contract', () => {
    it('produces a full Audit object matching joinwitness.audit/v1 schema', async () => {
      const scenario = loadFixture('jw-a.json');
      const audit = await analyze(scenario);

      expect(audit.schema).toBe('joinwitness.audit/v1');
      expect(typeof audit.scenarioSha256).toBe('string');
      expect(audit.scenarioSha256).toHaveLength(64);
      expect(audit.baseRows).toBe(3);
      expect(audit.expandedRows).toBe('8');
      expect(audit.expandedRowsPreviewed).toBe(0);
      expect(audit.safeSumCents).toBe('8600');
      expect(audit.naiveSumCents).toBe('28400');
      expect(audit.deltaCents).toBe('19800');
      expect(audit.unsafeBaseRows).toBe(2);
      expect(audit.rows).toHaveLength(3);
      expect(audit.witness).toEqual({
        rowIds: { base: [], mid: [], tail: [] },
        kind: 'NONE',
      });

      // Assert SHA-256 is deterministic across multiple calls
      const sha2 = await computeScenarioSha256(scenario);
      expect(audit.scenarioSha256).toBe(sha2);

      /**
       * [B04 / FIX-R1-04 说明]
       * JW-A 规范 SHA-256 为 b816102ed897fdff34dbdf7bf4dbe7c9d01977f702349292ddba54cf24d01da8。
       * 旧版本使用的 61054a7f84cbb57df74b479e00a92aeaa348aa558b7410e281a204e6775f85f5 是非规范 JSON.stringify(scenario) 的产物
       * （直接依赖 V8 引擎对象属性插入顺序，未对键进行字典序排序）。
       * 规范 JSON 序列化（toCanonicalJson）采用递归键字典序排序与无多余空白，确保无论输入字段顺序如何均产生确定性稳定哈希。
       */
      expect(audit.scenarioSha256).toBe(
        'b816102ed897fdff34dbdf7bf4dbe7c9d01977f702349292ddba54cf24d01da8'
      );

      console.log(
        `[EVIDENCE][ANALYZE] Audit successfully produced for JW-A with canonical SHA-256: ${audit.scenarioSha256} (old non-canonical SHA was 61054a7f84cbb57df74b479e00a92aeaa348aa558b7410e281a204e6775f85f5)`
      );
    });

    it('content-equivalent scenarios with scrambled field order produce identical scenarioSha256 (B04 / FIX-R1-04 regression)', async () => {
      const original = loadFixture('jw-a.json');

      // 深度打乱字段顺序的对象：根属性倒序、行内属性倒序
      const scrambled: Scenario = {
        tail: original.tail.map((t) => ({ parentKey: t.parentKey, id: t.id })),
        mid: original.mid.map((m) => ({ parentKey: m.parentKey, id: m.id })),
        base: original.base.map((b) => ({ amountCents: b.amountCents, key: b.key, id: b.id })),
        source: original.source,
        title: original.title,
        layout: original.layout,
        specVersion: original.specVersion,
        schema: original.schema,
      };

      const originalSha = await computeScenarioSha256(original);
      const scrambledSha = await computeScenarioSha256(scrambled);

      expect(scrambledSha).toBe(originalSha);

      // analyze() 也产出完全一致的哈希
      const auditOriginal = await analyze(original);
      const auditScrambled = await analyze(scrambled);
      expect(auditScrambled.scenarioSha256).toBe(auditOriginal.scenarioSha256);

      console.log(
        `[EVIDENCE][B04_EQUIVALENCE] Content-equivalent scrambled scenario produces identical canonical SHA: ${scrambledSha}`
      );
    });

    it('field-reordered JSON string round-trip maintains stable scenarioSha256 across parse → export → parse (B04 / FIX-R1-04 regression)', async () => {
      // 字段逆序的 JSON 文本
      const scrambledJsonStr = JSON.stringify({
        tail: [],
        mid: [{ parentKey: 'O1', id: 'm1' }],
        base: [{ amountCents: '1234', key: 'O1', id: 'b1' }],
        source: 'synthetic',
        title: 'Scrambled JSON Roundtrip Test',
        layout: 'star',
        specVersion: '1.0.0',
        schema: 'joinwitness.scenario/v1',
      });

      // 步骤 1：解析打乱的 JSON 并计算哈希
      const s1 = parseScenarioJson(scrambledJsonStr);
      const sha1 = await computeScenarioSha256(s1);

      // 步骤 2：导出为规范美化格式
      const exported = serializeScenario(s1);

      // 步骤 3：再次解析导出的 JSON 并计算哈希
      const s2 = parseScenarioJson(exported);
      const sha2 = await computeScenarioSha256(s2);

      // 步骤 4：验证哈希完全稳定
      expect(sha2).toBe(sha1);

      console.log(
        `[EVIDENCE][B04_ROUNDTRIP_SHA] Field-reordered JSON retains stable SHA-256 across round-trip: ${sha1}`
      );
    });

    it('MATH10 & §5.2/§7: records canonical SHA-256 for all 6 golden presets (JW-A through JW-F) and documents differences from old non-canonical SHAs', async () => {
      /**
       * 6 个冻结预设的规范哈希对照表（旧 SHA 为非规范 JSON.stringify 的产物）：
       * - JW-A:
       *     canonical: b816102ed897fdff34dbdf7bf4dbe7c9d01977f702349292ddba54cf24d01da8
       *     old:       61054a7f84cbb57df74b479e00a92aeaa348aa558b7410e281a204e6775f85f5
       * - JW-B:
       *     canonical: c21ed124d4aebed020bc7ddbd7e745a841deb3615a5c14ca1ca0a7d306502533
       *     old:       d10a6639c687225ade1e98c3206c284b480434e0e4da42130828f37b49c85123
       * - JW-C:
       *     canonical: abaf741b2205358a476d5833c8646f61b83f0987b79907f71493ae7687f28d00
       *     old:       6fc1f36a094dcf8efe1c50525ba5bd39523242493bae3b11998f3f1447fd58f6
       * - JW-D:
       *     canonical: a340d67ada96e9c3c6a29990fc796f73c15114260fd44f5ef781f1462efce4fe
       *     old:       685f8be5146697b7026ab72d6a7c5d824a6c5ba965ef97f65832033e48114a3a
       * - JW-E:
       *     canonical: c6eca66edc0ca3cbb79284b8fe97d285287782a5f6fa31a792a80a33a050e8a4
       *     old:       39d9715e442a679fe69b38c10862765f8206567099ca64fc5ff4d3d5ae336b77
       * - JW-F:
       *     canonical: 3fd21935b988e309f4b172b351352ff8f66f3126e968d35058b3d2f855cf2195
       *     old:       19999ce33109e38ba3fbfeb02a0619583512e8b6099306cb089e5e7adddfb284
       *
       * 差异说明：
       * 旧 SHA 使用非规范的 JSON.stringify(scenario)，其输出依赖各字段在对象内部的初始插入顺序
       * （例如根属性以 schema 开头，行属性以 id 开头）。
       * 规范 JSON 序列化严格按 RFC 8785 递归字典序排序键（根属性以 base 开头，行属性以 amountCents 开头），
       * 并去除一切多余空白，因此规范字节产生的 SHA 与旧非规范 SHA 必然不同，属于预期修复。
       */
      const expectedCanonicalHashes: Record<string, { canonical: string; old: string }> = {
        'jw-a.json': {
          canonical: 'b816102ed897fdff34dbdf7bf4dbe7c9d01977f702349292ddba54cf24d01da8',
          old: '61054a7f84cbb57df74b479e00a92aeaa348aa558b7410e281a204e6775f85f5',
        },
        'jw-b.json': {
          canonical: 'c21ed124d4aebed020bc7ddbd7e745a841deb3615a5c14ca1ca0a7d306502533',
          old: 'd10a6639c687225ade1e98c3206c284b480434e0e4da42130828f37b49c85123',
        },
        'jw-c.json': {
          canonical: 'abaf741b2205358a476d5833c8646f61b83f0987b79907f71493ae7687f28d00',
          old: '6fc1f36a094dcf8efe1c50525ba5bd39523242493bae3b11998f3f1447fd58f6',
        },
        'jw-d.json': {
          canonical: 'a340d67ada96e9c3c6a29990fc796f73c15114260fd44f5ef781f1462efce4fe',
          old: '685f8be5146697b7026ab72d6a7c5d824a6c5ba965ef97f65832033e48114a3a',
        },
        'jw-e.json': {
          canonical: 'c6eca66edc0ca3cbb79284b8fe97d285287782a5f6fa31a792a80a33a050e8a4',
          old: '39d9715e442a679fe69b38c10862765f8206567099ca64fc5ff4d3d5ae336b77',
        },
        'jw-f.json': {
          canonical: '3fd21935b988e309f4b172b351352ff8f66f3126e968d35058b3d2f855cf2195',
          old: '19999ce33109e38ba3fbfeb02a0619583512e8b6099306cb089e5e7adddfb284',
        },
      };

      for (const [filename, info] of Object.entries(expectedCanonicalHashes)) {
        const scenario = loadFixture(filename);
        const actualSha = await computeScenarioSha256(scenario);
        expect(actualSha).toBe(info.canonical);
        expect(actualSha).not.toBe(info.old);

        console.log(
          `[EVIDENCE][PRESET_SHA] ${filename} canonical SHA-256: ${actualSha} (old non-canonical: ${info.old})`
        );
      }
    });

    it('allows custom or registered witnessFinder in analyze()', async () => {
      const scenario = loadFixture('jw-a.json');
      const audit = await analyze(scenario, {
        witnessFinder: (_s, partial) => {
          expect(partial.unsafeBaseRows).toBe(2);
          return {
            rowIds: {
              base: ['o1'],
              mid: ['i11', 'i12'],
              tail: [],
            },
            kind: 'NUMERIC_AND_STRUCTURAL',
          };
        },
      });

      expect(audit.witness.kind).toBe('NUMERIC_AND_STRUCTURAL');
      expect(audit.witness.rowIds.base).toEqual(['o1']);
    });
  });
});
