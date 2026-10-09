# Application migration validation — 2026-09-23

## Automated evidence

- Strict TypeScript checks pass for contracts, Prisma boundary and application.
- Python speech worker passes strict mypy; all Python sources compile.
- 16 Vitest tests cover reference/scope isolation, inheritance, migration, pagination,
  stale revisions, revoked/expired sessions, Origin checks, one-use PINs, endpoint
  isolation/reconnect, codec golden vectors, playback credit and cancellation.
- 115 Python tests pass, including existing C++ codec/face checks and the new private
  speech API, per-request voice/model selection and message limits. Two upstream
  TestClient deprecation warnings do not affect these outcomes.
- Chromium browser flows pass at desktop and Pixel 7 widths: login and password
  visibility, URL-backed sorting/page size, create/delete intent, Escape/backdrop
  cancellation, all mobile row fields/actions, drawer focus return and logout cancel.
- The production Next.js build passes. Local lint covers Biome, Ruff, Python import
  compilation, retained JavaScript, document links and C++ formatting.
- Local gitleaks scan passes for repository source and detects its disposable
  synthetic fixture. actionlint accepts the workflow. After updating Prisma transitives and pytest, both `pnpm audit` and `pip-audit`
  report no known vulnerabilities.

The required workflow aggregates application, native firmware and retained ESPHome
jobs under the stable `Firmware validation` outcome, with pinned actions, frozen
Node/Python locks, and no deployment credentials. It has not run on a Git provider:
this working repository has no remote. Existing firmware source was not changed or
reflashed for this migration; rebuilding unchanged firmware is left to the required CI.

## Physical acceptance and delivery

A trial import into a private disposable SQLite database passed against the real
legacy catalog without changing its source. The production migration then completed
successfully into `native/data/application.sqlite`, preserving the physical endpoint
identity and credential, voice, audio settings and registered catalog. The original
catalog, owner credential and legacy service unit were backed up in the private
`native/data/before-node-20260923T151548Z` directory.

The local cutover is complete. `rosie-app.service` and `rosie-voice.service` are active
and enabled; `rosie-native.service` is stopped and disabled, with its source and data
retained for rollback. The panel remains at `http://192.168.0.226:8765`, using the same
owner password. The ESP32 reconnected automatically without a firmware change or a
new pairing code. Authenticated health checks confirmed the private speech worker,
five installed voices, MQTT connectivity and the `rosie` endpoint. Anonymous admin
access was rejected and catalog responses omitted endpoint credentials.

The real endpoint acknowledged a complete 98,988-byte playback: 3.093375 seconds of
audio transferred and acknowledged in 3.198 seconds. This establishes protocol
completion, not sound quality. The user was away from the device during the test,
so audible continuity and conversational acceptance remain unverified after cutover.
Both new services reported zero restarts during observation. A final desktop/mobile
browser run against the production build passed both scenarios.

See `installation.md` for the reversible cutover and rollback path. No cloud
deployment, firmware flash, Home Assistant or Wi-Fi configuration change was made.

## Conversational intent extension — 2026-09-23

The contracts now support exact/semantic recognition, ready/generated replies,
validated text/number/choice parameters and selectable humor. Existing intents load
with compatible defaults. Local replies enter the bounded history. Cancellation and
identity changes cannot repopulate old history. Panel preview history is separate
from physical microphone sessions and has an explicit reset action.

- 23 web/service tests and four shared-domain tests pass, including 11 new scenarios
  covering contracts, parameter extraction/clarification, substitution, scope/variants,
  local-reply continuity, topic changes, reset, concurrent cancellation and panel/device
  isolation. The unchanged Python suite's 115 passing results were reused from cache.
- Strict type checks, lint, production compilation, formatting, source-secret scanning,
  scanner fixture and workflow syntax validation pass. The architecture skill validator
  still reports the documented absence of an unneeded mobile application.
- Seven isolated real-provider cases used the installed gpt-4o-mini configuration:
  Apple assistant → Siri, a contextual jealousy reply, a serious topic change,
  a homecoming paraphrase, a follow-up, a missing assistant clarification, and Alexa
  as the supplied value. All selected the expected intent/parameter when applicable,
  with exactly one call per turn. Total usage was 10,032 input and 411 output tokens;
  provider preparation was 1.056–3.442 seconds, excluding STT/TTS and playback.
  These were synthetic test phrases with automation disabled, not stored user chats.
- An initial installed panel test was correctly canceled by a simultaneous physical
  wake under the previous shared context. That observation motivated separate preview
  history; the new HTTP regression explicitly proves that physical reset does not
  cancel or clear a panel conversation, and that panel reset clears its own history.

The private database backup is
`native/data/before-conversational-intents-20260923T161808Z/application.sqlite`.
The two examples are installed for the existing Rosie assistant, preserving all
previous intents and settings. The user-confirmed pet fact was appended to the home.
The final production build and both desktop/mobile browser scenarios pass, including
semantic-intent creation, choice parameter editing, visible mode columns, local text
preview and preview reset. After service restart, three authenticated installed API
turns passed: homecoming, a follow-up about the dogs, and an Alexa comparison with
`assistente: Alexa`. Preparation took 1.699, 1.725 and 2.271 seconds respectively,
without STT/TTS. The test preview was cleared afterward. A health check confirmed the
physical Rosie connected, local voice ready and MQTT connected. The app reported
zero automatic restarts. One connection attempt before its five-second startup had
completed was refused; the subsequent check waited for the service to be listening.
No new physical audio acceptance is claimed for these text-only tests.
No firmware, STT/TTS model, wake word, Wi-Fi or Home Assistant changes are required.

## Intent editing, named choices and spoken Alexa — 2026-09-23

The reported editor crash was reproduced by disabling `crypto.randomUUID` in the
existing browser scenario: adding a parameter prevented the parameter fields from
rendering. The LAN HTTP browser also reported `isSecureContext: false` and no
`randomUUID`. Parameter and routine row keys now use component-local counters;
removal preserves the surviving row keys. No security credential generation changed.

Generated examples were anchoring both wording and names. The installed homecoming
and other-assistant intents now have no reply examples, with explicit variation and
current-name instructions. Choice aliases provide validated evidence from the
utterance or the same intent's context. A preliminary real-provider test still
guessed Alexa for an unnamed assistant; the new evidence check now produces the
required clarification. Current names override previous values, and contradictory
generated names produce confirmation instead of an unrelated reply.

- 24 web/service tests and four shared-domain tests pass. The regression covers
  missing names, changed names, contradictory generated text, Apple/Siri aliases,
  follow-up references, multi-name comparisons and word boundaries.
- Both desktop and mobile browser scenarios pass with `randomUUID` unavailable,
  including saved aliases, editing, parameter removal and routine step editing.
  The same installed intent opened through the real LAN URL without page errors.
- Eleven completed isolated provider turns passed: five named/contextual assistant
  turns, an unnamed-assistant clarification, three distinct fresh-session greetings,
  and a homecoming joke/follow-up. The successful run used 23,972 input and 752
  output tokens. Two installed API turns also followed Alexa then Siri correctly.
  Preview history was cleared afterward. No automated speech transcript was saved.
- The Portuguese phonemizer rendered Alexa with a `sh` sound. Synthesis-only
  normalization now uses `Aléksa`, producing `ks` while leaving displayed text intact.
  119 Python tests pass, including name boundaries and actual phonemizer output.
  Two pre-existing upstream TestClient deprecation warnings remain.
