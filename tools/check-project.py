"""Validate project document links and browser/server import boundaries."""

import re
from pathlib import Path

root = Path(__file__).resolve().parents[1]
documents = [
    root / "README.md",
    root / "CONTRIBUTING.md",
    root / "CHANGELOG.md",
    root / "AGENTS.md",
    *sorted((root / "docs/engineering").glob("*.md")),
]
errors = []
for path in documents:
    for target in re.findall(r"\[[^\]]+\]\(([^)]+)\)", path.read_text()):
        if "://" in target or target.startswith(("#", "mailto:")):
            continue
        target = target.split("#")[0]
        if not (path.parent / target).exists():
            errors.append(f"{path.relative_to(root)}: missing link {target}")
for folder in ["components", "features"]:
    for path in (root / "apps/web/src" / folder).rglob("*.tsx"):
        if re.search(r'from ["\'][^"\']*(?:@rosie/db|/server/)', path.read_text()):
            errors.append(f"{path.relative_to(root)}: browser imports a private server module")
if errors:
    raise SystemExit("\n".join(errors))
print(f"Checked {len(documents)} project documents and browser import boundaries")
