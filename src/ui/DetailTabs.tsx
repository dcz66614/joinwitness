/**
 * P008 倍行镜 JoinWitness — 底部四标签页审计证据组件
 *
 * 遵循项目书 §3—§8、FR06/07/08/U06 与实施计划 P008-T013：
 * 1. 原始行 ⇄ 预览 JOIN 行：基表与前 ≤200 条物理 JOIN 预览，显著标注截断及独立精确总行数 (U06/FR06)。
 * 2. 逐行审计与差额：纯文本替代内容无障碍表格，因子/原始金额/朴素贡献/正负差额 (U05/FR05)。
 * 3. 最小反例见证集：3/4 行最少结构见证、复制/下载 JSON、可再次校验、无 fanout 显示 NONE (FR07)。
 * 4. 粒度安全说明：解释倍行根源、明确 SUM(DISTINCT amount) 反例缺陷、用户导入来源标记 (FR08)。
 */

import { useState, type FC, type KeyboardEvent } from 'react';
import type { Scenario, Audit, RowAudit } from '../core/types.js';
import { previewJoinedRows, filterPreviewRows, type JoinedRowPreview } from '../core/preview.js';
import { computeAmountAudit } from '../core/amount.js';
import { findMinimalWitness, type ScenarioSubset } from '../core/witness.js';
import { serializeScenario } from '../io/json.js';
import { formatCentsToAmount } from '../io/csv.js';
import { formatSignedDelta } from './FactorBars.js';

export type DetailTabKey = 'preview' | 'audit' | 'witness' | 'granularity';

export interface DetailTabsProps {
  scenario?: Scenario | null;
  audit?: Audit | null;
  activeTab?: DetailTabKey;
  onTabChange?: (tab: DetailTabKey) => void;
  selectedRowId?: string | null;
  onSelectRowId?: (rowId: string) => void;
  onLoadScenario?: (scenario: Scenario) => void;
  previewLimit?: number;
  className?: string;
}

