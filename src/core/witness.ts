import type {
  Scenario,
  BaseRow,
  MidRow,
  TailRow,
  Audit,
  AuditWitness,
} from './types.js';
import { computeFactors } from './factor.js';

/**
 * 结构见证 Scenario 子集结果接口
 *
 * 合同（项目书 §6.2、§8、实施计划 P008-T005）：
 * - 包含可导入的 Scenario 子集（若存在倍行）或 null（若无倍行 NONE）
 * - 严格实现 AuditWitness（kind、rowIds），可无缝作为 analyze() 的 WitnessFinder
 * - 提供 rowCount（3、4 或 0）
 */
export interface ScenarioSubset extends AuditWitness {
  scenario: Scenario | null;
  witness: AuditWitness;
  rowCount: number;
}

/**
 * 见证候选内部表示
 */
interface WitnessCandidate {
  rowCount: number;
  hasNonZeroAmount: boolean;
  baseRow: BaseRow;
  midRows: MidRow[];
  tailRows: TailRow[];
  idTuple: string[];
  branchType: 'mid' | 'tail' | 'chain_mid' | 'chain_tail';
}

/**
 * 见证最小性验证结果
 */
export interface MinimalityVerificationResult {
  isMinimal: boolean;
  baseScenarioValid: boolean;
  baseDuplicationDetected: boolean;
  violations: string[];
}

/**
 * 比较两个见证候选的优先级
 *
 * 排序合同（项目书 §6.2、实施计划 P008-T005）：
 * 1. 行数最少优先（3 行严格优于 4 行；不得为偏好金额牺牲最少行数）。
 * 2. 偏好非零金额基表（在行数相同前提下，|amountCents| > 0 优于 0）。
 * 3. ASCII ID 元组升序破平局（字典序比较各行 ID，确定唯一输出）。
 * 4. 分支类型破平局（若 ID 完全相同，mid 优于 tail）。
 */
function compareWitnessCandidates(a: WitnessCandidate, b: WitnessCandidate): number {
  // 1. 最少行数优先
  if (a.rowCount !== b.rowCount) {
    return a.rowCount - b.rowCount;
  }

  // 2. 偏好非零金额基表 (不得牺牲最少行数最优性)
  if (a.hasNonZeroAmount !== b.hasNonZeroAmount) {
    return a.hasNonZeroAmount ? -1 : 1;
  }

  // 3. ASCII ID 元组排序
  const minLen = Math.min(a.idTuple.length, b.idTuple.length);
  for (let i = 0; i < minLen; i++) {
    const s1 = a.idTuple[i]!;
    const s2 = b.idTuple[i]!;
    if (s1 < s2) return -1;
    if (s1 > s2) return 1;
  }
  if (a.idTuple.length !== b.idTuple.length) {
    return a.idTuple.length - b.idTuple.length;
  }

  // 4. 分支类型确定性破平
  if (a.branchType !== b.branchType) {
    return a.branchType < b.branchType ? -1 : 1;
  }

  return 0;
}

/**
 * 按 ASCII 升序对行 ID 排序
 */
