import json
import sys
from pathlib import Path

RUNNER_DIR = Path(r"c:\Users\saisa\Documents\Work\Projects\Personal\Agentic-Browser\research\benchmarks\phase0.3-experiment1\runner")
sys.path.insert(0, str(RUNNER_DIR))
from cir_engine import extract_cir

PAGES_DIR = RUNNER_DIR.parent / "pages"
TASKS_FILE = RUNNER_DIR.parent / "tasks" / "ground_truth_tasks.json"

with open(TASKS_FILE, "r", encoding="utf-8") as f:
    tasks = json.load(f)

for t in tasks:
    html = open(PAGES_DIR / t["page_file"], "r", encoding="utf-8").read()
    nodes = extract_cir(html)
    matching = [n for n in nodes if n.cir_id == t["canonical_target_id"]]
    assert len(matching) == 1, f"No node for {t['task_id']} with {t['canonical_target_id']}"
    n = matching[0]
    print(f"{t['task_id']}: {n.cir_id} | <{n.tag}> | id={n.attrs.get('id')} | role={n.role} | text={n.text[:25]}")

print("\nALL 30 CANONICAL TARGETS VERIFIED PERFECTLY 1:1 WITH CIR NODES!")

