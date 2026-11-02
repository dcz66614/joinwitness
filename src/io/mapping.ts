/**
 * P008 倍行镜 JoinWitness — CSV 列映射与 Scenario 组装
 *
 * 遵循项目书 §5.1、§8 FR02 与实施计划 P008-T008：
 * - 支持 2 表 (single) 或 3 表 (star, chain) CSV 映射导入。
 * - 用户可选配置：主键列 (id)、关联列 (key / parentKey / linkKey)、金额列 (amount)。
 * - 空字符串映射为 null；非空键严禁自动 trim，原样保持。
 * - 行顺序严格按原文件行序保持。
 * - ID 格式验证 (^[A-Za-z0-9._-]{1,64}$)，表内唯一性检查。
 * - 金额转分通过 parseAmountToCents 纯 BigInt 处理，无浮点路径。
 * - 最终组装产物通过 validateScenario 严格验证，保证 100% 契约成立。
 */

import type {
  Scenario,
  Layout,
  BaseRow,
  MidRow,
  TailRow,
  ValidationResult,
} from '../core/types.js';
import { validateScenario } from '../core/validate.js';
import {
  parseCsv,
  parseAmountToCents,
  type CsvParseResult,
  type CsvParseOptions,
} from './csv.js';

export { parseAmountToCents, formatCentsToAmount } from './csv.js';

const ID_REGEX = /^[A-Za-z0-9._-]{1,64}$/;
const MAX_KEY_LENGTH = 256;
const MAX_ROWS = 5000;

export class CsvMappingError extends Error {
  readonly table: string | undefined;
  readonly row: number | undefined;
  readonly column: string | undefined;
  readonly code: string;

  constructor(
    message: string,
    options?: {
      table?: string | undefined;
      row?: number | undefined;
      column?: string | undefined;
      code?: string | undefined;
    }
  ) {
    super(message);
    this.name = 'CsvMappingError';
    this.table = options?.table;
    this.row = options?.row;
    this.column = options?.column;
    this.code = options?.code ?? 'MAPPING_ERROR';
    Object.setPrototypeOf(this, CsvMappingError.prototype);
  }
}

export interface BaseColumnMapping {
  idColumn: string;
  keyColumn: string;
  amountColumn: string;
}

export interface MidColumnMapping {
  idColumn: string;
  parentKeyColumn: string;
  linkKeyColumn?: string; // chain 布局必填
}

export interface TailColumnMapping {
  idColumn: string;
  parentKeyColumn: string;
}

export type CsvTableData = string | CsvParseResult;

export interface CsvScenarioImportConfig {
  layout: Layout;
  title?: string;
  base: {
    csv: CsvTableData;
    mapping: BaseColumnMapping;
  };
  mid: {
    csv: CsvTableData;
    mapping: MidColumnMapping;
  };
  tail?: {
    csv: CsvTableData;
    mapping: TailColumnMapping;
  };
  options?: CsvParseOptions;
}

function resolveCsvTable(data: CsvTableData, options?: CsvParseOptions): CsvParseResult {
  if (typeof data === 'string') {
    return parseCsv(data, options);
  }
  return data;
}

function findColumnIndex(headers: string[], colName: string, tableName: string, role: string): number {
  const idx = headers.indexOf(colName);
  if (idx === -1) {
    throw new CsvMappingError(
      `Table "${tableName}": ${role} column "${colName}" not found in CSV headers [${headers.map((h) => JSON.stringify(h)).join(', ')}]`,
      { table: tableName, column: colName, code: 'COLUMN_NOT_FOUND' }
    );
  }
  return idx;
}

/**
 * 映射 Base 表行数据
 */
