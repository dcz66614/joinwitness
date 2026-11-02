import type { Scenario, BaseRow, RowAudit } from './types.js';
import { computeFactors, type FactorResult, type BaseFactorAudit } from './factor.js';

export interface AmountAuditResult {
  safeSumCents: string;
  naiveSumCents: string;
  deltaCents: string;
  unsafeBaseRows: number;
  deltaRatio: string;
  rows: RowAudit[];
  rawRows: RowAudit[];
}

/**
 * 计算绝对值（BigInt 版，严禁浮点数）
 */
function bigIntAbs(val: bigint): bigint {
  return val < 0n ? -val : val;
}

/**
 * 比较两行 RowAudit 的差额重要性
 * 排序合同（项目书 §5.1、实施计划 P008-T004）：
 * 1. 按绝对差额 (|deltaCents|) 降序排列（误差最大的行优先展示）。
 * 2. 绝对差额相同时，按稳定 ID 升序破平局（UTF-8 字节序 / 标量代码点序）。
 */
export function compareRowAuditDiscrepancy(a: RowAudit, b: RowAudit): number {
  const deltaA = BigInt(a.deltaCents);
  const deltaB = BigInt(b.deltaCents);

  const absA = bigIntAbs(deltaA);
  const absB = bigIntAbs(deltaB);

  if (absA > absB) {
    return -1;
  }
  if (absA < absB) {
    return 1;
  }

  // 绝对差额相同，使用 ID 升序破平局
  if (a.id < b.id) {
    return -1;
  }
  if (a.id > b.id) {
    return 1;
  }
  return 0;
}

/**
 * 对 RowAudit 数组进行稳定差额排序
 */
export function sortRowAudits(rows: RowAudit[]): RowAudit[] {
  return [...rows].sort(compareRowAuditDiscrepancy);
}

/**
 * 零分母保护与百分比格式化（项目书 §6.1、§9.3 U04）
 *
 * 核心数学约束：
 * - 若 S_safe = 0，比例无良定义，必须返回 'N/A'，不能输出 NaN、Infinity 或抛错。
 * - 严禁使用任何 JavaScript Number 浮点运算，全过程纯 BigInt 整数四舍五入。
 * - decimals: 保留的小数位数，默认 2 位（四舍五入）。
 */
export function formatDeltaPercentage(
  safeSumCents: string | bigint,
  deltaCents: string | bigint,
  decimals: number = 2
): string {
  const safe = typeof safeSumCents === 'bigint' ? safeSumCents : BigInt(safeSumCents);
  const delta = typeof deltaCents === 'bigint' ? deltaCents : BigInt(deltaCents);

  if (safe === 0n) {
    return 'N/A';
  }

  if (delta === 0n) {
    return decimals > 0 ? `0.${'0'.repeat(decimals)}%` : '0%';
  }

  const isNegative = (delta < 0n) !== (safe < 0n);
  const absDelta = bigIntAbs(delta);
  const absSafe = bigIntAbs(safe);

  // 百分比为 (absDelta * 100) / absSafe
  // 需要保留 decimals 位小数，因此乘以 10^(decimals + 2)
  const dec = BigInt(Math.max(0, decimals));
  let scale = 1n;
  for (let i = 0n; i < dec + 2n; i++) {
    scale *= 10n;
  }

  const scaledNumerator = absDelta * scale;
  let quotient = scaledNumerator / absSafe;
  const remainder = scaledNumerator % absSafe;

  // 四舍五入（half-up）：如果余数 * 2 >= 除数，则商进位 1
  if (remainder * 2n >= absSafe) {
    quotient += 1n;
  }

  if (decimals === 0) {
    const signPrefix = isNegative ? '-' : '+';
    return `${signPrefix}${quotient.toString()}%`;
  }

  let divisor = 1n;
  for (let i = 0n; i < dec; i++) {
    divisor *= 10n;
  }

  const intPart = quotient / divisor;
  const fracPart = quotient % divisor;
  const fracString = fracPart.toString().padStart(decimals, '0');

  const signPrefix = isNegative ? '-' : '+';
  return `${signPrefix}${intPart.toString()}.${fracString}%`;
}

/**
 * 计算差额比率（零分母返回 'N/A'）
 */
export function calculateDeltaRatio(
  safeSumCents: string | bigint,
  deltaCents: string | bigint
): string {
  return formatDeltaPercentage(safeSumCents, deltaCents, 2);
}

/**
 * P008 倍行镜 JoinWitness — BigInt 金额归因与排序
 *
 * 核心数学约束（项目书 §6.1）：
 * - S_safe = Σ_i v_i
 * - S_naive = Σ_i (v_i * f_i)
 * - Δ = S_naive - S_safe = Σ_i (v_i * (f_i - 1))
 * - 每条 A 行:
 *     naiveContributionCents = (v_i * f_i).toString()
 *     deltaCents = (v_i * (f_i - 1)).toString()
 * - unsafeBaseRows: 满足 f_i > 1 的基表行数量（结构倍增风险判断）
 * - 所有乘除及累加使用 BigInt，绝对禁止浮点数计金额。
 * - 结果 rows 默认按绝对差额降序、稳定 ID 升序破平局排列。
 */
export function computeAmountAudit(
  scenario: Scenario,
  factorResult?: FactorResult
): AmountAuditResult {
  const factors = factorResult ?? computeFactors(scenario);
  const base = scenario.base;

  if (base.length !== factors.rows.length) {
    throw new Error(
      `Factor rows count (${factors.rows.length}) does not match base rows count (${base.length})`
    );
  }

  let safeSum = 0n;
  let naiveSum = 0n;
  let deltaSum = 0n;
  let unsafeBaseRows = 0;

  const rawRows: RowAudit[] = new Array(base.length);

  for (let i = 0; i < base.length; i++) {
    const aRow = base[i]!;
    const factorRow = factors.rows[i]!;

    if (aRow.id !== factorRow.id) {
      throw new Error(
        `Row ID mismatch at index ${i}: base.id=${aRow.id}, factor.id=${factorRow.id}`
      );
    }

    const amount = BigInt(aRow.amountCents);
    const factor = factorRow.factor;

    const naiveContribution = amount * factor;
    const delta = amount * (factor - 1n);

    safeSum += amount;
    naiveSum += naiveContribution;
    deltaSum += delta;

    if (factor > 1n) {
      unsafeBaseRows++;
    }

    rawRows[i] = {
      id: aRow.id,
      factor: factorRow.factorString,
      amountCents: aRow.amountCents,
      naiveContributionCents: naiveContribution.toString(),
      deltaCents: delta.toString(),
      branch1Count: factorRow.branch1Count,
      branch2Count: factorRow.branch2Count,
    };
  }

  const safeSumCents = safeSum.toString();
  const naiveSumCents = naiveSum.toString();
  const deltaCents = deltaSum.toString();
  const deltaRatio = calculateDeltaRatio(safeSum, deltaSum);

  const sortedRows = sortRowAudits(rawRows);

  return {
    safeSumCents,
    naiveSumCents,
    deltaCents,
    unsafeBaseRows,
    deltaRatio,
    rows: sortedRows,
    rawRows,
  };
}

export const computeAmounts = computeAmountAudit;
