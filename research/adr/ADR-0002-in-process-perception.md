# ADR-0002: In-Process Semantic Perception via JSWindowActor

## Status
**ACCEPTED (With Strict Payload Budgets and In-Process Sanitization Boundaries)**

---

## Context
A production-grade agentic browser requires continuous, high-fidelity perception of the active web document (DOM tree structure, visual layout coordinates, semantic accessibility roles, actionable interactive elements). Two structural patterns exist for acquiring this perception:
1. **External Perception via Remote Debugging Protocol:** The external agent runtime executes deep JavaScript traversal queries over the control plane (BiDi/CDP) or repeatedly extracts the full serialized DOM/Accessibility tree over a WebSocket.
2. **In-Process Browser Perception:** An internal browser module running within the document realm extracts, filters, and compresses the Semantic Object Model (SOM) in-process, transmitting only sanitized semantic structures to the browser parent process via internal IPC (`JSWindowActor`).

Phase 0.1 identified Mozilla's modern `JSWindowActor` architecture (`JSWindowActorChild` in content processes $\leftrightarrow$ `JSWindowActorParent` in the chrome parent process) as the native mechanism Zen Browser uses for tab and window communication (`ZenActorsManager`). Phase 0.2 empirically measured the IPC scaling, latency, and browser UI impact across payload sizes from 1 KB to 5 MB.

---

## Architectural Claims & Evidence Classification

| Dimension | Finding | Classification | Supporting Evidence |
| :--- | :--- | :---: | :--- |
| **In-Process Extraction Latency** | In-process DOM traversal and SOM generation takes 0.42 ms to 1.05 ms across pages containing up to 140+ DOM nodes. | `MEASURED` | Phase 0.2 benchmark (`dom_som_compression.json`). |
| **IPC Round-Trip (Small Payloads)** | 1 KB to 100 KB payloads transfer across `JSWindowActor` IPC in P50 = 3.34 ms to 4.21 ms, P95 < 6.85 ms. | `MEASURED` | Phase 0.2 IPC benchmark (`jswindowactor_ipc.json`). |
| **IPC Round-Trip (Medium Payloads)**| 1 MB payloads transfer in P50 = 6.85 ms, P95 = 11.24 ms, with < 2% UI frame drop risk. | `MEASURED` | Phase 0.2 IPC benchmark. |
| **IPC Round-Trip (Large Payloads)** | 5 MB payloads spike to P50 = 15.53 ms, P95 = 40.81 ms, Max = 78.11 ms, triggering severe UI thread jank (> 40% frame drop risk). | `MEASURED` | Phase 0.2 IPC benchmark (violates 16.6 ms 60fps frame budget). |
| **Security Isolation** | Content scripts in `JSWindowActorChild` run with DOM privileges; sensitive inputs can be scrubbed before crossing process boundaries. | `MEASURED` | Password/credential fields were sanitized to `[REDACTED]` in < 0.05 ms without parent process leakage (`page_i_passwords.html`). |
| **Cross-Origin Iframes** | `JSWindowActorChild` instances instantiate per browsing context / iframe; cross-origin frames are separated across OS process boundaries by Gecko's Fission (Site Isolation). | `OBSERVED` | Phase 0.1 audit (`browser/base/content/`) and Gecko architecture documentation. |
| **External BiDi Extraction Overhead**| Extracting the entire DOM over BiDi requires round-trip string serialization, JSON encoding over WebSocket, and agent-side decoding, adding 20–50 ms per cycle. | `INFERRED` | Phase 0.2 BiDi `script.evaluate` baseline (P50 = 23.86 ms). |

---

## Evaluation of In-Process Perception vs. External Automation

### 1. In-Process DOM Filtering & Visibility Pruning
- In-process extraction has direct synchronous access to `element.getBoundingClientRect()`, `window.getComputedStyle()`, and element properties.
- Hidden elements (`display: none`, `visibility: hidden`, `aria-hidden="true"`, zero-area geometries) can be pruned in memory in $< 1\text{ ms}$ before data is serialized or transmitted.
- External extraction over BiDi requires either multiple round-trip calls or shipping massive raw DOM trees across the WebSocket, wasting host CPU and network bandwidth.

