import json

m = json.load(open("research/benchmarks/phase0.3-experiment1/data/representation_metrics.json", encoding="utf-8"))

totals = {}
page_counts = len(m)

for pid, pdata in m.items():
    for rep, rdata in pdata["representations"].items():
        if rep not in totals:
            totals[rep] = {"bytes": 0, "tok_o200k": 0, "tok_cl100k": 0, "ser_ms": 0}
        totals[rep]["bytes"] += rdata["bytes"]
        totals[rep]["tok_o200k"] += rdata["tokens_o200k"]
        totals[rep]["tok_cl100k"] += rdata["tokens_cl100k"]
        totals[rep]["ser_ms"] += rdata["ser_time_ms"]

raw_tok = totals["A_raw_html"]["tok_o200k"]
print(f"Aggregates across all {page_counts} benchmark pages:")
print("-" * 90)
print(f"{'Representation':16s} | {'Bytes':8s} | {'o200k Tokens':12s} | {'Ratio':6s} | {'Reduction':10s} | {'cl100k':8s} | {'Ser (ms)':8s}")
print("-" * 90)
for rep, t in totals.items():
    ratio = round(t["tok_o200k"] / raw_tok, 3)
    red = round((1.0 - ratio) * 100.0, 2)
    print(f"{rep:16s} | {t['bytes']:8d} | {t['tok_o200k']:12d} | {ratio:6.2f} | {red:9.2f}% | {t['tok_cl100k']:8d} | {t['ser_ms']:8.2f}")
print("-" * 90)

print("\nPer-page details:")
for pid, pdata in m.items():
    raw_p_tok = pdata["representations"]["A_raw_html"]["tokens_o200k"]
    print(f"\n{pid} (Nodes: {pdata['node_count']}, Raw HTML Bytes: {pdata['raw_html_bytes']}, Raw Tokens: {raw_p_tok}):")
    for rep, rdata in pdata["representations"].items():
        print(f"  {rep:16s}: Bytes={rdata['bytes']:6d}, o200k={rdata['tokens_o200k']:5d} (Ratio: {rdata['comp_ratio_vs_html_o200k']:5.2f}, Red: {rdata['comp_reduction_pct_o200k']:6.1f}%), Ser={rdata['ser_time_ms']:.3f}ms")
