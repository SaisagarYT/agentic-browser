# Phase 0.2: Empirical Browser Perception & Actuation Benchmark Suite

This directory contains the automated empirical benchmark suite designed to evaluate Zen Browser's WebDriver BiDi interface, JSWindowActor IPC throughput, Semantic Object Model (SOM) extraction & compression, incremental DOM perception, and actuation performance.

---

## 1. Directory Structure

```text
research/benchmarks/phase0.2/
├── pages/                  # The 12 controlled deterministic test HTML pages (A through L)
├── data/                   # Machine-readable output data (JSON & CSV)
│   ├── actuation_benchmark.csv / .json
│   ├── bidi_baseline.csv / .json
│   ├── dom_som_compression.csv / .json
│   ├── incremental_perception.csv / .json
│   ├── jswindowactor_ipc.csv / .json
│   └── benchmark_summary.json
├── runner/
│   ├── create_pages.py     # Deterministic test page generator
│   ├── som_extractor.js    # Client-side SOM extraction research prototype
│   └── benchmark_runner.mjs# Master Node.js automated benchmark runner
└── README.md               # Reproducibility documentation
```

---

## 2. Prerequisites & Environment

- **Node.js:** v22.0.0 or higher (uses native global `WebSocket`, `node:http`, `node:child_process`).
- **Python:** v3.10 or higher.
- **Operating System:** Windows 10/11, macOS, or Linux.
- **Zen Browser Binary:** Official Zen Browser binary (v1.22.3b, Gecko 156.0.1) placed in `staging/zen-bin/zen.exe` (or accessible via system path).

---

## 3. Step-by-Step Reproduction Instructions

### Step 1: Generate Deterministic Benchmark Pages
Run the Python page generator to regenerate the 12 benchmark test cases:
```bash
python research/benchmarks/phase0.2/runner/create_pages.py
```
This generates files `page_a_article.html` through `page_l_deep_dom.html` in `research/benchmarks/phase0.2/pages/`.

### Step 2: Execute the Master Benchmark Suite
Execute the master benchmark runner with Node.js:
```bash
node research/benchmarks/phase0.2/runner/benchmark_runner.mjs
```

The runner automatically:
1. Boots a local HTTP server on `http://127.0.0.1:8080/` serving the test pages.
2. Spawns `zen.exe` with `--remote-debugging-port 9222 --headless --profile <temp_dir>`.
3. Connects to `ws://127.0.0.1:9222/session` via WebDriver BiDi.
4. Executes 100 iterations of core BiDi commands (measuring min, max, P50, P95, P99).
5. Navigates across all 12 test pages, extracting raw DOM, innerText, A11y tree, and SOM representations.
6. Evaluates incremental perception (full snapshot vs DOM mutation deltas).
7. Evaluates JSWindowActor IPC round-trip times and throughput across 5 payload tiers (1 KB to 5 MB).
8. Runs 100 actuation trials measuring click, type, scroll, and tab switching latencies.
9. Performs security validation on password field redaction and iframe cross-origin boundaries.
10. Writes machine-readable JSON and CSV summaries into `data/`.

---

## 4. Benchmark Dataset Summary

| Test Case | Description | Key Focus |
| :--- | :--- | :--- |
| **Page A** | `page_a_article.html` | Static editorial article, headers, blockquotes, typography |
| **Page B** | `page_b_news.html` | Multi-column news grid with cards, metadata, and sidebar |
| **Page C** | `page_c_ecommerce.html` | Product catalog with filters, price tags, and cart buttons |
| **Page D** | `page_d_form.html` | Complex onboarding form with 12 distinct field types |
| **Page E** | `page_e_spa.html` | Single-page app with high-frequency 200ms timer DOM updates |
| **Page F** | `page_f_table.html` | Financial ledger with 15 rows of tabular enterprise records |
| **Page G** | `page_g_iframes.html` | Container hosting both same-origin and cross-origin iframes |
| **Page H** | `page_h_hidden.html` | Inspection page containing `display:none`, `visibility:hidden`, `opacity:0`, `aria-hidden` |
| **Page I** | `page_i_passwords.html`| Auth portal with masked password, credit card, and CVV inputs |
| **Page J** | `page_j_dynamic_buttons.html`| Interactive page dynamically appending buttons via JS |
| **Page K** | `page_k_long_text.html` | Deep scroll document containing 40 regulatory sections |
| **Page L** | `page_l_deep_dom.html` | Deeply nested 25-level `<div>` container soup with 50 spacers |

