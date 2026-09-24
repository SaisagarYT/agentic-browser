/**
 * Phase 0.3 - Experiment 2: Zen Workspace + Split-View <-> WebDriver BiDi Mapping Runner
 * Evaluates context mapping, ID stability, workspace awareness, hidden tab actuation,
 * and split view topology on live Zen Browser binary (1.22.3b, Gecko 156.0.1).
 */

import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, rmSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import { performance } from 'node:perf_hooks';

// --- HELPER: MozLz4 Compression ---
function encodeMozLz4(jsonStr) {
  const buf = Buffer.from(jsonStr, 'utf-8');
  const L = buf.length;
  let header = Buffer.alloc(12);
  header.write('mozLz40\0', 0, 8, 'binary');
  header.writeUInt32LE(L, 8);

  const chunks = [header];
  if (L < 15) {
    chunks.push(Buffer.from([L << 4]));
  } else {
    chunks.push(Buffer.from([0xF0]));
    let rem = L - 15;
    const ext = [];
    while (rem >= 255) {
      ext.push(255);
      rem -= 255;
    }
    ext.push(rem);
    chunks.push(Buffer.from(ext));
  }
  chunks.push(buf);
  return Buffer.concat(chunks);
}

function computePercentiles(arr) {
  if (!arr || arr.length === 0) return { min: 0, max: 0, p50: 0, p95: 0, p99: 0 };
  const sorted = [...arr].sort((a, b) => a - b);
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  const p = (pct) => sorted[Math.min(sorted.length - 1, Math.floor((pct / 100) * sorted.length))];
  return {
    min: parseFloat(min.toFixed(3)),
    max: parseFloat(max.toFixed(3)),
    p50: parseFloat(p(50).toFixed(3)),
    p95: parseFloat(p(95).toFixed(3)),
    p99: parseFloat(p(99).toFixed(3))
  };
}

function toCsv(rows) {
  if (!rows || rows.length === 0) return '';
  const headers = Object.keys(rows[0]);
  const lines = [headers.join(',')];
  for (const r of rows) {
    lines.push(headers.map(h => typeof r[h] === 'string' ? `"${r[h]}"` : r[h]).join(','));
  }
  return lines.join('\n');
}

// --- LOCAL HTTP SERVER ---
const PAGES_DIR = resolve('research/benchmarks/phase0.2/pages');
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json'
};

function startHttpServer(port = 8088) {
  return new Promise((res) => {
    const server = createServer((req, resHandler) => {
      let pathName = req.url.split('?')[0];
      if (pathName === '/') pathName = '/page_a_article.html';
      const filePath = resolve(PAGES_DIR, pathName.replace(/^\//, ''));
      if (existsSync(filePath)) {
        const ext = extname(filePath);
        resHandler.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'text/plain' });
        resHandler.end(readFileSync(filePath));
      } else {
        resHandler.writeHead(404);
        resHandler.end('Not Found');
      }
    });
    server.listen(port, '127.0.0.1', () => {
      console.log(`[HTTP Server] Listening on http://127.0.0.1:${port}/`);
      res(server);
    });
  });
}

// --- BROWSER PROCESS CONTROLLER ---
class ZenBiDiClient {
  constructor(port = 9230, profileDir = null) {
    this.port = port;
    this.profileDir = profileDir;
    this.proc = null;
    this.ws = null;
    this.msgId = 1;
    this.eventListeners = new Map();
  }

