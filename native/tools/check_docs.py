"""Check repository-relative file links in the native operational documentation."""

import re
from pathlib import Path

root = Path(__file__).resolve().parents[1]
files = [root / "README.md", root / "THIRD_PARTY.md", *sorted((root / "docs").glob("*.md"))]
errors = []
for path in files:
    for target in re.findall(r"\[[^\]]+\]\(([^)]+)\)", path.read_text()):
        if "://" in target or target.startswith(("#", "mailto:")):
            continue
        target = target.split("#")[0]
        if not (path.parent / target).exists():
            errors.append(f"{path.relative_to(root)}: missing {target}")
if errors:
    raise SystemExit("\n".join(errors))
print(f"Checked internal file links in {len(files)} documents.")
