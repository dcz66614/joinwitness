# P008 倍行镜 JoinWitness — 完整构建、测试与环境复现指南 (HOW_TO_REPRODUCE)

> **版本**：1.0.0 (SPEC 1.0.0)  
> **适用对象**：独立审查 Agent、Muse 归档审计员、终审模型 (ChatGPT) 及第三方安全/合规审查员

---

## 1. 硬件与基准运行环境要求

在 Linux 实机上复现本仓库的所有构建与测试，请确保满足以下环境基准：

- **操作系统**：Linux x86_64（Ubuntu 22.04 LTS / 24.04 LTS 或相当的 Linux 发行版，内核 $\ge$ 5.15）；
- **Node.js**：`v24.22.1`（推荐 Node 24 LTS，或 $\ge 20.18.0$）；
- **npm**：`10.9.4`（或 $\ge 10.0.0$）；
- **浏览器引擎**：Playwright 预装 Chromium（版本 `1.64.1` 或系统已安装的 Chromium）；
- **磁盘与内存**：
  - 磁盘空间：工作区可用空间 $\ge 2 \text{ GB}$；
  - **重要注意事项**：在某些 Linux 容器/沙箱中，`/tmp` 可能是仅有 512MB 的 tmpfs 内存文件系统。**严禁**将 Playwright 临时文件或解包验证目录指向 `/tmp`，请配置 `TMPDIR` 指向工作区磁盘（如 `03_source/.tmp`）。

---

## 2. 快速一键复现（标准交付物验证流程）

在解压 `evidence/release/source-release.zip` 后，依次执行如下命令即可完成全量复现（所有命令退出码均为 0）：

```bash
# 1. 验证 Node 与 npm 版本
node -v
npm -v

# 2. 从 package-lock.json 干净锁定安装依赖
npm ci

# 3. 静态类型检查
npm run typecheck

# 4. 运行全量单元与算法 Oracle 测试（277 项全部通过）
npm run test

# 5. 生产环境静态打包（生成 dist/ 目录）
npm run build

# 6. 端到端 E2E 测试（Playwright 16 项全部通过，含离线/键盘/向导/预设）
npm run test:e2e

# 7. 发布包与审查包自洽校验
node scripts/check-release.mjs
```

---

## 3. 分步详细验证指南

### 3.1 步骤 1：解包源码发布候选包
将 `source-release.zip` 解压至全新的干净工作区目录：
```bash
mkdir -p /home/hatch/workspace/p008-work/test-reproduce
unzip /home/hatch/workspace/p008-work/P008-joinwitness/03_source/evidence/release/source-release.zip -d /home/hatch/workspace/p008-work/test-reproduce
cd /home/hatch/workspace/p008-work/test-reproduce
```

### 3.2 步骤 2：依赖安装 (`npm ci`)
```bash
npm ci
```
- **预期输出**：`added 104 packages in ~2s`
- **退出码**：`0`
- **无任何 postinstall 远程下载后门脚本**。

### 3.3 步骤 3：TypeScript 类型检查 (`npm run typecheck`)
```bash
npm run typecheck
```
- **执行命令**：`tsc --noEmit`
- **预期输出**：无任何类型错误，退出码 `0`。

### 3.4 步骤 4：单元测试与算法 Oracle (`npm run test`)
```bash
npm run test
```
- **执行命令**：`vitest run`
- **预期结果**：
  - `Test Files: 16 passed (16)`
  - `Tests: 277 passed (277)`
  - 覆盖范围：
    - `tests/core/factor.test.ts`：LEFT JOIN 键计数与星型/链式倍增因子分解；
    - `tests/core/amount.test.ts`：BigInt 分级金额归因与负数抵消；
    - `tests/core/witness.test.ts`：最小行数结构反例提取与下界验证；
    - `tests/oracle/oracle.test.ts`：1000 组独立 Oracle 穷举逐行比对无一偏差；
    - `tests/io/csv.test.ts`：RFC4180、引号换行、BOM 与容错解析；
    - `tests/io/json.test.ts`：六大黄金预设往返精确到字节级；
    - `tests/worker/worker.test.ts`：Dedicated Web Worker 协议与异步安全；
    - `tests/ui/*.test.tsx`：DOM 结构、拓扑节点、焦点导航。

### 3.5 步骤 5：生产构建 (`npm run build`)
```bash
npm run build
```
- **预期输出**：在 `dist/` 目录下生成 `index.html` 以及 `dist/assets/` 下的 Worker/JS/CSS 静态资源；
- **退出码**：`0`。

### 3.6 步骤 6：本地离线服务启动与验证
```bash
npm run preview -- --host 127.0.0.1 --port 4173
```
- 访问 `http://127.0.0.1:4173/`；
- 打开浏览器 DevTools Network 面板，断开外网或观察请求；
- **预期现象**：请求数量为有限个本地静态资源，外部请求数为 0；所有预设切换、CSV 导入、JSON 导出均可在断网状态下顺畅完成。

---

## 4. 黄金例数学基准对照表

运行测试或在界面加载预设时，核对以下黄金基准数值是否 100% 精确一致：

| 预设 | 基表行数 $\to$ JOIN总行数 | 安全金额 $S_{\text{safe}}$ | 天真金额 $S_{\text{naive}}$ | 偏差 $\Delta$ | 最小见证行数 |
|---|---|---|---|---|---|
| **JW-A** | 3 $\to$ 8 行 | ¥86.00 (8600) | ¥284.00 (28400) | +¥198.00 (+19800) | 3 行 |
| **JW-B** | 2 $\to$ 6 行 | ¥37.00 (3700) | ¥157.00 (15700) | +¥120.00 (+12000) | 3 行 |
| **JW-C** | 2 $\to$ 4 行 | ¥0.00 (0) | ¥0.00 (0) | +¥0.00 (0) | 3 行 |
| **JW-D** | 2 $\to$ 2 行 | ¥19.00 (1900) | ¥19.00 (1900) | +¥0.00 (0) | NONE |
| **JW-E** | 2 $\to$ 2 行 | ¥24.00 (2400) | ¥24.00 (2400) | +¥0.00 (0) | NONE |
| **JW-F** | 1 $\to$ 2 行 | ¥10.00 (1000) | ¥20.00 (2000) | +¥10.00 (+1000) | 4 行 |

---

## 5. 打包与哈希一致性自检

运行发布自检命令：
```bash
node scripts/check-release.mjs
```
该命令会自动执行：
1. 校验 `evidence/release/source-release.zip` 与 `evidence/release/dist-release.zip` 的 ZIP 结构完整性；
2. 校验发布包内不含 `node_modules`、`.git`、缓存与私钥凭证；
3. 校验 `SOURCE_MANIFEST.csv` 与实际文件清单 100% 对应；
4. 校验 `review/REVIEW_PACK_*.md` 逐文件全文的 SHA-256 与字节数与源码包严格一致；
5. 在工作区磁盘解压并全自动执行 `npm ci && npm run typecheck && npm run test && npm run build`，确保解压后的源码具有 100% 可重建性。
