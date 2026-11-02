/**
 * P008 倍行镜 JoinWitness — RFC4180 CSV 解析器与金额转分
 *
 * 遵循项目书 §5.1、§8 FR02 与实施计划 P008-T008：
 * - 严格 RFC4180 标准：双引号界定、"" 转义为 "、引号内支持换行 (\r\n, \n)。
 * - 单双引号不混淆：单引号 (') 视为普通文本字符，不具备转义或界定功能。
 * - 支持 UTF-8 BOM (\uFEFF) 自动剥离。
 * - 严格支持空列 (如 "a,,c" -> ["a", "", "c"]) 与末尾空列。
 * - 语法错误明确拒绝并报错行号与列号，严禁静默吞行或截断。
 * - 大小上限控制：单文件最大 2 MiB (2,097,152 字节)，行数上限 5,000 行。
 * - 金额转分 parseAmountToCents：纯 BigInt/字符串整数运算，绝对零浮点数路径。
 */

export const MAX_CSV_BYTES = 2 * 1024 * 1024; // 2 MiB
export const MAX_TABLE_ROWS = 5000;
export const MAX_AMOUNT_CENTS = 100_000_000n; // 10^8 分 = 1,000,000.00 元

export class CsvParseError extends Error {
  readonly line: number;
  readonly column: number;

  constructor(message: string, line: number, column: number) {
    super(`CSV Parse Error [line ${line}, col ${column}]: ${message}`);
    this.name = 'CsvParseError';
    this.line = line;
    this.column = column;
    Object.setPrototypeOf(this, CsvParseError.prototype);
  }
}

export interface CsvParseOptions {
  delimiter?: string;
  maxBytes?: number;
  maxRows?: number;
  skipEmptyLines?: boolean;
}

export interface CsvParseResult {
  headers: string[];
  rows: string[][];
  totalRows: number;
}

/**
 * 将原始 CSV 字符串解析为二维行数组 string[][]
 * 严格按照 RFC4180 状态机解析
 */
