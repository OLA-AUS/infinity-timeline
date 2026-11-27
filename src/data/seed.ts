// ⚠️ DEMO DATA. Event dates are real (but not yet cited — their `sources` lists are empty);
// every organisation, person, source, fine, vote count, AI output and poll number below is a
// FICTIONAL placeholder that exists only to demonstrate the mechanics. Replace with real,
// cited data before launch. Real imported data lives in data/ (see CONTRIBUTING.md).
import type { Claim, Dataset, EventLink, Evidence, LinkType, Source } from '../types';
import { between, inMonth, inYear, onDay } from '../lib/dates';

// Small helpers so each row below stays on one line.

/** One piece of evidence: claim ← source, for/against, how relevant, and demo "well sourced" votes. */
const ev = (
  id: string, claimId: string, sourceId: string, direction: 'for' | 'against',
  relevance: number, note: string, up = 20, down = 4,
): Evidence => ({ id, claimId, sourceId, direction, relevance, note, wellSourced: { up, down } });

/** A demo link between two events (always flagged demo). Votes: well-sourced up/down, agree up/down. */
const link = (
  id: string, from: string, to: string, type: LinkType, note: string, claimantId: string, sources: string[],
  ws: [number, number], agree: [number, number],
): EventLink => ({
  id, from, to, type, note, claimantId, sources, origin: 'curated', demo: true,
  wellSourced: { up: ws[0], down: ws[1] }, agree: { up: agree[0], down: agree[1] },
});

/** A demo source (always flagged as demo in the UI). */
const src = (s: Omit<Source, 'demo'>): Source => ({ ...s, demo: true });

/** A claim with empty child/evidence lists filled in (evidenceIds are back-filled at the bottom). */
const claim = (c: Omit<Claim, 'childClaimIds' | 'evidenceIds'> & Partial<Pick<Claim, 'childClaimIds'>>): Claim => ({
  childClaimIds: [],
  evidenceIds: [],
  ...c,
});

