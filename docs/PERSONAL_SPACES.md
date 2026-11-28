# Personal spaces

Personal spaces (Family, Friends, Work or your own) are private timelines that run beside the main river. You might put Grandad enlisting next to the start of WW2, or your first job next to the dot-com crash. This document covers what version 1 does today and what the next phase will need.

## Version 1: on this device only

### Where the data lives

- **Storage:** a space is stored in **IndexedDB, in your browser, on your device**. The code is in `src/lib/personalStore.ts` and `src/lib/usePersonalSpaces.ts`.
- **No server, no accounts, no analytics.** There is no network code anywhere near personal data, and no fallback that sends it somewhere when storage fails. If IndexedDB is unavailable (some private-browsing modes), spaces last only until the tab closes, and the app says so.
- **Never in the site build.** Personal data is merged into the river at run time (`withSpaces` in `src/lib/personal.ts`) and never written to `data/`:
  - Every personal id starts with `p:<space id>:`.
  - The data validator (`scripts/lib/validate.mjs` → `personalIdErrors`) rejects any data file containing one, so CI fails before private data can reach a pull request.
  - `.gitignore` covers `*.infinity-space.json` exports and `*.ged` family trees, so a file saved in the repo folder by accident isn't committed.
- **Export and import:**
  - **Export** downloads the whole space, history included, as `<name>.infinity-space.json`. Use it as a backup, or to move a space to another device.
  - **Import** checks the file thoroughly (`spaceErrors`) and explains any problem in plain English.
  - If a space with the same id is already on the device, the import becomes a copy under a new id, so the two never clash on the river.

### What a space holds

All of these are defined in `src/lib/personal.ts`:

| Item | What it is |
|---|---|
| Person | A name, optional born and died dates (FuzzyDate), and a `living` flag. |
| Event | A title, a FuzzyDate (optionally an end date), notes, the people involved and the sources backing it. |
| Source | A certificate, letter, photo, family bible, newspaper cutting or family-tree site. Trust is worked out like any source's, and the Explain breakdown shows why. |
| Story | A typed memory about an event, with who told it and when ("Christmas 2019"). |
| Link | A typed link (*caused*, *led to*, *part of*, *response to*) from a personal event to a world event or to another event in the space. |
| Date proposal | "Uncle Ray says 1962": a claim by a person in the space, proposing a date, with evidence for and against. |
| Log | The space's append-only history: every change, with the version it replaced. |

### How it reuses the public machinery

- **Dates:** every personal date is an ordinary `FuzzyDate`.
  - People type dates the way they say them: *1962*, *May 1962*, *around 1920*, *the 1920s*, *1918..1922*, *before 1920* or *Christmas 2019*. The parser is `src/lib/dateInput.ts`.
  - Vague dates glow as spans, exactly like uncertain public dates.
  - Text the parser can't read is refused; it never guesses.
- **Date disputes** work exactly as they do on public events:
  - Each proposal becomes a claim in a date-dispute topic (`Topic.dateOf`, `Claim.proposedDate`), and earns a status from **evidence only**.
  - "Agree" votes never move it. Two people's memories with no evidence leave the recorded date standing.
  - With enough documents behind one proposal, it becomes Established and the river uses its date.
- **Lanes:** each visible space is its own lane on the river's right bank, in its own colour, on its own strip of water, with its name floating on the lane.
  - Personal events are ordinary events, so they cluster, fan out in rings, take part in "Expand these N events", and follow the scale bar.
  - They always get a bubble on the full river (importance factor "Your own event", +25).
  - The legend has a chip for each space that slides the camera over to its lane. On phones the lane sits beyond the screen's edge, so this matters there.
  - Each space can be shown or hidden. A hidden space is left out entirely: no lane, no search results, no links.
- **Links to world history:** "Grandad enlists —part of→ World War II begins" is an ordinary `EventLink` with `origin: 'personal'`.
  - Its Explain breakdown says *Drawn by you (personal space, only on this device)*.
  - The linked personal event appears in WW2's topic river, but only in this browser.
  - "Well sourced" votes change the link's strength; "agree" votes don't.
- **Mind maps and topic rivers:** opening a personal event shows its mind map. Its people, stories, sources, date disputes and linked world events are all bubbles.
  - Events that share a person are related (`peopleIds`, strength 0.6 for one shared person), so one person's events form a topic river of their life, and you can glide along it.
  - World events have no `peopleIds`, so their own topic rivers are unchanged.
- **Nothing is deleted:**
  - Editing keeps the previous version in the log.
  - "Remove" archives an item: it stays in history but goes off the river.
  - The one exception is **deleting a whole space**. That wipes it from the device, because it is your data on your device. The app asks first and suggests exporting.

### GEDCOM import

`src/lib/gedcom.ts` reads `.ged` files from Ancestry, FamilySearch, MyHeritage, Gramps and others:

- **People and events:** each person (`INDI`) becomes a person. Births, christenings, baptisms, deaths and burials become events. Marriages and divorces (`FAM`) become events for both partners.
- **Sources:** `SOUR` records become sources, and citations under an event back that event.
- **Dates:** GEDCOM's date words (`ABT`, `BEF`, `AFT`, `BET … AND`, `EST`, `CAL`, `FROM … TO`) keep their fuzziness.
- **Skipped items:** anything unreadable is listed for the user, never guessed. Media files are not imported.
- **Living people:** anyone with no death record, born within the last 100 years (or with no birth date), is marked `living`.

