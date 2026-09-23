# Phase 0.1: Zen Browser Source Code & Architecture Audit

**Document Version:** 1.0.0-PROD  
**Author:** Principal Software Architect & Research Engineer  
**Date:** September 23, 2026  
**Status:** Complete / Ready for Architectural Review  
**Subject:** Official Zen Browser Desktop Source Repository Audit (`zen-browser/desktop`)  
**Target Delivery:** `research/phase0.1_zen_source_audit.md`  

---

## 1. Audit Metadata

- **Official Repository URL:** `https://github.com/zen-browser/desktop.git`
- **Acquisition Mechanism:** Git sparse/depth-1 clone of upstream official repository into staging directory.
- **Staging Directory:** `staging/zen-desktop/` (workspace-isolated, added to root `.gitignore`).
- **Commit SHA:** `4c92731b2dbbcf3f5a4dad79c09d13c38f91f774`
- **Active Branch:** `dev` (tracking `origin/dev`, the upstream default branch).
- **Audit Date:** September 23, 2026.
- **Base Firefox / Gecko Engine:** Firefox `156.0.1` (Candidate Build `1`, product: `firefox`), verified from `staging/zen-desktop/surfer.json#L7-L11`.
- **Zen Browser Release Version:** `1.22.3b` (Release) / `1.23t` (Twilight channel), verified from `staging/zen-desktop/surfer.json#L23,L43`.
- **License:** Mozilla Public License 2.0 (MPL-2.0), verified from `staging/zen-desktop/LICENSE#L1`.

---

## 2. Repository Structure

### 2.1 Firefox / Gecko Relationship
Zen Browser does **not** vendor the entire multi-gigabyte Mozilla Firefox source repository directly in its git repository. Instead, it utilizes a proprietary Node.js-based orchestration CLI tool called **Surfer** (`@zen-browser/surfer`, version `^1.14.9` in `package.json#L52`). 

The repository consists of:
1. **Upstream Patches:** 256 granular `.patch` files located across `src/` mirroring the Firefox repository layout (`src/browser/`, `src/toolkit/`, `src/accessible/`, `src/dom/`, `src/widget/`, etc.).
2. **Zen Core Subsystem:** A completely dedicated directory, `src/zen/`, containing Zen's unique browser features, UI widgets, custom C++ XPCOM utilities, and IPC actor definitions.
3. **Engine Staging (`engine/`):** During local development and CI, `surfer download` downloads the upstream Firefox engine source matching the version defined in `surfer.json` into an `engine/` directory, where patches and Zen subsystems are grafted.

```
staging/zen-desktop/
├── .github/workflows/          # CI/CD release, PGO build, and upstream sync workflows
├── build/                      # Packaging configurations (Flatpak, AppImage, NSIS/Windows, macOS)
├── configs/                    # mozconfig build profiles (common, windows, macos, linux)
├── docs/                       # Developer onboarding documentation
├── locales/                    # Localization strings (Fluent .ftl files) for Zen UI
├── prefs/                      # YAML-based preference definitions (zen, firefox, fastfox, privatefox)
├── scripts/                    # Python and Bash automation scripts for build, sync, and testing
├── src/                        # 256 Firefox patches + Zen core subsystem
│   ├── accessible/             # Patches to Gecko accessibility (IA2, TextAttrs)
│   ├── browser/                # Patches to Firefox desktop frontend (browser.xhtml, browser.js, etc.)
│   ├── devtools/               # Minor patches to DevTools startup and shortcuts
│   ├── dom/                    # Patches to DOM window and element behaviors
│   ├── toolkit/                # Patches to Mozilla toolkit (extensions, profile, themes)
│   └── zen/                    # ZEN CORE SUBSYSTEM (Workspaces, Split-View, Actors, C++ Utils)
└── tools/                      # In-tree development utilities (ffprefs, virustotal-checker)
```

### 2.2 Directory Map with Evidence

| Directory Path | Architectural Purpose | Concrete Source Evidence |
| :--- | :--- | :--- |
| `src/zen/` | Root of Zen-specific browser capabilities and UI components. | `src/zen/moz.build#L9-L27` defines `DIRS += ["spaces", "split-view", "tabs", "urlbar", "toolkit", "sessionstore", ...]` |
| `src/zen/spaces/` | Zen Workspaces implementation (isolation of tabs into virtual spaces). | `src/zen/spaces/ZenSpaceManager.mjs#L35` implements `class nsZenWorkspaces` (exposed as `gZenWorkspaces`). |
| `src/zen/split-view/` | Multi-view split-screen tiling of browsing contexts within a window. | `src/zen/split-view/ZenViewSplitter.mjs#L1` defines `gZenViewSplitter`. |
| `src/zen/sessionstore/` | Session restoration, window sync, and workspace persistence across restarts. | `src/zen/sessionstore/ZenSessionManager.sys.mjs` and `ZenWindowSync.sys.mjs`. |
| `src/zen/common/sys/` | Centralized registration of Fission-compatible IPC actors. | `src/zen/common/sys/ZenActorsManager.sys.mjs#L21` registers `JSWINDOWACTORS`. |
| `src/zen/toolkit/common/` | Native C++ XPCOM components and XPIDL interfaces. | `src/zen/toolkit/common/nsIZenCommonUtils.idl#L12` and `ZenCommonUtils.cpp`. |
| `src/zen/urlbar/` | Custom Omnibox actions, site data panel, and permissions integration. | `src/zen/urlbar/ZenSiteDataPanel.sys.mjs#L19` defines `class nsZenSiteDataPanel`. |
| `src/browser/` | Patches applied to Firefox's desktop chrome frontend. | `src/browser/base/moz-build.patch#L10` adds `DIRS += ["../../zen"]` into Firefox build. |
| `configs/common/` | Global Gecko/Firefox build flags for all platforms. | `configs/common/mozconfig#L6-L16` sets `--with-app-name`, `--with-app-basename=Zen`. |
| `prefs/zen/` | High-level YAML definitions of all `zen.*` preferences. | `prefs/zen/workspaces.yaml`, `prefs/zen/compact-mode.yaml`, etc. |
| `tools/ffprefs/` | In-house Rust utility compiling YAML preference definitions into C++ headers. | `tools/ffprefs/src/main.rs#L1` parses YAML into `StaticPrefList_zen.h`. |
| `scripts/` | Tooling for downloading engine tarballs, syncing upstream, and executing tests. | `scripts/update_ff.py#L13` checks Firefox RC feeds; `scripts/run_tests.py` runs mochitests. |

