import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import { chromium } from '@playwright/test';

import type { Scenario, Audit } from '../../src/core/types.js';
import { analyze } from '../../src/core/analyze.js';
import { computeAmountAudit } from '../../src/core/amount.js';
import { GraphView } from '../../src/ui/GraphView.js';
import { FactorBars, formatSignedDelta } from '../../src/ui/FactorBars.js';

// 导入冻结预设测试数据
import jwA from '../../src/fixtures/jw-a.json' with { type: 'json' };
import jwB from '../../src/fixtures/jw-b.json' with { type: 'json' };
import jwD from '../../src/fixtures/jw-d.json' with { type: 'json' };
import jwE from '../../src/fixtures/jw-e.json' with { type: 'json' };

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const STYLES_PATH = path.resolve(__dirname, '../../src/styles.css');
const EVIDENCE_DIR = path.resolve(__dirname, '../../evidence');
const WORKSPACE_TMP = path.resolve(__dirname, '../../.tmp');

// 将临时目录指到工作区磁盘，避免 /tmp 512MB tmpfs 溢出
process.env.TMPDIR = WORKSPACE_TMP;

describe('P008-T012 连接拓扑 SVG 与倍增条形证据 (GraphView & FactorBars)', () => {
  describe('1. 拓扑与表映射 (GraphView) — 2/3 表结构与实际 JOIN 键', () => {
    it('JW-A: 渲染星型双支路 (Star) 3 表拓扑及实际 JOIN 键', async () => {
      const scenario = jwA as unknown as Scenario;
      const audit = await analyze(scenario);

      const html = renderToString(
        <GraphView scenario={scenario} audit={audit} selectedRowId="o1" />
      );

      // 验证 3 表节点
      expect(html).toContain('[A orders]');
      expect(html).toContain('[B items]');
      expect(html).toContain('[C payments]');

      // 验证表行数
      expect(html).toContain(`基表 · ${scenario.base.length} 行`);
      expect(html).toContain(`第二表 · ${scenario.mid.length} 行`);
      expect(html).toContain(`第三表 · ${scenario.tail.length} 行`);

      // 验证实际 JOIN 键条件
      expect(html).toContain('A.key = B.parentKey');
      expect(html).toContain('A.key = C.parentKey');

      // 验证 LEFT JOIN 规则说明
      expect(html).toContain('LEFT JOIN 规则说明：');
      expect(html).toContain('未匹配行保留为 NULL；空值键 (NULL) 互不相连 (遵循 SQL = 严格语义)。');
    });

    it('JW-B: 渲染链式级联 (Chain) 3 表拓扑及一跳/二跳关联键', async () => {
      const scenario = jwB as unknown as Scenario;
      const audit = await analyze(scenario);

      const html = renderToString(
        <GraphView scenario={scenario} audit={audit} selectedRowId="a1" />
      );

      expect(html).toContain('链式级联 (Chain)');
      expect(html).toContain('[A orders]');
      expect(html).toContain('[B items]');
      expect(html).toContain('[C shipments]');
      expect(html).toContain('A.key=B.parent');
      expect(html).toContain('B.link=C.parent');
    });

    it('JW-E: 渲染单表关联 (Single) 2 表拓扑，不呈现第三表', async () => {
      const scenario = jwE as unknown as Scenario;
      const audit = await analyze(scenario);

      const html = renderToString(
        <GraphView scenario={scenario} audit={audit} />
      );

      expect(html).toContain('单表关联 (Single)');
      expect(html).toContain('[A orders]');
      expect(html).toContain('[B items]');
      expect(html).not.toContain('[C payments]');
      expect(html).not.toContain('[C shipments]');
      expect(html).toContain('A.key = B.parentKey');
    });

    it('JW-D: 正确指示 NULL 键隔离与未连接状态', async () => {
      const scenario = jwD as unknown as Scenario;
      const audit = await analyze(scenario);

      const html = renderToString(
        <GraphView scenario={scenario} audit={audit} selectedRowId="n" />
      );

      // n 为空值键 NULL
      expect(html).toContain('高亮基表行: n (实际 JOIN 键: NULL)');
      expect(html).toContain('空值键 (NULL) 互不相连');
    });
  });

  describe('2. A 行交互选择与支路高亮联动 (GraphView)', () => {
    it('JW-A: 选中 o1 时精确高亮 2 明细 × 2 支付，展开因子 4', async () => {
      const scenario = jwA as unknown as Scenario;
      const audit = await analyze(scenario);

      const html = renderToString(
        <GraphView scenario={scenario} audit={audit} selectedRowId="o1" />
      );

      expect(html).toContain('高亮基表行: o1 (实际 JOIN 键: O1)');
      expect(html).toContain('展开因子: 4 倍');
      expect(html).toContain('支路 1: 2 行匹配');
      expect(html).toContain('支路 2: 2 行匹配');
      expect(html).toContain('2 × 2 = 4 份');
      expect(html).toContain('is-active');
    });

    it('JW-A: 选中 o2 时精确高亮 3 明细 × 1 支付，展开因子 3', async () => {
      const scenario = jwA as unknown as Scenario;
      const audit = await analyze(scenario);

      const html = renderToString(
        <GraphView scenario={scenario} audit={audit} selectedRowId="o2" />
      );

      expect(html).toContain('高亮基表行: o2 (实际 JOIN 键: O2)');
      expect(html).toContain('展开因子: 3 倍');
      expect(html).toContain('支路 1: 3 行匹配');
      expect(html).toContain('支路 2: 1 行匹配');
      expect(html).toContain('3 × 1 = 3 份');
    });

    it('JW-A: 选中 o3 时支路 2 未匹配，保留 1 份 NULL，展开因子 1', async () => {
      const scenario = jwA as unknown as Scenario;
      const audit = await analyze(scenario);

      const html = renderToString(
        <GraphView scenario={scenario} audit={audit} selectedRowId="o3" />
      );

      expect(html).toContain('高亮基表行: o3 (实际 JOIN 键: O3)');
      expect(html).toContain('展开因子: 1 倍');
      expect(html).toContain('支路 1: 1 行匹配');
      expect(html).toContain('支路 2: 0 行匹配 (LEFT JOIN 垫底 1 份 NULL)');
    });

    it('B01 Regression: chain layout with empty string linkKey ("") displays matching tail rows and factor 2', async () => {
      const scenario: Scenario = {
        schema: 'joinwitness.scenario/v1',
        specVersion: '1.0.0',
        layout: 'chain',
        title: 'Chain Empty String LinkKey',
        source: 'synthetic',
        base: [{ id: 'a1', key: 'k1', amountCents: '1000' }],
        mid: [{ id: 'b1', parentKey: 'k1', linkKey: '' }],
        tail: [
          { id: 'c1', parentKey: '' },
          { id: 'c2', parentKey: '' },
        ],
      };
      const audit = await analyze(scenario);

      const html = renderToString(
        <GraphView scenario={scenario} audit={audit} selectedRowId="a1" />
      );

      expect(html).toContain('展开因子: 2 倍');
      expect(html).toContain('支路 1: 1 行匹配');
      expect(html).toContain('第二跳: 2（路径数）');
      expect(html).toContain('路径数（同 C 行被多条 B 命中时重复计）');
      expect(html).toContain('计算逻辑 (求和): 2 = 2 份 (b1: 2 尾匹配)');
      expect(html).not.toContain('1 × 2');
      expect(html).not.toContain('×');
    });

    it('B01 Regression: chain layout with NULL linkKey does not match tail rows and shows factor 1', async () => {
      const scenario: Scenario = {
        schema: 'joinwitness.scenario/v1',
        specVersion: '1.0.0',
        layout: 'chain',
        title: 'Chain NULL LinkKey Control',
        source: 'synthetic',
        base: [{ id: 'a1', key: 'k1', amountCents: '1000' }],
        mid: [{ id: 'b1', parentKey: 'k1', linkKey: null }],
        tail: [
          { id: 'c1', parentKey: null },
          { id: 'c2', parentKey: null },
        ],
      };
      const audit = await analyze(scenario);

      const html = renderToString(
        <GraphView scenario={scenario} audit={audit} selectedRowId="a1" />
      );

      expect(html).toContain('展开因子: 1 倍');
      expect(html).toContain('支路 1: 1 行匹配');
      expect(html).toContain('第二跳: 0（路径数）');
      expect(html).toContain('LEFT JOIN 垫底 1 份 NULL');
    });
  });

  describe('3. 倍增条形与金额差额证据 (FactorBars) — JW-A 4/3/1 倍验证', () => {
    it('JW-A: 严格呈现 4/3/1 倍率证据与对应 A 行 ID (o1, o2, o3)', async () => {
      const scenario = jwA as unknown as Scenario;
      const audit = await analyze(scenario);

      const html = renderToString(
        <FactorBars scenario={scenario} audit={audit} selectedRowId="o1" />
      );

      // 验证 3 条基表行均在位
      expect(html).toContain('data-row-id="o1"');
      expect(html).toContain('data-row-id="o2"');
      expect(html).toContain('data-row-id="o3"');

      // 验证 o1: 4 份副本, 2明细x2支付, 原50.00, 差额+150.00
      expect(html).toContain('4 份副本');
      expect(html).toContain('(2 明细 × 2 支付)');
      expect(html).toContain('原: 50.00');
      expect(html).toContain('+150.00');

      // 验证 o2: 3 份副本, 3明细x1支付, 原24.00, 差额+48.00
      expect(html).toContain('3 份副本');
      expect(html).toContain('(3 明细 × 1 支付)');
      expect(html).toContain('原: 24.00');
      expect(html).toContain('+48.00');

      // 验证 o3: 1 份副本, 1明细x0支付, 原12.00, 差额+0.00
      expect(html).toContain('1 份副本');
      expect(html).toContain('原: 12.00');
      expect(html).toContain('+0.00');

      // 验证色调区分 (U04): o1/o2 为琥珀色警告 (fill-amber / text-amber), o3 为青绿安全色 (fill-teal / text-teal)
      expect(html).toContain('fill-amber');
      expect(html).toContain('fill-teal');
    });

    it('选中 o1 时展示完整的乘法分解追溯与百分比差额', async () => {
      const scenario = jwA as unknown as Scenario;
      const audit = await analyze(scenario);

      const html = renderToString(
        <FactorBars scenario={scenario} audit={audit} selectedRowId="o1" />
      );

      expect(html).toContain('基表原额: <strong>50.00</strong>');
      expect(html).toContain('错误展开额: <strong>200.00</strong>');
      expect(html).toContain('偏差: +150.00 (+300.00%)');
      expect(html).toContain('乘法追溯：支路1 [2 条] × 支路2 [2 份] = 4 份重复记录');
    });

    it('货币差额格式化辅助函数 formatSignedDelta 处理正/负/零', () => {
      expect(formatSignedDelta('15000')).toBe('+150.00');
      expect(formatSignedDelta('4800')).toBe('+48.00');
      expect(formatSignedDelta('0')).toBe('+0.00');
      expect(formatSignedDelta('-5000')).toBe('-50.00');
    });
  });

  describe('4. 零静态硬编码保证 (所有数据由 props 纯实算)', () => {
    it('接收任意合成自定义场景时，FactorBars 完全动态反映新倍率 (如 5 倍与 7 倍)', () => {
      const customScenario: Scenario = {
        schema: 'joinwitness.scenario/v1',
        specVersion: '1.0.0',
        layout: 'star',
        title: 'Dynamic Test Scenario',
        source: 'synthetic',
        base: [
          { id: 'custom-1', key: 'K1', amountCents: '1000' },
          { id: 'custom-2', key: 'K2', amountCents: '2000' },
        ],
        mid: [
          // K1 有 5 条明细
          { id: 'm1', parentKey: 'K1' },
          { id: 'm2', parentKey: 'K1' },
          { id: 'm3', parentKey: 'K1' },
          { id: 'm4', parentKey: 'K1' },
          { id: 'm5', parentKey: 'K1' },
          // K2 有 7 条明细
          { id: 'm6', parentKey: 'K2' },
          { id: 'm7', parentKey: 'K2' },
          { id: 'm8', parentKey: 'K2' },
          { id: 'm9', parentKey: 'K2' },
          { id: 'm10', parentKey: 'K2' },
          { id: 'm11', parentKey: 'K2' },
          { id: 'm12', parentKey: 'K2' },
        ],
        tail: [],
      };

      const computedAudit = computeAmountAudit(customScenario);
      const html = renderToString(
        <FactorBars scenario={customScenario} audit={computedAudit as unknown as Audit} />
      );

      // 动态倍率应为 5 份与 7 份
      expect(html).toContain('data-row-id="custom-1"');
      expect(html).toContain('5 份副本');
      expect(html).toContain('data-row-id="custom-2"');
      expect(html).toContain('7 份副本');
      // 差额验证: custom-1: 10.00 * (5 - 1) = +40.00; custom-2: 20.00 * (7 - 1) = +120.00
      expect(html).toContain('+40.00');
      expect(html).toContain('+120.00');
    });
  });

  describe('5. 减少动态模式 (reducedMotion / U02)', () => {
    it('当 reducedMotion=true 时，组件标记 data-reduced-motion="true" 并展示指示标记', async () => {
      const scenario = jwA as unknown as Scenario;
      const audit = await analyze(scenario);

      const graphHtml = renderToString(
        <GraphView scenario={scenario} audit={audit} reducedMotion={true} />
      );
      const factorHtml = renderToString(
        <FactorBars scenario={scenario} audit={audit} reducedMotion={true} />
      );

      expect(graphHtml).toContain('data-reduced-motion="true"');
      expect(graphHtml).toContain('减少动态模式');
      expect(factorHtml).toContain('data-reduced-motion="true"');
      expect(factorHtml).toContain('静态显示 (减少动效)');

      // 减少动态模式下所有事实数据依然完备 (U02: 暂停或减少动态效果不损信息)
      expect(factorHtml).toContain('4 份副本');
      expect(factorHtml).toContain('+150.00');
      expect(factorHtml).toContain('3 份副本');
      expect(factorHtml).toContain('+48.00');
    });
  });

  describe('6. 屏幕阅读器可访问性支持 (U05)', () => {
    it('FactorBars 包含无障碍替代表格，包含全部行、倍率与金额明细', async () => {
      const scenario = jwA as unknown as Scenario;
      const audit = await analyze(scenario);

      const html = renderToString(<FactorBars scenario={scenario} audit={audit} />);

      expect(html).toContain('<table class="sr-only"');
      expect(html).toContain('基表各行因多对多连接产生的重复倍数与金额偏差归因表');
      expect(html).toContain('<td>o1</td><td>4</td><td>2</td><td>2</td><td>50.00</td><td>200.00</td><td>+150.00</td>');
      expect(html).toContain('<td>o2</td><td>3</td><td>3</td><td>1</td><td>24.00</td><td>72.00</td><td>+48.00</td>');
      expect(html).toContain('<td>o3</td><td>1</td><td>1</td><td>0</td><td>12.00</td><td>12.00</td><td>+0.00</td>');
    });

    it('GraphView 包含 SVG 语义角标与文本降级说明', async () => {
      const scenario = jwA as unknown as Scenario;
      const audit = await analyze(scenario);

      const html = renderToString(<GraphView scenario={scenario} audit={audit} selectedRowId="o1" />);

      expect(html).toContain('role="img"');
      expect(html).toContain('<title>连接拓扑图：');
      expect(html).toContain('<desc>');
      expect(html).toContain('当前选中基表行 o1，连接键为 O1');
    });
  });

  describe('7. Playwright 视觉证据渲染与视口截图 (1440×900 桌面与窄屏)', () => {
    it('在 1440×900 桌面视口下渲染 GraphView 与 FactorBars 双栏，生成 JW-A 4/3/1 倍 UI 证据截图', async () => {
      const scenario = jwA as unknown as Scenario;
      const audit = await analyze(scenario);

      const css = fs.readFileSync(STYLES_PATH, 'utf-8');
      const graphHtml = renderToString(
        <GraphView scenario={scenario} audit={audit} selectedRowId="o1" />
      );
      const factorHtml = renderToString(
        <FactorBars scenario={scenario} audit={audit} selectedRowId="o1" />
      );

      const fullHtml = `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>P008-T012 连接拓扑与倍率条形证据</title>
    <style>
      ${css}
      body {
        background-color: #0b1120;
        color: #f8fafc;
        padding: 24px;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      }
      .test-container {
        max-width: 1380px;
        margin: 0 auto;
      }
    </style>
  </head>
  <body>
    <div class="test-container">
      <h2 style="font-size: 18px; margin-bottom: 16px; color: #38bdf8;">
        P008-T012 连接拓扑 SVG 与倍率条形证据验证 (JW-A: 4/3/1 倍)
      </h2>
      <section class="workbench-split-grid" aria-label="双栏工作台">
        ${graphHtml}
        ${factorHtml}
      </section>
    </div>
  </body>
</html>`;

      const browser = await chromium.launch({
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      });

      try {
        const page = await browser.newPage({
          viewport: { width: 1440, height: 900 },
        });
        await page.setContent(fullHtml, { waitUntil: 'domcontentloaded' });

        const metrics = await page.evaluate(() => ({
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
          hasOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        }));

        console.log('[EVIDENCE][T012_DESKTOP_1440x900] Overflow metrics:', metrics);
        expect(metrics.hasOverflow).toBe(false);

        const shotPath = path.join(EVIDENCE_DIR, 't012-graph-factor-jw-a.png');
        await page.screenshot({ path: shotPath, fullPage: false });
        console.log(`[EVIDENCE][SCREENSHOT] Saved T012 JW-A UI screenshot to ${shotPath}`);
        expect(fs.existsSync(shotPath)).toBe(true);

        // 验证 DOM 节点中的 4/3/1 倍实算证据
        const o1Factor = await page.textContent('[data-testid="row-factor-o1"]');
        const o2Factor = await page.textContent('[data-testid="row-factor-o2"]');
        const o3Factor = await page.textContent('[data-testid="row-factor-o3"]');
        expect(o1Factor).toContain('4 份副本');
        expect(o2Factor).toContain('3 份副本');
        expect(o3Factor).toContain('1 份副本');

        const o1Delta = await page.textContent('[data-testid="row-delta-o1"]');
        expect(o1Delta).toBe('+150.00');
      } finally {
        await browser.close();
      }
    });

    it('在减少动态模式 (reducedMotion) 下渲染并输出证据截图', async () => {
      const scenario = jwA as unknown as Scenario;
      const audit = await analyze(scenario);

      const css = fs.readFileSync(STYLES_PATH, 'utf-8');
      const graphHtml = renderToString(
        <GraphView scenario={scenario} audit={audit} selectedRowId="o1" reducedMotion={true} />
      );
      const factorHtml = renderToString(
        <FactorBars scenario={scenario} audit={audit} selectedRowId="o1" reducedMotion={true} />
      );

      const fullHtml = `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>P008-T012 减少动态模式验证</title>
    <style>
      ${css}
      body {
        background-color: #0b1120;
        color: #f8fafc;
        padding: 24px;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      }
      .test-container {
        max-width: 1380px;
        margin: 0 auto;
      }
    </style>
  </head>
  <body>
    <div class="test-container">
      <h2 style="font-size: 18px; margin-bottom: 16px; color: #94a3b8;">
        P008-T012 减少动态效果模式 (Reduced Motion)
      </h2>
      <section class="workbench-split-grid" aria-label="双栏工作台">
        ${graphHtml}
        ${factorHtml}
      </section>
    </div>
  </body>
</html>`;

      const browser = await chromium.launch({
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      });

      try {
        const page = await browser.newPage({
          viewport: { width: 1440, height: 900 },
        });
        await page.setContent(fullHtml, { waitUntil: 'domcontentloaded' });

        const shotPath = path.join(EVIDENCE_DIR, 't012-reduced-motion.png');
        await page.screenshot({ path: shotPath, fullPage: false });
        console.log(`[EVIDENCE][SCREENSHOT] Saved T012 Reduced Motion screenshot to ${shotPath}`);
        expect(fs.existsSync(shotPath)).toBe(true);

        // 验证减少动态标记
        const indicator = await page.textContent('[data-testid="reduced-motion-indicator"]');
        expect(indicator).toContain('减少动态模式');
      } finally {
        await browser.close();
      }
    });

    it('在 768×1024 窄屏视口下纵向堆叠，无横向溢出', async () => {
      const scenario = jwA as unknown as Scenario;
      const audit = await analyze(scenario);

      const css = fs.readFileSync(STYLES_PATH, 'utf-8');
      const graphHtml = renderToString(
        <GraphView scenario={scenario} audit={audit} selectedRowId="o2" />
      );
      const factorHtml = renderToString(
        <FactorBars scenario={scenario} audit={audit} selectedRowId="o2" />
      );

      const fullHtml = `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>P008-T012 窄屏响应式验证</title>
    <style>
      ${css}
      body {
        background-color: #0b1120;
        color: #f8fafc;
        padding: 12px;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      }
      .test-container {
        width: 100%;
      }
    </style>
  </head>
  <body>
    <div class="test-container">
      <section class="workbench-split-grid" aria-label="双栏工作台">
        ${graphHtml}
        ${factorHtml}
      </section>
    </div>
  </body>
</html>`;

      const browser = await chromium.launch({
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      });

      try {
        const page = await browser.newPage({
          viewport: { width: 768, height: 1024 },
        });
        await page.setContent(fullHtml, { waitUntil: 'domcontentloaded' });

        const metrics = await page.evaluate(() => ({
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
          hasOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        }));

        console.log('[EVIDENCE][T012_NARROW_768x1024] Overflow metrics:', metrics);
        expect(metrics.hasOverflow).toBe(false);

        const shotPath = path.join(EVIDENCE_DIR, 't012-ui-narrow.png');
        await page.screenshot({ path: shotPath, fullPage: false });
        console.log(`[EVIDENCE][SCREENSHOT] Saved T012 narrow screenshot to ${shotPath}`);
        expect(fs.existsSync(shotPath)).toBe(true);
      } finally {
        await browser.close();
      }
    });
  });

  describe('8. B02 链式 JOIN 因子求和归因与未分析态无推测值回归测试 (FIX-R1-02)', () => {
    it('JW-B GraphView: 链式归因显示求和语义 (2 + 3 = 5)，标注各中行尾匹配数，绝不出现乘法表达式', async () => {
      const scenario = jwB as unknown as Scenario;
      const audit = await analyze(scenario);

      const html = renderToString(
        <GraphView scenario={scenario} audit={audit} selectedRowId="a1" />
      );

      // 验证因子为真实因子 5 倍
      expect(html).toContain('展开因子: 5 倍');
      // 验证求和归因与中行尾匹配数标注
      expect(html).toContain('计算逻辑 (求和): 2 + 3 = 5 份 (b1: 2 尾匹配, b2: 3 尾匹配)');
      expect(html).toContain('求和');
      expect(html).toContain('2 + 3 = 5');
      expect(html).toContain('b1: 2 尾匹配');
      expect(html).toContain('b2: 3 尾匹配');
      // 绝不出现乘法或错误乘积 2 × 5
      expect(html).not.toContain('×');
      expect(html).not.toContain('2 × 5');
    });

    it('JW-B GraphView: 未分析态 (无 audit) 绝不显示推测因子 (显示占位符 —，无因子数值 10 或 5)', async () => {
      const scenario = jwB as unknown as Scenario;

      const html = renderToString(
        <GraphView scenario={scenario} audit={null} selectedRowId="a1" />
      );

      // 验证占位符
      expect(html).toContain('展开因子: —');
      expect(html).toContain('计算逻辑: — (未分析)');
      expect(html).toContain('尚未运行连接分析。');
      // 绝不显示推测假值 10 或 5
      expect(html).not.toContain('展开因子: 10 倍');
      expect(html).not.toContain('展开因子: 5 倍');
      expect(html).not.toContain('2 × 5');
      expect(html).not.toContain('10 份');
    });

    it('JW-B FactorBars: 链式归因文本含求和追溯与各中行尾匹配数，不含乘法', async () => {
      const scenario = jwB as unknown as Scenario;
      const audit = await analyze(scenario);

      const html = renderToString(
        <FactorBars scenario={scenario} audit={audit} selectedRowId="a1" />
      );

      expect(html).toContain('5 份副本');
      expect(html).toContain('(2 中行 · 级联 5 尾行)');
      expect(html).toContain(
        '求和追溯：各中行尾匹配数之和 2 + 3 = 5 份重复记录 (b1: 2 尾匹配, b2: 3 尾匹配)'
      );
      expect(html).toContain('求和');
      expect(html).toContain('2 + 3 = 5');
      // 不得出现乘法追溯
      expect(html).not.toContain('乘法追溯');
      expect(html).not.toContain('×');
    });

    it('FactorBars: 无 audit 且无基表记录时显示提示文案，无任何因子条形', async () => {
      const html = renderToString(
        <FactorBars scenario={null} audit={null} />
      );

      expect(html).toContain('暂无基表记录或尚未运行连接分析。');
      expect(html).not.toContain('份副本');
      expect(html).not.toContain('data-factor=');
    });

    it('JW-A star: 保持乘法语义不变 (2×2=4 仍正确，FactorBars 保持乘法追溯)', async () => {
      const scenario = jwA as unknown as Scenario;
      const audit = await analyze(scenario);

      const graphHtml = renderToString(
        <GraphView scenario={scenario} audit={audit} selectedRowId="o1" />
      );
      expect(graphHtml).toContain('展开因子: 4 倍');
      expect(graphHtml).toContain('2 × 2 = 4 份');

      const factorHtml = renderToString(
        <FactorBars scenario={scenario} audit={audit} selectedRowId="o1" />
      );
      expect(factorHtml).toContain('4 份副本');
      expect(factorHtml).toContain('(2 明细 × 2 支付)');
      expect(factorHtml).toContain('乘法追溯：支路1 [2 条] × 支路2 [2 份] = 4 份重复记录');
    });

    it('Single 布局 (JW-E): FactorBars 无归因 (不显示乘法或求和追溯)', async () => {
      const scenario = jwE as unknown as Scenario;
      const audit = await analyze(scenario);

      const factorHtml = renderToString(
        <FactorBars scenario={scenario} audit={audit} selectedRowId="o1" />
      );
      expect(factorHtml).not.toContain('乘法追溯');
      expect(factorHtml).not.toContain('求和追溯');
      expect(factorHtml).toContain('(1 明细 · 单表)');
    });
  });

  describe('9. R2-B08 LEFT JOIN UI 数学解释与口径一致性回归测试 (FIX-R2-02)', () => {
    it('star 布局 B=0 / C=2: 因子解释为 1×2=2，无匹配支路显示为 1 并标注无匹配按 LEFT JOIN 保留 1 行，绝无 0×N=N 表达式', async () => {
      const scenario: Scenario = {
        schema: 'joinwitness.scenario/v1',
        specVersion: '1.0.0',
        layout: 'star',
        title: 'Star B=0 C=2 Scenario',
        source: 'synthetic',
        base: [{ id: 'a1', key: 'k1', amountCents: '1000' }],
        mid: [],
        tail: [
          { id: 'c1', parentKey: 'k1' },
          { id: 'c2', parentKey: 'k1' },
        ],
      };
      const audit = await analyze(scenario);

      // 验证 core 因子为 2，branch1 为 0，branch2 为 2
      expect(audit.rows[0]!.factor).toBe('2');
      expect(audit.rows[0]!.branch1Count).toBe(0);
      expect(audit.rows[0]!.branch2Count).toBe(2);

      // 1. GraphView 渲染验证
      const graphHtml = renderToString(
        <GraphView scenario={scenario} audit={audit} selectedRowId="a1" />
      );

      // 因子显示为 2 倍
      expect(graphHtml).toContain('展开因子: 2 倍');
      // 计算逻辑应为 1 × 2 = 2 份，标注无匹配按 LEFT JOIN 保留 1 行
      expect(graphHtml).toContain('1 × 2 = 2 份');
      expect(graphHtml).toContain('无匹配，按 LEFT JOIN 保留 1 行');
      // 严禁出现 0×2=2 或 0 × 2
      expect(graphHtml).not.toContain('0 × 2');
      expect(graphHtml).not.toContain('0×2');
      expect(graphHtml).not.toContain('0 = 2');

      // 2. FactorBars 渲染验证
      const factorHtml = renderToString(
        <FactorBars scenario={scenario} audit={audit} selectedRowId="a1" />
      );

      expect(factorHtml).toContain('2 份副本');
      expect(factorHtml).toContain(
        '乘法追溯：支路1 [1 条 (无匹配，按 LEFT JOIN 保留 1 行)] × 支路2 [2 份] = 2 份重复记录'
      );
      expect(factorHtml).not.toContain('0 条');
      expect(factorHtml).not.toContain('0 × 2');
      expect(factorHtml).not.toContain('0×2');
    });

    it('chain 布局多条 B 共用同一 linkKey: 图中第二跳显示连接路径数 4 并标注路径数含义，与审计 branch2Count 一致', async () => {
      // 复现用例：chain 1A / 2B 共用 Q / 2C 匹配 Q 得 factor=4、branch1=2、branch2=4
      const scenario: Scenario = {
        schema: 'joinwitness.scenario/v1',
        specVersion: '1.0.0',
        layout: 'chain',
        title: 'Chain Shared LinkKey MultiPath Scenario',
        source: 'synthetic',
        base: [{ id: 'a1', key: 'k1', amountCents: '1000' }],
        mid: [
          { id: 'b1', parentKey: 'k1', linkKey: 'Q' },
          { id: 'b2', parentKey: 'k1', linkKey: 'Q' },
        ],
        tail: [
          { id: 'c1', parentKey: 'Q' },
          { id: 'c2', parentKey: 'Q' },
        ],
      };
      const audit = await analyze(scenario);

      // 审计口径：factor=4, branch1=2, branch2=4
      expect(audit.rows[0]!.factor).toBe('4');
      expect(audit.rows[0]!.branch1Count).toBe(2);
      expect(audit.rows[0]!.branch2Count).toBe(4);

      // GraphView 渲染验证：图中第二跳必须显示连接路径数 4，且与审计一致
      const graphHtml = renderToString(
        <GraphView scenario={scenario} audit={audit} selectedRowId="a1" />
      );

      expect(graphHtml).toContain('展开因子: 4 倍');
      expect(graphHtml).toContain('支路 1: 2 行匹配');
      // 第二跳必须显示 4（路径数），并标注路径数含义
      expect(graphHtml).toContain('第二跳: 4（路径数）');
      expect(graphHtml).toContain('路径数（同 C 行被多条 B 命中时重复计）');
      // 绝不得用去重 C 行数 2 冒充第二跳
      expect(graphHtml).not.toContain('第二跳: 2');
      expect(graphHtml).not.toContain('级联匹配: 2 行');

      // FactorBars 验证：与审计 branch2Count 一致为 4
      const factorHtml = renderToString(
        <FactorBars scenario={scenario} audit={audit} selectedRowId="a1" />
      );
      expect(factorHtml).toContain('4 份副本');
      expect(factorHtml).toContain('(2 中行 · 级联 4 尾行)');
      expect(factorHtml).toContain('2 + 2 = 4');
    });

    it('JW-A 与 JW-B 原有解释保持不变', async () => {
      // 1. JW-A (star) 原有解释
      const jwAScenario = jwA as unknown as Scenario;
      const jwAAudit = await analyze(jwAScenario);

      const jwAGraph = renderToString(
        <GraphView scenario={jwAScenario} audit={jwAAudit} selectedRowId="o1" />
      );
      expect(jwAGraph).toContain('展开因子: 4 倍');
      expect(jwAGraph).toContain('支路 1: 2 行匹配');
      expect(jwAGraph).toContain('支路 2: 2 行匹配');
      expect(jwAGraph).toContain('2 × 2 = 4 份');

      const jwAFactor = renderToString(
        <FactorBars scenario={jwAScenario} audit={jwAAudit} selectedRowId="o1" />
      );
      expect(jwAFactor).toContain('4 份副本');
      expect(jwAFactor).toContain('(2 明细 × 2 支付)');
      expect(jwAFactor).toContain('乘法追溯：支路1 [2 条] × 支路2 [2 份] = 4 份重复记录');

      // JW-A o3 (tail 0 match)
      const jwAo3Graph = renderToString(
        <GraphView scenario={jwAScenario} audit={jwAAudit} selectedRowId="o3" />
      );
      expect(jwAo3Graph).toContain('支路 2: 0 行匹配 (LEFT JOIN 垫底 1 份 NULL)');

      // 2. JW-B (chain) 原有解释
      const jwBScenario = jwB as unknown as Scenario;
      const jwBAudit = await analyze(jwBScenario);

      const jwBGraph = renderToString(
        <GraphView scenario={jwBScenario} audit={jwBAudit} selectedRowId="a1" />
      );
      expect(jwBGraph).toContain('展开因子: 5 倍');
      expect(jwBGraph).toContain('计算逻辑 (求和): 2 + 3 = 5 份 (b1: 2 尾匹配, b2: 3 尾匹配)');
      expect(jwBGraph).toContain('第二跳: 5（路径数）');
      expect(jwBGraph).toContain('路径数（同 C 行被多条 B 命中时重复计）');

      const jwBFactor = renderToString(
        <FactorBars scenario={jwBScenario} audit={jwBAudit} selectedRowId="a1" />
      );
      expect(jwBFactor).toContain('5 份副本');
      expect(jwBFactor).toContain('(2 中行 · 级联 5 尾行)');
      expect(jwBFactor).toContain(
        '求和追溯：各中行尾匹配数之和 2 + 3 = 5 份重复记录 (b1: 2 尾匹配, b2: 3 尾匹配)'
      );
    });
  });

  describe('10. FIX-R3-01: 大基表行数首屏保护截断 (FactorBars 200 行上限保护模式)', () => {
    function makeScenarioWithBaseRows(count: number): Scenario {
      return {
        schema: 'joinwitness.scenario/v1',
        specVersion: '1.0.0',
        layout: 'star',
        title: `合成测试场景 (${count} 基表行)`,
        source: 'synthetic',
        base: Array.from({ length: count }, (_, i) => ({
          id: `b_${String(i + 1).padStart(4, '0')}`,
          key: `K_${i % 10}`,
          amountCents: '100',
        })),
        mid: Array.from({ length: 20 }, (_, i) => ({
          id: `m_${i + 1}`,
          parentKey: `K_${i % 10}`,
        })),
        tail: Array.from({ length: 20 }, (_, i) => ({
          id: `t_${i + 1}`,
          parentKey: `K_${i % 10}`,
        })),
      };
    }

    it('基表 <= 200 行时，完整展示全部行，不出现截断提示横幅与截断徽标', async () => {
      const scenario = makeScenarioWithBaseRows(50);
      const audit = await analyze(scenario);

      const html = renderToString(<FactorBars scenario={scenario} audit={audit} />);
      expect(html).not.toContain('factor-truncation-banner');
      expect(html).not.toContain('factor-truncation-badge');
      expect(html).not.toContain('sr-truncation-row');
      expect(html).toContain('data-testid="factor-bar-row-b_0001"');
      expect(html).toContain('data-testid="factor-bar-row-b_0050"');
    });

    it('基表 > 200 行 (如 250 行) 时，受保护截断展示前 200 行，并明确标注“仅展示前 200 行，总计以全量数据为准”', async () => {
      const scenario = makeScenarioWithBaseRows(250);
      const audit = await analyze(scenario);

      const html = renderToString(<FactorBars scenario={scenario} audit={audit} />);
      // 1. 验证横幅与明确标注文案
      expect(html).toContain('factor-truncation-banner');
      expect(html).toContain('仅展示前 200 行，总计以全量数据为准');
      expect(html).toContain('当前基表共 250 行');

      // 2. 验证徽标
      expect(html).toContain('仅展示前 200 行');

      // 3. 验证首屏截断第 1 行与第 200 行在位，第 201 行未在默认列表中
      expect(html).toContain('data-testid="factor-bar-row-b_0001"');
      expect(html).toContain('data-testid="factor-bar-row-b_0200"');
      expect(html).not.toContain('data-testid="factor-bar-row-b_0201"');

      // 4. 验证无障碍表格与截断标注一致
      expect(html).toContain('基表各行因多对多连接产生的重复倍数与金额偏差归因表（仅展示前 200 行，总计以全量数据为准）');
      expect(html).toContain('data-testid="sr-truncation-row"');
      expect(html).toContain('⚠️ 仅展示前 200 行，总计以全量数据为准（全量共 250 行）。');
    });

    it('当选中行在 200 行截断范围外时 (如 b_0230)，追加展示选中行且保持归因细节可读', async () => {
      const scenario = makeScenarioWithBaseRows(250);
      const audit = await analyze(scenario);

      const html = renderToString(
        <FactorBars scenario={scenario} audit={audit} selectedRowId="b_0230" />
      );
      expect(html).toContain('data-testid="factor-bar-row-b_0230"');
      expect(html).toContain('is-selected');
      expect(html).toContain('data-testid="factor-selected-details-b_0230"');
      expect(html).toContain('data-testid="factor-truncation-selected-tag"');
    });

    it('空闲态或 STALE 态下即使基表多于 200 行也严格展示占位符，绝不展示截断横幅或任何推测数字 (FIX-R2-01 防回退)', () => {
      const scenario = makeScenarioWithBaseRows(300);
      const staleHtml = renderToString(
        <FactorBars scenario={scenario} audit={null} status="STALE" />
      );
      expect(staleHtml).toContain('factor-bars-placeholder');
      expect(staleHtml).toContain('尚未运行/结果已过期，请重新运行');
      expect(staleHtml).not.toContain('factor-truncation-banner');
      expect(staleHtml).not.toContain('data-factor=');
    });
  });
});
