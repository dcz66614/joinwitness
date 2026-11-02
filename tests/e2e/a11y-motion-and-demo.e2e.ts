import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOT_DIR = path.resolve(__dirname, '../../evidence/screenshots');
const DEMO_DIR = path.resolve(__dirname, '../../evidence/demo');

test.describe('P008 E2E: 键盘无障碍、减少动态与两分钟演示证据 (U01-U08 / §3 / §4)', () => {
  test('1. 键盘导航与可见焦点交互验证 (U05)', async ({ page }) => {
    await page.goto('/');

    // 运行 JW-A
    await page.locator('#btn-run').click();
    await expect(page.locator('[data-testid="real-audit-indicator"]')).toBeVisible();

    // 1. 键盘切换底部标签页：聚焦 Tab 2 (逐行审计) 并按下 Enter
    const tabBtnAudit = page.locator('#tab-btn-audit');
    await tabBtnAudit.focus();
    await page.keyboard.press('Enter');
    await expect(tabBtnAudit).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#tabpanel-audit')).toBeVisible();

    // 键盘切换 Tab 3 (最小反例)
    const tabBtnWitness = page.locator('#tab-btn-witness');
    await tabBtnWitness.focus();
    await page.keyboard.press('Space');
    await expect(tabBtnWitness).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#tabpanel-witness')).toBeVisible();

    // 键盘切换 Tab 4 (粒度安全)
    const tabBtnGranularity = page.locator('#tab-btn-granularity');
    await tabBtnGranularity.focus();
    await page.keyboard.press('Enter');
    await expect(tabBtnGranularity).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#tabpanel-granularity')).toBeVisible();

    // 2. 键盘在倍行条形图 (FactorBars) 中导航并选中行 (Enter / Space)
    const rowO2 = page.locator('[data-testid="factor-bar-row-o2"]');
    await rowO2.focus();
    await page.keyboard.press('Enter');
    await expect(rowO2).toHaveAttribute('aria-pressed', 'true');

    const rowO3 = page.locator('[data-testid="factor-bar-row-o3"]');
    await rowO3.focus();
    await page.keyboard.press(' ');
    await expect(rowO3).toHaveAttribute('aria-pressed', 'true');

    // 保存键盘焦点交互截图
    await page.screenshot({ path: path.resolve(SCREENSHOT_DIR, 'e2e-keyboard-focus.png') });
  });

  test('2. 减少动态模式 (prefers-reduced-motion) 适配验证 (U02)', async ({ page }) => {
    // 模拟操作系统偏好设置：减少动态效果
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');

    // 运行分析
    await page.locator('#btn-run').click();
    await expect(page.locator('[data-testid="real-audit-indicator"]')).toBeVisible();

    // 验证 FactorBars 容器正确标记 data-reduced-motion="true"
    const factorBars = page.locator('[data-testid="factor-bars"]');
    await expect(factorBars).toHaveAttribute('data-reduced-motion', 'true');

    // 验证在动效关闭下，所有核心指标与因子数据依然 100% 完整准确呈现
    await expect(page.locator('.card-expanded-rows .number')).toHaveText('8');
    await expect(page.locator('[data-testid="row-factor-o1"]')).toHaveText('4 份副本');
    await expect(page.locator('[data-testid="row-factor-o2"]')).toHaveText('3 份副本');
    await expect(page.locator('[data-testid="row-factor-o3"]')).toHaveText('1 份副本');

    // 保存减少动态模式截图
    await page.screenshot({ path: path.resolve(SCREENSHOT_DIR, 'e2e-reduced-motion.png') });
  });

  test('3. 两分钟主流程演示脚本录屏与顺序截图 (0s–120s U01-U08 / §3)', async ({ browser }) => {
    // 创建独立录屏 BrowserContext，设定桌面 1440×900 视口规格并授权剪贴板权限
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      recordVideo: {
        dir: DEMO_DIR,
        size: { width: 1440, height: 900 },
      },
    });
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);

    const page = await context.newPage();
    await page.goto('/');

    // 【阶段 1: 0–20s】打开默认合成预设 JW-A，展示初始空闲态与 3 表拓扑
    await expect(page.locator('.brand-title')).toHaveText('倍行镜 JOINWITNESS');
    await expect(page.locator('.source-badge')).toContainText('基表声明：合成数据 · 不代表真实企业');
    await expect(page.locator('[data-testid="idle-indicator"]')).toBeVisible();
    await expect(page.locator('.card-base-rows .number')).toHaveText('—');
    await page.screenshot({ path: path.resolve(SCREENSHOT_DIR, 'demo-01-idle-jw-a.png') });
    await page.waitForTimeout(1000);

    // 【阶段 2: 20–45s】点击“运行连接”，观察 Dedicated Worker 计算结果与倍行条形图
    const runBtn = page.locator('#btn-run');
    await runBtn.click();
    await expect(page.locator('[data-testid="real-audit-indicator"]')).toBeVisible();

    // 验证核心事实卡片与条形图
    await expect(page.locator('.card-base-rows .number')).toHaveText('3');
    await expect(page.locator('.card-expanded-rows .number')).toHaveText('8');
    await expect(page.locator('.card-safe-sum .number')).toHaveText('86.00');
    await expect(page.locator('.card-naive-sum .number')).toHaveText('284.00');
    await expect(page.locator('.card-delta .number')).toHaveText('+198.00');
    await page.screenshot({ path: path.resolve(SCREENSHOT_DIR, 'demo-02-running-jw-a.png') });
    await page.waitForTimeout(1000);

    // 【阶段 3: 45–70s】点击单据 o1，追溯 2 条明细 × 2 条支付的乘法来源与高亮
    const rowO1 = page.locator('[data-testid="factor-bar-row-o1"]');
    await rowO1.click();
    await expect(rowO1).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('[data-testid="row-branches-o1"]')).toContainText('(2 明细 × 2 支付)');
    await page.screenshot({ path: path.resolve(SCREENSHOT_DIR, 'demo-03-select-row-o1.png') });
    await page.waitForTimeout(1000);

    // 【阶段 4: 70–100s】切换至 Tab 3“最小反例”，回放全局最少行数证明子集
    await page.locator('#tab-btn-witness').click();
    await expect(page.locator('#tabpanel-witness')).toBeVisible();
    await expect(page.locator('.witness-meta-header')).toContainText('3 行');
    await expect(page.locator('.callout-warn')).toContainText('这里证明发生倍行；并不证明明细记录应被删除');

    // 测试复制见证集 JSON
    const btnCopy = page.locator('[data-testid="btn-copy-witness"]');
    await btnCopy.click();
    await expect(btnCopy).toContainText('已复制');
    await page.screenshot({ path: path.resolve(SCREENSHOT_DIR, 'demo-04-minimal-witness.png') });
    await page.waitForTimeout(1000);

    // 【阶段 5: 100–110s】切换至 Tab 4“粒度安全说明”，解释基表粒度与 SUM(DISTINCT) 缺陷
    await page.locator('#tab-btn-granularity').click();
    await expect(page.locator('#tabpanel-granularity')).toBeVisible();
    await expect(page.locator('.counterexample-box')).toBeVisible();
    await page.screenshot({ path: path.resolve(SCREENSHOT_DIR, 'demo-05-granularity-explanation.png') });
    await page.waitForTimeout(1000);

    // 【阶段 6: 110–120s】切换 JW-B 链式、JW-C 负额抵消与 CSV 向导，导出 JSON
    // 切换 JW-B
    await page.locator('.select-preset').selectOption('jw-b');
    await page.locator('#btn-run').click();
    await expect(page.locator('[data-testid="real-audit-indicator"]')).toBeVisible();
    await expect(page.locator('.card-expanded-rows .number')).toHaveText('6');
    await page.screenshot({ path: path.resolve(SCREENSHOT_DIR, 'demo-06-jw-b-chain.png') });
    await page.waitForTimeout(800);

    // 切换 JW-C
    await page.locator('.select-preset').selectOption('jw-c');
    await page.locator('#btn-run').click();
    await expect(page.locator('[data-testid="real-audit-indicator"]')).toBeVisible();
    await expect(page.locator('.card-delta .number')).toHaveText('+0.00');
    await expect(page.locator('.card-unsafe-rows .number')).toHaveText('2');
    await page.screenshot({ path: path.resolve(SCREENSHOT_DIR, 'demo-07-jw-c-negative-cancel.png') });
    await page.waitForTimeout(800);

    // 展开 CSV 向导
    await page.locator('#btn-import-csv').click();
    await expect(page.locator('#csv-mapping-wizard-panel')).toBeVisible();
    await page.screenshot({ path: path.resolve(SCREENSHOT_DIR, 'demo-08-csv-wizard.png') });
    await page.waitForTimeout(800);

    // 关闭页面并保存两分钟演示视频
    const video = page.video();
    await page.close();
    await context.close();

    if (video) {
      const targetVideoPath = path.resolve(DEMO_DIR, 'joinwitness-two-minute-walkthrough.webm');
      await video.saveAs(targetVideoPath);
      expect(fs.existsSync(targetVideoPath)).toBe(true);
      const stat = fs.statSync(targetVideoPath);
      expect(stat.size).toBeGreaterThan(1000);

      // 清理 Playwright 上下文生成的临时未命名视频文件
      try {
        const rawVideoPath = await video.path();
        if (rawVideoPath && fs.existsSync(rawVideoPath) && rawVideoPath !== targetVideoPath) {
          fs.unlinkSync(rawVideoPath);
        }
      } catch {
        // 忽略清理异常
      }
    }
  });
});
