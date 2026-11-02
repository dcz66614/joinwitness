import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Scenario, BaseRow, MidRow, TailRow, RowAudit } from '../../src/core/types.js';
import { validateScenario } from '../../src/core/validate.js';
import { computeFactors } from '../../src/core/factor.js';
import { computeAmountAudit, sortRowAudits } from '../../src/core/amount.js';
import { analyze, registerWitnessFinder } from '../../src/core/analyze.js';
import { findMinimalWitness } from '../../src/core/witness.js';

function loadFixture(name: string): Scenario {
  const filePath = resolve(__dirname, '../../src/fixtures', name);
  return JSON.parse(readFileSync(filePath, 'utf-8')) as Scenario;
}

describe('T007 Core Invariants: Mathematical and Operational Guarantees', () => {
  // Register witness finder for full analyze tests
  registerWitnessFinder(findMinimalWitness);

  describe('Invariant 1: Monotonicity (f_i >= 1 for all base rows in all layouts)', () => {
    it('guarantees f_i >= 1 when mid/tail tables are completely empty (LEFT JOIN preservation)', () => {
      const scenario: Scenario = {
        schema: 'joinwitness.scenario/v1',
        specVersion: '1.0.0',
        layout: 'single',
        title: 'Empty Mid Scenario',
        source: 'synthetic',
        base: [
          { id: 'b1', key: 'K1', amountCents: '1000' },
          { id: 'b2', key: 'K2', amountCents: '2000' },
          { id: 'b3', key: null, amountCents: '3000' },
        ],
        mid: [],
        tail: [],
      };

      const result = computeFactors(scenario);
      expect(result.rows).toHaveLength(3);
      for (const row of result.rows) {
        expect(row.factor >= 1n).toBe(true);
        expect(row.factor).toBe(1n);
      }
      expect(result.expandedRows).toBe(3n);
    });

    it('guarantees f_i >= 1 across single, star, and chain layouts with partial matches', () => {
      const layouts: Array<'single' | 'star' | 'chain'> = ['single', 'star', 'chain'];

      for (const layout of layouts) {
        const scenario: Scenario = {
          schema: 'joinwitness.scenario/v1',
          specVersion: '1.0.0',
          layout,
          title: `Partial match ${layout}`,
          source: 'synthetic',
          base: [
            { id: 'b1', key: 'MATCH', amountCents: '100' },
            { id: 'b2', key: 'NO_MATCH', amountCents: '200' },
            { id: 'b3', key: null, amountCents: '300' },
          ],
          mid: [
            { id: 'm1', parentKey: 'MATCH', linkKey: 'L1' },
            { id: 'm2', parentKey: 'MATCH', linkKey: 'L2' },
          ],
          tail: [
            { id: 't1', parentKey: layout === 'chain' ? 'L1' : 'MATCH' },
            { id: 't2', parentKey: layout === 'chain' ? 'L1' : 'MATCH' },
          ],
        };

        const result = computeFactors(scenario);
        for (const row of result.rows) {
          expect(row.factor >= 1n).toBe(true);
          expect(BigInt(row.factorString) >= 1n).toBe(true);
        }
      }
    });

    it('guarantees monotonicity: adding rows to mid/tail can never decrease any f_i', () => {
      const baseRows: BaseRow[] = [
        { id: 'b1', key: 'K1', amountCents: '100' },
        { id: 'b2', key: 'K2', amountCents: '200' },
      ];

      // Initial scenario
      const s1: Scenario = {
        schema: 'joinwitness.scenario/v1',
        specVersion: '1.0.0',
        layout: 'star',
        title: 'Monotonicity Base',
        source: 'synthetic',
        base: baseRows,
        mid: [{ id: 'm1', parentKey: 'K1' }],
        tail: [{ id: 't1', parentKey: 'K1' }],
      };

      const res1 = computeFactors(s1);

      // Expanded scenario with additional rows
      const s2: Scenario = {
        ...s1,
        mid: [
          ...s1.mid,
          { id: 'm2', parentKey: 'K1' },
          { id: 'm3', parentKey: 'K2' },
        ],
        tail: [
          ...s1.tail,
          { id: 't2', parentKey: 'K1' },
          { id: 't3', parentKey: 'K2' },
        ],
      };

      const res2 = computeFactors(s2);

      for (let i = 0; i < baseRows.length; i++) {
        expect(res2.rows[i]!.factor >= res1.rows[i]!.factor).toBe(true);
      }
    });
  });

  describe('Invariant 2: Conservation of Total Rows (expandedRows = Σ f_i)', () => {
    it('verifies expandedRows = Σ f_i on all 6 golden presets (JW-A to JW-F)', () => {
      const fixtures = ['jw-a.json', 'jw-b.json', 'jw-c.json', 'jw-d.json', 'jw-e.json', 'jw-f.json'];

      for (const file of fixtures) {
        const scenario = loadFixture(file);
        const factorResult = computeFactors(scenario);

        let sumFactors = 0n;
        for (const r of factorResult.rows) {
          sumFactors += r.factor;
        }

        expect(factorResult.expandedRows).toBe(sumFactors);
        expect(factorResult.expandedRowsString).toBe(sumFactors.toString());
      }
    });

    it('verifies expandedRows = Σ f_i on arbitrary multi-branch topologies', () => {
      const scenario: Scenario = {
        schema: 'joinwitness.scenario/v1',
        specVersion: '1.0.0',
        layout: 'chain',
        title: 'Complex Chain Topology',
        source: 'synthetic',
        base: [
          { id: 'a1', key: 'K1', amountCents: '100' },
          { id: 'a2', key: 'K2', amountCents: '200' },
          { id: 'a3', key: 'K3', amountCents: '300' },
          { id: 'a4', key: null, amountCents: '400' },
        ],
        mid: [
          { id: 'b1', parentKey: 'K1', linkKey: 'L1' },
          { id: 'b2', parentKey: 'K1', linkKey: 'L2' },
          { id: 'b3', parentKey: 'K2', linkKey: 'L3' },
          { id: 'b4', parentKey: null, linkKey: 'L4' },
        ],
        tail: [
          { id: 'c1', parentKey: 'L1' },
          { id: 'c2', parentKey: 'L1' },
          { id: 'c3', parentKey: 'L1' },
          { id: 'c4', parentKey: 'L3' },
          { id: 'c5', parentKey: null },
        ],
      };

      const result = computeFactors(scenario);
      const sumFactors = result.rows.reduce((acc, r) => acc + r.factor, 0n);
      expect(result.expandedRows).toBe(sumFactors);
      expect(result.expandedRowsString).toBe(sumFactors.toString());
    });
  });

  describe('Invariant 3: Amount Conservation (Δ = Σ v_i(f_i - 1) and S_naive = S_safe + Δ)', () => {
    it('verifies exact mathematical relationship on all golden presets', () => {
      const fixtures = ['jw-a.json', 'jw-b.json', 'jw-c.json', 'jw-d.json', 'jw-e.json', 'jw-f.json'];

      for (const file of fixtures) {
        const scenario = loadFixture(file);
        const audit = computeAmountAudit(scenario);

        const safeSum = BigInt(audit.safeSumCents);
        const naiveSum = BigInt(audit.naiveSumCents);
        const delta = BigInt(audit.deltaCents);

        // Core conservation equation: S_naive = S_safe + Δ
        expect(naiveSum).toBe(safeSum + delta);

        // Row-by-row conservation
        let sumDeltaFromRows = 0n;
        let sumSafeFromRows = 0n;
        let sumNaiveFromRows = 0n;
        let countedUnsafe = 0;

        for (const r of audit.rawRows) {
          const rowSafe = BigInt(r.amountCents);
          const rowFactor = BigInt(r.factor);
          const rowNaive = BigInt(r.naiveContributionCents);
          const rowDelta = BigInt(r.deltaCents);

          expect(rowNaive).toBe(rowSafe * rowFactor);
          expect(rowDelta).toBe(rowSafe * (rowFactor - 1n));
          expect(rowNaive).toBe(rowSafe + rowDelta);

          sumSafeFromRows += rowSafe;
          sumNaiveFromRows += rowNaive;
          sumDeltaFromRows += rowDelta;

          if (rowFactor > 1n) {
            countedUnsafe++;
          }
        }

        expect(sumSafeFromRows).toBe(safeSum);
        expect(sumNaiveFromRows).toBe(naiveSum);
        expect(sumDeltaFromRows).toBe(delta);
        expect(audit.unsafeBaseRows).toBe(countedUnsafe);
      }
    });

    it('handles negative amounts and negative cancellations (MATH03 Invariant: Δ = 0 does not imply safe)', () => {
      const scenario: Scenario = {
        schema: 'joinwitness.scenario/v1',
        specVersion: '1.0.0',
        layout: 'single',
        title: 'Negative Cancellation Multi-Row',
        source: 'synthetic',
        base: [
          { id: 'pos', key: 'P', amountCents: '50000' },
          { id: 'neg', key: 'N', amountCents: '-50000' },
        ],
        mid: [
          { id: 'm1', parentKey: 'P' },
          { id: 'm2', parentKey: 'P' },
          { id: 'm3', parentKey: 'N' },
          { id: 'm4', parentKey: 'N' },
        ],
        tail: [],
      };

      const audit = computeAmountAudit(scenario);
      expect(audit.safeSumCents).toBe('0');
      expect(audit.naiveSumCents).toBe('0');
      expect(audit.deltaCents).toBe('0');
      // Even though Δ = 0, both base rows suffer duplication (f = 2)
      expect(audit.unsafeBaseRows).toBe(2);
      expect(audit.deltaRatio).toBe('N/A');

      const posRow = audit.rows.find((r) => r.id === 'pos')!;
      const negRow = audit.rows.find((r) => r.id === 'neg')!;
      expect(posRow.deltaCents).toBe('50000');
      expect(negRow.deltaCents).toBe('-50000');
    });

    it('handles extreme BigInt amounts without floating-point overflow or precision loss (MATH08)', () => {
      // 35-digit amounts well beyond Number.MAX_SAFE_INTEGER (9,007,199,254,740,991)
      const bigAmt1 = '12345678901234567890123456789012345';
      const bigAmt2 = '-9876543210987654321098765432109876';

      const scenario: Scenario = {
        schema: 'joinwitness.scenario/v1',
        specVersion: '1.0.0',
        layout: 'single',
        title: 'Extreme BigInt Invariant',
        source: 'synthetic',
        base: [
          { id: 'b1', key: 'K1', amountCents: bigAmt1 },
          { id: 'b2', key: 'K2', amountCents: bigAmt2 },
        ],
        mid: [
          { id: 'm1', parentKey: 'K1' },
          { id: 'm2', parentKey: 'K1' },
          { id: 'm3', parentKey: 'K1' },
        ],
        tail: [],
      };

      const audit = computeAmountAudit(scenario);
      const v1 = BigInt(bigAmt1);
      const v2 = BigInt(bigAmt2);
      const expectedSafe = v1 + v2;
      const expectedNaive = v1 * 3n + v2 * 1n;
      const expectedDelta = v1 * 2n;

      expect(audit.safeSumCents).toBe(expectedSafe.toString());
      expect(audit.naiveSumCents).toBe(expectedNaive.toString());
      expect(audit.deltaCents).toBe(expectedDelta.toString());
    });
  });

  describe('Invariant 4: Input Upper Bounds & Schema Constraints (MATH09 / §5 / §8)', () => {
    const validBaseScenario: Scenario = {
      schema: 'joinwitness.scenario/v1',
      specVersion: '1.0.0',
      layout: 'single',
      title: 'Valid Scenario Template',
      source: 'synthetic',
      base: [{ id: 'b1', key: 'k1', amountCents: '100' }],
      mid: [],
      tail: [],
    };

    it('enforces table row count upper limits (max 5,000 rows per table)', () => {
      // 5,000 base rows is valid
      const base5000: BaseRow[] = Array.from({ length: 5000 }, (_, i) => ({
        id: `b_${i}`,
        key: `k_${i}`,
        amountCents: '100',
      }));
      const valid5000 = validateScenario({ ...validBaseScenario, base: base5000 });
      expect(valid5000.valid).toBe(true);

      // 5,001 base rows is rejected
      const base5001: BaseRow[] = Array.from({ length: 5001 }, (_, i) => ({
        id: `b_${i}`,
        key: `k_${i}`,
        amountCents: '100',
      }));
      const invalidBase = validateScenario({ ...validBaseScenario, base: base5001 });
      expect(invalidBase.valid).toBe(false);
      expect(invalidBase.errors).toContainEqual(
        expect.objectContaining({ path: 'base', code: 'ROW_COUNT_OUT_OF_BOUNDS' })
      );

      // 0 base rows is rejected
      const emptyBase = validateScenario({ ...validBaseScenario, base: [] });
      expect(emptyBase.valid).toBe(false);
      expect(emptyBase.errors).toContainEqual(
        expect.objectContaining({ path: 'base', code: 'ROW_COUNT_OUT_OF_BOUNDS' })
      );

      // 5,001 mid rows is rejected
      const mid5001: MidRow[] = Array.from({ length: 5001 }, (_, i) => ({
        id: `m_${i}`,
        parentKey: 'k_0',
      }));
      const invalidMid = validateScenario({ ...validBaseScenario, mid: mid5001 });
      expect(invalidMid.valid).toBe(false);
      expect(invalidMid.errors).toContainEqual(
        expect.objectContaining({ path: 'mid', code: 'ROW_COUNT_OUT_OF_BOUNDS' })
      );

      // 5,001 tail rows is rejected
      const tail5001: TailRow[] = Array.from({ length: 5001 }, (_, i) => ({
        id: `t_${i}`,
        parentKey: 'k_0',
      }));
      const invalidTail = validateScenario({ ...validBaseScenario, layout: 'star', tail: tail5001 });
      expect(invalidTail.valid).toBe(false);
      expect(invalidTail.errors).toContainEqual(
        expect.objectContaining({ path: 'tail', code: 'ROW_COUNT_OUT_OF_BOUNDS' })
      );
    });

    it('enforces string length bounds (title <= 256, key <= 256, id <= 64)', () => {
      // Title boundary: 256 is valid, 257 is rejected
      const title256 = 'A'.repeat(256);
      const title257 = 'A'.repeat(257);
      expect(validateScenario({ ...validBaseScenario, title: title256 }).valid).toBe(true);
      expect(validateScenario({ ...validBaseScenario, title: title257 }).valid).toBe(false);

      // Key boundary: 256 is valid, 257 is rejected
      const key256 = 'K'.repeat(256);
      const key257 = 'K'.repeat(257);
      expect(
        validateScenario({
          ...validBaseScenario,
          base: [{ id: 'b1', key: key256, amountCents: '100' }],
        }).valid
      ).toBe(true);
      expect(
        validateScenario({
          ...validBaseScenario,
          base: [{ id: 'b1', key: key257, amountCents: '100' }],
        }).valid
      ).toBe(false);

      // ID boundary: 64 is valid, 65 is rejected
      const id64 = 'I'.repeat(64);
      const id65 = 'I'.repeat(65);
      expect(
        validateScenario({
          ...validBaseScenario,
          base: [{ id: id64, key: 'k', amountCents: '100' }],
        }).valid
      ).toBe(true);
      expect(
        validateScenario({
          ...validBaseScenario,
          base: [{ id: id65, key: 'k', amountCents: '100' }],
        }).valid
      ).toBe(false);
    });

    it('enforces amount bounds (absolute value <= 100,000,000 cents in scenario schema)', () => {
      // 100,000,000 cents valid
      expect(
        validateScenario({
          ...validBaseScenario,
          base: [{ id: 'b1', key: 'k', amountCents: '100000000' }],
        }).valid
      ).toBe(true);

      // -100,000,000 cents valid
      expect(
        validateScenario({
          ...validBaseScenario,
          base: [{ id: 'b1', key: 'k', amountCents: '-100000000' }],
        }).valid
      ).toBe(true);

      // 100,000,001 cents rejected
      const outOfBoundsPos = validateScenario({
        ...validBaseScenario,
        base: [{ id: 'b1', key: 'k', amountCents: '100000001' }],
      });
      expect(outOfBoundsPos.valid).toBe(false);
      expect(outOfBoundsPos.errors).toContainEqual(
        expect.objectContaining({ path: 'base[0].amountCents', code: 'AMOUNT_OUT_OF_BOUNDS' })
      );

      // -100,000,001 cents rejected
      const outOfBoundsNeg = validateScenario({
        ...validBaseScenario,
        base: [{ id: 'b1', key: 'k', amountCents: '-100000001' }],
      });
      expect(outOfBoundsNeg.valid).toBe(false);
      expect(outOfBoundsNeg.errors).toContainEqual(
        expect.objectContaining({ path: 'base[0].amountCents', code: 'AMOUNT_OUT_OF_BOUNDS' })
      );

      // -0 rejected
      const negZero = validateScenario({
        ...validBaseScenario,
        base: [{ id: 'b1', key: 'k', amountCents: '-0' }],
      });
      expect(negZero.valid).toBe(false);
      expect(negZero.errors).toContainEqual(
        expect.objectContaining({ path: 'base[0].amountCents', code: 'INVALID_AMOUNT' })
      );
    });
  });

  describe('Invariant 5: Determinism and Output Stability (MATH10)', () => {
    it('produces byte-identical results across 10 consecutive analyze() executions', async () => {
      const scenario = loadFixture('jw-a.json');

      const runs: string[] = [];
      for (let i = 0; i < 10; i++) {
        const audit = await analyze(scenario);
        runs.push(JSON.stringify(audit));
      }

      const first = runs[0];
      for (let i = 1; i < 10; i++) {
        expect(runs[i]).toBe(first);
      }
    });

    it('strictly preserves stable tie-breaking: |delta| descending then ID ascending', () => {
      const rows: RowAudit[] = [
        {
          id: 'z_row',
          factor: '2',
          amountCents: '1000',
          naiveContributionCents: '2000',
          deltaCents: '1000',
          branch1Count: 2,
          branch2Count: 0,
        },
        {
          id: 'a_row',
          factor: '2',
          amountCents: '1000',
          naiveContributionCents: '2000',
          deltaCents: '1000',
          branch1Count: 2,
          branch2Count: 0,
        },
        {
          id: 'm_row',
          factor: '2',
          amountCents: '-1000',
          naiveContributionCents: '-2000',
          deltaCents: '-1000',
          branch1Count: 2,
          branch2Count: 0,
        },
        {
          id: 'big_row',
          factor: '2',
          amountCents: '5000',
          naiveContributionCents: '10000',
          deltaCents: '5000',
          branch1Count: 2,
          branch2Count: 0,
        },
      ];

      const sorted = sortRowAudits(rows);
      // Expected order:
      // 1. big_row (|delta| = 5000)
      // 2. a_row (|delta| = 1000, id 'a_row' < 'm_row' < 'z_row')
      // 3. m_row (|delta| = 1000)
      // 4. z_row (|delta| = 1000)
      expect(sorted.map((r) => r.id)).toEqual(['big_row', 'a_row', 'm_row', 'z_row']);
    });
  });
});
