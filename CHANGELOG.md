# Changelog

## 0.0.7 — 2026-10-10

- Removed Google Drive sync ahead of a Chrome Web Store listing: no Google sign-in, OAuth client, `identity` permission or `googleapis.com` host access remain. WebDAV manual sync is the only cloud sync.
- Settings show the WebDAV connection directly; the provider selector and Google sign-in buttons are gone.
- On startup the worker quietly deletes only the obsolete `driveConfig` and `syncProvider` local keys; the wordbook, WebDAV connection, DeepSeek Key and other settings are kept.
- The fixed extension `key` (ID `pabcjgpefkpmodichjomkgiflicagkec`) is unchanged; `npm run check` now verifies the ID and an explicit manifest permission list. The legacy migration bridge still drops only `key`.

## 0.0.5 — 2026-10-05

- Optional HTTPS WebDAV manual sync, per-device snapshots in a dedicated LexiTrail folder, connection verification and local credential removal.
- Provider selection preserves existing Google sign-in and the shared wordbook merge rules.
- System-default light/dark appearance with a single sun/moon toggle and local preference persistence.
- Scoped runtime host permission, redirect refusal, bounded DAV XML/JSON parsing and credential-free backups.

## 0.0.4 — 2026-10-04

- Shared manifest OAuth configuration and native Chrome Google sign-in; the registered Chrome client is bundled, with Drive appdata enabled and the owner added as a test user.
- Stable unpacked extension identity, credential-free vocabulary backup/import, and a legacy identity migration package.
- Hover cards on marked English words, delayed lookup, card interaction without focus theft, and marked link click interception with an original-link action.
- Stable ZIP directory for future manual upgrades.

## 0.0.3 — 2026-10-03

- First Git version, as requested by the owner; previous 0.1.0/0.2.0 packages below were local previews.
- Google Drive app-data JSON synchronization with per-device snapshots and independent state/material/context merge.
- Restricted session OAuth credentials, public-client setup guide, explicit Sync Now, and retryable failures.
- Compact DeepSeek Key field, visibility control, persistent configured indicator and hover-to-delete action.

## Local preview 0.2.0 — 2026-10-03

- Short Chinese meanings for all 8,679 vocabulary entries using pinned ECDICT data, with documented corrections and an unresolved-spelling warning.
- Default bracket translations after new words; original text and English selection remain available.
- Schema 2 migration preserves existing wordbook states and collected contexts.
- Learning/mastered words retain AI definitions, bilingual examples, first-query context, model and timestamps; the wordbook can expand these materials.
- Unlisted-word enrollment and enrollment during an in-flight lookup both retain results.
- Same-word request deduplication, persistent result reuse, and a 1000-entry volatile LRU for unstudied lookups.

## Local preview 0.1.0 — 2026-10-03

- English-only CEFR A1–C2 multi-select initialization with 8,679 bundled headwords.
- One personal status per word: new, learning, mastered.
- Blue/orange dashed underlines through CSS Custom Highlight API; dynamic-page rescanning.
- Word-selection icon, compact dictionary card, status marking and original-context collection.
- DeepSeek Flash JSON dictionary results using a user-provided local key.
- Youdao dictionary pronunciation with browser/system speech fallback.
- Personal wordbook, search, pagination, saved contexts, settings and compact toolbar popup.
- Local-only build and ZIP packaging. Preview Git commit was pending the owner's file-list confirmation.
