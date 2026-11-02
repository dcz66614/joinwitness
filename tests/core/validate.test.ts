import { describe, expect, it } from 'vitest';
import { validateScenario } from '../../src/core/validate.js';
import type { Scenario } from '../../src/core/types.js';

import jwA from '../../src/fixtures/jw-a.json';
import jwB from '../../src/fixtures/jw-b.json';
import jwC from '../../src/fixtures/jw-c.json';
import jwD from '../../src/fixtures/jw-d.json';
import jwE from '../../src/fixtures/jw-e.json';
import jwF from '../../src/fixtures/jw-f.json';

describe('validateScenario - 6 Frozen Fixtures (JW-A through JW-F)', () => {
  it('validates JW-A (star layout)', () => {
    const res = validateScenario(jwA);
    expect(res.valid).toBe(true);
    expect(res.ok).toBe(true);
    expect(res.errors).toHaveLength(0);
    expect(res.scenario?.layout).toBe('star');
    expect(res.scenario?.base).toHaveLength(3);
    expect(res.scenario?.mid).toHaveLength(6);
    expect(res.scenario?.tail).toHaveLength(3);
  });

  it('validates JW-B (chain layout with explicit linkKey)', () => {
    const res = validateScenario(jwB);
    expect(res.valid).toBe(true);
    expect(res.ok).toBe(true);
    expect(res.errors).toHaveLength(0);
    expect(res.scenario?.layout).toBe('chain');
    expect(res.scenario?.base).toHaveLength(2);
    expect(res.scenario?.mid).toHaveLength(3);
    expect(res.scenario?.tail).toHaveLength(5);
    // mid rows must have linkKey
    for (const m of res.scenario!.mid) {
      expect(m).toHaveProperty('linkKey');
    }
  });

  it('validates JW-C (single layout with negative amounts)', () => {
    const res = validateScenario(jwC);
    expect(res.valid).toBe(true);
    expect(res.ok).toBe(true);
    expect(res.errors).toHaveLength(0);
    expect(res.scenario?.layout).toBe('single');
    expect(res.scenario?.tail).toHaveLength(0);
    expect(res.scenario?.base[0]?.amountCents).toBe('-3000');
    expect(res.scenario?.base[1]?.amountCents).toBe('3000');
  });

  it('validates JW-D (single layout with SQL NULL keys)', () => {
    const res = validateScenario(jwD);
    expect(res.valid).toBe(true);
    expect(res.ok).toBe(true);
    expect(res.errors).toHaveLength(0);
    expect(res.scenario?.layout).toBe('single');
    expect(res.scenario?.base[0]?.key).toBeNull();
    expect(res.scenario?.mid[0]?.parentKey).toBeNull();
  });

  it('validates JW-E (single layout with duplicate amounts)', () => {
    const res = validateScenario(jwE);
    expect(res.valid).toBe(true);
    expect(res.ok).toBe(true);
    expect(res.errors).toHaveLength(0);
    expect(res.scenario?.layout).toBe('single');
    expect(res.scenario?.base[0]?.amountCents).toBe('1200');
    expect(res.scenario?.base[1]?.amountCents).toBe('1200');
  });

  it('validates JW-F (chain layout 4-row minimal witness)', () => {
    const res = validateScenario(jwF);
    expect(res.valid).toBe(true);
    expect(res.ok).toBe(true);
    expect(res.errors).toHaveLength(0);
    expect(res.scenario?.layout).toBe('chain');
    expect(res.scenario?.base).toHaveLength(1);
    expect(res.scenario?.mid).toHaveLength(1);
    expect(res.scenario?.tail).toHaveLength(2);
  });
});