- Application/shared type checks, changed-source formatting, web lint, Python Ruff
  and mypy, production build, project checks and source-secret/workflow checks pass.

The two intent records and the previous panel build have timestamped private
backups under `native/data/before-intent-fixes-*` and `before-panel-fixes-*`.
The application and voice services were restarted locally. Installed health checks
confirmed Rosie idle/connected, MQTT connected and speech ready. A synthetic Alexa
sample returned 81,920 nonzero PCM bytes (peak 31,128) without physical playback;
this does not claim audible acceptance on the speaker. No firmware, voice model,
Home Assistant or network setting changed, and the household pet facts were retained.

## Repeated confirmation and spoken formatting — 2026-09-23

A focused regression reproduced a false confirmation: the provider returned a
correct Alexa answer but omitted its parameter metadata, and the application replaced
that answer with "Você está falando de Alexa, certo?". Successive turns could do the
same. A single evidenced choice now supplies missing/stale metadata directly. A real
name contradiction or repeated confirmation draft gets at most one internal repair
with tools disabled, within the existing two-request cap. Failure after that produces
a neutral error; unvalidated drafts never enter the spoken history. Correct ordinary
answers still use one request. This supersedes the confirmation behavior above.

The provider prompt requests plain text, and the common speech boundary strips paired
emphasis and inline backticks before pronunciation. This covers Piper, Kokoro and
Supertonic without changing their models or literal arithmetic/word underscores.

- 28 web/service tests pass, including successive omitted-metadata turns, a stale
  Alexa parameter with a correct Siri answer, repair success, exhausted repair and
  a provider repeating the old confirmation. Tests assert the request cap and no
  automation execution during repair.
- 124 Python tests pass, including emphasis, nested emphasis, inline-code markers
  and literal-symbol preservation. Existing upstream deprecation warnings remain.
- Web type checks/lint, Python Ruff/format/mypy and project documentation checks pass.
  No browser bundle changed; the custom application server loads these TypeScript
  modules directly on startup, so no panel rebuild was needed.
- After restarting both services, three installed API turns answered about Alexa,
  continued after an explicit confirmation and switched to Siri without asking for
  name confirmation. Preview history was cleared afterward.
- Installed Dora synthesis of "Eu sou mais **divertida**." and its plain-text version
  produced byte-identical 50,518-byte PCM outputs. These synthetic samples were not
  played through the physical speaker. Health confirmed Rosie idle/connected, MQTT
  connected and local speech ready. No catalog, firmware or network changes were made.

## Local cancellation and provider audit — 2026-09-23

The physical session already recognized explicit local stop commands before calling
the conversation provider. The matcher now also accepts natural endings such as
"chega por hoje", "não quero mais conversar" and "pode descansar", with assistant
names, politeness and thanks at phrase boundaries. Panel text previews use the same
recognition and clear only their preview history. These remain attention commands,
not generated replies in the conversational intent catalog.

- 51 web/service tests pass. Positive and negative cases cover complete phrases,
  negations, alarm/music requests and questions about cancellation. A gateway test
  feeds a stop transcript through a simulated microphone session and verifies
  `cancel`, `idle` with `sleep_now`, cleared conversation state and no response or
  synthesis call. The HTTP test verifies no provider request, cleared preview
  history and no physical-session reset.
- Web type checks and lint pass. No browser bundle or firmware change is needed.
- Read-only inspection confirmed the installed OpenAI provider/model and matching
  legacy credential, with recent token-usage metadata. A non-generating model GET
  succeeded; the organization costs endpoint returned 403. This verifies API access,
  not the billing owner, invoice total, available credit or organization/project name.
- After the local application restart, three installed text-preview cancellation
  phrases returned the local end-of-conversation response. Rosie reconnected idle,
  MQTT was connected and local speech was ready. Documentation formatting, project
  contracts and source-secret/workflow checks passed. Physical spoken acceptance
  remains a user test; no audio was played during this audit.

## Configurable indicator and display — 2026-09-23

Each physical endpoint now owns optional LED brightness and OLED mode/schedule
settings. Existing records remain compatible, with the LED disabled and no display
schedule. The panel uses the existing authenticated editor and revision checks.
Manual on/off overrides automatic time windows in the home's timezone. A dedicated
display event changes only the OLED; the scheduler does not reset capture/history.

- Ten shared-domain and 51 application tests pass. Cases cover validated brightness,
  manual overrides, daytime/overnight boundaries, repeated local time across DST,
  per-endpoint isolation and a schedule boundary during active listening without a
  cancellation event. Web/shared type checks and changed-source lint/format pass.
- Both desktop and mobile browser tests save and reopen brightness, mode and time
  controls. Installed-panel browser inspection found no page errors or horizontal
  overflow; screenshots are in ignored `artifacts/appearance-{desktop,mobile}.png`.
- 125 Python/native tests pass, including host-compiled firmware indicator behavior,
  bounded PWM/envelope, non-speaking darkness and provisioning display override.
  Existing upstream deprecation warnings remain. Firmware formatting, documentation
  links, project boundaries and source-secret/workflow checks pass.
- The pinned ESP-IDF build produced a 1,323,792-byte application, SHA-256
  `f72f543ddb2cb4805c118bdbfb97f0589f0e08a62acc8fcbda6ac8c257c3a212`.
  The production panel was rebuilt with a private rollback copy and the Node service
  restarted. The CH340 WROOM MAC `14:2b:2f:c2:0f:f8` was confirmed; flash verification
  matched the previous `d95c651c334f` application before app-only installation at
  `0x10000`. Esptool verified the new hash; bootloader, partition table and NVS were
  preserved. The other USB serial adapter was not opened.
- The installed Rosie endpoint has its LED enabled: listening 25%, speaking 10–80%.
  The screen remains automatic with scheduling disabled, so no nighttime window
  was imposed. The prior endpoint record is backed up privately. Device telemetry
  at 19:33 UTC confirmed the new appearance fields, idle with duty 0 and display on,
  Acorda Rosie loaded, 92,708 bytes free heap and zero observed underruns. MQTT and
  speech health were ready. Actual LED brightness and visible OLED response still
  require the user's wired hardware check; no audible test was claimed.

Application rollback images remain in `native/data` and on Proxmox under
`/root/rosie-backups/before-indicator-display-d95c651c334f.bin`. Time schedules are
server-driven; a disconnected endpoint retains its latest display decision until
reconnection. Opening Wi-Fi provisioning temporarily shows its password even when
the display preference is off.

## Contextual intents, addons and worldview — 2026-09-23

- 60 application and ten shared tests passed. New cases cover numeric boundaries,
  decimal readings, missing/non-numeric values, overnight windows in the home's
  timezone, resident/mode intersections, cross-home references, local replies,
  selected-only generation examples, serious-template suppression and assistant
  worldview propagation. Weather tests verify cache/in-flight deduplication,
  unavailable/expired data and independent disabling. MQTT addon tests cover
  subscriptions, freshness, offline clearing, disabling and single-attempt delivery.
- Web/shared type checks, web/shared lint, production build, documentation formatting,
  project boundaries and source-secret/workflow checks passed. The handbook workspace
  script reports the previously documented missing mobile application (decision 001);
  it is not an implementation failure for this web-only product.
- Four browser scenarios passed on desktop/mobile with a clean exit. They cover
  editing/removing response rules, serious-style controls, weather city selection,
  worldview persistence and independent addon settings. An initial run used the old
  panel artifact and could not find the new control; rebuilding corrected that.
  A sandbox attempt was blocked at the test server socket. Another run passed its
  assertions but exited during cleanup; the final direct Playwright run exited zero.
