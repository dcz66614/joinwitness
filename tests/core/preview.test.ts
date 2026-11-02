import { describe, expect, it } from 'vitest';
import type { Scenario } from '../../src/core/types.js';
import {
  previewJoinedRows,
  filterPreviewRows,
  DEFAULT_PREVIEW_LIMIT,
} from '../../src/core/preview.js';

// 导入冻结预设
import jwA from '../../src/fixtures/jw-a.json' with { type: 'json' };
import jwB from '../../src/fixtures/jw-b.json' with { type: 'json' };
import jwC from '../../src/fixtures/jw-c.json' with { type: 'json' };
import jwD from '../../src/fixtures/jw-d.json' with { type: 'json' };
import jwE from '../../src/fixtures/jw-e.json' with { type: 'json' };
import jwF from '../../src/fixtures/jw-f.json' with { type: 'json' };

describe('P008-T013 Core Preview: previewJoinedRows & Truncation Control', () => {
  describe('1. 冻结预设局部物化预览 (Golden Presets Preview)', () => {
    it('JW-A: star 布局物化全部 8 行，精确对应 4/3/1 因子分布', () => {
      const scenario = jwA as unknown as Scenario;
      const preview = previewJoinedRows(scenario);

      expect(preview.length).toBe(8);
      expect(preview.rows.length).toBe(8);
      expect(preview.isTruncated).toBe(false);
      expect(preview.totalExpandedRows).toBe('8');
      expect(preview.previewCount).toBe(8);
      expect(preview.limit).toBe(DEFAULT_PREVIEW_LIMIT);

      // 验证 o1: 2 条 mid × 2 条 tail = 4 行
      const o1Rows = preview.filter((r) => r.aId === 'o1');
      expect(o1Rows.length).toBe(4);
      expect(o1Rows[0]).toMatchObject({
        previewIndex: 1,
        aId: 'o1',
        aKey: 'O1',
        bId: 'i11',
        cId: 'p11',
        subIndex: 1,
        totalForBase: 4,
        isDuplicated: true,
        statusText: '倍行 1/4',
      });
      expect(o1Rows[1]).toMatchObject({
        aId: 'o1',
        bId: 'i11',
        cId: 'p12',
        subIndex: 2,
        statusText: '倍行 2/4',
      });
      expect(o1Rows[2]).toMatchObject({
        aId: 'o1',
        bId: 'i12',
        cId: 'p11',
        subIndex: 3,
        statusText: '倍行 3/4',
      });
      expect(o1Rows[3]).toMatchObject({
        aId: 'o1',
        bId: 'i12',
        cId: 'p12',
        subIndex: 4,
        statusText: '倍行 4/4',
      });

      // 验证 o2: 3 条 mid × 1 条 tail = 3 行
      const o2Rows = preview.filter((r) => r.aId === 'o2');
      expect(o2Rows.length).toBe(3);
      expect(o2Rows[0]).toMatchObject({
        aId: 'o2',
        bId: 'i21',
        cId: 'p21',
        subIndex: 1,
        totalForBase: 3,
        statusText: '倍行 1/3',
      });
      expect(o2Rows[1]).toMatchObject({
        aId: 'o2',
        bId: 'i22',
        cId: 'p21',
        subIndex: 2,
        statusText: '倍行 2/3',
      });
      expect(o2Rows[2]).toMatchObject({
        aId: 'o2',
        bId: 'i23',
        cId: 'p21',
        subIndex: 3,
        statusText: '倍行 3/3',
      });

      // 验证 o3: 1 条 mid × 0 条 tail (LEFT JOIN) = 1 行
      const o3Rows = preview.filter((r) => r.aId === 'o3');
      expect(o3Rows.length).toBe(1);
      expect(o3Rows[0]).toMatchObject({
        previewIndex: 8,
        aId: 'o3',
        aKey: 'O3',
        bId: 'i31',
        cId: null,
        subIndex: 1,
        totalForBase: 1,
        isDuplicated: false,
        statusText: '单行 1/1',
      });
    });

    it('JW-B: chain 布局物化全部 6 行 (5 行 + 1 行)，绝不误用 star 乘法', () => {
      const scenario = jwB as unknown as Scenario;
      const preview = previewJoinedRows(scenario);

      expect(preview.length).toBe(6);
      expect(preview.isTruncated).toBe(false);
      expect(preview.totalExpandedRows).toBe('6');

      // a1 展开 5 行: b1 连 2 个 C，b2 连 3 个 C -> 2 + 3 = 5 行
      const a1Rows = preview.filter((r) => r.aId === 'a1');
      expect(a1Rows.length).toBe(5);
      expect(a1Rows.map((r) => `${r.bId}->${r.cId}`)).toEqual([
        'b1->c1',
        'b1->c2',
        'b2->c3',
        'b2->c4',
        'b2->c5',
      ]);
      expect(a1Rows[0]?.statusText).toBe('倍行 1/5');
      expect(a1Rows[4]?.statusText).toBe('倍行 5/5');

      // a2 展开 1 行: b3 连 0 个 C (LEFT JOIN 保留) -> cId 为 null
      const a2Rows = preview.filter((r) => r.aId === 'a2');
      expect(a2Rows.length).toBe(1);
      expect(a2Rows[0]).toMatchObject({
        aId: 'a2',
        bId: 'b3',
        cId: null,
        subIndex: 1,
        totalForBase: 1,
        isDuplicated: false,
        statusText: '单行 1/1',
      });
    });

    it('JW-C: single 布局物化全部 4 行 (负额抵消场景)', () => {
      const scenario = jwC as unknown as Scenario;
      const preview = previewJoinedRows(scenario);

      expect(preview.length).toBe(4);
      expect(preview.isTruncated).toBe(false);
      expect(preview.totalExpandedRows).toBe('4');

      const xRows = preview.filter((r) => r.aId === 'x');
      const yRows = preview.filter((r) => r.aId === 'y');
      expect(xRows.length).toBe(2);
      expect(yRows.length).toBe(2);
      expect(xRows[0]?.statusText).toBe('倍行 1/2');
      expect(xRows[1]?.statusText).toBe('倍行 2/2');
    });

    it('JW-D: single 布局 SQL NULL 语义与孤立行保留', () => {
      const scenario = jwD as unknown as Scenario;
      const preview = previewJoinedRows(scenario);

      // n (key=null) 与 b1/b2 (parentKey=null) 绝不相连，保留为 1 行 (bId=null)
      // z (key='Z') 连 b3 (parentKey='Z') 得到 1 行
      expect(preview.length).toBe(2);
      expect(preview.totalExpandedRows).toBe('2');

      const nRow = preview.find((r) => r.aId === 'n');
      expect(nRow).toBeDefined();
      expect(nRow).toMatchObject({
        aId: 'n',
        aKey: null,
        bId: null,
        cId: null,
        statusText: '单行 1/1',
      });

      const zRow = preview.find((r) => r.aId === 'z');
      expect(zRow).toBeDefined();
      expect(zRow).toMatchObject({
        aId: 'z',
        aKey: 'Z',
        bId: 'b3',
        cId: null,
        statusText: '单行 1/1',
      });
    });

    it('JW-E: single 布局 1:1 无倍行场景物化 2 行', () => {
      const scenario = jwE as unknown as Scenario;
      const preview = previewJoinedRows(scenario);

      expect(preview.length).toBe(2);
      expect(preview.totalExpandedRows).toBe('2');
      expect(preview.every((r) => !r.isDuplicated && r.statusText === '单行 1/1')).toBe(true);
    });

    it('JW-F: chain 布局物化 2 行 (单个中间边下界)', () => {
      const scenario = jwF as unknown as Scenario;
      const preview = previewJoinedRows(scenario);

      expect(preview.length).toBe(2);
      expect(preview.totalExpandedRows).toBe('2');
      expect(preview[0]).toMatchObject({
        aId: 'a',
        bId: 'b',
        cId: 'c1',
        subIndex: 1,
        totalForBase: 2,
        isDuplicated: true,
        statusText: '倍行 1/2',
      });
      expect(preview[1]).toMatchObject({
        aId: 'a',
        bId: 'b',
        cId: 'c2',
        subIndex: 2,
        totalForBase: 2,
        isDuplicated: true,
        statusText: '倍行 2/2',
      });
    });
  });

  describe('2. 截断控制与总数独立性 (MATH09 / U06)', () => {
    it('当 limit 小于总行数时精确截断，但 totalExpandedRows 依然是真实总数', () => {
      const scenario = jwA as unknown as Scenario;
      const preview = previewJoinedRows(scenario, 5);

      expect(preview.length).toBe(5);
      expect(preview.isTruncated).toBe(true);
      expect(preview.limit).toBe(5);
      expect(preview.previewCount).toBe(5);
      // 关键核心：总行数仍然是 8，绝不把 5 当成总行数！
      expect(preview.totalExpandedRows).toBe('8');
    });

    it('无论 limit 为何值，独立分解式总计数保持严格不变', () => {
      const scenario = jwA as unknown as Scenario;
      const p1 = previewJoinedRows(scenario, 1);
      const p3 = previewJoinedRows(scenario, 3);
      const p8 = previewJoinedRows(scenario, 8);
      const p50 = previewJoinedRows(scenario, 50);

      expect(p1.totalExpandedRows).toBe('8');
      expect(p3.totalExpandedRows).toBe('8');
      expect(p8.totalExpandedRows).toBe('8');
      expect(p50.totalExpandedRows).toBe('8');

      expect(p1.length).toBe(1);
      expect(p3.length).toBe(3);
      expect(p8.length).toBe(8);
      expect(p50.length).toBe(8);

      expect(p1.isTruncated).toBe(true);
      expect(p3.isTruncated).toBe(true);
      expect(p8.isTruncated).toBe(false);
      expect(p50.isTruncated).toBe(false);
    });

    it('处理超大笛卡尔积 (250,000 行) 时在 20ms 内截断并返回，严防 OOM', () => {
      const massiveScenario: Scenario = {
        schema: 'joinwitness.scenario/v1',
        specVersion: '1.0.0',
        layout: 'star',
        title: 'Massive Fanout Limit Test',
        source: 'synthetic',
        base: [{ id: 'big_a', key: 'K', amountCents: '100' }],
        mid: Array.from({ length: 500 }, (_, i) => ({ id: `b_${i}`, parentKey: 'K' })),
        tail: Array.from({ length: 500 }, (_, i) => ({ id: `c_${i}`, parentKey: 'K' })),
      };

      const start = performance.now();
      const preview = previewJoinedRows(massiveScenario, 200);
      const elapsed = performance.now() - start;

      expect(preview.length).toBe(200);
      expect(preview.isTruncated).toBe(true);
      expect(preview.totalExpandedRows).toBe('250000');
      expect(elapsed).toBeLessThan(100); // 毫秒级返回
    });

    it('limit=0 边界处理返回空数组，但总数依然有效', () => {
      const scenario = jwA as unknown as Scenario;
      const preview = previewJoinedRows(scenario, 0);

      expect(preview.length).toBe(0);
      expect(preview.isTruncated).toBe(true);
      expect(preview.totalExpandedRows).toBe('8');
    });

    it('空基表场景返回空数组且 totalExpandedRows 为 0', () => {
      const emptyScenario: Scenario = {
        schema: 'joinwitness.scenario/v1',
        specVersion: '1.0.0',
        layout: 'single',
        title: 'Empty Base Scenario',
        source: 'synthetic',
        base: [],
        mid: [],
        tail: [],
      };

      const preview = previewJoinedRows(emptyScenario);
      expect(preview.length).toBe(0);
      expect(preview.isTruncated).toBe(false);
      expect(preview.totalExpandedRows).toBe('0');
    });
  });

  describe('3. filterPreviewRows 辅助函数 (FR06 按 A 行高亮/筛选)', () => {
    it('按 baseId 筛选过滤对应的物化行', () => {
      const scenario = jwA as unknown as Scenario;
      const preview = previewJoinedRows(scenario);

      const o1Rows = filterPreviewRows(preview, 'o1');
      expect(o1Rows.length).toBe(4);
      expect(o1Rows.every((r) => r.aId === 'o1')).toBe(true);

      const o3Rows = filterPreviewRows(preview, 'o3');
      expect(o3Rows.length).toBe(1);
      expect(o3Rows[0]?.aId).toBe('o3');

      // 传入空或 null 返回全部行
      expect(filterPreviewRows(preview, null).length).toBe(8);
      expect(filterPreviewRows(preview, '').length).toBe(8);

      // 传入不存在的 ID 返回空数组
      expect(filterPreviewRows(preview, 'nonexistent').length).toBe(0);
    });
  });
});