describe('validateScenario - Root & Metadata Validations', () => {
  const validBase: Scenario = {
    schema: 'joinwitness.scenario/v1',
    specVersion: '1.0.0',
    layout: 'single',
    title: 'Valid Scenario',
    source: 'synthetic',
    base: [{ id: 'b1', key: 'k1', amountCents: '100' }],
    mid: [],
    tail: [],
  };

  it('rejects non-object scenarios', () => {
    expect(validateScenario(null).errors).toContainEqual(
      expect.objectContaining({ path: '', code: 'INVALID_TYPE' }),
    );
    expect(validateScenario('string').errors).toContainEqual(
      expect.objectContaining({ path: '', code: 'INVALID_TYPE' }),
    );
    expect(validateScenario([]).errors).toContainEqual(
      expect.objectContaining({ path: '', code: 'INVALID_TYPE' }),
    );
  });

  it('rejects unexpected root fields', () => {
    const raw = { ...validBase, extraProp: 'bad' };
    const res = validateScenario(raw);
    expect(res.valid).toBe(false);
    expect(res.errors).toContainEqual({
      path: 'extraProp',
      code: 'UNKNOWN_FIELD',
      message: 'Unexpected field "extraProp" in scenario root',
    });
  });

  it('rejects invalid schema identifier', () => {
    const raw = { ...validBase, schema: 'joinwitness.scenario/v2' };
    const res = validateScenario(raw);
    expect(res.valid).toBe(false);
    expect(res.errors).toContainEqual(
      expect.objectContaining({ path: 'schema', code: 'INVALID_SCHEMA' }),
    );
  });

  it('rejects invalid specVersion', () => {
    const raw = { ...validBase, specVersion: '2.0.0' };
    const res = validateScenario(raw);
    expect(res.valid).toBe(false);
    expect(res.errors).toContainEqual(
      expect.objectContaining({ path: 'specVersion', code: 'INVALID_SPEC_VERSION' }),
    );
  });

  it('rejects invalid layout', () => {
    const raw = { ...validBase, layout: 'graph' };
    const res = validateScenario(raw);
    expect(res.valid).toBe(false);
    expect(res.errors).toContainEqual(
      expect.objectContaining({ path: 'layout', code: 'INVALID_LAYOUT' }),
    );
  });

  it('rejects invalid source', () => {
    const raw = { ...validBase, source: 'production' };
    const res = validateScenario(raw);
    expect(res.valid).toBe(false);
    expect(res.errors).toContainEqual(
      expect.objectContaining({ path: 'source', code: 'INVALID_SOURCE' }),
    );
  });

  it('rejects empty or overly long title', () => {
    expect(validateScenario({ ...validBase, title: '' }).errors).toContainEqual(
      expect.objectContaining({ path: 'title', code: 'INVALID_TITLE' }),
    );
    expect(validateScenario({ ...validBase, title: 'a'.repeat(257) }).errors).toContainEqual(
      expect.objectContaining({ path: 'title', code: 'INVALID_TITLE' }),
    );
  });
});

describe('validateScenario - Layout Specific Rules', () => {
  it('single layout requires empty tail', () => {
    const raw = {
      schema: 'joinwitness.scenario/v1',
      specVersion: '1.0.0',
      layout: 'single',
      title: 'Single with tail',
      source: 'synthetic',
      base: [{ id: 'b1', key: 'k1', amountCents: '100' }],
      mid: [],
      tail: [{ id: 't1', parentKey: 'k1' }],
    };
    const res = validateScenario(raw);
    expect(res.valid).toBe(false);
    expect(res.errors).toContainEqual({
      path: 'tail',
      code: 'INVALID_LAYOUT_TAIL',
      message: 'Layout "single" requires tail to be empty',
    });
  });

  it('chain layout requires explicit linkKey in mid rows', () => {
    const raw = {
      schema: 'joinwitness.scenario/v1',
      specVersion: '1.0.0',
      layout: 'chain',
      title: 'Chain missing linkKey',
      source: 'synthetic',
      base: [{ id: 'b1', key: 'k1', amountCents: '100' }],
      mid: [{ id: 'm1', parentKey: 'k1' }], // missing linkKey!
      tail: [],
    };
    const res = validateScenario(raw);
    expect(res.valid).toBe(false);
    expect(res.errors).toContainEqual(
      expect.objectContaining({ path: 'mid[0].linkKey', code: 'MISSING_LINK_KEY' }),
    );
  });

  it('chain layout allows linkKey to be null', () => {
    const raw = {
      schema: 'joinwitness.scenario/v1',
      specVersion: '1.0.0',
      layout: 'chain',
      title: 'Chain with null linkKey',
      source: 'synthetic',
      base: [{ id: 'b1', key: 'k1', amountCents: '100' }],
      mid: [{ id: 'm1', parentKey: 'k1', linkKey: null }],
      tail: [],
    };
    const res = validateScenario(raw);
    expect(res.valid).toBe(true);
  });

  it('star layout allows linkKey to be omitted', () => {
    const raw = {
      schema: 'joinwitness.scenario/v1',
      specVersion: '1.0.0',
      layout: 'star',
      title: 'Star omitting linkKey',
      source: 'synthetic',
      base: [{ id: 'b1', key: 'k1', amountCents: '100' }],
      mid: [{ id: 'm1', parentKey: 'k1' }],
      tail: [{ id: 't1', parentKey: 'k1' }],
    };
    const res = validateScenario(raw);
    expect(res.valid).toBe(true);
  });
});