- Installed-panel inspection found no browser errors or horizontal overflow; all
  three weather rules were visible. Private screenshots are under ignored
  `artifacts/contextual-intents-{desktop,mobile}.png`. Final labels distinguish speech
  style from OLED expression, explain the data source and move inheritance to an
  advanced section. Range fields now describe their limits in plain Portuguese.
- The panel was rebuilt with private rollback copies and the Node service restarted.
  The authenticated catalog API saved Fortaleza, Ceará, Brasil from the verified
  geocoding choice, the user's requested Rosie worldview, and Clima lá fora with
  editable <24, 24–<30 and >=30 °C response sets. Existing identity, voice, household
  facts, intent parameters, credentials and endpoint appearance settings were kept.
- Two bounded production text-preview requests selected the weather intent and
  returned the configured political perspective. The first took 4.08 seconds
  including weather acquisition; the second 1.97 seconds. These are individual
  observations, not a latency benchmark. Combined provider usage was 5,886 input
  and 134 output tokens on the existing gpt-4o-mini configuration. No TTS or physical
  speaker test was triggered. MQTT was connected, speech ready and Rosie idle.
- No firmware changes/reflash, Home Assistant mutation, Tuya account connection or
  network reconfiguration was needed. Direct Home Assistant/Tuya addons remain future
  work; existing publishers can supply registered MQTT readings. The firmware/voice
  suites were not repeated for these Node/React-only changes.

## Bounded current-information search — 2026-09-23

- 72 application tests and ten shared tests passed. Search cases cover concurrent
  reservations across endpoints, persistence after restarting, local midnight,
  corrupt counters, cancellation, no retries, duplicate model calls, suppression of
  mixed home actions, unsafe/missing source annotations, metadata privacy, flight
  prerequisites and computed weekend intervals. Owner API tests cover settings and
  authenticated usage status.
- Web/database/shared type checks and lint, production build, project boundaries,
  source-secret/workflow checks and documentation formatting passed. Six browser
  scenarios passed on desktop/mobile, including saving the search cap and clickable
  adjacent citations that clear when switching endpoint or resetting the preview.
  The handbook script still reports the documented lack of a mobile application.
- Installed the panel with a private rollback copy and restarted the local Node
  service. Enabled the requested ten-search daily cap through the authenticated
  settings API, preserving existing credentials and other configuration. No database
  migration, firmware flash, Home Assistant or network change was required.
- Initial live previews exposed two relevance failures: the event answer used the
  wrong weekend and an incomplete flight request searched prematurely. Added server
  date computation and structured flight prerequisites before a second bounded check.
  That check requested the missing flight details with zero searches, then obtained
  cited events for September 26–27 in one search (7.4 seconds for the whole preview).
- Four live preview messages consumed three hosted searches total, including the
  initial failures. Consumption was not reset: three used, seven remaining on
  September 23 in Fortaleza. This is attempt accounting, not an invoice estimate.
  The final search reported 8,866 input and 502 output tokens on GPT-4.1-mini; the
  ordinary assistant remains on its existing model. Source URLs stay in the panel
  while speech removes citation markers, Markdown links and source-host labels.
- The final health read showed Rosie idle, MQTT connected and local speech ready.
  Validation used text previews; physical speech playback was not tested. Search
  content is not flight inventory and remains subject to source/date relevance limits.

## Monthly search budget and cache — 2026-09-23

- 80 application tests and ten shared tests passed. The final focused search/HTTP
  run passed 23 cases after strengthening ledger validation. Coverage includes
  simultaneous reservations, exact-once settlement, month boundaries, legacy import,
  persistence after restart, unknown-cost failure, cache expiry/eviction, home/date/
  route isolation, explicit refresh, independent cancellation of shared work and
  serving valid cached answers after reducing the remaining allowance to zero.
- Web/database/shared type checks and lint, production build, project boundaries and
  source-secret/workflow checks passed. The handbook workspace script continues to
  report only the documented absent mobile package (decision 001).
- Six browser scenarios passed on desktop/mobile, including monthly allowance and
  cache-setting persistence, adjacent clickable sources, the cache reuse label,
  responsive layout and clearing citations on endpoint switch or conversation reset.
- Created a private SQLite backup and panel rollback copy, built the production panel
  and restarted the existing local Node service. Saved the requested US$5 allowance
  and enabled caching through the authenticated settings API. The prior three
  searches imported as US$0.042109 estimated usage with no outstanding reservations;
  configuration, endpoint credentials, firmware and speech services were preserved.
- Two bounded real text previews with the same explicit events query dispatched one
  new hosted search and one cache hit. The first preview took 7,712 ms; the repeat
  took 1,302 ms and retained the original checked-at timestamp and four source links.
  These are individual observations of caching, not latency or event-accuracy claims.
  The additional search estimate was US$0.014085, bringing the monthly total to
  US$0.056194 with US$4.943806 remaining, four attempts and one cache hit. Ordinary
  conversation tokens are separate. MQTT was connected, local speech ready and Rosie
  idle. No physical playback was triggered or claimed.

## Semantic-intent topic boundaries — 2026-09-24

- Fixed two independent causes of unrelated clarification: offering the assistant
  intent for every utterance, and automatically reusing its prior choice value
  without checking continuation. Optional topic references and full-phrase
  continuations now filter candidates before readings, prompts and response enums;
  output validation repeats that check. The panel exposes these bounded controls
  and strips blank lines during editing. Old unguarded intents retain semantic
  matching, with choice inheritance limited to acknowledgements/anaphora.
- 84 application tests and ten shared tests passed, plus web/database/shared type
  checks and web/shared lint. After tightening the bundled homecoming example, all
  19 focused intent cases passed again. Regression coverage includes unrelated
  comparisons after a selected intent or pending clarification, unsupported IDs,
  whole-word aliases, allowed follow-ups, topic reset, and direct return to Siri.
- Production build, source-secret/workflow checks and project boundaries passed.
  Six browser scenarios passed on desktop/mobile, including saving/reopening the
  new fields with trailing blank lines. The handbook script still reports the
  documented absent mobile package. No handbook rule was changed.
- Installed the panel with its private rollback copy and restarted the existing
  service. Backed up and updated the other-assistant catalog record through the
  authenticated revision-checked API. Initial live testing stopped the erroneous
  assistant selection, but a repeat political question was incorrectly labelled
  as weather even though its spoken text addressed politics. Applied the same
  topic controls to the installed weather/homecoming definitions, preserving
  response instructions, rules, parameters, pet nicknames and assistant worldview.
- The final five-message text sequence passed: political comparison -> no intent;
  explicit Alexa -> other-assistants/Alexa; jealousy follow-up -> same intent/value;
  political comparison again -> no intent; coffee/tea comparison -> no intent.
  Each final preview took 0.98–1.66 seconds in this individual run, with no hosted
  web searches. Regular conversation model tokens still apply. Final health showed
  Rosie idle, MQTT connected and local speech ready. No firmware flash or physical
  speech playback was performed. Semantic relevance remains model-dependent when
  an utterance does contain one of the configured topic references.

## Robot reconnection and settings tabs — 2026-09-24

- The application and local speech services were running when the physical endpoint
  disconnected at 08:57:19 Fortaleza time. A read-only USB capture without modem
  control commands showed repeated WebSocket handshake failures with TCP FIN from
  the server. The firmware was already retrying every five seconds.
