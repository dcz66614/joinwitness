/**
 * T006 固定种子随机场景生成器 — randomFixtures.ts
 *
 * 生成 1,000 个固定种子的小型随机场景（A 1-5行，B/C 0-5行，总行数 ≤12），
 * 用于与生产算法对比验证。
 *
 * 独立性声明：本文件不导入任何生产辅助函数。
 * 仅使用 types.ts 的类型定义。
 */

import type { BaseRow, MidRow, TailRow, Scenario, Layout } from '../../src/core/types.js';

// ─────────────────────────────────────────────────────────────────────────────
// 极简线性同余伪随机数生成器（PRNG）
// 不依赖任何外部库，保证跨平台可重复
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 线性同余生成器（LCG）。
 * 参数选自 Numerical Recipes（Knuth）：m=2^32, a=1664525, c=1013904223。
 * 返回 [0, 1) 浮点数，与 Math.random() 同样的接口。
 */
export class LCG {
  private state: number;

  constructor(seed: number) {
    // 保证种子为非负 32 位整数
    this.state = (seed >>> 0);
  }

  /** 返回 [0, 1) 的浮点数 */
  next(): number {
    // LCG：state = (a * state + c) mod 2^32
    this.state = ((Math.imul(1664525, this.state) + 1013904223) >>> 0);
    return this.state / 0x100000000;
  }

  /** 返回 [min, max] 的随机整数 */
  nextInt(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  /** 从给定字符集中随机选取 */
  nextChoice<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length)]!;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 场景生成逻辑
// ─────────────────────────────────────────────────────────────────────────────

/** 可用键池：少量键以制造碰撞/倍行，覆盖空字符串与 null */
const KEY_POOL = ['K1', 'K2', 'K3', '', null] as const;
/** 链式用的 linkKey 池，覆盖空字符串与 null */
const LINK_POOL = ['L1', 'L2', 'L3', '', null] as const;
/** 布局类型 */
const LAYOUTS: readonly Layout[] = ['single', 'star', 'chain'] as const;
/** 金额范围（单位：分） */
const AMOUNT_MIN = -5000;
const AMOUNT_MAX = 10000;

/**
 * 生成单个随机场景（小规模，便于枚举验证）。
 *
 * 约束（§6.4）：A 1-5行，B 0-5行，C 0-5行，总行数 ≤12。
 */
export function generateRandomScenario(rng: LCG, index: number): Scenario {
  const layout = rng.nextChoice(LAYOUTS);

  // 随机行数（满足总行数 ≤12 约束）
  const baseCount = rng.nextInt(1, 5);
  let midCount: number;
  let tailCount: number;

  // 动态限制总行数
  const remaining1 = 12 - baseCount;
  midCount = rng.nextInt(0, Math.min(5, remaining1));
  const remaining2 = 12 - baseCount - midCount;
  tailCount = rng.nextInt(0, Math.min(5, remaining2));

  // single 布局：tail 必须为空
  if (layout === 'single') {
    tailCount = 0;
  }

  // 生成基表行
  const base: BaseRow[] = [];
  for (let i = 0; i < baseCount; i++) {
    const key = rng.nextChoice(KEY_POOL) as string | null;
    const amount = rng.nextInt(AMOUNT_MIN, AMOUNT_MAX);
    base.push({
      id: `a${index}_${i}`,
      key,
      amountCents: amount.toString(),
    });
  }

  // 生成中间表行
  const mid: MidRow[] = [];
  for (let i = 0; i < midCount; i++) {
    const parentKey = rng.nextChoice(KEY_POOL) as string | null;
    if (layout === 'chain') {
      const linkKey = rng.nextChoice(LINK_POOL) as string | null;
      mid.push({
        id: `b${index}_${i}`,
        parentKey,
        linkKey,
      });
    } else {
      mid.push({
        id: `b${index}_${i}`,
        parentKey,
      });
    }
  }

  // 生成尾表行（star 用 base.key，chain 用 mid.linkKey）
  const tail: TailRow[] = [];
  if (layout === 'star') {
    for (let i = 0; i < tailCount; i++) {
      const parentKey = rng.nextChoice(KEY_POOL) as string | null;
      tail.push({
        id: `c${index}_${i}`,
        parentKey,
      });
    }
  } else if (layout === 'chain') {
    for (let i = 0; i < tailCount; i++) {
      // chain 的 tail 通过 linkKey 连接，使用 LINK_POOL
      const parentKey = rng.nextChoice(LINK_POOL) as string | null;
      tail.push({
        id: `c${index}_${i}`,
        parentKey,
      });
    }
  }

  return {
    schema: 'joinwitness.scenario/v1',
    specVersion: '1.0.0',
    layout,
    title: `Random fixture #${index}`,
    source: 'synthetic',
    base,
    mid,
    tail,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 导出 1,000 个固定种子场景
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 生成固定的 1,000 个场景（固定种子，可重复）。
 *
 * 全局种子为 20261101（对应项目立项日期），每个场景使用独立的 LCG 实例，
 * 种子为 (GLOBAL_SEED + index * 6364136223846793005n) % 2^32，
 * 保证各场景相互独立且完全确定。
 */
export const FIXTURE_COUNT = 1000;
export const GLOBAL_SEED = 20261101;

/**
 * 为第 index 个场景计算确定性种子。
 */
function scenarioSeed(index: number): number {
  // 简单线性混合：确保不同 index 产生完全不同的序列
  return (GLOBAL_SEED + index * 1234567891) >>> 0;
}

/**
 * 惰性生成全部 1,000 个场景（节省内存）。
 */
export function generateAllFixtures(): Scenario[] {
  const scenarios: Scenario[] = [];
  for (let i = 0; i < FIXTURE_COUNT; i++) {
    const rng = new LCG(scenarioSeed(i));
    scenarios.push(generateRandomScenario(rng, i));
  }
  return scenarios;
}

/**
 * 生成第 index 个固定场景（0-based）。
 */
export function generateFixture(index: number): Scenario {
  const rng = new LCG(scenarioSeed(index));
  return generateRandomScenario(rng, index);
}