function sortRowsById<T extends { id: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * 检查金额是否非零（严禁浮点数，严格使用 BigInt）
 */
function isNonZeroAmount(amountCents: string): boolean {
  try {
    return BigInt(amountCents) !== 0n;
  } catch {
    return false;
  }
}

/**
 * 寻找最小结构倍行见证集 (findMinimalWitness)
 *
 * 合同（项目书 §6.2、§8、实施计划 P008-T005）：
 * - 在保持同一 layout 与原始行内容、只允许删除输入行的前提下，
 *   找出使至少一条 A 行 f_i > 1 的全局最少输入行数子集。
 * - single / star：3 行（1 A + 2 B 或 1 A + 2 C）。
 * - chain：3 行（1 A + 2 B）或 4 行（1 A + 1 B + 2 C）。
 * - 若任何 f_i > 1 都不存在，返回 NONE。
 * - 有非零金额的 A 行见证优先展示（kind: 'NUMERIC_AND_STRUCTURAL'），
 *   否则标为 'STRUCTURAL_ONLY'。
 * - 非零金额偏好不得牺牲行数最优（3 行零金额严格优于 4 行非零金额）。
 * - 输出行按原相对顺序排列，保留输入模式与可导入有效性。
 */
export function findMinimalWitness(
  scenario: Scenario,
  _audit?: Omit<Audit, 'witness'> | Audit
): ScenarioSubset {
  const { layout, base, mid, tail } = scenario;
  const candidates: WitnessCandidate[] = [];

  switch (layout) {
    case 'single': {
      // 建立 mid parentKey 索引（忽略 SQL NULL）
      const midMap = new Map<string, MidRow[]>();
      for (const m of mid) {
        if (m.parentKey !== null) {
          const list = midMap.get(m.parentKey);
          if (list) {
            list.push(m);
          } else {
            midMap.set(m.parentKey, [m]);
          }
        }
      }

      for (const a of base) {
        if (a.key === null) continue;
        const matches = midMap.get(a.key);
        if (matches && matches.length >= 2) {
          const sorted = sortRowsById(matches);
          const m0 = sorted[0]!;
          const m1 = sorted[1]!;
          // 保持原相对顺序
          const pairSet = new Set([m0.id, m1.id]);
          const selectedMid = mid.filter((m) => pairSet.has(m.id));

          candidates.push({
            rowCount: 3,
            hasNonZeroAmount: isNonZeroAmount(a.amountCents),
            baseRow: a,
            midRows: selectedMid,
            tailRows: [],
            idTuple: [a.id, m0.id, m1.id],
            branchType: 'mid',
          });
        }
      }
      break;
    }

    case 'star': {
      const midMap = new Map<string, MidRow[]>();
      for (const m of mid) {
        if (m.parentKey !== null) {
          const list = midMap.get(m.parentKey);
          if (list) {
            list.push(m);
          } else {
            midMap.set(m.parentKey, [m]);
          }
        }
      }

      const tailMap = new Map<string, TailRow[]>();
      for (const t of tail) {
        if (t.parentKey !== null) {
          const list = tailMap.get(t.parentKey);
          if (list) {
            list.push(t);
          } else {
            tailMap.set(t.parentKey, [t]);
          }
        }
      }

      for (const a of base) {
        if (a.key === null) continue;
        const nonZero = isNonZeroAmount(a.amountCents);

        // Branch 1 (mid) 2匹配
        const midMatches = midMap.get(a.key);
        if (midMatches && midMatches.length >= 2) {
          const sorted = sortRowsById(midMatches);
          const m0 = sorted[0]!;
          const m1 = sorted[1]!;
          const pairSet = new Set([m0.id, m1.id]);
          const selectedMid = mid.filter((m) => pairSet.has(m.id));

          candidates.push({
            rowCount: 3,
            hasNonZeroAmount: nonZero,
            baseRow: a,
            midRows: selectedMid,
            tailRows: [],
            idTuple: [a.id, m0.id, m1.id],
            branchType: 'mid',
          });
        }

        // Branch 2 (tail) 2匹配
        const tailMatches = tailMap.get(a.key);
        if (tailMatches && tailMatches.length >= 2) {
          const sorted = sortRowsById(tailMatches);
          const t0 = sorted[0]!;
          const t1 = sorted[1]!;
          const pairSet = new Set([t0.id, t1.id]);
          const selectedTail = tail.filter((t) => pairSet.has(t.id));

          candidates.push({
            rowCount: 3,
            hasNonZeroAmount: nonZero,
            baseRow: a,
            midRows: [],
            tailRows: selectedTail,
            idTuple: [a.id, t0.id, t1.id],
            branchType: 'tail',
          });
        }
      }
      break;
    }

    case 'chain': {
      const midMap = new Map<string, MidRow[]>();
      for (const m of mid) {
        if (m.parentKey !== null) {
          const list = midMap.get(m.parentKey);
          if (list) {
            list.push(m);
          } else {
            midMap.set(m.parentKey, [m]);
          }
        }
      }

      const tailMap = new Map<string, TailRow[]>();
      for (const t of tail) {
        if (t.parentKey !== null) {
          const list = tailMap.get(t.parentKey);
          if (list) {
            list.push(t);
          } else {
            tailMap.set(t.parentKey, [t]);
          }
        }
      }

      // 1. 寻找 3 行见证（A + 2B）
      for (const a of base) {
        if (a.key === null) continue;
        const midMatches = midMap.get(a.key);
        if (midMatches && midMatches.length >= 2) {
          const sorted = sortRowsById(midMatches);
          const m0 = sorted[0]!;
          const m1 = sorted[1]!;
          const pairSet = new Set([m0.id, m1.id]);
          const selectedMid = mid.filter((m) => pairSet.has(m.id));

          candidates.push({
            rowCount: 3,
            hasNonZeroAmount: isNonZeroAmount(a.amountCents),
            baseRow: a,
            midRows: selectedMid,
            tailRows: [],
            idTuple: [a.id, m0.id, m1.id],
            branchType: 'chain_mid',
          });
        }
      }

      // 2. 寻找 4 行见证（A + 1B + 2C）
      // 注意：即便存在 3 行见证，我们也收集 4 行见证，由 compareWitnessCandidates 保证 3 行严格优于 4 行
      for (const a of base) {
        if (a.key === null) continue;
        const midMatches = midMap.get(a.key);
        if (!midMatches) continue;

        for (const b of midMatches) {
          if (b.linkKey === null || b.linkKey === undefined) continue;
          const tailMatches = tailMap.get(b.linkKey);
          if (tailMatches && tailMatches.length >= 2) {
            const sortedTail = sortRowsById(tailMatches);
            const t0 = sortedTail[0]!;
            const t1 = sortedTail[1]!;
            const pairSet = new Set([t0.id, t1.id]);
            const selectedTail = tail.filter((t) => pairSet.has(t.id));

            candidates.push({
              rowCount: 4,
              hasNonZeroAmount: isNonZeroAmount(a.amountCents),
              baseRow: a,
              midRows: [b],
              tailRows: selectedTail,
              idTuple: [a.id, b.id, t0.id, t1.id],
              branchType: 'chain_tail',
            });
          }
        }
      }
      break;
    }

    default: {
      const _exhaustive: never = layout;
      throw new Error(`Unsupported layout: ${_exhaustive}`);
    }
  }

  // 无倍行结构见证，返回 NONE
  if (candidates.length === 0) {
    const noneWitness: AuditWitness = {
      rowIds: {
        base: [],
        mid: [],
        tail: [],
      },
      kind: 'NONE',
    };

    return {
      ...noneWitness,
      witness: noneWitness,
      scenario: null,
      rowCount: 0,
    };
  }

  // 排序选出全局最优见证
  candidates.sort(compareWitnessCandidates);
  const winner = candidates[0]!;

  const subscenario: Scenario = {
    schema: scenario.schema,
    specVersion: scenario.specVersion,
    layout: scenario.layout,
    title: scenario.title,
    source: scenario.source,
    base: [winner.baseRow],
    mid: winner.midRows,
    tail: winner.tailRows,
  };

  const auditWitness: AuditWitness = {
    rowIds: {
      base: [winner.baseRow.id],
      mid: winner.midRows.map((r) => r.id),
      tail: winner.tailRows.map((r) => r.id),
    },
    kind: winner.hasNonZeroAmount ? 'NUMERIC_AND_STRUCTURAL' : 'STRUCTURAL_ONLY',
  };

  return {
    ...auditWitness,
    witness: auditWitness,
    scenario: subscenario,
    rowCount: 1 + winner.midRows.length + winner.tailRows.length,
  };
}

/**
 * 根据 AuditWitness 重建 Scenario 子集
 */
export function buildWitnessScenario(
  scenario: Scenario,
  witness: AuditWitness
): Scenario | null {
  if (witness.kind === 'NONE' || witness.rowIds.base.length === 0) {
    return null;
  }

  const baseSet = new Set(witness.rowIds.base);
  const midSet = new Set(witness.rowIds.mid);
  const tailSet = new Set(witness.rowIds.tail);

  return {
    schema: scenario.schema,
    specVersion: scenario.specVersion,
    layout: scenario.layout,
    title: scenario.title,
    source: scenario.source,
    base: scenario.base.filter((r) => baseSet.has(r.id)),
    mid: scenario.mid.filter((r) => midSet.has(r.id)),
    tail: scenario.tail.filter((r) => tailSet.has(r.id)),
  };
}

/**
 * 验证见证子集的最小性（移除关联侧任一行后不再倍行）
 *
 * 验证合同（项目书 §6.2、MATH06）：
 * 1. 见证本身必须包含倍行（存在 factor > 1）。
 * 2. 见证总行数必须为 3 或 4。
 * 3. 移除 mid 表中任一行后，剩余合法子集所有基表行 factor === 1。
 * 4. 移除 tail 表中任一行后，剩余合法子集所有基表行 factor === 1。
 */
export function verifyWitnessMinimality(
  _originalScenario: Scenario,
  subset: ScenarioSubset
): MinimalityVerificationResult {
  const violations: string[] = [];

  if (subset.kind === 'NONE') {
    return {
      isMinimal: true,
      baseScenarioValid: true,
      baseDuplicationDetected: false,
      violations: [],
    };
  }

  if (!subset.scenario) {
    violations.push('Non-NONE witness has null scenario');
    return {
      isMinimal: false,
      baseScenarioValid: false,
      baseDuplicationDetected: false,
      violations,
    };
  }

  const sub = subset.scenario;
  const factorRes = computeFactors(sub);
  const hasDuplication = factorRes.rows.some((r) => r.factor > 1n);

  if (!hasDuplication) {
    violations.push(`Witness scenario does not exhibit duplication (all factors are 1)`);
  }

  if (subset.rowCount !== 3 && subset.rowCount !== 4) {
    violations.push(`Witness rowCount must be 3 or 4, got ${subset.rowCount}`);
  }

  // 验证移除任一 mid 行后无倍行
  for (const midRow of sub.mid) {
    const withoutMid: Scenario = {
      ...sub,
      mid: sub.mid.filter((r) => r.id !== midRow.id),
    };
    const fRes = computeFactors(withoutMid);
    const stillDup = fRes.rows.some((r) => r.factor > 1n);
    if (stillDup) {
      violations.push(`Removing mid row "${midRow.id}" still exhibits duplication`);
    }
  }

  // 验证移除任一 tail 行后无倍行
  for (const tailRow of sub.tail) {
    const withoutTail: Scenario = {
      ...sub,
      tail: sub.tail.filter((r) => r.id !== tailRow.id),
    };
    const fRes = computeFactors(withoutTail);
    const stillDup = fRes.rows.some((r) => r.factor > 1n);
    if (stillDup) {
      violations.push(`Removing tail row "${tailRow.id}" still exhibits duplication`);
    }
  }

  return {
    isMinimal: violations.length === 0,
    baseScenarioValid: true,
    baseDuplicationDetected: hasDuplication,
    violations,
  };
}
