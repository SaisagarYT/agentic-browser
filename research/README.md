# Research Documentation

- [Phase 0 Research Report](phase0_research_report.md): Engineering foundations, research baseline, and threat modeling.
- [Phase 0.1 Zen Browser Source Audit](phase0.1_zen_source_audit.md): Deep architectural and source code audit of the official Zen Browser desktop repository.

- [Phase 0.2 Empirical Perception & Actuation Benchmark](phase0.2_perception_actuation_benchmark.md): Empirical benchmark measuring WebDriver BiDi latencies, JSWindowActor IPC throughput, SOM token compression, and actuation latencies.
- [Phase 0.2 Benchmark Data & Reproducibility Suite](benchmarks/phase0.2/README.md): Reproducible test runner, 12 test pages, and machine-readable JSON/CSV dataset.
- [Phase 0.3 Architecture Decision Summary](phase0.3_architecture_decision_summary.md): Comprehensive governance report, decision matrix, principles, and required Phase 1 experiments.
- [Phase 0.3 Experiment 1 Report: LLM Perception Representation & Action Grounding](phase0.3_experiment1_perception_grounding.md): Empirical benchmark measuring token consumption, serialization latencies, fidelity, security leakage, and action grounding accuracy across 6 representations and 180 trials.
- [Phase 0.3 Experiment 1 Benchmark Suite & Data](benchmarks/phase0.3-experiment1/README.md): Reproducible test runner, 12 test pages, 30 ground truth tasks, and complete JSON/CSV dataset.
- [Phase 0.3 Experiment 2 Report: Zen Workspace & Split-View BiDi Mapping](phase0.3_experiment2_zen_workspace_bidi.md): Empirical report mapping Zen Workspaces, Tabs, and Split Views to WebDriver BiDi.
- [Phase 0.3 Experiment 2 Benchmark Suite & Data](benchmarks/phase0.3-experiment2/README.md): Reproducible test runner and JSON/CSV dataset for Experiment 2.
- [Architectural Decision Records (ADRs)](adr/):

  - [ADR-0001: Browser Control Plane Interface](adr/ADR-0001-browser-control-plane.md) (Accepted)
  - [ADR-0002: In-Process Semantic Perception via JSWindowActor](adr/ADR-0002-in-process-perception.md) (Accepted)
  - [ADR-0003: Perception Wire Representation & Schema Strategy](adr/ADR-0003-perception-representation.md) (Revised - Ready for Approval)
  - [ADR-0004: Perception Update Strategy — Full Snapshot vs Incremental Streaming](adr/ADR-0004-incremental-perception.md) (Accepted)
  - [ADR-0005: Agent Runtime Process Boundary & Host Architecture](adr/ADR-0005-agent-runtime-boundary.md) (Accepted)
  - [ADR-0006: Security Architecture & Structural Trust Boundaries](adr/ADR-0006-security-trust-boundary.md) (Accepted)
  - [ADR-0007: Zen Browser Integration Strategy & Upstream Maintenance Debt](adr/ADR-0007-zen-integration-strategy.md) (Accepted)
  - [ADR-0008: Zen Workspace, Tab, and Window Structural Model](adr/ADR-0008-workspace-tab-window-model.md) (Deferred)
  - [ADR-0009: Preliminary Perception & Actuation API Contract](adr/ADR-0009-perception-actuation-contract.md) (Proposed)
  - [ADR-0010: Failure Taxonomy, Degradation Modes, and Recovery Architecture](adr/ADR-0010-failure-recovery-model.md) (Accepted)

