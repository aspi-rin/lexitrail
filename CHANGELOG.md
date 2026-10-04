# Changelog

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
