/**
 * T006 独立枚举 oracle — bruteforce.ts
 *
 * 独立性声明：本文件不导入任何生产辅助函数（factor.ts / amount.ts / witness.ts）。
 * 所有算法均依据标准关系代数 LEFT JOIN 逐步物化生成小规模 JOIN 元组集合，
 * 并直接从物化行集合数因子、总额、差额与见证最小性，与生产实现完全独立。
 * 严禁调用生产逻辑，严禁复用生产公式（star 乘积、chain 求和公式）。
 */

import type {
  BaseRow,
  MidRow,
  TailRow,
  Scenario,
} from '../../src/core/types.js';

// ─────────────────────────────────────────────────────────────────────────────
// 数据结构：物化元组与 oracle 输出
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 物化的单条完整 JOIN 结果元组（基行 × 中行 × 尾行）
 */
export interface JoinedRow {
  base: BaseRow;
  mid: MidRow | null;
  tail: TailRow | null;
}

/**
 * oracle 对单条基表行的分析结果。
 */
export interface OracleRowResult {
  /** 基表行 id */
  id: string;
  /** 倍增因子（整数，字符串表示） */
  factor: string;
  /** 金额（整数分，字符串表示） */
  amountCents: string;
  /** 朴素贡献 = amountCents × factor */
  naiveContributionCents: string;
  /** 差额 = naiveContributionCents - amountCents */
  deltaCents: string;
  /** 第一跳匹配数（B匹配或star B匹配） */
  branch1Count: number;
  /** 第二跳匹配数（star: C匹配 per key; chain: 通过各B匹配的C总数） */
  branch2Count: number;
}

/**
 * oracle 对整个场景的分析结果。
 */
export interface OracleResult {
  /** 基表行数 */
  baseRows: number;
  /** JOIN 后总行数（字符串，可超 Number.MAX_SAFE_INTEGER） */
  expandedRows: string;
  /** 安全总金额（字符串） */
  safeSumCents: string;
  /** 朴素总金额（字符串） */
  naiveSumCents: string;
  /** 总差额（字符串） */
  deltaCents: string;
  /** 存在倍行（factor>1）的基表行数 */
  unsafeBaseRows: number;
  /** 各行详情 */
  rows: OracleRowResult[];
}

// ─────────────────────────────────────────────────────────────────────────────
// 核心：关系型 LEFT JOIN 逐步物化（真正的小规模 JOIN 元组物化枚举）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 基础关系型 LEFT JOIN 操作符。
 * 对 left 的每个元组，在 right 中查找所有满足 predicate 的行；
 * 若无匹配，则保留 left 元组，right 补 null。
 */
function leftJoinStep<L, R>(
  left: readonly L[],
  right: readonly R[],
  predicate: (l: L, r: R) => boolean,
): { left: L; right: R | null }[] {
  const result: { left: L; right: R | null }[] = [];
  for (const l of left) {
    const matched = right.filter((r) => predicate(l, r));
    if (matched.length === 0) {
      result.push({ left: l, right: null });
    } else {
      for (const m of matched) {
        result.push({ left: l, right: m });
      }
    }
  }
  return result;
}

/**
 * 真正物化小规模 JOIN 结果元组集合（基行 × 匹配中行 × 匹配尾行）。
 * 完全基于标准关系代数 LEFT JOIN 逐步物化，不包含任何乘积或求和公式。
 */
