# Rosie model study — 2026-09-25

## Recommendation

Keep the installed `gpt-4o-mini` model. The measured alternatives did not justify
changing production: GPT-4.1 nano is retiring, GPT-4.1 mini and GPT-5.6 Luna cost
more in this workload, and GPT-6 Luna repeatedly selected an inappropriate
household-control tool. This is a small application-specific evaluation, not a
general ranking of these models.

The active database identifies Rosie's conversation model as `gpt-4o-mini`, with
a 300-token output limit and four retained history turns. It is not currently
using GPT-4.1 nano. No production model, prompt, service, firmware or household
automation was changed during the study.

## Lifecycle and account access

As checked on September 25, 2026, OpenAI lists October 23, 2026 as the API shutdown
date for `gpt-4.1-nano` and its April 2025 snapshot, with `gpt-5.6-luna` as the
replacement. No shutdown date is announced there for the text `gpt-4o-mini`
model. Deprecations of similarly named transcription, audio, realtime and search
variants do not retire this text model.
See the [official deprecation table](https://developers.openai.com/api/docs/deprecations)
and [GPT-4o mini model page](https://developers.openai.com/api/docs/models/gpt-4o-mini).

The installation's existing API account listed all five candidates, and each
returned inference responses during the evaluation. Continued availability and
future pricing must be checked again before a later migration.

## Method and limits

The private harness reused `apps/web/src/server/conversation/service.ts` and a
cloned production catalog, preserving the identity, intents, device names,
response schema and output limit. Only the cloned assistant's model changed.
For the two Luna candidates, an evaluation-only request adapter also replaced
`max_tokens` with `max_completion_tokens` and selected `reasoning_effort: none`.

Trials covered greetings, Alexa and Siri comparisons, an unrelated preference,
arrival and playful follow-ups, a serious emotional disclosure, current weather,
an on/off command with a five-second delay, a temperature alias, an implicit
flight inquiry, an ambiguous delay, and the current time. Weather was a fixed
29 °C fixture. Each model had its own conversation history; selected follow-up
turns retained their preceding exchanges.

Database writes, device dispatch and web search were replaced by in-memory test
doubles. Network access in the conversation harness allowed only OpenAI Chat
Completions requests. No HA/MQTT command, paid web search, STT or TTS request was
executed. Catalog equality checks passed after both runs.

There were 68 HTTP-200 inference responses and two HTTP-400 compatibility probes.
HTTP success is not task success. The first run's conservative budget reservation
guard skipped seven requests locally; the second completed those cases and
repeated key comparisons. The comparable table uses the same 13 calls per model:
eight initial conversational cases plus five follow-up-run cases. Three extra
initial timer calls are excluded from the table but retained in behavioral
findings and total study cost.

Latency is elapsed time for the complete API response, including network time.
It excludes microphone capture, transcription, synthesis, buffering and playback.
Model order was interleaved by case but not randomized. This sample is too small
to establish reliable production failure rates or small speed differences.

## Comparable results

| Model        | Calls | Median API time | P90 API time | Mean input/output tokens | Estimated USD per 1,000 calls of this mix |
| ------------ | ----: | --------------: | -----------: | -----------------------: | ----------------------------------------: |
| GPT-4o mini  |    13 |         1.072 s |      1.879 s |               3,528 / 62 |                                    $0.567 |
| GPT-4.1 nano |    13 |         0.796 s |      0.968 s |               3,526 / 66 |                                    $0.379 |
| GPT-4.1 mini |    13 |         0.988 s |      1.327 s |               3,524 / 60 |                                    $1.506 |
| GPT-5.6 Luna |    13 |         1.442 s |      1.733 s |               3,605 / 64 |                                    $0.977 |
| GPT-6 Luna   |    13 |         1.347 s |      1.588 s |               3,602 / 52 |                                    $0.476 |

Costs include unsuccessful task responses and are not costs per successful task.
All comparable requests reported zero cache-read tokens and zero reasoning tokens.
The Luna models reported cache writes, which are included at their applicable
rate. Token counts differ slightly because of generated history and tokenization.

Observed behavior:

- **GPT-4o mini:** selected the requested assistant correctly, kept the unrelated
  preference outside that intent, produced short weather replies, preserved the
  five-second timer in both observations, and requested search consent. One
  playful reply misspelled Téka as “Tetka”; it was not flawless.
- **GPT-4.1 nano:** faster and cheaper here, but the repeated timer case emitted
  multiple control calls instead of one plan and was rejected. Its flight inquiry
  lost the explicitly supplied destination and asked for it again. Some unrelated
  answers introduced politics. Its retirement makes a new migration unattractive.
- **GPT-4.1 mini:** handled the tested functional flows but sometimes added
  unnecessary political references. The small latency difference from 4o mini
  does not establish a speed advantage; measured cost was about 2.66 times higher.
- **GPT-5.6 Luna:** handled the tested functional flows with restrained humor.
  Some weather and search-consent responses included unnecessary explanation.
  Median latency was higher and measured cost about 1.72 times that of 4o mini.
- **GPT-6 Luna:** twice answered the harmless comparison “Eu acho a Alexa mais
  divertida que você” with `control_home({"steps":[]})`. Existing validation
  rejected both empty plans. Other tested flows, including the timer and search
  consent, worked. These short failed outputs also lower its average cost.

All models treated the serious disclosure respectfully in the tested turn.
The temperature alias, missing timer unit and current-time cases took existing
local routes without calling an LLM. Implicit flight inquiries caused no actual
search attempt. Household-control evidence concerns plan construction and
validation; physical device execution was intentionally outside this study.

## Pricing and spend

The following standard text rates were checked in official model documentation;
amounts are USD per million tokens.

| Model/source                                                               | Ordinary input | Cached read | Output |
| -------------------------------------------------------------------------- | -------------: | ----------: | -----: |
| [GPT-4o mini](https://developers.openai.com/api/docs/models/gpt-4o-mini)   |          $0.15 |      $0.075 |  $0.60 |
| [GPT-4.1 nano](https://developers.openai.com/api/docs/models/gpt-4.1-nano) |          $0.10 |      $0.025 |  $0.40 |
| [GPT-4.1 mini](https://developers.openai.com/api/docs/models/gpt-4.1-mini) |          $0.40 |       $0.10 |  $1.60 |
| [GPT-5.6 Luna](https://developers.openai.com/api/docs/models/gpt-5.6-luna) |          $0.20 |       $0.02 |  $1.20 |
| [GPT-6 Luna](https://developers.openai.com/api/docs/models/gpt-6-luna)     |          $0.10 |       $0.01 |  $0.50 |

For GPT-5.6 and later, cache-write tokens cost 1.25 times ordinary input: $0.25
for 5.6 Luna and $0.125 for 6 Luna. Calculations subtract cached reads and writes
from total input before applying the separate rates, avoiding double counting.
See [prompt-cache billing](https://developers.openai.com/api/docs/guides/prompt-caching).

Estimated total study inference cost is **$0.05295385**, about 5.3 US cents,
below the stated $0.20 ceiling. This is a token-based estimate, not a billing
invoice. Only one production usage event was retained at inspection time, so
there is insufficient evidence to estimate actual monthly usage. For illustration,
3,000 model calls at the measured 4o mini mix would cost about $1.70, excluding
search, speech services, taxes and different conversation lengths.

## Compatibility and next steps

Both Luna compatibility probes rejected the current `max_tokens` field with
HTTP 400 and explicitly requested `max_completion_tokens`. Merely changing the
panel's model name would therefore fail with the current adapter. The evaluation
adapter succeeded with the new parameter and reasoning disabled. GPT-6 Luna
also requires `reasoning_effort: none` for Chat Completions function calling;
see its [model documentation](https://developers.openai.com/api/docs/models/gpt-6-luna).

A future Luna migration needs a model-aware request adapter, regression cases for
the observed tool-selection failures, and a reversible server-side rollout.
It does not inherently require new ESP32 firmware. No such migration was deployed.

For the current installation, prioritize measuring STT, LLM, TTS and playback
separately before attributing perceived thinking time to the model. Prompt input
dominates this sample's token cost. Reviewing context selection and separating a
stable prefix from the changing clock/readings may improve efficiency; zero cache
hits in this sample do not prove a particular cause or guarantee future savings.
Preserve the existing local command routes and bounded history.

## Evidence

Private, ignored runtime evidence is under `native/data/model-study-20260925/`:
`runtime-summary.json`, `model-access.json`, `benchmark.json`,
`benchmark-repeat.json`, `compatibility.json`, `combined.json`, and `summary.json`.
The helper scripts are `native/data/model-study-{inspect,benchmark,compatibility}.mts`.
These files contain synthetic test exchanges and installation-specific metadata;
they are not intended for source control.

Use `combined.json` and `summary.json` for corrected costs. The original phase
files retain an earlier calculation that omitted the cache-write surcharge;
their response bodies and usage counters remain the raw evidence. The summary's
`successfulInferenceCalls` field means HTTP-200 responses, not functional passes.
