import { useState, useRef, type FC, type ChangeEvent } from 'react';
import type { Layout, Scenario } from '../core/types.js';
import { parseScenarioJson, serializeScenario, SCENARIO_FILENAME } from '../io/json.js';
import { importScenarioFromCsvSafe } from '../io/mapping.js';

export interface TableColumnMappingState {
  tableName: string;
  idCol: string;
  joinKeyCol: string;
  amountCol?: string;
  linkKeyCol?: string;
}

export interface CsvMappingFormState {
  layout: Layout;
  title: string;
  base: TableColumnMappingState;
  mid: TableColumnMappingState;
  tail: TableColumnMappingState;
}

export interface ImportPanelProps {
  currentLayout?: Layout;
  currentTitle?: string;
  disabled?: boolean;
  onLayoutChange?: (layout: Layout) => void;
  onImportScenario?: (scenario: Scenario) => void;
  onExportScenario?: () => void;
  onResetPreset?: () => void;
  onErrorMessage?: (message: string) => void;
  scenarioToExport?: Scenario | null;
  className?: string;
}

const DEFAULT_MAPPING_STATE: CsvMappingFormState = {
  layout: 'star',
  title: '自定义 CSV 映射导入',
  base: {
    tableName: 'orders',
    idCol: 'id',
    joinKeyCol: 'key',
    amountCol: 'amount',
  },
  mid: {
    tableName: 'items',
    idCol: 'id',
    joinKeyCol: 'parentKey',
    linkKeyCol: '',
  },
  tail: {
    tableName: 'payments',
    idCol: 'id',
    joinKeyCol: 'parentKey',
  },
};

/**
 * 导入导出与 CSV 映射向导面板
 */