- Reproduced the recovery failure against the real production Next server and an
  isolated fixture database: requesting `/settings` followed by an authenticated
  device handshake failed with `socket hang up`. The optional catch-all panel route
  also matched `/ws/robot/:id`; Next installed its own upgrade handler on the first
  panel request and closed that matched route. Replaced it with root and validated
  single-segment pages. The initial established-connection drop is not explained by
  this evidence; the repeatable refusal to reconnect is. Disconnect events now
  include the numeric WebSocket close code, without raw reasons or credentials.
- Replaced the voice/settings card grid with five tabs. Draft fields remain mounted
  when hidden; arrow keys and Home/End navigate the tabs, and form validation reveals
  and focuses invalid fields from another tab. The tab strip scrolls within narrow
  viewports; saving applies all settings.
- All 84 application tests, web lint/type checking, production build, project checks
  and source-secret/workflow checks passed. Four browser cases passed across desktop
  and mobile, covering keyboard navigation, cross-tab draft preservation, saving and
  reload, hidden-field validation, repeated connections after panel requests, denied
  unauthenticated handshakes and a 404 for device URLs requested as ordinary pages.
  The initial type check encountered stale generated Next types for the removed
  catch-all; rebuilding regenerated them and the final type check passed.
- Installed locally with a private rollback build. Rosie reconnected automatically
  and reported idle, approximately 93 KB free heap and zero underruns in the sample;
  MQTT was connected and speech ready. No firmware write, router change or physical
  speech test was performed. This establishes reconnection, not prolonged radio or
  acoustic stability.

## Weather speech length and search fallback — 2026-09-24

- The 09:39 Fortaleza-time interaction used hosted web search, then spent 100.743
  seconds synthesizing 78.935 seconds of audio. Device playback took 79.041 seconds.
  Retained metadata establishes this path and duration, not the literal question or
  answer: the application does not persist conversation transcripts. The owner
  recalled asking “Qual o clima lá fora?”. Subsequent weather-intent responses were
  much shorter. Open-Meteo was reachable with a fresh local-city reading during
  investigation; the original reason the model selected search is not established.
- Search had an independent 1,000-token response budget and a loose instruction,
  with no enforced speech-length contract or weather-unit/time-scope handling. Its
  answer bypasses the main conversation prompt. Corrected the search instructions
  and output boundary, lowered its budget to 600 tokens, separated cache preferences
  and normalized speech text before all local voice-worker requests. Current home
  weather with a valid eligible reading now uses that reading without web search.
  Unavailable readings preserve the one-search fallback; forecasts remain distinct.
- All 91 application tests passed, followed by 23 focused cases after the part-of-day
  refinement. Web type checking, lint, project boundaries and source-secret/workflow
  checks passed. Coverage exercises real conversation/voice-client boundaries with
  controlled providers: current readings, failed weather-source fallback, Celsius
  conversion, no unsolicited weekly report, bounded complete sentences, explicit
  units/details, morning context and cache separation, and one hosted call per turn.
- Installed backend changes by restarting the existing local Node service; no panel
  rebuild, firmware write or network change was needed. A real text preview of the
  reported question used the weather intent without search: nine words, 2.586 seconds
  for the text response, 4.956 seconds synthesis and 3.093 seconds of generated audio.
- A second real preview deliberately outside the current-weather matcher asked
  about tomorrow morning. It used one hosted search and returned 36 words, 3.297
  seconds for the text response and 15.147 seconds of generated audio, synthesized
  in 19.259 seconds. It stayed short but supplied day-wide conditions instead of a
  morning-specific forecast. This exposed a missing part-of-day constraint; search
  instructions and cache context now retain it and require an explicit limitation
  when sources only provide a daily forecast. Weather cache lifetime is also capped
  at five minutes when its generated query lacks standard weather keywords.
- The final real preview of the same uncovered question dispatched one hosted
  search and returned 46 words in 3.086 seconds. Local synthesis took 25.213 seconds
  and produced 17.621 seconds of audio. Its cache expiry was five minutes. It
  preserved Celsius and short prose but still included day-wide temperatures and
  other periods alongside the morning: the prompt carries the requested scope, but
  factual scope adherence remains provider-dependent. Do not claim that the final
  result was a verified hourly forecast or that generation latency is resolved.
- These previews generated audio without physical playback and left preview history
  cleared. The two controlled hosted searches cost an estimated US$0.027395 combined,
  excluding ordinary conversation tokens; unrelated household interaction occurred
  between them. Both application services were active and Rosie reconnected after
  each restart. The final sample showed a new physical interaction underway; no
  physical audio quality claim is made. One immediate post-restart probe received
  connection-refused before login and made no model/search call; it was rerun after
  startup completed.

## Flight defaults and Celsius pronunciation — 2026-09-24

- The owner requested using the home's city when departure is omitted, and allowed
  one or two passengers by default when quoting per-ticket prices. Selected one
  adult/per-person pricing. The server now resolves those defaults before flight
  validation, query construction and caching; explicit origins/airports and counts
  win. Clarifications enumerate only missing criteria. Destination, departure date,
  one-way/return choice and required return date remain mandatory before paid lookup.
  Search instructions preserve explicit airports, identify a commercial alternative
  when a city lacks one, and distinguish individual offers from verified group totals.
- Reproduced the reported stress error with the installed Dora frontend: unmodified
  Celsius became `sɛʊsˈiʊs`. Adding Celsius -> Célsius to the existing synthesis-only
  pronunciation dictionary produces `sˈɛʊsjus`, including in a full sentence. Displayed
  conversation text remains unchanged; the shared override reaches all local voices.
- All 94 application tests passed; the final flight-focused run passed 16 cases after
  a nullable-date type correction. Web type checking/lint passed. All 17 focused
  pronunciation, worker and speech-cache tests passed, plus Python formatting/lint
  and source-secret/workflow/project-boundary checks. The sandboxed worker test hung
  and was interrupted; the same focused suite completed outside the sandbox in
  2.11 seconds, with two existing test-client deprecation warnings.
- Restarted the installed Node and speech services while Rosie was idle. A real
  two-message preview, “Quero passagens para Recife.” followed by “Só ida, em 10 de
  novembro de 2026.”, asked only for missing date/trip type, then performed exactly
  one hosted search from Fortaleza and displayed per-person offers. Responses took
  1.694 and 3.926 seconds. This verifies defaults and dispatch, not live fare inventory
  or the exact-date eligibility of the provider's published offers. Preview history
  was cleared afterward.
- The restarted voice worker synthesized “Trinta graus Celsius.” into 1.387 seconds
  of audio in 2.061 seconds. No physical playback was triggered, so acoustic approval
  remains with the owner. Rosie was connected/idle and no firmware, network, model,
  account key or home configuration was changed.

## Flexible flights, spoken prices and hours — 2026-09-24

The owner requested round-trip defaults, flexible departure dates and regional
stay ranges: national 2–7 days, international within South America 4–7 days, other
international 7–20 days. Explicit trip details win. Departure week/month and the
next 30 days are computed in the home's timezone. The existing conversation
request extracts cities/airports and their country codes; the server determines
the regional range without another classifier call.

Initial installed checks exposed incorrect South America durations and an offer
outside the requested departure window. Flight output now uses the same single
hosted search with a strict structured offer format. The server validates dates,
duration, trip type, per-person amount and a retrieved source before composing
speech. It reports no matching price when evidence is incomplete or unsuitable.
Tracking parameters and URL fragments do not cause a source mismatch; other query
parameters remain significant. No second lookup, currency conversion, purchase or
price-guarantee mechanism was added.

