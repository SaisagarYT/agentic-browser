# Phase 0.3 - Experiment 3: WebDriver BiDi File Upload & Download Validation Benchmark Suite

This directory contains the complete reproduction harness, synthetic fixtures, deterministic dual-origin test server, test runner, and machine-readable empirical dataset for **Experiment 3** of Phase 0.3, investigating the file upload, download, sandboxing, and observability capabilities of Zen Browser under WebDriver BiDi automation.

---

## 1. Directory Structure

```text
research/benchmarks/phase0.3-experiment3/
├── README.md                           # This reproducibility guide
├── fixtures/                           # Deterministic synthetic test files (SHA-256 verified)
│   ├── upload-small.txt                # 101 B plain text file
│   ├── upload-1mb.bin                  # 1.02 MB synthetic binary
│   ├── upload-10mb.bin                 # 10.22 MB synthetic binary
│   ├── upload-multi-a.txt              # Multi-file part A
│   ├── upload-multi-b.txt              # Multi-file part B
│   ├── upload-multi-c.txt              # Multi-file part C
│   ├── upload-multi-d.txt              # Multi-file part D
│   └── upload-multi-e.txt              # Multi-file part E
├── server/
│   └── test_server.mjs                 # Dual-origin HTTP server (ports 8090 & 8091)
├── runner/
│   ├── run_comprehensive_tests.mjs     # Integrated, end-to-end empirical benchmark suite
│   ├── probe_bidi.mjs                  # Preliminary BiDi capability discovery probe
│   ├── test_edge_cases.mjs             # Focused negative tests (missing files, disabled inputs)
│   ├── test_iframes.mjs                # Same-origin and cross-origin iframe upload probe
│   ├── test_multi_submit.mjs           # Multi-file ordering and multipart submission probe
│   └── test_dl_verify.mjs              # Direct link, blob, data URL download verification
└── data/
    ├── capability_discovery.json       # BiDi capability matrix and method signatures
    ├── upload_results.json             # Visible, hidden, dynamic, and multi-file upload measurements
    ├── iframe_upload_results.json      # Cross-frame upload measurements
    ├── download_results.json           # Direct link, blob, data URL, and collision logs
    ├── download_events.json            # BiDi network events vs. OS disk flush lag measurements
    ├── failure_results.json            # Error codes for missing files, directories, and disabled inputs
    ├── security_results.json           # Path traversal neutralization and denial validation
    └── summary.json                    # Top-level aggregate summary
```

---

## 2. Experimental Environment

- **Operating System:** Windows 11 Home Single Language (`10.0.26200`)
- **Browser Binary:** Verified Official Signed Zen Browser `1.22.3b` (`staging/zen-bin/zen.exe`, Gecko `156.0.1`, BuildID `20260922050124`)
- **Audited Git Commit:** `4c92731b2dbbcf3f5a4dad79c09d13c38f91f774` (official `zen-browser/desktop` repo)
- **Node.js Runtime:** `v24.20.0`
- **BiDi Transport:** Native WebSocket over loopback (`ws://127.0.0.1:<port>/session`) via `--remote-debugging-port`
- **Network Ports:**
  - `8090`: Primary HTTP origin (Upload bed, download bed, same-origin iframe)
  - `8091`: Secondary HTTP origin (Cross-origin iframe)
  - `9248`: BiDi WebSocket control port

---

## 3. Reproduction Instructions

To execute the benchmark suite and generate all JSON datasets from scratch:

```powershell
# 1. Ensure Node.js (v18+) is installed
node --version

# 2. Execute the integrated benchmark suite
node research/benchmarks/phase0.3-experiment3/runner/run_comprehensive_tests.mjs
```

The runner will:
1. Start the dual-origin HTTP servers on ports 8090 and 8091.
2. Launch a headless instance of Zen Browser with a clean temporary profile.
3. Establish a WebDriver BiDi session and subscribe to `network.*` events.
4. Execute upload tests across visible, hidden, dynamic, multi-file, same-origin iframe, and cross-origin iframe inputs.
5. Execute upload failure tests (nonexistent file, directory path, disabled input, non-file element).
6. Execute download tests (destination confinement, denial, non-existent folder auto-creation).
7. Execute path traversal attacks (`../../` and `C:\...` in `Content-Disposition`) to verify sandbox containment.
8. Execute duplicate downloads to test collision handling and numbering (`(1)`, `(2)`).
9. Execute network failure modes (HTTP 404, aborted socket, Content-Length mismatch).
10. Observe the `.part` streaming lifecycle during concurrent downloads.
11. Measure the time delta between BiDi `network.responseCompleted` and host filesystem flush on a 10MB download.
12. Export all structured JSON artifacts into `research/benchmarks/phase0.3-experiment3/data/`.

---

## 4. Key Empirical Findings Summary

1. **Upload via `input.setFiles`:** Fully functional and operates in 2–3 ms without opening native OS file pickers. Operates on hidden inputs and across cross-origin iframes.
2. **Download Destination via `browser.setDownloadBehavior`:** Directs downloads to a designated host directory without OS prompts; `type: "denied"` completely suppresses downloads.
3. **Path Traversal Protection:** Webpage-influenced filenames containing directory traversal (`../` or `C:\`) are strictly sanitized to `_.._` and `C_WindowsTemp`, preventing sandbox escape.
4. **Collision Resolution:** Deduplication uses standard numeric counter suffixes (`name(1).ext`).
5. **Observability Gap:** BiDi in Gecko lacks a `download.*` event module. `network.responseCompleted` fires before the file is flushed to disk, requiring a filesystem watcher or browser actor for guaranteed completion detection.
