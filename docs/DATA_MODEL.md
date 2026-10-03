# Local vocabulary and lookup data — schema 2

Persistent storage is `chrome.storage.local.state`; schema 1 wordbooks are upgraded on worker startup. Existing states, initialization bands and collected contexts remain intact. API keys live separately under `deepseekKey`, with trusted-context storage access; message responses omit the key.

Each `state.words[normalizedWord]` record has:

| Field | Purpose |
| --- | --- |
| `word`, `level`, `status` | Stable English headword, optional CEFR band, and exclusive new/learning/mastered state |
| `translation` | Up to three main offline Chinese senses; words outside the bundled vocabulary use their saved AI meaning |
| `created`, `updated` | Millisecond timestamps for later synchronization or card generation |
| `examples[]` | Up to ten original reading contexts with text, HTTP(S) URL, title and collection timestamp |
| `studySaved` | Retains learning material once enrolled in learning or marked mastered |
| `lookup` | The first successful AI result, retained independently of subsequent status changes |

`lookup` is a plain JSON record containing `schema: 1`, `model`, `promptVersion`, `queriedAt`, `context`, `partOfSpeech`, `meaning`, `definition`, `example`, and `exampleTranslation`. AI-generated examples and the original collected reading contexts have separate fields. The original lookup context identifies the sense used by the first query. Later lookup of the same normalized word reuses that material across context changes and worker restarts. Cloud synchronization and flashcards can consume these records in a future version.

A new/unlisted word queried without learning enrollment uses a worker-memory LRU cache of at most 1000 successful completed results. In-flight requests deduplicate by normalized word. Cached results are omitted from the settings page and durable storage. The worker stopping clears them; a new or cleared API key also clears them. Failed requests are retryable and bypass the completed cache. Saving annotation settings keeps the cache.

Enrolling a word after querying transfers its displayed or cached result into the persistent record. The open card includes bounded, validated result fields with its enrollment request, so worker suspension or cache eviction between lookup and enrollment also preserves the displayed material. Enrolling during a query records the enrollment first, and the successful response then saves its learning material. Promotion to mastered also retains material. Once saved, moving a word back to new preserves its material. Failure or a missing key leaves its status and any collected context available; a subsequent successful query completes the material.

The offline translations are general dictionary senses, and the saved AI result is a contextual sense. First-result reuse intentionally keeps that sense: a future explicit refresh or multiple-sense feature would need its own contract.

Stored timestamps and normalized word IDs provide a compact starting point for future synchronization. This release performs all storage locally.

## Synchronization clocks

Explicit status changes add `statusUpdated`; seed entries have an implicit baseline of zero. `enabledUpdated` clocks the reading preference independently. Local `revision` and `driveConfig.lastSyncRevision` track edits that occur during upload; these device counters stay outside cloud snapshots. Per-device snapshots and merge rules are documented in [SYNC.md](SYNC.md).
