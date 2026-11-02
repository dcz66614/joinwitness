/**
 * P008 倍行镜 JoinWitness — RFC4180 CSV 解析与列映射测试
 *
 * 验收合同（实施计划 P008-T008、项目书 §5.1、§8 FR02）：
 * 1. RFC4180 标准边界：双引号转义 ("")、引号内换行 (\r\n, \n)、UTF-8 BOM、空列。
 * 2. 单双引号不混淆：单引号视为普通文本字符，不拆分或转义。
 * 3. 语法错误拒绝：未闭合引号、非引号字段中的裸引号、引号闭合后的意外字符。
 * 4. 输入上限：2 MiB 文件上限、5,000 行上限、Base 至少 1 行。
 * 5. 金额转分与零浮点：纯 BigInt 整数运算，拒绝负零、拒绝非法格式、拒绝超限。
 * 6. UI 列映射契约：2 表 single / 3 表 star / 3 表 chain，空键转 null，不自动 trim，ID 约束，端到端与核心算法对齐。
 */

import { describe, it, expect } from 'vitest';
import {
  parseCsv,
  parseCsvRows,
  safeParseCsv,
  CsvParseError,
  parseAmountToCents,
  formatCentsToAmount,
  MAX_CSV_BYTES,
  MAX_TABLE_ROWS,
} from '../../src/io/csv.js';
import {
  mapBaseTable,
  mapMidTable,
  mapTailTable,
  importScenarioFromCsv,
  importScenarioFromCsvSafe,
  CsvMappingError,
} from '../../src/io/mapping.js';
import { analyze } from '../../src/core/analyze.js';

