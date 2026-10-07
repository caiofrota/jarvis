# Current information through web search

The built-in web-search addon uses the existing OpenAI credential and a separate,
fixed `gpt-4.1-mini` Responses API request with `web_search`. The assistant's normal
conversation provider/model remains unchanged, including when it uses DeepSeek.
The addon is disabled by default; this installation's owner requested enabling it
with a US$5 monthly budget and recent-result caching. Configuration lives in the existing owner-only settings.

## Budget and request boundaries

An unsolicited model decision to search first creates a concrete spoken proposal:
“Posso fazer uma pesquisa na internet sobre …?” No hosted search, quota reservation
or cache lookup occurs until an affirmative. Explicit current requests such as
“pesquise passagens para o Rio”, “procure eventos” or “quero passagens baratas para
Recife” permit the search directly; casual mentions, general questions and negated or
conditional research requests do not. Missing flight criteria are still clarified first.

The server stores one proposal per endpoint for 60 seconds, bounded to 128 endpoints
and isolated between panel previews and microphone sessions. It preserves the original
query and resolved criteria, so “sim” does not require another classifier/model call.
Confirmation is consumed before dispatch; duplicate affirmatives never repeat the search.
Refusal, another request, sleep/reset, cancellation, restart, changed home/room/assistant/
resident/mode/city/timezone or changed search enablement/credential invalidate it.
Existing per-interaction tool limits, monthly budget and cache rules apply after consent.

- One interaction means one accepted text message or one transcribed microphone
  utterance, not the entire awake conversation. At most one search is dispatched
  during that turn. Ordinary questions, local intents and clarification require none.
- The main conversation model selects a query. Only the first search request is
  accepted if it produces duplicates, different queries or mixed home commands.
  A search turn performs no home actions. The hosted request sets `max_tool_calls: 1`,
  `parallel_tool_calls: false`, a single tool and a bounded output. Its sourced answer
  goes directly to voice/text; there is no subsequent generation or research loop.
- The monthly budget includes the US$0.01 hosted-tool fee and the search request's
  input/output tokens. Ordinary conversation generation is separate, including on
  cache hits. The cap is shared by every assistant, endpoint, home and panel preview;
  it renews on the first calendar day at midnight in `America/Fortaleza`. The owner
  can edit US$0–100 in cent increments; US$5 is the requested initial value. Zero
  prevents paid searches while valid cache entries remain available.
- A separate `Setting` row (`budget:web-search:YYYY-MM`) stores integer USD micros,
  attempts, cache-hit counts and outstanding reservations. The shared repository
  serializes reservation/settlement under the existing single-writer constraint.
  Invalid ledgers and database failures fail closed. Restart and addon toggles do
  not reset consumption; late completions settle their original month exactly once.
- Before dispatch, reserve US$0.065. This conservatively covers one tool call,
  the documented 128k search context and the configured maximum of 600 output
  tokens at GPT-4.1-mini standard rates (US$0.40/M input, US$1.60/M output). The
  required reservation can block a call slightly before the nominal cap. After
  the API reports valid usage, settle to that estimate, accounting for at least
  the fixed 8,000 search-content input tokens. Cached-token discounts are ignored.
- Failed/cancelled/unknown usage keeps its reservation. A known completed request
  settles even if its answer lacks usable sources; there is never an automatic
  retry or fallback provider. This is a local spending estimate at documented rates,
  not the OpenAI invoice or a limit on other uses of the account. Rate changes require
  updating the pricing adapter and reservation ceiling.
- First initialization imports retained earlier search metadata and the old daily
  counter. Attempts without known token usage conservatively count as US$0.065;
  event-history retention may limit exact reconstruction. This installation's prior
  three search attempts are not intentionally reset. The durable monthly row becomes
  authoritative after import; trimming events does not change it.

## Cache and freshness