---

## 3. Build System Architecture

### 3.1 Orchestration Mechanism: Surfer & Mach
Zen employs a two-tier build process:
1. **Outer Orchestrator (`surfer`):** Defined in `package.json` and driven by `@zen-browser/surfer`:
   - `npm run download`: Downloads the exact Firefox source release specified in `surfer.json` (`version: "156.0.1"`, `candidateBuild: 1`) from Mozilla's CDN and extracts it into `engine/`.
   - `npm run ffprefs`: Compiles `prefs/zen/*.yaml` into native Mozilla static preference C++ headers using the Rust crate in `tools/ffprefs/`.
   - `npm run import`: Applies all 256 `.patch` files from `src/` to `engine/`, and links `src/zen/` into the Firefox source tree.
   - `npm run export`: Reverse-calculates diffs between `engine/` and unmodified Firefox, updating the `.patch` files in `src/`.
2. **Inner Build Engine (`mach`):** Once `engine/` is patched, the build executes standard Mozilla build commands:
   - `python3 ./mach build` compiles the C++, Rust, and JavaScript components using Mozilla's build system.
   - Packaging is handled via `surfer package` which triggers `mach package` producing `.mar`, NSIS installers, DMGs, or AppImages.

```
+---------------------------------------------------------------------------------------+
| SURFER CLI (@zen-browser/surfer)                                                      |
| 1. Download Firefox Engine (v156.0.1) -----> Extracted to engine/                     |
| 2. Run tools/ffprefs (Rust) -------------> Generates StaticPrefList_zen.h             |
| 3. Apply 256 Patches from src/ ----------> Modifies engine/browser/, engine/dom/, etc.|
| 4. Graft src/zen/ into engine/ ----------> Injected via browser/base/moz.build        |
+---------------------------------------------------------------------------------------+
                                           |
                                           v
+---------------------------------------------------------------------------------------+
| MOZILLA MACH BUILD SYSTEM (python3 ./mach build)                                      |
| - Clang / MSVC C++ Compilers (Gecko DOM, Layout, Netwerk, ZenCommonUtils.cpp)         |
| - Rust Compiler (WebRender, Servo modules, ffprefs)                                   |
| - XPIDL Compiler (Generates C++ headers & xpt typelibs from nsIZenCommonUtils.idl)     |
| - JAR Manifest Packager (Packages chrome:// and resource:// into omni.ja)             |
+---------------------------------------------------------------------------------------+
```

### 3.2 Compilation Profiles & Configurations
Inspecting `configs/common/mozconfig`:
- **Application Target:** Line 27: `ac_add_options --enable-application=browser`
- **Branding Directory:** Lines 13-14: `export MOZ_BRANDING_DIRECTORY=${brandingDir}`
- **Compiler Optimization:** Lines 29-38: Integrates `sccache` for distributed compilation caching.
- **Linker & PGO:** Lines 55-60: Enables Clang plugins; Windows configurations (`configs/windows/mozconfig#L45-L51`) enable Profile-Guided Optimization (PGO) and Link-Time Optimization (`MOZ_LTO=cross,full`).

---

## 4. Zen UI Architecture

Zen dramatically restructures the standard Firefox desktop UI through a combination of XHTML template replacement, CSS grid/flexbox re-architecting, and custom ES modules loaded at window creation.

```
+---------------------------------------------------------------------------------------+
| browser.xhtml (Patched by src/browser/base/content/browser-xhtml.patch)               |
|                                                                                       |
|  +-- zen-preloaded.inc.xhtml (Loads zen-sets.js & ZenHasPolyfill.mjs)                 |
|  +-- zen-assets.inc.xhtml (Loads 20+ CSS files & ZenPreloadedScripts.js)              |
|                                                                                       |
|  +-- #zen-main-app-wrapper (hbox wrapping the entire browser content area)            |
|       |                                                                               |
|       +-- #zen-sidebar-web-panel (Web panels / Sidebars)                              |
|       +-- #navigator-toolbox (Relocated into vertical flexbox)                        |
|       |    +-- #zen-appcontent-navbar-container (nav-bar & PersonalToolbar)           |
|       |    \-- #tabbrowser-arrowscrollbox[orient="vertical"] (Vertical Tab Tree)      |
|       |                                                                               |
|       \-- #browser (Content Area & Out-of-Process Browsers)                           |
|            +-- #tab-notification-deck (Relocated to prevent vertical tab overlap)     |
|            +-- #zen-glance-overlay (Glance preview popup)                             |
|            \-- #zen-split-view-container (Multi-tab split screen grid)                |
+---------------------------------------------------------------------------------------+
```

