"""Create the offline English headword index from the pinned, attributed CSVs."""
import csv
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"]
words = {}
for filename in ["cefrj.csv", "octanove.csv"]:
    with (ROOT / "extension/data" / filename).open(encoding="utf-8-sig", newline="") as source:
        for row in csv.DictReader(source):
            level = row["CEFR"][:2]
            if level not in LEVELS:
                continue
            for value in row["headword"].split("/"):
                term = value.strip().lower().replace("’", "'")
                if not re.fullmatch(r"[a-z]+(?:['-][a-z]+)*", term):
                    continue
                old = words.get(term)
                if old is None or LEVELS.index(level) < LEVELS.index(old):
                    words[term] = level
target = ROOT / "extension/data/cefr.json"
target.write_text(json.dumps(dict(sorted(words.items())), ensure_ascii=False, separators=(",", ":")) + "\n")
print(f"Generated {len(words)} headwords: " + ", ".join(f"{level}={sum(v == level for v in words.values())}" for level in LEVELS))
