import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKSPACE_TMP = path.resolve(__dirname, '../../.tmp');
const SCREENSHOT_DIR = path.resolve(__dirname, '../../evidence/screenshots');

test.describe('P008 E2E: CSV / JSON 导入导出与校验错误拦截 (FR02 / FR03 / FR11 / MATH10)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.brand-title')).toHaveText('倍行镜 JOINWITNESS');
  });

  test('1. JSON 场景导出契约测试 (FR11 / SCENARIO_SCHEMA: 验证 schema / specVersion / BigInt 字符串格式)', async ({
    page,
  }) => {
    // 监听下载事件
    const downloadPromise = page.waitForEvent('download');
    await page.locator('#btn-export-json').click();
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toBe('joinwitness-scenario.json');
    const downloadPath = path.resolve(WORKSPACE_TMP, 'downloaded-scenario.json');
    await download.saveAs(downloadPath);

    // 读取并验证导出的 JSON 契约
    const rawContent = fs.readFileSync(downloadPath, 'utf-8');
    const scenario = JSON.parse(rawContent);

    expect(scenario.schema).toBe('joinwitness.scenario/v1');
    expect(scenario.specVersion).toBe('1.0.0');
    expect(scenario.layout).toBe('star');
    expect(scenario.base).toHaveLength(3);
    expect(scenario.mid).toHaveLength(6);
    expect(scenario.tail).toHaveLength(3);

    // 严禁导出非十进制分整数字符串
    for (const b of scenario.base) {
      expect(typeof b.amountCents).toBe('string');
      expect(/^\d+$/.test(b.amountCents)).toBe(true);
    }
  });

  test('2. JSON 场景导入、数据来源标记与端到端运行 (FR03 / MATH10)', async ({ page }) => {
    const customScenario = {
      schema: 'joinwitness.scenario/v1',
      specVersion: '1.0.0',
      layout: 'single',
      title: 'E2E 自定义导入单表场景',
      source: 'user_imported',
      base: [
        { id: 'u1', key: 'UK1', amountCents: '5000' },
        { id: 'u2', key: 'UK1', amountCents: '2000' },
      ],
      mid: [
        { id: 'm1', parentKey: 'UK1' },
        { id: 'm2', parentKey: 'UK1' },
      ],
      tail: [],
    };

    const importFilePath = path.resolve(WORKSPACE_TMP, 'custom-e2e-import.json');
    fs.writeFileSync(importFilePath, JSON.stringify(customScenario, null, 2), 'utf-8');

    // 触发隐藏的 JSON 文件选择 input
    const fileChooserPromise = page.waitForEvent('filechooser');
    await page.locator('#btn-import-json').click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles(importFilePath);

    // 验证成功导入横幅与数据来源标签切换为用户导入 (FR08 / U07)
    await expect(page.locator('.import-notice-banner')).toContainText('成功导入场景: "E2E 自定义导入单表场景"');
    await expect(page.locator('.source-badge')).toContainText('基表声明：用户本地导入数据 · 未上传服务器');

    // 运行导入的场景并断言结果
    await page.locator('#btn-run').click();
    await expect(page.locator('[data-testid="real-audit-indicator"]')).toBeVisible();

    // 2 基表行 × 2 明细行 = 4 展开行；安全 70.00，失真 140.00，差额 +70.00
    await expect(page.locator('.card-base-rows .number')).toHaveText('2');
    await expect(page.locator('.card-expanded-rows .number')).toHaveText('4');
    await expect(page.locator('.card-safe-sum .number')).toHaveText('70.00');
    await expect(page.locator('.card-naive-sum .number')).toHaveText('140.00');
    await expect(page.locator('.card-delta .number')).toHaveText('+70.00');
    await expect(page.locator('.card-unsafe-rows .number')).toHaveText('2');

    // 验证重置预设功能
    const btnReset = page.locator('#btn-reset-preset');
    await expect(btnReset).toBeVisible();
    await btnReset.click();

    // 验证恢复为默认预设 JW-A 且状态重置为 IDLE
    await expect(page.locator('.source-badge')).toContainText('基表声明：合成数据 · 不代表真实企业');
    await expect(page.locator('[data-testid="idle-indicator"]')).toBeVisible();
    await expect(page.locator('.card-base-rows .number')).toHaveText('—');
  });

  test('3. CSV 向导多表映射导入与执行 (FR02 / U08)', async ({ page }) => {
    // 准备测试用 CSV 文件
    const baseCsv = 'order_id,join_key,price\nB1,K_ALPHA,15.50\nB2,K_ALPHA,30.00\n';
    const midCsv = 'item_id,ref_key\nM1,K_ALPHA\nM2,K_ALPHA\nM3,K_ALPHA\n';

    const baseCsvPath = path.resolve(WORKSPACE_TMP, 'e2e-base.csv');
    const midCsvPath = path.resolve(WORKSPACE_TMP, 'e2e-mid.csv');
    fs.writeFileSync(baseCsvPath, baseCsv, 'utf-8');
    fs.writeFileSync(midCsvPath, midCsv, 'utf-8');

    // 展开 CSV 导入向导面板
    await page.locator('#btn-import-csv').click();
    const wizardPanel = page.locator('#csv-mapping-wizard-panel');
    await expect(wizardPanel).toBeVisible();

    // 选择单表布局 (single)
    await page.locator('input[name="csv-layout"][value="single"]').check();

    // 填写映射字段 (Base 表)
    await page.locator('.base-card input[placeholder="id"]').fill('order_id');
    await page.locator('.base-card input[placeholder="order_id"]').fill('join_key');
    await page.locator('.base-card input[placeholder="amount"]').fill('price');

    // 填写映射字段 (Mid 表)
    await page.locator('.mid-card input[placeholder="id"]').fill('item_id');
    await page.locator('.mid-card input[placeholder="order_id"]').fill('ref_key');

    // 上传 Base CSV 文件
    const baseFileInput = page.locator('.base-card input[type="file"]');
    await baseFileInput.setInputFiles(baseCsvPath);
    await expect(page.locator('.base-card .file-loaded-tag')).toBeVisible();

    // 上传 Mid CSV 文件
    const midFileInput = page.locator('.mid-card input[type="file"]');
    await midFileInput.setInputFiles(midCsvPath);
    await expect(page.locator('.mid-card .file-loaded-tag')).toBeVisible();

    // 截图保存 CSV 向导填妥状态
    await page.screenshot({ path: path.resolve(SCREENSHOT_DIR, 'e2e-csv-wizard-filled.png') });

    // 点击“执行 CSV 映射并导入”
    await page.locator('.btn-execute-csv-import').click();

    // 验证成功导入横幅（匹配“成功从 CSV 组装场景”或“成功导入场景”）
    await expect(page.locator('.import-notice-banner')).toContainText('成功从 CSV 组装场景');

    // 点击运行连接
    await page.locator('#btn-run').click();
    await expect(page.locator('[data-testid="real-audit-indicator"]')).toBeVisible();

    // 计算验证：2 基表 × 3 明细 = 6 展开行；安全 45.50，失真 136.50，差额 +91.00
    await expect(page.locator('.card-base-rows .number')).toHaveText('2');
    await expect(page.locator('.card-expanded-rows .number')).toHaveText('6');
    await expect(page.locator('.card-safe-sum .number')).toHaveText('45.50');
    await expect(page.locator('.card-naive-sum .number')).toHaveText('136.50');
    await expect(page.locator('.card-delta .number')).toHaveText('+91.00');
    await expect(page.locator('.card-unsafe-rows .number')).toHaveText('2');
  });

  test('4. 非法 JSON / CSV 输入的校验错误拦截与修复指引 (FR03 / §4 / §8)', async ({ page }) => {
    // 构造非法 JSON (缺失 schema 契约)
    const invalidJsonPath = path.resolve(WORKSPACE_TMP, 'invalid-schema.json');
    fs.writeFileSync(invalidJsonPath, JSON.stringify({ someKey: 'invalidData' }), 'utf-8');

    // 导入非法 JSON
    const fileChooserPromise = page.waitForEvent('filechooser');
    await page.locator('#btn-import-json').click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles(invalidJsonPath);

    // 验证错误横条展示并包含修复建议
    const errorBanner = page.locator('.import-error-banner');
    await expect(errorBanner).toBeVisible();
    await expect(errorBanner).toContainText('JSON 导入错误');
    await expect(page.locator('.error-fix-hint')).toContainText('修复建议：请检查 CSV 行号/列名，确保 ID 唯一');

    // 构造重复 ID 的 JSON 场景测试
    const dupJsonPath = path.resolve(WORKSPACE_TMP, 'invalid-dup-id.json');
    fs.writeFileSync(
      dupJsonPath,
      JSON.stringify({
        schema: 'joinwitness.scenario/v1',
        specVersion: '1.0.0',
        layout: 'single',
        title: '重复 ID 场景',
        base: [
          { id: 'dup_1', key: 'k1', amountCents: '100' },
          { id: 'dup_1', key: 'k2', amountCents: '200' },
        ],
        mid: [],
        tail: [],
      }),
      'utf-8'
    );

    const dupFileChooserPromise = page.waitForEvent('filechooser');
    await page.locator('#btn-import-json').click();
    const dupChooser = await dupFileChooserPromise;
    await dupChooser.setFiles(dupJsonPath);

    await expect(errorBanner).toBeVisible();
    await expect(errorBanner).toContainText('DUPLICATE_ID');

    // 展开 CSV 向导测试未提供必要 CSV 文件时的校验拦截
    await page.locator('#btn-import-csv').click();
    await page.locator('input[name="csv-layout"][value="single"]').check();
    await page.locator('.btn-execute-csv-import').click();

    // 验证未选择 CSV 文件提示
    await expect(errorBanner).toBeVisible();
    await expect(errorBanner).toContainText('请先选择');
  });
});