### 4.1 Window DOM & Entry Hooks
1. **Entry Point (`browser.xhtml`):**
   - Patched via `src/browser/base/content/browser-xhtml.patch#L17-L20`:
     - Injects `#include zen-preloaded.inc.xhtml` before main global scripts.
     - Injects `#include zen-assets.inc.xhtml` into `<head>`.
     - Injects `<hbox id="zen-main-app-wrapper" flex="1">` wrapping the entire `#browser-box`.
2. **Preloaded Script Loader (`ZenPreloadedScripts.js`):**
   - Located at `src/zen/common/ZenPreloadedScripts.js#L15-L36`:
   - Synchronously imports Zen ES modules into the window scope:
     - `ZenStartup.mjs` (lifecycle orchestration)
     - `ZenSpaceManager.mjs` (workspaces)
     - `ZenCompactMode.mjs` (auto-hiding toolbars)
     - `ZenUIManager.mjs` (UI notifications, toasts, theme modifiers)
     - `ZenViewSplitter.mjs` (split-screen layout)
     - `ZenGlanceManager.mjs` (link peek overlays)
     - `ZenPinnedTabManager.mjs` (pinned tab strip)
     - `ZenFolders.mjs` (tab grouping folders)
3. **Startup Event Sequencing:**
   - In `src/zen/common/modules/ZenStartup.mjs#L211-L217`:
     - Listens for `MozBeforeInitialXULLayout` on `window`.
     - Executes `gZenStartup.init()`: moves `#nav-bar` and `#PersonalToolbar` into `#zen-appcontent-navbar-container`.
     - Sets `#tabbrowser-arrowscrollbox` orient attribute to `vertical`.
     - Awaits `browser-delayed-startup-finished`, `SessionStore.promiseAllWindowsRestored`, and `gZenWorkspaces.promiseInitialized`.

### 4.2 Workspace & Tab Management Architecture
1. **Workspaces Subsystem (`ZenSpaceManager.mjs`):**
   - Defines `class nsZenWorkspaces` (exposed globally as `gZenWorkspaces`).
   - Tabs belong to specific workspace IDs (`zen-workspace-id` attribute on `<tab>` elements).
   - Workspaces can be bound directly to Firefox Multi-Account Containers via `getCurrentSpaceContainerId()` (`src/zen/spaces/ZenSpaceManager.mjs#L447`).
   - Unloading: Inactive workspaces can be unloaded from memory via `unloadWorkspace()` (`line 1529`), freeing content processes.
2. **Split View Subsystem (`ZenViewSplitter.mjs`):**
   - Tiled browsing: Manages multiple `<browser>` elements side-by-side inside `#zen-split-view-container`.
   - Modifies `gBrowser` tab selection logic so multiple tabs can remain active and rendering simultaneously.

---

## 5. Firefox Process Architecture as Used by Zen

Zen inherits Firefox's multi-process model (**Fission / Site Isolation**). Process boundaries are enforced at the operating system level via sandboxed processes:

```
+---------------------------------------------------------------------------------------------------+
| OS PROCESS MODEL                                                                                  |
|                                                                                                   |
|  +---------------------------------------------------------------------------------------------+  |
|  | PARENT PROCESS (Privileged Chrome)                                                          |  |
|  | - Window management, TabBrowser, gBrowser, Workspaces, SplitView                             |  |
|  | - Network Security, Cookie Storage, Permission Manager, Password Store                     |  |
|  | - JSWindowActorParent, JSProcessActorParent                                                 |  |
|  +---------------------------------------------------------------------------------------------+  |
|         |                                            |                                            |
|         | IPC (PBrowser / PContent)                  | IPC (PBrowser / PContent)                  |
|         v                                            v                                            v
|  +------------------------------+     +------------------------------+     +--------------------+ |
|  | CONTENT PROCESS 1 (web)      |     | CONTENT PROCESS 2 (web)      |     | EXTENSION PROCESS  | |
|  | - Origin: https://bank.com   |     | - Origin: https://evil.com   |     | - WebExtension     | |
|  | - Gecko Layout / DOM / CSS   |     | - Gecko Layout / DOM / CSS   |     |   Background       | |
|  | - SpiderMonkey JS Engine     |     | - SpiderMonkey JS Engine     |     |   Scripts          | |
|  | - JSWindowActorChild         |     | - JSWindowActorChild         |     | - Restricted APIs  | |
|  +------------------------------+     +------------------------------+     +--------------------+ |
|         ^                                                                                         |
|         | Out-of-Process Iframe (Fission)                                                         |
|         v                                                                                         |
|  +------------------------------+                                                                 |
|  | CONTENT PROCESS 3 (web)      |                                                                 |
|  | - Origin: https://ad.com     |                                                                 |
|  +------------------------------+                                                                 |
+---------------------------------------------------------------------------------------------------+
```