describe('T008 RFC4180 CSV Parsing & Column Mapping', () => {
  describe('1. RFC4180 CSV Parsing Boundaries', () => {
    it('handles standard comma-separated values with CRLF and LF', () => {
      const csvLf = 'id,key,amount\no1,K1,10.00\no2,K2,20.00\n';
      const resultLf = parseCsv(csvLf);
      expect(resultLf.headers).toEqual(['id', 'key', 'amount']);
      expect(resultLf.rows).toEqual([
        ['o1', 'K1', '10.00'],
        ['o2', 'K2', '20.00'],
      ]);
      expect(resultLf.totalRows).toBe(2);

      const csvCrlf = 'id,key,amount\r\no1,K1,10.00\r\no2,K2,20.00\r\n';
      const resultCrlf = parseCsv(csvCrlf);
      expect(resultCrlf.headers).toEqual(['id', 'key', 'amount']);
      expect(resultCrlf.rows).toEqual([
        ['o1', 'K1', '10.00'],
        ['o2', 'K2', '20.00'],
      ]);

      console.log('[EVIDENCE][RFC4180] LF and CRLF line breaks correctly parsed');
    });

    it('handles double quote escaping ("" -> ") per RFC4180', () => {
      const csv = 'id,title,amount\n1,"She said ""Hello""",10.00\n2,"Double quotes: """"",20.00';
      const result = parseCsv(csv);
      expect(result.rows[0]![1]).toBe('She said "Hello"');
      expect(result.rows[1]![1]).toBe('Double quotes: ""');

      console.log(
        `[EVIDENCE][RFC4180] Double quote escape verified: ${JSON.stringify(result.rows[0]![1])}`
      );
    });

    it('handles multiline fields within double quotes', () => {
      const csv = 'id,address,amount\n1,"Line 1\nLine 2\r\nLine 3",50.00\n2,"Single line",10.00';
      const result = parseCsv(csv);
      expect(result.rows).toHaveLength(2);
      expect(result.rows[0]![1]).toBe('Line 1\nLine 2\nLine 3');
      expect(result.rows[1]![1]).toBe('Single line');

      console.log('[EVIDENCE][RFC4180] Quoted multiline field preserved across 3 lines');
    });

    it('strips UTF-8 BOM (\\uFEFF) seamlessly without corrupting headers', () => {
      const bomCsv = '\uFEFFid,key,amount\no1,K1,100.00';
      const result = parseCsv(bomCsv);
      expect(result.headers[0]).toBe('id');
      expect(result.headers).toEqual(['id', 'key', 'amount']);
      expect(result.rows[0]).toEqual(['o1', 'K1', '100.00']);

      console.log('[EVIDENCE][RFC4180] UTF-8 BOM stripped from headers successfully');
    });

    it('preserves single quotes as literal text without confusing with double quotes', () => {
      // In RFC4180, single quote is NOT a delimiter or quoting character
      const csv = "id,desc,amount\no1,'single quoted text',10.00\no2,it's a boy,20.00";
      const result = parseCsv(csv);
      expect(result.rows[0]![1]).toBe("'single quoted text'");
      expect(result.rows[1]![1]).toBe("it's a boy");

      // Comma inside unquoted single quote splits fields (because ' does not quote in RFC4180)
      const csvUnquotedSingle = "a,'b,c',d";
      const rows = parseCsvRows(csvUnquotedSingle);
      expect(rows[0]).toEqual(['a', "'b", "c'", 'd']);

      // Double-quoted field containing single quote and comma
      const csvDoubleQuoted = 'a,"\'b,c\'",d';
      const rowsQuoted = parseCsvRows(csvDoubleQuoted);
      expect(rowsQuoted[0]).toEqual(['a', "'b,c'", 'd']);

      console.log('[EVIDENCE][RFC4180] Single vs double quotes strictly separated');
    });

    it('handles empty columns at start, middle, and end of rows', () => {
      const csv = 'c1,c2,c3,c4\n,v2,v3,v4\nv1,,v3,v4\nv1,v2,,\n,,,\n';
      const result = parseCsv(csv);
      expect(result.rows).toEqual([
        ['', 'v2', 'v3', 'v4'],
        ['v1', '', 'v3', 'v4'],
        ['v1', 'v2', '', ''],
        ['', '', '', ''],
      ]);

      console.log('[EVIDENCE][RFC4180] Empty column positions verified at head/mid/tail');
    });

    it('safely skips empty lines when skipEmptyLines is true', () => {
      const csv = '\n\nid,key,amount\n\no1,K1,10.00\n\n\no2,K2,20.00\n\n';
      const result = parseCsv(csv);
      expect(result.headers).toEqual(['id', 'key', 'amount']);
      expect(result.rows).toHaveLength(2);
      expect(result.rows[0]).toEqual(['o1', 'K1', '10.00']);
      expect(result.rows[1]).toEqual(['o2', 'K2', '20.00']);
    });
  });

  describe('2. RFC4180 Parse Error Rejection & Line/Col Reporting', () => {
    it('rejects unclosed quotes with line and column information', () => {
      const badCsv = 'id,name,amount\no1,"unclosed quote at end,10.00';
      expect(() => parseCsv(badCsv)).toThrowError(CsvParseError);
      expect(() => parseCsv(badCsv)).toThrowError(/Unclosed quote at end of CSV input/);

      const safeResult = safeParseCsv(badCsv);
      expect(safeResult.ok).toBe(false);
      if (!safeResult.ok) {
        expect(safeResult.error.line).toBe(2);
        expect(safeResult.error.column).toBe(4);
        console.log(
          `[EVIDENCE][RFC4180] Unclosed quote rejected with error: ${safeResult.error.message}`
        );
      }
    });

    it('rejects unescaped double quotes inside unquoted fields', () => {
      const badCsv = 'id,desc,amount\no1,foo"bar,10.00';
      expect(() => parseCsv(badCsv)).toThrowError(CsvParseError);
      expect(() => parseCsv(badCsv)).toThrowError(/Unescaped double quote inside unquoted field/);

      const safeResult = safeParseCsv(badCsv);
      expect(safeResult.ok).toBe(false);
      if (!safeResult.ok) {
        expect(safeResult.error.line).toBe(2);
        expect(safeResult.error.column).toBe(7);
        console.log(
          `[EVIDENCE][RFC4180] Unescaped quote rejected with error: ${safeResult.error.message}`
        );
      }
    });

    it('rejects unexpected characters following closing quotes', () => {
      const badCsv = 'id,name,amount\no1,"hello"world,10.00';
      expect(() => parseCsv(badCsv)).toThrowError(CsvParseError);
      expect(() => parseCsv(badCsv)).toThrowError(/Unexpected character "w" after closing quote/);

      console.log('[EVIDENCE][RFC4180] Unexpected character after closing quote rejected');
    });

    it('rejects CSV exceeding 2 MiB file size limit', () => {
      // 构造超过 2 MiB (2,097,152 bytes) 的字符串
      const chunkSize = 1024;
      const chunk = 'a'.repeat(chunkSize);
      const chunksNeeded = Math.ceil((MAX_CSV_BYTES + 1024) / chunkSize);
      const hugeCsv = 'col\n' + Array(chunksNeeded).fill(chunk).join('\n');

      expect(() => parseCsv(hugeCsv)).toThrowError(/exceeds maximum limit of 2097152 bytes/);
      console.log(`[EVIDENCE][RFC4180] >2 MiB CSV input strictly rejected`);
    });

    it('rejects CSV exceeding maximum rows limit (5,000 rows)', () => {
      const rows: string[] = ['id,key,amount'];
      for (let i = 1; i <= 5001; i++) {
        rows.push(`o${i},K${i},1.00`);
      }
      const largeCsv = rows.join('\n');

      expect(() => parseCsv(largeCsv)).toThrowError(/exceeds maximum allowed limit of 5000 rows/);
      console.log('[EVIDENCE][RFC4180] 5,001 data rows rejected exceeding MAX_TABLE_ROWS');
    });
  });

  describe('3. Amount String-to-Cents Conversion (Zero-Float Guarantee)', () => {
    it('converts valid decimal amount strings to integer cents without floating point arithmetic', () => {
      expect(parseAmountToCents('1200')).toBe('120000');
      expect(parseAmountToCents('1200.5')).toBe('120050');
      expect(parseAmountToCents('1200.50')).toBe('120050');
      expect(parseAmountToCents('12.34')).toBe('1234');
      expect(parseAmountToCents('0.05')).toBe('5');
      expect(parseAmountToCents('0.5')).toBe('50');
      expect(parseAmountToCents('0.50')).toBe('50');
      expect(parseAmountToCents('0')).toBe('0');
      expect(parseAmountToCents('0.0')).toBe('0');
      expect(parseAmountToCents('0.00')).toBe('0');
      expect(parseAmountToCents('+12.34')).toBe('1234');
      expect(parseAmountToCents('-1234.56')).toBe('-123456');
      expect(parseAmountToCents('-0.50')).toBe('-50');
      expect(parseAmountToCents('-0.05')).toBe('-5');
      expect(parseAmountToCents('-1200')).toBe('-120000');
      expect(parseAmountToCents('1000000.00')).toBe('100000000');
      expect(parseAmountToCents('-1000000.00')).toBe('-100000000');

      console.log(
        '[EVIDENCE][AMOUNT] Exact conversions: 1200 -> 120000, 12.34 -> 1234, -1234.56 -> -123456, 0.05 -> 5'
      );
    });

    it('rejects negative zero amounts ("-0", "-0.0", "-0.00")', () => {
      expect(() => parseAmountToCents('-0')).toThrowError(/Negative zero amount "-0" is not allowed/);
      expect(() => parseAmountToCents('-0.0')).toThrowError(/Negative zero amount/);
      expect(() => parseAmountToCents('-0.00')).toThrowError(/Negative zero amount/);

      console.log('[EVIDENCE][AMOUNT] Negative zero amounts (-0, -0.00) strictly rejected');
    });

    it('rejects invalid amount formats (more than 2 decimal places, non-numeric, commas, currency symbols)', () => {
      expect(() => parseAmountToCents('12.345')).toThrowError(/Invalid amount format/);
      expect(() => parseAmountToCents('0.001')).toThrowError(/Invalid amount format/);
      expect(() => parseAmountToCents('12.')).toThrowError(/Invalid amount format/);
      expect(() => parseAmountToCents('.50')).toThrowError(/Invalid amount format/);
      expect(() => parseAmountToCents('1,234.56')).toThrowError(/Invalid amount format/);
      expect(() => parseAmountToCents('$100.00')).toThrowError(/Invalid amount format/);
      expect(() => parseAmountToCents('100元')).toThrowError(/Invalid amount format/);
      expect(() => parseAmountToCents('abc')).toThrowError(/Invalid amount format/);
      expect(() => parseAmountToCents('')).toThrowError(/cannot be empty/);
      expect(() => parseAmountToCents('   ')).toThrowError(/cannot be empty/);

      console.log('[EVIDENCE][AMOUNT] Invalid amount formats strictly rejected');
    });

    it('rejects amounts exceeding 100,000,000 cents (1,000,000.00 yuan)', () => {
      expect(() => parseAmountToCents('1000000.01')).toThrowError(/exceeds maximum allowed value/);
      expect(() => parseAmountToCents('-1000000.01')).toThrowError(/exceeds maximum allowed value/);
      expect(() => parseAmountToCents('2000000.00')).toThrowError(/exceeds maximum allowed value/);

      console.log('[EVIDENCE][AMOUNT] Amount > 100,000,000 cents rejected');
    });

    it('formats cents back to two-decimal string safely without floating point operations', () => {
      expect(formatCentsToAmount('123456')).toBe('1234.56');
      expect(formatCentsToAmount('1234')).toBe('12.34');
      expect(formatCentsToAmount('50')).toBe('0.50');
      expect(formatCentsToAmount('5')).toBe('0.05');
      expect(formatCentsToAmount('0')).toBe('0.00');
      expect(formatCentsToAmount('-5')).toBe('-0.05');
      expect(formatCentsToAmount('-50')).toBe('-0.50');
      expect(formatCentsToAmount('-123456')).toBe('-1234.56');

      console.log('[EVIDENCE][AMOUNT] formatCentsToAmount roundtrip precision verified');
    });
  });

  describe('4. Table Mapping and UI Import Contract', () => {
    it('maps Base table with empty keys to null, preserving non-empty keys without trimming', () => {
      const csv = `id,key,amount\no1,,10.00\no2,  K2  ,20.00\no3,K3,30.00`;
      const baseRows = mapBaseTable(csv, {
        idColumn: 'id',
        keyColumn: 'key',
        amountColumn: 'amount',
      });

      expect(baseRows).toEqual([
        { id: 'o1', key: null, amountCents: '1000' },
        { id: 'o2', key: '  K2  ', amountCents: '2000' }, // non-empty key MUST NOT be trimmed!
        { id: 'o3', key: 'K3', amountCents: '3000' },
      ]);

      console.log('[EVIDENCE][MAPPING] Empty key converted to null; non-empty key preserved without trim');
    });

    it('rejects duplicate or invalid IDs in table mapping', () => {
      const dupCsv = 'id,key,amount\no1,K1,10.00\no1,K2,20.00';
      expect(() =>
        mapBaseTable(dupCsv, { idColumn: 'id', keyColumn: 'key', amountColumn: 'amount' })
      ).toThrowError(CsvMappingError);
      expect(() =>
        mapBaseTable(dupCsv, { idColumn: 'id', keyColumn: 'key', amountColumn: 'amount' })
      ).toThrowError(/Duplicate ID "o1" found in Base table/);

      const invalidIdCsv = 'id,key,amount\n"bad id with space",K1,10.00';
      expect(() =>
        mapBaseTable(invalidIdCsv, { idColumn: 'id', keyColumn: 'key', amountColumn: 'amount' })
      ).toThrowError(CsvMappingError);
      expect(() =>
        mapBaseTable(invalidIdCsv, { idColumn: 'id', keyColumn: 'key', amountColumn: 'amount' })
      ).toThrowError(/Invalid ID format/);

      console.log('[EVIDENCE][MAPPING] Duplicate and invalid IDs rejected in Base table');
    });

    it('rejects missing mapped columns with descriptive error', () => {
      const csv = 'order_no,item_key,val\no1,K1,10.00';
      expect(() =>
        mapBaseTable(csv, { idColumn: 'id', keyColumn: 'item_key', amountColumn: 'val' })
      ).toThrowError(/Primary key \(id\) column "id" not found in CSV headers/);

      console.log('[EVIDENCE][MAPPING] Missing column error reported with header list');
    });

    it('imports 2-table scenario (layout: single) and verifies SQL NULL non-joining', async () => {
      const baseCsv = 'id,join_key,price\na1,X,10.00\na2,,20.00\na3,Z,30.00';
      const midCsv = 'mid_id,fk\nm1,X\nm2,X\nm3,\nm4,Z';

      const scenario = importScenarioFromCsv({
        layout: 'single',
        title: 'User 2-Table Single Layout',
        base: {
          csv: baseCsv,
          mapping: { idColumn: 'id', keyColumn: 'join_key', amountColumn: 'price' },
        },
        mid: {
          csv: midCsv,
          mapping: { idColumn: 'mid_id', parentKeyColumn: 'fk' },
        },
      });

      expect(scenario.layout).toBe('single');
      expect(scenario.source).toBe('user_imported');
      expect(scenario.tail).toEqual([]);
      expect(scenario.base).toHaveLength(3);
      expect(scenario.mid).toHaveLength(4);

      // Verify analysis with NULL key behavior
      const audit = await analyze(scenario);
      // a1: key 'X' matches m1, m2 => factor = 2
      // a2: key null matches nothing => factor = 1 (LEFT JOIN keeps base row)
      // a3: key 'Z' matches m4 => factor = 1
      expect(audit.baseRows).toBe(3);
      expect(audit.expandedRows).toBe('4'); // 2 + 1 + 1 = 4
      expect(audit.safeSumCents).toBe('6000'); // 1000 + 2000 + 3000
      expect(audit.naiveSumCents).toBe('7000'); // 1000*2 + 2000*1 + 3000*1
      expect(audit.deltaCents).toBe('1000');
      expect(audit.unsafeBaseRows).toBe(1);

      console.log('[EVIDENCE][MAPPING] 2-table single layout imported and analyzed accurately');
    });

    it('imports 3-table star scenario and reproduces JW-A golden preset results exactly', async () => {
      const baseCsv = `order_id,cust_key,amount
o1,O1,50.00
o2,O2,24.00
o3,O3,12.00`;

      const midCsv = `item_id,order_fk
i11,O1
i12,O1
i21,O2
i22,O2
i23,O2
i31,O3`;

      const tailCsv = `pay_id,order_fk
p11,O1
p12,O1
p21,O2`;

      const scenario = importScenarioFromCsv({
        layout: 'star',
        title: 'Imported JW-A CSV Star Scenario',
        base: {
          csv: baseCsv,
          mapping: { idColumn: 'order_id', keyColumn: 'cust_key', amountColumn: 'amount' },
        },
        mid: {
          csv: midCsv,
          mapping: { idColumn: 'item_id', parentKeyColumn: 'order_fk' },
        },
        tail: {
          csv: tailCsv,
          mapping: { idColumn: 'pay_id', parentKeyColumn: 'order_fk' },
        },
      });

      expect(scenario.layout).toBe('star');
      expect(scenario.base).toHaveLength(3);
      expect(scenario.mid).toHaveLength(6);
      expect(scenario.tail).toHaveLength(3);

      const audit = await analyze(scenario);
      // JW-A 预期: f=[4, 3, 1], expandedRows=8, safe=8600, naive=28400, delta=19800
      expect(audit.expandedRows).toBe('8');
      expect(audit.safeSumCents).toBe('8600');
      expect(audit.naiveSumCents).toBe('28400');
      expect(audit.deltaCents).toBe('19800');
      expect(audit.unsafeBaseRows).toBe(2);

      expect(audit.rows.find((r) => r.id === 'o1')?.factor).toBe('4');
      expect(audit.rows.find((r) => r.id === 'o2')?.factor).toBe('3');
      expect(audit.rows.find((r) => r.id === 'o3')?.factor).toBe('1');

      console.log('[EVIDENCE][MAPPING] Star CSV import fully verified against JW-A golden preset');
    });

    it('imports 3-table chain scenario and reproduces JW-B golden preset results exactly', async () => {
      const baseCsv = `id,key,amount
a1,K1,30.00
a2,K2,7.00`;

      const midCsv = `id,parentKey,linkKey
b1,K1,L1
b2,K1,L2
b3,K2,L3`;

      const tailCsv = `id,parentKey
c1,L1
c2,L1
c3,L2
c4,L2
c5,L2`;

      const scenario = importScenarioFromCsv({
        layout: 'chain',
        title: 'Imported JW-B CSV Chain Scenario',
        base: {
          csv: baseCsv,
          mapping: { idColumn: 'id', keyColumn: 'key', amountColumn: 'amount' },
        },
        mid: {
          csv: midCsv,
          mapping: { idColumn: 'id', parentKeyColumn: 'parentKey', linkKeyColumn: 'linkKey' },
        },
        tail: {
          csv: tailCsv,
          mapping: { idColumn: 'id', parentKeyColumn: 'parentKey' },
        },
      });

      expect(scenario.layout).toBe('chain');
      expect(scenario.mid.every((m) => 'linkKey' in m)).toBe(true);

      const audit = await analyze(scenario);
      // JW-B 预期: f=[5, 1], expandedRows=6, safe=3700, naive=15700, delta=12000
      expect(audit.expandedRows).toBe('6');
      expect(audit.safeSumCents).toBe('3700');
      expect(audit.naiveSumCents).toBe('15700');
      expect(audit.deltaCents).toBe('12000');
      expect(audit.unsafeBaseRows).toBe(1);

      console.log('[EVIDENCE][MAPPING] Chain CSV import fully verified against JW-B golden preset');
    });

    it('requires linkKeyColumn for chain layout, rejecting when missing', () => {
      const baseCsv = 'id,key,amount\na1,K1,10.00';
      const midCsv = 'id,parentKey\nb1,K1';
      const tailCsv = 'id,parentKey\nc1,L1';

      expect(() =>
        importScenarioFromCsv({
          layout: 'chain',
          base: { csv: baseCsv, mapping: { idColumn: 'id', keyColumn: 'key', amountColumn: 'amount' } },
          mid: { csv: midCsv, mapping: { idColumn: 'id', parentKeyColumn: 'parentKey' } },
          tail: { csv: tailCsv, mapping: { idColumn: 'id', parentKeyColumn: 'parentKey' } },
        })
      ).toThrowError(/Chain layout requires mid table mapping to specify linkKeyColumn/);

      console.log('[EVIDENCE][MAPPING] Chain layout missing linkKeyColumn rejected');
    });

    it('safe import returns structured errors on bad input', () => {
      const badBaseCsv = 'id,key,amount\n1,K1,not_a_number';
      const midCsv = 'id,parentKey\n2,K1';

      const res = importScenarioFromCsvSafe({
        layout: 'single',
        base: { csv: badBaseCsv, mapping: { idColumn: 'id', keyColumn: 'key', amountColumn: 'amount' } },
        mid: { csv: midCsv, mapping: { idColumn: 'id', parentKeyColumn: 'parentKey' } },
      });

      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.errors[0]).toMatch(/Base table row 2/);
        expect(res.errors[0]).toMatch(/Invalid amount format/);
        console.log(`[EVIDENCE][MAPPING] Safe import structured error: ${res.errors[0]}`);
      }
    });
  });
});