The user also reported `10h35` spoken as “dez agá”, symbols in prices, LATAM stressed
on its first syllable and intermittent Rio search failures. Shared Node speech
normalization now expands clock notation and BRL/USD/EUR amounts before sentence
segmentation and local synthesis. Python's synthesis-only LATAM override produces
`latˈɐ̃m` in the installed Dora frontend, rather than `lˈatɐ̃ʊ̃`; display spelling is
preserved. No firmware or network setting changed.

- 120 application tests pass, including rejecting a 14-day domestic offer,
  out-of-window departures, one-way/unknown-source fares, explicit overrides,
  country-based ranges, calendar boundaries, single-search dispatch, structured
  action sources, monetary separators and incomplete-output cache exclusion.
  Type checks and lint pass. Fourteen pronunciation tests and changed Python Ruff
  checks pass; no physical acoustic acceptance is inferred from these checks.
- Metadata before this patch shows three search failures followed by success.
  Historical events lack detailed causes, so the earlier failure cannot be
  attributed to cache or a particular provider error. Failed/cancelled results
  are not cached. New failure events include bounded processing stage and provider
  status without saving queries, response bodies, recordings or credentials.
- Final installed preview checks used exactly two searches for two separate turns.
  Rio returned extracted round-trip dates September 26–October 3, within the
  domestic range, in 4.878 seconds. Buenos Aires used October departures and
  4–7 days; it rejected the retrieved offer for an incompatible stay, in 5.328
  seconds. These checks verify application handling, not airline inventory or
  the accuracy of source extraction. Returned citations remain in the panel.
- Both local services were restarted; Rosie reconnected idle. Preview history was
  cleared after checks. Installed Dora synthesis of a LATAM/10h35/R$1,234.56 sample
  produced nonzero PCM lasting 7.403 seconds, with the Node payload spelling the
  price and clock notation correctly. The sample was not played physically.
  Existing search budget, conversation model/provider, local voice selection,
  firmware and household settings were preserved.

## Home Assistant addon and external interactions — 2026-09-24

Implemented selected-entity HA import, scoped on/off and scene/script activation,
read-only sensor sources, endpoint announcement policies, bounded MQTT/owner-API
speech requests and correlated local choice answers. Import has no physical effect.
The panel uses tabs and a sortable, paginated import table with icon actions.
A per-endpoint HA package supplies announce/ask helpers and a response sensor.
No firmware, router configuration or cloud service changed.

- 127 application tests across 17 files and 10 shared contract tests pass. Coverage
  includes HA authentication/state updates, home isolation, concurrent duplicate
  imports, uncertain delivery without replay, credential redaction, retained and
  oversized MQTT requests, endpoint isolation, codec-preserving volume changes,
  yes/no/cancel/timeout/disconnection and duplicate suppression across bridge restart.
- The owner subsequently requested automatic token creation. Added HA's authorization
  flow with bounded, expiring, single-use state; code exchange; named long-lived token
  creation; private persistence; and revocation of the temporary refresh grant. A
  simulated HA verifies exchange, secret-free events and replay/expiry rejection.
  Actual account authorization remains a user login step on the HA page.
- Type checks, application/shared/database lint, production build, Prisma validation,
  source-secret checks and project checks pass. Python Mypy and 130 Python tests pass
  using the existing environment; `uv` is absent from PATH. Sandbox socket/thread
  restrictions caused EPERM or a blocked TestClient, resolved by running the affected
  tests outside the sandbox. No dependency change was used to hide a failure.
- Ten browser checks across desktop/mobile cover the existing admin/settings flow,
  HA import, quiet-hour drafts, code removal/one-use callback and robot reconnects.
  Earlier new-feature tests were rerun after adding automatic authorization.
- Backed up SQLite through its backup API in the private data directory. Installed
  the Node application; Rosie reconnected idle. Prepared HA's reachable address
  `http://192.168.20.11:8123` and existing home `casa`, and enabled external MQTT
  interactions on the already configured broker. Two real MQTT announcements returned
  their matching `played` acknowledgements. This verifies transport/playback protocol,
  not human-confirmed loudness or sound quality.
- At handoff no HA credential is configured, no HA package is installed and no light
  has been toggled. The authorized first physical target is Luz do escritório; its
  entity ID and live service/state test await HA login. Proxmox guest-agent access
  remains unavailable and HA host SSH port 22222 is closed. No authentication store,
  existing HA password or VM configuration was changed.

## Relay-backed office light and pronunciation — 2026-09-24

The owner completed HA authorization and imported the office light. Live inspection
found it registered as `switch`, so the already-recognized local command “apaga a luz”
could not resolve a `light` in the endpoint's room. Separate the household role from
the HA transport: an explicitly selected switch-backed light resolves as a light
but still dispatches `switch.turn_off`. Import offers compatible roles; sensors stay
read-only and the existing service allowlist and room/home scope remain enforced.
The office device was reclassified as a light and made that room's default via the
owner API with revision checks; its HA entity and other configuration were preserved.

- 21 targeted application tests and 10 shared contract tests pass, including local
  command resolution without an LLM, the actual HA service domain, invalid roles/actions,
  import defaults and explicit light role selection. Type checking, source checks,
  changed-source lint and production build pass. Two browser checks verify the
  import choice on desktop/mobile. The earlier search-field/button alignment fix
  was also installed and measured with zero bottom-edge offset at 1440 and 390 px.
- The active pt-BR phonemizer rendered “encontrei” with the unexpected final `trˈA`;
  a synthesis-only `encontrêi` override produces `trˈei`, preserving displayed text
  and unrelated words. Seventeen pronunciation tests and changed Python Ruff pass.
  Installed Dora generated 1.835 seconds of nonzero PCM for the target phrase;
  acoustic pronunciation acceptance remains a user listening check.
- Saved private SQLite/build backups, installed Node and restarted the local voice
  worker. Both services are active. No ESP32 firmware or network changes were made.
- The live text command “apaga a luz” was acknowledged by HA and the user confirmed
  the physical light went off. The initial short state check expired; a later direct
  HA query confirmed `off`, so the acknowledgement/state timing must not be treated
  as immediate physical confirmation. No failed command was automatically replayed.
  A separate “liga a luz” restored the original `on` state, confirmed by HA; preview
  conversation history was cleared after the checks.
  Recognition of the user's spoken “apaga” remains unverified: no historical microphone
  audio/transcript was retained, and the text/service tests do not test acoustic STT.

## Timed commands, optional cloud voice and EI endings — 2026-09-24

The five-second light command previously lost its timing while independent model tools
executed immediately. One validated plan now preserves explicit intervals, preflights
all targets, pins device/routine/context definitions and durably schedules future steps.
The application returns its own acceptance, avoiding a second LLM response. Uncertain,
expired and invalidated steps are cancelled without replay; missing time units require
clarification before any action. A new command supersedes that device's pending plan.

- The live, authorized office-light check acknowledged on/off 5,033 ms apart. This is
  transport acknowledgement timing, not a sensor measurement of the relay transition.
  The prior on state was restored and confirmed. Multi-room light/TV commands were
  tested with simulated devices; no other household appliance was exercised.
- The prior single-word “encontrêi” substitution is superseded by a Kokoro-only
  phoneme correction for word-final stressed EI. Real Misaki tests cover “identifiquei”,
  “encontrei”, “liguei”, “desliguei” and related endings while preserving nasal vowels,
  internal syllables, punctuation and displayed text. No such override is applied to
  cloud synthesis. Thirty-five pronunciation/cache tests, Python Ruff and worker Mypy
  pass. The sandbox-stalled async test completed outside the sandbox without code changes.