- Up to 128 sourced answers live in RAM only. The key includes home, normalized city,
  timezone, local calendar date, requested interval, spoken-answer preferences
  (weather scope, units and detail), resolved flight criteria and normalized query. Physical
  endpoints in the same home and panel previews can share results; different homes,
  dates, routes, passenger counts, exclusions and queries remain separate. Only
  accents, case, whitespace and final punctuation are normalized. The existing main
  model is asked to produce stable query terms; arbitrary paraphrases are not
  guaranteed to hit. There is no fuzzy comparison that discards search criteria.
- Subject limits: live scores/quotes/current moment 30 seconds; flights two minutes;
  weather, news and prices five minutes; events one hour; addresses/opening hours six hours;
  other queries 15 minutes. A local date change makes even longer-lived entries
  ineligible. Prices remain published evidence, not guaranteed current inventory.
- Read valid cached results before reserving money. Concurrent identical requests
  share one paid lookup; cancelling one waiter does not cancel the others. Abort
  the underlying request when all waiters cancel, the addon changes credentials,
  is disabled, or the request times out. No cancelled/failed result enters the cache.
- Asking to search again, update, or avoid cache bypasses stored answers while still
  allowing at most one paid search in that interaction. There is no background refresh
  or stale-result fallback. Eight distinct lookups may be in flight; others fail
  without dispatch. Expiry/LRU eviction, restart, disabling caching or changing
  credentials clear entries without changing the spending ledger.
- The panel labels reused/shared results and retains the original source links and
  checked-at timestamp. Cached output is not relabelled as newly verified information.

## Evidence and privacy

The query contains necessary search terms and relevant city/dates, rather than the
household catalog or chat history. The tool gets only that query, the reference city,
timezone and timestamp. Requests use `store: false`; provider retention policies
still apply. Metadata events record usage/timing/outcome, never query or result text.

Only HTTP(S) citations or action source URLs from a completed hosted search become
source links; credentials in URLs and other schemes are rejected. An answer without
valid sources fails without retry. Structured flight JSON is not itself a trusted
source list. Failure metadata records the bounded processing stage and provider
HTTP/output status, never response bodies or conversation text. The application never fetches arbitrary
result URLs itself. Web content is untrusted evidence and cannot request home actions.

The panel renders source links next to the answer. Physical conversation source links
are isolated per endpoint and retained in RAM for at most 30 minutes, visible under
Rosto e voz. They are not persisted as conversation memory. Speech removes citation
markers and literal URLs; the physical face/protocol needs no firmware update.

## Spoken answers and weather scope

The search request owns its spoken-answer instructions: short Brazilian Portuguese
sentences, written-out units and only the requested period. Present-condition weather
uses Celsius by default and does not request a daily or weekly report. Explicit
Fahrenheit, future periods, morning/afternoon/night and requests for detail remain
separate cache contexts. The search instructions retain the requested part of the
day even when the generated query drops it, and require disclosing when only a
daily forecast was found. Weather results expire within five minutes even if the
generated query lacks the usual weather keywords.
An unambiguous current-weather question about the home's city uses a valid reading
already supplied by an eligible weather intent without allowing an unnecessary web
search. An unavailable reading leaves the existing search fallback available;
forecast and other-city questions are not treated as current home conditions.

The addon validates a short speech contract before returning or caching its result:
at most 55 words/three complete sentences for ordinary weather, 80/four for other
searches, or 100/five when detail was explicitly requested. It discards unsolicited
forecast widgets for current-weather questions and normalizes duplicate temperature
units. It never cuts a word or sentence, nor calls another model to shorten an answer.
If even the first sentence exceeds the bound, it returns a brief limitation and
retains the source links in the panel. This limits length; source relevance and
qualification placement still depend on the provider's answer.

Every voice-worker request passes through the Node speech-text boundary, which removes
visual markup/emojis and pronounces degree and percentage units as words. Hours
such as `10h35` and `10:35` become `10 e 35`. Currency amounts in BRL, USD and EUR
are spelled out before sentence splitting and synthesis, preserving thousands and
cents instead of reading currency symbols or splitting a price. The speech engine
applies the LATAM stress override only to synthesized text. Search
events record final word/character counts and whether formatting changed, never the
question or answer text. The in-memory cache is cleared on server restart.

