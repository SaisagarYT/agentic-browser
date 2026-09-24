# Phase 0.3 — Experiment 1: LLM Perception Representation & Action Grounding Benchmark

## 1. Overview & Objective

This benchmark rigorously evaluates **6 candidate browser perception representations** to resolve the architectural trade-offs articulated in **ADR-0003: Perception Representation & Serialization Format**.

The core objective is to move beyond the naive assumption that DOM token compression alone determines perception efficiency. In Phase 0.2, an empirical **Compression Paradox** was identified:
- Structural pruning and Semantic Object Model (SOM) extraction dramatically reduce token counts on deeply nested DOM trees (up to 95.8% reduction).
- However, verbose JSON serialization bloats token consumption and character length on clean semantic documents (increasing overhead by 2x to 6x compared to raw HTML).

This experiment measures the multi-dimensional Pareto frontier across:
1. **Token Consumption:** Token counts using both `o200k_base` (GPT-4o / modern frontier) and `cl100k_base` (GPT-4 / Claude / Gemini baseline) tokenizers.
2. **Serialization Latency:** Extraction, JSON/YAML/Tuple serialization, and tokenization time percentiles (p50, p95, p99).
3. **Representation Fidelity:** Preservation of element identity, semantic roles, interactability, geometry, form state, and hierarchy.
4. **Security & Redaction:** Verifiable filtering of passwords, CVVs, and credit card numbers prior to model transmission.
5. **Action Grounding Accuracy:** Real-world element targeting precision across 30 deterministic browser automation tasks using **Gemini 3.8 Flash** (`agy.exe`).
6. **Incremental Update Compatibility:** Feasibility of streaming mutation deltas instead of full document snapshots.

---

## 2. Candidate Representations Evaluated

| ID | Representation | Format / Syntax | Structural Basis | Redaction Mechanism |
|---|---|---|---|---|
| **A** | `A_raw_html` | Standard HTML5 markup | Full DOM tree (unpruned) | None (transmits raw DOM values) |
| **B** | `B_plain_text` | Markdown headings & text lists | Flattened text with `[cir-X]` handles | Sensitive values omitted |
| **C** | `C_verbose_json` | Explicit JSON SOM schema | Tree structure with parent/child links | In-memory redaction to `[REDACTED]` |
| **D** | `D_indented_yaml` | Hierarchical YAML SOM | Indentation-based tree | In-memory redaction to `sensitive: true` |
| **E** | `E_compact_tuple` | Space-delimited columnar tuples | Flat list of interactive/semantic nodes | `[secret]` state flag with `[REDACTED]` |
| **F** | `F_aria_tree` | Indented synthetic ARIA tree | Accessibility tree hierarchy | Role `password` with redacted values |

> **Note on Gecko Accessibility Tree:** As established during Phase 0.2 and Phase 0.3 audit checks, WebDriver BiDi in Firefox/Zen (Gecko 156.0.1) does not implement `accessibility.getTree` (`UnknownCommandError: unknown command`). Native Gecko XPCOM accessibility interfaces (`nsIAccessibleDocument`) are strictly unexposed to unprivileged web content scripts without custom C++ browser engine modifications. Representation F therefore evaluates a synthetic ARIA semantic tree constructed via CIR.

---

## 3. Benchmark Corpus

The benchmark evaluates 12 deterministic HTML test pages located in `pages/`:
1. `page_a_article.html`: Clean editorial article with headings, blockquotes, author links, and navigation.
2. `page_b_news.html`: Multi-column news portal with breaking banner, lead story, secondary cards, and trending list.
3. `page_c_ecommerce.html`: E-commerce catalog with search bar, sort select, and 4 repeated product cards with identical "Add to Cart" buttons.
4. `page_d_form.html`: Enterprise onboarding application with textboxes, email fields, select dropdowns, checkboxes, and submit buttons.
5. `page_e_spa.html`: Dynamic single-page dashboard with active tab switching, live ticker feeds, and execution controls.
6. `page_f_table.html`: Financial transaction clearing ledger with 20 data rows, sortable table headers, and per-row action links.
7. `page_g_iframes.html`: Multi-frame orchestration portal hosting same-origin and cross-origin iframe containers.
8. `page_h_hidden.html`: Contextual inspection page containing collapsible accordions, `display:none` modals, `visibility:hidden` tokens, and prompt injection canaries.
9. `page_i_passwords.html`: Authentication portal with username, password, and credit card / CVV inputs to test security boundaries.
10. `page_j_dynamic_buttons.html`: Dynamic workflow generation interface with action spawning containers.
11. `page_k_long_text.html`: 25 KB comprehensive regulatory manual with 40 sections and deep navigation anchor links.
12. `page_l_deep_dom.html`: 18 KB stress-test DOM with 10 levels of nested container soup.