- Added optional per-assistant Home Assistant Cloud TTS, discovered through the actual
  existing HA connection. Sixteen standard pt-BR voices are available. The synthesis
  adapter requests WAV and validates bounded PCM16 mono 16 kHz, using only the configured
  origin and rejecting redirects/unexpected proxy paths. It does not use HA's installed
  OpenAI TTS entity. Local synthesis sends no text to this cloud adapter.
- All 184 application tests across 19 files pass. Added coverage includes owner-only
  unsaved previews, assistant-home binding, discovery invalidation/coalescing, credential
  isolation, proxy-path rejection, bounded downloads/concurrency, cancellation, changed
  configuration, unavailable engines without retries/fallback and malformed WAV rejection.
  Type checks, application lint, project/source checks and production build pass. The
  sandbox build failed to parse a TypeScript subprocess output; the same build completed
  outside the sandbox. No dependency was changed to resolve this environment restriction.
- Six relevant browser checks pass across desktop/mobile: optional voice selection,
  failed-preview recovery, WAV playback, preview without saving, save/reload and return
  to local, existing settings tabs, and robot connection after opening the panel. An
  initial overly broad alert selector also matched Next's route announcer; it was scoped
  to the dialog and the affected checks rerun. Screenshots were inspected at both widths;
  the voice controls and explanations fit without horizontal overflow.
- Backed up SQLite with its backup API and the prior panel build in private storage.
  Restarted the Node application and local speech worker; both are active, HA is ready,
  and the actual Rosie endpoint reconnected idle. Production owner-API previews generated
  nonzero valid WAV: Francisca 2.213 s generation / 5.200 s audio, Antonio 0.850 / 5.950,
  Dora 4.534 / 3.093 for the same fixed preview sentence. These are individual observed
  times, not a latency guarantee. A prior Francisca request reused HA RAM cache and was
  excluded from the comparison. Preview checks explicitly confirmed the saved Dora
  selection was preserved. STT, LLM, endpoint buffer and firmware settings were unchanged.
  No cloud sample was played on the physical speaker; articulation, loudness and final
  acoustic preference remain user listening checks.

## Climate aliases, typed setpoints and comfort proposals — 2026-09-24

The user confirmed that the selected Home Assistant Cloud voice sounds good. Preserve
their subsequently saved Thalita choice. The imported office AC had working aliases
`ar`/`ar condicionado`, but only on/off actions. At 14:22:46 local time the previous
application sent on and off in the same plan; the user reported asking for 22 degrees.
No transcript was retained, so the precise model input cannot be reconstructed.

Implemented reserved climate temperature permission, numeric plan parameters, alias
normalization including hyphens and a local parser for common temperature instructions.
HA capability, Celsius units, availability, min/max and step are verified before sending
`climate.set_temperature`. The payload does not include HVAC mode or on/off. The model
path also rejects recognized temperature requests with dropped/changed numeric targets
or unsolicited on/off steps. Pending plans preserve numeric setpoints across restart.

Cold/hot complaints now create room-scoped proposals using observed appliance state;
confirmation is required, expires after 60 seconds and is consumed once. Tests cover
negative answers, a different named action, duplicate/expired confirmations, state
changes before confirmation and immediately before transport, room defaults/ambiguity,
cross-endpoint/preview isolation, changed permissions, session reset, unavailable state,
limits/steps, cooling-only activation and fan fallback. Proposals stay out of LLM history.

- All 238 application tests across 21 files and ten contract tests passed. A subsequent
  minimum-temperature explanation added one test; all 31 affected comfort tests passed.
  Type checks, production build, source security and project-boundary checks passed.
- Four browser checks passed across desktop/mobile for temperature permission create,
  save/reload/revoke, alias retention, keyboard operation and robot reconnect after panel
  access. Inspected screenshots revealed the long checkbox explanation competing with
  its label; it now sits below the control and the browser test verifies that placement.
- Backed up the prior SQLite database via its backup API and the prior Next build in
  private storage. Enabled only the office AC's temperature action through the owner API,
  preserving the owner's renamed device, aliases and existing on/off actions.
- Read-only checks against actual HA metadata resolved the aliases to `climate.ac_escritorio`
  and validated targets 20 and 22 within the reported 17–27 degree range, step one.
  The production preview read its configured 17-degree setpoint and offered 19 for cold;
  a negative reply discarded the offer. The minimum limit now has an explicit explanation
  for heat discomfort. No positive confirmation or appliance service was sent by these
  live checks; actual voice recognition and physical setpoint acceptance remain user tests.
  Preview history/proposals were reset after verification.
- Installed the final local Node revision; Rosie reconnected idle, HA reported ready
  with 2,465 entities and the speech worker was ready. Final production previews confirmed
  both the 17-to-19 cold offer and the explicit 17-degree minimum explanation, followed
  only by negative replies. The two affected browser checks passed again after the final
  checkbox selector adjustment; final lint has no errors or new warnings. Firmware and
  the saved Thalita voice were preserved. No Git publication or cloud deployment occurred.

## Infrared scene routing, comfort recognition and search consent — 2026-09-24

After the previous installation, the user reported a cold complaint being answered as
city weather and a 20-degree acknowledgment without an appliance response. No transcript
was retained. Read-only HA registry/history inspection identified `climate.ac_escritorio`
as `generic_thermostat`; its target changed to 20 at 14:52 local time, which does not prove
that the IR controller received a temperature command. Existing office Tuya scenes cover
17–27 degrees. No relevant automation connecting the virtual target to those scenes was found.

- Expanded deterministic comfort recognition for assistant addressing, common feeling
  phrases and the configured room, while retaining negation, condition and other-room
  boundaries. Added metadata-only `comfort_recognized` evidence; no recording or transcript
  persistence. A gateway regression passes a speech-worker result through the real robot
  session and conversation path, verifies the proposal and rejects it without appliance action.
- Added validated device temperature-to-scene mappings, owner form save/reload and scoped
  fingerprint invalidation. The adapter sends one mapped scene, retains native setters
  elsewhere, rejects missing/unavailable scenes and distinguishes last-sent settings from
  readings. No Home Assistant configuration, automation or firmware was edited.
- Added per-session internet-search consent for implicit search proposals. Tests verify
  no hosted request or budget use before confirmation, direct explicit searches, one use,
  refusal, expiry, reset, unrelated input, context/credential changes and preview isolation.
  Confirmed searches preserve the original criteria without another model classification.
- All 265 application tests across 22 files and ten contract tests passed. Type checking,
  application lint, source security checks, project checks and the production build passed.
  Socket-based tests initially hit sandbox EPERM and passed outside it without a code workaround.
  Four browser checks passed across desktop/mobile for scene-map save/reload, permission
  revoke, alias retention and endpoint reconnect. The mobile form was inspected without
  horizontal overflow. The scene explanation was then clarified to disclose the full scene
  payload instead of promising unchanged mode.
- Backed up SQLite privately using its backup API. Installed the Node revision and saved
  only the office AC's 17–27 degree scene map via the owner API, retaining aliases, on/off
  actions and the saved Thalita voice. A single requested 20-degree test at 15:10 local time
  produced a HA scene activation timestamp and an accepted application command; the virtual
  target timestamp stayed at 14:52. This confirms the scene route, not IR reception at the
  appliance. The user was not nearby to observe the attempt; physical acceptance remains
  a user check, and the action was not repeated.
