/**
 * P008 倍行镜 JoinWitness — JSON 版本化导入导出
 *
 * 遵循项目书 §5.1、§8、FR03、FR11 与实施计划 P008-T009：
 * - 严格 JSON 导入、拒绝未知版本与非法 schema (joinwitness.scenario/v1, specVersion 1.0.0)。
 * - 规范字段顺序、2 空格缩进、LF 换行与末尾换行 (\n)。
 * - 至少 10 次往返字节稳定 (MATH10 确定性)。
 * - 安全文件名 joinwitness-scenario.json。
 * - 单文件最大 5 MiB 限制。
 * - 无数据损失：往返深比较完全等价。
 * - 输入数据不外传、不存入 localStorage。
 */

import type {
  Scenario,
  BaseRow,
  MidRow,
  TailRow,
  ValidationResult,
  ValidationError,
} from '../core/types.js';
import { validateScenario } from '../core/validate.js';

export const SCHEMA_V1 = 'joinwitness.scenario/v1' as const;
export const SPEC_VERSION_V1 = '1.0.0' as const;
export const DEFAULT_SCENARIO_FILENAME = 'joinwitness-scenario.json';
export const SCENARIO_FILENAME = DEFAULT_SCENARIO_FILENAME;

/**
 * JSON 单文件大小上限：5 MiB (5 * 1024 * 1024 字节)
 * 依据项目书 §5.1: "每份 JSON 最大 5 MiB"
 */
export const MAX_JSON_BYTES = 5 * 1024 * 1024;

/**
 * Scenario JSON 错误类，携带 ValidationError 数组
 */
export class ScenarioJsonError extends Error {
  readonly errors: ValidationError[];

  constructor(message: string, errors: ValidationError[] = []) {
    super(message);
    this.name = 'ScenarioJsonError';
    this.errors = errors;
    Object.setPrototypeOf(this, ScenarioJsonError.prototype);
  }
}

/**
 * 计算字符串的 UTF-8 字节长度
 */
export function getUtf8ByteLength(text: string): number {
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(text).length;
  }
  return Buffer.byteLength(text, 'utf8');
}

/**
 * 安全解析 Scenario JSON，返回 ValidationResult，不抛出异常
 */
export function safeParseScenarioJson(text: string): ValidationResult {
  // 1. 检查输入类型与空值
  if (typeof text !== 'string') {
    return {
      ok: false,
      valid: false,
      errors: [
        {
          path: '',
          code: 'INVALID_INPUT_TYPE',
          message: 'Scenario JSON input must be a string',
        },
      ],
    };
  }

  // 2. 检查单文件 5 MiB 字节上限
  const byteLength = getUtf8ByteLength(text);
  if (byteLength > MAX_JSON_BYTES) {
    return {
      ok: false,
      valid: false,
      errors: [
        {
          path: '',
          code: 'FILE_TOO_LARGE',
          message: `Scenario JSON file size (${byteLength} bytes) exceeds maximum limit of 5 MiB (${MAX_JSON_BYTES} bytes)`,
        },
      ],
    };
  }

  // 3. 剥离 UTF-8 BOM (\uFEFF)
  let cleanText = text;
  if (cleanText.charCodeAt(0) === 0xfeff) {
    cleanText = cleanText.slice(1);
  }

  // 4. 解析 JSON 字符串
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleanText);
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      valid: false,
      errors: [
        {
          path: '',
          code: 'INVALID_JSON_SYNTAX',
          message: `Malformed JSON syntax: ${errorMsg}`,
        },
      ],
    };
  }

  // 5. 调用核心校验器进行严格校验 (拒绝未知版本、未知字段、重复 ID、非法金额等)
  return validateScenario(parsed);
}

/**
 * 严格解析 Scenario JSON，返回有效 Scenario 对象；若失败则抛出包含错误明细的 ScenarioJsonError
 */
export function parseScenarioJson(text: string): Scenario {
  const result = safeParseScenarioJson(text);
  if (!result.ok) {
    const errorSummaries = result.errors
      .map((e) => (e.path ? `[${e.code}] at ${e.path}: ${e.message}` : `[${e.code}]: ${e.message}`))
      .join('; ');
    throw new ScenarioJsonError(
      `Scenario JSON validation failed with ${result.errors.length} error(s): ${errorSummaries}`,
      result.errors
    );
  }
  return result.scenario;
}

export interface SerializeScenarioOptions {
  /**
   * 是否在序列化前执行严格模式校验，默认 true
   */
  validate?: boolean;
}

