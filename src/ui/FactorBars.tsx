import type { FC, KeyboardEvent } from 'react';
import type { Scenario, Audit, RowAudit } from '../core/types.js';
import type { AnalysisStatus } from '../workers/workerProtocol.js';
import { formatDeltaPercentage } from '../core/amount.js';
import { formatCentsToAmount } from '../io/csv.js';

export const DEFAULT_MAX_FACTOR_ROWS = 200;

export interface FactorBarsProps {
  audit?: Audit | null;
  scenario?: Scenario | null;
  selectedRowId?: string | null;
  onSelectRowId?: (rowId: string) => void;
  reducedMotion?: boolean;
  className?: string;
  status?: AnalysisStatus;
  maxDisplayRows?: number;
}

/**
 * 格式化带正负号的货币金额显示 (BigInt 精度，严禁浮点数)
 */
export function formatSignedDelta(deltaCents: string): string {
  const deltaBig = BigInt(deltaCents);
  if (deltaBig === 0n) {
    return '+0.00';
  }
  if (deltaBig > 0n) {
    return `+${formatCentsToAmount(deltaCents)}`;
  }
  return `-${formatCentsToAmount((-deltaBig).toString())}`;
}

/**
 * P008 倍行镜 JoinWitness — 流向展开与重复倍数条形证据组件
 *
 * 核心规格与契约（项目书 §3—§4、U01/02/03/04、实施计划 P008-T012）：
 * - 所有数值完全由 props (Audit / Scenario) 实算结果驱动，严禁静态硬编码 factor 或金额。
 * - 针对每一条基表行呈现倍率条 (factor)、支路计数、原始金额与差额文字 (delta)。
 * - 支持按 A 行点击高亮及键盘操作 (Enter / Space 选中)，向外部通知选中行。
 * - 动画减少模式 (reducedMotion / prefers-reduced-motion)：禁用条形展开过渡动效，信息保持一致。
 * - 提供完整的屏幕阅读器结构化替代表格 (U05)，颜色之外必须同时提供明确符号与文字说明 (U04)。
 */
