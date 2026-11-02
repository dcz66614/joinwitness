import type { Scenario, Audit, AuditWitness } from './types.js';
import { computeFactors } from './factor.js';
import { computeAmountAudit } from './amount.js';
import { toCanonicalJson } from '../io/json.js';

export { toCanonicalJson };

export type WitnessFinder = (
  scenario: Scenario,
  auditWithoutWitness: Omit<Audit, 'witness'>
) => AuditWitness | Promise<AuditWitness>;

let registeredWitnessFinder: WitnessFinder | null = null;

/**
 * 注册全局结构见证构造器（由 T005 提供或测试用）
 */
export function registerWitnessFinder(finder: WitnessFinder | null): void {
  registeredWitnessFinder = finder;
}

/**
 * 获取当前注册的见证构造器
 */
export function getRegisteredWitnessFinder(): WitnessFinder | null {
  return registeredWitnessFinder;
}

/**
 * 计算 Scenario 的规范 UTF-8 字节 SHA-256 哈希
 * 依项目书 §8、实施计划 §10、任务卡 FIX-R1-04：
 * 采用规范 JSON 字节（递归按键字典序排序、保持数组顺序、无多余空白、统一 UTF-8 编码），
 * 使用 Web Crypto crypto.subtle.digest 计算 SHA-256
 */
export async function computeScenarioSha256(scenario: Scenario): Promise<string> {
  const canonical = toCanonicalJson(scenario);
  const data = new TextEncoder().encode(canonical);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

export interface AnalyzeOptions {
  witnessFinder?: WitnessFinder;
  skipWitness?: boolean;
}

/**
 * P008 倍行镜 JoinWitness — 核心场景分析总入口
 *
 * 合同（项目书 §8）：
 * analyze(s: Scenario): Promise<Audit>
 * 已验证场景 → 倍增与精确金额审计
 * - 异步仅用于 Web Crypto SHA-256
 * - 数值内核为纯函数，无 DOM/网络，固定排序
 */
export async function analyze(
  scenario: Scenario,
  options?: AnalyzeOptions
): Promise<Audit> {
  const sha256 = await computeScenarioSha256(scenario);
  const factorResult = computeFactors(scenario);
  const amountResult = computeAmountAudit(scenario, factorResult);

  const partialAudit: Omit<Audit, 'witness'> = {
    schema: 'joinwitness.audit/v1',
    scenarioSha256: sha256,
    baseRows: scenario.base.length,
    expandedRows: factorResult.expandedRowsString,
    expandedRowsPreviewed: 0,
    safeSumCents: amountResult.safeSumCents,
    naiveSumCents: amountResult.naiveSumCents,
    deltaCents: amountResult.deltaCents,
    unsafeBaseRows: amountResult.unsafeBaseRows,
    rows: amountResult.rows,
  };

  let witness: AuditWitness = {
    rowIds: { base: [], mid: [], tail: [] },
    kind: 'NONE',
  };

  if (!options?.skipWitness) {
    const finder = options?.witnessFinder ?? registeredWitnessFinder;
    if (finder) {
      witness = await finder(scenario, partialAudit);
    }
  }

  return {
    ...partialAudit,
    witness,
  };
}