export function mapBaseTable(
  data: CsvTableData,
  mapping: BaseColumnMapping,
  options?: CsvParseOptions
): BaseRow[] {
  const table = resolveCsvTable(data, options);
  const { headers, rows } = table;

  const idIdx = findColumnIndex(headers, mapping.idColumn, 'base', 'Primary key (id)');
  const keyIdx = findColumnIndex(headers, mapping.keyColumn, 'base', 'Join key (key)');
  const amountIdx = findColumnIndex(headers, mapping.amountColumn, 'base', 'Amount (amount)');

  if (rows.length < 1) {
    throw new CsvMappingError(
      'Base table must contain at least 1 data row, got 0',
      { table: 'base', code: 'ROW_COUNT_OUT_OF_BOUNDS' }
    );
  }

  if (rows.length > MAX_ROWS) {
    throw new CsvMappingError(
      `Base table row count (${rows.length}) exceeds maximum allowed limit of ${MAX_ROWS}`,
      { table: 'base', code: 'ROW_COUNT_OUT_OF_BOUNDS' }
    );
  }

  const seenIds = new Set<string>();
  const baseRows: BaseRow[] = new Array(rows.length);

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const rowNum = i + 2; // 表头为第 1 行

    // 1. 验证 ID
    const rawId = row[idIdx] ?? '';
    if (!ID_REGEX.test(rawId)) {
      throw new CsvMappingError(
        `Base table row ${rowNum}: Invalid ID format "${rawId}" in column "${mapping.idColumn}". Must match ^[A-Za-z0-9._-]{1,64}$`,
        { table: 'base', row: rowNum, column: mapping.idColumn, code: 'INVALID_ID_FORMAT' }
      );
    }
    if (seenIds.has(rawId)) {
      throw new CsvMappingError(
        `Base table row ${rowNum}: Duplicate ID "${rawId}" found in Base table`,
        { table: 'base', row: rowNum, column: mapping.idColumn, code: 'DUPLICATE_ID' }
      );
    }
    seenIds.add(rawId);

    // 2. 验证 Key（空字符串转为 null；非空字符串绝不 trim；限制最大长度 256）
    const rawKey = row[keyIdx] ?? '';
    let key: string | null = null;
    if (rawKey !== '') {
      if (rawKey.length > MAX_KEY_LENGTH) {
        throw new CsvMappingError(
          `Base table row ${rowNum}: Key length (${rawKey.length}) exceeds maximum limit of ${MAX_KEY_LENGTH} in column "${mapping.keyColumn}"`,
          { table: 'base', row: rowNum, column: mapping.keyColumn, code: 'KEY_TOO_LONG' }
        );
      }
      key = rawKey;
    }

    // 3. 验证 Amount（转分，纯 BigInt，无浮点路径）
    const rawAmount = row[amountIdx] ?? '';
    let amountCents: string;
    try {
      amountCents = parseAmountToCents(rawAmount);
    } catch (err) {
      throw new CsvMappingError(
        `Base table row ${rowNum}: ${err instanceof Error ? err.message : String(err)} in column "${mapping.amountColumn}"`,
        { table: 'base', row: rowNum, column: mapping.amountColumn, code: 'INVALID_AMOUNT' }
      );
    }

    baseRows[i] = {
      id: rawId,
      key,
      amountCents,
    };
  }

  return baseRows;
}

/**
 * 映射 Mid 表行数据
 */