describe('validateScenario - Row Count Boundaries', () => {
  it('rejects empty base table', () => {
    const raw = {
      schema: 'joinwitness.scenario/v1',
      specVersion: '1.0.0',
      layout: 'single',
      title: 'Empty base',
      source: 'synthetic',
      base: [],
      mid: [],
      tail: [],
    };
    const res = validateScenario(raw);
    expect(res.valid).toBe(false);
    expect(res.errors).toContainEqual(
      expect.objectContaining({ path: 'base', code: 'ROW_COUNT_OUT_OF_BOUNDS' }),
    );
  });

  it('rejects base rows exceeding 5000', () => {
    const base = Array.from({ length: 5001 }, (_, i) => ({
      id: `b${i}`,
      key: `k${i}`,
      amountCents: '100',
    }));
    const raw = {
      schema: 'joinwitness.scenario/v1',
      specVersion: '1.0.0',
      layout: 'single',
      title: 'Large base',
      source: 'synthetic',
      base,
      mid: [],
      tail: [],
    };
    const res = validateScenario(raw);
    expect(res.valid).toBe(false);
    expect(res.errors).toContainEqual(
      expect.objectContaining({ path: 'base', code: 'ROW_COUNT_OUT_OF_BOUNDS' }),
    );
  });
});

describe('validateScenario - ID and Key Rules', () => {
  it('rejects malformed ID', () => {
    const raw = {
      schema: 'joinwitness.scenario/v1',
      specVersion: '1.0.0',
      layout: 'single',
      title: 'Bad ID',
      source: 'synthetic',
      base: [{ id: 'bad id with spaces', key: 'k1', amountCents: '100' }],
      mid: [],
      tail: [],
    };
    const res = validateScenario(raw);
    expect(res.valid).toBe(false);
    expect(res.errors).toContainEqual(
      expect.objectContaining({ path: 'base[0].id', code: 'INVALID_ID_FORMAT' }),
    );
  });

  it('rejects duplicate ID within the same table', () => {
    const raw = {
      schema: 'joinwitness.scenario/v1',
      specVersion: '1.0.0',
      layout: 'single',
      title: 'Duplicate ID',
      source: 'synthetic',
      base: [
        { id: 'dup1', key: 'k1', amountCents: '100' },
        { id: 'dup1', key: 'k2', amountCents: '200' },
      ],
      mid: [],
      tail: [],
    };
    const res = validateScenario(raw);
    expect(res.valid).toBe(false);
    expect(res.errors).toContainEqual(
      expect.objectContaining({ path: 'base[1].id', code: 'DUPLICATE_ID' }),
    );
  });

  it('allows same ID across different tables', () => {
    const raw = {
      schema: 'joinwitness.scenario/v1',
      specVersion: '1.0.0',
      layout: 'star',
      title: 'Same ID across tables',
      source: 'synthetic',
      base: [{ id: 'shared_id', key: 'k1', amountCents: '100' }],
      mid: [{ id: 'shared_id', parentKey: 'k1' }],
      tail: [{ id: 'shared_id', parentKey: 'k1' }],
    };
    const res = validateScenario(raw);
    expect(res.valid).toBe(true);
  });

  it('rejects non-string/non-null keys', () => {
    const raw = {
      schema: 'joinwitness.scenario/v1',
      specVersion: '1.0.0',
      layout: 'single',
      title: 'Invalid Key Types',
      source: 'synthetic',
      base: [{ id: 'b1', key: 12345 as unknown as string, amountCents: '100' }],
      mid: [{ id: 'm1', parentKey: true as unknown as string }],
      tail: [],
    };
    const res = validateScenario(raw);
    expect(res.valid).toBe(false);
    expect(res.errors).toContainEqual(
      expect.objectContaining({ path: 'base[0].key', code: 'INVALID_KEY' }),
    );
    expect(res.errors).toContainEqual(
      expect.objectContaining({ path: 'mid[0].parentKey', code: 'INVALID_KEY' }),
    );
  });
});

