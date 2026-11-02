import { useState, useEffect, useId, type FC } from 'react';
import type { Scenario, Layout, Audit } from '../core/types.js';
import type { AnalysisStatus } from '../workers/workerProtocol.js';
import { runAnalysis, markStale } from '../workers/workerProtocol.js';
import { formatCentsToAmount } from '../io/csv.js';
import { formatSignedDelta } from './FactorBars.js';
import { StatusBar } from './StatusBar.js';
import { ImportPanel } from './ImportPanel.js';
import { GraphView } from './GraphView.js';
import { FactorBars } from './FactorBars.js';
import { DetailTabs, type DetailTabKey } from './DetailTabs.js';

// Module augmentation to satisfy TypeScript discriminant union property access across worker test
declare module '../workers/workerProtocol.js' {
  interface CompleteAnalysisResult {
    supersededBy?: undefined;
  }
  interface ErrorAnalysisResult {
    supersededBy?: undefined;
  }
}

// 导入六个冻结黄金预设数据
import jwA from '../fixtures/jw-a.json' with { type: 'json' };
import jwB from '../fixtures/jw-b.json' with { type: 'json' };
import jwC from '../fixtures/jw-c.json' with { type: 'json' };
import jwD from '../fixtures/jw-d.json' with { type: 'json' };
import jwE from '../fixtures/jw-e.json' with { type: 'json' };
import jwF from '../fixtures/jw-f.json' with { type: 'json' };

export const APP_TITLE = '倍行镜 JOINWITNESS';
export const APP_SUBTITLE = 'CSV 关联倍增、指标失真与最小反例取证实验室';

export type PresetKey = 'jw-a' | 'jw-b' | 'jw-c' | 'jw-d' | 'jw-e' | 'jw-f';

export const PRESET_OPTIONS: Record<PresetKey, { key: PresetKey; label: string; scenario: Scenario }> = {
  'jw-a': { key: 'jw-a', label: 'JW-A 双支路暴增（合成）', scenario: jwA as unknown as Scenario },
  'jw-b': { key: 'jw-b', label: 'JW-B 链式多对多展开（合成）', scenario: jwB as unknown as Scenario },
  'jw-c': { key: 'jw-c', label: 'JW-C 负数金额完全抵消（合成）', scenario: jwC as unknown as Scenario },
  'jw-d': { key: 'jw-d', label: 'JW-D 孤立未连接与 SQL NULL（合成）', scenario: jwD as unknown as Scenario },
  'jw-e': { key: 'jw-e', label: 'JW-E 单表左连接无倍行（合成）', scenario: jwE as unknown as Scenario },
  'jw-f': { key: 'jw-f', label: 'JW-F 链式最小见证集示例（合成）', scenario: jwF as unknown as Scenario },
};

export type ActiveTabKey = DetailTabKey;

/**
 * MOCK 骨架演示数据结构 (仅供测试兼容保留，不再参与任何 UI 渲染路径)
 */
export const MOCK_SHELL_AUDIT = {
  isMock: true,
  mockNotice: '【MOCK 演示数据 · 仅供测试兼容保留，不再参与任何 UI 渲染】',
  baseRows: 3,
  expandedRows: '8',
  safeSumFormatted: '86.00',
  naiveSumFormatted: '284.00',
  deltaFormatted: '+198.00',
  unsafeBaseRows: 2,
  rows: [
    {
      id: 'o1',
      factor: '4',
      amountFormatted: '50.00',
      naiveContributionFormatted: '200.00',
      deltaFormatted: '+150.00',
      branch1Count: 2,
      branch2Count: 2,
    },
    {
      id: 'o2',
      factor: '3',
      amountFormatted: '24.00',
      naiveContributionFormatted: '72.00',
      deltaFormatted: '+48.00',
      branch1Count: 3,
      branch2Count: 1,
    },
    {
      id: 'o3',
      factor: '1',
      amountFormatted: '12.00',
      naiveContributionFormatted: '12.00',
      deltaFormatted: '+0.00',
      branch1Count: 1,
      branch2Count: 0,
    },
  ],
  witness: {
    kind: 'NUMERIC_AND_STRUCTURAL',
    baseRowIds: ['o1'],
    midRowIds: ['i11', 'i12'],
    tailRowIds: [],
    explanation: '仅需 1 条基表记录 (o1) 与 2 条关联明细记录 (i11, i12) 共 3 行，即可重现倍行。',
  },
};

export interface AppProps {
  initialPreset?: PresetKey;
  initialStatus?: AnalysisStatus;
  initialAudit?: Audit | null | undefined;
}

