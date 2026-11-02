import type { FC } from 'react';
import type { AnalysisStatus } from '../workers/workerProtocol.js';

export interface StatusBarProps {
  status: AnalysisStatus;
  message?: string | null | undefined;
  jobId?: string | number | null | undefined;
  durationMs?: number | null | undefined;
  className?: string | undefined;
}

interface StatusMeta {
  label: string;
  badgeClass: string;
  icon: string;
  defaultMessage: string;
  ariaDescription: string;
}

const STATUS_CONFIG: Record<AnalysisStatus, StatusMeta> = {
  IDLE: {
    label: '就绪 (IDLE)',
    badgeClass: 'status-badge-idle',
    icon: '○',
    defaultMessage: '系统就绪：请选择预设场景或导入 CSV/JSON，点击【运行连接】开始分析。',
    ariaDescription: '分析引擎处于就绪状态，等待用户操作',
  },
  VALIDATING: {
    label: '验证中 (VALIDATING)',
    badgeClass: 'status-badge-validating',
    icon: '◌',
    defaultMessage: '正在校验数据规范、表行键唯一性与金额格式...',
    ariaDescription: '正在验证输入数据规范与数据约束',
  },
  RUNNING: {
    label: '计算中 (RUNNING)',
    badgeClass: 'status-badge-running',
    icon: '⚡',
    defaultMessage: 'Dedicated Worker 正在计算分解式倍行因子、BigInt 金额归因与最小反例...',
    ariaDescription: '分析引擎正在后台 Worker 中离线计算',
  },
  COMPLETE: {
    label: '已完成 (COMPLETE)',
    badgeClass: 'status-badge-complete',
    icon: '✓',
    defaultMessage: '分析计算完成，所有指标已更新 (纯前端离线计算，无网络请求)。',
    ariaDescription: '分析计算成功完成',
  },
  STALE: {
    label: '已过期 (STALE)',
    badgeClass: 'status-badge-stale',
    icon: '⟳',
    defaultMessage: '输入数据或预设已变更，下方分析结果已标为过期，请重新点击【运行连接】。',
    ariaDescription: '输入已更改，当前视图处于过期状态，需重新计算',
  },
  ERROR: {
    label: '错误 (ERROR)',
    badgeClass: 'status-badge-error',
    icon: '✕',
    defaultMessage: '计算或校验发生错误，请查看下方详细错误信息与修复操作。',
    ariaDescription: '执行失败，存在数据错误或计算异常',
  },
};

/**
 * 状态条组件 — 呈现分析引擎实时操作状态、Job 标识与离线安全声明
 */
export const StatusBar: FC<StatusBarProps> = ({
  status,
  message,
  jobId,
  durationMs,
  className = '',
}) => {
  const meta = STATUS_CONFIG[status] ?? STATUS_CONFIG.IDLE;
  const displayMessage = message || meta.defaultMessage;

  return (
    <aside
      className={`status-bar ${meta.badgeClass}-container ${className}`.trim()}
      role="status"
      aria-live="polite"
      aria-atomic="true"
      aria-label={`引擎状态: ${meta.label}`}
    >
      <div className="status-bar-left">
        <span
          className={`status-badge ${meta.badgeClass}`}
          title={meta.ariaDescription}
          data-status={status}
        >
          <span className="status-badge-icon" aria-hidden="true">
            {meta.icon}
          </span>
          <span className="status-badge-text">{meta.label}</span>
        </span>

        {jobId !== undefined && jobId !== null && (
          <span className="status-job-id" title={`当前执行批次 ID: ${jobId}`}>
            {`Job #${jobId}`}
          </span>
        )}

        {durationMs !== undefined && durationMs !== null && (
          <span className="status-duration" title="纯前端计算耗时">
            {`耗时 ${durationMs.toFixed(1)}ms`}
          </span>
        )}

        <span className="status-message">{displayMessage}</span>
      </div>

      <div className="status-bar-right">
        <span
          className="status-privacy-tag"
          title="纯前端内存计算，无数据上传，不持久化敏感业务数据"
        >
          🔒 本地离线环境
        </span>
      </div>
    </aside>
  );
};