### Process Classification for Future Agent Integration

#### A. Privileged Browser-Side Execution (Parent / Chrome Process)
- **Environment:** System Principal (`systemPrincipal`), full native XPCOM access, unrestricted file system access, raw socket access.
- **Components:** `ZenStartup.mjs`, `ZenSpaceManager.mjs`, `gBrowser`, `SessionStore`, `JSWindowActorParent`.
- **Security Posture:** Trusted core. Any arbitrary code execution here compromises the host machine.

#### B. Unprivileged Web-Content Execution (Content Processes)
- **Environment:** Content Principal (`nsIContentPrincipal`), sandboxed by OS (no direct filesystem access, no direct network sockets, restricted syscalls).
- **Components:** Web page DOM, SpiderMonkey execution of site JS, `JSWindowActorChild`.
- **Security Posture:** Untrusted. Must be treated as potentially malicious and subject to adversarial prompt injections.

#### C. Extension Execution (Extension Process / Isolated Content Worlds)
- **Environment:** Extension Principal. WebExtension background pages run in an isolated process; content scripts run in isolated script worlds within content processes.
- **Security Posture:** Semi-privileged. Bound by declared WebExtension manifest permissions.

#### D. External / Native Process Execution (Sidecar / Daemon)
- **Environment:** OS-level separate process (e.g. Python / Rust service).
- **Security Posture:** External trust domain. Communicates with Zen via standard OS IPC (stdio, domain sockets, or WebSockets).

---

## 6. IPC / Actor System Architecture

The primary communication bridge in Zen is Mozilla's **JSWindowActor** and **JSProcessActor** system.

### 6.1 Registration in Zen (`ZenActorsManager.sys.mjs`)
Located at `src/zen/common/sys/ZenActorsManager.sys.mjs#L21-L78`, Zen registers actors using `ActorManagerParent.addJSWindowActors()`:
- `ZenGlance`: Handles link previews; listens for `mousedown`, `keydown`, `click` events in all frames (`allFrames: true`), operating across `remoteTypes: ["web", "file"]`.
- `ZenWindowDrag`: Manages dragging windows from web content space.
- `ZenModsMarketplace`: Injects API bridges into `about:preferences` and whitelisted marketplace URLs.
- `ZenBoosts`: Content script style/script injection engine (`DOMDocElementInserted` event).

### 6.2 IPC Evaluation Matrix

| Criterion | JSWindowActor | JSProcessActor | Native Messaging | WebDriver BiDi WebSocket |
| :--- | :--- | :--- | :--- | :--- |
| **1. Where Defined?** | `ActorManagerParent.sys.mjs`, `ZenActorsManager.sys.mjs` | `ActorManagerParent.sys.mjs` | `ext-runtime.js`, `NativeMessaging.sys.mjs` | `remote/` subsystem (`RemoteAgent.sys.mjs`) |
| **2. Who Can Call?** | Registered chrome & content modules. | Registered chrome & content processes. | WebExtensions with `"nativeMessaging"` permission. | External client connected to WebSocket port. |
| **3. Privilege Level?** | Parent: System Principal; Child: Content Principal. | Parent: System; Child: Process-level Content. | Extension: Semi-privileged; Host: OS User. | Debugger privileges (can control entire browser). |
| **4. Process Execution?** | Parent runs in Parent; Child runs in Content Process. | Parent runs in Parent; Child runs in Content Process. | Extension runs in Ext Process; Host runs as standalone OS process. | Runs in Parent Process; dispatches commands to Content via actors. |
| **5. Parent <-> Content?** | **Yes** (Bidirectional: `sendAsyncMessage`, `sendQuery`). | **Yes** (Process-wide, not window-bound). | **No** (Only Extension <-> Native OS process). | **Yes** (Orchestrated by Mozilla remote actors). |
| **6. Manipulate State?** | **Yes** (Parent actor has full access to `topChromeWindow`). | **Yes** (Process-level state only). | **No** (Restricted to WebExtension APIs). | **Yes** (Full DOM, navigation, and input control). |
| **7. Agent Suitability?** | **EXCELLENT** for in-engine DOM extraction and page interaction. | **MODERATE** (lacks per-window DOM context). | **POOR** (high IPC hop latency, extension limits). | **EXCELLENT** for external sidecar automation. |
| **8. Security Risks?** | Malicious content process sending forged messages to Parent. Must allowlist data (as done in `ZenGlanceParent.sys.mjs#L21`). | Content process compromising process-wide state. | Native host binary vulnerabilities; privilege escalation. | Unauthenticated WebSocket port exposure if bound to non-localhost. |

---

## 7. WebExtension Capabilities Audit

Zen Browser patches `src/browser/components/extensions/parent/ext-tabs.js` and `ext-browser.js`, altering standard Firefox WebExtension behavior to accommodate Zen Workspaces:

```javascript
// src/browser/components/extensions/parent/ext-browser.js.patch
getId(nativeTab) {
+ if (nativeTab.hasAttribute("zen-empty-tab")) return -1;
  let id = this._tabs.get(nativeTab);
...
canAccessTab(nativeTab) {
+ if (nativeTab.hasAttribute("zen-empty-tab")) {
+   return false;
+ }
```