export function mapMidTable(
  data: CsvTableData,
  mapping: MidColumnMapping,
  layout: Layout,
  options?: CsvParseOptions
): MidRow[] {
  const table = resolveCsvTable(data, options);
  const { headers, rows } = table;

  const idIdx = findColumnIndex(headers, mapping.idColumn, 'mid', 'Primary key (id)');
  const parentKeyIdx = findColumnIndex(headers, mapping.parentKeyColumn, 'mid', 'Parent join key (parentKey)');

  let linkKeyIdx: number | null = null;
  if (layout === 'chain') {
    if (!mapping.linkKeyColumn) {
      throw new CsvMappingError(
        'Chain layout requires mid table mapping to specify linkKeyColumn',
        { table: 'mid', code: 'MISSING_LINK_KEY_COLUMN' }
      );
    }
    linkKeyIdx = findColumnIndex(headers, mapping.linkKeyColumn, 'mid', 'Link key (linkKey)');
  } else if (mapping.linkKeyColumn) {
    linkKeyIdx = findColumnIndex(headers, mapping.linkKeyColumn, 'mid', 'Link key (linkKey)');
  }

  if (rows.length > MAX_ROWS) {
    throw new CsvMappingError(
      `Mid table row count (${rows.length}) exceeds maximum allowed limit of ${MAX_ROWS}`,
      { table: 'mid', code: 'ROW_COUNT_OUT_OF_BOUNDS' }
    );
  }

  const seenIds = new Set<string>();
  const midRows: MidRow[] = new Array(rows.length);

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const rowNum = i + 2;

    const rawId = row[idIdx] ?? '';
    if (!ID_REGEX.test(rawId)) {
      throw new CsvMappingError(
        `Mid table row ${rowNum}: Invalid ID format "${rawId}" in column "${mapping.idColumn}". Must match ^[A-Za-z0-9._-]{1,64}$`,
        { table: 'mid', row: rowNum, column: mapping.idColumn, code: 'INVALID_ID_FORMAT' }
      );
    }
    if (seenIds.has(rawId)) {
      throw new CsvMappingError(
        `Mid table row ${rowNum}: Duplicate ID "${rawId}" found in Mid table`,
        { table: 'mid', row: rowNum, column: mapping.idColumn, code: 'DUPLICATE_ID' }
      );
    }
    seenIds.add(rawId);

    const rawParentKey = row[parentKeyIdx] ?? '';
    let parentKey: string | null = null;
    if (rawParentKey !== '') {
      if (rawParentKey.length > MAX_KEY_LENGTH) {
        throw new CsvMappingError(
          `Mid table row ${rowNum}: ParentKey length exceeds maximum limit of ${MAX_KEY_LENGTH}`,
          { table: 'mid', row: rowNum, column: mapping.parentKeyColumn, code: 'KEY_TOO_LONG' }
        );
      }
      parentKey = rawParentKey;
    }

    if (layout === 'chain') {
      const rawLinkKey = linkKeyIdx !== null ? (row[linkKeyIdx] ?? '') : '';
      let linkKey: string | null = null;
      if (rawLinkKey !== '') {
        if (rawLinkKey.length > MAX_KEY_LENGTH) {
          throw new CsvMappingError(
            `Mid table row ${rowNum}: LinkKey length exceeds maximum limit of ${MAX_KEY_LENGTH}`,
            { table: 'mid', row: rowNum, column: mapping.linkKeyColumn, code: 'KEY_TOO_LONG' }
          );
        }
        linkKey = rawLinkKey;
      }
      midRows[i] = {
        id: rawId,
        parentKey,
        linkKey,
      };
    } else if (linkKeyIdx !== null) {
      const rawLinkKey = row[linkKeyIdx] ?? '';
      let linkKey: string | null = null;
      if (rawLinkKey !== '') {
        if (rawLinkKey.length > MAX_KEY_LENGTH) {
          throw new CsvMappingError(
            `Mid table row ${rowNum}: LinkKey length exceeds maximum limit of ${MAX_KEY_LENGTH}`,
            { table: 'mid', row: rowNum, column: mapping.linkKeyColumn, code: 'KEY_TOO_LONG' }
          );
        }
        linkKey = rawLinkKey;
      }
      midRows[i] = {
        id: rawId,
        parentKey,
        linkKey,
      };
    } else {
      midRows[i] = {
        id: rawId,
        parentKey,
      };
    }
  }

  return midRows;
}

/**
 * 映射 Tail 表行数据
 */
