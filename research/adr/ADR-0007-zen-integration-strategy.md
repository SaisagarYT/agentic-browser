# ADR-0007: Zen Browser Integration Strategy & Upstream Maintenance Debt

## Status
**ACCEPTED (Dual-Plane Hybrid Integration: Upstream BiDi + Self-Contained Zen JSWindowActor Extension in `src/zen/agent/`)**

---

## Context
Zen Browser is a rapidly evolving open-source fork of Mozilla Firefox. In Phase 0.1, a deep audit of the official Zen repository (`zen-browser/desktop`, commit `4c92731b`) established the architectural anatomy of how Zen modifies Firefox:
1. **Overlay / Patch Pipeline:** Zen applies selective patches to upstream Firefox Gecko (`surfer download` $\rightarrow$ `surfer build`) and maintains its custom UI in `src/zen/` and overrides in `src/browser/`.
2. **Actor Registration Model:** Zen isolates its own chrome-to-content communication into `ZenActorsManager` (`src/zen/common/ZenActorsManager.mjs`), registering actors without modifying Mozilla's core `BrowserGlue.sys.mjs` or `ActorManagerParent.sys.mjs`.
3. **Upstream Rebase Cadence:** Zen tracks Mozilla's rapid release cycle (every 4 weeks for major Gecko updates, plus dot-releases). Any architectural modification that invasive edits upstream Mozilla C++ or core Firefox chrome files incurs catastrophic rebase conflicts and maintenance burden.

The Agentic Browser project must determine how to integrate its control and perception layers into Zen without creating an unmaintainable fork.

---

## Architectural Claims & Evidence Classification

| Dimension | Finding | Classification | Supporting Evidence |
| :--- | :--- | :---: | :--- |
| **Zen Actor Isolation** | Zen registers custom actors via `ZenActorsManager.mjs` using `ChromeUtils.registerWindowActor()` without patching Gecko C++. | `OBSERVED` | Phase 0.1 audit (`src/zen/common/ZenActorsManager.mjs`). |
| **Upstream BiDi Availability** | Upstream Gecko contains native `WebDriver BiDi` support accessible via `--remote-debugging-port` with 0 Zen patches required. | `OBSERVED` | Phase 0.1 and Phase 0.2 verification (`staging/zen-bin/zen.exe`). |
| **Gecko C++ Rebase Overhead** | Patching Gecko C++ core files (e.g. `dom/base`, `layout/generic`, `netwerk`) results in high patch failure rates during Firefox 4-week rebase cycles. | `INFERRED` | Mozilla development history and Zen patch maintenance patterns. |
| **WebExtension Boundary Limits**| Pure WebExtensions cannot access `ChromeUtils`, cannot intercept raw frame buffers without visible prompts, and cannot control native OS windows. | `OBSERVED` | WebExtension API specifications and Mozilla MDN documentation. |

---

## Systematic Evaluation of Integration Alternatives

| Strategy | Description | Maintenance Surface | Upstream Rebase Risk | Functionality Available | Functionality Unavailable |
| :--- | :--- | :---: | :---: | :--- | :--- |
| **A. WebExtension Only** | Pure browser extension packaged in `xpi` format. | Lowest (0 Zen files) | **Zero** | DOM inspection, basic tab switching, form input. | Native clicks, background screenshots, process lifecycle, bypassing CSP/CORS, direct IPC. |
| **B. Chrome JS / XPCOM** | Injecting scripts directly into `chrome://browser/content/browser.xhtml`. | High (touches browser chrome) | **High** (UI renames break code) | Full parent chrome privileges, workspace management. | Safe content-process execution, structured site-isolated sandboxing. |
| **C. Core Gecko C++ Fork** | Adding custom XPCOM interfaces and DOM bindings in C++. | Extreme (thousands of lines) | **Disastrous** (Every rebase breaks) | Theoretical maximum performance and low-level engine hooks. | Long-term project viability; rapid iteration. |
| **D. BiDi-Only (No Zen edits)** | Relying 100% on external BiDi protocol with zero Zen modifications. | **Zero** | **Zero** | Navigation, tabs, clicks, screenshots, standard script eval. | High-speed SOM perception, continuous mutation streaming, Zen workspace control. |
| **E. External Sidecar Only** | External OS daemon driving browser via OS accessibility / input. | Zero browser edits | Zero | OS-level window control, global hotkeys. | Internal DOM access, reliable element grounding, silent headless execution. |
| **F. Dual-Plane Hybrid** | Upstream BiDi (Control) + Self-Contained Actor in `src/zen/agent/` (Perception) + External Sidecar (Runtime). | **Very Low** (1 new directory, 1 actor registration call) | **Negligible** (Completely isolated module) | **All required capabilities:** standard BiDi control, sub-millisecond SOM, zero-trust security, crash isolation. | None of the core requirements blocked. |

---

## Decision
1. **Adopt Strategy F (Dual-Plane Hybrid Integration):**
   - **Control Plane:** Utilize upstream Firefox/Zen `WebDriver BiDi` out-of-the-box via CLI flags. **Zero Zen source modifications required.**
   - **Perception Plane:** Implement the in-process SOM perception engine as a self-contained, isolated module located in a dedicated subdirectory:
     ```text
     src/zen/agent/
     ├── AgentActorsParent.sys.mjs
     ├── AgentActorsChild.sys.mjs
     ├── SomSerializer.sys.mjs
     └── PolicySanitizer.sys.mjs
     ```
   - **Actor Registration:** Hook the actor registration into `src/zen/common/ZenActorsManager.mjs` using the exact pattern Zen already uses for its own features (`ZenWorkspacesActorsManager`).
   - **Agent Runtime:** Run as an external sidecar process (ADR-0005) communicating with BiDi and the Agent Actor parent bridge over authenticated localhost WebSockets.
2. **Strict Isolation Rule:** No modifications to upstream Mozilla files (`src/browser/`, `mozilla-release/dom/`, `mozilla-release/layout/`) are permitted for perception or actuation. All custom browser code must reside under `src/zen/agent/`.

---

## Migration Path & Rebase Resilience
- **During Zen Upgrades:** Because `src/zen/agent/` is a distinct directory, rebasing Zen against upstream Firefox updates will encounter zero merge conflicts in the agent perception codebase.
- **Fallback Gracefulness:** If the custom Zen actor fails to load or if a user runs vanilla Firefox, the Agent Runtime can fall back to standard BiDi `script.evaluate` extraction (albeit with the latency trade-offs measured in Phase 0.2).

---

## Security Consequences
- Isolating custom browser logic to `src/zen/agent/` ensures that Mozilla's core security sandbox and IPC validation logic remain untouched.
- `AgentActorsChild.sys.mjs` executes strictly within the unprivileged content process realm, adhering to Gecko's Site Isolation boundaries.

---

## Validation Requirements for Phase 1
1. Verify that `ChromeUtils.registerWindowActor("AgentPerception", ...)` executes successfully inside `ZenActorsManager.mjs` on a clean Zen build.
2. Measure build-time impact of adding `src/zen/agent/` to `moz.build` (should be $< 2$ seconds).