- Live preview with “Rosie, estou sentindo frio aqui no escritório” offered 20 to 22 using
  last-sent wording; “tô com calor” offered 20 to 18. Both received negative replies, with no
  additional appliance action. Preview proposals/history were reset. The actual endpoint
  was connected idle, Home Assistant ready with 2,465 entities, and the speech worker ready.
  No paid live web search, Git publication or cloud deployment was performed.
- Final explanation changes passed the production rebuild, both affected browser checks,
  and source formatting. All 265 app tests passed again with the unavailable-scene rejection
  asserted. Restarted only the Node application to load the final build.

## Failed infrared execution traced to Smart Life scenes — 2026-09-24

The user reported another acknowledged 22-degree request without appliance response.
Read-only application events and HA state confirmed one scene activation at 15:20:10
local time, matching the physical endpoint's setpoint command. Entity registry inspection
confirmed `scene.app_ac_22_escritorio` belongs to the loaded official Tuya integration,
not a native snapshot of the virtual thermostat. Tuya diagnostics listed the current
office IR controller and IR AC as online, and a separate older IR/RF controller offline;
diagnostics did not expose the scene's action target, so no incorrect target was inferred.

The user then identified broken scenes inside Smart Life. Their action definitions are
the authoritative correction point. Preserve Rosie's scene mapping while repairing and
testing the same scene in Smart Life; if scenes are recreated with new HA entity IDs,
update that mapping explicitly. No appliance commands, service restart, firmware flash
or unrelated application changes were made during this investigation. Physical success
remains pending repair and user observation of the Smart Life scene.

The user further confirmed recurring device-removed/invalid-action warnings in Smart Life
and requested direct inspection and repair. The connected HA Tuya scene interface only
offers query/activation, and plugin discovery found no relevant Smart Life editor.
Official Tuya Cloud documentation exposes scene action queries/edits through a separate
developer-project authorization. The user has an existing, currently unused project.
Prepared a permission-restricted credential input file and a private GET-only diagnostic
helper; the empty-credential check exited before any cloud request. Actual scene inspection
and any repair are pending that project's credentials, data-center verification and API
permissions. Do not attribute the recurrence to the older offline IR controller without
reading the affected action's target.

The owner populated the private developer credential file and requested a test. Its
permissions are 0600; the selected Western America data center maps to the official
`openapi.tuyaus.com` endpoint. Token authentication succeeded, but a read of the known
current office IR controller returned Tuya code 28841002, `IoT Core service subscription
has expired`. A second bounded read added error-stage visibility and confirmed this is
a resource-read denial rather than an authentication failure. Credentials and tokens
were not printed or stored in diagnostic output. No scene or appliance was mutated.
Inspection through this developer project is pending IoT Core renewal; this independent
access limitation does not establish why the Smart Life scene lost its device reference.

After the owner requested the IoT Core extension, resource reads succeeded. The owner
reports that the scene reference fails without manually deleting or reconfiguring the
remote. A read-only snapshot of the home's devices and 30 scenes was saved privately:

- All eleven office temperature scenes (17–27) and the office off scene still point to
  the current virtual `Ar escritório` device, with an `irIssueVii` action and their
  respective temperature/power keys. All were enabled and reported status `1` by Tuya.
- The gateway sub-device query independently confirms that this virtual AC belongs to
  the current, online `IR Escritório`. The turbo scene targets the separate, existing
  DIY remote under that same gateway. No inspected office scene targets the older,
  offline IR/RF controller.
- The current hub's available online/offline/activation/reset/firmware/restart log query
  returned no entries in the preceding 24 hours. This does not establish that the app's
  reported action failure never occurred, nor explain historical recurrence.
- IR remote/key inspection is separately denied with `28841101` (API not subscribed),
  for both documented v2 and legacy v1 remote-list endpoints. The documented service
  containing the v2 endpoint is **IR Control Hub Open Service**. IoT Core access alone
  does not grant this diagnostic capability; the denial is not evidence that it caused
  the Smart Life failure.

No erroneous scene device reference was demonstrated by the current snapshot, so no
scene was rewritten or recreated. Verifying the current app warning and inspecting the
actual supported IR keys remain necessary before choosing a repair. No appliance action,
device reset, firmware flash, application restart or paid service subscription was made.

The owner clarified that the scene had already been repaired manually before the cloud
snapshot above. That snapshot therefore captures a working baseline, not the original
invalid action. The owner subsequently confirmed that a new 22-degree request reached
the appliance. Read-only verification found the mapped 22-degree scene activated at
16:03:14 local time and the corresponding application command at 16:03:15. The separate
HA `climate.ac_escritorio` generic thermostat still retained a 20-degree target last
updated at 15:21:26, with a 24-degree sensor reading. Scene execution does not update
that independent thermostat target. No target write was issued to make the display
match, because changing this active generic thermostat can also affect its switch
control. Physical acceptance of the repaired 22-degree scene is confirmed by the owner;
automatic tracking of scene commands in the HA climate entity remains a separate gap.

## Shared office target through the existing Node-RED bridge — 2026-09-24

The owner requested that Rosie and the HA climate card remain synchronized. HA YAML
confirms a generic thermostat driving `input_boolean.ac_escritorio_ligado`. The earlier
HA-only automation search missed the separate Node-RED service in Proxmox LXC 200.
Read-only inspection of that service found its existing `Config AC` flow: the office
state listener filters unchanged mode/target, updates the helper, and dispatches
`scene.app_ac_<temperature>_escritorio` or the office off scene. This supersedes the
earlier assumption that no climate-to-IR automation existed.

The direct scene override in Rosie's office registration was therefore the cause of
the stale HA target. Backed up the device record privately, removed only its eleven
temperature-scene overrides through the authenticated owner API, and read back the
empty map with the same entity, aliases and other registered actions. No HA YAML,
Node-RED flow, Tuya scene, firmware or running application service was changed.

One actual application text request, “ajusta o ar para 22 graus”, exercised the shared
conversation/automation path while observing HA service and state events. Starting
from cooling with target 20, the observed sequence was exactly one
`climate.set_temperature(22)`, the climate target becoming 22, and exactly one
`scene.turn_on(scene.app_ac_22_escritorio)`. There was no duplicate scene or retry.
This validates the live Rosie → HA → Node-RED → Tuya scene boundary. The owner
confirmed that the appliance received this new 22-degree command, completing
physical acceptance of the corrected route. Source-wide tests/rebuild were not
rerun because this is an installation configuration correction using unchanged code.

The existing one-way HA bridge does not track direct physical-remote/Smart Life
changes that do not generate a corresponding climate update. No bidirectional
feedback from the infrared appliance is claimed.

## Parallel Tuya Smart IR AC trial — 2026-09-24

The owner authorized installation alongside the current control and explicitly
deferred replacing it. Installed upstream version `2026.9.0` at revision
`c04b3e1f8c96c2ce2c0fc712a03b7d0b6aca3d64` in Home Assistant `2026.8.3`.
The downloaded source archive SHA-256 is
`b7d175b43cd7200cac4a1fadad808dc1d803a3147ee05ca097791099e22b3e7d`.
Python and JSON source parsing passed; package and config-flow imports also passed
inside the installed HA container. `ha core check` completed successfully before
the required HA restart. Existing configuration and registries were backed up in
the private HA directory `.rosie-install-backups/tuya-ir-parallel-1790279529`.

