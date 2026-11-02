# P008 倍行镜 JoinWitness 测试计划与不变量验证规范

- **项目标识：** P008 JoinWitness
- **版本：** 1.0.0
- **基线文档：** `PROJECT_BOOK.md` §5, §6, §9 (MATH01—10), §10; `IMPLEMENTATION_PLAN.md` (P008-T007)
- **阶段状态：** S1 核心算法数学门禁与规模不变量验证

---

## 1. 测试体系与架构分层

JoinWitness 测试体系分为五大层级，旨在通过严密的数学证明、独立双轨复核（Dual-Track Oracle）、不变量保持（Invariant Preservation）与真实 CPU 性能压测，确保算法无漏洞、零浮点失真与高阶笛卡尔积防爆。

```
                  ┌───────────────────────────────────────────────┐
                  │ E2E 集成测试 (Playwright)                      │
                  │ (T014-T017: 浏览器全流程、无网模式、断网验证)      │
                  └───────────────────────┬───────────────────────┘
                                          │
                  ┌───────────────────────┴───────────────────────┐
                  │ 独立 Oracle 对抗测试 (Vitest)                 │
                  │ (T006: 1000 例盲测、785 组独立穷举最小性验证)   │
                  └───────────────────────┬───────────────────────┘
                                          │
                  ┌───────────────────────┴───────────────────────┐
                  │ 不变量与规模压力测试 (T007 Vitest & Bench)      │
                  │ (invariants.test.ts, scale.test.ts, bench)    │
                  └───────────────────────┬───────────────────────┘
                                          │
                  ┌───────────────────────┴───────────────────────┐
                  │ 核心算法单元测试 (T003-T005 Vitest)             │
                  │ (validate, factor, amount, witness)           │
                  └───────────────────────────────────────────────┘
```

---

## 2. 数学约束与核心不变量 (MATH01 — MATH10)

| 编号 | 约束名称 | 核心定义与验证依据 | 负责测试文件 |
|---|---|---|---|
| **MATH01** | JW-A 星型相乘与行级归因 | 独立分支相乘：$f_i = \max(1, b_i) \times \max(1, c_i)$；$f=[4,3,1]$，总 8 行，金额 8600 / 28400 / 19800 精确一致。 | `factor.test.ts`<br>`amount.test.ts` |
| **MATH02** | JW-B 链式分支求和 | 链式路径求和：$f_i = \sum_{b \in B(i)} \max(1, c_b)$；$f=[5,1]$，总 6 行，金额 3700 / 15700 / 12000，**严禁错误使用星型乘法**。 | `factor.test.ts`<br>`amount.test.ts` |
| **MATH03** | JW-C 负数抵消与结构安全 | 正负金额误差抵消：$\Delta = 0$ 但 `unsafeBaseRows = 2`；证明差额为零不能作为结构安全的唯一指标。 | `amount.test.ts`<br>`invariants.test.ts` |
| **MATH04** | JW-D SQL NULL 语义 | SQL 等值连接 NULL 不匹配 NULL；LEFT JOIN 保留未命中基表行，孤立行 $f_i = 1$。 | `factor.test.ts`<br>`invariants.test.ts` |
| **MATH05** | JW-E `SUM(DISTINCT)` 假修复 | 多笔合法订单具有相同金额（$1200 + 1200 = 2400$）；去重后为 $1200$ 严重失真，证实不能直接用 DISTINCT 修复。 | `amount.test.ts` |
| **MATH06** | 最小结构反例 (Witness) | 保持表行内容、仅允许删行；找出证明 $f_i > 1$ 的全局最少输入行子集（Star/Single 为 3 行，Chain 为 3 或 4 行）；优先保留非零金额，ASCII 字典序破平局。 | `witness.test.ts` |
| **MATH07** | 独立 Oracle 双轨验证 | 由独立 Agent 编写的 `tests/oracle/bruteforce.ts`（严禁导入生产代码）；1,000 组固定随机场景 100% 结果一致；785 组 $\le 9$ 行场景经独立子集穷举确认见证绝对最小性。 | `oracle.test.ts` |
| **MATH08** | BigInt 精度上限与极端数 | 全局使用整数分字符串与 `BigInt` 计算，禁止任何浮点数金额；支持超过 $2^{53}-1$ 极大整数（如 35 位高精度），往返无损。 | `amount.test.ts`<br>`invariants.test.ts` |
| **MATH09** | 极大笛卡尔场景不物化 | 时间复杂度严格为 $O(\|A\| + \|B\| + \|C\|)$，额外空间 $O(\|B\| + \|C\|)$；计算百亿级展开行数时不分配中间连接对象，防爆内存（200 行可见预览在 T013 交付）。 | `scale.test.ts`<br>`bench-core.mjs` |
| **MATH10** | 算法可重复性与输出确定性 | 相同场景连续 10 次执行 `analyze()` 产生字节完全相同的 JSON 审计输出；多键误差相同时采用稳定 ID 升序决胜。 | `invariants.test.ts`<br>`bench-core.mjs` |

