import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKSPACE_TMP = path.resolve(__dirname, '../../.tmp');
const SCREENSHOT_DIR = path.resolve(__dirname, '../../evidence/screenshots');

test.describe('P008 E2E: 旧消息淘汰、≤200 截断提示与纯离线运行 (FR09 / FR10 / MATH09 / U06 / U07)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.brand-title')).toHaveText('倍行镜 JOINWITNESS');
  });

  test('1. 参数变动旧消息淘汰与 STALE 防污染机制 (FR09 / §4)', async ({ page }) => {
    // 1. 运行 JW-A
    await page.locator('#btn-run').click();
    await expect(page.locator('[data-testid="real-audit-indicator"]')).toBeVisible();
    await expect(page.locator('.card-expanded-rows .number')).toHaveText('8');

    // 2. 切换预设至 JW-B：依据项目书 §4，修改输入立即使旧结果标为 STALE，清空过期图表
    const selectPreset = page.locator('.select-preset');
    await selectPreset.selectOption('jw-b');

    // 验证 STALE 标记即刻出现，数字区恢复为安全占位符 '—'，绝不继续陈列 JW-A 的旧数字
    const staleIndicator = page.locator('[data-testid="stale-indicator"]');
    await expect(staleIndicator).toBeVisible();
    await expect(staleIndicator).toContainText('STALE');
    await expect(page.locator('.card-base-rows .number')).toHaveText('—');
    await expect(page.locator('.card-expanded-rows .number')).toHaveText('—');
    await expect(page.locator('.card-safe-sum .number')).toHaveText('—');

    // 验证 FactorBars 同步进入 STALE 占位状态，绝不展示过期或推测数值 (R2-B07)
    await expect(page.locator('[data-testid="factor-bars-empty"]')).toBeVisible();
    await expect(page.locator('[data-testid="factor-bar-row-o1"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="factor-bar-row-a1"]')).toHaveCount(0);
    const staleBarsText = await page.locator('[data-testid="factor-bars"]').textContent();
    expect(staleBarsText).not.toContain('4 份副本');
    expect(staleBarsText).not.toContain('+150.00');

    // 保存 STALE 状态截图
    await page.screenshot({ path: path.resolve(SCREENSHOT_DIR, 'e2e-stale-state.png') });

    // 3. 快速连续切换并最终运行 JW-C
    await selectPreset.selectOption('jw-c');
    await page.locator('#btn-run').click();

    // 等待计算完成，验证呈现的仅为 JW-C 的真值 (0.00 / 0.00)，旧 Worker 消息不产生串版污染
    await expect(page.locator('[data-testid="real-audit-indicator"]')).toBeVisible();
    await expect(page.locator('.card-base-rows .number')).toHaveText('2');
    await expect(page.locator('.card-expanded-rows .number')).toHaveText('4');
    await expect(page.locator('.card-safe-sum .number')).toHaveText('0.00');
    await expect(page.locator('.card-naive-sum .number')).toHaveText('0.00');
  });

  test('2. 超过 200 行截断提示与精确全量分解式行数计算 (MATH09 / U06)', async ({ page }) => {
    // 构造具有 250 条物理连接展开行的场景 (超出 200 行上限)
    const midRows = Array.from({ length: 250 }, (_, i) => ({
      id: `m_${i + 1}`,
      parentKey: 'K_BIG',
    }));

    const bigScenario = {
      schema: 'joinwitness.scenario/v1',
      specVersion: '1.0.0',
      layout: 'single',
      title: '250行物化展开截断测试场景',
      source: 'synthetic',
      base: [{ id: 'b_main', key: 'K_BIG', amountCents: '10000' }],
      mid: midRows,
      tail: [],
    };

    const bigScenarioPath = path.resolve(WORKSPACE_TMP, 'big-scenario-250.json');
    fs.writeFileSync(bigScenarioPath, JSON.stringify(bigScenario, null, 2), 'utf-8');

    // 导入 250 行展开场景
    const fileChooserPromise = page.waitForEvent('filechooser');
    await page.locator('#btn-import-json').click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles(bigScenarioPath);

    // 运行连接
    await page.locator('#btn-run').click();
    await expect(page.locator('[data-testid="real-audit-indicator"]')).toBeVisible();

    // 事实区精准展示全量 250 行展开行 (全量分解式算法，绝不因预览截断少计)
    await expect(page.locator('.card-base-rows .number')).toHaveText('1');
    await expect(page.locator('.card-expanded-rows .number')).toHaveText('250');
    await expect(page.locator('.card-safe-sum .number')).toHaveText('100.00');
    await expect(page.locator('.card-naive-sum .number')).toHaveText('25000.00');
    await expect(page.locator('.card-delta .number')).toHaveText('+24900.00');

    // 进入 Tab 1: 原始行 ⇄ 预览 JOIN 行
    await page.locator('#tab-btn-preview').click();

    // 验证 ≤200 限制提示横幅 (U06 / MATH09)
    const limitBanner = page.locator('[data-testid="banner-limit-notice"]');
    await expect(limitBanner).toBeVisible();
    await expect(limitBanner).toContainText('已截断展示前 200 行');
    await expect(limitBanner).toContainText('全量共 250 行');
    await expect(limitBanner).toContainText('已省略后续物化，精确总行数仍按全量分解式计算');

    // 截图保存 200 行截断横幅证据
    await page.screenshot({ path: path.resolve(SCREENSHOT_DIR, 'e2e-truncation-200.png') });
  });

  test('3. 纯本地离线断网运行与零外部 API 请求保障 (FR10 / U07)', async ({ context, page }) => {
    // 监听网络请求，确保除本地同源静态资源外无任何外网或云 API 调用
    const remoteRequests: string[] = [];
    await page.route('**', (route) => {
      const url = new URL(route.request().url());
      if (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') {
        remoteRequests.push(url.href);
        route.abort();
      } else {
        route.continue();
      }
    });

    // 1. 本地运行 JW-A 初始化 Dedicated Worker 线程
    await page.locator('#btn-run').click();
    await expect(page.locator('[data-testid="real-audit-indicator"]')).toBeVisible();

    // 2. 模拟网络中断 (Offline)
    await context.setOffline(true);

    // 3. 在断网状态下切换至预设 JW-B 并再次运行连接
    await page.locator('.select-preset').selectOption('jw-b');
    await page.locator('#btn-run').click();

    // 验证断网状态下依然成功利用本地 Worker 完成链式计算
    await expect(page.locator('[data-testid="real-audit-indicator"]')).toBeVisible();
    await expect(page.locator('.card-expanded-rows .number')).toHaveText('6');
    await expect(page.locator('.card-delta .number')).toHaveText('+120.00');

    // 检查是否有任何外网通信逃逸
    expect(remoteRequests).toHaveLength(0);

    // 恢复网络状态
    await context.setOffline(false);
  });
});
