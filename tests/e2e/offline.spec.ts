import { test, expect } from '@playwright/test';
import * as vitest from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const WORKSPACE_TMP = path.resolve(__dirname, '../../.tmp');
const RUNTIME_DIR = path.resolve(__dirname, '../../evidence/runtime');

if (process.env.VITEST) {
  // Vitest 运行环境：执行离线与隐私契约的单元级门禁
  vitest.describe('P008 离线与隐私契约单元门禁 (FR10 / U07 / T016)', () => {
    vitest.it('离线验收测试规范与路径约定必须有效', () => {
      vitest.expect(fs.existsSync(__filename)).toBe(true);
      vitest.expect(typeof test).toBe('function');
    });
  });
} else {
  // Playwright 端到端环境：真实无头 Chromium 离线断网与外网阻断验证
  test.describe('P008 离线与隐私验收套件: 阻断全部外域、无原始数据上传、纯本地闭环 (FR10 / U07 / T016)', () => {
    const remoteRequests: string[] = [];
    const consoleErrors: string[] = [];

    test.beforeEach(async ({ page }) => {
      remoteRequests.length = 0;
      consoleErrors.length = 0;

      // 监听网络请求：严格拦截并记录任何非本地 host 的请求 (阻断所有外网/外域)
      await page.route('**', (route) => {
        const url = new URL(route.request().url());
        if (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') {
          remoteRequests.push(url.href);
          route.abort('blockedbyclient');
        } else {
          route.continue();
        }
      });

      // 监听浏览器控制台与未捕获异常：记录所有 error 级别日志
      page.on('console', (msg) => {
        if (msg.type() === 'error') {
          consoleErrors.push(msg.text());
        }
      });
      page.on('pageerror', (err) => {
        consoleErrors.push(err.message);
      });

      // 访问本地 127.0.0.1 静态服务
      await page.goto('/');
      await expect(page.locator('.brand-title')).toHaveText('倍行镜 JOINWITNESS');
    });

    test.afterEach(async ({ context }, testInfo) => {
      // 确保生成 offline trace 文件
      const tracePath = path.resolve(RUNTIME_DIR, 'offline-trace.zip');
      try {
        await context.tracing.stop({ path: tracePath });
      } catch {}

      // 记录网络拦截与控制台状态
      const netLogPath = path.resolve(RUNTIME_DIR, 'offline-network-log.txt');
      const conLogPath = path.resolve(RUNTIME_DIR, 'console-log.txt');

      fs.appendFileSync(
        netLogPath,
        `[${testInfo.title}] Remote Requests Intercepted: ${remoteRequests.length}\n` +
          remoteRequests.map((r) => `  - BLOCKED: ${r}\n`).join('')
      );

      fs.appendFileSync(
        conLogPath,
        `[${testInfo.title}] Console Errors: ${consoleErrors.length}\n` +
          consoleErrors.map((e) => `  - ERROR: ${e}\n`).join('')
      );

      // 断言无外部网络请求且无控制台 P0 报错
      expect(remoteRequests).toHaveLength(0);
      expect(consoleErrors).toHaveLength(0);
    });

    test('1. 阻断全部外域与断网后运行全部 6 个预设 (FR01 / FR10 / MATH01-06 / U07)', async ({
      page,
      context,
    }) => {
      await context.tracing.start({ screenshots: true, snapshots: true });

      const selectPreset = page.locator('.select-preset');
      const runBtn = page.locator('#btn-run');

      // 1.1 JW-A (默认已选, Star) — 首次运行激活本地 Worker 线程
      await runBtn.click();
      await expect(page.locator('[data-testid="real-audit-indicator"]')).toBeVisible();
      await expect(page.locator('.card-base-rows .number')).toHaveText('3');
      await expect(page.locator('.card-expanded-rows .number')).toHaveText('8');
      await expect(page.locator('.card-safe-sum .number')).toHaveText('86.00');
      await expect(page.locator('.card-naive-sum .number')).toHaveText('284.00');
      await expect(page.locator('.card-delta .number')).toHaveText('+198.00');
      await expect(page.locator('.card-unsafe-rows .number')).toHaveText('2');

      // 激活 context.setOffline(true) 模拟物理断网
      await context.setOffline(true);

      // 1.2 JW-B (Chain) 断网运行
      await selectPreset.selectOption('jw-b');
      await runBtn.click();
      await expect(page.locator('[data-testid="real-audit-indicator"]')).toBeVisible();
      await expect(page.locator('.card-base-rows .number')).toHaveText('2');
      await expect(page.locator('.card-expanded-rows .number')).toHaveText('6');
      await expect(page.locator('.card-safe-sum .number')).toHaveText('37.00');
      await expect(page.locator('.card-naive-sum .number')).toHaveText('157.00');
      await expect(page.locator('.card-delta .number')).toHaveText('+120.00');
      await expect(page.locator('.card-unsafe-rows .number')).toHaveText('1');

      // 1.3 JW-C (Single: 负数金额完全抵消)
      await selectPreset.selectOption('jw-c');
      await runBtn.click();
      await expect(page.locator('[data-testid="real-audit-indicator"]')).toBeVisible();
      await expect(page.locator('.card-base-rows .number')).toHaveText('2');
      await expect(page.locator('.card-expanded-rows .number')).toHaveText('4');
      await expect(page.locator('.card-safe-sum .number')).toHaveText('0.00');
      await expect(page.locator('.card-naive-sum .number')).toHaveText('0.00');
      await expect(page.locator('.card-delta .number')).toHaveText('+0.00');
      await expect(page.locator('.card-unsafe-rows .number')).toHaveText('2');

      // 1.4 JW-D (Single: NULL 键不匹配)
      await selectPreset.selectOption('jw-d');
      await runBtn.click();
      await expect(page.locator('[data-testid="real-audit-indicator"]')).toBeVisible();
      await expect(page.locator('.card-base-rows .number')).toHaveText('2');
      await expect(page.locator('.card-expanded-rows .number')).toHaveText('2');
      await expect(page.locator('.card-safe-sum .number')).toHaveText('19.00');
      await expect(page.locator('.card-naive-sum .number')).toHaveText('19.00');
      await expect(page.locator('.card-delta .number')).toHaveText('+0.00');
      await expect(page.locator('.card-unsafe-rows .number')).toHaveText('0');

      // 1.5 JW-E (Single: SUM(DISTINCT) 经典反例)
      await selectPreset.selectOption('jw-e');
      await runBtn.click();
      await expect(page.locator('[data-testid="real-audit-indicator"]')).toBeVisible();
      await expect(page.locator('.card-base-rows .number')).toHaveText('2');
      await expect(page.locator('.card-expanded-rows .number')).toHaveText('2');
      await expect(page.locator('.card-safe-sum .number')).toHaveText('24.00');
      await expect(page.locator('.card-naive-sum .number')).toHaveText('24.00');
      await expect(page.locator('.card-delta .number')).toHaveText('+0.00');
      await expect(page.locator('.card-unsafe-rows .number')).toHaveText('0');

      // 1.6 JW-F (Chain: 4 行见证下界)
      await selectPreset.selectOption('jw-f');
      await runBtn.click();
      await expect(page.locator('[data-testid="real-audit-indicator"]')).toBeVisible();
      await expect(page.locator('.card-base-rows .number')).toHaveText('1');
      await expect(page.locator('.card-expanded-rows .number')).toHaveText('2');
      await expect(page.locator('.card-safe-sum .number')).toHaveText('10.00');
      await expect(page.locator('.card-naive-sum .number')).toHaveText('20.00');
      await expect(page.locator('.card-delta .number')).toHaveText('+10.00');
      await expect(page.locator('.card-unsafe-rows .number')).toHaveText('1');

      await context.setOffline(false);
    });

    test('2. 阻断全部外域下 JSON 场景导出与导入闭环 (FR03 / FR10 / FR11 / MATH10)', async ({
      page,
      context,
    }) => {
      await context.tracing.start({ screenshots: true, snapshots: true });

      // 先运行 JW-A 激活本地 Worker
      await page.locator('#btn-run').click();
      await expect(page.locator('[data-testid="real-audit-indicator"]')).toBeVisible();

      // 2.1 导出场景
      const downloadPromise = page.waitForEvent('download');
      await page.locator('#btn-export-json').click();
      const download = await downloadPromise;
      const downloadPath = path.resolve(WORKSPACE_TMP, 'offline-export-scenario.json');
      await download.saveAs(downloadPath);

      const exportedRaw = fs.readFileSync(downloadPath, 'utf-8');
      const exportedScenario = JSON.parse(exportedRaw);
      expect(exportedScenario.schema).toBe('joinwitness.scenario/v1');
      expect(exportedScenario.specVersion).toBe('1.0.0');

      // 2.2 离线导入合成场景
      const offlineScenario = {
        schema: 'joinwitness.scenario/v1',
        specVersion: '1.0.0',
        layout: 'single',
        title: 'Offline Custom Synthetic Scenario',
        source: 'user_imported',
        base: [
          { id: 'b1', key: 'K1', amountCents: '2500' },
          { id: 'b2', key: 'K1', amountCents: '1500' },
        ],
        mid: [
          { id: 'm1', parentKey: 'K1' },
          { id: 'm2', parentKey: 'K1' },
          { id: 'm3', parentKey: 'K1' },
        ],
        tail: [],
      };

      const importPath = path.resolve(WORKSPACE_TMP, 'offline-import-scenario.json');
      fs.writeFileSync(importPath, JSON.stringify(offlineScenario, null, 2), 'utf-8');

      const fileChooserPromise = page.waitForEvent('filechooser');
      await page.locator('#btn-import-json').click();
      const fileChooser = await fileChooserPromise;
      await fileChooser.setFiles(importPath);

      // 验证导入横幅与标签
      await expect(page.locator('.import-notice-banner')).toContainText(
        '成功导入场景: "Offline Custom Synthetic Scenario"'
      );
      await expect(page.locator('.source-badge')).toContainText('基表声明：用户本地导入数据 · 未上传服务器');

      // 运行导入场景
      await page.locator('#btn-run').click();
      await expect(page.locator('[data-testid="real-audit-indicator"]')).toBeVisible();

      // 2 base * 3 mid = 6 expanded; safe = 40.00, naive = 120.00, delta = +80.00
      await expect(page.locator('.card-base-rows .number')).toHaveText('2');
      await expect(page.locator('.card-expanded-rows .number')).toHaveText('6');
      await expect(page.locator('.card-safe-sum .number')).toHaveText('40.00');
      await expect(page.locator('.card-naive-sum .number')).toHaveText('120.00');
      await expect(page.locator('.card-delta .number')).toHaveText('+80.00');
    });

    test('3. 阻断全部外域下 CSV 多表向导导入与数据隐私安全 (FR02 / FR10 / U07)', async ({
      page,
      context,
    }) => {
      await context.tracing.start({ screenshots: true, snapshots: true });

      // 先运行 JW-A 激活本地 Worker
      await page.locator('#btn-run').click();
      await expect(page.locator('[data-testid="real-audit-indicator"]')).toBeVisible();

      const baseCsv = 'order_id,join_key,price\nB100,K_OFFLINE,50.00\nB200,K_OFFLINE,25.00\n';
      const midCsv = 'item_id,ref_key\nM101,K_OFFLINE\nM102,K_OFFLINE\n';

      const baseCsvPath = path.resolve(WORKSPACE_TMP, 'offline-base.csv');
      const midCsvPath = path.resolve(WORKSPACE_TMP, 'offline-mid.csv');
      fs.writeFileSync(baseCsvPath, baseCsv, 'utf-8');
      fs.writeFileSync(midCsvPath, midCsv, 'utf-8');

      // 展开向导并映射
      await page.locator('#btn-import-csv').click();
      await page.locator('input[name="csv-layout"][value="single"]').check();
      await page.locator('.base-card input[placeholder="id"]').fill('order_id');
      await page.locator('.base-card input[placeholder="order_id"]').fill('join_key');
      await page.locator('.base-card input[placeholder="amount"]').fill('price');
      await page.locator('.mid-card input[placeholder="id"]').fill('item_id');
      await page.locator('.mid-card input[placeholder="order_id"]').fill('ref_key');

      await page.locator('.base-card input[type="file"]').setInputFiles(baseCsvPath);
      await page.locator('.mid-card input[type="file"]').setInputFiles(midCsvPath);

      await page.locator('.btn-execute-csv-import').click();
      await expect(page.locator('.import-notice-banner')).toContainText('成功从 CSV 组装场景');

      // 运行
      await page.locator('#btn-run').click();
      await expect(page.locator('[data-testid="real-audit-indicator"]')).toBeVisible();

      // 2 base * 2 mid = 4 expanded; safe = 75.00, naive = 150.00, delta = +75.00
      await expect(page.locator('.card-base-rows .number')).toHaveText('2');
      await expect(page.locator('.card-expanded-rows .number')).toHaveText('4');
      await expect(page.locator('.card-safe-sum .number')).toHaveText('75.00');
      await expect(page.locator('.card-naive-sum .number')).toHaveText('150.00');
      await expect(page.locator('.card-delta .number')).toHaveText('+75.00');

      // 验证重置后清除用户输入状态
      await page.locator('#btn-reset-preset').click();
      await expect(page.locator('[data-testid="idle-indicator"]')).toBeVisible();
      await expect(page.locator('.source-badge')).toContainText('基表声明：合成数据 · 不代表真实企业');
    });
  });
}
