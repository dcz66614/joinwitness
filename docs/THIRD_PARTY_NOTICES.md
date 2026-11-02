# P008 倍行镜 JoinWitness — 第三方许可证与依赖核查 (THIRD_PARTY_NOTICES)

> **项目**：P008 倍行镜 JoinWitness  
> **版本**：0.1.0 / SPEC 1.0.0  
> **审计时间**：2026-11-01  
> **项目自身许可证**：本项目第一方原生源码与文档采用 **MIT 许可证**（MIT License）正式授权，授权文件见根目录 [`LICENSE`](../LICENSE)（版权所有 © 2026 JoinWitness）。  
> **本文件性质说明**：本文件 `THIRD_PARTY_NOTICES.md` 仅作为第三方依赖包与传递依赖的开源协议审计清单与法定声明收录，**不能替代本项目自身的正式授权文件（根目录 LICENSE）**。  
> **审核结论**：全部直接依赖与间接传递依赖均为宽松开源许可证（Permissive Open Source Licenses），**无任何 GPL / AGPL 强传染性开源协议、无商业收费组件、无专有闭源协议**。

---

## 1. 直接依赖许可清单 (Direct Dependencies)

### 1.1 运行时生产依赖 (Production Dependencies)

| 依赖包名 | 版本 | 许可证 | 官方仓库 / 主页 | 作用说明 |
|---|---|---|---|---|
| `react` | `19.3.1` | **MIT** | https://github.com/facebook/react | 用户界面组件声明与状态驱动核心库 |
| `react-dom` | `19.3.1` | **MIT** | https://github.com/facebook/react | React 浏览器 DOM 渲染适配器 |

### 1.2 开发与测试工具链依赖 (Development & Test Dependencies)

| 依赖包名 | 版本 | 许可证 | 官方仓库 / 主页 | 作用说明 |
|---|---|---|---|---|
| `@playwright/test` | `1.64.1` | **Apache-2.0** | https://github.com/microsoft/playwright | 端到端浏览器自动化与离线截屏/录屏套件 |
| `@types/node` | `24.19.2` | **MIT** | https://github.com/DefinitelyTyped/DefinitelyTyped | Node.js 运行时 TypeScript 类型定义 |
| `@types/react` | `19.3.0` | **MIT** | https://github.com/DefinitelyTyped/DefinitelyTyped | React TypeScript 类型定义 |
| `@types/react-dom` | `19.3.0` | **MIT** | https://github.com/DefinitelyTyped/DefinitelyTyped | React DOM TypeScript 类型定义 |
| `@vitejs/plugin-react` | `5.2.0` | **MIT** | https://github.com/vitejs/vite-plugin-react | Vite 针对 React 的 Fast Refresh 与 JSX 转换插件 |
| `typescript` | `5.9.3` | **Apache-2.0** | https://github.com/microsoft/TypeScript | 静态强类型编译器与类型检查引擎 |
| `vite` | `8.3.5` | **MIT** | https://github.com/vitejs/vite | 前端打包与热更新本地构建工具 |
| `vitest` | `4.1.12` | **MIT** | https://github.com/vitest-dev/vitest | 基于 Vite 的高性能单元与集成测试运行器 |

---

## 2. 传递依赖完整分布核查 (Transitive Dependency Audit)

经由 `package-lock.json` 全量依赖拓扑自动扫描（总计 127 个包声明）：

| 许可证类型 | 软件包数量 | 占比 | 商业与专有合规结论 |
|---|---|---|---|
| **MIT** | 100 | 78.7% | 允许商业使用、修改与自由再分发 |
| **MPL-2.0** | 12 | 9.4% | 文件级弱 Copyleft（esbuild 等工具链底层文件），无传染性 |
| **Apache-2.0** | 7 | 5.5% | 明确专利授权与分发许可 |
| **ISC** | 6 | 4.7% | 等价于双句版 BSD / MIT |
| **BSD-3-Clause** | 1 | 0.8% | 经典宽松协议 |
| **CC-BY-4.0** | 1 | 0.8% | 创作共用文档/数据协议 |
| **GPL / AGPL** | **0** | **0.0%** | **严格无传染性开源依赖** |
| **Proprietary / Paid** | **0** | **0.0%** | **严格无商业收费依赖** |

---

## 3. 主要开源协议法定声明全文

### 3.1 MIT License (适用于 React, Vite, Vitest 及绝大部分传递依赖)
```text
Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### 3.2 Apache License, Version 2.0 (适用于 Playwright, TypeScript)
```text
Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
```
