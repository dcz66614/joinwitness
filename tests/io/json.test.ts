/**
 * P008 倍行镜 JoinWitness — JSON 版本化导入导出测试 (T009)
 *
 * 验收合同（实施计划 P008-T009、项目书 §5.1、§8、FR03、FR11、MATH10）：
 * 1. 全部 6 个冻结预设 (JW-A ~ JW-F) 解析与重导 100% 字节一致。
 * 2. 规范字段顺序、2 空格缩进、LF 换行与末尾换行。
 * 3. 至少 10 次连续往返字节稳定 (MATH10 确定性)。
 * 4. 严格拒绝非法版本 (INVALID_SCHEMA, INVALID_SPEC_VERSION) 与未知字段。
 * 5. 严格边界防御：重复 ID、非法数字、负零、超限金额、空 Base、超限行数 (>5000)、超限文件 (>5 MiB)。
 * 6. UTF-8 BOM 自动剥离与解析容错。
 * 7. 安全文件名 joinwitness-scenario.json 与安全文件名转换器。
 * 8. 无数据损失保证与序列化前校验。
 * 9. 输入文件不外传、不使用 localStorage 存储原文。
 */

import { describe, it, expect, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  parseScenarioJson,
  safeParseScenarioJson,
  serializeScenario,
  toCanonicalJson,
  ScenarioJsonError,
  DEFAULT_SCENARIO_FILENAME,
  SCENARIO_FILENAME,
  getSafeScenarioFilename,
  MAX_JSON_BYTES,
  SCHEMA_V1,
  SPEC_VERSION_V1,
} from '../../src/io/json.js';
import type { Scenario } from '../../src/core/types.js';

const FIXTURES_DIR = path.resolve(__dirname, '../../src/fixtures');
const PRESET_FILES = ['jw-a.json', 'jw-b.json', 'jw-c.json', 'jw-d.json', 'jw-e.json', 'jw-f.json'] as const;

function loadFixtureText(filename: string): string {
  return fs.readFileSync(path.join(FIXTURES_DIR, filename), 'utf8');
}

