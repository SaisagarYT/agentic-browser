# ADR-0003: Perception Wire Representation & Schema Strategy

## Status
**DEFERRED (Empirical Evidence Confirms Compression Paradox; Comparative LLM Representation Benchmark Required)**

---

## Context
An agentic browser must provide its underlying LLM/reasoning model with a faithful, token-efficient, and structured representation of the webpage. This representation informs the agent's action planning (which element to click, where to enter text, what content was generated).

In Phase 0.2, an empirical benchmark of a prototype Semantic Object Model (SOM) was conducted across 12 distinct deterministic web page topologies (Pages A–L). This benchmark revealed the **"Compression Paradox"**:
- **On noisy, deeply nested layouts with redundant layout wrappers (Page L - Deep DOM Soup):** SOM extraction achieved an **86.95% token reduction (7.67x compression)**, slashing tokens from 4,591 down to 599.
- **On semantic text, clean tables, and forms (Pages A, D, F, I, J):** Serializing the filtered elements as standard JSON (`{"somId": ..., "role": ..., "tag": ...}`) **increased token count by 20% to 101%** compared to the raw HTML markup.

Prematurely freezing the perception wire format to naive JSON or an untested custom format would severely degrade agent reasoning performance, inflate API token consumption, and risk context exhaustion.

---

## Architectural Claims & Evidence Classification

| Dimension | Finding | Classification | Supporting Evidence |
| :--- | :--- | :---: | :--- |
| **Deep DOM Compression** | Filtering invisible nodes and collapsing non-semantic `div`/`span` wrappers compresses noisy DOMs by up to 7.67x (86.95% reduction). | `MEASURED` | Phase 0.2 benchmark on Page L (`dom_som_compression.json`). |
| **Naive JSON Overhead** | Repeating JSON syntax keys (`somId`, `role`, `tag`, `name`, `bbox`, `interactive`) inflates token count on structured tables by 76.31% and dynamic buttons by 101.42%. | `MEASURED` | Phase 0.2 benchmark on Page F and Page J (`dom_som_compression.json`). |
| **In-Process Parsing Speed** | In-process extraction time across all 12 benchmark pages remained between 0.42 ms and 1.05 ms regardless of layout complexity. | `MEASURED` | Phase 0.2 benchmark (`dom_som_compression.json`). |
| **LLM Reasoning Impact** | Different LLM tokenizers (BPE, WordPiece, SentencePiece) penalize punctuation, brackets, and whitespace differently; compact columnar or tuple representations may reduce tokens but could affect reasoning accuracy. | `INFERRED` | LLM tokenizer literature and Phase 0 research findings. |
| **LLM Attention Fidelity** | Whether modern vision-language models (VLMs) or text-only LLMs perform superior action grounding on flat tuple lists vs. nested indentation trees vs. accessibility trees is unmeasured on Zen. | `UNKNOWN` | Requires dedicated agent evaluation suite (WebArena / Mind2Web baseline). |

---

## Systematic Evaluation of Representation Alternatives

| Criteria | A. Raw / Serialized DOM | B. Text-Oriented (Markdown / Lynx) | C. Accessibility Tree (AXTree / ARIA) | D. Verbose SOM JSON | E. Compact SOM (Indented / Tuples) | F. Hybrid / Adaptive (DOM + AX + Vision) |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| **Semantic Fidelity** | Very High (complete DOM) | Low (loses spatial layout, bounding boxes, state) | High (semantics & roles preserved; spatial layout weak) | High (explicit semantic roles, attributes, geometry) | High (compacted attributes and coordinates) | Highest (combines semantic tree with spatial coordinates) |
| **Token Efficiency** | Very Poor (dominated by CSS, JS, wrapper boilerplate) | High (only text content retained) | Moderate (tree verbosity without pruning) | Poor (penalized by repetitive JSON schema keys) | Very High (minimal punctuation, columnar or indented) | High (tailored per page topology) |
| **Serialization Cost** | Extremely High (megabytes of HTML string) | Low (regex / string extraction) | Moderate (platform accessibility API calls) | Moderate (standard `JSON.stringify`) | Low (custom string builder) | Moderate |
| **Parsing Complexity** | Complex (massive HTML tokenizer required) | Simple (plain text) | Moderate (nested tree traversal) | Simple (standard JSON parser) | Moderate (custom line/tuple parser) | Complex (multi-modal fusion) |
| **Incremental Update Support** | Very Difficult (computing HTML diffs is expensive) | Poor (text diffs lack stable element identifiers) | Moderate (AXNode ID changes across updates) | Excellent (keyed by stable `somId` or DOM path) | Excellent (delta line additions/deletions) | High (delta event streaming) |
| **Agent Usability** | Poor (distracts LLM with presentation code) | Poor for actuation (cannot locate click targets) | Good (clear roles, actions, and states) | Good (structured fields, easy for tool calling) | Excellent (high information density per token) | Excellent |
| **Debuggability** | Good (standard browser inspect) | High (human readable) | Moderate (requires accessibility inspector) | Excellent (standard JSON inspector) | High (human readable compact text) | Moderate |
| **Security / Redaction** | Poor (raw scripts and credentials present in HTML) | Moderate (may leak raw text tokens) | High (accessibility APIs generally exclude passwords) | Very High (redacted in-process before serialization) | Very High (redacted in-process) | Very High |
| **Extensibility** | Poor | Poor | Moderate (constrained by W3C ARIA specs) | High (add arbitrary custom properties) | Moderate (requires schema versioning) | Very High |

---

## Decision
1. **DEFER the final selection of the perception wire representation.** Current empirical evidence confirms the failure of verbose JSON on structured pages, but lacks direct LLM grounding benchmarks comparing compact formats (e.g. YAML vs. TSV/columnar tuples vs. indentation syntax).
2. **Interim Baseline Specification for Phase 1 Prototyping:**
   - The internal in-process perception engine (`JSWindowActorChild`) will maintain an in-memory normalized JavaScript object graph.
   - For wire transmission to the Agent Runtime, an **adaptive serializer interface** will be implemented, allowing runtime selection between:
     - **Mode 1 (Compact Indentation / Tuple Format):** Formatted as `[som_id] role "name" (x, y, w, h) [states]`, minimizing punctuation overhead.
     - **Mode 2 (Structured JSON):** Used strictly for debugging, automated testing, and dataset recording.
3. **Mandatory Benchmark Prerequisite:** Before freezing the production wire format in Phase 1, conduct an empirical tokenization and action-prediction benchmark across GPT-4o, Claude 3.5 Sonnet, and Gemini 1.5/2.0 Flash evaluating grounding accuracy and token consumption across the candidate formats.

---

## Trade-offs & Engineering Costs
- **Pros of Deferral:** Prevents locking the agent architecture into an inefficient wire format that consumes 2x unnecessary LLM tokens or degrades model comprehension.
- **Cons of Deferral:** Requires building the perception engine with an abstraction layer that supports multiple serialization formats during Phase 1.

---

## Security Consequences
- Regardless of serialization format, the security invariant established in ADR-0002 remains non-negotiable: **sanitization and credential zeroing must execute prior to serialization**.
- No format may ever re-introduce raw unredacted input values or raw inline JavaScript event handlers (`onclick=...`) into the agent context.

---

## Validation Requirements for Phase 1
1. Run tokenizer benchmarks (tiktoken, sentencepiece) against identical DOM states formatted as: (a) Raw HTML, (b) Verbose JSON, (c) Indented YAML, (d) Compact Columnar/Tuples.
2. Measure agent grounding accuracy (element selection error rate) on WebArena tasks using each candidate representation.