export function materializeJoin(scenario: Scenario): JoinedRow[] {
  const { layout, base, mid, tail } = scenario;

  if (base.length === 0) {
    return [];
  }

  // 第一步：Base LEFT JOIN Mid ON Base.key = Mid.parentKey (SQL NULL 语义: null !== null)
  const step1 = leftJoinStep(
    base,
    mid,
    (a, b) => a.key !== null && b.parentKey !== null && a.key === b.parentKey,
  );

  if (layout === 'single') {
    return step1.map(({ left: a, right: b }) => ({
      base: a,
      mid: b,
      tail: null,
    }));
  }

  if (layout === 'star') {
    // 第二步 (star)：(Base LEFT JOIN Mid) LEFT JOIN Tail ON Base.key = Tail.parentKey
    const step2 = leftJoinStep(
      step1,
      tail,
      (ab, c) => ab.left.key !== null && c.parentKey !== null && ab.left.key === c.parentKey,
    );
    return step2.map(({ left: ab, right: c }) => ({
      base: ab.left,
      mid: ab.right,
      tail: c,
    }));
  }

  if (layout === 'chain') {
    // 第二步 (chain)：(Base LEFT JOIN Mid) LEFT JOIN Tail ON Mid.linkKey = Tail.parentKey
    const step2 = leftJoinStep(
      step1,
      tail,
      (ab, c) =>
        ab.right !== null &&
        ab.right.linkKey !== null &&
        ab.right.linkKey !== undefined &&
        c.parentKey !== null &&
        ab.right.linkKey === c.parentKey,
    );
    return step2.map(({ left: ab, right: c }) => ({
      base: ab.left,
      mid: ab.right,
      tail: c,
    }));
  }

  throw new Error(`Unknown layout: ${layout as string}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// 主入口：oracleAnalyze（直接从物化行集合数因子、总额、差额）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 独立 oracle 分析函数。
 *
 * 实际生成 JOIN 结果行集合（基行 × 匹配中行 × 匹配尾行），
 * 从物化行集合直接数因子、总额、差额，不得调用生产逻辑，也不复用生产公式。
 */
export function oracleAnalyze(scenario: Scenario): OracleResult {
  const { base, layout } = scenario;
  const joinedRows = materializeJoin(scenario);

  // 从物化行集合直接数因子、金额、差额与分支数
  const rows: OracleRowResult[] = base.map((a) => {
    // 该基表行在物化结果集中的所有元组
    const rowsForA = joinedRows.filter((r) => r.base.id === a.id);

    // 因子：物化结果行数
    const factor = BigInt(rowsForA.length);
    const amount = BigInt(a.amountCents);

    // 朴素贡献：该基表行所有物化行的金额直接累加
    let naiveContribution = 0n;
    for (const r of rowsForA) {
      naiveContribution += BigInt(r.base.amountCents);
    }

    const delta = naiveContribution - amount;

    // branch1Count: 与该基行成功 JOIN 的不同 mid 行数（直接从物化元组中统计）
    const distinctMids = new Set<MidRow>();
    for (const r of rowsForA) {
      if (r.mid !== null) {
        distinctMids.add(r.mid);
      }
    }
    const branch1Count = distinctMids.size;

    // branch2Count:
    let branch2Count = 0;
    if (layout === 'single') {
      branch2Count = 0;
    } else if (layout === 'star') {
      // star: 与该基行成功 JOIN 的不同 tail 行数
      const distinctTails = new Set<TailRow>();
      for (const r of rowsForA) {
        if (r.tail !== null) {
          distinctTails.add(r.tail);
        }
      }
      branch2Count = distinctTails.size;
    } else if (layout === 'chain') {
      // chain: 通过该基行在 mid 的跳转成功连接到 tail 的物化元组数
      branch2Count = rowsForA.filter((r) => r.tail !== null).length;
    }

    return {
      id: a.id,
      factor: factor.toString(),
      amountCents: amount.toString(),
      naiveContributionCents: naiveContribution.toString(),
      deltaCents: delta.toString(),
      branch1Count,
      branch2Count,
    };
  });

  // 全局汇总：直接从物化行集合与基表行统计
  const expandedTotal = BigInt(joinedRows.length);

  let safeSum = 0n;
  for (const a of base) {
    safeSum += BigInt(a.amountCents);
  }

  let naiveSum = 0n;
  for (const r of joinedRows) {
    naiveSum += BigInt(r.base.amountCents);
  }

  let unsafeCount = 0;
  for (const a of base) {
    if (joinedRows.filter((r) => r.base.id === a.id).length > 1) {
      unsafeCount++;
    }
  }

  return {
    baseRows: base.length,
    expandedRows: expandedTotal.toString(),
    safeSumCents: safeSum.toString(),
    naiveSumCents: naiveSum.toString(),
    deltaCents: (naiveSum - safeSum).toString(),
    unsafeBaseRows: unsafeCount,
    rows,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 独立子集枚举：验证见证最少性（直接从物化行集合判定倍行）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 从数组中取 k 个元素的所有组合（保持原相对顺序）。
 */
export function combinations<T>(arr: readonly T[], k: number): T[][] {
  if (k === 0) return [[]];
  if (arr.length < k) return [];
  const [head, ...rest] = arr as [T, ...T[]];
  const withHead = combinations(rest, k - 1).map((c) => [head, ...c]);
  const withoutHead = combinations(rest, k);
  return [...withHead, ...withoutHead];
}

/**
 * oracle 子集枚举：穷举所有可能的输入行删除子集，
 * 对小规模场景直接物化 JOIN 集合，找出使任意基表行元组数 > 1 的最少输入行数。
 *
 * 约束（§6.4）：仅用于 ≤9 行输入场景。
 * 枚举策略：按总行数 k=1,2,3,4,... 从小到大枚举，基表至少选 1 行。
 *
 * @returns 能造成倍行的最少子集行数；若不存在则返回 -1。
 */
export function oracleFindMinimalRowCount(scenario: Scenario): number {
  const totalRows = scenario.base.length + scenario.mid.length + scenario.tail.length;
  if (totalRows > 12) {
    throw new Error(`Scenario too large for exhaustive search (${totalRows} rows > 12)`);
  }

  const maxK = Math.min(totalRows, 9);

  for (let k = 1; k <= maxK; k++) {
    // base 至少取 1 行
    for (let bCount = 1; bCount <= Math.min(k, scenario.base.length); bCount++) {
      const baseSubsets = combinations(scenario.base, bCount);
      for (const bSub of baseSubsets) {
        const remaining = k - bCount;
        for (let mCount = 0; mCount <= Math.min(remaining, scenario.mid.length); mCount++) {
          const tCount = remaining - mCount;
          if (tCount > scenario.tail.length) continue;
          if (tCount < 0) continue;

          const midSubsets = combinations(scenario.mid, mCount);
          const tailSubsets = combinations(scenario.tail, tCount);

          for (const mSub of midSubsets) {
            for (const tSub of tailSubsets) {
              const testScenario: Scenario = {
                schema: scenario.schema,
                specVersion: scenario.specVersion,
                layout: scenario.layout,
                title: 'oracle-subset',
                source: scenario.source,
                base: bSub,
                mid: mSub,
                tail: tSub,
              };

              // 从物化行集合直接数是否存在倍行（任意基行在物化结果中出现 > 1 次）
              const joined = materializeJoin(testScenario);
              const hasDuplication = bSub.some(
                (a) => joined.filter((r) => r.base.id === a.id).length > 1,
              );
              if (hasDuplication) {
                return k;
              }
            }
          }
        }
      }
    }
  }

  return -1; // 没有 ≤ maxK 行的倍行子集
}

/**
 * oracle 验证空基表子集：删除唯一 A 行后，不存在任何被复制的 A 行。
 * 即空基表场景下物化集合为空，unsafeBaseRows = 0。
 */
export function oracleEmptyBaseHasNoDuplication(scenario: Scenario): boolean {
  const emptyBase: Scenario = {
    ...scenario,
    base: [],
  };
  const joined = materializeJoin(emptyBase);
  return joined.length === 0;
}
