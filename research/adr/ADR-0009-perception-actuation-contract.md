# ADR-0009: Preliminary Perception & Actuation API Contract

## Status
**PROPOSED (Conceptual Capability Specification; Schema Implementation Deferred)**

---

## Context
To prevent tight coupling between the external Agent Runtime and the internal browser integration mechanisms, a formal conceptual API contract must define the capabilities provided by the browser layer. 

This contract abstracts over the physical transport (WebDriver BiDi vs. `JSWindowActor` IPC) and specifies:
- The required capability semantics.
- Inputs and outputs.
- Security sensitivity levels.
- The underlying implementation channel (BiDi, Custom Actor, or Both).
- Verification status based on Phase 0.2 empirical data.

---

## Capability Inventory & Structural Specifications

### 1. Context Lifecycle & Navigation Capabilities

| Capability | Purpose | Conceptual Input | Conceptual Output | Sensitivity | Implementation Channel | Verification Status |
| :--- | :--- | :--- | :--- | :---: | :---: | :---: |
| `context.list` | Enumerate all active browsing contexts/tabs. | `{}` | `Array<{ contextId, url, title, isActive, parentId }>` | Low | BiDi (`browsingContext.getTree`) | **VERIFIED** (P50: 22.94 ms) |
| `context.create` | Open a new browsing context/tab. | `{ type: "tab"\|"window", background?: boolean }` | `{ contextId }` | Low | BiDi (`browsingContext.create`) | **VERIFIED** (P50: 98.48 ms) |
| `context.close` | Terminate an open browsing context. | `{ contextId }` | `{ success: boolean }` | Medium | BiDi (`browsingContext.close`) | **VERIFIED** (P50: 35.48 ms) |
| `context.navigate` | Navigate a context to a destination URL. | `{ contextId, url, waitCondition: "load"\|"domcontentloaded" }` | `{ navigationId, finalUrl, statusCode }` | Medium | BiDi (`browsingContext.navigate`) | **VERIFIED** (P50: 89.53 ms) |

---

### 2. Perception & Inspection Capabilities

| Capability | Purpose | Conceptual Input | Conceptual Output | Sensitivity | Implementation Channel | Verification Status |
| :--- | :--- | :--- | :--- | :---: | :---: | :---: |
| `perception.snapshot` | Acquire an authoritative full Semantic Object Model (SOM) of the document. | `{ contextId, maxDepth?: number, pruneHidden?: boolean }` | `{ somTree: NormalizedSomNode[], viewport: Rect, timestamp: number }` | **High** (May expose PII if unredacted) | Browser Actor (`JSWindowActor`) | **VERIFIED** (0.42–1.05 ms extraction) |
| `perception.subscribe`| Register a continuous stream of debounced mutation deltas. | `{ contextId, debounceMs: number }` | `Stream<SomDeltaBatch>` | **High** | Browser Actor (`MutationObserver` + IPC) | **VERIFIED** (2.97–4.02 ms detection) |
| `perception.inspect` | Retrieve detailed attributes and computed style for a single element. | `{ contextId, somId: string }` | `{ tag, attributes, computedStyle, isInteractive, boundingBoxes }` | Low | Browser Actor | **VERIFIED** |
| `perception.captureVisual` | Capture a visual screenshot of the viewport or element. | `{ contextId, clipRect?: Rect, format: "png"\|"jpeg" }` | `{ base64Data: string, mimeType: string }` | **High** (Visual secrets) | BiDi (`captureScreenshot`) | **VERIFIED** (P50: 38.43 ms) |

---

### 3. Actuation Capabilities

