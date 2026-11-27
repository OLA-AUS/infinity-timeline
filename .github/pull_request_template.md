<!-- Thanks for contributing! Delete the sections that don't apply. -->

## What does this change?

<!-- One or two sentences. Link the issue it fixes, e.g. "Fixes #12". -->

## For data edits (files in `data/`)

- [ ] Every date I added or changed cites a **real, checkable source** in `sources`, or uses `"method": "community"` if it doesn't have one yet.
- [ ] I set `"manualEdits": true` on any imported file I edited by hand, so the importer won't overwrite it.
- [ ] If I removed an imported file, I added its Q-id to `data/import/wikidata-ww2.exclude.txt` with a reason.
- [ ] No demo or placeholder data, and nothing copied word-for-word from Wikipedia or other copyrighted text.
- [ ] Conflicts of interest (if any): <!-- e.g. "I work for the museum that holds this archive" -->

**Sources:**
<!-- Title, author, year, link — for each change. -->

## For code changes

- [ ] `npm run check` passes (data validation, tests, build).
- [ ] New logic has plain-English comments and, where it computes something, a test.
- [ ] Any new score or label has an "Explain" breakdown — no hidden weights.
- [ ] Checked on a phone-sized screen if it touches the UI.