### WebExtension Capability Matrix in Zen

| Capability | Status | Required Permission / Scope | Source Evidence / Notes |
| :--- | :--- | :--- | :--- |
| **Inspect Tabs** | **SUPPORTED** | `"tabs"` | Supported, but empty workspace placeholder tabs are hidden (`getId() == -1`). |
| **Create Tabs** | **SUPPORTED** | `"tabs"` | Patched in `ext-tabs.js.patch#L17` to respect `window.gZenCompactModeManager`. |
| **Close Tabs** | **SUPPORTED** | `"tabs"` | Standard Firefox extension tabs API. |
| **Switch Tabs** | **SUPPORTED** | `"tabs"` | Switches active tab; triggers workspace change if tab is in another space. |
| **Navigate Tabs** | **SUPPORTED** | `"tabs"`, `"webNavigation"` | Standard API supported. |
| **Inspect DOM** | **SUPPORTED WITH PERMISSION** | `"<all_urls>"` or `"activeTab"` | Via content scripts (`browser.scripting.executeScript`). Runs in isolated JS world. |
| **Interact with Forms** | **SUPPORTED WITH PERMISSION** | `"<all_urls>"` or `"activeTab"` | Content script can dispatch synthetic DOM click/input events. |
| **Access Page Content** | **SUPPORTED WITH PERMISSION** | `"<all_urls>"` | Full text/DOM access via content script. |
| **Observe Navigation** | **SUPPORTED WITH PERMISSION** | `"webNavigation"` | Standard events: `onBeforeNavigate`, `onCompleted`. |
| **Downloads / Uploads**| **SUPPORTED WITH PERMISSION** | `"downloads"` | Standard Firefox downloads API; uploads require file input attachment via script. |
| **Access Cookies** | **SUPPORTED WITH PERMISSION** | `"cookies"` + Host permission | Can read/write cookies; respects container `storeId` (`userContextId`). |
| **Access Storage** | **SUPPORTED WITH PERMISSION** | `"storage"` | Extension-local storage only (`browser.storage.local`). Cannot read site IndexedDB directly. |
| **Communicate with Chrome** | **NOT SUPPORTED** | None | WebExtensions cannot directly invoke internal chrome JS modules (`gBrowser`, `gZenWorkspaces`). |
| **Native Process IPC** | **SUPPORTED WITH PERMISSION** | `"nativeMessaging"` | Can exchange JSON messages via stdio with registered native binaries. |

---

## 8. WebDriver / BiDi / Debugging Interfaces

Zen does **not** alter or disable Mozilla's native remote debugging or automation subsystems (`src/remote/` has zero patches).

### Interface Evaluation

```
+---------------------------------------------------------------------------------------------------+
| AUTOMATION & DEBUGGING INTERFACES (Inherited Pristine from Firefox 156.0.1)                       |
|                                                                                                   |
|  1. W3C WebDriver BiDi (WebSocket)                                                                |
|     - Transport: ws://127.0.0.1:<port>/session                                                    |
|     - Flag: --remote-debugging-port <port>                                                        |
|     - Capabilities: Bi-directional event streaming (browsingContext, network, script, log)        |
|     - State Access: Full tab/window tree, navigate, evaluate, input actions                       |
|                                                                                                   |
|  2. Marionette Protocol (TCP Sockets)                                                             |
|     - Transport: TCP port 2828                                                                    |
|     - Flag: --marionette                                                                          |
|     - Capabilities: Geckodriver backend; synchronous command execution                           |
|                                                                                                   |
|  3. Chrome DevTools Protocol (CDP Subset)                                                          |
|     - Transport: WebSocket via Remote Agent                                                      |
|     - Flag: --remote-debugging-port <port>                                                        |
|     - Capabilities: Partial CDP implementation (Page, Target, Runtime domains)                    |
+---------------------------------------------------------------------------------------------------+
```

1. **W3C WebDriver BiDi:**
   - **Availability:** Fully supported out-of-the-box via `firefox -remote-debugging-port <port>`.
   - **Transport:** WebSocket.
   - **Security:** Bound to localhost by default; requires active local port binding.
   - **DOM & Input Control:** Native OS-level synthetic input via `input.performActions` (accurate keydown/keyup, mouse movement, touch events); script evaluation in isolated or user context via `script.evaluate`.
   - **Limitations:** Does not expose Zen-specific high-level metadata (such as Zen Workspace names or Glance status) unless extended.
2. **Marionette:**
   - **Availability:** Fully supported via `-marionette` flag (used by `scripts/run_tests.py` during mochitests).
   - **Limitations:** Legacy synchronous JSON-RPC protocol; largely superseded by WebDriver BiDi for modern asynchronous streaming.

---

## 9. Browser State & Session Boundaries

Understanding how browser state is managed is critical for designing security-safe session handling:

