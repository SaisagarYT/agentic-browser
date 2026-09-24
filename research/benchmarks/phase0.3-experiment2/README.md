# Phase 0.3 - Experiment 2: Zen Workspace & Split-View ↔ WebDriver BiDi Mapping Benchmark Suite

This directory contains the complete reproduction runner and machine-readable empirical dataset for **Experiment 2** of Phase 0.3, investigating the architectural relationship between Zen Browser's UI concepts (Workspaces, Split Views, Tabs, Inactive Tabs) and W3C WebDriver BiDi browsing contexts.

---

## 1. Directory Structure

```text
research/benchmarks/phase0.3-experiment2/
├── README.md                           # This reproducibility guide
├── runner/
│   └── experiment2_runner.mjs          # Standalone Node.js execution suite
└── data/
    ├── baseline_contexts.json & .csv   # Experiment 1: Context lifecycle and parent/window topology
    ├── workspaces_mapping.json & .csv  # Experiment 2: 3-Workspace to BiDi context mapping table
    ├── workspace_switching.json & .csv # Experiment 3: Context ID stability across workspace switches
    ├── hidden_tab_actuation.json & .csv# Experiment 4: Evaluation, screenshot, and clicks on hidden tabs
    ├── split_view_topology.json & .csv # Experiment 5: 2-pane & 3-pane split view BiDi context trees
    ├── lifecycle_events.json & .csv    # Experiment 6: P50/P95 latencies for getTree, create, close
    └── experiment2_summary.json        # Comprehensive aggregate JSON metadata
```

---

## 2. Experimental Environment

- **Operating System:** Windows 11 Home Single Language (`10.0.26200`)
- **Browser Binary:** Verified Official Signed Zen Browser `1.22.3b` (`staging/zen-bin/zen.exe`, Gecko `156.0.1`, BuildID `20260922050124`)
- **Audited Git Commit:** `4c92731b2dbbcf3f5a4dad79c09d13c38f91f774` (official `zen-browser/desktop` repo)
- **Node.js Runtime:** `v24.20.0`
- **BiDi Transport:** Native WebSocket over loopback (`ws://127.0.0.1:<port>/session`) via `--remote-debugging-port`

---

## 3. Reproduction Instructions

To execute the benchmark suite and reproduce all JSON/CSV datasets from scratch:

```powershell
# 1. Ensure Node.js (v18+) is installed
node --version

# 2. Execute the standalone test runner
node research/benchmarks/phase0.3-experiment2/runner/experiment2_runner.mjs
```

The runner will:
1. Start an internal HTTP server on port 8088 hosting the deterministic test corpus (`page_a_article.html` to `page_f_table.html`).
2. Launch isolated, temporary Zen browser profiles with custom mozLz4 session seeds.
3. Establish W3C WebDriver BiDi sessions.
4. Execute Experiments 1 through 6 consecutively.
5. Export verified CSV and JSON files directly into `research/benchmarks/phase0.3-experiment2/data/`.

---

## 4. Key Empirical Findings Summary

1. **Workspace Correspondence:** Zen Workspaces do **NOT** correspond to BiDi browsing contexts. All tabs across all workspaces share the exact same top-level BiDi browsing-context tree and the same `clientWindow`.
2. **Tab Correspondence:** Every Zen tab corresponds 1:1 to a top-level BiDi browsing context (`parent: null`).
3. **Split View Topology:** Split View creates independent, peer top-level browsing contexts. Panes are neither children of each other nor children of a composite context.
4. **Hidden Tab Actuation:** BiDi can execute `script.evaluate`, `captureScreenshot`, `input.performActions` (clicks), and `navigate` on completely hidden/inactive tabs in inactive workspaces **without bringing them to the front and without shifting user focus**.
5. **Metadata Deficit:** WebDriver BiDi exposes **zero workspace or split-view metadata** in its native events or `getTree` responses.

