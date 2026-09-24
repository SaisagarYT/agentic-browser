# ADR-0001: Browser Control Plane Interface

## Status
**ACCEPTED (Constrained to Standard Host-Level Web Automation; Zen UI Extensions DEFERRED)**

---

## Context
The Agentic Browser requires a robust, bi-directional control interface to orchestrate browser navigation, tab/window lifecycle, synthetic input generation, and screen capture. Two primary external browser automation protocols exist in the modern browser ecosystem:
1. **Chrome DevTools Protocol (CDP):** Monolithic, Chromium-centric, historically bolted onto Firefox via partial emulation (`remote/cdp`), currently marked for deprecation by Mozilla in favor of standards-based protocols.
2. **WebDriver BiDi (W3C Standard):** A bidirectional, cross-browser W3C standard protocol natively integrated into upstream Firefox/Gecko (`remote/webdriver-bidi`) and available in Zen Browser.

Phase 0.1 identified that Zen Browser inherits Gecko's native `WebDriver BiDi` implementation and exposes it via the standard `--remote-debugging-port=<port>` command-line argument. Phase 0.2 empirically measured the performance, reliability, and socket behavior of this interface against live `zen.exe` across 100 iterations per capability.

---

## Architectural Claims & Evidence Classification

| Dimension | Finding | Classification | Supporting Evidence |
| :--- | :--- | :---: | :--- |
| **Transport & Binding** | WebSocket binds to `127.0.0.1:<port>/session` cleanly on cold start without crashes. | `MEASURED` | Phase 0.2 BiDi baseline; 100% connection success rate over 100 trials. |
| **Startup Latency** | Cold browser spawn to BiDi WebSocket ready state requires 1,286.28 ms. | `MEASURED` | Phase 0.2 measurement (`bidi_baseline.json`). |
| **Connection Handshake** | Initial WebSocket upgrade and session attachment requires 239.26 ms. | `MEASURED` | Phase 0.2 measurement (`bidi_baseline.json`). |
| **Context Discovery** | `browsingContext.getTree` operates at P50 = 22.94 ms, P95 = 37.53 ms, P99 = 50.76 ms. | `MEASURED` | Phase 0.2 measurement (100 trials, range 13.91–55.43 ms). |
| **Tab Creation** | `browsingContext.create` (type: tab) operates at P50 = 98.48 ms, P95 = 168.58 ms, P99 = 489.81 ms. | `MEASURED` | Phase 0.2 measurement (100 trials, tail latency caused by content-process spin-up). |
| **Navigation** | `browsingContext.navigate` (DOMContentLoaded) operates at P50 = 89.53 ms, P95 = 204.84 ms, P99 = 366.67 ms. | `MEASURED` | Phase 0.2 measurement (100 trials on local corpus). |
| **Script Execution** | `script.evaluate` operates at P50 = 23.86 ms, P95 = 42.44 ms, P99 = 57.01 ms. | `MEASURED` | Phase 0.2 measurement (100 trials). |
| **Actuation (Click)** | `input.performActions` executes synthetic clicks at P50 = 5.40 ms, P95 = 15.25 ms. | `MEASURED` | Phase 0.2 measurement (100% captured, 0% dropped). |
| **Screenshot Capture** | `browsingContext.captureScreenshot` operates at P50 = 38.43 ms, P95 = 61.13 ms. | `MEASURED` | Phase 0.2 measurement (100 trials). |
| **Tab Teardown** | `browsingContext.close` operates at P50 = 35.48 ms, P95 = 63.26 ms. | `MEASURED` | Phase 0.2 measurement (100 trials). |
| **File Interception** | BiDi standard defines `browsingContext.handleUserPrompt` and input file upload, but network download interception is not verified. | `OBSERVED` | W3C BiDi spec defines file inputs; network response interception requires BiDi network module. |
| **Zen Workspaces** | Zen-specific UI workspaces and split grids are not exposed in standard BiDi browsing context trees. | `OBSERVED` | Phase 0.1 audit (`src/browser/` and `src/zen/`); `getTree` only reports standard top-level browsing contexts. |

---

## Detailed Evaluation by Capability

### 1. Capabilities Verified in Zen (`VERIFIED`)
- **Session Lifecycle:** Clean loopback WebSocket connection, discovery, and termination.
- **Context Management:** Deterministic creation, navigation, tree enumeration, and closure of browser tabs.
- **Input Actuation:** Low-latency synthetic pointer actions (`pointerDown`, `pointerUp`, `pointerMove`) dispatched with sub-10ms latency.
- **Script Evaluation:** Arbitrary sandboxed script execution within content realms via `script.evaluate`.
- **Visual Capture:** Full-page and viewport PNG screenshot generation.