---

## 3. T007 重点补充：核心代数与拓扑不变量

在 `tests/core/invariants.test.ts` 中对生产核心算法施加严格代数不变量核验：

### 3.1 单调性不变量 ($f_i \ge 1$)
- **定理：** 对于任意合法场景 $S$ 中的基表行 $a_i \in \text{base}$，其倍增因子恒满足 $f_i \ge 1$。
- **左连接保全性：** 无论 mid/tail 是否存在匹配行，基表记录在 LEFT JOIN 中必保留至少 1 行输出。
- **单调增量性：** 设场景 $S_2 \supseteq S_1$（仅在 mid 或 tail 中追加记录），则对所有基表行 $i$，必有 $f_i(S_2) \ge f_i(S_1)$。

### 3.2 展开行数守恒不变量 ($\text{expandedRows} = \sum_{i} f_i$)
- **定理：** 全场景总连接行数等于所有基表行倍行因子之和：
  $$\text{expandedRows} = \sum_{i=1}^{|A|} f_i$$
- **验证覆盖：** 在所有单表、星型、链式布局及各级极端匹配下，纯整数累加恒等成立。

### 3.3 金额代数守恒不变量 ($\Delta = \sum_i v_i(f_i - 1)$ 与 $S_{\text{naive}} = S_{\text{safe}} + \Delta$)
- **定理：** 
  $$S_{\text{safe}} = \sum_{i=1}^{|A|} v_i, \quad S_{\text{naive}} = \sum_{i=1}^{|A|} v_i \cdot f_i$$
  $$\delta_i = v_i (f_i - 1), \quad \Delta = S_{\text{naive}} - S_{\text{safe}} = \sum_{i=1}^{|A|} \delta_i$$
- **正负抵消不变：** 当存在负数金额时，代数和恒等，且 $\Delta = 0$ 时 `unsafeBaseRows` 仍能精确捕获 $f_i > 1$ 的结构风险行。

### 3.4 严格输入上限与安全边界
- **容量上限：** `base` 表 $1 \le N \le 5,000$ 行；`mid` 表 $0 \le N \le 5,000$ 行；`tail` 表 $0 \le N \le 5,000$ 行。超限行数立即触发 `ROW_COUNT_OUT_OF_BOUNDS`。
- **字段长度：** `title` $\le 256$ 字符，`key/parentKey/linkKey` $\le 256$ 字符，`id` $\le 64$ 字符（正则 `[A-Za-z0-9._-]`）。
- **金额限额：** 场景模式限定单笔金额绝对值 $\le 100,000,000$ 分（100 万元），内部计算引擎则支持任意位宽高精度 BigInt。

---

## 4. 规模压测与极大笛卡尔防爆 (MATH09)

在 `tests/core/scale.test.ts` 与 `scripts/bench-core.mjs` 中对极大 fanout 进行硬件级压测：

### 4.1 1250 亿展开行非物化证据 (125 Billion Rows)
- **场景配置：** 星型布局，基表 5,000 行，中间表 5,000 行，尾表 5,000 行，键完全一致。
  - 单行展开因子：$5,000 \times 5,000 = 25,000,000$ 行。
  - 全局总展开行：$5,000 \times 25,000,000 = 125,000,000,000$ 行。
- **物化后果预估：** 若物化展开为 JS Object，需内存 $> 1 \text{ TB}$，将直接引发 V8 Out of Memory (OOM) 崩溃。
- **分解式计算实测结果：**
  - 计算耗时：$\approx 4 \sim 18 \text{ ms}$。
  - V8 堆增量：$\approx 3.5 \text{ MB}$（仅包含输入行数据及哈希 Map 索引）。
  - 空间复杂度：严格维持在 $O(|B| + |C|)$，与连接后行数彻底解耦。

### 4.2 最大规模场景 (15,000 输入行)
- 5,000 Base + 5,000 Mid + 5,000 Tail 全容量场景。
- 规范校验耗时：$< 25 \text{ ms}$。
- 因子分解与金额归因：$< 12 \text{ ms}$。
- 完整 `analyze()`：$< 30 \text{ ms}$（远优于项目书 $\le 5.0\text{ s}$ 门禁）。