export function mapTailTable(
  data: CsvTableData,
  mapping: TailColumnMapping,
  options?: CsvParseOptions
): TailRow[] {
  const table = resolveCsvTable(data, options);
  const { headers, rows } = table;

  const idIdx = findColumnIndex(headers, mapping.idColumn, 'tail', 'Primary key (id)');
  const parentKeyIdx = findColumnIndex(headers, mapping.parentKeyColumn, 'tail', 'Parent join key (parentKey)');

  if (rows.length > MAX_ROWS) {
    throw new CsvMappingError(
      `Tail table row count (${rows.length}) exceeds maximum allowed limit of ${MAX_ROWS}`,
      { table: 'tail', code: 'ROW_COUNT_OUT_OF_BOUNDS' }
    );
  }

  const seenIds = new Set<string>();
  const tailRows: TailRow[] = new Array(rows.length);

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const rowNum = i + 2;

    const rawId = row[idIdx] ?? '';
    if (!ID_REGEX.test(rawId)) {
      throw new CsvMappingError(
        `Tail table row ${rowNum}: Invalid ID format "${rawId}" in column "${mapping.idColumn}". Must match ^[A-Za-z0-9._-]{1,64}$`,
        { table: 'tail', row: rowNum, column: mapping.idColumn, code: 'INVALID_ID_FORMAT' }
      );
    }
    if (seenIds.has(rawId)) {
      throw new CsvMappingError(
        `Tail table row ${rowNum}: Duplicate ID "${rawId}" found in Tail table`,
        { table: 'tail', row: rowNum, column: mapping.idColumn, code: 'DUPLICATE_ID' }
      );
    }
    seenIds.add(rawId);

    const rawParentKey = row[parentKeyIdx] ?? '';
    let parentKey: string | null = null;
    if (rawParentKey !== '') {
      if (rawParentKey.length > MAX_KEY_LENGTH) {
        throw new CsvMappingError(
          `Tail table row ${rowNum}: ParentKey length exceeds maximum limit of ${MAX_KEY_LENGTH}`,
          { table: 'tail', row: rowNum, column: mapping.parentKeyColumn, code: 'KEY_TOO_LONG' }
        );
      }
      parentKey = rawParentKey;
    }

    tailRows[i] = {
      id: rawId,
      parentKey,
    };
  }

  return tailRows;
}

/**
 * 完整组装 Scenario（UI 主要调用契约）
 */
export function importScenarioFromCsv(config: CsvScenarioImportConfig): Scenario {
  const { layout, title, base, mid, tail, options } = config;

  if (layout !== 'single' && layout !== 'star' && layout !== 'chain') {
    throw new CsvMappingError(`Invalid layout: ${layout}. Must be "single", "star", or "chain"`, {
      code: 'INVALID_LAYOUT',
    });
  }

  // 1. 映射 Base 表
  const baseRows = mapBaseTable(base.csv, base.mapping, options);

  // 2. 映射 Mid 表
  const midRows = mapMidTable(mid.csv, mid.mapping, layout, options);

  // 3. 映射 Tail 表
  let tailRows: TailRow[] = [];
  if (layout === 'single') {
    if (tail && typeof tail.csv === 'string' && tail.csv.trim().length > 0) {
      throw new CsvMappingError('Layout "single" requires tail table to be empty', {
        table: 'tail',
        code: 'INVALID_LAYOUT_TAIL',
      });
    }
    tailRows = [];
  } else {
    if (!tail) {
      throw new CsvMappingError(`Layout "${layout}" requires a tail table`, {
        table: 'tail',
        code: 'MISSING_TAIL_TABLE',
      });
    }
    tailRows = mapTailTable(tail.csv, tail.mapping, options);
  }

  const scenario: Scenario = {
    schema: 'joinwitness.scenario/v1',
    specVersion: '1.0.0',
    layout,
    title: title && title.trim().length > 0 ? title.trim() : 'User Imported Scenario',
    source: 'user_imported',
    base: baseRows,
    mid: midRows,
    tail: tailRows,
  };

  // 4. 运行 T002 的 validateScenario 终审校验
  const validation: ValidationResult = validateScenario(scenario);
  if (!validation.ok) {
    const errorDetails = validation.errors.map((e) => `[${e.code}] ${e.path}: ${e.message}`).join('; ');
    throw new CsvMappingError(`Scenario validation failed: ${errorDetails}`, {
      code: 'VALIDATION_FAILED',
    });
  }

  return scenario;
}

/**
 * 安全组装 Scenario（返回 Result 联合类型）
 */
export function importScenarioFromCsvSafe(
  config: CsvScenarioImportConfig
): { ok: true; scenario: Scenario } | { ok: false; errors: string[] } {
  try {
    const scenario = importScenarioFromCsv(config);
    return { ok: true, scenario };
  } catch (err) {
    return {
      ok: false,
      errors: [err instanceof Error ? err.message : String(err)],
    };
  }
}