### 2. Supported by BiDi Protocol but Not Yet Verified in Zen (`UNVERIFIED`)
- **Network Request/Response Interception:** BiDi `network.addIntercept` for blocking or modifying headers/cookies.
- **Direct File Downloads:** Automating native browser download dialogs and managing destination file paths without OS-level prompts.
- **File Upload Dialog Interception:** BiDi `input.setFiles` against `<input type="file">` elements across cross-origin iframes.
- **Print / PDF Generation:** `browsingContext.print` to produce PDF documents.

### 3. Zen-Specific Limitations & Unknowns (`UNKNOWN`)
- **Workspace Isolation:** Standard BiDi does not distinguish Zen Workspaces (which are managed via Zen-specific JS modules `ZenWorkspaces` in the chrome UI). All tabs across all workspaces appear in the generic `browsingContext.getTree` list.
- **Split-View Contexts:** When Zen tiles multiple tabs in a split view, standard BiDi sees them as independent top-level browsing contexts; layout grouping is invisible to BiDi.
- **Container / `userContextId` Assignment:** Standard BiDi `browsingContext.create` does not yet natively expose Firefox multi-account container IDs (`userContextId`) across all Gecko versions without custom capabilities.

---

## Decision
1. **Adopt WebDriver BiDi as the primary external control plane** for the Agentic Browser.
2. The Agent Runtime will interact with Zen Browser via a dedicated loopback WebSocket connection over WebDriver BiDi for:
   - Browsing context lifecycle (`browsingContext.create`, `close`, `navigate`).
   - Synthetic user actuation (`input.performActions` for clicks, typing, scrolling).
   - High-resolution visual capture (`browsingContext.captureScreenshot`).
   - Context health and tree topology discovery (`browsingContext.getTree`).
3. **Explicit Boundary Constraint:** Standard WebDriver BiDi **SHALL NOT** be relied upon for:
   - Semantic Object Model (SOM) perception (rejected due to round-trip serialization overhead; see ADR-0002).
   - Continuous DOM mutation streaming (rejected due to BiDi IPC event overhead; see ADR-0004).
   - Zen-specific workspace and split-view management (deferred pending Zen chrome actor verification; see ADR-0008).

---

## Alternatives Considered

### Alternative A: Chrome DevTools Protocol (CDP) via Firefox Remote
- **Pros:** Widely supported by existing agent libraries (Puppeteer, Playwright).
- **Cons:** Mozilla has formally announced the phase-out of CDP in Gecko; maintenance in Zen is completely dependent on Mozilla's upstream deprecation schedule. CDP in Firefox suffers from protocol gaps and race conditions compared to Chromium.
- **Verdict:** **REJECTED.** Violates long-term stability and upstream architectural compatibility.

### Alternative B: WebExtension Native Messaging + Tabs API
- **Pros:** Full access to WebExtension APIs; safe execution inside user profile.
- **Cons:** Cannot launch or bootstrap the browser; cannot perform trusted synthetic hardware clicks without active window focus; subject to WebExtension permission prompts and CSP restrictions; high latency for frame capture.
- **Verdict:** **REJECTED as primary control plane.** Useful only as an auxiliary coordination channel if necessary.

### Alternative C: Custom Zen C++ / XPCOM Daemon
- **Pros:** Unrestricted access to Gecko internals and Zen chrome state.
- **Cons:** Massive maintenance debt; requires patching upstream Mozilla C++ source; breaks with every upstream Gecko rebase; high risk of process memory leaks and browser instability.
- **Verdict:** **REJECTED.** Unacceptable upstream maintenance burden.

---

## Trade-offs & Engineering Costs
- **Pros:**
  - Zero modifications to Zen source required for baseline control plane; uses upstream Gecko native capabilities.
  - W3C standardization ensures forward compatibility with future Firefox and Zen releases.
  - Tail latency for input actuation is exceptionally low (P50 = 5.40 ms).
- **Cons / Risks:**
  - Browser cold startup requires ~1.3 seconds, requiring persistent browser process management rather than ephemeral on-demand launching.
  - Tab creation tail latency is significant (P99 = 489.81 ms), necessitating tab pre-warming or pooling strategies for multi-step agent workflows.
  - Zen-specific workspace management requires an auxiliary integration layer.

---

## Security Consequences
- **Loopback Attack Surface:** Binding `--remote-debugging-port` to `127.0.0.1` exposes full browser control to any local process running on the host machine unless protected by authentication tokens.
- **Mitigation:**
  - Launch with randomized ephemeral port numbers.
  - Bind exclusively to localhost loopback (`127.0.0.1`).
  - Require cryptographically secure session authorization tokens generated by the Agent Runtime during bootstrap.
  - Strictly prohibit binding to external network interfaces (`0.0.0.0`).

---

## Validation Requirements for Phase 1
1. Verify `input.setFiles` behavior across cross-origin iframes on live Zen.
2. Verify `network.addIntercept` and response body streaming under heavy network traffic.
3. Validate session authorization mechanisms preventing unauthorized local processes from hijacking the BiDi port.