## The next phase

Version 1 never leaves the device. The next phase adds sharing between family members, and optionally making a space public, without giving up that guarantee for anyone who doesn't opt in.

### End-to-end encrypted sync

**The goal:** a space can sync between your devices and the people you invite, while the server only ever stores ciphertext it cannot read.

- **Space key:** each space gets a random symmetric key (AES-256-GCM via WebCrypto). Items and log entries are encrypted on the device before they leave it.
- **What the server holds:** opaque blobs, plus the minimum routing metadata: space id, blob id, size, timestamps and member public keys. The server is a relay and a store, never a reader.
- **Device keys:** each device has a key pair (X25519 for key agreement, Ed25519 for signatures), generated and kept in the browser (a non-extractable CryptoKey in IndexedDB).
  - The space key is shared with each member device by encrypting it to that device's public key.
  - Changes are signed by the device that made them, so you can see who made each change.
- **Sync model:** the space log is already append-only, so sync is a log merge.
  - Each change is an encrypted, signed log entry with a Lamport clock.
  - When two people edit the same item, both versions are kept and the newer one is shown, with the other one in history. Nothing is lost, so this follows the "nothing is deleted" rule.
- **Recovery:** losing every device means losing the space unless you kept an export or set up a recovery key.
  - The recovery key is the space key wrapped with a passphrase-derived key (Argon2id), shown once as words to write down.
  - We never hold a copy, so we can't recover a space for anyone. The UI says this plainly before sync is switched on.
- **What stays local:** GEDCOM files, and anything you haven't chosen to sync. Sync is per space and off by default.

### Invite links and roles

**Invites:** an invite is a link that carries a one-time secret in the URL **fragment** (`#…`). Browsers never send the fragment to the server.

- The invitee's device uses the secret to prove the invite and receive the space key, encrypted to the invitee's new device key.
- Invites expire (7 days by default), can be single-use, and name the role they grant.

**Roles:**

| Role | Can see | Can add stories and date proposals | Can add and edit events, people and sources | Can invite, change roles, remove people |
|---|---|---|---|---|
| Viewer | ✔ | | | |
| Contributor | ✔ | ✔ | | |
| Editor | ✔ | ✔ | ✔ | ✔ (not the owner) |
| Owner | ✔ | ✔ | ✔ | ✔ |

**Enforcement:** roles are enforced twice.

- **On the server:** it refuses to relay writes from devices without that role.
- **On every device:** each device verifies the signature and role of every log entry it receives, and drops any it shouldn't accept. A compromised server therefore cannot promote anyone.

### Revocation

- **Removing someone** rotates the space key. A new key is generated and shared with the remaining members only, and everything written afterwards uses the new key.
- **The UI is honest about limits:** a removed person keeps whatever they already had on their device. Revocation stops future access; it cannot take back the past.
- **Revoking an invite** before it's used makes it worthless, because the server forgets the invite id.
- **Losing a device:** revoke it from another device. That is the same key rotation, aimed at a device rather than a person.

### Making a space public: consent rules

A space can be **published**, partly or fully, so its events join the shared river for everyone (for example, a town's or a club's history). Publishing turns private memories into public claims, so the rules are strict:

1. **Living people are hidden unless they approve.**
   - Any person marked `living` (or with no death record and born in the last 100 years) is redacted from anything published. Their name becomes "a family member", and their events, stories and photos are left out.
   - This lasts until that person approves, from their own account, through an invite or a signed approval.
   - Approval is per person and can be withdrawn. Withdrawing re-redacts from then on, and earlier versions are hidden from public view, though they stay in the private log.
2. **Anything about minors is always private.** Events, stories and media involving someone who was under 18 *at the time* — or who is under 18 now — are never published.
   - This holds even if a parent approves, and even if the person later turns 18. They can publish it themselves as an adult, from their own account.
3. **Stories need their teller.** A story is published only if its teller is not living, or has approved.
4. **Sources are checked for personal data** before publishing: addresses, certificate numbers and the like are flagged for review.
5. **Published items become ordinary public data.** They go through a pull request (or the Phase 1 API), with sources, and get trust scores and Explain breakdowns like everything else.
   - Family memories become claims; they don't become facts by default.
   - The private space keeps its own copy. Unpublishing removes the public copy from view, and the history keeps a record that it was public.
6. **Every publish shows a preview** of exactly what others will see, with redactions marked, before anything leaves the device.

### Funding: paid media storage

Text is small. Version 1 stores none of it on a server, and encrypted sync of text costs little. Photos, scans, audio and video are what cost money, so that's what is charged for:

- **Free:** unlimited spaces, events, people, stories and sources, stored on your device. Encrypted text sync for a family-sized space.
- **Paid:** encrypted media storage (scans of certificates, photos, voice recordings of stories), billed per gigabyte per month at a little above cost. Members of a shared space can chip in.
- **Never:** ads, selling data, or training on personal spaces. The server can't read them anyway.
- **Media is end-to-end encrypted** like everything else. Thumbnails are made on the device.
- **What it pays for:** the surplus funds the public timeline's hosting and moderation. Like all funding of this project, it will be disclosed (see `docs/GOVERNANCE.md`).
