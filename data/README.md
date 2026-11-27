# data/

The real (non-demo) data behind the site — one small JSON file per item. **Every change here is a pull request**: checked automatically, reviewed by a person, and kept in git history.

| Folder | What |
|---|---|
| `events/ww2/` | WW2 events imported from Wikidata, named by Wikidata id (`Q8641370.json`) |
| `entities/` | People and organisations |
| `sources/` | Books, papers, archive records — what dates and claims cite |
| `schema/` | The rules each file must follow (your editor can use these for autocomplete) |
| `import/` | Importer settings, e.g. items never to import |

How to edit, cite sources, dispute a date or re-run the importer: [CONTRIBUTING.md → Editing data](../CONTRIBUTING.md#editing-data).
Check your changes with `npm run validate:data`.