Events use the home's city and the requested dates. For “neste/próximo fim de semana”,
the application computes Saturday/Sunday in the home's timezone and supplies an
authoritative date interval. Flight queries use the home's city as the omitted origin
and one adult as the omitted passenger count, quoting per-person prices. Explicit
origins, airports and passenger counts in the conversation override those defaults.
Omitted trip type means round trip. Omitted dates become a flexible departure window
from tomorrow through 30 days after today in the home's timezone. The owner requested
regional stay defaults: domestic 2–7 days, preferring weekends for short trips;
international within South America 4–7 days; other international 7–20 days. These are
reference ranges for an economical search, not confirmed travel dates. Explicit
stays and exact dates win. A fixed return with no departure uses the corresponding
backward stay window; a requested departure week/month uses the next Monday–Sunday
or complete next calendar month, computed on the server. Other explicit windows
remain structured date ranges. Return travel may fall after a departure window.

The existing conversation request extracts city/airport names and their country
codes in separate fields. The server derives the domestic/South America/other
category from those codes; there is no second classifier request or added geocoding
service. A missing/ambiguous
destination, unknown geographic category needed for duration, missing origin/home
city, or contradictory dates/durations requires clarification before paid dispatch.
Absence of dates or trip type alone does not. The search
is instructed to identify the commercial airport used, looking for the closest
commercial alternative when the origin city has none, without inventing an airport
code or claiming verified proximity. This airport selection depends on sourced
search evidence, not a local airport-distance database. A per-person fare does not
establish availability for two people, and a group total is not silently calculated
by multiplying a published individual fare. Flight searches request bounded structured offers from the same single hosted
lookup. Before speaking a fare, the server checks departure dates/windows, return
dates/stay duration, trip type, per-person price and a matching retrieved source
URL (ignoring only tracking parameters and fragments). It discards incompatible
or incomplete offers and constructs speech from the validated fields. If no offer
qualifies, it explains that no price with matching dates was found and retains
source links; it never substitutes a 14-day national trip for the default range.
These checks validate extracted fields, not live airline inventory; source
extraction and airport/route correspondence still depend on the provider. One web lookup is not an exhaustive fare-calendar
scan and does not guarantee the cheapest possible combination.

The tool accepts a structured flight object, the server resolves approved defaults
before validation and canonical cache-key generation, and the
server blocks unresolved or contradictory flight-offer requests before reserving search funds.
Published offers are not
confirmed fares or inventory, and this feature does not book or buy anything. If
one search cannot establish an answer, report that limitation rather than research
again automatically. Interpreting the user's intent and retrieving relevant results
remain model-dependent; structured prerequisites and spending limits are enforced
by code and the provider request, not just the prompt.

## Checks and acceptance

The default suite covers shared budget concurrency, known-cost settlement, durable
uncertain reservations, month boundaries, one-time migration, corrupt records,
cancellation, duplicate model calls, source validation, privacy and owner-only
settings/status. Cache checks cover expiry, bounds, context isolation, criteria,
explicit refresh and independent cancellation of shared work. Browser checks cover
monthly settings, cache controls, source labels and clearing endpoint previews.
Live provider checks are bounded and use the same production budget.

In Voz e conexões, check the monthly allowance, accounted estimate and cache hits.
Ask a complete events/news question and inspect the adjacent sources. Repeating the
same search criteria can reuse the result; say “pesquise de novo” to force refresh.
“Quero uma passagem aérea” must ask for missing criteria without reserving a search.

API and pricing references checked on 2026-09-23:

- [Web search](https://developers.openai.com/api/docs/guides/tools-web-search)
- [Responses create](https://developers.openai.com/api/reference/resources/responses/methods/create)
- [Tool pricing](https://developers.openai.com/api/docs/pricing)
- [GPT-4.1-mini pricing](https://developers.openai.com/api/docs/models/gpt-4.1-mini)