export function parseCsvRows(input: string, options?: CsvParseOptions): string[][] {
  const delimiter = options?.delimiter ?? ',';
  const maxBytes = options?.maxBytes ?? MAX_CSV_BYTES;
  const skipEmptyLines = options?.skipEmptyLines ?? true;

  if (delimiter.length !== 1) {
    throw new Error(`CSV delimiter must be a single character, got "${delimiter}"`);
  }

  // 1. 检查 UTF-8 BOM (\uFEFF)
  let text = input;
  if (text.charCodeAt(0) === 0xFEFF) {
    text = text.slice(1);
  }

  // 2. 检查文件大小上限 (2 MiB)
  const byteLength = new TextEncoder().encode(text).length;
  if (byteLength > maxBytes) {
    throw new CsvParseError(
      `CSV input size (${byteLength} bytes) exceeds maximum limit of ${maxBytes} bytes (2 MiB)`,
      1,
      1
    );
  }

  if (text.length === 0) {
    return [];
  }

  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentField = '';

  let line = 1;
  let col = 1;
  let fieldStartLine = 1;
  let fieldStartCol = 1;

  // 状态机状态:
  // 0: FIELD_START (字段起始)
  // 1: UNQUOTED (非引号字段内容)
  // 2: QUOTED (双引号内)
  // 3: QUOTED_END (双引号已闭合，等待分隔符或换行)
  const S_FIELD_START = 0;
  const S_UNQUOTED = 1;
  const S_QUOTED = 2;
  const S_QUOTED_END = 3;

  let state = S_FIELD_START;
  const len = text.length;
  let i = 0;

  while (i < len) {
    const ch = text[i]!;

    if (state === S_FIELD_START) {
      fieldStartLine = line;
      fieldStartCol = col;

      if (ch === '"') {
        state = S_QUOTED;
        i++;
        col++;
        continue;
      }

      if (ch === delimiter) {
        currentRow.push('');
        currentField = '';
        state = S_FIELD_START;
        i++;
        col++;
        continue;
      }

      if (ch === '\r') {
        if (i + 1 < len && text[i + 1] === '\n') {
          i++;
        }
        if (currentRow.length > 0) {
          currentRow.push('');
          rows.push(currentRow);
          currentRow = [];
        } else if (!skipEmptyLines) {
          rows.push(['']);
        }
        line++;
        col = 1;
        state = S_FIELD_START;
        i++;
        continue;
      }

      if (ch === '\n') {
        if (currentRow.length > 0) {
          currentRow.push('');
          rows.push(currentRow);
          currentRow = [];
        } else if (!skipEmptyLines) {
          rows.push(['']);
        }
        line++;
        col = 1;
        state = S_FIELD_START;
        i++;
        continue;
      }

      // 普通字符（包含单引号 '、空格、其他文本）
      currentField += ch;
      state = S_UNQUOTED;
      i++;
      col++;
      continue;
    }

    if (state === S_UNQUOTED) {
      if (ch === delimiter) {
        currentRow.push(currentField);
        currentField = '';
        state = S_FIELD_START;
        i++;
        col++;
        continue;
      }

      if (ch === '\r') {
        if (i + 1 < len && text[i + 1] === '\n') {
          i++;
        }
        currentRow.push(currentField);
        rows.push(currentRow);
        currentRow = [];
        currentField = '';
        state = S_FIELD_START;
        line++;
        col = 1;
        i++;
        continue;
      }

      if (ch === '\n') {
        currentRow.push(currentField);
        rows.push(currentRow);
        currentRow = [];
        currentField = '';
        state = S_FIELD_START;
        line++;
        col = 1;
        i++;
        continue;
      }

      if (ch === '"') {
        throw new CsvParseError(
          `Unescaped double quote inside unquoted field. Quotes must enclose the entire field, and literal quotes must be escaped as double-quotes ("").`,
          line,
          col
        );
      }

      currentField += ch;
      i++;
      col++;
      continue;
    }

    if (state === S_QUOTED) {
      if (ch === '"') {
        // 判断是否为转义双引号 ""
        if (i + 1 < len && text[i + 1] === '"') {
          currentField += '"';
          i += 2;
          col += 2;
          continue;
        } else {
          // 引号闭合
          state = S_QUOTED_END;
          i++;
          col++;
          continue;
        }
      }

      if (ch === '\r') {
        if (i + 1 < len && text[i + 1] === '\n') {
          i++;
        }
        currentField += '\n'; // 引号内换行统一标准化为 \n
        line++;
        col = 1;
        i++;
        continue;
      }

      if (ch === '\n') {
        currentField += '\n';
        line++;
        col = 1;
        i++;
        continue;
      }

      currentField += ch;
      i++;
      col++;
      continue;
    }

    if (state === S_QUOTED_END) {
      if (ch === delimiter) {
        currentRow.push(currentField);
        currentField = '';
        state = S_FIELD_START;
        i++;
        col++;
        continue;
      }

      if (ch === '\r') {
        if (i + 1 < len && text[i + 1] === '\n') {
          i++;
        }
        currentRow.push(currentField);
        rows.push(currentRow);
        currentRow = [];
        currentField = '';
        state = S_FIELD_START;
        line++;
        col = 1;
        i++;
        continue;
      }

      if (ch === '\n') {
        currentRow.push(currentField);
        rows.push(currentRow);
        currentRow = [];
        currentField = '';
        state = S_FIELD_START;
        line++;
        col = 1;
        i++;
        continue;
      }

      throw new CsvParseError(
        `Unexpected character ${JSON.stringify(ch)} after closing quote. Delimiter "${delimiter}" or line break expected.`,
        line,
        col
      );
    }
  }

  // 结尾处理
  if (state === S_QUOTED) {
    throw new CsvParseError(
      `Unclosed quote at end of CSV input. Quoted field started at line ${fieldStartLine}, col ${fieldStartCol}.`,
      fieldStartLine,
      fieldStartCol
    );
  }

  if (state === S_QUOTED_END || state === S_UNQUOTED) {
    currentRow.push(currentField);
    rows.push(currentRow);
  } else if (state === S_FIELD_START) {
    if (currentRow.length > 0) {
      // 尾部逗号产生的空列
      currentRow.push('');
      rows.push(currentRow);
    }
  }

  return rows;
}

/**
 * 解析带表头的完整 CSV
 */
