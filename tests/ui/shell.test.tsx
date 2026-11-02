import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { chromium } from '@playwright/test';
import { App, APP_TITLE, APP_SUBTITLE, PRESET_OPTIONS, MOCK_SHELL_AUDIT } from '../../src/ui/App.js';
import { StatusBar } from '../../src/ui/StatusBar.js';
import { ImportPanel } from '../../src/ui/ImportPanel.js';
import { runAnalysis } from '../../src/workers/workerProtocol.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const STYLES_PATH = path.resolve(__dirname, '../../src/styles.css');
const EVIDENCE_DIR = path.resolve(__dirname, '../../evidence');

describe('P008-T011 UI Shell: React 页面骨架、交互控件和响应式布局', () => {
  describe('1. 顶部主导航栏与品牌信息', () => {
    it('渲染主标题、副标题与合成数据来源标记', () => {
      const html = renderToString(<App />);
      expect(html).toContain(APP_TITLE);
      expect(html).toContain(APP_SUBTITLE);
      expect(html).toContain('合成数据 · 不代表真实企业');
      expect(html).toContain('role="banner"');
      expect(html).toContain('role="main"');
      expect(html).toContain('role="contentinfo"');
    });

    it('预设选择下拉框包含全部 6 个预设并默认选中 JW-A', () => {
      const html = renderToString(<App initialPreset="jw-a" />);
      expect(html).toContain('JW-A 双支路暴增（合成）');
      expect(html).toContain('JW-B 链式多对多展开（合成）');
      expect(html).toContain('JW-C 负数金额完全抵消（合成）');
      expect(html).toContain('JW-D 孤立未连接与 SQL NULL（合成）');
      expect(html).toContain('JW-E 单表左连接无倍行（合成）');
      expect(html).toContain('JW-F 链式最小见证集示例（合成）');
      expect(html).toContain('value="jw-a"');
    });

    it('运行连接按钮具有明确标识与初始状态', () => {
      const html = renderToString(<App />);
      expect(html).toContain('id="btn-run"');
      expect(html).toContain('运行连接');
      expect(html).toContain('btn-primary');
    });

    it('运行中状态时运行按钮被禁用并显示加载样式', () => {
      const html = renderToString(<App initialStatus="RUNNING" />);
      expect(html).toContain('is-loading');
      expect(html).toContain('disabled');
      expect(html).toContain('计算中...');
    });
  });

  describe('2. StatusBar 状态条与生命周期', () => {
    it('支持 IDLE 就绪状态并包含辅助无障碍属性', () => {
      const html = renderToString(<StatusBar status="IDLE" />);
      expect(html).toContain('role="status"');
      expect(html).toContain('aria-live="polite"');
      expect(html).toContain('就绪 (IDLE)');
      expect(html).toContain('系统就绪');
      expect(html).toContain('🔒 本地离线环境');
    });

    it('支持 VALIDATING, RUNNING, COMPLETE, STALE, ERROR 状态切换', () => {
      const idleHtml = renderToString(<StatusBar status="IDLE" />);
      const validatingHtml = renderToString(<StatusBar status="VALIDATING" />);
      const runningHtml = renderToString(<StatusBar status="RUNNING" jobId="job-42" />);
      const completeHtml = renderToString(<StatusBar status="COMPLETE" durationMs={12.4} />);
      const staleHtml = renderToString(<StatusBar status="STALE" />);
      const errorHtml = renderToString(<StatusBar status="ERROR" message="基表未包含任何行" />);

      expect(idleHtml).toContain('status-badge-idle');
      expect(validatingHtml).toContain('验证中 (VALIDATING)');
      expect(runningHtml).toContain('计算中 (RUNNING)');
      expect(runningHtml).toContain('Job #job-42');
      expect(completeHtml).toContain('已完成 (COMPLETE)');
      expect(completeHtml).toContain('耗时 12.4ms');
      expect(staleHtml).toContain('已过期 (STALE)');
      expect(errorHtml).toContain('错误 (ERROR)');
      expect(errorHtml).toContain('基表未包含任何行');
    });
  });

  describe('3. ImportPanel 导入导出与 CSV 映射向导', () => {
    it('具备导入 CSV、导入 JSON、导出 JSON 按钮结构', () => {
      const html = renderToString(<ImportPanel />);
      expect(html).toContain('id="btn-import-csv"');
      expect(html).toContain('id="btn-import-json"');
      expect(html).toContain('id="btn-export-json"');
      expect(html).toContain('type="file"');
      expect(html).toContain('accept=".json,application/json"');
    });

    it('无障碍支持 aria-expanded 与 aria-controls 对应关系', () => {
      const html = renderToString(<ImportPanel />);
      expect(html).toContain('aria-controls="csv-mapping-wizard-panel"');
      expect(html).toContain('aria-expanded="false"');
    });

    it('禁用态下导入导出按钮正确应用 disabled 属性', () => {
      const html = renderToString(<ImportPanel disabled={true} />);
      expect(html).toContain('disabled');
    });
  });

  describe('4. 数字事实区与真实审计状态流转 (U01 & U04)', () => {
    it('空闲态明确提示尚未运行且不含 mock 数值与 mock-indicator', () => {
      const html = renderToString(<App />);
      // 绝无 mock 指示器与假值
      expect(html).not.toContain('data-testid="mock-indicator"');
      expect(html).not.toContain('[Mock 演示数据');
      // 明确提示未运行
      expect(html).toContain('data-testid="idle-indicator"');
      expect(html).toContain('尚未运行，请选择预设或导入数据后点击运行');
      // 核心卡片结构齐全但数值全为占位符
      expect(html).toContain('基表行数 (A)');
      expect(html).toContain('JOIN 后行数');
      expect(html).toContain('安全总额 (基表粒度)');
      expect(html).toContain('错误总额 (明细累加)');
      expect(html).toContain('失真偏差 (Δ)');
      expect(html).toContain('受影响订单');
      expect(html).toContain('—');
      // 绝不展示 mock 假数字
      expect(html).not.toContain('86.00');
      expect(html).not.toContain('284.00');
      expect(html).not.toContain('+198.00');
    });

    it('运行真实 Worker 审计后显示 real-audit-indicator 与真实数值', async () => {
      const result = await runAnalysis({
        jobId: 'shell-real-worker-test',
        scenario: PRESET_OPTIONS['jw-a'].scenario,
      });
      expect(result.status).toBe('COMPLETE');
      expect(result.audit).toBeDefined();

      const html = renderToString(<App initialPreset="jw-a" initialAudit={result.audit ?? null} initialStatus="COMPLETE" />);
      // 显示真实 Worker 完成标志
      expect(html).toContain('data-testid="real-audit-indicator"');
      expect(html).toContain('✓ 真实 Worker 流水线 · 离线计算已完成');
      expect(html).not.toContain('data-testid="mock-indicator"');
      expect(html).not.toContain('data-testid="idle-indicator"');

      // 验证 JW-A 真实指标数值
      expect(html).toContain('3');
      expect(html).toContain('8');
      expect(html).toContain('86.00');
      expect(html).toContain('[真值]');
      expect(html).toContain('284.00');
      expect(html).toContain('[失真]');
      expect(html).toContain('+198.00');
      expect(html).toContain('[差额]');
      expect(html).toContain('2');
      expect(html).toContain(' / 3 笔');
    });

    it('MOCK_SHELL_AUDIT 仅保留供兼容且不出现在任何渲染输出中', () => {
      expect(MOCK_SHELL_AUDIT.isMock).toBe(true);
      const idleHtml = renderToString(<App />);
      expect(idleHtml).not.toContain(MOCK_SHELL_AUDIT.mockNotice);
      expect(idleHtml).not.toContain(MOCK_SHELL_AUDIT.deltaFormatted);
    });

    it('不仅依靠红绿色彩，同时包含文本标签和货币单位符号 (U04)', () => {
      const html = renderToString(<App />);
      expect(html).toContain('示例金额');
      expect(html).toContain('每笔订单仅计入一次');
      expect(html).toContain('因倍行发生无声膨胀');
    });
  });

  describe('5. 左右核心工作台骨架容器 (T012 预留 & FIX-R2-01 回归)', () => {
    it('左栏包含 GraphView 骨架容器与拓扑节点连接预览', () => {
      const html = renderToString(<App />);
      expect(html).toContain('id="graph-view-container"');
      expect(html).toContain('data-testid="graph-view-skeleton"');
      expect(html).toContain('连接拓扑与表映射');
      expect(html).toContain('[骨架容器 · 待 T012 GraphView]');
      expect(html).toContain('[A orders]');
      expect(html).toContain('[B items]');
      expect(html).toContain('LEFT JOIN 规则说明');
    });

    it('右栏包含 FactorBars 骨架容器，空闲态绝无推测数值且与顶部事实区同源展示占位符与未运行提示', () => {
      const html = renderToString(<App />);
      expect(html).toContain('id="factor-bars-container"');
      expect(html).toContain('data-testid="factor-bars-skeleton"');
      expect(html).toContain('流向展开与重复倍数');
      expect(html).toContain('[骨架容器 · 待 T012 FactorBars]');
      expect(html).toContain('尚未运行/结果已过期，请重新运行');
      expect(html).toContain('data-testid="factor-bars-empty"');
      expect(html).toContain('data-testid="factor-bars-placeholder"');
      // 严禁展示推测数值 (R2-B07)
      expect(html).not.toContain('4 份副本');
      expect(html).not.toContain('+150.00');
      expect(html).not.toContain('3 份副本');
      expect(html).not.toContain('+48.00');
      expect(html).not.toContain('1 份副本');
      expect(html).not.toContain('data-factor=');
    });

    it('STALE 态与空闲态同样展示占位符与过期提示，绝无任何倍数、金额与差额数值 (R2-B07)', () => {
      const html = renderToString(<App initialStatus="STALE" />);
      expect(html).toContain('data-testid="factor-bars-empty"');
      expect(html).toContain('尚未运行/结果已过期，请重新运行');
      expect(html).not.toContain('4 份副本');
      expect(html).not.toContain('+150.00');
      expect(html).not.toContain('3 份副本');
      expect(html).not.toContain('+48.00');
      expect(html).not.toContain('1 份副本');
      expect(html).not.toContain('data-factor=');
    });

    it('运行态 (COMPLETE) 恢复展示 Worker 真实计算的倍数、金额与差额数值 (R2-B07)', async () => {
      const result = await runAnalysis({
        jobId: 'shell-factorbars-complete-test',
        scenario: PRESET_OPTIONS['jw-a'].scenario,
      });
      expect(result.status).toBe('COMPLETE');
      expect(result.audit).toBeDefined();

      const html = renderToString(
        <App initialPreset="jw-a" initialAudit={result.audit ?? null} initialStatus="COMPLETE" />
      );
      // 运行完成态恢复真实数值
      expect(html).toContain('4 份副本');
      expect(html).toContain('+150.00');
      expect(html).toContain('3 份副本');
      expect(html).toContain('+48.00');
      expect(html).toContain('1 份副本');
      expect(html).toContain('data-row-id="o1"');
      expect(html).toContain('data-row-id="o2"');
      expect(html).toContain('data-row-id="o3"');
    });
  });

  describe('6. 底部四标签页结构与无障碍 (U05)', () => {
    it('包含四标签页按钮与 role="tablist" / role="tab" / role="tabpanel"', () => {
      const html = renderToString(<App />);
      expect(html).toContain('role="tablist"');
      expect(html).toContain('role="tab"');
      expect(html).toContain('role="tabpanel"');
      expect(html).toContain('1. 原始行 ⇄ 预览 JOIN 行');
      expect(html).toContain('2. 逐行审计与差额');
      expect(html).toContain('3. 最小反例见证集');
      expect(html).toContain('4. 粒度安全说明');
    });

    it('Tab 1 显示 200 行上限声明与原始表预览', () => {
      const html = renderToString(<App />);
      expect(html).toContain('预览上限 200 行；精确总行数仍已计算');
      expect(html).toContain('基表原始数据');
      expect(html).toContain('连接物化预览');
    });
  });

  describe('7. 离线安全声明与常驻页脚', () => {
    it('常驻声明纯前端内存计算，无数据上传', () => {
      const html = renderToString(<App />);
      expect(html).toContain('离线与隐私常驻声明');
      expect(html).toContain('绝不上传到任何远程服务器');
      expect(html).toContain('遵循 MIT 许可证');
    });
  });

  describe('8. 1440×900 优先与窄屏响应式布局，验证无横向溢出并输出 UI 截图 (U01 & U05)', () => {
    it('在 1440×900 桌面视口下无横向溢出，并输出初版 UI 截图证据', async () => {
      const css = fs.readFileSync(STYLES_PATH, 'utf-8');
      const appHtml = renderToString(<App />);
      const fullHtml = `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>P008 倍行镜 JoinWitness</title>
    <style>${css}</style>
  </head>
  <body>
    <div id="root">${appHtml}</div>
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

        console.log('[EVIDENCE][DESKTOP_1440x900] Overflow metrics:', metrics);
        expect(metrics.hasOverflow).toBe(false);
        expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth);

        const shot1440Path = path.join(EVIDENCE_DIR, 't011-ui-1440x900.png');
        await page.screenshot({ path: shot1440Path, fullPage: false });
        console.log(`[EVIDENCE][SCREENSHOT] Saved 1440x900 UI screenshot to ${shot1440Path}`);
        expect(fs.existsSync(shot1440Path)).toBe(true);

        // 验证焦点可访问性 (U05)
        await page.keyboard.press('Tab');
        const activeTagName = await page.evaluate(() => document.activeElement?.tagName);
        expect(activeTagName).toBeDefined();
      } finally {
        await browser.close();
      }
    }, 15000);

    it('在 768×1024 窄屏视口下纵向堆叠且绝无横向溢出，并输出窄屏截图', async () => {
      const css = fs.readFileSync(STYLES_PATH, 'utf-8');
      const appHtml = renderToString(<App />);
      const fullHtml = `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>P008 倍行镜 JoinWitness</title>
    <style>${css}</style>
  </head>
  <body>
    <div id="root">${appHtml}</div>
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

        console.log('[EVIDENCE][NARROW_768x1024] Overflow metrics:', metrics);
        expect(metrics.hasOverflow).toBe(false);
        expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth);

        const shotNarrowPath = path.join(EVIDENCE_DIR, 't011-ui-narrow.png');
        await page.screenshot({ path: shotNarrowPath, fullPage: false });
        console.log(`[EVIDENCE][SCREENSHOT] Saved narrow UI screenshot to ${shotNarrowPath}`);
        expect(fs.existsSync(shotNarrowPath)).toBe(true);
      } finally {
        await browser.close();
      }
    }, 15000);
  });

  describe('9. R2-B07 回归验证：真实浏览器验证空闲态页面严格无推测数值并存证截图', () => {
    it('真实浏览器验证空闲态页面严格无推测数值（4 份副本/+150.00 等不存在），保存空闲态截图存证', async () => {
      const css = fs.readFileSync(STYLES_PATH, 'utf-8');
      const appHtml = renderToString(<App />);
      const fullHtml = `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>P008 倍行镜 JoinWitness - 空闲态无推测数值验证</title>
    <style>${css}</style>
  </head>
  <body>
    <div id="root">${appHtml}</div>
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

        // 1. 验证顶部事实区均为占位符 —
        const baseRowsText = await page.textContent('.card-base-rows .number');
        const expandedRowsText = await page.textContent('.card-expanded-rows .number');
        const safeSumText = await page.textContent('.card-safe-sum .number');
        const naiveSumText = await page.textContent('.card-naive-sum .number');
        const deltaText = await page.textContent('.card-delta .number');
        expect(baseRowsText?.trim()).toBe('—');
        expect(expandedRowsText?.trim()).toBe('—');
        expect(safeSumText?.trim()).toBe('—');
        expect(naiveSumText?.trim()).toBe('—');
        expect(deltaText?.trim()).toBe('—');

        // 2. 验证 FactorBars 区域严格无推测条形、无 4 份副本、无 +150.00
        const rowBarsCount = await page.locator('[data-testid^="factor-bar-row-"]').count();
        expect(rowBarsCount).toBe(0);

        const factorTextsCount = await page.locator('[data-testid^="row-factor-"]').count();
        expect(factorTextsCount).toBe(0);

        const emptyPlaceholder = page.locator('[data-testid="factor-bars-empty"]');
        expect(await emptyPlaceholder.isVisible()).toBe(true);
        const placeholderSymbol = await page.textContent('[data-testid="factor-bars-placeholder"]');
        expect(placeholderSymbol?.trim()).toBe('—');

        const emptyNotice = await page.textContent('[data-testid="factor-bars-empty-notice"]');
        expect(emptyNotice).toContain('尚未运行/结果已过期，请重新运行');

        // 验证整个 FactorBars 容器文本中绝无推测数值
        const factorBarsText = await page.textContent('[data-testid="factor-bars"]');
        expect(factorBarsText).not.toContain('4 份副本');
        expect(factorBarsText).not.toContain('+150.00');
        expect(factorBarsText).not.toContain('3 份副本');
        expect(factorBarsText).not.toContain('+48.00');

        // 3. 截图存证至 evidence/fix-r2-01-idle-state.png (不得覆盖之前任务的 evidence 文件)
        const idleShotPath = path.join(EVIDENCE_DIR, 'fix-r2-01-idle-state.png');
        await page.screenshot({ path: idleShotPath, fullPage: false });
        console.log(`[EVIDENCE][SCREENSHOT] Saved FIX-R2-01 idle screenshot to ${idleShotPath}`);
        expect(fs.existsSync(idleShotPath)).toBe(true);
      } finally {
        await browser.close();
      }
    }, 20000);
  });
});
