# ADR-0005: Agent Runtime Process Boundary & Host Architecture

## Status
**ACCEPTED (External Dedicated Local Agent Daemon / Sidecar Process)**

---

## Context
A critical architectural boundary in an agentic browser is the physical and logical placement of the **Agent Runtime**—the subsystem responsible for:
- Orchestrating LLM inference calls, API keys, and model gateways.
- Long-term memory, vector databases, and scratchpad history.
- Task planning, tool invocation, and decision loops.
- Human-in-the-loop permission enforcement and confirmation gates.
- Multi-agent coordination and external API tool integration (e.g. Google Drive, Office 365, local file system).

The architectural question is whether this runtime should be embedded directly inside the browser process (e.g., inside Zen's privileged Firefox chrome process via XPCOM/JS), embedded in an extension background script, or hosted in an external dedicated daemon process communicating with the browser over standard IPC/loopback protocols.

---

## Architectural Claims & Evidence Classification

| Dimension | Finding | Classification | Supporting Evidence |
| :--- | :--- | :---: | :--- |
| **Parent Process Crash Risk** | Firefox/Zen's privileged parent process hosts the main UI thread, graphics compositor, and networking socket threads; heavy unhandled JS exceptions or memory pressure in the parent process crashes the entire browser window. | `OBSERVED` | Phase 0.1 audit (`src/browser/app/nsBrowserApp.cpp`, Gecko multi-process architecture). |
| **API Secret Isolation** | Storing user LLM API keys, OAuth tokens, and system credentials inside the browser's JavaScript environment exposes them to memory inspection or accidental leakage via browser devtools and extension APIs. | `INFERRED` | Threat model in `phase0_research_report.md`. |
| **Browser Cold Launch Impact** | Spawning `zen.exe` takes 1,286.28 ms; an agent runtime decoupled from the browser can maintain task state, plans, and queues across browser restarts or crashes. | `MEASURED` | Phase 0.2 BiDi baseline. |
| **Resource & Model Overhead** | Running local embedding models or agent reasoning pipelines requires significant RAM and native libraries (ONNX, PyTorch, or Rust bindings) that cannot run efficiently inside SpiderMonkey JS without massive MozillaBuild patches. | `OBSERVED` | Phase 0.1 build system audit (Rust in Zen is limited to `tools/ffprefs`; adding native ML dependencies to Gecko build is high-risk). |
| **Multi-Agent / Cloud Portability**| An external agent runtime can run locally on desktop, or be migrated to a secure container / cloud sandbox without altering browser internals. | `INFERRED` | Phase 0 architectural requirements. |

---

## Systematic Evaluation of Runtime Placement Alternatives

| Architectural Criteria | A. Inside Zen Privileged Parent (XPCOM) | B. Inside Browser WebExtension | C. External Local Daemon (Sidecar) | D. Pure Remote Cloud Service | E. Hybrid (Thin Chrome Hook + Daemon) |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **Crash Isolation** | **Critical Hazard** (Agent crash kills entire browser) | Moderate (Worker crash kills extension) | **Complete** (Agent crash leaves browser running) | **Complete** | **Complete** |
| **Security & Secrets** | Poor (Secrets in browser heap) | Very Poor (Exposed to WebExt APIs) | **High** (Encrypted OS keychain/vault) | High (Server-side vault) | **High** (Local OS vault) |
| **Native ML / Tools** | Extremely Difficult (SpiderMonkey) | None (Pure JS sandbox) | **Native** (Full Rust/Node/Python access) | High (Server compute) | **Native** (Via daemon) |
| **Browser Lifecycle** | Tied to browser window | Tied to browser window | **Decoupled** (Survives browser restarts) | Decoupled | **Decoupled** |
| **Resource Contention**| Competes with UI thread for CPU | Throttled by browser background tabs | Isolated (Separate OS priority / cgroups) | Zero host impact | Isolated |
| **Upstream Rebase Debt**| **Disastrous** (Massive Gecko patches) | Minimal | **Zero** (Standard protocols) | Zero | **Minimal** (Small actor patch) |
| **Offline / Local Use**| Yes | Yes | **Yes** | No | **Yes** |
| **Policy Enforcement** | Hard to enforce outside model | Inadequate | **Structural** (Kernel-style policy gate) | Network-mediated | **Structural** |

---

## Decision
1. **The Agent Runtime SHALL run as an external dedicated local process (Sidecar Architecture).**
2. **Prohibition of In-Process Agent Reasoning:** Under no circumstances will LLM orchestration, model API keys, vector databases, or long-running task planning logic be embedded directly inside Zen's privileged SpiderMonkey chrome JavaScript environment or Gecko C++ core.
3. **Process Boundaries & Communication:**
   - The Agent Runtime connects to Zen Browser via two distinct loopback channels:
     - **Control Plane:** Over the W3C WebDriver BiDi WebSocket (`ws://127.0.0.1:<port>/session`) for browser lifecycle, window management, and input actuation (ADR-0001).
     - **Perception Plane:** Over a dedicated local WebSocket/IPC bridge to `JSWindowActorParent` for streaming sanitized SOM updates (ADR-0002).
4. **Lifecycle Independence:** The Agent Runtime can launch, monitor, restart, and terminate Zen Browser instances without losing task history, active scratchpad memory, or user policy session state.

---

## Alternatives Considered & Explicit Rejections

### Alternative A: Embedding the Agent in Zen's Chrome Parent Process (XPCOM/JS)
- **Rationale for Rejection:** Unacceptable risk of crashing the user's browser during complex reasoning or model timeouts; requires modifying upstream Mozilla source code; bloats browser memory; creates a massive security vulnerability where prompt injection could compromise the entire OS through browser-privileged XPCOM APIs.

### Alternative B: Pure WebExtension Background Service Worker
- **Rationale for Rejection:** WebExtensions are heavily constrained by manifest security restrictions, have aggressive memory quotas, cannot control native OS files or invoke local terminal tools, and are terminated by Gecko's background tab freeze mechanisms.

### Alternative C: Pure Remote Cloud Service (No Local Agent)
- **Rationale for Rejection:** Violates core product vision for privacy-first, local-first execution; exposes authenticated session cookies to third-party cloud infrastructure; introduces unneeded network latency into UI perception/actuation loops.

---

## Trade-offs & Engineering Costs
- **Pros:**
  - Absolute crash resilience: if Zen crashes or hits an out-of-memory error, the agent runtime detects the disconnect, retains task state, restarts Zen, and restores tabs.
  - Zero upstream maintenance burden on Gecko's build system.
  - Flexibility to implement the agent runtime in modern systems languages (Rust, Go, or high-performance TypeScript) without fighting Mozilla's build system.
- **Cons / Risks:**
  - Requires maintaining an inter-process loopback protocol between the daemon and browser.
  - Requires packaging and installing an auxiliary daemon alongside Zen Browser for the desktop installer.

---

## Security Consequences
- **Zero-Trust Boundary:** The browser engine is treated as an untrusted client by the Agent Runtime. Any data coming from the browser (web page text, DOM structure) is treated as potentially malicious untrusted input (preventing prompt injection from gaining host privileges).
- **Secret Isolation:** LLM API keys and user credentials reside solely in the Agent Daemon's memory space and OS credential store (e.g. Windows DPAPI, macOS Keychain), completely inaccessible to web pages or browser extensions.

---

## Validation Requirements for Phase 1
1. Test crash recovery: Deliberately terminate `zen.exe` while an agent task is active; verify the Agent Daemon detects the socket close, restarts `zen.exe`, reconnects via BiDi, and resumes the plan.
2. Measure loopback socket latency between the external daemon and the browser parent process under 100% CPU load.