---

## 4. Ground Truth Task Suite

Located in `tasks/ground_truth_tasks.json`, containing 30 deterministic action-grounding tasks across 8 categories:
- **Easy:** Unambiguous buttons and links with distinct labels (e.g., share button, submit button, search input).
- **Ambiguous Text:** Repeated action buttons (e.g., product card buttons with identical text "Add to Cart").
- **Table Rows:** Specific row actions in multi-row ledgers (e.g., viewing invoice `INV-2024-003`).
- **Form States:** Inputs, dropdowns, and checkboxes requiring specific field targeting.
- **Hidden Avoidance:** Targets that require distinguishing visible elements from suppressed `display:none` nodes.
- **Security:** Credential inputs requiring redaction verification.
- **Dynamic:** Elements that trigger or receive DOM mutations.
- **Semantic Intent:** Complex navigation targets identified by intent rather than direct textual match.

Every task specifies a deterministic `canonical_target_id` (e.g., `cir-11`) mapped to the Canonical Intermediate Representation (CIR).

---

## 5. Directory Structure

```
research/benchmarks/phase0.3-experiment1/
├── README.md                           # This reproduction guide
├── pages/                              # 12 deterministic test HTML documents
│   ├── page_a_article.html
│   ├── page_b_news.html
│   ├── page_c_ecommerce.html
│   ├── page_d_form.html
│   ├── page_e_spa.html
│   ├── page_f_table.html
│   ├── page_g_iframes.html
│   ├── page_h_hidden.html
│   ├── page_i_passwords.html
│   ├── page_j_dynamic_buttons.html
│   ├── page_k_long_text.html
│   └── page_l_deep_dom.html
├── tasks/
│   └── ground_truth_tasks.json         # 30 deterministic grounding tasks
├── runner/
│   ├── cir_engine.py                   # Canonical Intermediate Representation & serializers
│   ├── experiment1_runner.py           # Full automated benchmark runner
│   ├── verify_canonical.py             # 1:1 target mapping verification script
│   └── test_batch.py                   # Verification scratch script
└── data/                               # Generated benchmark datasets
    ├── trials.jsonl                    # Raw record of all 180 grounding trials
    ├── trials.csv                      # Tabular CSV export of all trials
    ├── representation_metrics.json     # Token counts (o200k & cl100k) & compression ratios
    ├── latency_metrics.json            # Extract, serialize, and tokenize latencies (p50/p95/p99)
    ├── grounding_metrics.json          # Accuracy, wrong-target errors, hallucinations by rep
    ├── security_results.json           # Secret leakage audit results across representations
    ├── fidelity_results.json           # Structured fidelity matrix
    ├── incremental_compatibility.json  # Mutation delta compatibility analysis
    └── experiment1_summary.json        # High-level benchmark summary
```

---

## 6. How to Reproduce

### Prerequisites
- Python 3.12+ (tested with Python 3.14.0)
- Python packages: `tiktoken`, `pyyaml`
  ```bash
  python -m pip install tiktoken pyyaml
  ```
- Antigravity CLI / Model Bridge: `agy` configured with access to `gemini-3.8-flash-low`

### Execution
Run the automated runner from the project root:
```bash
python research/benchmarks/phase0.3-experiment1/runner/experiment1_runner.py
```

The runner will:
1. Parse all 12 test pages into Canonical Intermediate Representation (CIR) nodes.
2. Generate all 6 representations for each page and count tokens with `o200k_base` and `cl100k_base`.
3. Audit security redaction on `page_i_passwords.html` across all 6 representations.
4. Execute 180 action-grounding trials (30 tasks × 6 representations) with Gemini 3.8 Flash.
5. Record per-trial accuracy, latencies, error classes, and export all datasets to `data/`.

