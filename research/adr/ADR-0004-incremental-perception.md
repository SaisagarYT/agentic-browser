# ADR-0004: Perception Update Strategy — Full Snapshot vs. Incremental Mutation Streaming

## Status
**ACCEPTED (Hybrid Model: Full Initial Snapshot + Debounced Incremental Delta Stream with Forced Periodic/Threshold-Based Resynchronization)**

---

## Context
Web applications are highly dynamic; single-page applications (SPAs), live dashboards, social feeds, and search autocompletes continuously mutate the DOM without triggering standard page navigation events. An agentic browser must decide how to update its internal perception model when page mutations occur:
1. **Full Re-Snapshotting:** After every user action or periodic interval, re-traverse the entire active document, extract the full Semantic Object Model (SOM), and replace the agent's world state.
2. **Pure Incremental Delta Streaming:** Capture an initial snapshot, then rely exclusively on a continuous stream of `MutationObserver` events (node insertions, removals, attribute changes) to maintain a synchronized mirror on the agent side.
3. **Hybrid Model:** Capture a full initial snapshot on navigation or major state shifts, stream batched and debounced mutation deltas during local user interaction, and trigger an automatic full re-snapshot when mutations exceed a volatility threshold or when state drift is detected.

In Phase 0.2, an incremental perception benchmark was conducted across 6 common DOM mutation types (text changes, element insertions, element removals, class/style modifications, visibility toggles, and scroll movements).

---

## Architectural Claims & Evidence Classification

| Dimension | Finding | Classification | Supporting Evidence |
| :--- | :--- | :---: | :--- |
| **Delta Bandwidth Reduction** | Incremental mutation deltas averaged 143 Bytes compared to 420–558 Bytes for full snapshots, achieving 65.95% to 74.37% payload savings per event. | `MEASURED` | Phase 0.2 benchmark (`incremental_perception.json`). |
| **Delta Detection Latency** | In-process detection and delta packaging via `MutationObserver` took 2.97 ms to 4.02 ms. | `MEASURED` | Phase 0.2 benchmark (`incremental_perception.json`). |
| **Transmission Latency** | Delta payloads transfer over `JSWindowActor` IPC in ~3.20 ms without dropping browser animation frames. | `MEASURED` | Phase 0.2 benchmark (`incremental_perception.json`). |
| **Mutation Storms** | Heavy SPA frameworks (e.g. React/Vue rendering thousands of nodes) can generate tens of thousands of `MutationRecord` instances within a single frame, which can flood IPC channels and exhaust memory if unthrottled. | `INFERRED` | Browser engine DOM specification and standard frontend runtime behavior. |
| **State Drift Risk** | Pure incremental streams without reconciliation accumulate desynchronizations over time due to dropped messages, out-of-order execution, or missed layout-only shifts (e.g. CSS animation without DOM changes). | `INFERRED` | Distributed state synchronization literature. |
| **Infinite-Scroll Memory Growth**| Unbounded retention of incremental mutation histories in content memory leads to memory leaks in long-running tabs. | `INFERRED` | Gecko content-process memory management principles. |

---

## Evaluation of Pure Incremental vs. Full Snapshot vs. Hybrid

### 1. The Risk of Pure Incremental Streaming
While Phase 0.2 demonstrated compelling 65–74% bandwidth savings for isolated mutations, declaring pure incremental streaming as the sole synchronization mechanism introduces severe architectural hazards:
- **Event Ordering & Race Conditions:** When user actions occur concurrently with background async network updates, ordering between action responses and incoming mutation deltas cannot be guaranteed without complex vector clocks.
- **Backpressure & IPC Flooding:** A "mutation storm" (such as loading a massive table or infinite-scroll feed) would queue thousands of IPC messages, defeating the $< 1\text{ MB}$ safety threshold established in ADR-0002.
- **Missed Layout Shifts:** CSS reflows (e.g., sticky headers appearing or elements moving offscreen due to media query changes) mutate visual coordinates without generating `MutationRecord` events.

### 2. The Cost of Full Re-Snapshotting
Conversely, triggering a full re-snapshot on every typing keystroke or minor hover state is computationally wasteful:
- On large DOM trees (e.g. Page K or L), full parsing takes 1–5 ms and generates 500 KB+ of serialized data.
- Flooding the LLM context with redundant full snapshots exhausts context windows and burns excessive inference tokens.

---

## Decision
1. **Adopt a Hybrid Synchronization Architecture:**
   - **Initial State Acquisition:** Every new page navigation or top-level URL shift triggers an authoritative, full SOM snapshot.
   - **Interactive Phase (Incremental):** During agent or user interactions within a stable page, `MutationObserver` captures local mutations in-process. Mutations are **debounced over a 50 ms window** and batched into a compact delta frame.
   - **Authoritative Reconciliation Thresholds:** The in-process actor immediately cancels incremental streaming and issues a full authoritative re-snapshot if:
     1. More than **50 DOM nodes** are inserted or removed in a single batch (mutation storm guard).
     2. A top-level viewport scroll occurs that introduces more than 30% new layout elements into view.
     3. The agent fails to locate an element referenced by a previously assigned `somId` (action misfire / drift detection).
     4. A cumulative threshold of **20 consecutive incremental batches** has elapsed since the last full baseline.
2. **Actor Memory Invariant:** `JSWindowActorChild` **SHALL NOT** accumulate an unbounded mutation history log. Mutation records must be cleared immediately upon batch dispatch to prevent content-process memory bloat on long-lived sessions.

---

## Alternatives Considered

### Alternative A: Pure Full-Snapshotting on Every Action
- **Pros:** Zero risk of state drift; simple stateless implementation.
- **Cons:** Inefficient; consumes significant CPU and burns unnecessary LLM context tokens when only a single text field or button state changed.
- **Verdict:** **REJECTED.**

### Alternative B: Pure Event-Driven Incremental Streaming (No Reconciliation)
- **Pros:** Minimal continuous bandwidth.
- **Cons:** Guarantees eventual desynchronization in real-world web apps; highly fragile against layout changes, CSS transitions, and dropped IPC frames.
- **Verdict:** **REJECTED.**

---

## Trade-offs & Engineering Costs
- **Pros:**
  - Delivers 65–74% token and bandwidth savings during typical form-filling and interactive browsing workflows.
  - Automatically recovers from race conditions and mutation storms via threshold-based full reconciliation.
  - Zero long-term memory growth in browser content processes.
- **Cons / Risks:**
  - Requires maintaining both a full-snapshot serializer and a delta-patching engine in the perception layer.
  - Requires tuning debounce windows (e.g. 50 ms) to avoid perceived lag while capturing cascading DOM mutations.

---

## Security Consequences
- Incremental mutation streams must pass through the identical credential redaction filter as full snapshots. A mutation that sets `input.value` on a password field must be scrubbed to `[REDACTED]` before being placed into a delta record.

---

## Validation Requirements for Phase 1
1. Test the 50 ms debounce batching against a simulated live React dashboard updating at 60 FPS.
2. Benchmark memory usage of the hybrid actor across 1,000 continuous simulated mutations on an infinite-scroll SPA.
3. Validate that the reconciliation threshold reliably recovers from deliberately injected dropped delta packets.