export function parseCsv(input: string, options?: CsvParseOptions): CsvParseResult {
  const allRows = parseCsvRows(input, options);

  if (allRows.length === 0) {
    return {
      headers: [],
      rows: [],
      totalRows: 0,
    };
  }

  const headers = allRows[0]!;
  const dataRows = allRows.slice(1);

  const maxRows = options?.maxRows ?? MAX_TABLE_ROWS;
  if (dataRows.length > maxRows) {
    throw new CsvParseError(
      `CSV data rows count (${dataRows.length}) exceeds maximum allowed limit of ${maxRows} rows`,
      dataRows.length + 1,
      1
    );
  }

  return {
    headers,
    rows: dataRows,
    totalRows: dataRows.length,
  };
}

/**
 * 安全解析包装（不抛异常，返回 Result 联合类型）
 */
export function safeParseCsv(
  input: string,
  options?: CsvParseOptions
): { ok: true; data: CsvParseResult } | { ok: false; error: CsvParseError } {
  try {
    const data = parseCsv(input, options);
    return { ok: true, data };
  } catch (err) {
    if (err instanceof CsvParseError) {
      return { ok: false, error: err };
    }
    return {
      ok: false,
      error: new CsvParseError(err instanceof Error ? err.message : String(err), 1, 1),
    };
  }
}

/**
 * 金额从两位小数纯字符串转分（BigInt 整数运算，严禁浮点数）
 *
 * 规范：
 * - 格式为元，最多 2 位小数，如 "1200", "12.34", "-1234.56", "0", "0.00"
 * - 绝对禁止出现浮点数计算（无 parseFloat / Number() / Math.round）
 * - 拒绝负零 ("-0", "-0.0", "-0.00")
 * - 拒绝非数字、千分位逗号、货币符号或 >2 位小数
 * - 绝对值上限 100,000,000 分 (1,000,000.00 元)
 */
export function parseAmountToCents(raw: string): string {
  if (typeof raw !== 'string') {
    throw new Error(`Amount must be a string, got ${typeof raw}`);
  }

  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw new Error('Amount cannot be empty');
  }

  // 严格正则：可选符号 [+-]，整数部分 (0 或以 1-9 开头的数字串)，可选最多 2 位小数
  const match = trimmed.match(/^([+-])?(0|[1-9]\d*)(\.\d{1,2})?$/);
  if (!match) {
    throw new Error(
      `Invalid amount format: "${raw}". Amount must be a valid number with at most 2 decimal places and without symbols/commas.`
    );
  }

  const sign = match[1] ?? '';
  const intStr = match[2]!;
  const fracRaw = match[3];

  let fracStr = '00';
  if (fracRaw) {
    const digits = fracRaw.slice(1);
    if (digits.length === 1) {
      fracStr = digits + '0';
    } else if (digits.length === 2) {
      fracStr = digits;
    }
  }

  // 纯 BigInt 整数计算转为分
  const centsBigInt = BigInt(intStr) * 100n + BigInt(fracStr);

  if (centsBigInt === 0n) {
    if (sign === '-') {
      throw new Error(`Negative zero amount "${raw}" is not allowed`);
    }
    return '0';
  }

  if (centsBigInt > MAX_AMOUNT_CENTS) {
    throw new Error(
      `Amount "${raw}" exceeds maximum allowed value of 1,000,000.00 (100,000,000 cents)`
    );
  }

  return sign === '-' ? `-${centsBigInt.toString()}` : centsBigInt.toString();
}

/**
 * 将分格式化回两位小数字符串显示（纯字符串操作，无浮点数）
 * 如 "1234" -> "12.34", "0" -> "0.00", "-5" -> "-0.05"
 */
export function formatCentsToAmount(cents: string): string {
  if (typeof cents !== 'string' || !/^-?(0|[1-9]\d*)$/.test(cents) || cents === '-0') {
    throw new Error(`Invalid cents integer string: "${cents}"`);
  }

  const isNeg = cents.startsWith('-');
  const absStr = isNeg ? cents.slice(1) : cents;

  const padded = absStr.padStart(3, '0');
  const intPart = padded.slice(0, -2);
  const fracPart = padded.slice(-2);

  return `${isNeg ? '-' : ''}${intPart}.${fracPart}`;
}
