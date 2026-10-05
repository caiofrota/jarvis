## Engineering handbook

This project adopts `caio-engineering-handbook/v1`. The global Codex guidance resolves its
canonical checkout; this repository does not contain a handbook copy.

Before implementing, reviewing, or maintaining software:

1. Read `.engineering-handbook.yaml` when present for active profiles and local context paths.
2. Follow the global handbook's selective retrieval procedure.
3. Load only matching skill descriptions, standards, required dependencies, and
   applicable local overlays. Never read the handbook recursively.

Explicit scoped project decisions and exceptions override a referenced handbook
default. Silence does not. Do not change the handbook as part of unrelated feature work, and do not
copy handbook rules or skill bodies into this repository.