```
+---------------------------------------------------------------------------------------------------+
| BROWSER STATE ARCHITECTURE                                                                        |
|                                                                                                   |
|  Tabs & Workspaces:        gZenWorkspaces (ZenSpaceManager.mjs) + gBrowser (tabbrowser.js)        |
|  Session Storage:          ZenSessionManager.sys.mjs + SessionStore.sys.mjs (sessionstore.jsonlz4)|
|  Authentication / Cookies: nsICookieManager partitioned by OriginAttributes (userContextId)        |
|  Password Manager:         LoginManagerParent.sys.mjs + OS Keyring (Logins / Credentials)         |
|  Site Permissions:         SitePermissions.sys.mjs + nsIPermissionManager (permissions.sqlite)   |
|  History & Bookmarks:      Places (places.sqlite) + ZenWorkspaceBookmarksStorage.js               |
+---------------------------------------------------------------------------------------------------+
```

1. **Tabs & Workspaces:**
   - Standard Firefox maintains tabs in `gBrowser.tabs`. Zen augments each tab with `zen-workspace-id`.
   - Workspace state is managed by `gZenWorkspaces` (`src/zen/spaces/ZenSpaceManager.mjs`), which persists workspace definitions and tab associations into session data.
2. **Context Containers (Site Isolation):**
   - Zen deeply integrates with Firefox's `ContextualIdentityService`.
   - In `ZenSpaceManager.mjs#L447`, `getCurrentSpaceContainerId()` retrieves the active container ID (`userContextId`). Tabs opened in that workspace automatically inherit this `userContextId`.
   - **Crucial Security Implication:** Cookies, `localStorage`, `sessionStorage`, and `IndexedDB` are strictly segregated per container ID via `OriginAttributes`. An agent running in Container 1 has zero access to cookies in Container 2.
3. **Credentials & Masked Inputs:**
   - Credentials are stored by Firefox's `LoginManager` (`nsILoginManager`).
   - In web pages, `<input type="password">` fields are masked visually and managed by `LoginManagerChild` in content processes.
   - Any agent content script or actor with content-DOM access can read the plaintext `.value` of password inputs unless explicitly redacted before serialization.

---

## 10. Security Boundaries Analysis

| Security Boundary | Source Context | Target Context | Trust Level Transition | What Can Cross It | Security Implications for Agent Browser |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **1. Web Content -> Content Actor** | Web Page DOM / JS | `JSWindowActorChild` | Untrusted -> Semi-Trusted | DOM events, text content, attributes. | Content can mount prompt injections; input fields must be sanitized. |
| **2. Content Actor -> Parent Actor** | `JSWindowActorChild` | `JSWindowActorParent` | Semi-Trusted -> Fully Trusted (System) | IPC Messages via `sendAsyncMessage` / `sendQuery`. | **Critical Boundary.** Parent must allowlist and validate all data (as in `ZenGlanceParent.sys.mjs#L21`). |
| **3. Web Content -> Browser Chrome** | Content Process | Parent Process Chrome DOM | Untrusted -> Fully Trusted | Strictly mediated by Fission IPC (`PBrowser`). Direct DOM access is blocked. | Protects native Zen UI from being hijacked by malicious web page scripts. |
| **4. Extension -> Content DOM** | WebExtension Content Script | Page DOM | Isolated World -> Page World | DOM queries, synthetic events. | Cannot read JS variables of page directly, but shares the same DOM tree. |
| **5. Extension -> Parent Process** | WebExtension Background | Browser Chrome | Semi-Trusted -> System | Only predefined WebExtension APIs. | Cannot execute arbitrary chrome functions or access internal Zen globals. |
| **6. Browser -> External Sidecar** | Parent Process / BiDi | Out-of-Process Agent Runtime | Fully Trusted <-> External Trust | WebSocket or Native Messaging JSON payloads. | If socket is exposed on 0.0.0.0, external attackers could control browser. Must bind to localhost with auth tokens. |
| **7. Cross-Origin Frame Isolation** | Content Process A (`origin A`) | Content Process B (`origin B`) | Untrusted <-> Untrusted | Blocked by Fission Site Isolation. | **Agent must not act as a confused deputy** bridging data from Frame B into Frame A. |

---

## 11. Candidate Integration Boundaries Evaluation

We evaluate 8 candidate attachment points for embedding or interfacing the Agent Runtime with Zen Browser:

```
+---------------------------------------------------------------------------------------------------+
| CANDIDATE INTEGRATION ARCHITECTURES                                                              |
|                                                                                                   |
|  [Candidate A: Pure WebExtension]                                                                 |
|  Extension UI ---> WebExtension API ---> Content Script ---> DOM                                   |
|  (Constrained by extension sandbox; no chrome access; cannot access cross-origin frames)          |
|                                                                                                   |
|  [Candidate C/D: Native Zen JSWindowActor Subsystem]                                              |
|  Zen Chrome Window <---> JSWindowActorParent <=== IPC ===> JSWindowActorChild <---> Content DOM    |
|  (In-process, zero-socket overhead, direct access to gBrowser and workspaces; high maintainability)|
|                                                                                                   |
|  [Candidate F: WebDriver BiDi Automation Host]                                                    |
|  External Agent Runtime <=== WebSocket (BiDi) ===> Mozilla Remote Agent (Parent Process)          |
|  (Clean standards boundary; language agnostic; slightly higher latency; pristine upstream)        |
|                                                                                                   |
|  [Candidate I: Hybrid Sidecar Architecture (Recommended for Review)]                              |
|  +---------------------------+       Native Local IPC       +----------------------------------+  |
|  | Zen Browser (Parent Proc) | <==========================> | External Agent Runtime (Sidecar) |  |
|  | - Custom Zen Agent Actor  |   (Named Pipe / Domain Sock) | - LLM Gateway & ReAct Engine      |  |
|  | - SOM Page Extractor      |                              | - MCP Tool Manager & Memory      |  |
|  | - Native Trusted Path UI  |                              | - Policy & Sandbox Engine        |  |
|  +---------------------------+                              +----------------------------------+  |
+---------------------------------------------------------------------------------------------------+
```