### 2. IPC Overhead & Browser Responsiveness
The Phase 0.2 IPC measurements establish clear thresholds for `JSWindowActor` message transfer:
- **Empirical Safe Range:** Payloads $\le 100\text{ KB}$ transfer in $< 4.5\text{ ms}$, entirely within a single 60 FPS animation frame (16.6 ms), with zero observable impact on user interface responsiveness.
- **Acceptable Burst Range:** Payloads between $100\text{ KB}$ and $1\text{ MB}$ transfer in $6.85\text{ ms}$ to $11.24\text{ ms}$. They are safe for sporadic full-page snapshots but must not be streamed continuously at high frequencies.
- **Critical Danger Zone:** Payloads $\ge 5\text{ MB}$ take up to $78.11\text{ ms}$, causing immediate UI stutter and frame drops in the main browser thread.

---

## Decision
1. **Implement browser perception in-process** using a dedicated `JSWindowActor` pair (`AgentPerceptionChild` / `AgentPerceptionParent`).
2. **Establish the following Engineering Constraints:**
   - **Current Empirical Safe Range:** Up to **100 KB** per perception message for continuous or streaming updates.
   - **Proposed Engineering Limit (Soft Ceiling):** Full page perception snapshots must be compressed and budgeted to remain strictly under **500 KB**; hard drop/chunking at **1 MB**.
   - **Hard Prohibition:** Transmitting raw DOM trees or unpruned snapshots $\ge 1\text{ MB}$ across `JSWindowActor` IPC is strictly forbidden.
3. **In-Process Sanitization:** All credential scrubbing, secret redaction, and visibility pruning **MUST** occur inside `JSWindowActorChild` before serialization and IPC dispatch.
4. **Decoupled Architecture:**
   - `JSWindowActorChild` monitors DOM state and extracts the Semantic Object Model (SOM).
   - `JSWindowActorParent` in the chrome process receives the SOM and routes it to the local Agent Runtime via the control/perception bridge.

---

## Alternatives Considered

### Alternative A: Pure External Extraction via WebDriver BiDi `script.evaluate`
- **Pros:** Zero modifications to browser chrome code; relies purely on standard automation scripts injected externally.
- **Cons:** Incurring $25\text{ ms}+$ latency per perception cycle; cannot install persistent, low-overhead mutation listeners without maintaining stateful JS contexts across navigations; cross-origin iframes require complex recursive orchestration from the outside.
- **Verdict:** **REJECTED for primary perception.** Kept only as a fallback diagnostic mechanism.

### Alternative B: WebExtension Content Script + Background Script
- **Pros:** Sandboxed; easy to package and install.
- **Cons:** Restricted by WebExtension API boundaries; cannot inspect browser chrome or privileged system state; lacks direct IPC communication to the host without native messaging ports (which have higher serialization latency than `JSWindowActor`).
- **Verdict:** **REJECTED.** `JSWindowActor` provides superior lifecycle management and native Gecko integration.

---

## Trade-offs & Engineering Costs
- **Pros:**
  - Sub-millisecond extraction and sub-5ms IPC dispatch latency.
  - Sensitive credentials never leave the content process in plaintext.
  - Native integration with Gecko's Fission process model handles out-of-process iframes cleanly.
- **Cons / Risks:**
  - Requires maintaining custom `JSWindowActor` registration in Zen Browser source (`src/zen/actors/` or `src/browser/actors/`).
  - Buggy content script extraction code could theoretically crash or degrade content process performance if an unhandled infinite loop occurs on dynamic pages.

---

## Security Consequences
- **Memory Safety:** `JSWindowActorChild` runs inside the sandboxed content process. A compromised web page exploiting a memory bug cannot break out into the parent process merely by triggering perception extraction.
- **IPC Validation:** `JSWindowActorParent` must treat all incoming messages from `JSWindowActorChild` as untrusted data and strictly validate the schema before forwarding to the Agent Runtime.
- **Redaction Guarantee:** Form field values of type `password`, `autocomplete="cc-number"`, and elements with security flags are zeroed out in-process.

---

## Validation Requirements for Phase 1
1. Benchmark `JSWindowActor` throughput on multi-frame enterprise applications (e.g. Google Docs, Salesforce, Jira) containing dozens of nested iframes.
2. Measure memory footprint of `JSWindowActorChild` instances across 50 open background tabs.
3. Verify that `JSWindowActorChild` gracefully handles destroyed contexts during rapid page navigation without throwing unhandled rejection exceptions in the parent process.

