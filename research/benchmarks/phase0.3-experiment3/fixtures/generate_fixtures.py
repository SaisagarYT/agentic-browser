import os
import hashlib
from pathlib import Path

FIXTURES_DIR = Path(r"c:\Users\saisa\Documents\Work\Projects\Personal\Agentic-Browser\research\benchmarks\phase0.3-experiment3\fixtures")
FIXTURES_DIR.mkdir(parents=True, exist_ok=True)

fixtures = {}

# 1. upload-small.txt
small_path = FIXTURES_DIR / "upload-small.txt"
small_content = b"Agentic Browser Phase 0.3 Experiment 3 - Synthetic Upload Small File\nTimestamp: 2026-09-24T14:30:00Z\n"
small_path.write_bytes(small_content)
fixtures["upload-small.txt"] = {
    "size": len(small_content),
    "sha256": hashlib.sha256(small_content).hexdigest()
}

# 2. upload-1mb.bin (1,048,576 bytes)
bin1mb_path = FIXTURES_DIR / "upload-1mb.bin"
pattern_1mb = b"AGENTIC_BROWSER_SYNTHETIC_1MB_PAYLOAD_" * 26886 + b"END1MB"
bin1mb_content = pattern_1mb[:1024 * 1024]
bin1mb_path.write_bytes(bin1mb_content)
fixtures["upload-1mb.bin"] = {
    "size": len(bin1mb_content),
    "sha256": hashlib.sha256(bin1mb_content).hexdigest()
}

# 3. upload-10mb.bin (10,485,760 bytes)
bin10mb_path = FIXTURES_DIR / "upload-10mb.bin"
bin10mb_content = (bin1mb_content * 10)[:10 * 1024 * 1024]
bin10mb_path.write_bytes(bin10mb_content)
fixtures["upload-10mb.bin"] = {
    "size": len(bin10mb_content),
    "sha256": hashlib.sha256(bin10mb_content).hexdigest()
}

# 4. upload-multi-a.txt to e.txt
for letter in ["a", "b", "c", "d", "e"]:
    fname = f"upload-multi-{letter}.txt"
    fpath = FIXTURES_DIR / fname
    content = f"Synthetic multi-file test fixture {letter.upper()} for Agentic Browser Experiment 3.\nDeterministic token: SEQ-{letter.upper()}-99281\n".encode("utf-8")
    fpath.write_bytes(content)
    fixtures[fname] = {
        "size": len(content),
        "sha256": hashlib.sha256(content).hexdigest()
    }

print("Generated fixtures:")
for name, meta in fixtures.items():
    print(f"  {name:18s}: {meta['size']:8d} bytes | SHA256: {meta['sha256'][:16]}...")

