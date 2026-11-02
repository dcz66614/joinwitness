import type { Scenario, BaseRow, MidRow, TailRow } from './types.js';

export interface BaseFactorAudit {
  id: string;
  factor: bigint;
  factorString: string;
  branch1Count: number;
  branch2Count: number;
}

export interface FactorResult {
  expandedRows: bigint;
  expandedRowsString: string;
  rows: BaseFactorAudit[];
}

interface MidChainAgg {
  bCount: number;
  cTotalCount: number;
  weight: bigint;
}

/**
 * P008 倍行镜 JoinWitness — LEFT JOIN 分解式索引与倍增因子计算
 *
 * 核心数学约束（项目书 §6.1）：
 * 1. single:
 *    f_i = max(1, b_i)
 *    branch1Count = b_i, branch2Count = 0
 * 2. star:
 *    f_i = max(1, b_i) * max(1, c_i)
 *    branch1Count = b_i, branch2Count = c_i
 * 3. chain:
 *    若 b_i = 0 则 f_i = 1 (LEFT JOIN 孤立 A 行保留 1 行，B/C 填充 NULL)
 *    若 b_i > 0 则 f_i = Σ_{b ∈ B(i)} max(1, c_b)
 *    branch1Count = b_i, branch2Count = Σ_{b ∈ B(i)} c_b
 *
 * 关键约束：
 * - SQL NULL 语义：键比较为精确匹配，null !== null，null 键永远无法连接成功。
 * - 时间复杂度：O(|base| + |mid| + |tail|) 预期线性时间。
 * - 额外空间复杂度：O(|mid| + |tail|) 频率 Map 索引空间。
 * - 禁止物化全部 JOIN 结果。
 * - 所有乘除及累加使用 BigInt，零浮点误差。
 */
export function computeFactors(scenario: Scenario): FactorResult {
  const { layout, base, mid, tail } = scenario;

  switch (layout) {
    case 'single':
      return computeSingleFactors(base, mid);
    case 'star':
      return computeStarFactors(base, mid, tail);
    case 'chain':
      return computeChainFactors(base, mid, tail);
    default: {
      const _exhaustive: never = layout;
      throw new Error(`Unsupported layout: ${_exhaustive}`);
    }
  }
}

export const computeRowFactors = computeFactors;

/**
 * 2 表 single 布局：A LEFT JOIN B ON A.key = B.parentKey
 * 时间复杂度: O(|base| + |mid|)
 * 空间复杂度: O(|mid|) 键频率 Map
 */
function computeSingleFactors(base: BaseRow[], mid: MidRow[]): FactorResult {
  const midFreqMap = new Map<string, number>();
  for (const b of mid) {
    if (b.parentKey !== null) {
      midFreqMap.set(b.parentKey, (midFreqMap.get(b.parentKey) ?? 0) + 1);
    }
  }

  let totalExpanded = 0n;
  const rows: BaseFactorAudit[] = new Array(base.length);

  for (let i = 0; i < base.length; i++) {
    const a = base[i]!;
    let bCount = 0;
    if (a.key !== null) {
      bCount = midFreqMap.get(a.key) ?? 0;
    }

    const factor = bCount === 0 ? 1n : BigInt(bCount);
    totalExpanded += factor;

    rows[i] = {
      id: a.id,
      factor,
      factorString: factor.toString(),
      branch1Count: bCount,
      branch2Count: 0,
    };
  }

  return {
    expandedRows: totalExpanded,
    expandedRowsString: totalExpanded.toString(),
    rows,
  };
}

/**
 * 3 表 star 布局：A LEFT JOIN B ON A.key = B.parentKey LEFT JOIN C ON A.key = C.parentKey
 * 两条独立支路形成笛卡尔积乘法: f_i = max(1, b_i) * max(1, c_i)
 * 时间复杂度: O(|base| + |mid| + |tail|)
 * 空间复杂度: O(|mid| + |tail|) 键频率 Map
 */