---

## 5. CPU 基准性能测试合同 (`scripts/bench-core.mjs`)

基准脚本为全自治独立运行的 Node.js 脚本，输出真实系统指标：

```bash
node scripts/bench-core.mjs
```

### 5.1 采集环境基线
- 操作系统平台、架构、内核版本
- CPU 型号与物理/逻辑核心数
- 系统物理内存（总量与空闲）
- Node.js 与 V8 引擎版本

### 5.2 验收基准指标对照表
| 测试套件 | 输入规模 | 项目书 §10 门禁 | 实测表现 (AMD EPYC 4 vCPUs) | 状态 |
|---|---|---|---|---|
| Suite 1: Golden Presets | JW-A 至 JW-F | 毫秒级 | 2µs ~ 8µs (97k ~ 490k ops/sec) | **PASS** |
| Suite 2: 1k/1k/1k Scale | 3,000 行 | $\le 2.0\text{ s}$ | $41\text{ ms} \sim 196\text{ ms}$ | **PASS** |
| Suite 3: 5k/5k/5k Scale | 15,000 行 | $\le 5.0\text{ s}$ | $10\text{ ms} \sim 12\text{ ms}$ | **PASS** |
| Suite 4: 125B Fanout | 125,000,000,000 行 | 不 OOM, $< 500\text{ ms}$ | $3.89\text{ ms}$, Heap $\Delta = 3.39\text{ MB}$ | **PASS** |
| Suite 5: MATH10 确定性 | 10 次连续执行 | 10/10 字节相同 | 10/10 相同 (SHA-256 吻合) | **PASS** |

---

## 6. 环境注意事项与临时目录隔离

- **Linux tmpfs 预警：** 宿主环境 `/tmp` 为仅 512MB 的 `tmpfs` 内存挂载盘，极易因临时包构建或大文件产生满载错误。
- **规避措施：**
  - 本项目所有临时文件与测试日志一律写在工作区磁盘路径下（如 `03_source/.tmp` 或 `03_source/evidence`），严禁向 `/tmp` 灌入大体积数据。
  - 所有测试及性能基准完全在 Node 进程内存中执行闭环，无需磁盘落地中间 join 表。

---

## 7. 验收复现命令

```bash
# 1. 运行全量单元测试与不变量测试
npm run test

# 2. TypeScript 类型完整性检查
npm run typecheck

# 3. 运行自治 CPU 性能基准测试
node scripts/bench-core.mjs
```

---

## 8. S3 阶段 T016 离线、隐私与真实浏览器性能验收规范

### 8.1 目标与门禁原则
- **FR10 纯离线运行：** 阻断所有外网/外域连接后，本地静态站 (`127.0.0.1:4173`) 仍可完整加载并执行所有 6 套黄金预设、JSON/CSV 导入导出与见证计算。
- **U07 零数据泄漏与隐私保护：** 拦截任何非本地同源请求；页面不上传任何业务明细或 CSV 行数据；浏览器控制台零 P0 异常。
- **§10 浏览器端真实性能门禁：**
  - 1k/1k/1k 规模场景（3,000 行输入）Chromium 首次计算至结果可读：3 次测试中位数 $\le 2.0\text{ s}$。
  - 5k/5k/5k 规模场景（15,000 行输入）Chromium 首次计算至结果可读：3 次测试中位数 $\le 5.0\text{ s}$。
- **可复现与证据保全：**
  - 设备环境明细保存在 `evidence/runtime/device-spec.txt`。
  - 合成输入 SHA-256 哈希保存在 `evidence/benchmark/synthetic-hashes.txt`。
  - 原始样本与中位数指标保存在 `evidence/benchmark/raw-samples.json` 与 `evidence/benchmark/browser-1k-5k-report.json`。
  - 浏览器完整离线操作 Tracing 保存在 `evidence/runtime/offline-trace.zip`。
  - 验收通过记录写入 `evidence/test-logs/T016-gates.txt`。

### 8.2 T016 验收执行流程与命令
```bash
# 1. clean 安装与全量类型/单元/构建/E2E 门禁
npm ci
npm run typecheck
npm run test
npm run build
npm run test:e2e

# 2. 真实 Chromium 浏览器离线与 1k/5k 中位数性能基准
node scripts/bench-browser.mjs

# 3. 验证本地静态 Preview 站点
npm run preview -- --host 127.0.0.1
```
