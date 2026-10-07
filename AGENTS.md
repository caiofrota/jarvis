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

## Project-specific behavior constraints

Speech recognition, synthesis, conversation, and actions must solve problems generically.
Do not accumulate product-name dictionaries, transcript replacement rules, phonetic spellings,
or intent handlers tailored to individual reported phrases. Fix the responsible engine or
integration boundary; use bounded runtime context from authoritative sources (for example,
installed application names and the current persisted task list).

Application identity comes from the operating system, not from a list of known products.
The model may interpret intent, but only the executor can confirm availability or an effect.
Task existence and completion must be read or saved before confirmation, never inferred solely
from conversation history. Uncertain names and ambiguous requests require clarification, not
automatic substitution or execution.

Regression tests may reproduce specific reports, but must also cover unfamiliar names and
adjacent cases to demonstrate that the implementation generalizes. Do not describe decoder hints
or pronunciation changes as proven improvements without real audio validation. Any necessary
exception requires an explicit project decision with its limitation and removal condition.

## Shared brain and robot endpoints

Read `docs/engineering/rosie-context.md` and `docs/engineering/decisions.md` for imported
server boundaries. Before native firmware or installation changes, read
`native/docs/architecture.md` and `native/docs/validation.md`. Private credentials,
catalogs, databases, recordings, model weights and compiled firmware are not source
artifacts. Native GPL notices remain applicable; do not replace them with the root MIT license.
