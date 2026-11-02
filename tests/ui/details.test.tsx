import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import { chromium } from '@playwright/test';

import type { Scenario, Audit } from '../../src/core/types.js';
import { analyze } from '../../src/core/analyze.js';
import { findMinimalWitness } from '../../src/core/witness.js';
import { parseScenarioJson, serializeScenario } from '../../src/io/json.js';
import { DetailTabs, type DetailTabKey } from '../../src/ui/DetailTabs.js';

// 导入冻结预设
import jwA from '../../src/fixtures/jw-a.json' with { type: 'json' };
import jwB from '../../src/fixtures/jw-b.json' with { type: 'json' };
import jwC from '../../src/fixtures/jw-c.json' with { type: 'json' };
import jwD from '../../src/fixtures/jw-d.json' with { type: 'json' };
import jwE from '../../src/fixtures/jw-e.json' with { type: 'json' };
import jwF from '../../src/fixtures/jw-f.json' with { type: 'json' };

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const STYLES_PATH = path.resolve(__dirname, '../../src/styles.css');
const EVIDENCE_DIR = path.resolve(__dirname, '../../evidence');
const WORKSPACE_TMP = path.resolve(__dirname, '../../.tmp');

// 将临时目录指到工作区磁盘，避免 /tmp 512MB tmpfs 溢出
process.env.TMPDIR = WORKSPACE_TMP;

