#!/usr/bin/env node
/**
 * P008 倍行镜 JoinWitness — 真实浏览器离线与性能基准测试 (T016)
 *
 * 依据项目书 §9 (MATH01-10 / FR10 / FR12 / U07)、§10 性能预期、实施计划 P008-T016。
 *
 * 目标：
 * - 真实 Chromium 无头浏览器环境测量 1k/5k 场景中位数与原始样本
 * - 验证断网/阻断外域下无任何外部网络请求 (零外部 API)
 * - 验证无浏览器 console error (Console P0) 与无原始 CSV 上传
 * - 记录硬件与设备规格
 * - 生成 T016-gates.txt 与基准证据
 */

import { spawn, execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

// 强制设置 TMPDIR 至工作区磁盘，防止 512MB /tmp tmpfs 满载
const WORKSPACE_TMP = path.resolve(projectRoot, '.tmp');
fs.mkdirSync(WORKSPACE_TMP, { recursive: true });
process.env.TMPDIR = WORKSPACE_TMP;

const BENCHMARK_DIR = path.resolve(projectRoot, 'evidence/benchmark');
const RUNTIME_DIR = path.resolve(projectRoot, 'evidence/runtime');
const TEST_LOGS_DIR = path.resolve(projectRoot, 'evidence/test-logs');

fs.mkdirSync(BENCHMARK_DIR, { recursive: true });
fs.mkdirSync(RUNTIME_DIR, { recursive: true });
fs.mkdirSync(TEST_LOGS_DIR, { recursive: true });

function formatMs(ms) {
  return ms < 1 ? `${(ms * 1000).toFixed(1)}µs` : `${ms.toFixed(2)}ms`;
}

function calculateStats(samples) {
  if (samples.length === 0) return { min: 0, max: 0, mean: 0, median: 0, p95: 0 };
  const sorted = [...samples].sort((a, b) => a - b);
  const sum = sorted.reduce((acc, v) => acc + v, 0);
  const mean = sum / sorted.length;
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  const median = sorted[Math.floor(sorted.length / 2)];
  const p95 = sorted[Math.floor(sorted.length * 0.95)];
  return { min, max, mean, median, p95 };
}

function printHeader(title) {
  console.log('\n' + '='.repeat(78));
  console.log(`  ${title}`);
  console.log('='.repeat(78));
}

// -----------------------------------------------------------------------------
// 1. 采集并记录硬件与运行环境
// -----------------------------------------------------------------------------
printHeader('JoinWitness T016: Hardware & Browser Runtime Specification');
const cpus = os.cpus();
const cpuModel = cpus.length > 0 ? cpus[0].model : 'Unknown';
const totalMemGB = (os.totalmem() / (1024 ** 3)).toFixed(2);
const freeMemGB = (os.freemem() / (1024 ** 3)).toFixed(2);
const uname = execSync('uname -a', { encoding: 'utf-8' }).trim();

let chromiumVersion = 'Unknown';
try {
  const browser = await chromium.launch({
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  chromiumVersion = browser.version();
  await browser.close();
} catch (e) {
  console.warn('Could not query chromium version directly:', e.message);
}

const deviceSpecText = `JoinWitness Hardware & Runtime Specification (T016)
============================================================
Timestamp:       ${new Date().toISOString()}
Kernel (uname):  ${uname}
Platform:        ${process.platform} (${process.arch})
OS Release:      ${os.release()}
CPU Model:       ${cpuModel} (${cpus.length} vCPUs)
Total Memory:    ${totalMemGB} GB
Free Memory:     ${freeMemGB} GB
Node.js Version: ${process.version} (V8: ${process.versions.v8})
Chromium Version:${chromiumVersion}
TMPDIR:          ${process.env.TMPDIR}
`;

fs.writeFileSync(path.resolve(RUNTIME_DIR, 'device-spec.txt'), deviceSpecText, 'utf-8');
console.log(deviceSpecText);

// -----------------------------------------------------------------------------
// 2. 构造 1k / 5k 合成压测场景并计算 SHA-256 哈希
// -----------------------------------------------------------------------------
printHeader('JoinWitness T016: Synthetic Scenarios Generation & Hashes');

function generateStarScenario(baseCount, midCount, tailCount, title) {
  const base = Array.from({ length: baseCount }, (_, i) => ({
    id: `b_${i + 1}`,
    key: `K_${i % Math.max(1, Math.floor(baseCount / 5))}`,
    amountCents: '100',
  }));
  const mid = Array.from({ length: midCount }, (_, i) => ({
    id: `m_${i + 1}`,
    parentKey: `K_${i % Math.max(1, Math.floor(baseCount / 5))}`,
  }));
  const tail = Array.from({ length: tailCount }, (_, i) => ({
    id: `t_${i + 1}`,
    parentKey: `K_${i % Math.max(1, Math.floor(baseCount / 5))}`,
  }));

  return {
    schema: 'joinwitness.scenario/v1',
    specVersion: '1.0.0',
    layout: 'star',
    title,
    source: 'synthetic',
    base,
    mid,
    tail,
  };
}

const scenario1k = generateStarScenario(1000, 1000, 1000, 'T016 Browser Benchmark 1k (3,000 rows)');
const scenario5k = generateStarScenario(5000, 5000, 5000, 'T016 Browser Benchmark 5k (15,000 rows)');

const path1k = path.resolve(WORKSPACE_TMP, 't016-scenario-1k.json');
const path5k = path.resolve(WORKSPACE_TMP, 't016-scenario-5k.json');

const content1k = JSON.stringify(scenario1k, null, 2);
const content5k = JSON.stringify(scenario5k, null, 2);

fs.writeFileSync(path1k, content1k, 'utf-8');
fs.writeFileSync(path5k, content5k, 'utf-8');

const hash1k = createHash('sha256').update(content1k, 'utf-8').digest('hex');
const hash5k = createHash('sha256').update(content5k, 'utf-8').digest('hex');

const hashesText = `JoinWitness Synthetic Benchmark Scenario SHA-256 Hashes (T016)
============================================================
1k Scenario (1,000 Base / 1,000 Mid / 1,000 Tail):
  Path:   ${path1k}
  Size:   ${content1k.length} bytes
  SHA256: ${hash1k}

5k Scenario (5,000 Base / 5,000 Mid / 5,000 Tail):
  Path:   ${path5k}
  Size:   ${content5k.length} bytes
  SHA256: ${hash5k}
`;

fs.writeFileSync(path.resolve(BENCHMARK_DIR, 'synthetic-hashes.txt'), hashesText, 'utf-8');
console.log(hashesText);

// -----------------------------------------------------------------------------
// 3. 准备本地静态 Preview 服务 (127.0.0.1:4173)
// -----------------------------------------------------------------------------
printHeader('JoinWitness T016: Local Preview Server Probe');

async function isServerRunning(port) {
  return new Promise((res) => {
    const req = http.get(`http://127.0.0.1:${port}/`, (r) => {
      res(r.statusCode === 200);
    });
    req.on('error', () => res(false));
    req.setTimeout(1000, () => {
      req.destroy();
      res(false);
    });
  });
}

let previewProcess = null;
const runningAlready = await isServerRunning(4173);
if (runningAlready) {
  console.log('✓ Found existing preview server on http://127.0.0.1:4173');
} else {
  console.log('Starting preview server on http://127.0.0.1:4173...');
  previewProcess = spawn('npm', ['run', 'preview', '--', '--host', '127.0.0.1'], {
    cwd: projectRoot,
    stdio: 'ignore',
    detached: false,
  });

  // 等待服务就绪
  let attempts = 0;
  while (attempts < 30) {
    await new Promise((r) => setTimeout(r, 500));
    if (await isServerRunning(4173)) break;
    attempts++;
  }

  if (!(await isServerRunning(4173))) {
    console.error('FAILED: Preview server failed to start within 15s');
    if (previewProcess) previewProcess.kill();
    process.exit(1);
  }
  console.log('✓ Preview server started successfully');
}

// 保证退出时清理可能启动的子进程
process.on('exit', () => {
  if (previewProcess) {
    try {
      previewProcess.kill();
    } catch {}
  }
});

// -----------------------------------------------------------------------------
// 4. 浏览器真实性能基准压测 (1k / 5k 案例，3 次迭代中位数)
// -----------------------------------------------------------------------------
printHeader('JoinWitness T016: Browser 1k & 5k Median Latency Benchmark (3 runs each)');

const remoteRequests = [];
const consoleErrors = [];

const browser = await chromium.launch({
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
});

const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
});

const page = await context.newPage();

// 严格网络拦截
await page.route('**', (route) => {
  const url = new URL(route.request().url());
  if (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') {
    remoteRequests.push(url.href);
    route.abort('blockedbyclient');
  } else {
    route.continue();
  }
});

// 收集控制台异常
page.on('console', (msg) => {
  if (msg.type() === 'error') {
    consoleErrors.push(msg.text());
  }
});
page.on('pageerror', (err) => {
  consoleErrors.push(err.message);
});

await page.goto('http://127.0.0.1:4173/');
await page.waitForSelector('.brand-title');

// Warm up worker
console.log('Warming up browser runtime with default preset JW-A...');
await page.locator('#btn-run').click();
await page.waitForSelector('[data-testid="real-audit-indicator"]');
console.log('✓ Browser worker initialized');

// 4.1 测试 1k 场景 (3 次运行)
console.log('\n--- Running 1k Scenario (1,000 Base / 1,000 Mid / 1,000 Tail) ---');
const samples1k = [];
for (let run = 1; run <= 3; run++) {
  // 导入 1k 场景
  const fileChooserPromise = page.waitForEvent('filechooser');
  await page.locator('#btn-import-json').click();
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles(path1k);

  await page.waitForSelector('.import-notice-banner');

  // 点击运行并高精度计时
  const t0 = performance.now();
  await page.locator('#btn-run').click();

  // 等待计算完成指示器出现且数值更新为 1000
  await page.waitForSelector('[data-testid="real-audit-indicator"]');
  await page.waitForFunction(() => {
    const el = document.querySelector('.card-base-rows .number');
    return el && el.textContent === '1000';
  });

  const duration = performance.now() - t0;
  samples1k.push(duration);
  console.log(`  Run ${run}: ${formatMs(duration)}`);
}

const stats1k = calculateStats(samples1k);
console.log(
  `[1k Stats] Min: ${formatMs(stats1k.min)} | Median: ${formatMs(stats1k.median)} | Mean: ${formatMs(
    stats1k.mean
  )} | Max: ${formatMs(stats1k.max)} | Target: <= 2000ms`
);

// 4.2 测试 5k 场景 (3 次运行)
console.log('\n--- Running 5k Scenario (5,000 Base / 5,000 Mid / 5,000 Tail) ---');
const samples5k = [];
for (let run = 1; run <= 3; run++) {
  // 导入 5k 场景
  const fileChooserPromise = page.waitForEvent('filechooser');
  await page.locator('#btn-import-json').click();
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles(path5k);

  await page.waitForSelector('.import-notice-banner');

  // 点击运行并高精度计时
  const t0 = performance.now();
  await page.locator('#btn-run').click();

  // 等待计算完成指示器出现且数值更新为 5000
  await page.waitForSelector('[data-testid="real-audit-indicator"]');
  await page.waitForFunction(() => {
    const el = document.querySelector('.card-base-rows .number');
    return el && el.textContent === '5000';
  });

  const duration = performance.now() - t0;
  samples5k.push(duration);
  console.log(`  Run ${run}: ${formatMs(duration)}`);
}

const stats5k = calculateStats(samples5k);
console.log(
  `[5k Stats] Min: ${formatMs(stats5k.min)} | Median: ${formatMs(stats5k.median)} | Mean: ${formatMs(
    stats5k.mean
  )} | Max: ${formatMs(stats5k.max)} | Target: <= 5000ms`
);

await browser.close();

// -----------------------------------------------------------------------------
// 5. 运行完整离线验收 Playwright 测试 (offline.spec.ts)
// -----------------------------------------------------------------------------
printHeader('JoinWitness T016: Executing Offline E2E Suite (tests/e2e/offline.spec.ts)');
let offlineTestPassed = false;
let offlineTestOutput = '';
try {
  offlineTestOutput = execSync(
    'npx playwright test -c evidence/runtime/offline-playwright.config.ts',
    {
      cwd: projectRoot,
      encoding: 'utf-8',
      env: { ...process.env, TMPDIR: WORKSPACE_TMP },
    }
  );
  offlineTestPassed = true;
  console.log(offlineTestOutput);
  console.log('✓ Offline E2E test suite passed cleanly');
} catch (err) {
  offlineTestPassed = false;
  offlineTestOutput = err.stdout + '\n' + err.stderr;
  console.error('FAILED: Offline E2E test suite failed:\n', offlineTestOutput);
}

// -----------------------------------------------------------------------------
// 6. 保存基准与质量证据
// -----------------------------------------------------------------------------
printHeader('JoinWitness T016: Preserving Evidence & Audit Trails');

const rawSamplesData = {
  timestamp: new Date().toISOString(),
  environment: {
    cpuModel,
    vCPUs: cpus.length,
    totalMemGB,
    freeMemGB,
    node: process.version,
    chromium: chromiumVersion,
  },
  samples: {
    '1k_star_3000_rows': {
      rawMs: samples1k,
      stats: stats1k,
      targetMs: 2000,
      passed: stats1k.median <= 2000,
    },
    '5k_star_15000_rows': {
      rawMs: samples5k,
      stats: stats5k,
      targetMs: 5000,
      passed: stats5k.median <= 5000,
    },
  },
  securityAndPrivacy: {
    remoteRequestsBlocked: remoteRequests.length,
    remoteRequests,
    consoleErrorsCount: consoleErrors.length,
    consoleErrors,
  },
};

fs.writeFileSync(
  path.resolve(BENCHMARK_DIR, 'raw-samples.json'),
  JSON.stringify(rawSamplesData, null, 2),
  'utf-8'
);

const reportSummary = {
  gate: 'T016_ACCEPTANCE',
  status:
    stats1k.median <= 2000 &&
    stats5k.median <= 5000 &&
    remoteRequests.length === 0 &&
    consoleErrors.length === 0 &&
    offlineTestPassed
      ? 'PASS'
      : 'FAIL',
  benchmarks: {
    '1k_median_ms': stats1k.median,
    '1k_target_ms': 2000,
    '1k_status': stats1k.median <= 2000 ? 'PASS' : 'FAIL',
    '5k_median_ms': stats5k.median,
    '5k_target_ms': 5000,
    '5k_status': stats5k.median <= 5000 ? 'PASS' : 'FAIL',
  },
  offlineAndPrivacy: {
    offlineE2E: offlineTestPassed ? 'PASS' : 'FAIL',
    zeroExternalRequests: remoteRequests.length === 0 ? 'PASS' : 'FAIL',
    zeroConsoleP0Errors: consoleErrors.length === 0 ? 'PASS' : 'FAIL',
  },
  hashes: {
    scenario1kSha256: hash1k,
    scenario5kSha256: hash5k,
  },
};

fs.writeFileSync(
  path.resolve(BENCHMARK_DIR, 'browser-1k-5k-report.json'),
  JSON.stringify(reportSummary, null, 2),
  'utf-8'
);

// 门禁判定与 T016-gates.txt 生成
const gate1k = stats1k.median <= 2000;
const gate5k = stats5k.median <= 5000;
const gatePrivacy = remoteRequests.length === 0;
const gateConsole = consoleErrors.length === 0;
const gateOffline = offlineTestPassed;

const allGatesPass = gate1k && gate5k && gatePrivacy && gateConsole && gateOffline;

const gatesContent = `==============================================================================
P008 JOINWITNESS T016 ACCEPTANCE GATES VERIFICATION
==============================================================================
Date:        ${new Date().toISOString()}
Host:        ${uname}
Node:        ${process.version}
Chromium:    ${chromiumVersion}

GATE 1: 1k Scenario Browser Median Latency (Target <= 2000ms)
  Samples:   [${samples1k.map((s) => s.toFixed(2) + 'ms').join(', ')}]
  Median:    ${stats1k.median.toFixed(2)}ms
  Result:    ${gate1k ? 'PASS' : 'FAIL (P1 Performance Breach)'}

GATE 2: 5k Scenario Browser Median Latency (Target <= 5000ms)
  Samples:   [${samples5k.map((s) => s.toFixed(2) + 'ms').join(', ')}]
  Median:    ${stats5k.median.toFixed(2)}ms
  Result:    ${gate5k ? 'PASS' : 'FAIL (P1 Performance Breach)'}

GATE 3: Zero Remote API Requests & Data Leakage (FR10 / U07)
  External Requests: ${remoteRequests.length}
  Result:    ${gatePrivacy ? 'PASS' : 'FAIL (P0 Security/Privacy Breach)'}

GATE 4: Zero Console P0 Errors
  Console Errors:    ${consoleErrors.length}
  Result:    ${gateConsole ? 'PASS' : 'FAIL (P0 Console Error)'}

GATE 5: Offline E2E Playwright Suite (tests/e2e/offline.spec.ts)
  Result:    ${gateOffline ? 'PASS' : 'FAIL (P0 Offline Failure)'}
  Trace:     evidence/runtime/offline-trace.zip

==============================================================================
FINAL T016 ACCEPTANCE STATUS: ${allGatesPass ? 'ALL GATES PASSED (EXIT CODE 0)' : 'GATE FAILED'}
==============================================================================
`;

fs.writeFileSync(path.resolve(TEST_LOGS_DIR, 'T016-gates.txt'), gatesContent, 'utf-8');
fs.writeFileSync(path.resolve(RUNTIME_DIR, 'T016-gates.txt'), gatesContent, 'utf-8');

console.log(gatesContent);

if (!allGatesPass) {
  console.error('One or more gates failed!');
  process.exit(1);
}

process.exit(0);