### Comparative Evaluation Matrix

| Architecture Option | Capabilities | Privileges | Latency Considerations | Security Implications | Upstream Merge / Rebase Risk | Suitability for Millions of Users | Local & Cloud Scalability |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **A. Pure WebExtension** | Restricted to standard extension APIs. Cannot control workspaces or native UI. | Extension Principal (Restricted). | Moderate (Extension message passing). | Secure sandbox, but cannot enforce engine-level password redaction. | **Very Low** (External to browser tree). | Poor for deep agentic browser workflows. | Local only. |
| **B. Browser Chrome JS (XPCOM Module)** | Unrestricted browser control; access to `gBrowser`, `gZenWorkspaces`. | System Principal (Unrestricted). | Lowest (Runs in-process on main thread). | High: Any crash or infinite loop freezes the entire browser UI. | **Medium** (Registered via `ZenComponents.manifest`). | Poor if heavy AI logic runs on browser UI thread. | Local only. |
| **C. JSWindowActor Subsystem** | Direct DOM access in content; native event interception; structured parent messaging. | Child: Content; Parent: System. | Extremely low (Native Gecko IPC). | Clean separation; requires strict allowlisting in Parent Actor. | **Low** (Uses standard `ActorManagerParent` API). | **Excellent** for perception and actuation engine. | Local execution. |
| **E. Native Messaging Bridge** | WebExtension connected via stdio to external daemon. | Split: Extension + OS User. | High (JSON serialization over stdio pipes). | Good process isolation; limited by WebExtension capabilities. | **Low**. | Moderate; complex multi-component installation. | Good local isolation. |
| **F. WebDriver BiDi** | Standards-based navigation, input emulation, script evaluation, network interception. | Debugger privileges over WebSocket. | Moderate (WebSocket JSON-RPC serialization). | Secure if localhost-only; risk if debugging port is exposed. | **Zero** (Inherited unmodified from Firefox `remote/`). | **Excellent** for automation stability. | Superb for both local and headless cloud instances. |
| **H. External Sidecar Process** | Heavy AI runtime (Python/Rust), LLM gateway, MCP clients, vector memory. | OS User space. | Dependent on IPC transport (0.5–2ms on local sockets). | High safety: Agent runtime crash never crashes the browser. | **Zero** (Completely decoupled from browser). | **Superior** for production stability. | Seamless transition to cloud execution. |
| **I. Hybrid Sidecar (Actors + BiDi + Sidecar)** | Native SOM extraction and UI via **Actors**; automation via **BiDi**; cognitive loop in **Sidecar**. | Layered least-privilege. | Optimal: Fast DOM extraction in content, decoupled LLM reasoning. | Defense-in-depth: Hardware process isolation between AI and Browser. | **Minimal** (Zen custom directory + external daemon). | **Highest Production Grade**. | Unified local desktop and cloud worker support. |

---

## 12. Upstream Maintenance Analysis

Maintaining a long-lived fork of Zen Browser (which is itself a fork of Firefox) requires minimizing "patch collision surface":

### 12.1 Patch Collision Surface in Zen
- Zen maintains **256 patch files** in `src/`.
- **High-Risk Conflict Hotspots:**
  - `src/browser/base/content/browser.js` (patched 5 times).
  - `src/browser/base/content/browser.xhtml` (patched for layout and script includes).
  - `src/browser/base/content/browser-init.js` (startup timing hooks).
  - Every time Firefox upstream refactors `browser.js` or `tabbrowser.js`, Zen's patch recalculation scripts (`scripts/recalculate-patches.sh`) must re-resolve diffs.
- **Low-Risk / Isolated Safe Zones:**
  - `src/zen/`: Completely isolated directory. Upstream Firefox updates **never** overwrite files in `src/zen/`.
  - Component Manifests: Adding custom categories (`browser-before-ui-startup`, `app-startup`) in `ZenComponents.manifest` does not touch Firefox core code.
  - Actor Registrations: Adding custom actors in `src/zen/common/sys/ZenActorsManager.sys.mjs` is completely modular.
- **Architectural Recommendation for Maintenance:**
  Any Agent Integration Layer built directly into Zen must reside **entirely inside a self-contained directory** (e.g., `src/zen/agent/`), registering its actors and XPCOM hooks via its own manifest, without adding new patches to `src/browser/base/content/`.

---

## 13. Agent-Specific Browser Capabilities Required

Based strictly on source code inspection of Zen Browser, the following concrete browser capabilities must be exposed to the Agent Integration Layer:

1. **Workspace & Tab Lifecycle Control:**
   - Programmatic tab queries filtered by workspace: `gZenWorkspaces.getWorkspaces()`, `gBrowser.visibleTabs`.
   - Creating tabs in specific workspaces and containers: `gBrowser.addTab(url, { userContextId, ... })`.
   - Switching workspaces: `gZenWorkspaces.switchToWorkspace(workspaceId)`.
2. **Deterministic Semantic DOM Perception (In-Process SOM Extraction):**
   - Must run inside a `JSWindowActorChild` in the Content Process to crawl the live DOM and generate the Semantic Object Model (SOM) without serializing full HTML strings across IPC.
   - Must filter out hidden elements, script tags, and presentational nodes, attaching deterministic semantic IDs.
3. **Engine-Level Sensitive Field Redaction:**
   - The content actor must inspect element attributes (`type="password"`, `autocomplete="cc-number"`, `aria-hidden="true"`) and redact input values **before** data is sent across IPC to the Agent Runtime.
4. **Synthetic Native Input Dispatch:**
   - Must utilize either Gecko's native event synthesizers (`EventUtils.js` / `nsIDOMWindowUtils`) or WebDriver BiDi's `input.performActions` to dispatch trusted, hardware-level mouse clicks, keystrokes, and scroll events.
5. **Trusted Path Human Confirmation UI:**
   - Must leverage Zen's native window chrome to render unforgeable modal dialogues (using `gZenUIManager` or custom XUL subdialogs via `gDialogBox`) outside the reach of web page content.

---

## 14. Facts vs Inferences vs Unknowns

| Technical Dimension | Verified Fact (Observed in Zen Source) | Architectural Inference (Logical Derivation) | Unknown (Requires Empirical Testing) |
| :--- | :--- | :--- | :--- |
| **Firefox Upstream Base** | Zen is built on Firefox `156.0.1` candidate 1, orchestrated via `@zen-browser/surfer` (`surfer.json#L7-L11`). | Engine updates can be tracked automatically via `scripts/update_ff.py`. | Exact compilation time and PGO overhead on modern developer workstations. |
| **Zen Core Directory** | Zen features live in `src/zen/`, grafted via `DIRS += ["../../zen"]` in `src/browser/base/moz.build`. | Agent code can be placed inside `src/zen/agent/` with zero patch conflict with Firefox. | Whether Mozilla's `mach` build handles Rust/C++ submodules cleanly inside `src/zen/`. |
| **IPC Architecture** | Zen registers custom actors (`ZenGlance`, `ZenWindowDrag`) in `ZenActorsManager.sys.mjs`. | A dedicated `ZenAgentActor` can be registered using the identical mechanism. | Latency of streaming large SOM snapshots over `JSWindowActor` IPC. |
| **WebDriver BiDi / Remote**| Zen leaves Firefox's `remote/` subsystem 100% untouched. No patches exist for `remote/`. | Standard WebDriver BiDi automation clients can control Zen out-of-the-box. | Whether BiDi sessions interfere with Zen Workspace tab visibility rules. |
| **Site Isolation / Fission**| Zen inherits Fission site isolation; cross-origin frames run in OOP content processes. | Content processes are untrusted; parent process actors must validate all child messages. | Memory overhead per active tab when running 50+ concurrent background agent tabs. |
| **WebExtensions** | Zen patches `ext-tabs.js` to mask empty tabs (`zen-empty-tab`) from extension APIs. | Extensions alone cannot reliably manage Zen's workspace layout. | Extension manifest v3 support status in Zen's Firefox base. |
| **Preferences Pipeline** | Preferences are authored in `prefs/zen/*.yaml` and converted via `tools/ffprefs` (Rust). | Agent-specific configuration flags can be cleanly declared in `prefs/zen/agent.yaml`. | Whether dynamic pref updates notify content actors synchronously. |

---

## 15. Critical Questions Remaining

1. **Compilation Environment Requirements:** What is the exact setup time and storage footprint required to execute a full `surfer download && surfer build` on the host development machine?
2. **Actor vs BiDi Throughput:** What is the throughput and memory delta between extracting a 3,000-token SOM via an in-engine `JSWindowActor` versus pulling the accessibility tree over a WebDriver BiDi WebSocket connection?
3. **Container Context Dynamic Switching:** How does `ZenSpaceManager` react when an external process dynamically creates or destroys `userContextId` containers at runtime?
4. **Sidecar IPC Protocol:** If the Agent Runtime is an external daemon, what IPC protocol provides the highest security and lowest latency on Windows/macOS/Linux? (e.g., Local Named Pipes, Unix Domain Sockets, or loopback WebSockets with Bearer tokens).

---

## 16. Recommended Next Investigation

> **CRITICAL NEXT STEP (Phase 0.2):**  
> **Benchmark and Prototype the Browser Perception & Actuation Boundary.**
>
> Specifically:
> 1. Determine the exact IPC performance and message limits of `JSWindowActor` vs WebDriver BiDi for streaming structured DOM/Accessibility snapshots on complex web pages.
> 2. Implement a minimal, standalone prototype of the **Semantic Object Model (SOM) extraction algorithm** to measure real-world token compression against modern dynamic single-page applications.
> 3. Verify the exact startup and socket connection behavior of Zen with `--remote-debugging-port`.
>
> *No production agent implementation or final architectural selection should occur until this empirical perception benchmark is completed.*