/**
 * 按照规范字段顺序、2 空格缩进、LF 换行与末尾换行序列化 Scenario
 *
 * 规范字段顺序：
 * - 根对象：schema, specVersion, layout, title, source, base, mid, tail
 * - base 行：id, key, amountCents
 * - mid 行：id, parentKey, linkKey (若 linkKey 有定义或为 chain 布局)
 * - tail 行：id, parentKey
 */
export function serializeScenario(
  scenario: Scenario,
  options?: SerializeScenarioOptions
): string {
  // 1. 默认执行严格校验以防止损坏数据或静默损失
  if (options?.validate !== false) {
    const valResult = validateScenario(scenario);
    if (!valResult.ok) {
      const errorSummaries = valResult.errors
        .map((e) => (e.path ? `[${e.code}] at ${e.path}: ${e.message}` : `[${e.code}]: ${e.message}`))
        .join('; ');
      throw new ScenarioJsonError(
        `Cannot serialize invalid Scenario (${valResult.errors.length} error(s)): ${errorSummaries}`,
        valResult.errors
      );
    }
  }

  // 2. 规范字段排序重构对象
  const canonicalBase = scenario.base.map((row: BaseRow) => ({
    id: row.id,
    key: row.key,
    amountCents: row.amountCents,
  }));

  const isChain = scenario.layout === 'chain';
  const canonicalMid = scenario.mid.map((row: MidRow) => {
    const item: Record<string, unknown> = {
      id: row.id,
      parentKey: row.parentKey,
    };
    if (isChain || row.linkKey !== undefined) {
      item.linkKey = row.linkKey ?? null;
    }
    return item;
  });

  const canonicalTail = scenario.tail.map((row: TailRow) => ({
    id: row.id,
    parentKey: row.parentKey,
  }));

  const canonicalScenario = {
    schema: scenario.schema,
    specVersion: scenario.specVersion,
    layout: scenario.layout,
    title: scenario.title,
    source: scenario.source,
    base: canonicalBase,
    mid: canonicalMid,
    tail: canonicalTail,
  };

  // 3. 规范 2 空格缩进与末尾 LF 换行 (\n)
  return JSON.stringify(canonicalScenario, null, 2) + '\n';
}

/**
 * 安全文件名校验与获取
 * 默认使用安全文件名 joinwitness-scenario.json
 */
export function getSafeScenarioFilename(customName?: string): string {
  if (!customName || typeof customName !== 'string') {
    return DEFAULT_SCENARIO_FILENAME;
  }
  const sanitized = customName.replace(/[^A-Za-z0-9._-]/g, '_').trim();
  if (!sanitized) {
    return DEFAULT_SCENARIO_FILENAME;
  }
  if (!sanitized.toLowerCase().endsWith('.json')) {
    return `${sanitized}.json`;
  }
  return sanitized;
}

/**
 * 规范 JSON 序列化 (RFC 8785 兼容确定性规范 JSON)
 *
 * 遵循规范要求（项目书 §8、实施计划 §10、任务卡 FIX-R1-04）：
 * 1. 递归按键字典序排序 (Object keys sorted lexicographically by UTF-16 code units)
 * 2. 数组元素顺序严格保持不变
 * 3. 统一数字/字符串/布尔/null 编码
 * 4. 无多余空白 (无换行、无缩进、无冒号/逗号周围空格)
 * 5. 忽略对象中的 undefined 字段；数组中非有效值转为 null
 */
export function toCanonicalJson(value: unknown): string {
  if (value === null) {
    return 'null';
  }
  const type = typeof value;
  if (type === 'boolean') {
    return value ? 'true' : 'false';
  }
  if (type === 'number') {
    if (!Number.isFinite(value as number)) {
      return 'null';
    }
    return Object.is(value, -0) ? '0' : String(value);
  }
  if (type === 'string') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    const items = value.map((item) =>
      item === undefined || typeof item === 'function' || typeof item === 'symbol'
        ? 'null'
        : toCanonicalJson(item)
    );
    return '[' + items.join(',') + ']';
  }
  if (type === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    const entries: string[] = [];
    for (const key of keys) {
      const v = obj[key];
      if (v === undefined || typeof v === 'function' || typeof v === 'symbol') {
        continue;
      }
      entries.push(JSON.stringify(key) + ':' + toCanonicalJson(v));
    }
    return '{' + entries.join(',') + '}';
  }
  if (type === 'bigint') {
    throw new TypeError('BigInt values cannot be serialized in canonical JSON');
  }
  return '';
}