The integration was initially staged from that reviewed archive, then registered
and installed through HACS at the same full commit reference. HACS repository
`831558453` reports installed at that revision. All 36 installed source/resource
files matched the reviewed source after the HACS operation. This intentionally
pins the reviewed commit rather than assuming the identically numbered release
tag has the same source. No upstream source modifications were made.

The initial IR API request returned `28841101` (not subscribed). After the owner
authorized the service, a read-only v2 AC status request succeeded with cooling,
22 °C, power on, and automatic fan. The owner reported that this IR service's
expiration field says Permanent; that is not verification of IoT Core expiry or
billing terms. No paid service was purchased by the agent.

Created the hub and office AC through HA's normal configuration/options flows.
The new entry loaded successfully and owns
`climate.ac_escritorio_teste_tuya_ir`, named `AC Escritório — Teste Tuya IR`.
Its device registry ID is `2db870524dfdfd963e3e8a5afb9de72d`. It reads the existing
room sensor and exposes cooling, 17–27 °C in whole-degree steps, and fan speeds,
with no optional presets. Polling remains at 300 seconds and Pulsar is disabled.
It has not been registered with Rosie or connected to household automations.

During the HA restart, the original generic thermostat initialized at its YAML
default of 17 °C. A guarded, single request restored its previously observed
22 °C target through the original HA service. The restored original and the new
trial entity both subsequently reported cooling at 22 °C with room temperature
24 °C. Hash checks confirmed that `configuration.yaml`, `includes/climates.yaml`,
`automations.yaml`, and `scripts.yaml` remained unchanged. No Node-RED flow, Tuya
scene, Rosie catalog, application service, or robot firmware was modified.

One controlled test repeated the existing 22 °C target through only the new
entity. HA returned success; its subscribed service events contained the new
climate call and zero legacy scene calls during the observation window. The owner
explicitly confirmed that the physical AC reacted. The new entry remained loaded
and its integration had no recorded error-level messages in the final check.
This verifies one actual temperature command, not every fan/power mode or
synchronization with the physical remote. Further manual tests must use the
clearly named trial entity; replacement remains pending the owner's request.

## Office Tuya IR cutover — 2026-09-24

The owner subsequently authorized replacement, requested disabling the old flow
with rollback ready, and specifically identified Alexa and Node-RED dependencies.
Read the active Node-RED API revision, including the separate bedroom bridge on
the same `Config AC` tab. Saved a full initial flow snapshot and exact before/after
subsets. The guarded deployment changed 12 existing nodes and added one disabled
legacy tab; it preserved 590 unrelated nodes from the deployment-time revision.
Node-RED reported stopping/starting only modified nodes, without errors in that
deployment window. The final API revision was
`a63d336f518b61e5d4bf7512376d55d992c77c61b691e16ff4f834b202a1fcf8`.

The eight office climate-to-scene bridge nodes are now in the disabled legacy
tab, along with the former Alexa power-before-temperature node. The bedroom tab
remains enabled. The office light routine's condition now reads the new climate
state; its downstream service and wires are unchanged. The Alexa office
temperature branch goes directly to one combined cooling/temperature request.

Transferred the main entity ID using supported HA registry APIs. The old generic
thermostat is disabled/hidden as `climate.ac_escritorio_legado` and absent from
active states. Tuya Smart IR AC owns `climate.ac_escritorio`, with the original
friendly name, aliases and Alexa exposure. The device display name is also
AC Escritório. No scene/service call occurred during the registry transfer.
Hashes confirmed the HA configuration, climate YAML, automations and scripts
were unchanged. A fresh private HA backup is
`.rosie-install-backups/office-ac-cutover-1790281325`.

Before cutover, the old virtual thermostat reported 22 °C while the new entity
and a direct read of Tuya's recorded status reported 17 °C. The cause of that
pre-existing divergence was not established. After cutover, a single panel
conversation request to Rosie for 22 °C invoked exactly one
`climate.set_temperature` call on the preserved entity, with zero legacy scene
calls during the six-second observation window. HA reported cooling at 22 °C,
and a separate read-only Tuya v2 status query confirmed power 1, mode 0, temp 22,
wind 0. The office catalog still has its original entity ID and an empty direct
scene map. No Rosie service restart or robot firmware change was needed.

The installed HA Alexa adapter derives endpoint identity from entity ID. The
rename sequence preserved `climate#ac_escritorio` and avoided sending a delete
for it. Cloud's Alexa entity list includes the replacement with PowerController,
ThermostatController and TemperatureSensor interfaces; the legacy and former
trial IDs are absent. Alexa exposure and aliases match the original entity.
No Cloud or Tuya IR error-level messages appeared in the final HA log check.
This confirms HA-side compatibility, not a completed spoken Alexa test or new
physical observation. The earlier trial's 22 °C command was physically confirmed
by the owner; the cutover's physical reception and Alexa voice test remain for
the owner to observe.

The [runbook](office-ac-cutover.md) records snapshots, guarded rollback helpers,
required HA restart when re-enabling the YAML thermostat, and restoring its target
before the legacy bridge is reactivated. Recovery was prepared but not executed
against the working installation. Whole-flow or live `.storage` replacement is
not part of the rollback. An unrelated pre-existing Alexa Quarto temperature node
(`cf7f212a9a9184e7`) targets the office; it was preserved and needs separate review.

## Conversation model study — 2026-09-25

The [model study](model-study-2026-09-25.md) verified that production currently
uses `gpt-4o-mini` and compared it with GPT-4.1 nano, GPT-4.1 mini, GPT-5.6 Luna
and GPT-6 Luna using the actual conversation class and a cloned catalog. Device
dispatch, persistence and observations were stubbed; only inference requests
reached the provider. Catalog equality checks passed after both runs.

Recorded 68 HTTP-200 inference responses, two rejected compatibility probes,
and an estimated $0.05295385 in inference cost including cache writes. The report
distinguishes API success from task correctness and documents the limited sample.
Existing validation blocked repeated empty GPT-6 Luna control plans and a
multiple-call GPT-4.1 nano timer response. Local temperature, time and timer-unit
clarification cases made no model request. No physical actions or web searches
were executed. Production settings, services and firmware remain unchanged;
the recommendation is to keep GPT-4o mini for now.

## Automatic HA device catalog — 2026-10-02

Prepared the optional HA-owned catalog mode, room-to-area binding selector and
read-only HA device rows. This is a source preparation; the installed settings and
services were not changed, and no physical firmware was built or flashed.

- Three catalog tests cover generated stable IDs without database device entries,
  inherited IDs/permissions, exposure filtering, ambiguous room rejection,
  metadata refresh and failure/disconnection disabling. Existing HA transport tests
  also verify that revoking Assist exposure prevents a service call.
- Application and database type checks, web lint and production build pass.
  Shared contract tests pass (10 tests). Project document/browser boundaries and
  source-secret/workflow checks pass.
- The full web suite passes 330 tests and fails one unrelated existing flight-date
  assertion in `tests/web-search.test.ts:441`: its fixed departure date is now in
  the past. No change to flight behavior or its date fixture was made.
- Four Chromium desktop/mobile scenarios pass, including the automatic-mode
  control, retained manual import, saved HA area binding and authorization callback.
  The browser test now waits for login completion before reload/navigation.

Real HA discovery and physical voice acceptance remain installation checks. Enable
automatic mode in the panel, verify Assist exposure and room bindings, then use a
text preview. This feature requires no ESP32 firmware change.