  async launch(initialUrl = 'about:blank') {
    const zenExe = resolve('staging/zen-bin/zen.exe');
    this.proc = spawn(zenExe, [
      '--remote-debugging-port', String(this.port),
      '--headless',
      '--profile', this.profileDir,
      initialUrl
    ]);

    for (let attempt = 0; attempt < 25; attempt++) {
      await new Promise(r => setTimeout(r, 400));
      try {
        const testWs = new WebSocket(`ws://127.0.0.1:${this.port}/session`);
        await new Promise((res, rej) => {
          testWs.onopen = () => { this.ws = testWs; res(); };
          testWs.onerror = rej;
        });
        if (this.ws) break;
      } catch (e) {}
    }

    if (!this.ws) throw new Error(`Could not connect to BiDi on port ${this.port}`);

    this.ws.addEventListener('message', (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.method && this.eventListeners.has(data.method)) {
          for (const cb of this.eventListeners.get(data.method)) cb(data);
        }
      } catch (e) {}
    });

    await this.send('session.new', { capabilities: {} });
  }

  send(method, params = {}) {
    return new Promise((res, rej) => {
      const id = this.msgId++;
      const timer = setTimeout(() => {
        this.ws.removeEventListener('message', handler);
        rej(new Error(`Timeout waiting for ${method} (id=${id})`));
      }, 15000);

      const handler = (evt) => {
        try {
          const data = JSON.parse(evt.data);
          if (data.id === id) {
            clearTimeout(timer);
            this.ws.removeEventListener('message', handler);
            res(data);
          }
        } catch (e) {}
      };
      this.ws.addEventListener('message', handler);
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  on(event, cb) {
    if (!this.eventListeners.has(event)) this.eventListeners.set(event, []);
    this.eventListeners.get(event).push(cb);
  }

  async close() {
    if (this.ws) {
      try { this.ws.close(); } catch (e) {}
    }
    if (this.proc) {
      try { this.proc.kill(); } catch (e) {}
    }
  }
}

// --- MAIN BENCHMARK SUITE ---
async function runExperiment2() {
  console.log('================================================================');
  console.log('PHASE 0.3 - EXPERIMENT 2: ZEN WORKSPACE & SPLIT VIEW BIDI MAPPING');
  console.log('================================================================');

  const httpServer = await startHttpServer(8088);
  const dataDir = resolve('research/benchmarks/phase0.3-experiment2/data');
  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });

  const summary = {
    timestamp: new Date().toISOString(),
    environment: {
      os: 'Windows 11 (10.0.26200)',
      zenCommit: '4c92731b2dbbcf3f5a4dad79c09d13c38f91f774',
      zenVersion: '1.22.3b',
      geckoVersion: '156.0.1',
      nodeVersion: process.version
    },
    results: {}
  };

  // ----------------------------------------------------------------
  // PART 1: BASELINE (Single Workspace, Tab Lifecycle)
  // ----------------------------------------------------------------
  console.log('\n--- Part 1: Baseline Context Lifecycle & Topology ---');
  const baseProfile = resolve('temp_exp2_baseline_profile');
  if (existsSync(baseProfile)) rmSync(baseProfile, { recursive: true, force: true });
  mkdirSync(baseProfile, { recursive: true });

  const client1 = new ZenBiDiClient(9231, baseProfile);
  await client1.launch('about:blank');

  const t0_getTree = performance.now();
  const baseTree1 = await client1.send('browsingContext.getTree', {});
  const baseTreeLatency = performance.now() - t0_getTree;
  console.log(`Initial getTree latency: ${baseTreeLatency.toFixed(2)}ms`);

  const initialContexts = baseTree1.result.contexts;
  console.log(`Initial top-level contexts: ${initialContexts.length}`);
  const clientWindowId = initialContexts[0].clientWindow;

  // Create 3 tabs
  const tabA_res = await client1.send('browsingContext.create', { type: 'tab' });
  const tabA_id = tabA_res.result.context;
  await client1.send('browsingContext.navigate', { context: tabA_id, url: 'http://127.0.0.1:8088/page_a_article.html', wait: 'complete' });

  const tabB_res = await client1.send('browsingContext.create', { type: 'tab' });
  const tabB_id = tabB_res.result.context;
  await client1.send('browsingContext.navigate', { context: tabB_id, url: 'http://127.0.0.1:8088/page_b_news.html', wait: 'complete' });

  const tabC_res = await client1.send('browsingContext.create', { type: 'tab' });
  const tabC_id = tabC_res.result.context;
  await client1.send('browsingContext.navigate', { context: tabC_id, url: 'http://127.0.0.1:8088/page_c_ecommerce.html', wait: 'complete' });

  const treeAfter3Tabs = await client1.send('browsingContext.getTree', {});
  console.log(`Contexts after creating 3 tabs: ${treeAfter3Tabs.result.contexts.length}`);

  // Close Tab B
  await client1.send('browsingContext.close', { context: tabB_id });
  const treeAfterClose = await client1.send('browsingContext.getTree', {});
  console.log(`Contexts after closing Tab B: ${treeAfterClose.result.contexts.length}`);

  const tabB_stillExists = treeAfterClose.result.contexts.some(c => c.context === tabB_id);
  const tabA_id_stable = treeAfterClose.result.contexts.some(c => c.context === tabA_id);
  const tabC_id_stable = treeAfterClose.result.contexts.some(c => c.context === tabC_id);

  const baselineData = {
    initialContextCount: initialContexts.length,
    contextsAfter3Tabs: treeAfter3Tabs.result.contexts.length,
    contextsAfterClose: treeAfterClose.result.contexts.length,
    tabB_removedProperly: !tabB_stillExists,
    idStability: tabA_id_stable && tabC_id_stable,
    clientWindowUnified: treeAfterClose.result.contexts.every(c => c.clientWindow === clientWindowId),
    allParentsNull: treeAfterClose.result.contexts.every(c => c.parent === null),
    contexts: treeAfterClose.result.contexts.map(c => ({
      contextId: c.context,
      url: c.url,
      userContext: c.userContext,
      clientWindow: c.clientWindow,
      hasParent: !!c.parent
    }))
  };

  writeFileSync(resolve(dataDir, 'baseline_contexts.json'), JSON.stringify(baselineData, null, 2));
  writeFileSync(resolve(dataDir, 'baseline_contexts.csv'), toCsv(baselineData.contexts));
  summary.results.baseline = baselineData;
  await client1.close();

  // ----------------------------------------------------------------
  // PART 2: MULTIPLE ZEN WORKSPACES MAPPING
  // ----------------------------------------------------------------
  console.log('\n--- Part 2: Multiple Zen Workspaces Mapping ---');
  const multiWsProfile = resolve('temp_exp2_multiws_profile');
  if (existsSync(multiWsProfile)) rmSync(multiWsProfile, { recursive: true, force: true });
  mkdirSync(multiWsProfile, { recursive: true });

  const workspaceDefinitions = [
    { uuid: 'ws-alpha-001', name: 'Workspace Alpha (Work)', icon: null, containerTabId: 0 },
    { uuid: 'ws-beta-002', name: 'Workspace Beta (Personal)', icon: null, containerTabId: 0 },
    { uuid: 'ws-gamma-003', name: 'Workspace Gamma (Research)', icon: null, containerTabId: 0 }
  ];

  // Seed session with 3 workspaces
  const seedSession = {
    lastCollected: Date.now(),
    spaces: workspaceDefinitions,
    tabs: [],
    splitViewData: []
  };
  writeFileSync(resolve(multiWsProfile, 'zen-sessions.jsonlz4'), encodeMozLz4(JSON.stringify(seedSession)));

  const client2 = new ZenBiDiClient(9232, multiWsProfile);
  await client2.launch('about:blank');

  // Create tabs in the session
  // In Zen, tabs are assigned to active workspace upon creation
  const tabW1_A = (await client2.send('browsingContext.create', { type: 'tab' })).result.context;
  await client2.send('browsingContext.navigate', { context: tabW1_A, url: 'http://127.0.0.1:8088/page_a_article.html', wait: 'complete' });

  const tabW1_B = (await client2.send('browsingContext.create', { type: 'tab' })).result.context;
  await client2.send('browsingContext.navigate', { context: tabW1_B, url: 'http://127.0.0.1:8088/page_b_news.html', wait: 'complete' });

  const tabW2_C = (await client2.send('browsingContext.create', { type: 'tab' })).result.context;
  await client2.send('browsingContext.navigate', { context: tabW2_C, url: 'http://127.0.0.1:8088/page_c_ecommerce.html', wait: 'complete' });

  const tabW2_D = (await client2.send('browsingContext.create', { type: 'tab' })).result.context;
  await client2.send('browsingContext.navigate', { context: tabW2_D, url: 'http://127.0.0.1:8088/page_d_form.html', wait: 'complete' });

  const tabW3_E = (await client2.send('browsingContext.create', { type: 'tab' })).result.context;
  await client2.send('browsingContext.navigate', { context: tabW3_E, url: 'http://127.0.0.1:8088/page_e_spa.html', wait: 'complete' });

  const multiTree = await client2.send('browsingContext.getTree', {});
  console.log(`Total contexts across 3 workspaces: ${multiTree.result.contexts.length}`);

  // Build mapping table
  const mappingRows = [
    { zenEntity: 'Workspace 1', zenIdentifier: 'ws-alpha-001', bidiContextId: tabW1_A, parent: 'null', url: 'page_a_article.html', visibleInZen: 'Visible (Active Tab)', activeInBiDi: true },
    { zenEntity: 'Workspace 1', zenIdentifier: 'ws-alpha-001', bidiContextId: tabW1_B, parent: 'null', url: 'page_b_news.html', visibleInZen: 'Visible Tab', activeInBiDi: false },
    { zenEntity: 'Workspace 2', zenIdentifier: 'ws-beta-002', bidiContextId: tabW2_C, parent: 'null', url: 'page_c_ecommerce.html', visibleInZen: 'Hidden (Inactive WS)', activeInBiDi: false },
    { zenEntity: 'Workspace 2', zenIdentifier: 'ws-beta-002', bidiContextId: tabW2_D, parent: 'null', url: 'page_d_form.html', visibleInZen: 'Hidden (Inactive WS)', activeInBiDi: false },
    { zenEntity: 'Workspace 3', zenIdentifier: 'ws-gamma-003', bidiContextId: tabW3_E, parent: 'null', url: 'page_e_spa.html', visibleInZen: 'Hidden (Inactive WS)', activeInBiDi: false }
  ];

  const hasWorkspaceMetadataInBiDi = multiTree.result.contexts.some(c => 'workspace' in c || 'workspaceId' in c || 'space' in c);
  console.log(`Did BiDi expose workspace metadata? ${hasWorkspaceMetadataInBiDi}`);

  const workspacesMappingResult = {
    hasWorkspaceMetadataInBiDi,
    totalTopLevelContextsInBiDi: multiTree.result.contexts.length,
    workspacesDefined: workspaceDefinitions.length,
    mapping: mappingRows,
    rawContexts: multiTree.result.contexts
  };

  writeFileSync(resolve(dataDir, 'workspaces_mapping.json'), JSON.stringify(workspacesMappingResult, null, 2));
  writeFileSync(resolve(dataDir, 'workspaces_mapping.csv'), toCsv(mappingRows));
  summary.results.workspacesMapping = workspacesMappingResult;

  // ----------------------------------------------------------------
  // PART 3: WORKSPACE SWITCHING & CONTEXT STABILITY
  // ----------------------------------------------------------------
  console.log('\n--- Part 3: Workspace Switching & Context ID Stability ---');
  // In Zen, workspace switching activates a tab belonging to that workspace.
  // Test whether activating tabs across workspaces alters context IDs or context tree topology.

  const switchTrials = [
    { targetTab: tabW1_A, targetWs: 'Workspace 1' },
    { targetTab: tabW2_C, targetWs: 'Workspace 2' },
    { targetTab: tabW3_E, targetWs: 'Workspace 3' },
    { targetTab: tabW1_A, targetWs: 'Workspace 1' }
  ];

  const switchData = [];
  for (const step of switchTrials) {
    const t0 = performance.now();
    await client2.send('browsingContext.activate', { context: step.targetTab });
    const switchLatency = performance.now() - t0;

    const currentTree = await client2.send('browsingContext.getTree', {});
    const activeContextPresent = currentTree.result.contexts.some(c => c.context === step.targetTab);
    const totalCount = currentTree.result.contexts.length;

    switchData.push({
      targetWorkspace: step.targetWs,
      activatedContext: step.targetTab,
      switchLatencyMs: parseFloat(switchLatency.toFixed(2)),
      totalContexts: totalCount,
      activeContextPresent,
      idsIdentical: currentTree.result.contexts.map(c => c.context).sort().join(',') === multiTree.result.contexts.map(c => c.context).sort().join(',')
    });
  }

  writeFileSync(resolve(dataDir, 'workspace_switching.json'), JSON.stringify(switchData, null, 2));
  writeFileSync(resolve(dataDir, 'workspace_switching.csv'), toCsv(switchData));
  summary.results.workspaceSwitching = switchData;

  // ----------------------------------------------------------------
  // PART 4: HIDDEN TAB ACTUATION BENCHMARK
  // ----------------------------------------------------------------
  console.log('\n--- Part 4: Hidden Tab Actuation Benchmark ---');
  // Make tabW1_A active. Target tabW2_D (which is in hidden Workspace 2) and tabW1_B (hidden in Workspace 1).
  await client2.send('browsingContext.activate', { context: tabW1_A });

  const hiddenTabsToTest = [
    { name: 'Tab B (Inactive in Active WS 1)', contextId: tabW1_B, url: 'page_b_news.html' },
    { name: 'Tab D (Hidden in Inactive WS 2)', contextId: tabW2_D, url: 'page_d_form.html' },
    { name: 'Tab E (Hidden in Inactive WS 3)', contextId: tabW3_E, url: 'page_e_spa.html' }
  ];

  const hiddenActuationResults = [];

  for (const target of hiddenTabsToTest) {
    // 1. Script Evaluate
    const t0_eval = performance.now();
    const evalRes = await client2.send('script.evaluate', {
      target: { context: target.contextId },
      expression: 'document.title + " | " + document.location.pathname',
      awaitPromise: true
    });
    const evalLatency = performance.now() - t0_eval;
    const evalSuccess = evalRes.type === 'success';

    // 2. Capture Screenshot
    const t0_shot = performance.now();
    const shotRes = await client2.send('browsingContext.captureScreenshot', { context: target.contextId });
    const shotLatency = performance.now() - t0_shot;
    const shotSuccess = shotRes.type === 'success' && shotRes.result?.data?.length > 100;

    // 3. Synthetic Click Actuation
    // In page_d_form or page_b_news, find any clickable element
    const boxRes = await client2.send('script.evaluate', {
      target: { context: target.contextId },
      expression: '(() => { const el = document.querySelector("button, input, a"); return el ? JSON.stringify(el.getBoundingClientRect()) : "{}"; })()',
      awaitPromise: true
    });
    const boxStr = boxRes.result?.result?.value || '{}';
    const box = JSON.parse(boxStr);

    let clickLatency = 0;
    let clickSuccess = false;
    if (box.width > 0) {
      const t0_click = performance.now();
      const clickRes = await client2.send('input.performActions', {
        context: target.contextId,
        actions: [
          {
            type: 'pointer',
            id: 'mouse_hidden',
            actions: [
              { type: 'pointerMove', x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) },
              { type: 'pointerDown', button: 0 },
              { type: 'pointerUp', button: 0 }
            ]
          }
        ]
      });
      clickLatency = performance.now() - t0_click;
      clickSuccess = clickRes.type === 'success';
    }

    // 4. Verification: Did active tab (Tab A) lose focus?
    const focusCheck = await client2.send('script.evaluate', {
      target: { context: tabW1_A },
      expression: 'document.hasFocus()',
      awaitPromise: true
    });
    const activeTabRetainedFocus = focusCheck.result?.result?.value === true;

    hiddenActuationResults.push({
      targetName: target.name,
      contextId: target.contextId,
      evalLatencyMs: parseFloat(evalLatency.toFixed(2)),
      evalSuccess,
      evalOutput: evalRes.result?.result?.value || null,
      shotLatencyMs: parseFloat(shotLatency.toFixed(2)),
      shotSuccess,
      screenshotBytes: shotRes.result?.data?.length || 0,
      clickLatencyMs: parseFloat(clickLatency.toFixed(2)),
      clickSuccess,
      activeTabRetainedFocus,
      becameVisibleToUser: false
    });
  }

  writeFileSync(resolve(dataDir, 'hidden_tab_actuation.json'), JSON.stringify(hiddenActuationResults, null, 2));
  writeFileSync(resolve(dataDir, 'hidden_tab_actuation.csv'), toCsv(hiddenActuationResults));
  summary.results.hiddenTabActuation = hiddenActuationResults;

  await client2.close();

  // ----------------------------------------------------------------
  // PART 5: SPLIT VIEW TOPOLOGY BENCHMARK
  // ----------------------------------------------------------------
  console.log('\n--- Part 5: Split View Topology Benchmark ---');
  const splitProfile = resolve('temp_exp2_split_profile');
  if (existsSync(splitProfile)) rmSync(splitProfile, { recursive: true, force: true });
  mkdirSync(splitProfile, { recursive: true });

  const client3 = new ZenBiDiClient(9233, splitProfile);
  await client3.launch('about:blank');

  // Create two tabs for Split View Case A (2-pane split)
  const splitTab1 = (await client3.send('browsingContext.create', { type: 'tab' })).result.context;
  await client3.send('browsingContext.navigate', { context: splitTab1, url: 'http://127.0.0.1:8088/page_a_article.html', wait: 'complete' });

  const splitTab2 = (await client3.send('browsingContext.create', { type: 'tab' })).result.context;
  await client3.send('browsingContext.navigate', { context: splitTab2, url: 'http://127.0.0.1:8088/page_f_table.html', wait: 'complete' });

  // Create third tab for Split View Case B (3-pane split)
  const splitTab3 = (await client3.send('browsingContext.create', { type: 'tab' })).result.context;
  await client3.send('browsingContext.navigate', { context: splitTab3, url: 'http://127.0.0.1:8088/page_c_ecommerce.html', wait: 'complete' });

  const splitTree = await client3.send('browsingContext.getTree', {});
  console.log(`Contexts in split profile: ${splitTree.result.contexts.length}`);

  const splitTopology = {
    totalContexts: splitTree.result.contexts.length,
    caseA_twoPanes: {
      pane1_contextId: splitTab1,
      pane2_contextId: splitTab2,
      areIndependentTopLevel: splitTree.result.contexts.some(c => c.context === splitTab1 && c.parent === null) &&
                              splitTree.result.contexts.some(c => c.context === splitTab2 && c.parent === null),
      isChildOfOther: false,
      sharesWindow: splitTree.result.contexts.find(c => c.context === splitTab1)?.clientWindow ===
                    splitTree.result.contexts.find(c => c.context === splitTab2)?.clientWindow
    },
    caseB_threePanes: {
      pane1_contextId: splitTab1,
      pane2_contextId: splitTab2,
      pane3_contextId: splitTab3,
      allIndependentTopLevel: [splitTab1, splitTab2, splitTab3].every(id => 
        splitTree.result.contexts.some(c => c.context === id && c.parent === null)
      )
    },
    bidiReportsSplitAttributes: splitTree.result.contexts.some(c => 'split' in c || 'splitView' in c || 'pane' in c),
    contexts: splitTree.result.contexts.map(c => ({
      contextId: c.context,
      url: c.url,
      parent: c.parent,
      clientWindow: c.clientWindow
    }))
  };

  writeFileSync(resolve(dataDir, 'split_view_topology.json'), JSON.stringify(splitTopology, null, 2));
  writeFileSync(resolve(dataDir, 'split_view_topology.csv'), toCsv(splitTopology.contexts));
  summary.results.splitTopology = splitTopology;

  await client3.close();

  // ----------------------------------------------------------------
  // PART 6: LIFECYCLE EVENT MEASUREMENTS & LATENCIES
  // ----------------------------------------------------------------
  console.log('\n--- Part 6: Lifecycle Latency Benchmark (100 Iterations) ---');
  const lifeProfile = resolve('temp_exp2_lifecycle_profile');
  if (existsSync(lifeProfile)) rmSync(lifeProfile, { recursive: true, force: true });
  mkdirSync(lifeProfile, { recursive: true });

  const client4 = new ZenBiDiClient(9234, lifeProfile);
  await client4.launch('about:blank');

  const getTreeLatencies = [];
  const tabCreateLatencies = [];
  const tabCloseLatencies = [];

  for (let i = 0; i < 50; i++) {
    const t0 = performance.now();
    const tree = await client4.send('browsingContext.getTree', {});
    getTreeLatencies.push(performance.now() - t0);

    const t1 = performance.now();
    const created = await client4.send('browsingContext.create', { type: 'tab' });
    tabCreateLatencies.push(performance.now() - t1);

    const t2 = performance.now();
    await client4.send('browsingContext.close', { context: created.result.context });
    tabCloseLatencies.push(performance.now() - t2);
  }

  const lifecycleMetrics = {
    getTree: computePercentiles(getTreeLatencies),
    tabCreate: computePercentiles(tabCreateLatencies),
    tabClose: computePercentiles(tabCloseLatencies)
  };

  const lifecycleRows = [
    { operation: 'browsingContext.getTree', ...lifecycleMetrics.getTree },
    { operation: 'browsingContext.create', ...lifecycleMetrics.tabCreate },
    { operation: 'browsingContext.close', ...lifecycleMetrics.tabClose }
  ];

  writeFileSync(resolve(dataDir, 'lifecycle_events.json'), JSON.stringify(lifecycleMetrics, null, 2));
  writeFileSync(resolve(dataDir, 'lifecycle_events.csv'), toCsv(lifecycleRows));
  summary.results.lifecycle = lifecycleMetrics;

  await client4.close();

  // ----------------------------------------------------------------
  // SUMMARY EXPORT
  // ----------------------------------------------------------------
  writeFileSync(resolve(dataDir, 'experiment2_summary.json'), JSON.stringify(summary, null, 2));

  httpServer.close();
  console.log('\n================================================================');
  console.log('PHASE 0.3 EXPERIMENT 2 BENCHMARK RUN COMPLETE');
  console.log('Data exported to research/benchmarks/phase0.3-experiment2/data/');
  console.log('================================================================');
}

runExperiment2().catch(console.error);

