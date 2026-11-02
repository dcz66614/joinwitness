import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOT_DIR = path.resolve(__dirname, '../../evidence/screenshots');

test.describe('P008 E2E: 六个黄金预设全量覆盖与指标断言 (FR01 / MATH01-06 / U01-04)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.brand-title')).toHaveText('倍行镜 JOINWITNESS');
  });

  test('1. 默认 JW-A 双支路暴增 (Star 布局: 3→8 行, 86.00→284.00, +198.00, 3行见证)', async ({ page }) => {
    // 初始空闲态：指标全为占位符 '—'
    const idleIndicator = page.locator('[data-testid="idle-indicator"]');
    await expect(idleIndicator).toBeVisible();
    await expect(page.locator('.card-base-rows .number')).toHaveText('—');
    await expect(page.locator('.card-expanded-rows .number')).toHaveText('—');

    // 点击“运行连接”
    const runBtn = page.locator('#btn-run');
    await expect(runBtn).toBeEnabled();
    await runBtn.click();

    // 等待 Dedicated Web Worker 计算完成
    await expect(page.locator('[data-testid="real-audit-indicator"]')).toBeVisible();

    // 核心事实区六项指标断言 (MATH01 / U01)
    await expect(page.locator('.card-base-rows .number')).toHaveText('3');
    await expect(page.locator('.card-expanded-rows .number')).toHaveText('8');
    await expect(page.locator('.card-safe-sum .number')).toHaveText('86.00');
    await expect(page.locator('.card-naive-sum .number')).toHaveText('284.00');
    await expect(page.locator('.card-delta .number')).toHaveText('+198.00');
    await expect(page.locator('.card-unsafe-rows .number')).toHaveText('2');

    // 因子条形图断言
    await expect(page.locator('[data-testid="row-factor-o1"]')).toHaveText('4 份副本');
    await expect(page.locator('[data-testid="row-delta-o1"]')).toHaveText('+150.00');
    await expect(page.locator('[data-testid="row-branches-o1"]')).toContainText('(2 明细 × 2 支付)');

    await expect(page.locator('[data-testid="row-factor-o2"]')).toHaveText('3 份副本');
    await expect(page.locator('[data-testid="row-delta-o2"]')).toHaveText('+48.00');
    await expect(page.locator('[data-testid="row-branches-o2"]')).toContainText('(3 明细 × 1 支付)');

    await expect(page.locator('[data-testid="row-factor-o3"]')).toHaveText('1 份副本');
    await expect(page.locator('[data-testid="row-delta-o3"]')).toHaveText('+0.00');

    // 点击 o1 选中并验证高亮
    const rowO1 = page.locator('[data-testid="factor-bar-row-o1"]');
    await rowO1.click();
    await expect(rowO1).toHaveAttribute('aria-pressed', 'true');

    // 切换至 Tab 3: 最小反例见证集 (MATH06 / FR07)
    await page.locator('#tab-btn-witness').click();
    await expect(page.locator('.witness-meta-header')).toContainText('3 行');
    await expect(page.locator('.witness-meta-header')).toContainText('数值与结构双重见证');
    await expect(page.locator('.witness-evidence-box')).toContainText('o1');
    await expect(page.locator('.witness-evidence-box')).toContainText('i11');
    await expect(page.locator('.witness-evidence-box')).toContainText('i12');

    // 切换至 Tab 4: 粒度安全说明 (FR08)
    await page.locator('#tab-btn-granularity').click();
    await expect(page.locator('.granularity-explanation-card')).toBeVisible();
    await expect(page.locator('.granularity-explanation-card')).toContainText('SUM(DISTINCT amount) 无法彻底补救');

    // 保存 JW-A 截图
    await page.screenshot({ path: path.resolve(SCREENSHOT_DIR, 'e2e-jw-a-complete.png') });
  });

  test('2. JW-B 链式多对多展开 (Chain 布局: 2→6 行, 37.00→157.00, +120.00, a1 factor=5)', async ({ page }) => {
    // 切换预设为 JW-B
    const selectPreset = page.locator('.select-preset');
    await selectPreset.selectOption('jw-b');

    // 预设切换后立即触发 STALE 状态
    await expect(page.locator('[data-testid="stale-indicator"]')).toBeVisible();

    // 点击运行
    await page.locator('#btn-run').click();
    await expect(page.locator('[data-testid="real-audit-indicator"]')).toBeVisible();

    // MATH02 / FR05: Chain 布局核算，总行数 6，安全总额 37.00，失真 157.00，差额 +120.00
    await expect(page.locator('.card-base-rows .number')).toHaveText('2');
    await expect(page.locator('.card-expanded-rows .number')).toHaveText('6');
    await expect(page.locator('.card-safe-sum .number')).toHaveText('37.00');
    await expect(page.locator('.card-naive-sum .number')).toHaveText('157.00');
    await expect(page.locator('.card-delta .number')).toHaveText('+120.00');
    await expect(page.locator('.card-unsafe-rows .number')).toHaveText('1');

    // 验证 a1 为 5 份副本 (chain 级联累计非简单乘法)
    await expect(page.locator('[data-testid="row-factor-a1"]')).toHaveText('5 份副本');
    await expect(page.locator('[data-testid="row-delta-a1"]')).toHaveText('+120.00');
    await expect(page.locator('[data-testid="row-factor-a2"]')).toHaveText('1 份副本');
    await expect(page.locator('[data-testid="row-delta-a2"]')).toHaveText('+0.00');

    // 保存 JW-B 截图
    await page.screenshot({ path: path.resolve(SCREENSHOT_DIR, 'e2e-jw-b-chain.png') });
  });

  test('3. JW-C 负数金额完全抵消 (MATH03 / U04: 安全0.00, 错误0.00, 差额+0.00 但 unsafe=2)', async ({ page }) => {
    const selectPreset = page.locator('.select-preset');
    await selectPreset.selectOption('jw-c');
    await page.locator('#btn-run').click();
    await expect(page.locator('[data-testid="real-audit-indicator"]')).toBeVisible();

    // 数值核算：Δ=0，但 unsafeBaseRows=2 (x 与 y 各 2 份，金额 -30 与 +30 抵消)
    await expect(page.locator('.card-base-rows .number')).toHaveText('2');
    await expect(page.locator('.card-expanded-rows .number')).toHaveText('4');
    await expect(page.locator('.card-safe-sum .number')).toHaveText('0.00');
    await expect(page.locator('.card-naive-sum .number')).toHaveText('0.00');
    await expect(page.locator('.card-delta .number')).toHaveText('+0.00');
    await expect(page.locator('.card-unsafe-rows .number')).toHaveText('2');

    // 检查逐行审计中 x 与 y 的正负贡献
    await expect(page.locator('[data-testid="row-factor-x"]')).toHaveText('2 份副本');
    await expect(page.locator('[data-testid="row-delta-x"]')).toHaveText('-30.00');
    await expect(page.locator('[data-testid="row-factor-y"]')).toHaveText('2 份副本');
    await expect(page.locator('[data-testid="row-delta-y"]')).toHaveText('+30.00');

    // 切换至 Tab 2: 逐行审计表，检查百分比在 S_safe=0 时显示 N/A (U04)
    await page.locator('#tab-btn-audit').click();
    await expect(page.locator('[data-testid="audit-row-x"]')).toBeVisible();
    await expect(page.locator('[data-testid="audit-row-y"]')).toBeVisible();

    // 保存 JW-C 截图
    await page.screenshot({ path: path.resolve(SCREENSHOT_DIR, 'e2e-jw-c-negative.png') });
  });

  test('4. JW-D 孤立未连接与 SQL NULL (MATH04 / FR04: NULL 不连 NULL, 见证为 NONE)', async ({ page }) => {
    const selectPreset = page.locator('.select-preset');
    await selectPreset.selectOption('jw-d');
    await page.locator('#btn-run').click();
    await expect(page.locator('[data-testid="real-audit-indicator"]')).toBeVisible();

    // 2 行基表，LEFT JOIN 保留未匹配行，NULL 不连 NULL，无笛卡尔倍增
    await expect(page.locator('.card-base-rows .number')).toHaveText('2');
    await expect(page.locator('.card-expanded-rows .number')).toHaveText('2');
    await expect(page.locator('.card-safe-sum .number')).toHaveText('19.00');
    await expect(page.locator('.card-naive-sum .number')).toHaveText('19.00');
    await expect(page.locator('.card-delta .number')).toHaveText('+0.00');
    await expect(page.locator('.card-unsafe-rows .number')).toHaveText('0');

    // 切换至 Tab 3: 无倍行风险显示 NONE
    await page.locator('#tab-btn-witness').click();
    await expect(page.locator('[data-testid="witness-none"]')).toBeVisible();
    await expect(page.locator('[data-testid="witness-none"]')).toContainText('无倍行风险 (NONE)');

    // 保存 JW-D 截图
    await page.screenshot({ path: path.resolve(SCREENSHOT_DIR, 'e2e-jw-d-null.png') });
  });

  test('5. JW-E 单表左连接无倍行 (MATH05: SUM(DISTINCT) 经典反例解释)', async ({ page }) => {
    const selectPreset = page.locator('.select-preset');
    await selectPreset.selectOption('jw-e');
    await page.locator('#btn-run').click();
    await expect(page.locator('[data-testid="real-audit-indicator"]')).toBeVisible();

    // 2 行基表，各自金额均为 12.00，真实总额 24.00
    await expect(page.locator('.card-base-rows .number')).toHaveText('2');
    await expect(page.locator('.card-expanded-rows .number')).toHaveText('2');
    await expect(page.locator('.card-safe-sum .number')).toHaveText('24.00');
    await expect(page.locator('.card-naive-sum .number')).toHaveText('24.00');
    await expect(page.locator('.card-delta .number')).toHaveText('+0.00');
    await expect(page.locator('.card-unsafe-rows .number')).toHaveText('0');

    // 验证 Tab 4 明确解释两订单 12.00 真实为 24.00 的反例
    await page.locator('#tab-btn-granularity').click();
    await expect(page.locator('.counterexample-box')).toContainText('24.00 元');

    // 保存 JW-E 截图
    await page.screenshot({ path: path.resolve(SCREENSHOT_DIR, 'e2e-jw-e-distinct.png') });
  });

  test('6. JW-F 链式最小见证集示例 (MATH06: Chain 下界为 4 行见证)', async ({ page }) => {
    const selectPreset = page.locator('.select-preset');
    await selectPreset.selectOption('jw-f');
    await page.locator('#btn-run').click();
    await expect(page.locator('[data-testid="real-audit-indicator"]')).toBeVisible();

    // 切换至 Tab 3: 最小反例见证集
    await page.locator('#tab-btn-witness').click();
    await expect(page.locator('.witness-meta-header')).toContainText('4 行');
    await expect(page.locator('.witness-evidence-box')).toContainText('a');
    await expect(page.locator('.witness-evidence-box')).toContainText('b');
    await expect(page.locator('.witness-evidence-box')).toContainText('c1');
    await expect(page.locator('.witness-evidence-box')).toContainText('c2');

    // 测试“在工作台重新运行此最小见证集”功能
    const btnRunWitness = page.locator('[data-testid="btn-run-witness"]');
    await expect(btnRunWitness).toBeVisible();
    await btnRunWitness.click();

    // 运行重新加载的见证集场景
    await page.locator('#btn-run').click();
    await expect(page.locator('[data-testid="real-audit-indicator"]')).toBeVisible();
    await expect(page.locator('.card-base-rows .number')).toHaveText('1');
    await expect(page.locator('.card-expanded-rows .number')).toHaveText('2');

    // 保存 JW-F 截图
    await page.screenshot({ path: path.resolve(SCREENSHOT_DIR, 'e2e-jw-f-witness.png') });
  });
});
