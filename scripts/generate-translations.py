"""Build compact CEFR translations from a pinned, MIT-licensed ECDICT CSV."""
import argparse
import csv
import json
import re
import subprocess
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "extension/data"
COMMIT = "bc015ed2e24a7abef49fc6dbbb7fe32c1dadaf8b"


def meanings(value):
    senses = []
    lines = value.replace(r"\r", "").replace(r"\n", "\n").splitlines()
    ordinary = [line for line in lines if "[" not in line and re.search(r"[\u4e00-\u9fff]", line)]
    for line in ordinary or lines:
        line = re.sub(r"^(?:[a-z]+\.\s*)+", "", line.strip())
        line = re.sub(r"\[[^]]*\]\s*", "", line)
        if not re.search(r"[\u4e00-\u9fff]", line):
            continue
        for sense in re.split(r"[,，;；]", line):
            sense = sense.strip()
            if sense and sense not in senses:
                senses.append(sense)
    return "；".join(senses[:3])[:60]


def generate(source):
    words = json.loads((DATA / "cefr.json").read_text())
    result, exact = {}, set()
    with Path(source).open(encoding="utf-8-sig", newline="") as stream:
        for row in csv.DictReader(stream):
            term = row["word"].strip().lower()
            if term not in words or term in exact:
                continue
            translation = meanings(row["translation"])
            if translation:
                result[term] = translation
                if row["word"] == term:
                    exact.add(term)
    corrections = json.loads((DATA / "translation-notes.json").read_text())
    for term, entry in corrections.items():
        result[term] = entry["translation"]
    missing = sorted(set(words) - result.keys())
    if missing:
        raise ValueError(f"Missing translations: {missing}")
    (DATA / "translations.json").write_text(json.dumps(dict(sorted(result.items())), ensure_ascii=False, separators=(",", ":")) + "\n")
    print(f"Generated {len(result)} entries, including {len(corrections)} documented supplements/corrections.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", help="Existing ECDICT CSV; otherwise download the pinned source")
    args = parser.parse_args()
    if args.source:
        generate(args.source)
    else:
        with tempfile.TemporaryDirectory(prefix="lexitrail-dictionary-") as directory:
            source = Path(directory) / "ecdict.csv"
            subprocess.run(["curl", "-fsSL", "--max-time", "180", f"https://raw.githubusercontent.com/skywind3000/ECDICT/{COMMIT}/ecdict.csv", "-o", str(source)], check=True)
            generate(source)