export const FactorBars: FC<FactorBarsProps> = ({
  audit,
  scenario,
  selectedRowId,
  onSelectRowId,
  reducedMotion = false,
  className = '',
  status,
  maxDisplayRows = DEFAULT_MAX_FACTOR_ROWS,
}) => {
  // 1. 获取行审计数据：严禁在 audit 为空时自行计算 (R2-B07)
  // audit 为 null 或状态为 STALE 时，条形图区域只显示占位符与“尚未运行/结果已过期，请重新运行”提示，不得出现任何倍数、金额、差额数值。
  const isStale = status === 'STALE';
  const hasValidAudit = !isStale && Boolean(audit?.rows && audit.rows.length > 0);
  const rows: RowAudit[] = hasValidAudit ? audit!.rows : [];

  // 2. 动态计算最大因子以做百分比归一化 (基于全量 rows 实算，保证归一化尺度严格一致)
  const maxFactor = rows.reduce((max, r) => {
    const num = Number(r.factor);
    return Number.isFinite(num) && num > max ? num : max;
  }, 1);

  // 3. 大数据量首屏保护截断 (参照 DetailTabs 200 行上限保护模式，FIX-R3-01)
  // 当基表行数 > maxDisplayRows 时，截断渲染前 maxDisplayRows 行，避免 DOM 暴增卡死浏览器主线程；
  // 顶部 6 项事实卡片、安全总额/朴素总额/差额及逐行 factor 全部仍由全量数据实算；
  // 若选中行在截断范围外，额外追加该聚焦行以保持交互完整性。
  const isTruncated = rows.length > maxDisplayRows;
  const selectedRowOutside =
    isTruncated && selectedRowId
      ? rows.find((r, idx) => idx >= maxDisplayRows && r.id === selectedRowId)
      : undefined;
  const displayedRows = isTruncated
    ? selectedRowOutside
      ? [...rows.slice(0, maxDisplayRows), selectedRowOutside]
      : rows.slice(0, maxDisplayRows)
    : rows;

  // 4. 键盘按键事件处理 (Enter / Space 选中行)
  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>, rowId: string) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSelectRowId?.(rowId);
    }
  };

  return (
    <div
      id="factor-bars-container"
      className={`workbench-panel factor-panel ${className}`}
      data-testid="factor-bars"
      data-reduced-motion={reducedMotion ? 'true' : 'false'}
    >
      {/* 局部动画与减少动态模式控制 */}
      <style>{`
        .jw-factor-fill-transition {
          transition: width 0.35s cubic-bezier(0.4, 0, 0.2, 1);
        }
        [data-reduced-motion="true"] .jw-factor-fill-transition {
          transition: none !important;
        }
        @media (prefers-reduced-motion: reduce) {
          .jw-factor-fill-transition {
            transition: none !important;
          }
        }
        .factor-bar-row:focus-visible {
          outline: 2px solid #10b981;
          outline-offset: 2px;
        }
      `}</style>

      {/* 头部面板标题与说明 */}
      <div className="panel-header">
        <div className="panel-title-group">
          <h3 className="panel-title">流向展开与重复倍数</h3>
          <span className="panel-subtitle">
            基表记录展开倍数 (factor) 与金额偏差归因
          </span>
        </div>
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
          {reducedMotion && (
            <span
              className="panel-badge"
              data-testid="factor-reduced-motion-indicator"
              style={{ color: '#94a3b8', borderColor: '#475569' }}
            >
              静态显示 (减少动效)
            </span>
          )}
          {isTruncated && (
            <span
              className="panel-badge banner-truncation-badge"
              data-testid="factor-truncation-badge"
              style={{ color: '#f59e0b', borderColor: '#b45309' }}
            >
              {`仅展示前 ${maxDisplayRows} 行`}
            </span>
          )}
          <span className="panel-badge">[动态实算证据]</span>
        </div>
      </div>

      {/* 大数据量保护截断提示横幅 (FIX-R3-01 / U06 风格) */}
      {isTruncated && (
        <div
          className="factor-truncation-banner"
          data-testid="factor-truncation-banner"
          style={{
            padding: '8px 12px',
            marginBottom: '10px',
            backgroundColor: 'rgba(245, 158, 11, 0.1)',
            border: '1px solid rgba(245, 158, 11, 0.3)',
            borderRadius: '4px',
            fontSize: '12px',
            color: '#fbbf24',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '8px',
          }}
        >
          <span data-testid="factor-truncation-notice">
            {`⚠️ 当前基表共 ${rows.length} 行，为保障渲染流畅度，仅展示前 ${maxDisplayRows} 行，总计以全量数据为准。`}
          </span>
          {selectedRowOutside && (
            <span
              data-testid="factor-truncation-selected-tag"
              style={{ fontSize: '11px', color: '#cbd5e1', whiteSpace: 'nowrap' }}
            >
              {`(当前选中行 ${selectedRowId} 已追加在列表末尾)`}
            </span>
          )}
        </div>
      )}

      {/* 因子条形图列表区 */}
      <div className="factor-bars-list" role="list" data-testid="factor-bars-list">
        {rows.length === 0 ? (
          <div
            className="factor-bars-empty"
            data-testid="factor-bars-empty"
            style={{
              padding: '36px 16px',
              textAlign: 'center',
              color: '#94a3b8',
              fontSize: '13px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
            }}
          >
            <span
              className="factor-bars-placeholder"
              data-testid="factor-bars-placeholder"
              style={{
                fontSize: '24px',
                color: '#64748b',
                fontFamily: 'var(--font-mono)',
              }}
            >
              —
            </span>
            <span
              className="factor-bars-empty-notice"
              data-testid="factor-bars-empty-notice"
            >
              {isStale
                ? '分析结果已过期，请重新运行连接分析。尚未运行/结果已过期，请重新运行。'
                : '暂无基表记录或尚未运行连接分析。尚未运行/结果已过期，请重新运行。'}
            </span>
          </div>
        ) : (
          displayedRows.map((row) => {
            const isSelected = selectedRowId === row.id;
            const factorNum = Number(row.factor);
            const isAmplified = factorNum > 1;
            const deltaFormatted = formatSignedDelta(row.deltaCents);
            const rawAmount = formatCentsToAmount(row.amountCents);
            const naiveAmount = formatCentsToAmount(row.naiveContributionCents);
            const deltaRatio = formatDeltaPercentage(row.amountCents, row.deltaCents, 2);

            // 条形宽度归一化计算 (实算，最小 20% 宽度以便可读)
            const barWidthPercent = Math.min(
              100,
              Math.max(20, Math.round((factorNum / maxFactor) * 100))
            );

            // 支路明细文本 (按布局分支实算)
            const layout = scenario?.layout ?? 'star';
            let branchText = '';
            if (layout === 'star') {
              if (row.branch1Count === 0 && row.branch2Count === 0) {
                branchText = '(1 明细 × 1 支付 · 无匹配按 LEFT JOIN 保留 1 行)';
              } else if (row.branch1Count === 0) {
                branchText = `(1 明细 (无匹配，按 LEFT JOIN 保留 1 行) × ${row.branch2Count} 支付)`;
              } else if (row.branch2Count === 0) {
                branchText = `(${row.branch1Count} 明细 · 单支路)`;
              } else {
                branchText = `(${row.branch1Count} 明细 × ${row.branch2Count} 支付)`;
              }
            } else if (layout === 'chain') {
              branchText =
                row.branch2Count > 0
                  ? `(${row.branch1Count} 中行 · 级联 ${row.branch2Count} 尾行)`
                  : `(${row.branch1Count} 中行 · 级联 0 尾行)`;
            } else {
              branchText =
                row.branch1Count === 0
                  ? '(1 明细 (无匹配，按 LEFT JOIN 保留 1 行) · 单表)'
                  : `(${row.branch1Count} 明细 · 单表)`;
            }

            // 链式布局选中行的各中行尾匹配求和明细
            let chainBreakdown: {
              weights: number[];
              sumExpression: string;
              details: string[];
            } | null = null;

            if (layout === 'chain' && scenario) {
              const baseRow = scenario.base.find((b) => b.id === row.id);
              const key = baseRow?.key;
              const matchingMids =
                key !== null && key !== undefined
                  ? scenario.mid.filter((m) => m.parentKey === key)
                  : [];
              const items = matchingMids.map((m) => {
                const tailMatches =
                  m.linkKey !== null && m.linkKey !== undefined
                    ? scenario.tail.filter((t) => t.parentKey !== null && t.parentKey === m.linkKey).length
                    : 0;
                return {
                  id: m.id,
                  tailMatches,
                  weight: Math.max(1, tailMatches),
                };
              });
              const weights = items.map((it) => it.weight);
              const details = items.map(
                (it) => `${it.id}: ${it.tailMatches} 尾匹配${it.tailMatches === 0 ? ' (垫底 1 份)' : ''}`
              );
              const sumExpression =
                weights.length > 1
                  ? `${weights.join(' + ')} = ${row.factor}`
                  : `${row.factor}`;
              chainBreakdown = { weights, sumExpression, details };
            }

            return (
              <div
                key={row.id}
                role="button"
                tabIndex={0}
                aria-pressed={isSelected}
                aria-label={`行 ${row.id}：展开 ${row.factor} 份，基表金额 ${rawAmount}，偏差 ${deltaFormatted}`}
                className={`factor-bar-row ${isSelected ? 'is-selected' : ''}`}
                data-testid={`factor-bar-row-${row.id}`}
                data-row-id={row.id}
                data-factor={row.factor}
                onClick={() => onSelectRowId?.(row.id)}
                onKeyDown={(e) => handleKeyDown(e, row.id)}
                title={`点击高亮行 ${row.id}：重复 ${row.factor} 次，偏差 ${deltaFormatted}`}
              >
                {/* 顶部元数据行 */}
                <div className="factor-row-meta">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span className="row-id" data-testid={`row-id-${row.id}`}>
                      {row.id}
                    </span>
                    <span
                      className={`row-factor-text ${isAmplified ? 'text-amber' : 'text-teal'}`}
                      data-testid={`row-factor-${row.id}`}
                    >
                      {`${row.factor} 份副本`}
                    </span>
                    <span className="row-branches-text" data-testid={`row-branches-${row.id}`}>
                      {branchText}
                    </span>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span
                      style={{
                        fontSize: '11px',
                        color: '#94a3b8',
                        fontFamily: 'var(--font-mono)',
                      }}
                      title="基表原始金额"
                    >
                      {`原: ${rawAmount}`}
                    </span>
                    <span
                      className={`row-delta-text ${
                        deltaFormatted !== '+0.00' ? 'text-amber' : 'text-teal'
                      }`}
                      data-testid={`row-delta-${row.id}`}
                      title="JOIN 导致的指标差额"
                    >
                      {deltaFormatted}
                    </span>
                  </div>
                </div>

                {/* 进度条轨道与填充条 */}
                <div className="factor-progress-track">
                  <div
                    className={`factor-progress-fill jw-factor-fill-transition ${
                      isAmplified ? 'fill-amber' : 'fill-teal'
                    }`}
                    style={{ width: `${barWidthPercent}%` }}
                    aria-valuenow={factorNum}
                    aria-valuemin={1}
                    aria-valuemax={maxFactor}
                    data-testid={`factor-progress-fill-${row.id}`}
                  />
                </div>

                {/* 选中时的展开归因细节卡片 (U03 点击展开完全一致性验证) */}
                {isSelected && (
                  <div
                    className="factor-selected-details"
                    data-testid={`factor-selected-details-${row.id}`}
                    style={{
                      marginTop: '6px',
                      padding: '8px 10px',
                      backgroundColor: 'rgba(15, 23, 42, 0.7)',
                      borderLeft: isAmplified ? '3px solid #f59e0b' : '3px solid #10b981',
                      borderRadius: '4px',
                      fontSize: '11px',
                      color: '#cbd5e1',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '3px',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span>
                        基表原额: <strong>{rawAmount}</strong>
                      </span>
                      <span>
                        错误展开额: <strong>{naiveAmount}</strong>
                      </span>
                      <span
                        style={{
                          fontWeight: 700,
                          color: isAmplified ? '#f59e0b' : '#10b981',
                        }}
                      >
                        {`偏差: ${deltaFormatted} (${deltaRatio})`}
                      </span>
                    </div>
                    {layout === 'star' ? (
                      <div style={{ color: '#94a3b8', fontSize: '10px' }}>
                        {`乘法追溯：支路1 [${Math.max(1, row.branch1Count)} 条${
                          row.branch1Count === 0 ? ' (无匹配，按 LEFT JOIN 保留 1 行)' : ''
                        }] × 支路2 [${Math.max(1, row.branch2Count)} 份${
                          row.branch2Count === 0 ? ' (无匹配，按 LEFT JOIN 保留 1 行)' : ''
                        }] = ${row.factor} 份重复记录`}
                      </div>
                    ) : layout === 'chain' ? (
                      <div style={{ color: '#94a3b8', fontSize: '10px' }}>
                        {chainBreakdown && chainBreakdown.weights.length > 1
                          ? `求和追溯：各中行尾匹配数之和 ${chainBreakdown.sumExpression} 份重复记录 (${chainBreakdown.details.join(', ')})`
                          : chainBreakdown && chainBreakdown.weights.length === 1
                          ? `求和追溯：中行尾匹配展开 ${row.factor} 份重复记录 (${chainBreakdown.details.join(', ')})`
                          : `求和追溯：各中行尾匹配求和展开 ${row.factor} 份重复记录`}
                      </div>
                    ) : null}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* 屏幕阅读器可访问表格替代 (U05) */}
      <table className="sr-only" aria-label="基表倍增与金额差额详细审计数据">
        <caption>
          {isTruncated
            ? `基表各行因多对多连接产生的重复倍数与金额偏差归因表（仅展示前 ${maxDisplayRows} 行，总计以全量数据为准）`
            : '基表各行因多对多连接产生的重复倍数与金额偏差归因表'}
        </caption>
        <thead>
          <tr>
            <th scope="col">基表行 ID</th>
            <th scope="col">展开倍数 (factor)</th>
            <th scope="col">支路 1 计数</th>
            <th scope="col">支路 2 计数</th>
            <th scope="col">原始基表金额</th>
            <th scope="col">错误展开金额</th>
            <th scope="col">差额 (delta)</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={7} style={{ textAlign: 'center' }}>
                — (尚未运行/结果已过期，请重新运行)
              </td>
            </tr>
          ) : (
            <>
              {displayedRows.map((row) => (
                <tr key={`sr-${row.id}`}>
                  <td>{row.id}</td>
                  <td>{row.factor}</td>
                  <td>{row.branch1Count}</td>
                  <td>{row.branch2Count}</td>
                  <td>{formatCentsToAmount(row.amountCents)}</td>
                  <td>{formatCentsToAmount(row.naiveContributionCents)}</td>
                  <td>{formatSignedDelta(row.deltaCents)}</td>
                </tr>
              ))}
              {isTruncated && (
                <tr data-testid="sr-truncation-row">
                  <td colSpan={7} style={{ textAlign: 'center' }}>
                    {`⚠️ 仅展示前 ${maxDisplayRows} 行，总计以全量数据为准（全量共 ${rows.length} 行）。`}
                  </td>
                </tr>
              )}
            </>
          )}
        </tbody>
      </table>

      {/* 底部交互指引说明 */}
      <div className="factor-hint-footer">
        <span>
          {(scenario?.layout ?? 'star') === 'star'
            ? '* 点击任意行高亮其下级分支乘法来源；支持键盘 Enter / Space 选中。'
            : (scenario?.layout ?? 'star') === 'chain'
            ? '* 点击任意行高亮其下级分支求和来源；支持键盘 Enter / Space 选中。'
            : '* 点击任意行高亮其关联明细；支持键盘 Enter / Space 选中。'}
        </span>
        {isTruncated && (
          <span
            data-testid="factor-hint-truncation"
            style={{ display: 'block', marginTop: '4px', color: '#94a3b8', fontSize: '11px' }}
          >
            {`* 仅展示前 ${maxDisplayRows} 行，总计以全量数据为准（其余 ${rows.length - maxDisplayRows} 行未在视图展开）。`}
          </span>
        )}
      </div>
    </div>
  );
};
