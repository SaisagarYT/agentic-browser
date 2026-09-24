# ADR-0008: Zen Workspace, Tab, and Window Structural Model

## Status
**DEFERRED (Relationship Between Zen Chrome UI State and WebDriver BiDi Contexts Unverified; Dedicated Experiment Required)**

---

## Context
Zen Browser introduces distinctive, modern tab and window management paradigms that diverge sharply from standard desktop Firefox:
1. **Zen Workspaces (`ZenWorkspaces`):** Virtual desktops within a single browser window where different sets of tabs are isolated and displayed dynamically.
2. **Split Views (`ZenSplitView`):** Tiling multiple web pages side-by-side within a single browser viewport tab.
3. **Multi-Account Containers (`userContextId`):** Color-coded contextual identities separating cookies, local storage, and sessions within the same profile.
4. **Vertical Tabs & Compact Sidebar:** Vertical scrolling tab bars integrated into the chrome UI.

Standard browser automation specifications (WebDriver BiDi and CDP) are built around two primitive abstractions:
- `WindowProxy` / Top-level `browsingContext` (representing an operating system window or a browser tab).
- Nested `browsingContext` (representing an iframe or frame element).

An agent operating inside Zen must know how an action targeting a "Workspace", a "Split View", or a "Container" maps to the underlying WebDriver BiDi context tree, or whether custom chrome-level APIs are required.

---

## Architectural Claims & Evidence Classification

| Dimension | Finding | Classification | Supporting Evidence |
| :--- | :--- | :---: | :--- |
| **BiDi Browsing Contexts** | WebDriver BiDi `browsingContext.getTree` lists all open tabs across the entire browser instance as top-level contexts. | `MEASURED` | Phase 0.2 benchmark (`bidi_baseline.json`). |
| **Workspace Visibility in BiDi**| In Phase 0.2, BiDi `getTree` returns contexts for open tabs regardless of whether they belong to the active or hidden Zen workspace; no workspace ID metadata is present in the standard BiDi response. | `MEASURED` | Phase 0.2 inspection of BiDi `getTree` JSON payload. |
| **Split View Topology** | Whether two tabs tiled inside a Zen split view appear in BiDi as two separate top-level contexts, or as a parent-child context hierarchy, is not verified. | `UNKNOWN` | Requires dedicated live UI inspection with active split tabs. |
| **Container `userContextId` Mapping**| Firefox multi-account containers use integer `userContextId` values in Gecko; BiDi context creation parameters do not expose a standardized `userContextId` field without custom Gecko extension flags. | `OBSERVED` | W3C WebDriver BiDi specification; Gecko `remote/webdriver-bidi/` source code. |
| **Zen Chrome UI State Machine** | Zen manages workspace switching via `gZenWorkspaces` in `browser.xhtml` chrome JavaScript. Hiding a workspace toggles tab DOM elements in the chrome UI rather than closing Gecko browsing contexts. | `OBSERVED` | Phase 0.1 audit (`src/browser/base/content/zen-workspaces.js`). |

---

## Architectural Traps & Unverified Assumptions

> [!CAUTION]
> **Prohibited Assumption 1:** "A Zen Workspace is equivalent to a BiDi OS Window."  
> **Status:** **DISPROVEN.** In Zen, switching workspaces does not spawn a new OS window; it hides and shows tab elements in the vertical tab bar within the same chrome window.

> [!CAUTION]
> **Prohibited Assumption 2:** "A Zen Tab is always a 1:1 mapping to a single BiDi Top-Level Context."  
> **Status:** **UNVERIFIED in Split Views.** When a user creates a split view containing two pages side-by-side, the exact context hierarchy reported by Gecko BiDi is unmeasured.

---

## Conceptual Structural Mapping (Hypothesis)

```
OS Window (Desktop Process)
  └── Zen Window (Chrome Window)
        ├── Zen Workspace 1 (UI Filter Layer - Client State)
        │     ├── Tab A (userContextId: 1) ─── BiDi Top-Level Context #1
        │     └── Tab B (userContextId: 1) ─── BiDi Top-Level Context #2
        │
        └── Zen Workspace 2 (Hidden from UI view)
              └── Split View Container
                    ├── Tab C (Left Pane)  ─── BiDi Context #3 (Top-level or Sub-frame?)
                    └── Tab D (Right Pane) ─── BiDi Context #4 (Top-level or Sub-frame?)
```

---

## Decision
1. **DEFER the formal architectural decision regarding the Workspace/Tab/Window abstraction.**
2. **Interim Operational Policy for Phase 1:**
   - The Agent Runtime will interact with web pages strictly via verified **BiDi Context IDs** (`context: "<uuid>"`), treating each page as an independent browsing context regardless of its visual workspace placement.
   - The Agent Runtime **SHALL NOT** attempt to switch, create, or delete Zen Workspaces via BiDi until a dedicated chrome-level actor bridge is verified.
3. **Requirement for Resolution:** A dedicated empirical experiment must be executed on live Zen Browser before freezing the multi-workspace agent interface.

---

## Minimum Experiment Required to Resolve ADR-0008

To resolve this unknown, execute the following empirical test on live Zen Browser:
1. **Step 1:** Launch Zen Browser with a profile containing 3 workspaces:
   - Workspace 1 ("Work"): Tabs 1 and 2.
   - Workspace 2 ("Personal"): Tab 3.
   - Workspace 3 ("Split View"): Tabs 4 and 5 in a side-by-side split grid.
2. **Step 2:** Query `browsingContext.getTree` via BiDi:
   - Record whether Tabs 1, 2, 3, 4, 5 all appear in the root array.
   - Inspect the `parent` and `children` properties of Tabs 4 and 5.
3. **Step 3:** Switch Zen's UI from Workspace 1 to Workspace 2:
   - Record whether any BiDi events (`browsingContext.contextDestroyed`, `browsingContext.fragmentNavigated`) fire.
   - Test whether `input.performActions` on Tab 1 (now hidden from UI view) succeeds or fails when its workspace is inactive.
4. **Step 4:** Inspect `gZenWorkspaces.getWorkspaceForTab(tab)` in chrome JS to determine how workspace IDs can be queried and bridged to the Agent Runtime.

---

## Security Consequences
- If the agent interacts with a hidden tab in an inactive workspace without the user's visual knowledge, it could execute actions that the user cannot observe, violating the transparency principle.
- Multi-account container isolation (`userContextId`) must be strictly honored to prevent leaking corporate cookies into personal containers.

---

## Validation Requirements for Phase 1
- Execute the 4-step minimum experiment above and publish the raw telemetry to `research/benchmarks/zen_workspace_model/`.
