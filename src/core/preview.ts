/**
 * P008 倍行镜 JoinWitness — 连接行预览与枚举截断控制
 *
 * 遵循项目书 §6.3、§8、MATH09、FR06、U06 与实施计划 P008-T013：
 * - previewJoinedRows(scenario, limit=200): 具 A/B/C ID 的局部物化枚举。
 * - 默认最多物化 200 行，防止超大笛卡尔积卡死界面或 OOM。
 * - 核心数学约束：总行数和金额必须来自独立的分解式计数 (computeFactors)，
 *   绝对不依赖预览采样！预览截断绝不影响总数计算。
 * - 空值语义严格遵循 SQL = 语义：NULL 键互不相连，基表保留为 LEFT JOIN 单行。
 * - 支持 single / star / chain 三种受限拓扑。
 * - 纯函数实现，不包含任何网络或外部依赖，绝不在日志中暴露用户输入原文件。
 */

import type { Scenario, BaseRow, MidRow, TailRow } from './types.js';
import { computeFactors } from './factor.js';

export const DEFAULT_PREVIEW_LIMIT = 200;

/**
 * 单条物化连接预览行
 */
export interface JoinedRowPreview {
  /** 预览行全局序号（1 开始） */
  previewIndex: number;
  /** 基表 A 行 ID */
  aId: string;
  /** 基表 A 关联键（可为 null） */
  aKey: string | null;
  /** 中间表 B 行 ID（未连接或空侧为 null） */
  bId: string | null;
  /** 尾表 C 行 ID（未连接、single 布局或空侧为 null） */
  cId: string | null;
  /** 别名：基表 ID */
  baseId: string;
  /** 别名：基表键 */
  baseKey: string | null;
  /** 别名：第二表 ID */
  midId: string | null;
  /** 别名：第三表 ID */
  tailId: string | null;
  /** 基表原始金额（分字符串） */
  baseAmountCents: string;
  /** 该 A 行内部展开序号（1-based） */
  subIndex: number;
  /** 该 A 行由拓扑展开的总行数（精确值） */
  totalForBase: number;
  /** 是否因倍行而重复 (totalForBase > 1) */
  isDuplicated: boolean;
  /** 状态文本：如 "倍行 1/4" 或 "单行 1/1" */
  statusText: string;
}

/**
 * 预览结果元数据与行集合接口
 */
export interface PreviewResult {
  /** 预览行数组 */
  rows: JoinedRowPreview[];
  /** 是否发生了上限截断 */
  isTruncated: boolean;
  /** 设定的预览上限（如 200） */
  limit: number;
  /** 独立分解式精确计算的总行数（字符串表示，支持超大整数） */
  totalExpandedRows: string;
  /** 实际物化的预览行数量 */
  previewCount: number;
}

/**
 * 兼具数组索引与属性元数据的统一返回类型
 */
export type PreviewJoinedRowsResult = JoinedRowPreview[] & PreviewResult;

/**
 * 核心预览函数：枚举最多 limit 条 JOIN 输出作为路径预览
 *
 * @param scenario 已验证的场景数据
 * @param limit 物化行数上限，默认 200
 * @returns 兼具 Array 迭代与 PreviewResult 属性的预览结果
 */