describe('P008-T013 DetailTabs: 最小反例、预览、证据导出与安全粒度说明', () => {
  describe('1. 标签页骨架与无障碍结构 (ARIA & Tabs Switching)', () => {
    it('正确渲染四个标签按钮与对应 role="tab"、aria-controls 属性', () => {
      const scenario = jwA as unknown as Scenario;
      const html = renderToString(<DetailTabs scenario={scenario} activeTab="preview" />);

      expect(html).toContain('role="tablist"');
      expect(html).toContain('id="tab-btn-preview"');
      expect(html).toContain('aria-controls="tabpanel-preview"');
      expect(html).toContain('id="tab-btn-audit"');
      expect(html).toContain('aria-controls="tabpanel-audit"');
      expect(html).toContain('id="tab-btn-witness"');
      expect(html).toContain('aria-controls="tabpanel-witness"');
      expect(html).toContain('id="tab-btn-granularity"');
      expect(html).toContain('aria-controls="tabpanel-granularity"');

      // 默认选中 preview
      expect(html).toContain('id="tabpanel-preview"');
      expect(html).toContain('aria-labelledby="tab-btn-preview"');
    });

    it('切换 activeTab 属性渲染对应的标签面板内容', () => {
      const scenario = jwA as unknown as Scenario;

      const htmlAudit = renderToString(<DetailTabs scenario={scenario} activeTab="audit" />);
      expect(htmlAudit).toContain('id="tabpanel-audit"');
      expect(htmlAudit).toContain('逐行倍增因子与金额归因表');

      const htmlWitness = renderToString(<DetailTabs scenario={scenario} activeTab="witness" />);
      expect(htmlWitness).toContain('id="tabpanel-witness"');
      expect(htmlWitness).toContain('最小结构反例见证集');

      const htmlGranularity = renderToString(
        <DetailTabs scenario={scenario} activeTab="granularity" />
      );
      expect(htmlGranularity).toContain('id="tabpanel-granularity"');
      expect(htmlGranularity).toContain('为什么关联完全正确，但汇总金额却发生严重错误？');
    });
  });

  describe('2. Tab 1: 原始行 ⇄ 预览 JOIN 行 (FR06 / U06)', () => {
    it('JW-A: 正确渲染基表 3 行与物化预览 8 行，并呈现倍行状态', () => {
      const scenario = jwA as unknown as Scenario;
      const html = renderToString(<DetailTabs scenario={scenario} activeTab="preview" />);

      // 基表数据检查
      expect(html).toContain('基表原始数据 (Base Rows: 3)');
      expect(html).toContain('data-testid="base-row-o1"');
      expect(html).toContain('data-testid="base-row-o2"');
      expect(html).toContain('data-testid="base-row-o3"');

      // 预览数据检查：8 行
      expect(html).toContain('连接物化预览 (JOIN Preview: 8 行)');
      expect(html).toContain('data-testid="preview-row-1"');
      expect(html).toContain('data-testid="preview-row-8"');

      // 状态标记
      expect(html).toContain('倍行 1/4');
      expect(html).toContain('倍行 4/4');
      expect(html).toContain('倍行 1/3');
      expect(html).toContain('单行 1/1');

      // 未截断时的横幅提示
      expect(html).toContain('全量 8 行未发生截断');
    });

    it('截断显示显著标注 limit 上限与精确总行数，绝不把预览数量误写成总数 (U06)', () => {
      const scenario = jwA as unknown as Scenario;
      // 设置 previewLimit=5，总行数为 8
      const html = renderToString(
        <DetailTabs scenario={scenario} activeTab="preview" previewLimit={5} />
      );

      expect(html).toContain('已截断展示前 5 行');
      expect(html).toContain('全量共 8 行');
      expect(html).toContain('精确总行数仍按全量分解式计算');
      // 确认物化行只展示了 5 行
      expect(html).toContain('JOIN Preview: 5 行 / 全量 8 行');
      expect(html).toContain('data-testid="preview-row-5"');
      expect(html).not.toContain('data-testid="preview-row-6"');
    });

    it('选中基表行高亮对应的基表记录与 JOIN 预览行 (FR06 / U03)', () => {
      const scenario = jwA as unknown as Scenario;
      const html = renderToString(
        <DetailTabs scenario={scenario} activeTab="preview" selectedRowId="o1" />
      );

      // o1 基表行包含 is-selected-row
      expect(html).toMatch(/data-testid="base-row-o1"[^>]*class="[^"]*is-selected-row[^"]*"/);
      // o1 对应的预览行被高亮
      expect(html).toMatch(/data-testid="preview-row-1"[^>]*class="[^"]*is-selected-row[^"]*"/);
      expect(html).toContain('当前聚焦筛选基表行：<code>o1</code>');
    });
  });

  describe('3. Tab 2: 逐行金额审计与差额 (U05 / FR05)', () => {
    it('JW-A: 完整展示基表 ID、金额、因子、朴素贡献与差额偏差', async () => {
      const scenario = jwA as unknown as Scenario;
      const audit = await analyze(scenario);
      const html = renderToString(
        <DetailTabs scenario={scenario} audit={audit} activeTab="audit" />
      );

      // 验证 U05 纯文本无障碍表格
      expect(html).toContain('逐行倍增因子与金额归因表 (图表纯文本替代内容 · U05 无障碍要求)');
      expect(html).toContain('data-testid="audit-row-o1"');
      expect(html).toContain('data-testid="audit-row-o2"');
      expect(html).toContain('data-testid="audit-row-o3"');

      // 验证 o1: 50.00 元, 4 份, 错误贡献 200.00 元, 差额 +150.00
      expect(html).toContain('50.00');
      expect(html).toContain('4 份');
      expect(html).toContain('200.00');
      expect(html).toContain('+150.00');

      // 验证 o2: 24.00 元, 3 份, 错误贡献 72.00 元, 差额 +48.00
      expect(html).toContain('24.00');
      expect(html).toContain('3 份');
      expect(html).toContain('72.00');
      expect(html).toContain('+48.00');

      // 验证 o3: 12.00 元, 1 份, 错误贡献 12.00 元, 差额 +0.00
      expect(html).toContain('12.00');
      expect(html).toContain('1 份');
      expect(html).toContain('+0.00');

      // 状态标记
      expect(html).toContain('存在倍增');
      expect(html).toContain('粒度安全');
    });
  });

  describe('4. Tab 3: 最小反例见证集与导出验证 (FR07 / MATH06)', () => {
    it('JW-A: 生成 3 行最小反例见证集，包含说明警示与复制/下载按钮', async () => {
      const scenario = jwA as unknown as Scenario;
      const audit = await analyze(scenario);
      const html = renderToString(
        <DetailTabs scenario={scenario} audit={audit} activeTab="witness" />
      );

      expect(html).toContain('全局最少行数: 3 行');
      expect(html).toContain('这里证明发生倍行；并不证明明细记录应被删除。');
      expect(html).toContain('data-testid="btn-copy-witness"');
      expect(html).toContain('data-testid="btn-download-witness"');
      expect(html).toContain('data-testid="witness-json-pre"');

      // 验证基表 ID 标签
      expect(html).toContain('o1');
    });

    it('JW-F: 生成 4 行最小反例见证集 (链式单条中间边下界)', async () => {
      const scenario = jwF as unknown as Scenario;
      const audit = await analyze(scenario);
      const html = renderToString(
        <DetailTabs scenario={scenario} audit={audit} activeTab="witness" />
      );

      expect(html).toContain('全局最少行数: 4 行');
      expect(html).toContain('基表 Base:');
      expect(html).toContain('第二表 Mid:');
      expect(html).toContain('第三表 Tail:');
    });

    it('JW-E: 无倍行风险场景明确展示 NONE 提示 (FR07)', async () => {
      const scenario = jwE as unknown as Scenario;
      const audit = await analyze(scenario);
      const html = renderToString(
        <DetailTabs scenario={scenario} audit={audit} activeTab="witness" />
      );

      expect(html).toContain('data-testid="witness-none"');
      expect(html).toContain('无倍行风险 (NONE)');
      expect(html).toContain('所有基表记录的倍增因子均为 1');
    });

    it('复制导出的见证子集 JSON 可再次作为有效 Scenario 校验与运行', async () => {
      const scenario = jwA as unknown as Scenario;
      const witnessSubset = findMinimalWitness(scenario);
      expect(witnessSubset.scenario).not.toBeNull();

      // 1. 序列化为规范 JSON 文本（模拟用户复制/下载）
      const jsonText = serializeScenario(witnessSubset.scenario!);
      expect(jsonText).toContain('"schema": "joinwitness.scenario/v1"');

      // 2. 再次解析校验（模拟用户重新导入）
      const reParsedScenario = parseScenarioJson(jsonText);
      expect(reParsedScenario.base.length).toBe(1);
      expect(reParsedScenario.mid.length + reParsedScenario.tail.length).toBe(2);

      // 3. 再次运行核心分析断言仍能检测出倍行 (unsafeBaseRows >= 1)
      const reAudit = await analyze(reParsedScenario);
      expect(reAudit.unsafeBaseRows).toBe(1);
      expect(reAudit.rows[0]?.factor).toBe('2');
    });
  });

  describe('5. Tab 4: 粒度安全说明与 DISTINCT 金额反例 (FR08 / MATH05)', () => {
    it('明确解释聚合粒度错配根源并提供 Looker/dbt 对称聚合解法', () => {
      const scenario = jwA as unknown as Scenario;
      const html = renderToString(
        <DetailTabs scenario={scenario} activeTab="granularity" />
      );

      expect(html).toContain('关联本身的语义正确性与聚合粒度错配');
      expect(html).toContain('Looker 对称聚合 / dbt MetricFlow');
      expect(html).toContain('方案 A（度量先聚合 / 子查询）');
      expect(html).toContain('方案 B（对称聚合折减）');
    });

    it('深入剖析 SUM(DISTINCT amount) 致命误区，展示 JW-E 订单金额相同反例 (FR08 / MATH05)', () => {
      const scenario = jwE as unknown as Scenario;
      const html = renderToString(
        <DetailTabs scenario={scenario} activeTab="granularity" />
      );

      expect(html).toContain('致命误区：为什么 SUM(DISTINCT amount) 无法彻底补救');
      expect(html).toContain('冻结预设 JW-E');
      expect(html).toContain('两个完全独立、合法的订单');
      expect(html).toContain('24.00 元');
      expect(html).toContain('<strong>12.00 元</strong>');
      expect(html).toContain('严禁使用 DISTINCT 金额作为倍行修复方案');
    });

    it('用户导入场景明确展示 user_imported 来源标记与离线隐私保护 (U07)', () => {
      const userScenario: Scenario = {
        schema: 'joinwitness.scenario/v1',
        specVersion: '1.0.0',
        layout: 'single',
        title: 'User Exported Scenario',
        source: 'user_imported',
        base: [{ id: 'u1', key: 'K1', amountCents: '1000' }],
        mid: [{ id: 'm1', parentKey: 'K1' }],
        tail: [],
      };

      const html = renderToString(
        <DetailTabs scenario={userScenario} activeTab="granularity" />
      );

      expect(html).toContain('data-testid="badge-user-imported"');
      expect(html).toContain('用户导入数据 (user_imported) · 本地离线环境分析');
      expect(html).toContain('绝不上传到任何远程服务器');
    });

    it('合成数据场景展示 synthetic 标记', () => {
      const scenario = jwA as unknown as Scenario;
      const html = renderToString(
        <DetailTabs scenario={scenario} activeTab="granularity" />
      );

      expect(html).toContain('data-testid="badge-synthetic"');
      expect(html).toContain('合成数据 (synthetic) · 不代表真实企业');
    });
  });

  describe('6. Playwright 视觉证据渲染 (1440×900 桌面视口)', () => {
    it('在 1440×900 桌面视口下完整渲染 DetailTabs 并不产生横向溢出', async () => {
      const scenario = jwA as unknown as Scenario;
      const audit = await analyze(scenario);

      const html = renderToString(
        <DetailTabs scenario={scenario} audit={audit} activeTab="preview" selectedRowId="o1" />
      );

      const stylesContent = fs.readFileSync(STYLES_PATH, 'utf-8');
      const fullDocumentHtml = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <title>DetailTabs Test</title>
  <style>
    ${stylesContent}
  </style>
</head>
<body style="background: #060b14; color: #f8fafc; padding: 20px;">
  <div style="max-width: 1400px; margin: 0 auto;">
    ${html}
  </div>
</body>
</html>`;

      const browser = await chromium.launch({
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      });
      const context = await browser.newContext({
        viewport: { width: 1440, height: 900 },
      });
      const page = await context.newPage();

      await page.setContent(fullDocumentHtml, { waitUntil: 'domcontentloaded' });

      // 验证页面宽度无横向溢出
      const hasHorizontalScrollbar = await page.evaluate(() => {
        return document.documentElement.scrollWidth > document.documentElement.clientWidth;
      });
      expect(hasHorizontalScrollbar).toBe(false);

      await context.close();
      await browser.close();
    });
  });
});