export const ImportPanel: FC<ImportPanelProps> = ({
  currentLayout = 'star',
  currentTitle = 'JW-A 双支路暴增（合成）',
  disabled = false,
  onLayoutChange,
  onImportScenario,
  onExportScenario,
  onResetPreset,
  onErrorMessage,
  scenarioToExport,
  className = '',
}) => {
  const [showCsvWizard, setShowCsvWizard] = useState(false);
  const [mappingState, setMappingState] = useState<CsvMappingFormState>({
    ...DEFAULT_MAPPING_STATE,
    layout: currentLayout,
  });
  const [importNotice, setImportNotice] = useState<string | null>(null);
  const [validationHint, setValidationHint] = useState<string | null>(null);

  // CSV 文件文本状态
  const [baseCsvContent, setBaseCsvContent] = useState<string>('');
  const [midCsvContent, setMidCsvContent] = useState<string>('');
  const [tailCsvContent, setTailCsvContent] = useState<string>('');

  const jsonFileInputRef = useRef<HTMLInputElement | null>(null);
  const baseCsvInputRef = useRef<HTMLInputElement | null>(null);
  const midCsvInputRef = useRef<HTMLInputElement | null>(null);
  const tailCsvInputRef = useRef<HTMLInputElement | null>(null);

  // 切换 CSV 向导面板展开状态
  const toggleCsvWizard = () => {
    setShowCsvWizard((prev) => !prev);
  };

  // 触发 JSON 文件导入
  const handleJsonButtonClick = () => {
    if (jsonFileInputRef.current) {
      jsonFileInputRef.current.value = '';
      jsonFileInputRef.current.click();
    }
  };

  // 读取并解析用户选取的 JSON 文件
  const handleJsonFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const parsed = parseScenarioJson(text);
      setImportNotice(`成功导入场景: "${parsed.title}" (${parsed.layout} 布局)`);
      setValidationHint(null);
      if (onImportScenario) {
        onImportScenario(parsed);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setValidationHint(`JSON 导入错误: ${msg}`);
      if (onErrorMessage) {
        onErrorMessage(msg);
      }
    }
  };

  // 导出 JSON 场景（规范化 2 空格缩进，安全文件名 joinwitness-scenario.json）
  const handleExportClick = () => {
    if (onExportScenario) {
      onExportScenario();
      return;
    }

    if (!scenarioToExport) {
      setValidationHint('暂无可导出的场景数据。');
      return;
    }

    try {
      const serialized = serializeScenario(scenarioToExport);
      const blob = new Blob([serialized], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = SCENARIO_FILENAME;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setImportNotice(`已成功导出场景至 ${SCENARIO_FILENAME}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setValidationHint(`导出失败: ${msg}`);
      if (onErrorMessage) {
        onErrorMessage(msg);
      }
    }
  };

  // 处理布局选项切换
  const handleLayoutSelect = (newLayout: Layout) => {
    setMappingState((prev) => ({ ...prev, layout: newLayout }));
    if (onLayoutChange) {
      onLayoutChange(newLayout);
    }
  };

  // 处理 CSV 文件读取
  const handleCsvFileRead = async (
    e: ChangeEvent<HTMLInputElement>,
    setter: (content: string) => void,
    tableName: string
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      setter(text);
      setImportNotice(`已加载 ${tableName} CSV 文件 (${file.name}, ${text.length} 字节)`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setValidationHint(`读取 ${tableName} CSV 失败: ${msg}`);
    }
  };

  // 执行 CSV 映射导入
  const handleExecuteCsvImport = () => {
    if (!baseCsvContent) {
      setValidationHint('请先选择基表 A (Base) 的 CSV 文件。');
      return;
    }

    if (!midCsvContent) {
      setValidationHint('请先选择第二表 B (Mid) 的 CSV 文件。');
      return;
    }

    const config: Parameters<typeof importScenarioFromCsvSafe>[0] = {
      layout: mappingState.layout,
      title: mappingState.title || '自定义 CSV 映射导入',
      base: {
        csv: baseCsvContent,
        mapping: {
          idColumn: mappingState.base.idCol,
          keyColumn: mappingState.base.joinKeyCol,
          amountColumn: mappingState.base.amountCol || 'amount',
        },
      },
      mid: {
        csv: midCsvContent,
        mapping: {
          idColumn: mappingState.mid.idCol,
          parentKeyColumn: mappingState.mid.joinKeyCol,
          ...(mappingState.layout === 'chain' && mappingState.mid.linkKeyCol
            ? { linkKeyColumn: mappingState.mid.linkKeyCol }
            : {}),
        },
      },
    };

    if (mappingState.layout !== 'single' && tailCsvContent) {
      config.tail = {
        csv: tailCsvContent,
        mapping: {
          idColumn: mappingState.tail.idCol,
          parentKeyColumn: mappingState.tail.joinKeyCol,
        },
      };
    }

    const res = importScenarioFromCsvSafe(config);

    if (!res.ok) {
      const errMsg = res.errors.join('; ');
      setValidationHint(`CSV 映射错误: ${errMsg}`);
      if (onErrorMessage) {
        onErrorMessage(errMsg);
      }
      return;
    }

    // 覆盖数据来源为 user_imported
    const finalScenario: Scenario = {
      ...res.scenario,
      source: 'user_imported',
    };

    setImportNotice(`成功从 CSV 组装场景: "${finalScenario.title}" (共 ${finalScenario.base.length} 条基表数据)`);
    setValidationHint(null);
    setShowCsvWizard(false);
    if (onImportScenario) {
      onImportScenario(finalScenario);
    }
  };

  return (
    <section
      className={`import-panel ${className}`.trim()}
      aria-label="数据导入导出与列映射控制区"
    >
      <div className="import-actions-row">
        {/* CSV 映射向导展开按钮 */}
        <button
          type="button"
          id="btn-import-csv"
          className="btn btn-secondary btn-import-csv"
          onClick={toggleCsvWizard}
          aria-expanded={showCsvWizard}
          aria-controls="csv-mapping-wizard-panel"
          disabled={disabled}
          title="展开 CSV 导入向导与列映射配置"
        >
          <span className="btn-icon" aria-hidden="true">
            📂
          </span>
          <span>{showCsvWizard ? '收起 CSV 向导' : '导入 CSV'}</span>
        </button>

        {/* JSON 导入按钮与隐藏 input */}
        <button
          type="button"
          id="btn-import-json"
          className="btn btn-secondary btn-import-json"
          onClick={handleJsonButtonClick}
          disabled={disabled}
          title="导入标准 joinwitness.scenario/v1 格式的 JSON 场景"
        >
          <span className="btn-icon" aria-hidden="true">
            📥
          </span>
          <span>导入 JSON</span>
        </button>

        <input
          ref={jsonFileInputRef}
          type="file"
          id="input-file-scenario-json"
          accept=".json,application/json"
          style={{ display: 'none' }}
          onChange={handleJsonFileChange}
          aria-label="选择场景 JSON 文件"
        />

        {/* JSON 导出按钮 */}
        <button
          type="button"
          id="btn-export-json"
          className="btn btn-secondary btn-export-json"
          onClick={handleExportClick}
          disabled={disabled}
          title="导出当前场景为 joinwitness-scenario.json"
        >
          <span className="btn-icon" aria-hidden="true">
            📤
          </span>
          <span>导出 JSON</span>
        </button>

        {/* 恢复预设 / 重置按钮 */}
        {onResetPreset && (
          <button
            type="button"
            id="btn-reset-preset"
            className="btn btn-ghost btn-reset"
            onClick={onResetPreset}
            disabled={disabled}
            title="清空用户导入状态，重置为默认预设 JW-A"
          >
            <span>重置预设</span>
          </button>
        )}
      </div>

      {/* 提示消息 */}
      {importNotice && (
        <div className="import-notice-banner" role="status">
          <span className="notice-icon" aria-hidden="true">
            ℹ️
          </span>
          <span className="notice-text">{importNotice}</span>
          <button
            type="button"
            className="notice-close"
            onClick={() => setImportNotice(null)}
            aria-label="关闭提示"
          >
            ×
          </button>
        </div>
      )}

      {/* 校验错误提示结构 */}
      {validationHint && (
        <div className="import-error-banner" role="alert">
          <span className="error-icon" aria-hidden="true">
            ⚠️
          </span>
          <div className="error-body">
            <strong>数据约束或格式错误：</strong>
            <span>{validationHint}</span>
            <div className="error-fix-hint">
              <strong>修复建议：</strong>请检查 CSV 行号/列名，确保 ID 唯一且金额为整数分或至多两位小数。
            </div>
          </div>
          <button
            type="button"
            className="error-close"
            onClick={() => setValidationHint(null)}
            aria-label="关闭错误"
          >
            ×
          </button>
        </div>
      )}

      {/* CSV 映射向导面板 */}
      {showCsvWizard && (
        <div
          id="csv-mapping-wizard-panel"
          className="csv-wizard-panel"
          role="region"
          aria-label="CSV 字段映射向导"
        >
          <div className="csv-wizard-header">
            <h4>CSV 列映射与拓扑配置</h4>
            <span className="csv-wizard-subtitle">
              基表声明 (Base Table)：声明主分析粒度与度量金额列；设定 LEFT JOIN 拓扑 (至多 5,000 行/表)
            </span>
          </div>

          {/* 拓扑选择单选组 */}
          <div className="wizard-form-group">
            <span className="form-label" id="label-layout-choice">
              关联拓扑布局 (Layout)：
            </span>
            <div
              className="layout-radio-group"
              role="radiogroup"
              aria-labelledby="label-layout-choice"
            >
              <label className="radio-label">
                <input
                  type="radio"
                  name="csv-layout"
                  value="star"
                  checked={mappingState.layout === 'star'}
                  onChange={() => handleLayoutSelect('star')}
                />
                <span>星型 (star): A orders → B items, A orders ↘ C payments</span>
              </label>

              <label className="radio-label">
                <input
                  type="radio"
                  name="csv-layout"
                  value="chain"
                  checked={mappingState.layout === 'chain'}
                  onChange={() => handleLayoutSelect('chain')}
                />
                <span>链式 (chain): A orders → B items → C shipments</span>
              </label>

              <label className="radio-label">
                <input
                  type="radio"
                  name="csv-layout"
                  value="single"
                  checked={mappingState.layout === 'single'}
                  onChange={() => handleLayoutSelect('single')}
                />
                <span>单表 (single): A orders → B items (无第三表)</span>
              </label>
            </div>
          </div>

          {/* 表映射卡片三列网格 */}
          <div className="mapping-cards-grid">
            {/* 基表 A 映射 */}
            <div className="mapping-card base-card">
              <div className="mapping-card-header">
                <span className="table-badge badge-teal">基表 A (Base)</span>
                <span className="card-hint">主分析粒度 · 唯一度量金额宿主</span>
              </div>
              <div className="mapping-fields">
                <label className="field-group">
                  <span className="field-label">表名：</span>
                  <input
                    type="text"
                    className="input-text"
                    value={mappingState.base.tableName}
                    onChange={(e) =>
                      setMappingState((prev) => ({
                        ...prev,
                        base: { ...prev.base, tableName: e.target.value },
                      }))
                    }
                    placeholder="orders"
                  />
                </label>
                <label className="field-group">
                  <span className="field-label">行标识 (id)：</span>
                  <input
                    type="text"
                    className="input-text"
                    value={mappingState.base.idCol}
                    onChange={(e) =>
                      setMappingState((prev) => ({
                        ...prev,
                        base: { ...prev.base, idCol: e.target.value },
                      }))
                    }
                    placeholder="id"
                  />
                </label>
                <label className="field-group">
                  <span className="field-label">关联键 (key)：</span>
                  <input
                    type="text"
                    className="input-text"
                    value={mappingState.base.joinKeyCol}
                    onChange={(e) =>
                      setMappingState((prev) => ({
                        ...prev,
                        base: { ...prev.base, joinKeyCol: e.target.value },
                      }))
                    }
                    placeholder="order_id"
                  />
                </label>
                <label className="field-group">
                  <span className="field-label">金额列 (amount)：</span>
                  <input
                    type="text"
                    className="input-text"
                    value={mappingState.base.amountCol ?? ''}
                    onChange={(e) =>
                      setMappingState((prev) => ({
                        ...prev,
                        base: { ...prev.base, amountCol: e.target.value },
                      }))
                    }
                    placeholder="amount"
                  />
                </label>
                <div className="field-group">
                  <span className="field-label">CSV 数据源：</span>
                  <input
                    ref={baseCsvInputRef}
                    type="file"
                    accept=".csv,text/csv"
                    className="input-file"
                    onChange={(e) => handleCsvFileRead(e, setBaseCsvContent, '基表 A')}
                  />
                  {baseCsvContent && <span className="file-loaded-tag">✓ 已加载 ({baseCsvContent.length} 字节)</span>}
                </div>
              </div>
            </div>

            {/* 关联表 B 映射 */}
            <div className="mapping-card mid-card">
              <div className="mapping-card-header">
                <span className="table-badge badge-blue">第二表 B (Mid)</span>
                <span className="card-hint">明细/支路 1</span>
              </div>
              <div className="mapping-fields">
                <label className="field-group">
                  <span className="field-label">表名：</span>
                  <input
                    type="text"
                    className="input-text"
                    value={mappingState.mid.tableName}
                    onChange={(e) =>
                      setMappingState((prev) => ({
                        ...prev,
                        mid: { ...prev.mid, tableName: e.target.value },
                      }))
                    }
                    placeholder="items"
                  />
                </label>
                <label className="field-group">
                  <span className="field-label">行标识 (id)：</span>
                  <input
                    type="text"
                    className="input-text"
                    value={mappingState.mid.idCol}
                    onChange={(e) =>
                      setMappingState((prev) => ({
                        ...prev,
                        mid: { ...prev.mid, idCol: e.target.value },
                      }))
                    }
                    placeholder="id"
                  />
                </label>
                <label className="field-group">
                  <span className="field-label">外键 (parentKey)：</span>
                  <input
                    type="text"
                    className="input-text"
                    value={mappingState.mid.joinKeyCol}
                    onChange={(e) =>
                      setMappingState((prev) => ({
                        ...prev,
                        mid: { ...prev.mid, joinKeyCol: e.target.value },
                      }))
                    }
                    placeholder="order_id"
                  />
                </label>
                {mappingState.layout === 'chain' && (
                  <label className="field-group">
                    <span className="field-label">下级外键 (linkKey)：</span>
                    <input
                      type="text"
                      className="input-text"
                      value={mappingState.mid.linkKeyCol ?? ''}
                      onChange={(e) =>
                        setMappingState((prev) => ({
                          ...prev,
                          mid: { ...prev.mid, linkKeyCol: e.target.value },
                        }))
                      }
                      placeholder="item_id"
                    />
                  </label>
                )}
                <div className="field-group">
                  <span className="field-label">CSV 数据源：</span>
                  <input
                    ref={midCsvInputRef}
                    type="file"
                    accept=".csv,text/csv"
                    className="input-file"
                    onChange={(e) => handleCsvFileRead(e, setMidCsvContent, '第二表 B')}
                  />
                  {midCsvContent && <span className="file-loaded-tag">✓ 已加载 ({midCsvContent.length} 字节)</span>}
                </div>
              </div>
            </div>

            {/* 关联表 C 映射 (star 与 chain 必需) */}
            {mappingState.layout !== 'single' && (
              <div className="mapping-card tail-card">
                <div className="mapping-card-header">
                  <span className="table-badge badge-amber">第三表 C (Tail)</span>
                  <span className="card-hint">
                    {mappingState.layout === 'star' ? '支付/支路 2' : '物流/下游层'}
                  </span>
                </div>
                <div className="mapping-fields">
                  <label className="field-group">
                    <span className="field-label">表名：</span>
                    <input
                      type="text"
                      className="input-text"
                      value={mappingState.tail.tableName}
                      onChange={(e) =>
                        setMappingState((prev) => ({
                          ...prev,
                          tail: { ...prev.tail, tableName: e.target.value },
                        }))
                      }
                      placeholder="payments"
                    />
                  </label>
                  <label className="field-group">
                    <span className="field-label">行标识 (id)：</span>
                    <input
                      type="text"
                      className="input-text"
                      value={mappingState.tail.idCol}
                      onChange={(e) =>
                        setMappingState((prev) => ({
                          ...prev,
                          tail: { ...prev.tail, idCol: e.target.value },
                        }))
                      }
                      placeholder="id"
                    />
                  </label>
                  <label className="field-group">
                    <span className="field-label">
                      {mappingState.layout === 'star' ? '外键 (A.key)：' : '外键 (B.linkKey)：'}
                    </span>
                    <input
                      type="text"
                      className="input-text"
                      value={mappingState.tail.joinKeyCol}
                      onChange={(e) =>
                        setMappingState((prev) => ({
                          ...prev,
                          tail: { ...prev.tail, joinKeyCol: e.target.value },
                        }))
                      }
                      placeholder={mappingState.layout === 'star' ? 'order_id' : 'item_id'}
                    />
                  </label>
                  <div className="field-group">
                    <span className="field-label">CSV 数据源：</span>
                    <input
                      ref={tailCsvInputRef}
                      type="file"
                      accept=".csv,text/csv"
                      className="input-file"
                      onChange={(e) => handleCsvFileRead(e, setTailCsvContent, '第三表 C')}
                    />
                    {tailCsvContent && <span className="file-loaded-tag">✓ 已加载 ({tailCsvContent.length} 字节)</span>}
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="wizard-actions-row" style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '12px', gap: '8px' }}>
            <button
              type="button"
              className="btn btn-primary btn-execute-csv-import"
              onClick={handleExecuteCsvImport}
            >
              <span>执行 CSV 映射并导入</span>
            </button>
          </div>

          <div className="wizard-footer">
            <span className="wizard-footnote">
              * 映射配置与 CSV 数据仅在前端内存中保留。支持 CSV 单文件最大 2 MiB、金额至多 2 位小数。
            </span>
          </div>
        </div>
      )}
    </section>
  );
};