export function previewJoinedRows(
  scenario: Scenario,
  limit: number = DEFAULT_PREVIEW_LIMIT
): PreviewJoinedRowsResult {
  const safeLimit = Math.max(0, Math.floor(limit));

  // 1. 独立分解式计数计算精确总行数（总计数绝不依赖预览物化数组长度！）
  const factorResult = computeFactors(scenario);
  const totalExpandedRows = factorResult.expandedRowsString;

  const resultRows: JoinedRowPreview[] = [];
  if (safeLimit === 0 || scenario.base.length === 0) {
    const totalBig = BigInt(totalExpandedRows);
    const isTruncated = totalBig > 0n;
    return Object.assign(resultRows, {
      rows: resultRows,
      isTruncated,
      limit: safeLimit,
      totalExpandedRows,
      previewCount: 0,
    });
  }

  // 2. 建立索引加速关联查找，复杂度 O(|mid| + |tail|)
  const midByParentKey = new Map<string, MidRow[]>();
  for (const b of scenario.mid) {
    if (b.parentKey !== null) {
      const list = midByParentKey.get(b.parentKey);
      if (list) {
        list.push(b);
      } else {
        midByParentKey.set(b.parentKey, [b]);
      }
    }
  }

  const tailByParentKey = new Map<string, TailRow[]>();
  for (const c of scenario.tail) {
    if (c.parentKey !== null) {
      const list = tailByParentKey.get(c.parentKey);
      if (list) {
        list.push(c);
      } else {
        tailByParentKey.set(c.parentKey, [c]);
      }
    }
  }

  // 3. 根据布局按输入行相对顺序生成预览连接行，到达 limit 立即提前中止
  const { layout, base } = scenario;
  let previewSeq = 1;

  for (let i = 0; i < base.length; i++) {
    if (resultRows.length >= safeLimit) {
      break;
    }

    const a = base[i]!;
    // 从已计算的因子中快速获取该 A 行的精确展开数
    const factorNum = Number(factorResult.rows[i]?.factor ?? 1n);
    const isDup = factorNum > 1;

    if (layout === 'single') {
      const bMatches = a.key !== null ? midByParentKey.get(a.key) ?? [] : [];
      if (bMatches.length === 0) {
        resultRows.push({
          previewIndex: previewSeq++,
          aId: a.id,
          aKey: a.key,
          bId: null,
          cId: null,
          baseId: a.id,
          baseKey: a.key,
          midId: null,
          tailId: null,
          baseAmountCents: a.amountCents,
          subIndex: 1,
          totalForBase: 1,
          isDuplicated: false,
          statusText: '单行 1/1',
        });
      } else {
        for (let sub = 0; sub < bMatches.length; sub++) {
          if (resultRows.length >= safeLimit) break;
          const b = bMatches[sub]!;
          resultRows.push({
            previewIndex: previewSeq++,
            aId: a.id,
            aKey: a.key,
            bId: b.id,
            cId: null,
            baseId: a.id,
            baseKey: a.key,
            midId: b.id,
            tailId: null,
            baseAmountCents: a.amountCents,
            subIndex: sub + 1,
            totalForBase: factorNum,
            isDuplicated: isDup,
            statusText: isDup ? `倍行 ${sub + 1}/${factorNum}` : '单行 1/1',
          });
        }
      }
    } else if (layout === 'star') {
      const bMatches = a.key !== null ? midByParentKey.get(a.key) ?? [] : [];
      const cMatches = a.key !== null ? tailByParentKey.get(a.key) ?? [] : [];

      if (bMatches.length === 0 && cMatches.length === 0) {
        resultRows.push({
          previewIndex: previewSeq++,
          aId: a.id,
          aKey: a.key,
          bId: null,
          cId: null,
          baseId: a.id,
          baseKey: a.key,
          midId: null,
          tailId: null,
          baseAmountCents: a.amountCents,
          subIndex: 1,
          totalForBase: 1,
          isDuplicated: false,
          statusText: '单行 1/1',
        });
      } else if (bMatches.length > 0 && cMatches.length === 0) {
        for (let sub = 0; sub < bMatches.length; sub++) {
          if (resultRows.length >= safeLimit) break;
          const b = bMatches[sub]!;
          resultRows.push({
            previewIndex: previewSeq++,
            aId: a.id,
            aKey: a.key,
            bId: b.id,
            cId: null,
            baseId: a.id,
            baseKey: a.key,
            midId: b.id,
            tailId: null,
            baseAmountCents: a.amountCents,
            subIndex: sub + 1,
            totalForBase: factorNum,
            isDuplicated: isDup,
            statusText: isDup ? `倍行 ${sub + 1}/${factorNum}` : '单行 1/1',
          });
        }
      } else if (bMatches.length === 0 && cMatches.length > 0) {
        for (let sub = 0; sub < cMatches.length; sub++) {
          if (resultRows.length >= safeLimit) break;
          const c = cMatches[sub]!;
          resultRows.push({
            previewIndex: previewSeq++,
            aId: a.id,
            aKey: a.key,
            bId: null,
            cId: c.id,
            baseId: a.id,
            baseKey: a.key,
            midId: null,
            tailId: c.id,
            baseAmountCents: a.amountCents,
            subIndex: sub + 1,
            totalForBase: factorNum,
            isDuplicated: isDup,
            statusText: isDup ? `倍行 ${sub + 1}/${factorNum}` : '单行 1/1',
          });
        }
      } else {
        let sub = 1;
        let reachedInnerLimit = false;
        for (const b of bMatches) {
          if (reachedInnerLimit) break;
          for (const c of cMatches) {
            if (resultRows.length >= safeLimit) {
              reachedInnerLimit = true;
              break;
            }
            resultRows.push({
              previewIndex: previewSeq++,
              aId: a.id,
              aKey: a.key,
              bId: b.id,
              cId: c.id,
              baseId: a.id,
              baseKey: a.key,
              midId: b.id,
              tailId: c.id,
              baseAmountCents: a.amountCents,
              subIndex: sub,
              totalForBase: factorNum,
              isDuplicated: isDup,
              statusText: isDup ? `倍行 ${sub}/${factorNum}` : '单行 1/1',
            });
            sub++;
          }
        }
      }
    } else if (layout === 'chain') {
      const bMatches = a.key !== null ? midByParentKey.get(a.key) ?? [] : [];
      if (bMatches.length === 0) {
        resultRows.push({
          previewIndex: previewSeq++,
          aId: a.id,
          aKey: a.key,
          bId: null,
          cId: null,
          baseId: a.id,
          baseKey: a.key,
          midId: null,
          tailId: null,
          baseAmountCents: a.amountCents,
          subIndex: 1,
          totalForBase: 1,
          isDuplicated: false,
          statusText: '单行 1/1',
        });
      } else {
        let sub = 1;
        let reachedInnerLimit = false;
        for (const b of bMatches) {
          if (reachedInnerLimit) break;
          const cMatches =
            b.linkKey !== null && b.linkKey !== undefined
              ? tailByParentKey.get(b.linkKey) ?? []
              : [];
          if (cMatches.length === 0) {
            if (resultRows.length >= safeLimit) {
              reachedInnerLimit = true;
              break;
            }
            resultRows.push({
              previewIndex: previewSeq++,
              aId: a.id,
              aKey: a.key,
              bId: b.id,
              cId: null,
              baseId: a.id,
              baseKey: a.key,
              midId: b.id,
              tailId: null,
              baseAmountCents: a.amountCents,
              subIndex: sub,
              totalForBase: factorNum,
              isDuplicated: isDup,
              statusText: isDup ? `倍行 ${sub}/${factorNum}` : '单行 1/1',
            });
            sub++;
          } else {
            for (const c of cMatches) {
              if (resultRows.length >= safeLimit) {
                reachedInnerLimit = true;
                break;
              }
              resultRows.push({
                previewIndex: previewSeq++,
                aId: a.id,
                aKey: a.key,
                bId: b.id,
                cId: c.id,
                baseId: a.id,
                baseKey: a.key,
                midId: b.id,
                tailId: c.id,
                baseAmountCents: a.amountCents,
                subIndex: sub,
                totalForBase: factorNum,
                isDuplicated: isDup,
                statusText: isDup ? `倍行 ${sub}/${factorNum}` : '单行 1/1',
              });
              sub++;
            }
          }
        }
      }
    }
  }

  // 4. 判断是否截断：精确总行数是否大于实际返回行数
  const totalExpandedBig = BigInt(totalExpandedRows);
  const isTruncated = totalExpandedBig > BigInt(resultRows.length);

  return Object.assign(resultRows, {
    rows: resultRows,
    isTruncated,
    limit: safeLimit,
    totalExpandedRows,
    previewCount: resultRows.length,
  });
}

/**
 * 依据基表 ID 筛选预览行（用于点击订单高亮或聚焦查看）
 */
export function filterPreviewRows(
  rows: JoinedRowPreview[],
  filterBaseId?: string | null
): JoinedRowPreview[] {
  if (!filterBaseId) {
    return rows;
  }
  return rows.filter((r) => r.aId === filterBaseId || r.baseId === filterBaseId);
}