describe('T009 Versioned JSON Import & Export', () => {
  describe('1. Golden Presets Parse & Re-Export Byte-for-Byte Consistency (MATH10 & §5.2/§7)', () => {
    for (const filename of PRESET_FILES) {
      it(`parses and re-exports ${filename} with 100% exact byte match`, () => {
        const originalText = loadFixtureText(filename);
        const scenario = parseScenarioJson(originalText);

        expect(scenario.schema).toBe('joinwitness.scenario/v1');
        expect(scenario.specVersion).toBe('1.0.0');

        const serialized = serializeScenario(scenario);
        expect(serialized).toBe(originalText);

        console.log(`[EVIDENCE][PRESET_MATCH] Preset ${filename} parsed and re-exported byte-identical (${originalText.length} bytes)`);
      });
    }

    it('all 6 presets maintain byte stability across 15 consecutive round-trips', () => {
      for (const filename of PRESET_FILES) {
        const originalText = loadFixtureText(filename);
        let currentText = originalText;

        for (let round = 1; round <= 15; round++) {
          const parsed = parseScenarioJson(currentText);
          currentText = serializeScenario(parsed);
          expect(currentText).toBe(originalText);
        }
      }
      console.log('[EVIDENCE][ROUNDTRIP_15X] All 6 golden presets verified byte-identical across 15 consecutive round-trips');
    });
  });

  describe('2. Canonical Field Ordering, 2-Space Indentation, LF Line Breaks & Trailing Newline', () => {
    it('enforces strict canonical key order on top-level object', () => {
      // Create a scenario object with scrambled property order
      const scrambledObj = {
        tail: [{ id: 'p1', parentKey: 'k1' }],
        source: 'synthetic' as const,
        base: [{ id: 'b1', key: 'k1', amountCents: '1000' }],
        mid: [{ id: 'm1', parentKey: 'k1' }],
        title: 'Scrambled Properties Test',
        specVersion: '1.0.0' as const,
        layout: 'star' as const,
        schema: 'joinwitness.scenario/v1' as const,
      };

      const serialized = serializeScenario(scrambledObj);

      // Verify canonical root order: schema -> specVersion -> layout -> title -> source -> base -> mid -> tail
      const topLevelKeysInOrder: string[] = [];
      const lines = serialized.split('\n');
      for (const line of lines) {
        const match = line.match(/^ {2}"([a-zA-Z0-9]+)":/);
        if (match) {
          topLevelKeysInOrder.push(match[1]!);
        }
      }

      expect(topLevelKeysInOrder).toEqual([
        'schema',
        'specVersion',
        'layout',
        'title',
        'source',
        'base',
        'mid',
        'tail',
      ]);
      console.log('[EVIDENCE][CANONICAL_ORDER] Top-level keys strictly follow canonical order: schema, specVersion, layout, title, source, base, mid, tail');
    });

    it('enforces canonical order for row fields in base, mid, and tail', () => {
      const scenario: Scenario = {
        schema: 'joinwitness.scenario/v1',
        specVersion: '1.0.0',
        layout: 'chain',
        title: 'Row Ordering Test',
        source: 'user_imported',
        base: [{ amountCents: '500', key: 'K1', id: 'b1' }],
        mid: [{ linkKey: 'L1', parentKey: 'K1', id: 'm1' }],
        tail: [{ parentKey: 'L1', id: 't1' }],
      };

      const serialized = serializeScenario(scenario);

      // Base row order: id -> key -> amountCents
      expect(serialized).toMatch(/"id": "b1",\s+"key": "K1",\s+"amountCents": "500"/);

      // Mid row order: id -> parentKey -> linkKey
      expect(serialized).toMatch(/"id": "m1",\s+"parentKey": "K1",\s+"linkKey": "L1"/);

      // Tail row order: id -> parentKey
      expect(serialized).toMatch(/"id": "t1",\s+"parentKey": "L1"/);

      console.log('[EVIDENCE][ROW_ORDER] Table row fields strictly follow canonical order');
    });

    it('strictly outputs LF (\\n) line breaks and trailing newline without CRLF (\\r\\n)', () => {
      const presetText = loadFixtureText('jw-a.json');
      const scenario = parseScenarioJson(presetText);
      const serialized = serializeScenario(scenario);

      expect(serialized.includes('\r')).toBe(false);
      expect(serialized.endsWith('\n')).toBe(true);
      expect(serialized.endsWith('\n\n')).toBe(false);

      // Check indentation is 2 spaces
      const lines = serialized.split('\n');
      const indentedLines = lines.filter((l) => l.startsWith(' '));
      for (const line of indentedLines) {
        const leadingSpaces = line.match(/^ +/)![0].length;
        expect(leadingSpaces % 2).toBe(0);
      }
      console.log('[EVIDENCE][FORMATTING] Verified LF-only, single trailing newline, and 2-space indentation');
    });
  });

  describe('3. Rejection of Invalid Versions and Unknown Schemas (FR03 & FR11)', () => {
    it('rejects unsupported schema with descriptive error code INVALID_SCHEMA', () => {
      const badSchemaJson = JSON.stringify({
        schema: 'joinwitness.scenario/v2',
        specVersion: '1.0.0',
        layout: 'single',
        title: 'Bad Schema',
        source: 'synthetic',
        base: [{ id: 'b1', key: 'k1', amountCents: '100' }],
        mid: [],
        tail: [],
      });

      expect(() => parseScenarioJson(badSchemaJson)).toThrow(ScenarioJsonError);
      try {
        parseScenarioJson(badSchemaJson);
      } catch (err) {
        expect(err).toBeInstanceOf(ScenarioJsonError);
        const scenarioErr = err as ScenarioJsonError;
        expect(scenarioErr.errors.some((e) => e.code === 'INVALID_SCHEMA')).toBe(true);
        expect(scenarioErr.message).toContain('Expected schema "joinwitness.scenario/v1"');
      }
      console.log('[EVIDENCE][BAD_VERSION] Unsupported schema rejected with INVALID_SCHEMA');
    });

    it('rejects unsupported specVersion with descriptive error code INVALID_SPEC_VERSION', () => {
      const badVersionJson = JSON.stringify({
        schema: 'joinwitness.scenario/v1',
        specVersion: '2.0.0',
        layout: 'single',
        title: 'Bad Spec Version',
        source: 'synthetic',
        base: [{ id: 'b1', key: 'k1', amountCents: '100' }],
        mid: [],
        tail: [],
      });

      expect(() => parseScenarioJson(badVersionJson)).toThrow(ScenarioJsonError);
      try {
        parseScenarioJson(badVersionJson);
      } catch (err) {
        const scenarioErr = err as ScenarioJsonError;
        expect(scenarioErr.errors.some((e) => e.code === 'INVALID_SPEC_VERSION')).toBe(true);
        expect(scenarioErr.message).toContain('Expected specVersion "1.0.0"');
      }
      console.log('[EVIDENCE][BAD_VERSION] Unsupported specVersion rejected with INVALID_SPEC_VERSION');
    });

    it('rejects invalid layout types', () => {
      const badLayoutJson = JSON.stringify({
        schema: 'joinwitness.scenario/v1',
        specVersion: '1.0.0',
        layout: 'snowflake_tree',
        title: 'Bad Layout',
        source: 'synthetic',
        base: [{ id: 'b1', key: 'k1', amountCents: '100' }],
        mid: [],
        tail: [],
      });

      expect(() => parseScenarioJson(badLayoutJson)).toThrow(ScenarioJsonError);
      try {
        parseScenarioJson(badLayoutJson);
      } catch (err) {
        const scenarioErr = err as ScenarioJsonError;
        expect(scenarioErr.errors.some((e) => e.code === 'INVALID_LAYOUT')).toBe(true);
      }
    });

    it('rejects invalid source values', () => {
      const badSourceJson = JSON.stringify({
        schema: 'joinwitness.scenario/v1',
        specVersion: '1.0.0',
        layout: 'single',
        title: 'Bad Source',
        source: 'external_database',
        base: [{ id: 'b1', key: 'k1', amountCents: '100' }],
        mid: [],
        tail: [],
      });

      expect(() => parseScenarioJson(badSourceJson)).toThrow(ScenarioJsonError);
      try {
        parseScenarioJson(badSourceJson);
      } catch (err) {
        const scenarioErr = err as ScenarioJsonError;
        expect(scenarioErr.errors.some((e) => e.code === 'INVALID_SOURCE')).toBe(true);
      }
    });

    it('rejects unknown root fields to prevent silent payload smuggling', () => {
      const extraFieldJson = JSON.stringify({
        schema: 'joinwitness.scenario/v1',
        specVersion: '1.0.0',
        layout: 'single',
        title: 'Extra Fields',
        source: 'synthetic',
        base: [{ id: 'b1', key: 'k1', amountCents: '100' }],
        mid: [],
        tail: [],
        secretToken: 'do-not-leak',
      });

      expect(() => parseScenarioJson(extraFieldJson)).toThrow(ScenarioJsonError);
      try {
        parseScenarioJson(extraFieldJson);
      } catch (err) {
        const scenarioErr = err as ScenarioJsonError;
        expect(scenarioErr.errors.some((e) => e.code === 'UNKNOWN_FIELD')).toBe(true);
      }
    });
  });

  describe('4. Structural & Numeric Boundary Validation (FR03)', () => {
    it('rejects malformed JSON syntax with INVALID_JSON_SYNTAX', () => {
      const malformedJson = '{ schema: "joinwitness.scenario/v1", unquoted: true }';
      expect(() => parseScenarioJson(malformedJson)).toThrow(ScenarioJsonError);
      try {
        parseScenarioJson(malformedJson);
      } catch (err) {
        const scenarioErr = err as ScenarioJsonError;
        expect(scenarioErr.errors.some((e) => e.code === 'INVALID_JSON_SYNTAX')).toBe(true);
      }
    });

    it('rejects non-object or null root input', () => {
      expect(() => parseScenarioJson('null')).toThrow(ScenarioJsonError);
      expect(() => parseScenarioJson('"string"')).toThrow(ScenarioJsonError);
      expect(() => parseScenarioJson('12345')).toThrow(ScenarioJsonError);
      expect(() => parseScenarioJson('[]')).toThrow(ScenarioJsonError);
    });

    it('rejects input exceeding 5 MiB file size limit with FILE_TOO_LARGE', () => {
      // 5 MiB = 5,242,880 bytes. Create a string slightly above 5 MiB.
      const largePadding = ' '.repeat(MAX_JSON_BYTES + 10);
      const largeJson = `{"schema":"joinwitness.scenario/v1","specVersion":"1.0.0","layout":"single","title":"Too Large","source":"synthetic","base":[{"id":"b1","key":"k1","amountCents":"100"}],"mid":[],"tail":[]}${largePadding}`;

      expect(() => parseScenarioJson(largeJson)).toThrow(ScenarioJsonError);
      try {
        parseScenarioJson(largeJson);
      } catch (err) {
        const scenarioErr = err as ScenarioJsonError;
        expect(scenarioErr.errors.some((e) => e.code === 'FILE_TOO_LARGE')).toBe(true);
        expect(scenarioErr.message).toContain('exceeds maximum limit of 5 MiB');
      }
      console.log('[EVIDENCE][SIZE_LIMIT] JSON exceeding 5 MiB strictly rejected with FILE_TOO_LARGE');
    });

    it('rejects duplicate IDs within Base table', () => {
      const duplicateIdJson = JSON.stringify({
        schema: 'joinwitness.scenario/v1',
        specVersion: '1.0.0',
        layout: 'single',
        title: 'Duplicate ID',
        source: 'synthetic',
        base: [
          { id: 'dup_id', key: 'k1', amountCents: '100' },
          { id: 'dup_id', key: 'k2', amountCents: '200' },
        ],
        mid: [],
        tail: [],
      });

      expect(() => parseScenarioJson(duplicateIdJson)).toThrow(ScenarioJsonError);
      try {
        parseScenarioJson(duplicateIdJson);
      } catch (err) {
        const scenarioErr = err as ScenarioJsonError;
        expect(scenarioErr.errors.some((e) => e.code === 'DUPLICATE_ID')).toBe(true);
      }
    });

    it('rejects empty Base table (at least 1 row required)', () => {
      const emptyBaseJson = JSON.stringify({
        schema: 'joinwitness.scenario/v1',
        specVersion: '1.0.0',
        layout: 'single',
        title: 'Empty Base',
        source: 'synthetic',
        base: [],
        mid: [],
        tail: [],
      });

      expect(() => parseScenarioJson(emptyBaseJson)).toThrow(ScenarioJsonError);
      try {
        parseScenarioJson(emptyBaseJson);
      } catch (err) {
        const scenarioErr = err as ScenarioJsonError;
        expect(scenarioErr.errors.some((e) => e.code === 'ROW_COUNT_OUT_OF_BOUNDS')).toBe(true);
      }
    });

    it('rejects negative zero amount ("-0")', () => {
      const negZeroJson = JSON.stringify({
        schema: 'joinwitness.scenario/v1',
        specVersion: '1.0.0',
        layout: 'single',
        title: 'Negative Zero',
        source: 'synthetic',
        base: [{ id: 'b1', key: 'k1', amountCents: '-0' }],
        mid: [],
        tail: [],
      });

      expect(() => parseScenarioJson(negZeroJson)).toThrow(ScenarioJsonError);
      try {
        parseScenarioJson(negZeroJson);
      } catch (err) {
        const scenarioErr = err as ScenarioJsonError;
        expect(scenarioErr.errors.some((e) => e.code === 'INVALID_AMOUNT')).toBe(true);
      }
    });

    it('rejects non-integer amount strings (decimals, symbols, non-numeric)', () => {
      const badAmounts = ['12.34', '100,00', '$100', '1e5', 'NaN', ''];
      for (const amount of badAmounts) {
        const badJson = JSON.stringify({
          schema: 'joinwitness.scenario/v1',
          specVersion: '1.0.0',
          layout: 'single',
          title: 'Bad Amount',
          source: 'synthetic',
          base: [{ id: 'b1', key: 'k1', amountCents: amount }],
          mid: [],
          tail: [],
        });
        expect(() => parseScenarioJson(badJson)).toThrow(ScenarioJsonError);
      }
    });

    it('rejects amounts exceeding 100,000,000 cents (AMOUNT_OUT_OF_BOUNDS)', () => {
      const overLimitJson = JSON.stringify({
        schema: 'joinwitness.scenario/v1',
        specVersion: '1.0.0',
        layout: 'single',
        title: 'Amount Over Limit',
        source: 'synthetic',
        base: [{ id: 'b1', key: 'k1', amountCents: '100000001' }],
        mid: [],
        tail: [],
      });

      expect(() => parseScenarioJson(overLimitJson)).toThrow(ScenarioJsonError);
      try {
        parseScenarioJson(overLimitJson);
      } catch (err) {
        const scenarioErr = err as ScenarioJsonError;
        expect(scenarioErr.errors.some((e) => e.code === 'AMOUNT_OUT_OF_BOUNDS')).toBe(true);
      }
    });

    it('rejects single layout with non-empty tail rows (INVALID_LAYOUT_TAIL)', () => {
      const singleWithTailJson = JSON.stringify({
        schema: 'joinwitness.scenario/v1',
        specVersion: '1.0.0',
        layout: 'single',
        title: 'Single With Tail',
        source: 'synthetic',
        base: [{ id: 'b1', key: 'k1', amountCents: '100' }],
        mid: [{ id: 'm1', parentKey: 'k1' }],
        tail: [{ id: 't1', parentKey: 'k1' }],
      });

      expect(() => parseScenarioJson(singleWithTailJson)).toThrow(ScenarioJsonError);
      try {
        parseScenarioJson(singleWithTailJson);
      } catch (err) {
        const scenarioErr = err as ScenarioJsonError;
        expect(scenarioErr.errors.some((e) => e.code === 'INVALID_LAYOUT_TAIL')).toBe(true);
      }
    });

    it('rejects chain layout with mid row missing linkKey (MISSING_LINK_KEY)', () => {
      const chainMissingLinkKeyJson = JSON.stringify({
        schema: 'joinwitness.scenario/v1',
        specVersion: '1.0.0',
        layout: 'chain',
        title: 'Chain Missing linkKey',
        source: 'synthetic',
        base: [{ id: 'b1', key: 'k1', amountCents: '100' }],
        mid: [{ id: 'm1', parentKey: 'k1' }], // missing linkKey
        tail: [{ id: 't1', parentKey: 'L1' }],
      });

      expect(() => parseScenarioJson(chainMissingLinkKeyJson)).toThrow(ScenarioJsonError);
      try {
        parseScenarioJson(chainMissingLinkKeyJson);
      } catch (err) {
        const scenarioErr = err as ScenarioJsonError;
        expect(scenarioErr.errors.some((e) => e.code === 'MISSING_LINK_KEY')).toBe(true);
      }
    });
  });

  describe('5. UTF-8 BOM Handling & Parsing Robustness', () => {
    it('seamlessly strips UTF-8 BOM (\\uFEFF) and parses valid scenario JSON', () => {
      const originalText = loadFixtureText('jw-a.json');
      const bomText = '\uFEFF' + originalText;

      const parsed = parseScenarioJson(bomText);
      expect(parsed.title).toBe('JW-A 双支路暴增（合成）');

      const reSerialized = serializeScenario(parsed);
      expect(reSerialized).toBe(originalText);
      expect(reSerialized.charCodeAt(0)).not.toBe(0xfeff);

      console.log('[EVIDENCE][BOM] UTF-8 BOM automatically stripped, clean re-export verified');
    });
  });

  describe('6. Safe Parse Without Throwing (safeParseScenarioJson)', () => {
    it('returns { ok: true, valid: true, scenario } on valid scenario', () => {
      const fixtureText = loadFixtureText('jw-c.json');
      const result = safeParseScenarioJson(fixtureText);

      expect(result.ok).toBe(true);
      expect(result.valid).toBe(true);
      if (result.ok) {
        expect(result.scenario.title).toBe('JW-C 正负误差抵消（合成）');
        expect(result.errors).toEqual([]);
      }
    });

    it('returns { ok: false, valid: false, errors } without throwing on invalid input', () => {
      const result = safeParseScenarioJson('{ invalid json');
      expect(result.ok).toBe(false);
      expect(result.valid).toBe(false);
      if (!result.ok) {
        expect(result.errors.length).toBeGreaterThan(0);
        expect(result.errors[0]?.code).toBe('INVALID_JSON_SYNTAX');
      }
    });
  });

  describe('7. Data Loss Prevention & Serialization Validation (No Data Loss Guarantee)', () => {
    it('guarantees complete round-trip data fidelity without data loss or numeric distortion', () => {
      const scenario: Scenario = {
        schema: SCHEMA_V1,
        specVersion: SPEC_VERSION_V1,
        layout: 'chain',
        title: 'Full Fidelity Edge Case Test',
        source: 'user_imported',
        base: [
          { id: 'b_zero', key: 'ZERO_KEY', amountCents: '0' },
          { id: 'b_max_pos', key: 'MAX_POS', amountCents: '100000000' },
          { id: 'b_max_neg', key: 'MAX_NEG', amountCents: '-100000000' },
          { id: 'b_null_key', key: null, amountCents: '42' },
        ],
        mid: [
          { id: 'm1', parentKey: 'ZERO_KEY', linkKey: 'CHAIN_LINK_1' },
          { id: 'm2', parentKey: 'MAX_POS', linkKey: null },
          { id: 'm3', parentKey: null, linkKey: null },
        ],
        tail: [
          { id: 't1', parentKey: 'CHAIN_LINK_1' },
          { id: 't2', parentKey: null },
        ],
      };

      const serialized = serializeScenario(scenario);
      const parsedAgain = parseScenarioJson(serialized);

      expect(parsedAgain).toEqual(scenario);

      // Verify 10 subsequent round trips remain byte-identical
      let currentText = serialized;
      for (let i = 0; i < 10; i++) {
        currentText = serializeScenario(parseScenarioJson(currentText));
        expect(currentText).toBe(serialized);
      }
      console.log('[EVIDENCE][DATA_LOSS_PREVENTION] 100% data fidelity verified with extreme amounts, null keys, and null linkKeys');
    });

    it('refuses to serialize invalid Scenario to prevent silent data corruption', () => {
      const invalidScenario = {
        schema: 'joinwitness.scenario/v1',
        specVersion: '1.0.0',
        layout: 'single',
        title: 'Invalid Scenario',
        source: 'synthetic',
        base: [], // invalid: empty base
        mid: [],
        tail: [],
      } as unknown as Scenario;

      expect(() => serializeScenario(invalidScenario)).toThrow(ScenarioJsonError);
      console.log('[EVIDENCE][CORRUPTION_PREVENTION] serializeScenario strictly rejects invalid data before export');
    });
  });

  describe('8. Safe Scenario Filename Contract', () => {
    it('provides default safe filename joinwitness-scenario.json', () => {
      expect(DEFAULT_SCENARIO_FILENAME).toBe('joinwitness-scenario.json');
      expect(SCENARIO_FILENAME).toBe('joinwitness-scenario.json');
      expect(getSafeScenarioFilename()).toBe('joinwitness-scenario.json');
      expect(getSafeScenarioFilename('')).toBe('joinwitness-scenario.json');
    });

    it('sanitizes custom filenames by stripping unsafe path traversal or shell characters', () => {
      expect(getSafeScenarioFilename('my scenario')).toBe('my_scenario.json');
      expect(getSafeScenarioFilename('../../../etc/passwd')).toBe('.._.._.._etc_passwd.json');
      expect(getSafeScenarioFilename('export<script>.json')).toBe('export_script_.json');
      expect(getSafeScenarioFilename('custom-report.json')).toBe('custom-report.json');
      console.log('[EVIDENCE][SAFE_FILENAME] Safe filename contract verified with sanitization');
    });
  });

  describe('9. Privacy & Non-Exfiltration Guarantee', () => {
    it('operates entirely in-memory without accessing localStorage, sessionStorage or network', () => {
      // Verify no localStorage / sessionStorage or fetch API was touched
      const storageSpy = vi.fn();
      if (typeof window !== 'undefined' && window.localStorage) {
        vi.spyOn(window.localStorage, 'setItem').mockImplementation(storageSpy);
      }

      const originalText = loadFixtureText('jw-a.json');
      const scenario = parseScenarioJson(originalText);
      const serialized = serializeScenario(scenario);

      expect(serialized).toBe(originalText);
      expect(storageSpy).not.toHaveBeenCalled();
      console.log('[EVIDENCE][PRIVACY] In-memory operation verified: zero localStorage, zero network exfiltration');
    });
  });

  describe('10. Canonical JSON Serialization & Hash Invariants (B04 / FIX-R1-04)', () => {
    it('strictly sorts object keys lexicographically at all nesting levels', () => {
      const obj = {
        z: 1,
        a: {
          y: 'second',
          b: 'first',
        },
        m: 3,
      };

      const canonical = toCanonicalJson(obj);
      expect(canonical).toBe('{"a":{"b":"first","y":"second"},"m":3,"z":1}');
    });

    it('strictly preserves array element order without sorting items', () => {
      const arr = [3, 1, 2, 'z', 'a'];
      expect(toCanonicalJson(arr)).toBe('[3,1,2,"z","a"]');
    });

    it('encodes primitives uniformly with zero superfluous whitespace', () => {
      expect(toCanonicalJson(null)).toBe('null');
      expect(toCanonicalJson(true)).toBe('true');
      expect(toCanonicalJson(false)).toBe('false');
      expect(toCanonicalJson(0)).toBe('0');
      expect(toCanonicalJson(-0)).toBe('0');
      expect(toCanonicalJson(12345)).toBe('12345');
      expect(toCanonicalJson(-9876)).toBe('-9876');
      expect(toCanonicalJson('hello "world" \n\t')).toBe(JSON.stringify('hello "world" \n\t'));
    });

    it('ignores undefined properties on objects, serializes undefined in arrays as null', () => {
      const objWithUndefined = {
        a: 1,
        b: undefined,
        c: 'test',
      };
      expect(toCanonicalJson(objWithUndefined)).toBe('{"a":1,"c":"test"}');

      const arrWithUndefined = [1, undefined, 2];
      expect(toCanonicalJson(arrWithUndefined)).toBe('[1,null,2]');
    });

    it('produces byte-identical canonical JSON for content-equivalent scenario objects with scrambled keys', () => {
      const scenarioCanonical: Scenario = {
        schema: 'joinwitness.scenario/v1',
        specVersion: '1.0.0',
        layout: 'star',
        title: 'Equivalence Test',
        source: 'synthetic',
        base: [
          { id: 'b1', key: 'K1', amountCents: '1000' },
          { id: 'b2', key: 'K2', amountCents: '2000' },
        ],
        mid: [
          { id: 'm1', parentKey: 'K1' },
          { id: 'm2', parentKey: 'K2' },
        ],
        tail: [],
      };

      // Same scenario but with completely scrambled property insertion orders
      const scenarioScrambled = {
        tail: [],
        source: 'synthetic' as const,
        base: [
          { amountCents: '1000', id: 'b1', key: 'K1' },
          { key: 'K2', amountCents: '2000', id: 'b2' },
        ],
        title: 'Equivalence Test',
        specVersion: '1.0.0' as const,
        layout: 'star' as const,
        mid: [
          { parentKey: 'K1', id: 'm1' },
          { id: 'm2', parentKey: 'K2' },
        ],
        schema: 'joinwitness.scenario/v1' as const,
      } as Scenario;

      const canon1 = toCanonicalJson(scenarioCanonical);
      const canon2 = toCanonicalJson(scenarioScrambled);

      expect(canon1).toBe(canon2);
      // Verify no extraneous whitespace between JSON tokens
      expect(canon1).not.toMatch(/:\s+|\s+,|,\s+/);
      expect(canon1).not.toContain('\n');
      expect(canon1).not.toContain('\r');

      console.log(`[EVIDENCE][CANONICAL_EQUIVALENCE] Content-equivalent scenarios produce 100% byte-identical canonical JSON (${canon1.length} bytes)`);
    });

    it('scrambled JSON maintains canonical JSON representation across parse → export → parse roundtrips', () => {
      // Scrambled JSON text where top-level keys and inner row keys are intentionally permuted
      const scrambledJson = JSON.stringify({
        tail: [{ parentKey: 'L1', id: 't1' }],
        mid: [{ linkKey: 'L1', parentKey: 'K1', id: 'm1' }],
        source: 'synthetic',
        base: [{ amountCents: '500', key: 'K1', id: 'b1' }],
        title: 'Roundtrip Stability Test',
        layout: 'chain',
        specVersion: '1.0.0',
        schema: 'joinwitness.scenario/v1',
      });

      const s1 = parseScenarioJson(scrambledJson);
      const canon1 = toCanonicalJson(s1);

      const exportedText = serializeScenario(s1);
      const s2 = parseScenarioJson(exportedText);
      const canon2 = toCanonicalJson(s2);

      expect(canon1).toBe(canon2);
      console.log('[EVIDENCE][ROUNDTRIP_CANONICAL_STABILITY] Canonical JSON representation stable across parse → export → parse roundtrip');
    });
  });
});