function computeStarFactors(base: BaseRow[], mid: MidRow[], tail: TailRow[]): FactorResult {
  const midFreqMap = new Map<string, number>();
  for (const b of mid) {
    if (b.parentKey !== null) {
      midFreqMap.set(b.parentKey, (midFreqMap.get(b.parentKey) ?? 0) + 1);
    }
  }

  const tailFreqMap = new Map<string, number>();
  for (const c of tail) {
    if (c.parentKey !== null) {
      tailFreqMap.set(c.parentKey, (tailFreqMap.get(c.parentKey) ?? 0) + 1);
    }
  }

  let totalExpanded = 0n;
  const rows: BaseFactorAudit[] = new Array(base.length);

  for (let i = 0; i < base.length; i++) {
    const a = base[i]!;
    let bCount = 0;
    let cCount = 0;
    if (a.key !== null) {
      bCount = midFreqMap.get(a.key) ?? 0;
      cCount = tailFreqMap.get(a.key) ?? 0;
    }

    const bFactor = bCount === 0 ? 1n : BigInt(bCount);
    const cFactor = cCount === 0 ? 1n : BigInt(cCount);
    const factor = bFactor * cFactor;
    totalExpanded += factor;

    rows[i] = {
      id: a.id,
      factor,
      factorString: factor.toString(),
      branch1Count: bCount,
      branch2Count: cCount,
    };
  }

  return {
    expandedRows: totalExpanded,
    expandedRowsString: totalExpanded.toString(),
    rows,
  };
}

/**
 * 3 表 chain 布局：A LEFT JOIN B ON A.key = B.parentKey LEFT JOIN C ON B.linkKey = C.parentKey
 * 串联支路形成求和而非乘积: f_i = Σ_{b ∈ B(i)} max(1, c_b) (若 b_i = 0 则 f_i = 1)
 * 绝对禁止误用 star 乘积！
 * 时间复杂度: O(|base| + |mid| + |tail|)
 * 空间复杂度: O(|mid| + |tail|) 键频率与聚合 Map
 */
function computeChainFactors(base: BaseRow[], mid: MidRow[], tail: TailRow[]): FactorResult {
  // 1. 统计 C (tail) 各 parentKey 出现频次
  const tailFreqMap = new Map<string, number>();
  for (const c of tail) {
    if (c.parentKey !== null) {
      tailFreqMap.set(c.parentKey, (tailFreqMap.get(c.parentKey) ?? 0) + 1);
    }
  }

  // 2. 预聚合 B (mid) 的贡献，按 B.parentKey 分组
  const midAggMap = new Map<string, MidChainAgg>();

  for (const b of mid) {
    if (b.parentKey === null) {
      // SQL NULL 语义：null 无法与 A.key 相连
      continue;
    }

    let cMatches = 0;
    if (b.linkKey !== null && b.linkKey !== undefined) {
      cMatches = tailFreqMap.get(b.linkKey) ?? 0;
    }

    // 这一条 B 行通过 LEFT JOIN 到 C 展开的行数
    const bWeight = cMatches === 0 ? 1n : BigInt(cMatches);

    const agg = midAggMap.get(b.parentKey);
    if (!agg) {
      midAggMap.set(b.parentKey, {
        bCount: 1,
        cTotalCount: cMatches,
        weight: bWeight,
      });
    } else {
      agg.bCount += 1;
      agg.cTotalCount += cMatches;
      agg.weight += bWeight;
    }
  }

  // 3. 扫描 A (base)，组装各行结果
  let totalExpanded = 0n;
  const rows: BaseFactorAudit[] = new Array(base.length);

  for (let i = 0; i < base.length; i++) {
    const a = base[i]!;
    let bCount = 0;
    let cCount = 0;
    let factor = 1n;

    if (a.key !== null) {
      const agg = midAggMap.get(a.key);
      if (agg) {
        bCount = agg.bCount;
        cCount = agg.cTotalCount;
        factor = agg.weight;
      }
    }

    totalExpanded += factor;

    rows[i] = {
      id: a.id,
      factor,
      factorString: factor.toString(),
      branch1Count: bCount,
      branch2Count: cCount,
    };
  }

  return {
    expandedRows: totalExpanded,
    expandedRowsString: totalExpanded.toString(),
    rows,
  };
}