export const DetailTabs: FC<DetailTabsProps> = ({
  scenario,
  audit,
  activeTab: controlledActiveTab,
  onTabChange,
  selectedRowId,
  onSelectRowId,
  onLoadScenario,
  previewLimit = 200,
  className = '',
}) => {
  // 标签页状态：支持外部受控与内部自控
  const [localActiveTab, setLocalActiveTab] = useState<DetailTabKey>('preview');
  const activeTab = controlledActiveTab ?? localActiveTab;

  const handleTabSwitch = (tab: DetailTabKey) => {
    if (onTabChange) {
      onTabChange(tab);
    } else {
      setLocalActiveTab(tab);
    }
  };

  // 复制状态反馈
  const [copyFeedback, setCopyFeedback] = useState<string>('');

  if (!scenario) {
    return (
      <section className={`detail-tabs-section ${className}`} aria-label="四维度详细审计证据">
        <div className="tab-panel-body">
          <p className="text-muted">暂无场景数据，请先选择或导入场景。</p>
        </div>
      </section>
    );
  }

  // 1. 计算预览行及截断元数据（独立分解式精确总数）
  const previewResult = previewJoinedRows(scenario, previewLimit);
  const previewRows = selectedRowId
    ? filterPreviewRows(previewResult, selectedRowId)
    : previewResult;

  // 2. 逐行审计数据（优先使用传入的 audit.rows，否则实算）
  let auditRows: RowAudit[] = [];
  if (audit?.rows && audit.rows.length > 0) {
    auditRows = audit.rows;
  } else {
    const computedAmount = computeAmountAudit(scenario);
    auditRows = computedAmount.rows;
  }

  // 3. 最小反例见证集（实算或使用已有见证）
  const witnessSubset: ScenarioSubset = findMinimalWitness(scenario, audit ?? undefined);
  const witnessKind = witnessSubset.kind;
  const isWitnessNone = witnessKind === 'NONE';
  const witnessRowCount = witnessSubset.rowCount;
  const witnessScenario = witnessSubset.scenario;

  // 规范格式化见证子集 JSON
  let witnessJsonText = '';
  if (witnessScenario) {
    try {
      witnessJsonText = serializeScenario(witnessScenario);
    } catch {
      witnessJsonText = JSON.stringify(witnessScenario, null, 2);
    }
  } else {
    witnessJsonText = JSON.stringify(witnessSubset.witness, null, 2);
  }

  // 复制见证集到剪贴板
  const handleCopyWitness = async () => {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(witnessJsonText);
        setCopyFeedback('已复制到剪贴板！');
        setTimeout(() => setCopyFeedback(''), 2500);
      }
    } catch {
      setCopyFeedback('复制失败，请手动选择复制');
      setTimeout(() => setCopyFeedback(''), 2500);
    }
  };

  // 下载见证集 JSON 文件
  const handleDownloadWitness = () => {
    if (typeof document === 'undefined') return;
    try {
      const blob = new Blob([witnessJsonText], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'joinwitness-witness.json';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      // 容错处理
    }
  };

  // 键盘点击辅助
  const handleRowKeyDown = (e: KeyboardEvent, id: string) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSelectRowId?.(id);
    }
  };

  return (
    <section
      className={`detail-tabs-section ${className}`}
      aria-label="四维度详细审计证据"
    >
      {/* 标签栏头部 */}
      <div className="tab-headers-list" role="tablist" aria-label="审计视图标签">
        <button
          type="button"
          id="tab-btn-preview"
          role="tab"
          aria-selected={activeTab === 'preview'}
          aria-controls="tabpanel-preview"
          className={`tab-btn ${activeTab === 'preview' ? 'is-active' : ''}`}
          onClick={() => handleTabSwitch('preview')}
        >
          <span>1. 原始行 ⇄ 预览 JOIN 行</span>
        </button>

        <button
          type="button"
          id="tab-btn-audit"
          role="tab"
          aria-selected={activeTab === 'audit'}
          aria-controls="tabpanel-audit"
          className={`tab-btn ${activeTab === 'audit' ? 'is-active' : ''}`}
          onClick={() => handleTabSwitch('audit')}
        >
          <span>2. 逐行审计与差额</span>
        </button>

        <button
          type="button"
          id="tab-btn-witness"
          role="tab"
          aria-selected={activeTab === 'witness'}
          aria-controls="tabpanel-witness"
          className={`tab-btn ${activeTab === 'witness' ? 'is-active' : ''}`}
          onClick={() => handleTabSwitch('witness')}
        >
          <span>3. 最小反例见证集</span>
        </button>

        <button
          type="button"
          id="tab-btn-granularity"
          role="tab"
          aria-selected={activeTab === 'granularity'}
          aria-controls="tabpanel-granularity"
          className={`tab-btn ${activeTab === 'granularity' ? 'is-active' : ''}`}
          onClick={() => handleTabSwitch('granularity')}
        >
          <span>4. 粒度安全说明</span>
        </button>
      </div>

      {/* Tab 1: 原始行与连接预览 (FR06 / U06) */}
      {activeTab === 'preview' && (
        <div
          id="tabpanel-preview"
          role="tabpanel"
          aria-labelledby="tab-btn-preview"
          className="tab-panel-body"
        >
          <div className="preview-top-banner">
            <span className="banner-limit-notice" data-testid="banner-limit-notice">
              {previewResult.isTruncated
                ? `⚠️ 当前连接结果全量共 ${previewResult.totalExpandedRows} 行，已截断展示前 ${previewResult.previewCount} 行；已省略后续物化，精确总行数仍按全量分解式计算。`
                : `⚠️ 预览上限 200 行；精确总行数仍已计算 (全量 ${previewResult.totalExpandedRows} 行未发生截断)。`}
            </span>
            <span className="banner-desc">
              展示基表 A 与物理 LEFT JOIN 前 200 行投影片段，避免超大笛卡尔积卡死界面。
            </span>
          </div>

          {selectedRowId && (
            <div className="filter-active-bar" style={{ margin: '8px 0', fontSize: '12px' }}>
              <span>
                当前聚焦筛选基表行：<code>{selectedRowId}</code>
                {` (显示匹配的 ${previewRows.length} 条预览行)`}
              </span>
              <button
                type="button"
                className="btn btn-secondary"
                style={{ marginLeft: '12px', padding: '2px 8px', fontSize: '11px' }}
                onClick={() => onSelectRowId?.('')}
              >
                显示全部行
              </button>
            </div>
          )}

          <div className="preview-tables-split">
            {/* 左侧：基表原始数据 */}
            <div className="preview-table-box">
              <h4>{`基表原始数据 (Base Rows: ${scenario.base.length})`}</h4>
              <div className="table-responsive">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>ID</th>
                      <th>关联键 (key)</th>
                      <th>金额 (分)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {scenario.base.map((row) => {
                      const isSelected = row.id === selectedRowId;
                      return (
                        <tr
                          key={row.id}
                          data-testid={`base-row-${row.id}`}
                          className={isSelected ? 'is-selected-row' : ''}
                          onClick={() => onSelectRowId?.(row.id)}
                          onKeyDown={(e) => handleRowKeyDown(e, row.id)}
                          tabIndex={0}
                          role="button"
                          aria-pressed={isSelected}
                          style={{ cursor: 'pointer' }}
                        >
                          <td><code>{row.id}</code></td>
                          <td><code>{row.key ?? 'NULL'}</code></td>
                          <td>{row.amountCents}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* 右侧：连接物化预览 */}
            <div className="preview-table-box">
              <h4>
                {`连接物化预览 (JOIN Preview: ${previewRows.length} 行${
                  previewResult.isTruncated ? ` / 全量 ${previewResult.totalExpandedRows} 行` : ''
                })`}
              </h4>
              <div className="table-responsive">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>A.id</th>
                      <th>A.key</th>
                      <th>B.id</th>
                      <th>C.id</th>
                      <th>物化状态</th>
                    </tr>
                  </thead>
                  <tbody>
                    {previewRows.map((r) => {
                      const isSelected = r.aId === selectedRowId;
                      return (
                        <tr
                          key={`${r.previewIndex}-${r.aId}-${r.bId}-${r.cId}`}
                          data-testid={`preview-row-${r.previewIndex}`}
                          className={isSelected ? 'is-selected-row' : ''}
                          onClick={() => onSelectRowId?.(r.aId)}
                          onKeyDown={(e) => handleRowKeyDown(e, r.aId)}
                          tabIndex={0}
                          role="button"
                          aria-pressed={isSelected}
                          style={{ cursor: 'pointer' }}
                        >
                          <td><code>{r.aId}</code></td>
                          <td><code>{r.aKey ?? 'NULL'}</code></td>
                          <td><code>{r.bId ?? 'NULL'}</code></td>
                          <td><code>{r.cId ?? 'NULL'}</code></td>
                          <td>
                            <span className={r.isDuplicated ? 'tag-dup' : 'tag-safe-row'}>
                              {r.statusText}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tab 2: 逐行审计与差额 (U05 / FR05) */}
      {activeTab === 'audit' && (
        <div
          id="tabpanel-audit"
          role="tabpanel"
          aria-labelledby="tab-btn-audit"
          className="tab-panel-body"
        >
          <div className="audit-table-header">
            <h4>逐行倍增因子与金额归因表 (图表纯文本替代内容 · U05 无障碍要求)</h4>
            <span className="table-subtitle">
              精确展示每笔基表记录被放大的倍数、正确基表金额、失真贡献及纯差额。
            </span>
          </div>

          <div className="table-responsive">
            <table className="data-table audit-table">
              <thead>
                <tr>
                  <th>基表 ID</th>
                  <th>基表金额 (元)</th>
                  <th>倍增因子 (factor)</th>
                  <th>错误贡献 (元)</th>
                  <th>差额偏差 (Δ)</th>
                  <th>支路 1 计数</th>
                  <th>支路 2 计数</th>
                  <th>状态标记</th>
                </tr>
              </thead>
              <tbody>
                {auditRows.map((r) => {
                  const isSelected = r.id === selectedRowId;
                  const factorNum = Number(r.factor);
                  const isUnsafe = factorNum > 1;
                  const deltaFormatted = formatSignedDelta(r.deltaCents);

                  return (
                    <tr
                      key={r.id}
                      data-testid={`audit-row-${r.id}`}
                      className={isSelected ? 'is-selected-row' : ''}
                      onClick={() => onSelectRowId?.(r.id)}
                      onKeyDown={(e) => handleRowKeyDown(e, r.id)}
                      tabIndex={0}
                      role="button"
                      aria-pressed={isSelected}
                      style={{ cursor: 'pointer' }}
                    >
                      <td><code>{r.id}</code></td>
                      <td>{formatCentsToAmount(r.amountCents)}</td>
                      <td><strong>{`${r.factor} 份`}</strong></td>
                      <td className="text-rose">{formatCentsToAmount(r.naiveContributionCents)}</td>
                      <td className={deltaFormatted !== '+0.00' ? 'text-amber' : 'text-teal'}>
                        {deltaFormatted}
                      </td>
                      <td>{r.branch1Count}</td>
                      <td>{r.branch2Count}</td>
                      <td>
                        {isUnsafe ? (
                          <span className="badge-warning">存在倍增</span>
                        ) : (
                          <span className="badge-ok">粒度安全</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab 3: 最小反例见证集 (FR07) */}
      {activeTab === 'witness' && (
        <div
          id="tabpanel-witness"
          role="tabpanel"
          aria-labelledby="tab-btn-witness"
          className="tab-panel-body"
        >
          <div className="witness-header">
            <h4>最小结构反例见证集 (Minimal Structural Witness)</h4>
            <div className="witness-callout">
              <span className="callout-icon" aria-hidden="true">💡</span>
              <div className="callout-text">
                <strong>重要审计边界说明：</strong>
                <span>
                  本反例是在原输入行中只通过删除无关行、保留原拓扑构成的全局最少行数证明子集。
                </span>
                <p className="callout-warn">
                  ⚠️ 提示：这里证明发生倍行；并不证明明细记录应被删除。
                </p>
              </div>
            </div>
          </div>

          {isWitnessNone ? (
            <div className="witness-none-card" data-testid="witness-none" style={{ marginTop: '16px' }}>
              <p>
                <strong>无倍行风险 (NONE)：</strong>
                当前场景所有基表记录的倍增因子均为 1，未检测到任何笛卡尔积或结构倍行。无需生成反例见证集。
              </p>
            </div>
          ) : (
            <div className="witness-evidence-box">
              <div
                className="witness-meta-header"
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: '10px',
                }}
              >
                <span className="evidence-title">
                  {`见证行 ID 集合 (全局最少行数: ${witnessRowCount} 行)：`}
                </span>
                <span
                  className={witnessKind === 'NUMERIC_AND_STRUCTURAL' ? 'badge-warning' : 'badge-ok'}
                  style={{ fontSize: '11px', padding: '2px 8px' }}
                >
                  {witnessKind === 'NUMERIC_AND_STRUCTURAL'
                    ? '数值与结构双重见证'
                    : '纯结构见证'}
                </span>
              </div>

              <div className="evidence-tags">
                <span className="tag-group">
                  <span className="group-label">基表 Base:</span>
                  {witnessSubset.witness.rowIds.base.map((id) => (
                    <span key={id} className="witness-id-tag tag-teal">
                      {id}
                    </span>
                  ))}
                </span>

                <span className="tag-group">
                  <span className="group-label">第二表 Mid:</span>
                  {witnessSubset.witness.rowIds.mid.map((id) => (
                    <span key={id} className="witness-id-tag tag-blue">
                      {id}
                    </span>
                  ))}
                </span>

                {witnessSubset.witness.rowIds.tail.length > 0 && (
                  <span className="tag-group">
                    <span className="group-label">第三表 Tail:</span>
                    {witnessSubset.witness.rowIds.tail.map((id) => (
                      <span key={id} className="witness-id-tag tag-blue">
                        {id}
                      </span>
                    ))}
                  </span>
                )}
              </div>

              {/* 见证集 JSON 展开预览 */}
              <div className="witness-json-container" style={{ marginTop: '14px' }}>
                <details open>
                  <summary style={{ cursor: 'pointer', fontSize: '12px', fontWeight: 600 }}>
                    查看最小见证子集规范 JSON (可再次导入校验)
                  </summary>
                  <pre
                    data-testid="witness-json-pre"
                    style={{
                      marginTop: '8px',
                      padding: '10px',
                      backgroundColor: '#070d17',
                      border: '1px solid var(--border-default)',
                      borderRadius: 'var(--radius-sm)',
                      fontSize: '11px',
                      fontFamily: 'var(--font-mono)',
                      color: '#a5f3fc',
                      maxHeight: '220px',
                      overflowY: 'auto',
                    }}
                  >
                    <code>{witnessJsonText}</code>
                  </pre>
                </details>
              </div>

              <div className="witness-action-row" style={{ marginTop: '12px', display: 'flex', gap: '10px' }}>
                <button
                  type="button"
                  data-testid="btn-copy-witness"
                  className="btn btn-secondary btn-copy-witness"
                  onClick={handleCopyWitness}
                  title="复制见证集 JSON 文本"
                >
                  <span>{copyFeedback || '复制见证集 JSON'}</span>
                </button>

                <button
                  type="button"
                  data-testid="btn-download-witness"
                  className="btn btn-secondary"
                  onClick={handleDownloadWitness}
                  title="下载最小见证集为 JSON 文件"
                >
                  <span>下载见证集 JSON</span>
                </button>

                {onLoadScenario && witnessScenario && (
                  <button
                    type="button"
                    data-testid="btn-run-witness"
                    className="btn btn-primary"
                    onClick={() => onLoadScenario(witnessScenario)}
                    title="在工作台重新运行此最小见证集"
                  >
                    <span>在工作台回放反例</span>
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Tab 4: 粒度安全说明 (FR08 / JW-E 反例) */}
      {activeTab === 'granularity' && (
        <div
          id="tabpanel-granularity"
          role="tabpanel"
          aria-labelledby="tab-btn-granularity"
          className="tab-panel-body"
        >
          <div className="granularity-explanation-card">
            <h4>为什么关联完全正确，但汇总金额却发生严重错误？</h4>
            <div className="explanation-content">
              <p>
                <strong>1. 关联本身的语义正确性与聚合粒度错配：</strong>
                关系数据库中，LEFT JOIN 将父表订单与多个子表（明细或支付）正确匹配是完全合法的 SQL 操作。
                问题发生在后续的统计聚合阶段：如果直接在连接后的展开结果集上执行 <code>SUM(orders.amount)</code>，
                基表订单金额便会被赋予每条明细记录，伴随连接分支被重复累加 <code>factor</code> 次。
              </p>

              <div
                className="counterexample-box"
                style={{
                  margin: '12px 0',
                  padding: '12px 14px',
                  backgroundColor: '#0c1424',
                  borderLeft: '4px solid #f43f5e',
                  borderRadius: 'var(--radius-sm)',
                }}
              >
                <strong style={{ color: '#fda4af', display: 'block', marginBottom: '6px' }}>
                  2. 致命误区：为什么 SUM(DISTINCT amount) 无法彻底补救（JW-E 经典反例）
                </strong>
                <p style={{ margin: 0 }}>
                  许多数据分析员尝试使用 <code>SUM(DISTINCT amount)</code> 进行规避，这是极其隐蔽的设计漏洞！
                  <br />
                  <strong>反例事实证明（参见冻结预设 JW-E）：</strong>
                  设系统中有两个完全独立、合法的订单 <code>r1</code>（金额 12.00 元）与 <code>r2</code>（金额 12.00 元），
                  每个订单各只有 1 条明细，全流程不存在任何倍行扩张，正确的安全总额必须是 <strong>24.00 元</strong>。
                  若采用 <code>SUM(DISTINCT amount)</code>，数据库会强制将两个同金额订单去重合并为单个 12.00 元，
                  导致报表直接漏算 <strong>12.00 元</strong>（漏算率达 50%）。
                  因此，<strong>严禁使用 DISTINCT 金额作为倍行修复方案</strong>。
                </p>
              </div>

              <p>
                <strong>3. 行业标准解法 (Looker 对称聚合 / dbt MetricFlow)：</strong>
                正确的做法必须基于明确声明的<strong>度量宿主表业务粒度</strong>：
                <br />
                • <strong>方案 A（度量先聚合 / 子查询）：</strong>在 JOIN 前先将子表聚合至基表主键粒度，或在基表完成 <code>SUM</code>。
                <br />
                • <strong>方案 B（对称聚合折减）：</strong>在展开层按基表主键结合倍率因子进行除权折减：
                <code>SUM(orders.amount / factor)</code>。
              </p>

              {/* 用户导入来源标记 (FR08 / U07) */}
              <div
                className="source-mark-section"
                style={{
                  marginTop: '16px',
                  padding: '10px 14px',
                  backgroundColor: 'var(--bg-card)',
                  border: '1px solid var(--border-default)',
                  borderRadius: 'var(--radius-md)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                }}
              >
                <span className="source-label" style={{ fontWeight: 600 }}>
                  当前数据来源标记：
                </span>
                {scenario.source === 'user_imported' ? (
                  <span
                    className="witness-id-tag tag-blue"
                    data-testid="badge-user-imported"
                    style={{ fontSize: '12px' }}
                  >
                    用户导入数据 (user_imported) · 本地离线环境分析
                  </span>
                ) : (
                  <span
                    className="witness-id-tag tag-teal"
                    data-testid="badge-synthetic"
                    style={{ fontSize: '12px' }}
                  >
                    合成数据 (synthetic) · 不代表真实企业
                  </span>
                )}
                <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                  {scenario.source === 'user_imported'
                    ? '所有计算均在当前浏览器本地内存运行，绝不上传到任何远程服务器或日志服务。'
                    : '冻结内置合成示例，用于机理演示。'}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
};