| Capability | Purpose | Conceptual Input | Conceptual Output | Sensitivity | Implementation Channel | Verification Status |
| :--- | :--- | :--- | :--- | :---: | :---: | :---: |
| `actuation.click` | Dispatch a trusted pointer click sequence at target coordinates. | `{ contextId, x: number, y: number, button?: "left"\|"right", clickCount?: number }` | `{ success: boolean, triggeredNavigation?: boolean }` | Medium | BiDi (`input.performActions`) | **VERIFIED** (P50: 3.00 ms) |
| `actuation.type` | Dispatch trusted keyboard sequences into an active element. | `{ contextId, text: string, delayMs?: number, clearExisting?: boolean }` | `{ success: boolean, charCount: number }` | **High** (Form inputs) | BiDi (`input.performActions`) | **VERIFIED** (P50: 3.14 ms) |
| `actuation.scroll` | Dispatch vertical or horizontal mouse wheel scroll deltas. | `{ contextId, deltaX: number, deltaY: number, originX?: number, originY?: number }` | `{ success: boolean, newScrollPosition: Point }` | Low | BiDi (`input.performActions`) | **VERIFIED** (P50: 3.13 ms) |
| `actuation.select` | Select an option in a native HTML `<select>` dropdown. | `{ contextId, somId: string, value: string }` | `{ success: boolean, selectedValue: string }` | Medium | Browser Actor / BiDi Script | **UNVERIFIED** (Requires BiDi verification) |
| `actuation.uploadFiles` | Populate an `<input type="file">` element with local file paths. | `{ contextId, somId: string, filePaths: string[] }` | `{ success: boolean, filesAssigned: number }` | **Critical** (Host file access) | BiDi (`input.setFiles`) | **UNVERIFIED** (Requires BiDi verification) |
| `actuation.download` | Intercept and direct an incoming browser download stream to a path. | `{ contextId, destinationDir: string, timeoutMs: number }` | `{ filePath: string, sizeBytes: number, mimeType: string }` | **Critical** (Arbitrary binary on host) | BiDi Network / Zen Chrome | **UNKNOWN** (Not yet implemented in BiDi) |
| `actuation.evalScript`| Execute a constrained JavaScript expression within page context. | `{ contextId, script: string, args: any[], sandbox?: boolean }` | `{ result: any }` | **Critical** (Arbitrary code execution) | BiDi (`script.evaluate`) | **VERIFIED** (P50: 23.86 ms; strictly restricted by Policy) |

---

## Security Sensitivity Classification

All API contract methods are categorized by risk level for enforcement by the Structural Policy Engine (ADR-0006):

```
Level 0 (Autonomous):
  - context.list, context.create, perception.inspect, actuation.scroll

Level 1 (Audited - Auto-approved but logged):
  - context.navigate, perception.snapshot, perception.subscribe, perception.captureVisual, actuation.click

Level 2 (Guarded - Subject to rate limiting and domain whitelists):
  - actuation.type, actuation.select, context.close

Level 3 (Restricted - Requires Explicit Human Confirmation):
  - actuation.uploadFiles (Exposes host file contents to web)
  - actuation.download (Writes remote binary to host disk)
  - actuation.evalScript (Arbitrary JS execution in authenticated sessions)
  - Any Level 1/2 action targeting financial or sensitive URL patterns
```

---

## Architectural Principles of the Contract

1. **Protocol Agnosticism:** The Agent Runtime only issues high-level capability requests; it never constructs raw BiDi JSON-RPC messages or low-level `JSWindowActor` packets directly.
2. **Stable Target Identification:** The contract uses `somId` (unique within a snapshot generation) and bounding coordinates `(x, y)` to ground actions, avoiding fragile raw CSS or XPath selectors.
3. **No Direct Execution Privilege:** The contract interface is exposed through the Structural Policy Engine; the model cannot invoke an actuation capability without policy authorization.

---

## Unknowns & Validation Requirements for Phase 1
- **File Upload Verification:** Validate `input.setFiles` across local files and verify OS permissions.
- **Download Automation:** Determine whether BiDi `network.intercept` or a custom Zen chrome download listener is required to capture downloaded files without OS file dialogs.