describe('validateScenario - Amount Rules', () => {
  it('rejects float amount', () => {
    const raw = {
      schema: 'joinwitness.scenario/v1',
      specVersion: '1.0.0',
      layout: 'single',
      title: 'Float amount',
      source: 'synthetic',
      base: [{ id: 'b1', key: 'k1', amountCents: '12.34' }],
      mid: [],
      tail: [],
    };
    const res = validateScenario(raw);
    expect(res.valid).toBe(false);
    expect(res.errors).toContainEqual(
      expect.objectContaining({ path: 'base[0].amountCents', code: 'INVALID_AMOUNT' }),
    );
  });

  it('rejects negative zero "-0"', () => {
    const raw = {
      schema: 'joinwitness.scenario/v1',
      specVersion: '1.0.0',
      layout: 'single',
      title: 'Negative zero',
      source: 'synthetic',
      base: [{ id: 'b1', key: 'k1', amountCents: '-0' }],
      mid: [],
      tail: [],
    };
    const res = validateScenario(raw);
    expect(res.valid).toBe(false);
    expect(res.errors).toContainEqual(
      expect.objectContaining({ path: 'base[0].amountCents', code: 'INVALID_AMOUNT' }),
    );
  });

  it('rejects leading zeroes in positive numbers e.g. "0123"', () => {
    const raw = {
      schema: 'joinwitness.scenario/v1',
      specVersion: '1.0.0',
      layout: 'single',
      title: 'Leading zero',
      source: 'synthetic',
      base: [{ id: 'b1', key: 'k1', amountCents: '0123' }],
      mid: [],
      tail: [],
    };
    const res = validateScenario(raw);
    expect(res.valid).toBe(false);
    expect(res.errors).toContainEqual(
      expect.objectContaining({ path: 'base[0].amountCents', code: 'INVALID_AMOUNT' }),
    );
  });

  it('rejects amount exceeding 100,000,000 cents', () => {
    const rawPos = {
      schema: 'joinwitness.scenario/v1',
      specVersion: '1.0.0',
      layout: 'single',
      title: 'Amount too high',
      source: 'synthetic',
      base: [{ id: 'b1', key: 'k1', amountCents: '100000001' }],
      mid: [],
      tail: [],
    };
    const resPos = validateScenario(rawPos);
    expect(resPos.valid).toBe(false);
    expect(resPos.errors).toContainEqual(
      expect.objectContaining({ path: 'base[0].amountCents', code: 'AMOUNT_OUT_OF_BOUNDS' }),
    );

    const rawNeg = {
      schema: 'joinwitness.scenario/v1',
      specVersion: '1.0.0',
      layout: 'single',
      title: 'Amount too negative',
      source: 'synthetic',
      base: [{ id: 'b1', key: 'k1', amountCents: '-100000001' }],
      mid: [],
      tail: [],
    };
    const resNeg = validateScenario(rawNeg);
    expect(resNeg.valid).toBe(false);
    expect(resNeg.errors).toContainEqual(
      expect.objectContaining({ path: 'base[0].amountCents', code: 'AMOUNT_OUT_OF_BOUNDS' }),
    );
  });

  it('accepts boundary amounts', () => {
    const raw = {
      schema: 'joinwitness.scenario/v1',
      specVersion: '1.0.0',
      layout: 'single',
      title: 'Boundary amounts',
      source: 'synthetic',
      base: [
        { id: 'b1', key: 'k1', amountCents: '0' },
        { id: 'b2', key: 'k2', amountCents: '100000000' },
        { id: 'b3', key: 'k3', amountCents: '-100000000' },
      ],
      mid: [],
      tail: [],
    };
    const res = validateScenario(raw);
    expect(res.valid).toBe(true);
  });
});

describe('validateScenario - Row-level Unknown Fields', () => {
  it('rejects unexpected field in row objects', () => {
    const raw = {
      schema: 'joinwitness.scenario/v1',
      specVersion: '1.0.0',
      layout: 'single',
      title: 'Row with extra field',
      source: 'synthetic',
      base: [{ id: 'b1', key: 'k1', amountCents: '100', extraCol: 'fail' }],
      mid: [],
      tail: [],
    };
    const res = validateScenario(raw);
    expect(res.valid).toBe(false);
    expect(res.errors).toContainEqual({
      path: 'base[0].extraCol',
      code: 'UNKNOWN_FIELD',
      message: 'Unexpected field "extraCol" in base row',
    });
  });
});
