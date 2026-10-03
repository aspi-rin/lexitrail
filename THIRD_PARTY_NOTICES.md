# Data and service sources

## CEFR word lists

The bundled index `extension/data/cefr.json` is adapted from:

- **The CEFR-J Wordlist Version 1.5**, compiled by Yukio Tono, Tokyo University of Foreign Studies. Copyright: Tono Laboratory at TUFS. A1–B2 data may be used for research and commercial purposes at no charge with proper citation, per the source's terms.
- **Octanove Vocabulary Profile C1/C2 Version 1.0**, created by Octanove Labs, licensed under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). The adapted C1/C2 word-level data retains that license.

Source: [Open Language Profiles / olp-en-cefrj](https://github.com/openlanguageprofiles/olp-en-cefrj), pinned commit `d4e45b75b38f27b30dfc5c44d8c571aec7e7092f`. Original terms are included in `extension/data/SOURCE.md`.

Changes: retain single English headwords; expand slash-separated spelling variants; normalize case; merge duplicate headwords at their lowest listed CEFR band; omit phrases and abbreviations with punctuation. The index provides vocabulary bands, not a proficiency examination or an exhaustive dictionary of definitions.

## English–Chinese definitions

[skywind3000/ECDICT](https://github.com/skywind3000/ECDICT), pinned commit `bc015ed2e24a7abef49fc6dbbb7fe32c1dadaf8b`, supplies the Chinese translation field. The source repository declares the MIT License; the complete notice is included in `extension/data/ECDICT-LICENSE.txt` (Copyright © 2025 Linwei, as printed by the pinned license).

`translations.json` retains only CEFR headwords, strips POS/domain tags, favors general definitions, and normally keeps the first three unique senses, bounded at 60 characters. `scripts/generate-translations.py` reproduces the data using the pinned CSV. Fifty-one documented manual supplements/corrections address missing derivatives, spelling variants and common-sense errors; see `extension/data/translation-notes.json`. The original `porten` headword has an explicit unresolved-spelling warning; `misdemanour` retains its original spelling with a correction note in the displayed meaning. Original CEFR bands and attribution remain unchanged.

## Online services

- [Youdao dictionary](https://dict.youdao.com/) pronunciation is streamed from its public `/dictvoice?audio=<word>&type=2` entry point. Current public access requires no key; endpoint availability and behavior may change. Browser/system English speech is the fallback.
- [DeepSeek JSON Output documentation](https://api-docs.deepseek.com/guides/json_mode/) documents `deepseek-flash` and JSON output. User-supplied keys call the official API directly from the extension service worker.

The interface uses original LexiTrail styling and markup, informed by Relingo's word-selection and word-card interaction pattern. No Relingo source code, account services or assets are bundled.
