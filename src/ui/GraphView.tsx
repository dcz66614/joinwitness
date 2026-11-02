import { useId, type FC } from 'react';
import type { Scenario, Audit } from '../core/types.js';

export interface GraphViewProps {
  scenario: Scenario;
  audit?: Audit | null;
  selectedRowId?: string | null;
  onSelectRowId?: (rowId: string) => void;
  reducedMotion?: boolean;
  className?: string;
}

/**
 * P008 倍行镜 JoinWitness — 连接拓扑 SVG 与表映射组件
 *
 * 核心规格与契约（项目书 §3—§4、U01/02/03/04、实施计划 P008-T012）：
 * - 支持 2 表拓扑 (single) 与 3 表拓扑 (star, chain)。
 * - 动态呈现实际 JOIN 键关系及未匹配/空值规则。
 * - 响应 A 行选择高亮：直观呈现选中行的键值、下级分支匹配数及笛卡尔流向。
 * - 动画减少模式 (reducedMotion / prefers-reduced-motion)：禁用流向动效，确保信息无损。
 * - 纯 props 实算，严禁硬编码任何拓扑节点、键名或倍增因子。
 */
export const GraphView: FC<GraphViewProps> = ({
  scenario,
  audit,
  selectedRowId,
  onSelectRowId,
  reducedMotion = false,
  className = '',
}) => {
  const svgId = useId();

  // 1. 获取选中行及其关联合同
  const selectedBaseRow = selectedRowId
    ? scenario.base.find((r) => r.id === selectedRowId) ?? null
    : null;

  const selectedAuditRow = selectedRowId && audit
    ? audit.rows.find((r) => r.id === selectedRowId) ?? null
    : null;

  // 2. 计算支路匹配数量（实算，绝无静态硬编码）
  const selectedKey = selectedBaseRow?.key ?? null;

  // 分支 1 (Mid 表匹配行)
  const matchingMidRows = selectedKey !== null
    ? scenario.mid.filter((m) => m.parentKey === selectedKey)
    : [];
  const midMatchCount = matchingMidRows.length;

  // 链式级联明细：针对每个匹配的中行，统计其在 Tail 表的匹配数量与展开权重
  const chainMidBreakdown =
    scenario.layout === 'chain' && selectedKey !== null
      ? matchingMidRows.map((m) => {
          const cCount =
            m.linkKey !== null && m.linkKey !== undefined
              ? scenario.tail.filter((t) => t.parentKey !== null && t.parentKey === m.linkKey).length
              : 0;
          const weight = Math.max(1, cCount);
          return {
            id: m.id,
            linkKey: m.linkKey,
            cCount,
            weight,
          };
        })
      : [];

  // 分支 2 (Tail 表匹配行)
  let matchingTailRows: typeof scenario.tail = [];
  if (scenario.layout === 'star') {
    // 星型：Tail 表通过 parentKey 关联基表 key
    matchingTailRows = selectedKey !== null
      ? scenario.tail.filter((t) => t.parentKey === selectedKey)
      : [];
  } else if (scenario.layout === 'chain') {
    // 链式：Tail 表通过 parentKey 关联 Mid 表的 linkKey
    const activeLinkKeys = new Set(
      matchingMidRows
        .map((m) => m.linkKey)
        .filter((k): k is string => k !== null && k !== undefined)
    );
    matchingTailRows = scenario.tail.filter(
      (t) => t.parentKey !== null && activeLinkKeys.has(t.parentKey)
    );
  }
  const tailMatchCount = matchingTailRows.length;

  // 链式第二跳连接路径数（与审计 branch2Count 口径完全一致，多条 B 命中同一 C 时重复计，绝不用去重行数冒充）
  const chainBranch2Count = selectedAuditRow
    ? selectedAuditRow.branch2Count
    : chainMidBreakdown.reduce((sum, b) => sum + b.cCount, 0);

  // 3. 布局标题与副标题定义
  const layoutLabel =
    scenario.layout === 'star'
      ? '星型双支路 (Star): [A orders] ⟕ [B items] & [C payments]'
      : scenario.layout === 'chain'
      ? '链式级联 (Chain): [A orders] ⟕ [B items] ⟕ [C shipments]'
      : '单表关联 (Single): [A orders] ⟕ [B items]';

  const is3Table = scenario.layout !== 'single';
  const midTableLabel = scenario.layout === 'chain' ? '[B items]' : '[B items]';
  const tailTableLabel = scenario.layout === 'chain' ? '[C shipments]' : '[C payments]';

  // 4. 计算选中行的因子提示（严格来自审计实算，未分析时不得推测假值）
  const calculatedFactor = selectedAuditRow ? selectedAuditRow.factor : null;

  return (
    <div
      id="graph-view-container"
      className={`workbench-panel topology-panel ${className}`}
      data-testid="graph-view"
      data-reduced-motion={reducedMotion ? 'true' : 'false'}
    >
      {/* 局部内联样式：用于保证 SVG 连线高亮、动画与减少动态模式封装 */}
      <style>{`
        .jw-topology-svg {
          width: 100%;
          height: auto;
          min-height: 140px;
          display: block;
          user-select: none;
        }
        .jw-svg-connector {
          stroke: #475569;
          stroke-width: 2;
          fill: none;
          transition: stroke 0.2s ease, stroke-width 0.2s ease;
        }
        .jw-svg-connector.is-active {
          stroke: #10b981;
          stroke-width: 3;
          stroke-dasharray: 6 3;
          animation: jw-flow 1.2s linear infinite;
        }
        .jw-svg-connector.is-branch2.is-active {
          stroke: #f59e0b;
        }
        .jw-svg-node {
          cursor: pointer;
          transition: filter 0.2s ease, stroke 0.2s ease;
        }
        .jw-svg-node:hover {
          filter: drop-shadow(0 0 6px rgba(16, 185, 129, 0.4));
        }
        .jw-svg-node.is-selected {
          stroke: #10b981 !important;
          stroke-width: 2.5 !important;
          filter: drop-shadow(0 0 8px rgba(16, 185, 129, 0.6));
        }
        @keyframes jw-flow {
          from { stroke-dashoffset: 18; }
          to { stroke-dashoffset: 0; }
        }
        [data-reduced-motion="true"] .jw-svg-connector.is-active {
          animation: none !important;
          stroke-dasharray: none !important;
        }
        @media (prefers-reduced-motion: reduce) {
          .jw-svg-connector.is-active {
            animation: none !important;
            stroke-dasharray: none !important;
          }
        }
      `}</style>

      {/* 头部标题与拓扑说明 */}
      <div className="panel-header">
        <div className="panel-title-group">
          <h3 className="panel-title">连接拓扑与表映射</h3>
          <span className="panel-subtitle" data-testid="topology-layout-subtitle">
            {layoutLabel}
          </span>
        </div>
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
          {reducedMotion && (
            <span
              className="panel-badge"
              data-testid="reduced-motion-indicator"
              style={{ color: '#94a3b8', borderColor: '#475569' }}
            >
              减少动态模式
            </span>
          )}
          <span className="panel-badge">[SVG 拓扑 · 实算渲染]</span>
        </div>
      </div>

      {/* 核心 SVG 拓扑图 (支持 2/3 表结构与实际 JOIN 键) */}
      <div className="topology-schematic-box" style={{ gap: '12px' }}>
        <svg
          className="jw-topology-svg"
          viewBox={is3Table ? '0 0 540 180' : '0 0 540 130'}
          role="img"
          aria-label={`连接拓扑图：${layoutLabel}`}
          data-testid="topology-svg"
        >
          <title>{`连接拓扑图：${scenario.title}`}</title>
          <desc>
            {`基表包含 ${scenario.base.length} 行，第二表包含 ${scenario.mid.length} 行${
              is3Table ? `，第三表包含 ${scenario.tail.length} 行` : ''
            }。`}
          </desc>

          <defs>
            <marker
              id={`${svgId}-arrow-default`}
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 1 L 9 5 L 0 9 z" fill="#64748b" />
            </marker>
            <marker
              id={`${svgId}-arrow-active-teal`}
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 1 L 9 5 L 0 9 z" fill="#10b981" />
            </marker>
            <marker
              id={`${svgId}-arrow-active-amber`}
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 1 L 9 5 L 0 9 z" fill="#f59e0b" />
            </marker>
          </defs>

          {/* 1. 拓扑连线与实际 JOIN 键标注 */}
          {scenario.layout === 'single' ? (
            /* 单表连线: A -> B */
            <g className="svg-connector-group">
              <path
                d="M 170 65 L 360 65"
                className={`jw-svg-connector ${selectedRowId ? 'is-active' : ''}`}
                markerEnd={
                  selectedRowId
                    ? `url(#${svgId}-arrow-active-teal)`
                    : `url(#${svgId}-arrow-default)`
                }
              />
              <text
                x="265"
                y="55"
                textAnchor="middle"
                fill={selectedRowId ? '#10b981' : '#94a3b8'}
                fontSize="11"
                fontFamily="var(--font-mono)"
                fontWeight="600"
              >
                A.key = B.parentKey
              </text>
              {selectedKey && (
                <text
                  x="265"
                  y="80"
                  textAnchor="middle"
                  fill="#cbd5e1"
                  fontSize="10"
                  fontFamily="var(--font-mono)"
                >
                  {`['${selectedKey}'] ⟕ ${midMatchCount} 行`}
                </text>
              )}
            </g>
          ) : scenario.layout === 'star' ? (
            /* 星型连线: A -> B (上支路), A -> C (下支路) */
            <g className="svg-connector-group">
              {/* 支路 1: A -> B */}
              <path
                d="M 160 80 C 230 80, 260 45, 340 45"
                className={`jw-svg-connector ${selectedRowId ? 'is-active' : ''}`}
                markerEnd={
                  selectedRowId
                    ? `url(#${svgId}-arrow-active-teal)`
                    : `url(#${svgId}-arrow-default)`
                }
              />
              <text
                x="250"
                y="45"
                textAnchor="middle"
                fill={selectedRowId ? '#10b981' : '#94a3b8'}
                fontSize="10"
                fontFamily="var(--font-mono)"
                fontWeight="600"
              >
                A.key = B.parentKey
              </text>

              {/* 支路 2: A -> C */}
              <path
                d="M 160 100 C 230 100, 260 135, 340 135"
                className={`jw-svg-connector is-branch2 ${selectedRowId ? 'is-active' : ''}`}
                markerEnd={
                  selectedRowId
                    ? `url(#${svgId}-arrow-active-amber)`
                    : `url(#${svgId}-arrow-default)`
                }
              />
              <text
                x="250"
                y="135"
                textAnchor="middle"
                fill={selectedRowId ? '#f59e0b' : '#94a3b8'}
                fontSize="10"
                fontFamily="var(--font-mono)"
                fontWeight="600"
              >
                A.key = C.parentKey
              </text>
            </g>
          ) : (
            /* 链式级联连线: A -> B -> C */
            <g className="svg-connector-group">
              {/* 一跳: A -> B */}
              <path
                d="M 150 90 L 210 90"
                className={`jw-svg-connector ${selectedRowId ? 'is-active' : ''}`}
                markerEnd={
                  selectedRowId
                    ? `url(#${svgId}-arrow-active-teal)`
                    : `url(#${svgId}-arrow-default)`
                }
              />
              <text
                x="180"
                y="75"
                textAnchor="middle"
                fill={selectedRowId ? '#10b981' : '#94a3b8'}
                fontSize="9"
                fontFamily="var(--font-mono)"
                fontWeight="600"
              >
                A.key=B.parent
              </text>

              {/* 二跳: B -> C */}
              <path
                d="M 330 90 L 390 90"
                className={`jw-svg-connector is-branch2 ${selectedRowId ? 'is-active' : ''}`}
                markerEnd={
                  selectedRowId
                    ? `url(#${svgId}-arrow-active-amber)`
                    : `url(#${svgId}-arrow-default)`
                }
              />
              <text
                x="360"
                y="75"
                textAnchor="middle"
                fill={selectedRowId ? '#f59e0b' : '#94a3b8'}
                fontSize="9"
                fontFamily="var(--font-mono)"
                fontWeight="600"
              >
                B.link=C.parent
              </text>
            </g>
          )}

          {/* 2. 节点卡片绘制 */}
          {/* 节点 A: 基表 */}
          {scenario.layout === 'star' ? (
            <g
              className={`jw-svg-node ${selectedRowId ? 'is-selected' : ''}`}
              transform="translate(20, 50)"
            >
              <rect
                width="140"
                height="80"
                rx="6"
                fill="#0f172a"
                stroke={selectedRowId ? '#10b981' : '#334155'}
                strokeWidth="1.5"
              />
              <text x="70" y="24" textAnchor="middle" fill="#38bdf8" fontSize="12" fontWeight="700">
                [A orders]
              </text>
              <text x="70" y="44" textAnchor="middle" fill="#94a3b8" fontSize="11">
                {`基表 · ${scenario.base.length} 行`}
              </text>
              <text x="70" y="64" textAnchor="middle" fill="#10b981" fontSize="10" fontFamily="var(--font-mono)">
                {selectedKey ? `键: ${selectedKey}` : `首行键: ${scenario.base[0]?.key ?? 'NULL'}`}
              </text>
            </g>
          ) : scenario.layout === 'chain' ? (
            <g
              className={`jw-svg-node ${selectedRowId ? 'is-selected' : ''}`}
              transform="translate(15, 55)"
            >
              <rect
                width="135"
                height="70"
                rx="6"
                fill="#0f172a"
                stroke={selectedRowId ? '#10b981' : '#334155'}
                strokeWidth="1.5"
              />
              <text x="67" y="22" textAnchor="middle" fill="#38bdf8" fontSize="11" fontWeight="700">
                [A orders]
              </text>
              <text x="67" y="40" textAnchor="middle" fill="#94a3b8" fontSize="10">
                {`基表 · ${scenario.base.length} 行`}
              </text>
              <text x="67" y="58" textAnchor="middle" fill="#10b981" fontSize="10" fontFamily="var(--font-mono)">
                {selectedKey ? `键: ${selectedKey}` : `首键: ${scenario.base[0]?.key ?? 'NULL'}`}
              </text>
            </g>
          ) : (
            <g
              className={`jw-svg-node ${selectedRowId ? 'is-selected' : ''}`}
              transform="translate(30, 25)"
            >
              <rect
                width="140"
                height="80"
                rx="6"
                fill="#0f172a"
                stroke={selectedRowId ? '#10b981' : '#334155'}
                strokeWidth="1.5"
              />
              <text x="70" y="24" textAnchor="middle" fill="#38bdf8" fontSize="12" fontWeight="700">
                [A orders]
              </text>
              <text x="70" y="44" textAnchor="middle" fill="#94a3b8" fontSize="11">
                {`基表 · ${scenario.base.length} 行`}
              </text>
              <text x="70" y="64" textAnchor="middle" fill="#10b981" fontSize="10" fontFamily="var(--font-mono)">
                {selectedKey ? `键: ${selectedKey}` : `首行键: ${scenario.base[0]?.key ?? 'NULL'}`}
              </text>
            </g>
          )}

          {/* 节点 B: 第二表 */}
          {scenario.layout === 'star' ? (
            <g className="jw-svg-node" transform="translate(345, 12)">
              <rect
                width="160"
                height="64"
                rx="6"
                fill="#0f172a"
                stroke={selectedRowId && midMatchCount > 0 ? '#38bdf8' : '#334155'}
                strokeWidth="1.5"
              />
              <text x="80" y="22" textAnchor="middle" fill="#38bdf8" fontSize="12" fontWeight="700">
                {midTableLabel}
              </text>
              <text x="80" y="40" textAnchor="middle" fill="#94a3b8" fontSize="11">
                {`第二表 · ${scenario.mid.length} 行`}
              </text>
              {selectedRowId && (
                <text x="80" y="56" textAnchor="middle" fill="#38bdf8" fontSize="10" fontWeight="600">
                  {midMatchCount > 0
                    ? `匹配: ${midMatchCount} 条明细`
                    : '1 行 (无匹配，按 LEFT JOIN 保留 1 行)'}
                </text>
              )}
            </g>
          ) : scenario.layout === 'chain' ? (
            <g className="jw-svg-node" transform="translate(210, 55)">
              <rect
                width="120"
                height="70"
                rx="6"
                fill="#0f172a"
                stroke={selectedRowId && midMatchCount > 0 ? '#38bdf8' : '#334155'}
                strokeWidth="1.5"
              />
              <text x="60" y="22" textAnchor="middle" fill="#38bdf8" fontSize="11" fontWeight="700">
                {midTableLabel}
              </text>
              <text x="60" y="40" textAnchor="middle" fill="#94a3b8" fontSize="10">
                {`第二表 · ${scenario.mid.length} 行`}
              </text>
              <text x="60" y="58" textAnchor="middle" fill="#38bdf8" fontSize="9">
                {selectedRowId ? `匹配: ${midMatchCount} 行` : 'parentKey / linkKey'}
              </text>
            </g>
          ) : (
            <g className="jw-svg-node" transform="translate(360, 25)">
              <rect
                width="140"
                height="80"
                rx="6"
                fill="#0f172a"
                stroke={selectedRowId && midMatchCount > 0 ? '#38bdf8' : '#334155'}
                strokeWidth="1.5"
              />
              <text x="70" y="24" textAnchor="middle" fill="#38bdf8" fontSize="12" fontWeight="700">
                {midTableLabel}
              </text>
              <text x="70" y="44" textAnchor="middle" fill="#94a3b8" fontSize="11">
                {`第二表 · ${scenario.mid.length} 行`}
              </text>
              <text x="70" y="64" textAnchor="middle" fill="#38bdf8" fontSize="10">
                {selectedRowId
                  ? midMatchCount > 0
                    ? `匹配: ${midMatchCount} 行`
                    : '1 行 (无匹配，按 LEFT JOIN 保留 1 行)'
                  : `外键 parentKey`}
              </text>
            </g>
          )}

          {/* 节点 C: 第三表 (若为 3 表拓扑) */}
          {is3Table && scenario.layout === 'star' && (
            <g className="jw-svg-node" transform="translate(345, 102)">
              <rect
                width="160"
                height="64"
                rx="6"
                fill="#0f172a"
                stroke={selectedRowId && tailMatchCount > 0 ? '#f59e0b' : '#334155'}
                strokeWidth="1.5"
              />
              <text x="80" y="22" textAnchor="middle" fill="#f59e0b" fontSize="12" fontWeight="700">
                {tailTableLabel}
              </text>
              <text x="80" y="40" textAnchor="middle" fill="#94a3b8" fontSize="11">
                {`第三表 · ${scenario.tail.length} 行`}
              </text>
              {selectedRowId && (
                <text x="80" y="56" textAnchor="middle" fill="#f59e0b" fontSize="10" fontWeight="600">
                  {tailMatchCount > 0 ? `匹配: ${tailMatchCount} 条支付` : '未匹配 (保留 NULL 行)'}
                </text>
              )}
            </g>
          )}

          {is3Table && scenario.layout === 'chain' && (
            <g className="jw-svg-node" transform="translate(390, 55)">
              <rect
                width="135"
                height="70"
                rx="6"
                fill="#0f172a"
                stroke={selectedRowId && chainBranch2Count > 0 ? '#f59e0b' : '#334155'}
                strokeWidth="1.5"
              />
              <text x="67" y="22" textAnchor="middle" fill="#f59e0b" fontSize="11" fontWeight="700">
                {tailTableLabel}
              </text>
              <text x="67" y="40" textAnchor="middle" fill="#94a3b8" fontSize="10">
                {`第三表 · ${scenario.tail.length} 行`}
              </text>
              <text x="67" y="58" textAnchor="middle" fill="#f59e0b" fontSize="9">
                {selectedRowId ? `第二跳: ${chainBranch2Count}（路径数）` : '外键 parentKey'}
              </text>
            </g>
          )}
        </svg>

        {/* 选中行的高亮证据与笛卡尔分解浮层 */}
        {selectedBaseRow && (
          <div
            className="topology-highlight-banner"
            data-testid="topology-highlight-banner"
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '6px',
              padding: '10px 14px',
              backgroundColor: 'rgba(15, 23, 42, 0.85)',
              border: '1px solid #10b981',
              borderRadius: '6px',
              fontSize: '12px',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontWeight: 700, color: '#f8fafc' }}>
                {`高亮基表行: ${selectedBaseRow.id} (实际 JOIN 键: ${selectedKey ?? 'NULL'})`}
              </span>
              <span
                style={{
                  fontWeight: 700,
                  color: calculatedFactor && Number(calculatedFactor) > 1 ? '#f59e0b' : '#10b981',
                  fontFamily: 'var(--font-mono)',
                }}
              >
                {calculatedFactor !== null ? `展开因子: ${calculatedFactor} 倍` : '展开因子: —'}
              </span>
            </div>

            <div style={{ display: 'flex', gap: '16px', color: '#cbd5e1', fontSize: '11px' }}>
              <span>
                {`支路 1: ${midMatchCount === 0 ? '1 行 (无匹配，按 LEFT JOIN 保留 1 行)' : `${midMatchCount} 行匹配`}`}
              </span>
              {is3Table && (
                <span>
                  {scenario.layout === 'chain'
                    ? `第二跳: ${chainBranch2Count}（路径数） · 标注：路径数（同 C 行被多条 B 命中时重复计）${chainBranch2Count === 0 ? ' (LEFT JOIN 垫底 1 份 NULL)' : ''}`
                    : `支路 2: ${tailMatchCount} 行匹配${tailMatchCount === 0 ? ' (LEFT JOIN 垫底 1 份 NULL)' : ''}`
                  }
                </span>
              )}
              <span style={{ color: '#94a3b8' }}>
                {calculatedFactor === null
                  ? '计算逻辑: — (未分析)'
                  : scenario.layout === 'star'
                  ? (() => {
                      const bFactor = Math.max(1, midMatchCount);
                      const cFactor = Math.max(1, tailMatchCount);
                      const notes: string[] = [];
                      if (midMatchCount === 0) notes.push('支路1无匹配，按 LEFT JOIN 保留 1 行');
                      if (tailMatchCount === 0) notes.push('支路2无匹配，按 LEFT JOIN 保留 1 行');
                      const noteText = notes.length > 0 ? ` (${notes.join('；')})` : '';
                      return `计算逻辑: ${bFactor} × ${cFactor} = ${calculatedFactor} 份${noteText}`;
                    })()
                  : scenario.layout === 'chain'
                  ? `计算逻辑 (求和): ${
                      chainMidBreakdown.length > 1
                        ? `${chainMidBreakdown.map((b) => b.weight).join(' + ')} = ${calculatedFactor} 份`
                        : chainMidBreakdown.length === 1
                        ? `${chainMidBreakdown[0]!.weight} = ${calculatedFactor} 份`
                        : `${calculatedFactor} 份`
                    } (${
                      chainMidBreakdown.length > 0
                        ? chainMidBreakdown.map((b) => `${b.id}: ${b.cCount} 尾匹配${b.cCount === 0 ? ' (垫底 1 份)' : ''}`).join(', ')
                        : '无中行匹配'
                    })`
                  : `计算逻辑: ${Math.max(1, midMatchCount)} = ${calculatedFactor} 份${
                      midMatchCount === 0 ? ' (无匹配，按 LEFT JOIN 保留 1 行)' : ''
                    }`}
              </span>
            </div>
          </div>
        )}

        {/* 屏幕阅读器无障碍全文本替代 (U05) */}
        <div className="sr-only" aria-live="polite">
          <h4>连接拓扑文本摘要</h4>
          <p>{`当前场景为 ${scenario.title}，结构类型为 ${scenario.layout}。`}</p>
          <p>{`基表共 ${scenario.base.length} 行，第二表共 ${scenario.mid.length} 行${
            is3Table ? `，第三表共 ${scenario.tail.length} 行` : ''
          }。`}</p>
          {selectedBaseRow && (
            <p>
              {calculatedFactor !== null
                ? scenario.layout === 'chain'
                  ? `当前选中基表行 ${selectedBaseRow.id}，连接键为 ${selectedKey}，中行匹配 ${midMatchCount} 条记录，第二跳连接路径 ${chainBranch2Count} 条（路径数（同 C 行被多条 B 命中时重复计）），求和展开为 ${calculatedFactor} 份。`
                  : `当前选中基表行 ${selectedBaseRow.id}，连接键为 ${selectedKey}，支路1匹配 ${midMatchCount} 条记录，支路2匹配 ${tailMatchCount} 条记录，展开为 ${calculatedFactor} 份。`
                : `当前选中基表行 ${selectedBaseRow.id}，连接键为 ${selectedKey}，尚未运行连接分析。`}
            </p>
          )}
        </div>

        {/* SQL NULL 与连接规则提示条 */}
        <div className="topology-rule-hint" data-testid="topology-rule-hint">
          <strong>LEFT JOIN 规则说明：</strong>
          <span>未匹配行保留为 NULL；空值键 (NULL) 互不相连 (遵循 SQL = 严格语义)。</span>
        </div>
      </div>
    </div>
  );
};