export const seed: Dataset = {
  // People and organisations. `founded` puts them on the river; click one to "jump" there.
  entities: [
    { id: 'e_platform', name: 'Infinity Timeline Foundation (this platform)', kind: 'funder', field: 'culture', founded: inMonth(2026, 7, { method: 'community' }), description: 'This platform. Its own funding sits on the timeline like everyone else’s.', demo: true },
    { id: 'e_uni', name: 'Example University', kind: 'institution', field: 'science', founded: inYear(1850), description: 'Demo research university.', demo: true },
    { id: 'e_press', name: 'Example University Press', kind: 'publication', field: 'culture', founded: inYear(1890), description: 'Demo academic publisher.', demo: true },
    { id: 'e_found', name: 'Example Research Foundation', kind: 'funder', field: 'science', founded: inYear(1910), description: 'Demo charitable research funder.', demo: true },
    { id: 'e_pharma', name: 'ExamplePharma Corp', kind: 'company', field: 'medicine', founded: inYear(1921), description: 'Demo pharmaceutical company with a penalty record.', demo: true },
    { id: 'e_gov', name: 'Demo National Science Agency', kind: 'government', field: 'science', founded: inYear(1950), description: 'Demo public research funder.', demo: true },
    { id: 'e_energy', name: 'Demo Energy Holdings', kind: 'company', field: 'economics', founded: inYear(1960), description: 'Demo energy company.', demo: true },
    { id: 'e_tank', name: 'Demo Policy Institute', kind: 'institution', field: 'politics', founded: inYear(1975), description: 'Demo think tank. Funding only partly disclosed.', demo: true },
    { id: 'e_histA', name: 'Dr A. Placeholder (historian)', kind: 'person', field: 'politics', founded: inYear(1952), description: 'Demo historian at Example University.', demo: true },
    { id: 'e_histB', name: 'Prof B. Example (economic historian)', kind: 'person', field: 'economics', founded: inYear(1960), description: 'Demo economic historian, fellow at Demo Policy Institute.', demo: true },
    { id: 'e_drC', name: 'Dr C. Sample (clinical researcher)', kind: 'person', field: 'medicine', founded: inYear(1968), description: 'Demo independent clinical researcher.', demo: true },
    { id: 'e_drD', name: 'Dr D. Demo (industry researcher)', kind: 'person', field: 'medicine', founded: inYear(1972), description: 'Demo researcher employed by ExamplePharma.', demo: true },
    { id: 'e_journo', name: 'E. Writer (independent journalist)', kind: 'person', field: 'culture', founded: inYear(1980), description: 'Demo reader-funded journalist.', demo: true },
    { id: 'e_user', name: '@timeline_user (community member)', kind: 'person', field: 'culture', founded: inYear(1995), description: 'Demo community account.', demo: true },
  ],

  // Fines, settlements and retractions — these lower an entity's trust score.
  penalties: [
    { id: 'p1', entityId: 'e_pharma', type: 'criminal_fraud', amountUSD: 1_200_000_000, at: 2009.7, regulator: 'Demo Dept. of Justice', summary: 'Demo: off-label marketing fraud.' },
    { id: 'p2', entityId: 'e_pharma', type: 'civil_settlement', amountUSD: 2_300_000_000, at: 2012.5, regulator: 'Demo Dept. of Justice', summary: 'Demo: withheld safety data.' },
    { id: 'p3', entityId: 'e_pharma', type: 'regulatory_fine', amountUSD: 45_000_000, at: 2019.3, regulator: 'Demo Medicines Agency', summary: 'Demo: misleading trial reporting.' },
    { id: 'p4', entityId: 'e_pharma', type: 'regulatory_fine', amountUSD: 600_000_000, at: 2022.8, regulator: 'Demo Competition Authority', summary: 'Demo: price-fixing.' },
    { id: 'p5', entityId: 'e_energy', type: 'regulatory_fine', amountUSD: 80_000_000, at: 2015.4, regulator: 'Demo Environment Agency', summary: 'Demo: emissions reporting violations.' },
    { id: 'p6', entityId: 'e_energy', type: 'civil_settlement', amountUSD: 400_000_000, at: 2021.1, regulator: 'Demo State Attorneys', summary: 'Demo: misleading the public.' },
  ],

  // Who pays whom. `disclosed: false` means it came out later, which costs extra trust.
  funding: [
    { funderId: 'e_gov', recipientId: 'e_uni', share: 0.5, disclosed: true },
    { funderId: 'e_found', recipientId: 'e_uni', share: 0.3, disclosed: true },
    { funderId: 'e_pharma', recipientId: 'e_found', share: 0.4, disclosed: false },
    { funderId: 'e_uni', recipientId: 'e_histA', share: 1, disclosed: true },
    { funderId: 'e_energy', recipientId: 'e_tank', share: 0.6, disclosed: false },
    { funderId: 'e_tank', recipientId: 'e_histB', share: 0.5, disclosed: true },
    { funderId: 'e_gov', recipientId: 'e_drC', share: 1, disclosed: true },
    { funderId: 'e_pharma', recipientId: 'e_drD', share: 1, disclosed: true },
  ],

  // The glowing nodes on the river.
  events: [
    // Uncertain dates: these two draw a glowing span on the river instead of a single point.
    { id: 'ev_writing', title: 'Earliest writing, Mesopotamia', date: between(-3400, -3100, -3200, 'century', { method: 'archaeological' }), field: 'culture', summary: 'Cuneiform emerges in Sumer, usually dated to about 3400–3100 BCE.', topicIds: [] },
    { id: 'ev_print', title: 'Gutenberg’s printing press', date: between(1436, 1451, 1440, 'decade'), field: 'technology', summary: 'Movable-type printing in Mainz; the exact year it first worked is not recorded.', topicIds: [] },
    { id: 'ev_principia', title: 'Newton publishes Principia', date: onDay(1687, 7, 5), field: 'science', summary: 'Laws of motion and universal gravitation.', topicIds: [] },
    { id: 'ev_ww1', title: 'World War I begins', date: onDay(1914, 7, 28), field: 'politics', summary: 'Austria-Hungary declares war on Serbia, 28 July 1914.', topicIds: [] },
    { id: 'ev_penicillin', title: 'Penicillin discovered', date: inMonth(1928, 9), field: 'medicine', summary: 'Alexander Fleming notices mould killing bacteria, September 1928.', topicIds: [] },
    // This event's date is itself disputed — see topic t_ww2_start below.
    { id: 'ev_ww2', title: 'World War II begins', date: onDay(1939, 9, 1), field: 'politics', summary: 'Germany invades Poland, 1 September 1939 — the usual start date. Some historians start the war in Asia, earlier.', topicIds: ['t_ww2_start', 't_ukwin', 't_churchill'] },
    { id: 'ev_ww2end', title: 'World War II ends', date: onDay(1945, 9, 2), field: 'politics', summary: 'Japan signs the Instrument of Surrender, 2 September 1945.', topicIds: [] },
    // Famine dates are usually given as 1943–44; uncited here, like the other seed dates.
    { id: 'ev_bengal', title: 'Bengal famine', date: between(1943, 1945, 1943.6, 'year'), field: 'politics', summary: 'Famine in Bengal, British India, during the Second World War.', topicIds: [] },
    { id: 'ev_india', title: 'Indian independence', date: onDay(1947, 8, 15), field: 'politics', summary: '15 August 1947.', topicIds: [] },
    { id: 'ev_suez', title: 'Suez Crisis', date: onDay(1956, 10, 29), field: 'politics', summary: 'Israel invades Sinai on 29 October 1956; Britain and France follow.', topicIds: [] },
    { id: 'ev_moon', title: 'Apollo 11 Moon landing', date: onDay(1969, 7, 20), field: 'technology', summary: '20 July 1969.', topicIds: ['t_moon'] },
    { id: 'ev_eec', title: 'UK joins the EEC', date: onDay(1973, 1, 1), field: 'economics', summary: '1 January 1973.', topicIds: [] },
    { id: 'ev_www', title: 'World Wide Web proposed', date: inMonth(1989, 3), field: 'technology', summary: 'Tim Berners-Lee’s proposal at CERN, March 1989.', topicIds: [] },
    { id: 'ev_brexit', title: 'UK votes to leave the EU', date: onDay(2016, 6, 23), field: 'politics', summary: 'Referendum of 23 June 2016.', topicIds: [] },
    { id: 'ev_drugx', title: '[Demo] Drug X approved', date: inMonth(2018, 3, { method: 'community' }), field: 'medicine', summary: 'A fictional drug used to demo trust weighting.', topicIds: ['t_drugx'] },
    { id: 'ev_covid', title: 'COVID-19 declared a pandemic', date: onDay(2020, 3, 11), field: 'medicine', summary: 'WHO declaration, 11 March 2020.', topicIds: [] },
    { id: 'ev_platform', title: 'Infinity Timeline launches', date: inMonth(2026, 7, { method: 'community' }), field: 'culture', summary: 'This platform — its funding is on the timeline too.', topicIds: [] },
  ],

  topics: [
    // A date dispute: `dateOf` means the claims below each propose a date for ev_ww2.
    { id: 't_ww2_start', eventId: 'ev_ww2', dateOf: 'ev_ww2', title: 'When did WW2 actually begin?', claimIds: ['c_start_1939', 'c_start_1937', 'c_start_1931'] },
    { id: 't_ukwin', eventId: 'ev_ww2', title: 'Did the UK “win” WW2 if it lost its empire?', claimIds: ['c_empire', 'c_lost'] },
    { id: 't_churchill', eventId: 'ev_ww2', title: 'Churchill: hero, villain, or both?', claimIds: ['c_leader', 'c_bengal', 'c_villain'] },
    { id: 't_moon', eventId: 'ev_moon', title: 'Was the Moon landing staged?', claimIds: ['c_staged'] },
    { id: 't_drugx', eventId: 'ev_drugx', title: '[Demo] Is Drug X safe and effective?', claimIds: ['c_drugx', 'c_hidden'] },
  ],

  claims: [
    // Date-dispute claims: each proposes a start date for WW2 and earns a status from evidence.
    claim({ id: 'c_start_1939', topicId: 't_ww2_start', text: 'WW2 began on 1 September 1939, when Germany invaded Poland.', claimantId: 'e_histA', agree: { up: 1210, down: 160 },
      proposedDate: onDay(1939, 9, 1, { sources: ['s24'] }) }),
    claim({ id: 'c_start_1937', topicId: 't_ww2_start', text: 'WW2 began on 7 July 1937, when full-scale war between Japan and China broke out.', claimantId: 'e_histB', agree: { up: 380, down: 290 },
      proposedDate: onDay(1937, 7, 7, { sources: ['s22', 's25'] }),
      steelman: 'The Sino-Japanese war merged into the wider war without a break; starting the clock in Europe reflects a Eurocentric view.',
      falsifiableBy: 'Evidence that participants at the time treated the Asian and European wars as separate conflicts until December 1941.' }),
    claim({ id: 'c_start_1931', topicId: 't_ww2_start', text: 'WW2 really began with Japan’s invasion of Manchuria in September 1931.', claimantId: 'e_user', agree: { up: 95, down: 260 },
      proposedDate: inMonth(1931, 9, { method: 'community', sources: ['s23'] }) }),

    claim({ id: 'c_empire', topicId: 't_ukwin', text: 'The British Empire largely dissolved in the decades after 1945.', claimantId: 'e_histA', agree: { up: 812, down: 41 } }),
    claim({ id: 'c_lost', topicId: 't_ukwin', text: 'The UK effectively lost WW2.', claimantId: 'e_user', agree: { up: 233, down: 590 },
      steelman: 'Britain ended the war bankrupt, dependent on US loans, and lost its empire and superpower status within a generation — by long-run outcomes it lost.',
      falsifiableBy: 'If "winning" means the war aims (defeat of Germany, survival of Britain) were met, the formal Axis surrenders refute it.',
      childClaimIds: ['c_peace'] }),
    claim({ id: 'c_peace', topicId: 't_ukwin', parentClaimId: 'c_lost', stance: 'refines', text: 'Military victory, but the war’s cost accelerated economic decline (“won the war, lost the peace”).', claimantId: 'e_histB', agree: { up: 640, down: 180 }, childClaimIds: ['c_before'] }),
    claim({ id: 'c_before', topicId: 't_ukwin', parentClaimId: 'c_peace', stance: 'refines', text: 'Britain’s relative economic decline had already begun before 1939.', claimantId: 'e_histA', agree: { up: 301, down: 95 } }),

    claim({ id: 'c_leader', topicId: 't_churchill', text: 'Churchill’s leadership was decisive in Britain continuing the fight in 1940.', claimantId: 'e_histA', agree: { up: 920, down: 210 } }),
    claim({ id: 'c_bengal', topicId: 't_churchill', text: 'The UK war cabinet’s policies worsened the 1943 Bengal famine.', claimantId: 'e_journo', agree: { up: 701, down: 388 } }),
    claim({ id: 'c_villain', topicId: 't_churchill', text: 'Churchill should be judged primarily as a villain.', claimantId: 'e_user', agree: { up: 455, down: 610 },
      steelman: 'His record on empire, Bengal, and views on race outweigh his wartime role.' }),

    claim({ id: 'c_staged', topicId: 't_moon', text: 'The 1969 Apollo 11 Moon landing was staged.', claimantId: 'e_user', agree: { up: 140, down: 2210 },
      steelman: 'Cold War pressure gave a motive to fake it; some photos show odd shadows and no stars; 1960s computing seemed too primitive.',
      falsifiableBy: 'Independently verifiable hardware on the Moon — e.g. laser retroreflectors anyone can range, or orbital photos from other nations’ probes.' }),

    claim({ id: 'c_drugx', topicId: 't_drugx', text: '[Demo] Drug X is safe and effective for Condition Y.', claimantId: 'e_pharma', agree: { up: 380, down: 520 },
      statusHistory: [{ at: 2018.2, status: 'Established' }, { at: 2021.5, status: 'Contested' }] }),
    claim({ id: 'c_hidden', topicId: 't_drugx', text: '[Demo] Adverse events were under-reported in Drug X’s original trial.', claimantId: 'e_journo', agree: { up: 910, down: 120 },
      statusHistory: [{ at: 2019.1, status: 'Fringe' }, { at: 2021.5, status: 'Contested' }, { at: 2024.2, status: 'Established' }] }),
  ],

  // Papers, books, documents and posts. All demo placeholders here.
  sources: [
    src({ id: 's1', title: '[Demo] The End of Empire, 1945–1980', type: 'book', publishedAt: 2005, authorIds: ['e_histA'], institutionId: 'e_press', funderIds: ['e_uni'] }),
    src({ id: 's2', title: '[Demo] Decolonisation timelines: a dataset', type: 'peer_reviewed', publishedAt: 2014, authorIds: ['e_histA'], institutionId: 'e_uni', funderIds: ['e_gov'] }),
    src({ id: 's3', title: '[Demo] Independence acts archive', type: 'primary_document', publishedAt: 1947.6, authorIds: [], funderIds: ['e_gov'] }),
    src({ id: 's4', title: '[Demo] “Britain lost the war” — opinion column', type: 'op_ed', publishedAt: 2019, authorIds: ['e_journo'], funderIds: [] }),
    src({ id: 's5', title: '[Demo] Instruments of surrender, 1945', type: 'primary_document', publishedAt: 1945.6, authorIds: [], funderIds: ['e_gov'] }),
    src({ id: 's6', title: '[Demo] Post-war British growth in comparative perspective', type: 'peer_reviewed', publishedAt: 2016, authorIds: ['e_histB'], institutionId: 'e_tank', funderIds: ['e_tank'] }),
    src({ id: 's7', title: '[Demo] Victory and its price', type: 'book', publishedAt: 2010, authorIds: ['e_histA'], institutionId: 'e_press', funderIds: ['e_uni'] }),
    src({ id: 's8', title: '[Demo] Britain’s industrial share, 1870–1939', type: 'peer_reviewed', publishedAt: 2008, authorIds: ['e_histB', 'e_histA'], institutionId: 'e_uni', funderIds: ['e_gov'] }),
    src({ id: 's9', title: '[Demo] War cabinet minutes, 1940', type: 'primary_document', publishedAt: 1940.4, authorIds: [], funderIds: ['e_gov'] }),
    src({ id: 's10', title: '[Demo] Grain exports and famine, 1943', type: 'peer_reviewed', publishedAt: 2019, authorIds: ['e_histA'], institutionId: 'e_uni', funderIds: ['e_found'] }),
    src({ id: 's11', title: '[Demo] Weather, war and famine in Bengal', type: 'peer_reviewed', publishedAt: 2020, authorIds: ['e_histB'], institutionId: 'e_tank', funderIds: ['e_tank'] }),
    src({ id: 's12', title: '[Demo] Viral thread: “Look at the shadows”', type: 'social_post', publishedAt: 2021, authorIds: ['e_user'], funderIds: [] }),
    src({ id: 's13', title: '[Demo] Isotopic analysis of returned lunar samples', type: 'peer_reviewed', publishedAt: 1999, authorIds: ['e_drC'], institutionId: 'e_uni', funderIds: ['e_gov'] }),
    src({ id: 's14', title: '[Demo] Laser ranging to Apollo retroreflectors', type: 'primary_document', publishedAt: 2010, authorIds: [], institutionId: 'e_uni', funderIds: ['e_gov'] }),
    src({ id: 's15', title: '[Demo] Phase III trial of Drug X', type: 'rct', publishedAt: 2017, authorIds: ['e_drD'], institutionId: 'e_pharma', funderIds: ['e_pharma'], conflictOfInterest: 'Funder sells Drug X' }),
    src({ id: 's16', title: '[Demo] Drug X follow-up cohort', type: 'peer_reviewed', publishedAt: 2019, authorIds: ['e_drD'], institutionId: 'e_uni', funderIds: ['e_found'] }),
    src({ id: 's17', title: '[Demo] Independent replication of Drug X trial', type: 'rct', publishedAt: 2021, authorIds: ['e_drC'], institutionId: 'e_uni', funderIds: ['e_gov'] }),
    src({ id: 's18', title: '[Demo] Meta-analysis of Drug X outcomes', type: 'meta_analysis', publishedAt: 2023, authorIds: ['e_drC'], institutionId: 'e_uni', funderIds: ['e_gov'] }),
    src({ id: 's19', title: '[Demo] Leaked trial documents investigation', type: 'journalism', publishedAt: 2019, authorIds: ['e_journo'], funderIds: [] }),
    src({ id: 's20', title: '[Demo] Regulator inspection report on Drug X trial', type: 'primary_document', publishedAt: 2024, authorIds: [], funderIds: ['e_gov'] }),
    // Sources for the "When did WW2 begin?" date dispute.
    src({ id: 's21', title: '[Demo] Europe goes to war: the diplomacy of 1939', type: 'book', publishedAt: 2001, authorIds: ['e_histA'], institutionId: 'e_press', funderIds: ['e_uni'] }),
    src({ id: 's22', title: '[Demo] The first front: China and the global war', type: 'peer_reviewed', publishedAt: 2013, authorIds: ['e_histB'], institutionId: 'e_uni', funderIds: ['e_gov'] }),
    src({ id: 's23', title: '[Demo] Forum post: “It all started in Manchuria”', type: 'social_post', publishedAt: 2022, authorIds: ['e_user'], funderIds: [] }),
    src({ id: 's24', title: '[Demo] Declarations of war, September 1939', type: 'primary_document', publishedAt: 1939.7, authorIds: [], funderIds: ['e_gov'] }),
    src({ id: 's25', title: '[Demo] A military chronology of East Asia, 1931–1945', type: 'peer_reviewed', publishedAt: 2017, authorIds: ['e_histA'], institutionId: 'e_uni', funderIds: ['e_gov'] }),
  ],

  // Evidence links a source to a claim. Arguments: id, claim, source, for/against, relevance 0..1, note, well-sourced up/down votes.
  evidence: [
    ev('x1', 'c_empire', 's1', 'for', 0.9, 'Narrative history of decolonisation.'),
    ev('x2', 'c_empire', 's2', 'for', 0.9, 'Dataset of independence dates.'),
    ev('x3', 'c_empire', 's3', 'for', 1, 'Primary legal documents.', 40, 1),

    ev('x4', 'c_lost', 's4', 'for', 0.6, 'Argues long-run outcomes = defeat.', 12, 30),
    ev('x5', 'c_lost', 's5', 'against', 1, 'Axis formally surrendered.', 60, 2),
    ev('x6', 'c_lost', 's7', 'against', 0.8, 'War aims were achieved.'),

    ev('x7', 'c_peace', 's6', 'for', 0.8, 'War debt slowed post-war growth.', 18, 10),
    ev('x8', 'c_peace', 's7', 'for', 0.6, 'Costs of victory.'),
    ev('x9', 'c_peace', 's8', 'against', 0.7, 'Decline predates the war.'),

    ev('x10', 'c_before', 's8', 'for', 0.9, 'Industrial share falling from 1870s.'),
    ev('x11', 'c_before', 's6', 'for', 0.8, 'Comparative growth data.'),

    ev('x12', 'c_leader', 's9', 'for', 0.9, 'Cabinet debate on negotiating, May 1940.'),
    ev('x13', 'c_leader', 's7', 'for', 0.7, 'Secondary analysis.'),
    ev('x14', 'c_leader', 's4', 'against', 0.4, 'Argues others drove the decision.', 8, 15),

    ev('x15', 'c_bengal', 's10', 'for', 0.9, 'Exports and shipping decisions.'),
    ev('x16', 'c_bengal', 's1', 'for', 0.5, 'Chapter on wartime India.'),
    ev('x17', 'c_bengal', 's11', 'against', 0.8, 'Argues weather and war were primary causes.', 15, 14),

    ev('x18', 'c_villain', 's4', 'for', 0.4, 'Opinion piece.', 10, 12),

    ev('x19', 'c_staged', 's12', 'for', 0.5, 'Points to photo shadows.', 30, 400),
    ev('x20', 'c_staged', 's13', 'against', 0.9, 'Samples could not be made on Earth.', 90, 5),
    ev('x21', 'c_staged', 's14', 'against', 1, 'Anyone with a telescope + laser can verify.', 120, 3),

    ev('x22', 'c_drugx', 's15', 'for', 1, 'Original manufacturer trial.', 30, 60),
    ev('x23', 'c_drugx', 's16', 'for', 0.7, 'Follow-up cohort.'),
    ev('x24', 'c_drugx', 's17', 'against', 1, 'Independent replication found smaller effect and more harms.', 70, 8),
    ev('x25', 'c_drugx', 's18', 'against', 1, 'Meta-analysis: benefit not significant.', 80, 6),

    ev('x26', 'c_hidden', 's19', 'for', 0.8, 'Leaked documents.', 45, 10),
    ev('x27', 'c_hidden', 's17', 'for', 0.8, 'Higher adverse-event rate on replication.'),
    ev('x28', 'c_hidden', 's20', 'for', 1, 'Regulator confirms under-reporting.', 60, 3),
    ev('x29', 'c_hidden', 's15', 'against', 0.6, 'Original trial reported few adverse events.', 5, 40),

    // "When did WW2 begin?" — both main dates have real support, so both stay Contested.
    ev('x30', 'c_start_1939', 's24', 'for', 1, 'Britain and France declare war on Germany within days.', 40, 2),
    ev('x31', 'c_start_1939', 's21', 'for', 0.8, 'Standard European chronology.'),
    ev('x32', 'c_start_1939', 's22', 'against', 0.8, 'The war in China was already under way and later merged with it.'),
    ev('x33', 'c_start_1937', 's22', 'for', 0.9, 'Argues the Asian war is the same conflict.'),
    ev('x34', 'c_start_1937', 's25', 'for', 0.8, 'Continuous fighting from 1937 to 1945.'),
    ev('x35', 'c_start_1937', 's21', 'against', 0.8, 'Contemporaries saw separate regional wars until 1941.', 25, 6),
    ev('x36', 'c_start_1931', 's23', 'for', 0.4, 'Opinion; no new evidence.', 5, 20),
  ],

  // Saved AI answers about claims, with other users' attempts to reproduce them.
  aiSnapshots: [
    { id: 'ai1', claimId: 'c_lost', provider: 'Demo AI Lab A', model: 'demo-model-1', askedAt: '2025-03-14T09:12:00Z',
      prompts: ['Did the UK lose WW2?'], output: '[Demo output] No — the UK was among the victorious Allies, though the war left it economically weakened.',
      submittedBy: 'e_user', reproductions: [{ by: 'user42', at: '2025-03-20T10:00:00Z', result: 'match' }, { by: 'user77', at: '2025-04-02T13:00:00Z', result: 'partial' }] },
    { id: 'ai2', claimId: 'c_lost', provider: 'Demo AI Lab B', model: 'demo-model-2', askedAt: '2026-08-01T21:40:00Z',
      prompts: ['Did the UK lose WW2?', 'But it lost its empire — isn’t that losing?'], output: '[Demo output] Militarily it won; whether the long-run outcome counts as a loss depends on how you define winning.',
      submittedBy: 'user42', reproductions: [{ by: 'user9', at: '2026-08-03T08:00:00Z', result: 'differs' }] },
    { id: 'ai3', claimId: 'c_staged', provider: 'Demo AI Lab A', model: 'demo-model-1', askedAt: '2025-06-01T12:00:00Z',
      prompts: ['Was the moon landing fake?'], output: '[Demo output] No. Multiple independent lines of evidence, including retroreflectors still used today, confirm it.',
      submittedBy: 'user9', reproductions: [{ by: 'user12', at: '2025-06-02T12:00:00Z', result: 'match' }] },
    { id: 'ai4', claimId: 'c_drugx', provider: 'Demo AI Lab A', model: 'demo-model-1', askedAt: '2019-05-01T12:00:00Z',
      prompts: ['Is Drug X safe?'], output: '[Demo output] Drug X was approved after a Phase III trial showing benefit with a favourable safety profile.',
      submittedBy: 'user12', reproductions: [] },
    { id: 'ai5', claimId: 'c_drugx', provider: 'Demo AI Lab A', model: 'demo-model-3', askedAt: '2025-02-10T12:00:00Z',
      prompts: ['Is Drug X safe?'], output: '[Demo output] Later independent studies and a regulator report raised concerns; the original trial was industry-funded.',
      submittedBy: 'user12', reproductions: [{ by: 'user42', at: '2025-02-11T12:00:00Z', result: 'match' }] },
  ],

  // Public opinion over time. FICTIONAL numbers — never present these as real polls.
  opinions: [
    { id: 'o1', topicId: 't_ukwin', title: '[DEMO DATA] Agree: “Britain won the war but lost the peace”', unit: '%', demo: true,
      points: [1950, 1957, 1965, 1975, 1985, 1995, 2005, 2016, 2020, 2025].map((at, i) => ({ at, value: [18, 31, 35, 44, 41, 38, 40, 52, 55, 58][i], source: 'Fictional demo poll' })),
      linkedEventIds: ['ev_india', 'ev_suez', 'ev_eec', 'ev_brexit'] },
    { id: 'o2', topicId: 't_drugx', title: '[DEMO DATA] Public confidence in Drug X', unit: '%', demo: true,
      points: [2018.3, 2019, 2019.5, 2020.5, 2021.5, 2022.5, 2024.3, 2026].map((at, i) => ({ at, value: [71, 68, 52, 49, 40, 37, 22, 20][i], source: 'Fictional demo poll' })),
      linkedEventIds: ['ev_drugx', 'ev_covid'] },
  ],

  // Typed links between events — what topic rivers are made of. DEMO: who proposed each link,
  // its sources and its votes are fictional; the strong/weak mix is there to show how votes
  // change link strength. wd_Q154720 (Battle of Britain) comes from the Wikidata import in data/.
  // Arguments: id, from, to, type, note, proposed by, sources, well-sourced [up, down], agree [up, down].
  links: [
    link('l_ww2_bob', 'ev_ww2', 'wd_Q154720', 'led_to', '[Demo] Britain fights on after the fall of France.', 'e_histA', ['s9', 's7'], [40, 3], [610, 40]),
    link('l_bob_bengal', 'wd_Q154720', 'ev_bengal', 'led_to', '[Demo] Argued link: wartime shipping and food priorities.', 'e_journo', ['s10'], [6, 18], [300, 260]),
    link('l_bengal_end', 'ev_bengal', 'ev_ww2end', 'led_to', '[Demo] The famine overlapped the last years of the war in Asia.', 'e_histB', ['s11'], [5, 15], [150, 140]),
    link('l_end_india', 'ev_ww2end', 'ev_india', 'led_to', '[Demo] A war-weakened Britain moves towards leaving India.', 'e_histA', ['s1', 's2'], [35, 4], [700, 80]),
    link('l_india_suez', 'ev_india', 'ev_suez', 'led_to', '[Demo] Decolonisation reshapes Britain’s position east of Suez.', 'e_histA', ['s1'], [22, 6], [420, 150]),
  ],
};

// Back-fill evidenceIds on claims from the evidence list.
for (const c of seed.claims) c.evidenceIds = seed.evidence.filter((e) => e.claimId === c.id).map((e) => e.id);