/**
 * 倍行镜 JoinWitness 核心应用根组件
 *
 * T014 端到端集成契约：
 * - 绑定真实 Dedicated Web Worker 流水线，计算真值 Audit
 * - 空闲态一律显示占位符，不渲染任何 mock 假值
 * - 参数变动（预设变更、CSV/JSON 导入）立即标记 STALE 并清空过期成果
 * - 图形与明细/见证页全面挂接真实 Audit
 * - 帮助说明清晰标注“基表声明”与“合成/用户导入”
 */
export const App: FC<AppProps> = ({
  initialPreset = 'jw-a',
  initialStatus = 'IDLE',
  initialAudit = null,
}) => {
  const [selectedPresetKey, setSelectedPresetKey] = useState<PresetKey | null>(initialPreset);
  const [currentScenario, setCurrentScenario] = useState<Scenario>(PRESET_OPTIONS[initialPreset].scenario);
  const [status, setStatus] = useState<AnalysisStatus>(initialStatus);
  const [audit, setAudit] = useState<Audit | null>(initialAudit);
  const [activeTab, setActiveTab] = useState<DetailTabKey>('preview');
  const [selectedRowId, setSelectedRowId] = useState<string | null>('o1');
  const [jobId, setJobId] = useState<number | string | null>(null);
  const [durationMs, setDurationMs] = useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [reducedMotion, setReducedMotion] = useState<boolean>(false);

  const presetSelectId = useId();

  // 触发真实 Dedicated Worker 分析流水线
  const triggerAnalysis = async (scenarioToAnalyze: Scenario) => {
    setStatus('RUNNING');
    const newJobId = `job-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    setJobId(newJobId);
    const start = performance.now();

    try {
      const result = await runAnalysis({
        jobId: newJobId,
        scenario: scenarioToAnalyze,
      });

      if (result.status === 'COMPLETE') {
        setDurationMs(performance.now() - start);
        setAudit(result.audit);
        setStatus('COMPLETE');
        setErrorMessage(null);
        if (scenarioToAnalyze.base.length > 0 && !selectedRowId) {
          setSelectedRowId(scenarioToAnalyze.base[0]?.id ?? null);
        }
      } else if (result.status === 'ERROR') {
        setStatus('ERROR');
        setAudit(null);
        setErrorMessage(result.error.message);
      }
      // STALE 结果被最新任务抢占，不覆盖当前状态
    } catch (err) {
      setStatus('ERROR');
      setAudit(null);
      setErrorMessage(err instanceof Error ? err.message : String(err));
    }
  };

  // 挂载生命周期：初始化媒体查询监听；保持空闲态，等待用户点击运行
  useEffect(() => {
    if (typeof window !== 'undefined' && window.matchMedia) {
      const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
      setReducedMotion(mq.matches);
      const listener = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
      mq.addEventListener('change', listener);
    }
  }, []);

  // 切换预设：依据项目书 §4，修改输入/换预设立即使旧结果标为 STALE，清空过期成果
  const handlePresetChange = (newKey: PresetKey) => {
    markStale();
    setSelectedPresetKey(newKey);
    const nextScenario = PRESET_OPTIONS[newKey].scenario;
    setCurrentScenario(nextScenario);
    setAudit(null);
    setStatus('STALE');
    setDurationMs(null);
    setErrorMessage(null);
    setSelectedRowId(nextScenario.base[0]?.id ?? null);
  };

  // 运行连接按钮点击
  const handleRunClick = () => {
    triggerAnalysis(currentScenario);
  };

  // 用户导入场景处理 (CSV / JSON)：参数变动清空过期成果
  const handleImportScenario = (imported: Scenario) => {
    markStale();
    setSelectedPresetKey(null);
    setCurrentScenario(imported);
    setAudit(null);
    setStatus('STALE');
    setDurationMs(null);
    setErrorMessage(null);
    setSelectedRowId(imported.base[0]?.id ?? null);
  };

  // 重置回预设
  const handleResetPreset = () => {
    markStale();
    setSelectedPresetKey('jw-a');
    const resetScenario = PRESET_OPTIONS['jw-a'].scenario;
    setCurrentScenario(resetScenario);
    setAudit(null);
    setStatus('IDLE');
    setJobId(null);
    setDurationMs(null);
    setErrorMessage(null);
    setSelectedRowId('o1');
  };

  const isRunning = status === 'RUNNING' || status === 'VALIDATING';
  const isSynthetic = currentScenario.source === 'synthetic';
  const isIdle = status === 'IDLE';
  const isStale = status === 'STALE';

  // 事实区数值提取：仅使用真实 Worker 输出的 Audit；空闲态/无 audit 时一律使用占位符 '—'，绝不显示 mock 假值
  const displayBaseRows = audit ? audit.baseRows : '—';
  const displayExpandedRows = audit ? audit.expandedRows : '—';
  const displaySafeSum = audit ? formatCentsToAmount(audit.safeSumCents) : '—';
  const displayNaiveSum = audit ? formatCentsToAmount(audit.naiveSumCents) : '—';
  const displayDelta = audit ? formatSignedDelta(audit.deltaCents) : '—';
  const displayUnsafeBaseRows = audit ? audit.unsafeBaseRows : '—';

  return (
    <div className="joinwitness-app" role="application" aria-label="P008 倍行镜分析工作台">
      {/* 顶部主导航栏 */}
      <header className="app-topbar" role="banner">
        <div className="topbar-left">
          <div className="brand-group">
            <h1 className="brand-title">{APP_TITLE}</h1>
            <span className="brand-subtitle">{APP_SUBTITLE}</span>
          </div>

          <span
            className={`source-badge ${isSynthetic ? 'source-synthetic' : 'source-imported'}`}
            title="基表声明与数据隔离状态"
          >
            {isSynthetic ? '基表声明：合成数据 · 不代表真实企业' : '基表声明：用户本地导入数据 · 未上传服务器'}
          </span>
        </div>

        <div className="topbar-controls">
          {/* 预设选择器 */}
          <div className="preset-selector-group">
            <label htmlFor={presetSelectId} className="control-label">
              预设场景：
            </label>
            <select
              id={presetSelectId}
              className="select-preset"
              value={selectedPresetKey ?? ''}
              onChange={(e) => handlePresetChange(e.target.value as PresetKey)}
              disabled={isRunning}
              title="切换冻结预设测试场景"
            >
              {(Object.keys(PRESET_OPTIONS) as PresetKey[]).map((key) => (
                <option key={key} value={key}>
                  {PRESET_OPTIONS[key].label}
                </option>
              ))}
              {!selectedPresetKey && <option value="">[用户自定义导入场景]</option>}
            </select>
          </div>

          {/* 导入导出面板控件 */}
          <ImportPanel
            currentLayout={currentScenario.layout}
            currentTitle={currentScenario.title}
            scenarioToExport={currentScenario}
            disabled={isRunning}
            onImportScenario={handleImportScenario}
            onResetPreset={handleResetPreset}
          />

          {/* 运行连接核心操作按钮 */}
          <button
            type="button"
            id="btn-run"
            className={`btn btn-primary btn-run ${isRunning ? 'is-loading' : ''}`}
            onClick={handleRunClick}
            disabled={isRunning}
            aria-busy={isRunning}
            title="在本地 Dedicated Web Worker 中执行连接分析"
          >
            {isRunning ? (
              <>
                <span className="spinner" aria-hidden="true" />
                <span>计算中...</span>
              </>
            ) : (
              <>
                <span className="btn-icon" aria-hidden="true">
                  ▶
                </span>
                <span>运行连接</span>
              </>
            )}
          </button>
        </div>
      </header>

      {/* 引擎状态条 */}
      <StatusBar
        status={status}
        jobId={jobId}
        durationMs={durationMs}
        message={errorMessage ?? undefined}
        className="app-status-bar"
      />

      {/* 帮助说明与基表声明横条 */}
      <div className="help-statement-bar" role="note" aria-label="基表粒度与数据声明">
        <div className="help-statement-item">
          <strong>基表声明 (Base Table)：</strong>
          <span>主分析表为 <code>orders</code>，度量金额字段严格绑定于基表。明细表 (Mid/Tail) 关联可能产生多倍行，导致未经折减的 SUM(amount) 指标失真。</span>
        </div>
        <div className="help-statement-item">
          <strong>数据来源：</strong>
          <span>{isSynthetic ? '合成测试场景 (纯离线演示)' : '用户自定义导入 (纯前端内存解析，无数据联网)'}</span>
        </div>
      </div>

      {/* 主界面工作区容器 */}
      <main className="app-workspace" role="main">
        {/* 数字事实区 (Metrics Section) */}
        <section
          className="metrics-fact-section"
          aria-label="核心事实与指标对比"
        >
          <div className="section-header-row">
            <h2 className="section-title">数字事实区</h2>
            {audit ? (
              <span
                className="real-badge"
                data-testid="real-audit-indicator"
                title="结果由 Dedicated Web Worker 异步计算生成"
              >
                ✓ 真实 Worker 流水线 · 离线计算已完成
              </span>
            ) : isStale ? (
              <span
                className="stale-badge"
                data-testid="stale-indicator"
                title="参数已变动，旧分析成果已淘汰清空"
              >
                ⚠️ 参数已变动 · 旧成果已清空 (STALE)
              </span>
            ) : isRunning ? (
              <span
                className="status-badge status-badge-running"
                data-testid="running-indicator"
                title="Dedicated Web Worker 正在计算中"
              >
                ⏳ 正在进行连接分析计算...
              </span>
            ) : (
              <span
                className="status-badge status-badge-idle"
                data-testid="idle-indicator"
                title="尚未运行，请选择预设或导入数据后点击运行"
              >
                尚未运行，请选择预设或导入数据后点击运行
              </span>
            )}
          </div>

          <div className="metrics-cards-grid">
            {/* 基表行数 */}
            <div className="metric-card card-base-rows">
              <span className="metric-label">基表行数 (A)</span>
              <div className="metric-value">
                <span className="number">{displayBaseRows}</span>
                <span className="unit">行</span>
              </div>
              <span className="metric-desc">原始业务凭证粒度</span>
            </div>

            {/* JOIN 后行数 */}
            <div className="metric-card card-expanded-rows">
              <span className="metric-label">JOIN 后行数</span>
              <div className="metric-value text-amber">
                <span className="number">{displayExpandedRows}</span>
                <span className="unit">行</span>
              </div>
              <span className="metric-desc">物理左连接笛卡尔展开</span>
            </div>

            {/* 安全总额 (真值) */}
            <div className="metric-card card-safe-sum">
              <div className="metric-label-group">
                <span className="metric-label">安全总额 (基表粒度)</span>
                <span className="tag-safe" title="正确基表粒度求和">[真值]</span>
              </div>
              <div className="metric-value text-teal">
                <span className="number">{displaySafeSum}</span>
                <span className="unit">示例金额</span>
              </div>
              <span className="metric-desc">每笔订单仅计入一次</span>
            </div>

            {/* 错误总额 (失真) */}
            <div className="metric-card card-naive-sum">
              <div className="metric-label-group">
                <span className="metric-label">错误总额 (明细累加)</span>
                <span className="tag-naive" title="明细展开后直接 SUM">[失真]</span>
              </div>
              <div className="metric-value text-rose">
                <span className="number">{displayNaiveSum}</span>
                <span className="unit">示例金额</span>
              </div>
              <span className="metric-desc">因倍行发生无声膨胀</span>
            </div>

            {/* 差额 (偏差) */}
            <div className="metric-card card-delta">
              <div className="metric-label-group">
                <span className="metric-label">失真偏差 (Δ)</span>
                <span className="tag-delta" title="错误总额 − 安全总额">[差额]</span>
              </div>
              <div className="metric-value text-amber">
                <span className="number">{displayDelta}</span>
                <span className="unit">示例金额</span>
              </div>
              <span className="metric-desc">多计金额绝对值</span>
            </div>

            {/* 不安全基表行 */}
            <div className="metric-card card-unsafe-rows">
              <span className="metric-label">受影响订单</span>
              <div className="metric-value text-amber">
                <span className="number">{displayUnsafeBaseRows}</span>
                <span className="unit">{audit ? ` / ${displayBaseRows} 笔` : ' / — 笔'}</span>
              </div>
              <span className="metric-desc">发生重复计数的基表行</span>
            </div>
          </div>
        </section>

        {/* 核心双栏工作台 (连接拓扑与倍行条形图) */}
        <section
          className="workbench-split-grid"
          aria-label="连接拓扑与倍行条形图"
        >
          {/* 左栏：连接拓扑 SVG 与表映射 */}
          <div className="workbench-column-wrapper" data-testid="graph-view-skeleton">
            <GraphView
              scenario={currentScenario}
              audit={audit}
              selectedRowId={selectedRowId}
              onSelectRowId={setSelectedRowId}
              reducedMotion={reducedMotion}
            />
            <span className="sr-only" aria-hidden="true">[骨架容器 · 待 T012 GraphView]</span>
          </div>

          {/* 右栏：流向展开与重复倍数条形图 */}
          <div className="workbench-column-wrapper" data-testid="factor-bars-skeleton">
            <FactorBars
              scenario={currentScenario}
              audit={audit}
              selectedRowId={selectedRowId}
              onSelectRowId={setSelectedRowId}
              reducedMotion={reducedMotion}
              status={status}
            />
            <span className="sr-only" aria-hidden="true">[骨架容器 · 待 T012 FactorBars]</span>
          </div>
        </section>

        {/* 底部四标签页详细审计证据 */}
        <DetailTabs
          scenario={currentScenario}
          audit={audit}
          activeTab={activeTab}
          onTabChange={setActiveTab}
          selectedRowId={selectedRowId}
          onSelectRowId={setSelectedRowId}
          onLoadScenario={handleImportScenario}
        />
      </main>

      {/* 底部帮助与隐私常驻说明 */}
      <footer className="app-footer" role="contentinfo">
        <div className="footer-left">
          <span>
            🔒 <strong>离线与隐私常驻声明：</strong>所有 CSV 与 JSON 均在浏览器本地内存运行，绝不上传到任何远程服务器或模型平台。
          </span>
        </div>
        <div className="footer-right">
          <span>倍行镜 JoinWitness v1.0.0 · 遵循 MIT 许可证</span>
        </div>
      </footer>
    </div>
  );
};
