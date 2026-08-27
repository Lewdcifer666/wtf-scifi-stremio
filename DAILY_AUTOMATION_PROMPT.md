# Daily Full-Automation Prompt

This scheduled task is configured for `Lewdcifer666/wtf-scifi-stremio`.

**This file is the canonical copy of the live ChatGPT scheduled-task prompt.**
It is installed manually; if the two ever disagree, the live task is what runs
and this file is stale. Keep them identical.

Feedback schema v2 (Feedback v2 + Content DNA phase, F2-5) is reflected below.
The interpretation layer changed; the history-resolution, deduplication,
discovery-file and reporting behaviour did not.

```text
Read BOTH GitHub repositories before making any recommendation decisions.

PUBLIC CATALOG REPOSITORY:
Lewdcifer666/wtf-scifi-stremio
Read data/taste-profile.json, data/library.json, data/rejections.json, data/discovery-log.json, and all existing JSON files under data/discoveries/.

PRIVATE FEEDBACK REPOSITORY:
Lewdcifer666/wtf-scifi-feedback
Read all JSON feedback events under data/feedback/**.

Treat data/taste-profile.json as the stable baseline taste profile and data/feedback/** as cumulative real-world viewing evidence that can refine how the baseline is interpreted. Never rewrite the private feedback history and never expose private free-text feedback verbatim in the final report. The private repository is READ-ONLY: never commit, modify, delete or reorganise anything in it.

RUN WITHIN AN EXECUTION BUDGET. FINISHING CORRECTLY BEATS RESEARCHING MORE.

This run has a limited working window. A run that researches many candidates and then commits NOTHING is a failed run; a run that publishes three fully validated titles is a successful one. Structure the work in three phases and protect the last one.

PHASE A - LOAD AND RESOLVE. Do every mandatory read once: the public source data, the private feedback events, the feedback resolution, the Content DNA policy, and the public identity set. Complete this before any candidate research.

PHASE B - CANDIDATE DISCOVERY. Search efficiently, and STOP searching as soon as either of these is true:
- you already hold enough qualifying candidates to fill daily_movie_max and daily_series_max, or
- roughly HALF of the available working time has elapsed.
Do not keep searching to inflate the searched or rejected counts. Zero findings is valid, and fewer than the daily caps is valid.

PHASE C - FINALIZATION HAS PRIORITY. Once roughly half the window has elapsed, or once viable candidates exist, stop researching and finalize: select candidates, complete their Content DNA, regenerate personalized-scores.json, re-check duplicates, validate the whole intended public state, commit once, and report.

If time becomes constrained, REDUCE THE NUMBER OF NEW DISCOVERIES rather than sacrificing finalization. If five candidates are available but only three can be fully researched and validated safely, publish those three. Never lower minimum_match_score to save time, and never publish a title whose Content DNA was not properly researched. Always preserve enough execution time for final validation and the single transactional public commit. Completing a smaller valid run is better than researching more candidates and publishing nothing.

READ EACH SOURCE ONCE AND REUSE IT.

Within a single run, fetch each required repository data source once and keep the parsed result for the rest of the run. Do not re-fetch the same library or discovery ranges repeatedly, and do not rebuild the same public identity set from scratch more than necessary - build it once in PHASE A and reuse it throughout PHASE B.

The ONE mandatory exception is the final duplicate re-check immediately before the write, which must always be fresh against the current state of the public repository.

Do not download or rebuild the generated GitHub Pages site or any release archive to obtain information that is already present in the source JSON and config files. Everything the run needs is in data/ and config/.

PREFER THE REPOSITORY'S OWN DETERMINISTIC LOGIC.

The public repository already contains the authoritative implementation of every deterministic calculation this task needs:

- scripts/dna-score.mjs        DNA eligibility, hard exclusions, guardrail points, archetype selection, baseline content score
- scripts/personalized-scores.mjs  the reader contract for the personalized file
- scripts/identity.mjs         the public identity rule
- config/catalogs.json         row definitions and thresholds
- data/taste-profile.json      the registry, weights, archetypes and completeness policy

If a code-execution tool is available in this run, RUN that repository logic instead of reproducing the arithmetic through step-by-step reasoning. Reasoning through a twenty-three term weighted sum plus six archetype evaluations for every watch title is the single most expensive thing this task can do, and the repository already computes it exactly.

If no code-execution tool is available, follow the documented formulas as written - the result must be identical either way. What must never happen is re-deriving the same deterministic value repeatedly for the same title, or hand-encoding large tables of profile constants into reasoning when they can be read directly.

The judgement this task genuinely owns is deriving the personalized content and tone preferences from the private feedback, and researching candidate titles. Everything downstream of those inputs is arithmetic the repository can do.

RESOLVE FEEDBACK EVENT HISTORY BEFORE USING IT FOR TASTE LEARNING.

0. Resolve the graph BEFORE interpreting any schema-specific opinion field. Chain topology is decided by feedback_id and supersedes alone. Never drop an event from the graph because you cannot interpret its opinion fields.
1. Parse every feedback event first and build a global feedback_id -> event map.
2. Resolve supersedes links GLOBALLY before grouping by title identity. A supersedes edge is authoritative even when source_id/imdb_id metadata changes between events.
3. Determine chain tips globally: a tip is an event whose feedback_id is not superseded by another event. A supersedes reference whose parent is missing must not invalidate the newer event; delivery can be out of order.
4. Only after resolving chains, consolidate current tips by stable identity: prefer non-null imdb_id, otherwise source_id. If independent chain tips still resolve to the same identity, use the newest rated_at; break exact ties deterministically by feedback_id.
5. rated_at is when the user formed the opinion. received_at is transport/audit timing only and MUST NOT affect preference weighting or chain precedence except that it may be used for diagnostics.

RETRACTION / DELETE SEMANTICS:
- status="retracted" is an append-only tombstone meaning the user has deleted/revoked that opinion.
- A retracted chain tip means there is NO active feedback for that title. Do not use the retracted event OR any earlier event in that chain as positive, negative, neutral, or weak historical taste evidence.
- A retraction fully removes every revoked field from the active taste model. For schema 1 that means rating, more_like_this, liked, disliked, DNF interpretation and free-text interpretation. For schema 2 that additionally means premise_interest and dnf_reasons. Nothing from the revoked chain survives in any form.
- If a later rating supersedes a retraction, the later active rating is valid again. Use the later rating normally, but do NOT resurrect or use pre-retraction opinions as weak context. Evidence before the most recent retraction boundary is revoked.
- Example chain: rating A -> retraction B -> rating C. Current active opinion is C only. A and B contribute zero taste weight.
- If a title's latest effective event is retracted and there is no later active event, treat that title as not actively rated for feedback-derived recommendation weighting.

FEEDBACK EVENTS CARRY A SCHEMA VERSION. HONOUR IT.

Every event has an explicit integer schema_version. Currently supported feedback schemas are 1 and 2. Read each event under the rules of its own version and never treat the two as equivalent. Do not assume a missing or unexpected version.

UNSUPPORTED SCHEMAS (anything that is not 1 or 2, including future schemas):

An unsupported event must NOT be discarded before chain resolution. Discarding it would let an older, already-superseded opinion become active again, which silently resurrects taste the user had replaced or revoked. That is the one mistake this rule exists to prevent.

- Every structurally usable event participates in the global feedback_id map and the supersedes graph, whatever its schema. Its feedback_id, supersedes, source_id, imdb_id and rated_at are used for topology, identity and deduplication when they are valid.
- Its opinion semantics are unknown, so it contributes ZERO taste-learning weight. Never interpret unknown fields and never guess what they mean.
- Never fall back to an older superseded known-schema opinion because the newest event is unreadable.
- If the current effective tip for an identity uses an unsupported schema, treat that title's current opinion as OPAQUE — unavailable for learning, and neither positive nor negative.
- For deduplication, if an unsupported current tip resolves to an imdb_id or source_id, conservatively treat that identity as already feedback-associated, so the title is not offered as a brand-new discovery merely because the newest feedback cannot be read.
- Count unsupported-schema events in your private diagnostic reasoning and note the count in the run record. Never expose their raw fields.

Worked example. A = schema 2 rating, B = schema 3 event superseding A. B remains the chain tip; A does NOT return as active evidence; B contributes no interpreted preference; the title is conservatively excluded from new-title discovery. The same holds for A = rating, B = retraction, C = unsupported event superseding B: do not resurrect A, and do not treat B as the current opinion.

SCHEMA 1 (historical events):
- rating: the user's overall signal for that title.
- more_like_this (yes/maybe/no/null): the LEGACY recommendation signal. It is still usable evidence, but it is weaker and semantically ambiguous: a single "no" could have meant bad acting, bad pacing, a boring monster, poor effects, disliking the premise, or not wanting the subject matter again. Never treat it as a precise statement about the premise, and never let it alone blacklist a subject, setting or topic.
- NEVER convert or infer v1 more_like_this into v2 premise_interest. Historical v1 events did not contain that separation and must not be retrofitted with it.
- liked/disliked: the old vocabularies. Interpret them using the legacy rules below.
- A v1 did_not_finish event stores its abandonment reasons inside disliked.

SCHEMA 2 (current events):
- rating: primarily overall TITLE / EXECUTION quality — how good this particular film or series was. It is NOT a vote against the subjects the title happens to contain.
- premise_interest (yes/maybe/no/null): the explicit content-neighbourhood preference, and the single strongest signal about whether to keep exploring this kind of idea. "yes" = this premise neighbourhood is wanted; "maybe" = weak positive, keep exploring; "no" = negative evidence for this specific premise combination; null = no content-preference inference at all.
- more_like_this is always null on schema 2 and contributes no signal whatsoever.
- liked/disliked: aspect-level evidence drawn from one shared vocabulary. An aspect can never appear on both sides of the same event. Interpret each aspect according to its REGISTRY CATEGORY (below).
- dnf_reasons: why viewing stopped. Present only on did_not_finish events; empty otherwise.

ASPECT REGISTRY AND CATEGORIES (schema 2).

EXECUTION — affects execution-fit only. A thumbs-down here says the title was made badly. It must NEVER make the corresponding subject, setting or topic less eligible for recommendation:
acting, characters, dialogue, pacing, visuals, effects, ending_payoff, sound_music, originality

CONCEPT — may refine content preference. Generalise conservatively and preferably only on repeated independent evidence:
premise_concept, mystery, science_biology, alien_unknown, scientific_investigation, world_rules, concept_escalation, weirdness, reality_time_anomaly, mind_consciousness, experiments, conspiracy, creature_threat

TONE — soft style/presentation preference. Repeated evidence required before it generalises at all, and it NEVER becomes a hard subject blacklist:
setting_atmosphere, suspense, horror, action, humor, emotion, survival_chase, military_focus

Notes that matter:
- creature_threat and survival_chase are independent. Disliking "the film became a chase" is not disliking creatures, and vice versa.
- A thumbs-down on a TONE aspect (for example horror or survival_chase) may soften ranking for titles whose presentation leans that way. It must not exclude titles on subject matter.
- A thumbs-down on a CONCEPT aspect is real content evidence, but one title is not enough to establish a generalised aversion to that concept.

DID NOT FINISH:
- A did_not_finish active event is a strong TITLE-LEVEL negative signal: this particular title was not worth finishing.
- It must NEVER automatically poison the title's subjects, settings, concepts or content neighbourhood. Abandoning one badly made film about scientists does not make scientists unwanted.
- Read dnf_reasons on schema 2, and legacy abandonment ids inside disliked on schema 1.
- If the same did_not_finish event also carries premise_interest, that premise answer is the content signal; the abandonment is the execution signal.

The six schema-2 dnf_reasons are: boring, lost_interest, mystery_going_nowhere, too_confusing, too_slow_to_start, not_what_i_expected. All six are TITLE-LEVEL abandonment explanations. None of them alone changes topic or content eligibility.
- mystery_going_nowhere does NOT mean "dislikes mystery". It is a complaint that this title's mystery failed to develop.
- too_confusing does NOT mean "dislikes complex or high-concept stories". It is a clarity problem in this title.
- too_slow_to_start is an execution/pacing complaint about this title and does NOT establish a general rejection of slower titles.
- not_what_i_expected is intentionally ambiguous. NEVER infer premise_interest=no from it; premise_interest remains the authoritative content-neighbourhood answer.
- lost_interest and boring are title-level negatives. Do not infer WHICH subject or concept caused the loss of interest unless explicit premise or aspect evidence says so.
If a schema-2 did_not_finish event also carries premise_interest, liked or disliked, those explicit structured fields supply the corresponding content and aspect semantics.

LEGACY TAG SEMANTICS (schema 1 events).

A. Lossless equivalences — SIDE-SPECIFIC. These are not generic bidirectional replacements. Each mapping is proven lossless only on the side shown, because the historical tags encoded their own polarity.

Only when the legacy id appears in liked:
biology -> science_biology
rule_discovery -> world_rules
impossible_system -> world_rules
fast_pacing -> pacing
great_payoff -> ending_payoff
time_reality -> reality_time_anomaly

Only when the legacy id appears in disliked:
too_slow -> pacing
boring_middle -> pacing
too_much_action -> action
too_much_horror -> horror
psychological_horror -> horror
weak_payoff -> ending_payoff
monster_chase -> survival_chase
weak_characters -> characters

If a legacy id appears on a side where its equivalence is not listed above, DO NOT map it. Treat that occurrence conservatively as legacy/unmapped evidence under rule D instead. For example liked=["too_slow"] must NOT become a thumbs-up on pacing: the proven equivalence describes only the historical negative tag disliked=["too_slow"] -> thumbs-down on pacing. This keeps the losslessness rule intact even for malformed, hand-edited or unexpected historical files.

monster_chase maps to survival_chase and NEVER to creature_threat.

B. Known non-normalisable legacy semantics — read these by their actual historical meaning, never inverted:
- not_enough_mystery = the title did not have enough mystery. This is weak evidence that MORE mystery is desirable. It is NEVER "the user dislikes mystery".
- not_enough_discovery = the title did not have enough discovery or rule-learning. Weak evidence that more discovery is desirable. NEVER "the user dislikes world_rules".
- repetitive = a title/execution-level negative about lack of progression. Do not blacklist the title's content subjects.
- too_ambiguous = a title-level clarity/payoff complaint. Do not turn it into a dislike of mystery or of ending_payoff.

C. Legacy v1 DNF reasons. Schema 1 stored abandonment reasons inside disliked, so these ids are KNOWN and must never be treated as unknown. The historical vocabulary is nine ids, handled in three groups.

True abandonment reasons — title-level only, with no aspect equivalent:
- boring = the title failed to hold interest. Strong negative evidence about this particular title. Must NOT blacklist its subjects, settings or premise.
- mystery_going_nowhere = the mystery/discovery progression failed to develop sufficiently. This must NEVER mean "the user dislikes mystery". If anything it is consistent with wanting meaningful mystery progression, but do not turn a single occurrence into a general content preference.
- too_confusing = a clarity, comprehension or execution problem in this title. It must NOT mean the user dislikes weirdness, mystery, reality anomalies, mind/consciousness stories or complex concepts.

Lossless aspect equivalents — already covered by rule A and side-specific in the same way (all appear in disliked):
weak_characters -> characters; too_slow -> pacing; too_much_action -> action; too_much_horror -> horror; monster_chase -> survival_chase.

Known non-normalisable — already covered by rule B:
not_enough_mystery = weak evidence that MORE mystery was wanted, NEVER "the user dislikes mystery".

Together these nine ids are the complete historical v1 DNF vocabulary, so none of them falls through to rule D.

D. Unknown ids. An id is truly unknown only when it is NOT any of the following:
- a canonical schema-2 aspect,
- a known lossless legacy alias on its valid side,
- a known non-normalisable legacy semantic,
- a known v1 DNF reason,
- a known schema-2 dnf_reason.
Only for an id that fails all five tests: read conservatively, preserve it as historical evidence, invent no semantics for it, do not generalise from it, and never print the raw id in any public output.

EVIDENCE WEIGHTING.

The stable baseline taste profile remains dominant. Do not make hard preference changes from a single title.

- 1 independent title with an explicit signal = weak evidence.
- 2 independent titles with the same explicit signal = an emerging preference.
- 3 or more independent titles with a consistent explicit signal = a meaningful learned preference.

This is a confidence principle, not a mechanical formula. Alongside it:
- Structured schema-2 fields outrank speculative interpretation of free text.
- Explicit premise_interest outranks genre inference.
- Repeated explicit evidence outranks any single event.
- Execution feedback stays separated from content preference and never changes topic eligibility.
- Tone feedback stays soft.
- Superseded edits within one active chain are not independent votes; they may be used only as very weak context that the opinion changed.
- Free-text feedback remains high-value qualitative evidence. Infer WHY the user liked or disliked a title rather than transferring its genre wholesale. Praise for suspense and mystery strengthens those qualities, not the title's unrelated genres.

CORE GUARDRAILS ARE STRUCTURAL.

The baseline exclusions and strong penalties are not learnable away by ordinary feedback noise. Material whose CENTRAL STORY IDENTITY is any of the following stays strongly penalised or excluded regardless of accumulated feedback:
- superhero-first
- comic-book-universe-first
- space-opera-first
- franchise-war-saga-first
- generic action-first military science fiction

Judge this by structural and story identity — costumed or superpowered hero structure, cinematic-universe-first storytelling, saga/war framing, spectacle-over-investigation — not only by franchise names. Known franchises listed in hard_exclusions are additionally excluded by name.

Accumulated feedback may adjust SOFT preferences around these areas (for example how much action or horror presentation is tolerated). It must never silently redefine the core taste universe. Changing a guardrail requires a deliberate edit of data/taste-profile.json, not a run of this task.

A SECOND RUN ON THE SAME UTC DATE IS VALID.

A manual re-run on a date that already has a run is allowed. It must use a new unique run suffix, must not recycle or re-list that date's earlier discoveries, and must search only genuinely new candidates. It may legitimately produce fewer than daily_movie_max movies, fewer than daily_series_max series, or zero new discoveries. It must still regenerate personalized-scores.json and append its run record, provided the run otherwise succeeds.

BUILD THE COMPLETE PUBLIC IDENTITY SET BEFORE ACCEPTING ANYTHING.

Before evaluating candidates, construct the COMPLETE set of public identities that already exist, from data/library.json and EVERY file in data/discoveries/. An identity is the IMDb id when there is a usable one, and otherwise the normalized title plus year plus media type.

Any candidate whose identity is already in that set:
- MUST NOT be written to a discovery file,
- counts toward the run's duplicates count and NEVER toward accepted,
- MUST NOT be given a replacement Content DNA fingerprint, a new match_score, a new reason or any other updated field. The existing public record stands untouched.

Immediately before the final write, rebuild the identity set from the current state of the public repository and re-check every title you are about to write. If something you accepted earlier in the run is now present, drop it and move it to the duplicates count. The repository validator and the site builder both FAIL CLOSED on duplicate identities, so a run that violates this cannot build; prevent the duplicate rather than relying on that failure to catch it.

SEARCH AND SCORING.

Search the current web broadly for movies and series that strongly fit the resulting combined taste model, including older titles and new releases. Prioritize scientific investigation, biology/genetics/ecology/alien organisms, unexplained phenomena, experiments with escalating consequences, impossible systems with discoverable rules, reality/time/memory/consciousness anomalies, and suspense driven by figuring out what is happening. Use active feedback-derived signals to refine this ordering and weighting.

Stay tightly anchored to the positive and negative examples in the baseline taste profile plus the effective CURRENT active feedback. Strongly penalize straightforward monster escape, generic creature features, psychological/torture horror, slashers, space opera, superhero and comic-book-universe material, action-first military sci-fi, repetitive sequels, and slow films that withhold information without meaningful discovery. Accumulated active feedback may move these soft penalties, but never past the structural guardrails above.

Distinguish, as a matter of judgement, between "scientists investigate an unknown organism" and "soldiers shoot generic aliens", and between "the story reveals progressively stranger rules" and "a monster gimmick is introduced once and then chased for ninety minutes". These distinctions matter more than genre labels.

Screen every candidate against the public identity set already built in PHASE A, plus rejections and CURRENT ACTIVE feedback. Do not rebuild that set here - reuse it. Deduplicate primarily by IMDb ID and secondarily by normalized title + year + media type. Never re-add seen, existing, previously discovered, rejected, or currently actively-rated titles as new recommendations. A historical feedback chain whose current tip is retracted is NOT an active rating for this rule; however, public library/discovery/seen/rejection state still independently controls deduplication and must never be overridden by a retraction.

Score candidates from 0-100 against the combined taste model. Only accept candidates meeting the minimum_match_score stored in taste-profile.json. Zero findings is valid; never lower the threshold to meet a quota. Add at most the configured daily_movie_max movies and daily_series_max series.

As soon as you hold enough qualifying candidates to fill both daily caps, STOP SEARCHING and move to finalization. Additional research past that point cannot improve the run and can only cost it the ability to commit.

For every accepted title, verify the correct IMDb ID and prepare a complete item with imdb_id, type, title, year, status="watch", preference=null, rank=null, match_score, controlled tags only, a concise reason explaining the fit, useful aliases if needed, current UTC ISO-8601 added_at, added_by="daily-automation", a discovery_run_id based on today's UTC date plus a short run suffix, and source citing the research sources used AS URLS.

SOURCE PROVENANCE IS MANDATORY AND IS NOT AN EVIDENCE SUMMARY.

reason = the short human-readable card text.
source = the ACTUAL MATERIAL the research rested on, as real http(s) URLs.

Every accepted item must cite AT LEAST TWO DISTINCT USEFUL SOURCES:

  1. a canonical identity / basic premise source
  2. a substantive source that actually supports the stored Content DNA

Use more where more are needed. A REPEATED CITATION IS NOT A SECOND SOURCE:
the count is of DISTINCT normalized URLs, so a lookup that redirects back onto
a page already cited buys nothing, and neither does re-citing the same document
with a different query string or fragment.

Never put a prose evidence summary in source - that belongs in reason. Never
invent a URL. If a citation cannot be produced honestly, drop the title rather
than weaken its provenance; a smaller run is always acceptable.


CONTENT DNA IS REQUIRED ON EVERY ACCEPTED DISCOVERY.

Every accepted title must carry dna, dna_confidence and dna_tags.

Read the authoritative Content DNA contract from data/taste-profile.json on the day of the run. Never restate the registry from memory: the dimension ids, their rubric anchors, the 0..10 scale and the closed tag vocabulary all come from dna_dimensions in that file as it currently stands.

- dna must contain EXACTLY the canonical dimension ids listed in dna_dimensions.dimensions - none added, none omitted.
- Each value is an integer 0..10, or null.
- 0 means assessed and absent or minimal. null means genuinely unknown. Never use null to avoid research effort, and never write 0 for something you did not actually assess.
- dna_confidence is a number 0.0..1.0 expressing confidence in the DESCRIPTIVE fingerprint, not confidence that the user will enjoy the title. Never inflate it so a title clears a DNA eligibility threshold.
- dna_tags may contain only values from dna_dimensions.tag_registry. An empty array is valid. Never invent a tag, and never substitute the unrelated top-level controlled_tags vocabulary.

Content DNA answers "what kind of title is this", never "will the user like it". Score it from the title's own story structure against the rubric anchors. Feedback may decide WHETHER a candidate is recommended; it must never bend the descriptive fingerprint. Do not raise a dimension because the user liked a similar title, and do not lower one because the user disliked a similar title.

Do not rewrite data/library.json for daily additions. Instead create one append-only file in the PUBLIC catalog repository at data/discoveries/<run_id>.json with schema_version=1, run_id, timestamp, and an items array containing the accepted titles. The site builder combines the unique public source records for catalog generation and FAILS CLOSED if the same public identity appears more than once. The automation must prevent duplicates before writing them. Do not create duplicate Past 24h entries; that catalog is generated from added_by and added_at.

When appending a discovery-log run, preserve the existing historical run records' text and content unchanged as far as practical; do not reserialize or reformat old runs merely to append the new record.

Append one run record to the PUBLIC repository's data/discovery-log.json with run_id, timestamp, searched/accepted/rejected/duplicate counts, accepted IMDb IDs/titles/scores, and a concise note about meaningful ACTIVE feedback-derived preference signals used during the run without quoting private feedback verbatim. Describe signals at the level of "premise interest remained positive for investigative biology" rather than naming private aspect ids or quoting text. Do not mention revoked/retracted private opinions as taste signals. Append a run even if zero titles qualify.

REGENERATE data/personalized-scores.json ON EVERY SUCCESSFUL RUN.

Fully regenerate this file from scratch on every successful run, INCLUDING runs that accept zero new discoveries, because new viewing feedback may have arrived even when no title qualified.

The shape is exactly:
{"schema_version": 1, "generated_at": "<UTC ISO-8601 ending Z>", "items": {"tt0000000": {"dna_match": 0, "execution_fit": 0}}}

No other top-level key and no other per-item key may appear. Both scores are integers 0..100. generated_at is the moment THIS PUBLIC FILE was generated - never a timestamp copied from a private feedback event.

The following must NEVER appear in this file, as key, value or text: rating, premise_interest, more_like_this, liked, disliked, dnf_reasons, feedback, feedback_id, supersedes, source_id, rated_at, received_at, quotations, explanations, per-title private event counts, and private timestamps. The file carries two derived integers per title and nothing else.

Keys may only be titles whose CURRENT public status is "watch". Feedback about seen or rated titles is LEARNING EVIDENCE, but a seen title is never an output key. Consider every current watch title that has valid Content DNA, not only newly discovered ones.

WHICH TITLES GET AN ENTRY.

Generate this file in one efficient pass, in this order: resolve the active feedback once; derive P(d), Pe(a) and Pt(t) once; enumerate the current watch titles once; apply the sufficiency conditions using the Content DNA those titles ALREADY carry; compute dna_match and execution_fit for the survivors; omit the rest.

DIRECT TONE REQUIRES NO RESEARCH. It is deterministic from Pt(t) and the candidate's existing Content DNA, both of which you already have. A title whose execution sufficiency is satisfied by direct tone needs NO web search and NO k(X,a) judgement. Only research a candidate's execution quality when an EXECUTION aspect contribution is actually needed and materially useful for that specific title. Do not research acting, dialogue, effects or pacing for a hundred watch titles to produce this file - that is the most expensive possible way to compute a number the repository's own DNA already determines.

Check sufficiency FIRST, and only then do the arithmetic for the titles that survive. A watch title receives an entry only when ALL of the following hold:
1. its local Content DNA is eligible under dna_baseline.completeness_defaults,
2. it is not hard-excluded by dna_guardrails.hard_exclusion,
3. at least one independent active title contributes CONTENT evidence,
4. at least two active numeric ratings exist,
5. at least one applicable personalized CONTENT link exists for this title,
6. exec_norm must be greater than 0 for this title. This means at least one applicable EXECUTION aspect or at least one applicable DIRECT-TONE dimension, using the exact applicability rules defined under HOW TO DERIVE execution_fit.

Otherwise OMIT the IMDb id entirely. The site builder then uses the stable baseline for that title, which is the correct outcome. Never publish a baseline value disguised as a personalized one, and never invent a number merely because the schema requires one. An empty items object is valid output.

HOW TO DERIVE dna_match.

dna_match is a personalized CONTENT-FIT estimate, 0..100, BEFORE the public DNA guardrails. The site builder applies hard exclusions and combination penalties itself after reading this file; subtracting them here would penalise the title twice.

Start from the stable baseline. For a qualifying candidate compute the same content score the public builder computes, reading every constant live from data/taste-profile.json and config/catalogs.json and following the mechanism implemented in scripts/dna-score.mjs: a normalized weighted sum of the title's DNA against dna_baseline.weights, plus the bonus for the BEST matching archetype in dna_baseline.archetypes - never an average across archetypes - clamped to 0..100. Call that BASE. Do not restate any weight, archetype or bonus constant from memory; read the current values.

Then move BASE only through legitimate ACTIVE CONTENT evidence. Ratings, did-not-finish reasons and execution aspects contribute NOTHING here.

The CONTENT-PROJECTABLE dimensions are exactly: scientific_investigation, biology_genetics, alien_unknown_life, unknown_phenomenon, mystery, rule_discovery, concept_escalation, weirdness, reality_anomaly, time_anomaly, mind_consciousness, experiments, conspiracy, scientist_presence, research_setting, isolation, creature_threat.

Never project content preference into suspense, horror, action_intensity, survival_chase, military_focus, comedy, pace_speed, space_opera, superhero or comic_book_universe. Those are tone, presentation or structural-policy dimensions; a liked premise that happens to contain heavy action, horror or military framing must never teach "I like action", "I like horror" or "I like military framing".

Per active title, votes are:
- premise_interest yes/no: +/-1.00 to every CONTENT-PROJECTABLE dimension where the SOURCE title's DNA is >= 7.
- schema-1 more_like_this yes/no: +/-0.50, same restricted projection. It is weaker and ambiguous and may never create a facet blacklist.
- premise_interest maybe: no content movement.
- a CONCEPT aspect thumbs-up/thumbs-down: +/-0.60 to its mapped dimension(s), using this frozen mapping:
    mystery -> mystery
    science_biology -> biology_genetics
    alien_unknown -> alien_unknown_life, unknown_phenomenon
    scientific_investigation -> scientific_investigation
    world_rules -> rule_discovery
    concept_escalation -> concept_escalation
    weirdness -> weirdness
    reality_time_anomaly -> reality_anomaly, time_anomaly
    mind_consciousness -> mind_consciousness
    experiments -> experiments
    conspiracy -> conspiracy
    creature_threat -> creature_threat
    premise_concept -> the generic projection across the CONTENT-PROJECTABLE set, using source DNA >= 7
  For the two multi-dimension mappings, apply only those mapped dimensions the SOURCE title actually scores >= 5. Never invent a mapping for an aspect with no semantic equivalent.
- TONE aspects contribute NOTHING to dna_match; they are handled under execution_fit.

Clamp each single title's total contribution to any one dimension to +/-1, so one title can never dominate a dimension.

For each dimension d, over the independent titles that voted on it, let mean(d) be the average vote and n(d) the number of such titles. The evidence tier multiplier is 0.30 for n=1, 0.60 for n=2, and 1.00 for n>=3. Then P(d) = mean(d) x tier, always within -1..+1.

Importance weighting: importance(d) is the absolute value of that dimension's dna_baseline.weights entry, except that a dimension whose approved baseline weight is exactly 0 uses 5 instead - and only when it is CONTENT-PROJECTABLE. Baseline weight 0 means "neutral by default", not "feedback may never teach a preference here", so creature_threat and isolation remain learnable. Do not apply this floor outside the content-projectable set.

  raw  = sum over d of P(d) x importance(d) x (candidate DNA[d] / 10)
  norm = sum over d of |P(d)| x importance(d)
  adjustment = MAX_SHIFT x raw / norm, and 0 when norm is 0

MAX_SHIFT is set by the total number of independent titles contributing any content evidence: 6 for one title, 12 for two, 20 for three or more. dna_match = round(clamp(BASE + adjustment, 0, 100)).

HOW TO DERIVE execution_fit.

execution_fit is the expected user-specific EXECUTION fit of the title, 0..100. It must never turn an execution complaint into a content aversion. Weak-acting feedback may lower the expected execution fit of a title known for weak acting; it must never lower that title's biology or science content fit.

E_base is the user's active satisfaction anchor: take the mean of the active numeric ratings and map 1..5 linearly onto 20..100.

Two kinds of title-specific evidence adjust it.

First, EXECUTION aspects. For each execution aspect a - acting, characters, dialogue, pacing, visuals, effects, ending_payoff, sound_music, originality - compute Pe(a) as mean vote x evidence tier, exactly as above. Then judge k for this candidate: +1 only when reliable public evidence indicates notably strong execution on that aspect, -1 only when reliable public evidence indicates notably weak execution, and 0 when ordinary, ambiguous, conflicting or insufficiently documented. Do not force +1 or -1.

Second, DIRECT TONE. Tone aspects map losslessly onto DNA dimensions: suspense -> suspense, horror -> horror, action -> action_intensity, humor -> comedy, survival_chase -> survival_chase, military_focus -> military_focus. setting_atmosphere and emotion have no exact DNA equivalent and must not be given an invented one. For each mapped tone dimension t compute Pt(t) as mean vote x evidence tier, with individual tone aspect votes at magnitude +/-0.30 relative to concept votes.

A mapped tone dimension t is APPLICABLE to candidate X if and only if all three hold: Pt(t) is not 0, X.dna[t] is known, and X.dna[t] is not 0. No additional threshold applies. DNA 1 is applicable, DNA 4 is applicable and DNA 7 is applicable - there is NO >=5 gate and NO >=7 gate for direct tone. Direct tone is DETERMINISTIC, computed from the candidate's own measured DNA.

DO NOT require k(X,a) for a tone dimension. k(X,a) applies ONLY to execution-category aspects - acting, characters, dialogue, pacing, visuals, effects, ending_payoff, sound_music, originality. A candidate with no usable execution judgement can still qualify on direct tone alone, and must not be omitted for lacking k.

  exec_raw  = sum over execution aspects of Pe(a) x k(X, a)
            + sum over mapped tone dimensions of Pt(t) x (X.dna[t] / 10)
  exec_norm = sum of |Pe(a)| over execution aspects where Pe(a) != 0 AND k(X, a) != 0
            + sum of |Pt(t)| over tone dimensions where Pt(t) != 0 AND X.dna[t] is known AND X.dna[t] != 0
  adjustment_e = MAX_EXEC_SHIFT x exec_raw / exec_norm

MAX_EXEC_SHIFT uses the same 6 / 12 / 20 ladder on the number of independent titles contributing execution evidence. If exec_norm is 0 the title has no defensible title-specific execution or tone estimate and MUST BE OMITTED. execution_fit = round(clamp(E_base + adjustment_e, 0, 100)).

PERSONALIZATION IS BOUNDED.

The stable baseline stays dominant while feedback history is small. One 1-star or 5-star rating must never reshape the catalog: a single title can move any score by at most 6 points, two titles by at most 12, and only three or more consistent independent titles unlock the full 20. premise_interest is the strongest content signal. Execution feedback stays in execution_fit. Retracted chains contribute zero. A current tip on an unsupported schema is opaque and contributes zero learning, and never lets an older superseded opinion return.

PREPARE EVERYTHING, THEN COMMIT ONCE.

The run is transactional. Prepare ALL intended public changes before writing anything: the discovery file if any, the discovery-log record if any, and the regenerated data/personalized-scores.json. Then validate the complete intended public state as a set - identities still unique, every accepted item carrying valid Content DNA, and personalized-scores.json matching the closed schema above.

If personalized-scores.json cannot be generated or fails validation, FAIL THE RUN BEFORE ANY PUBLIC COMMIT. Do not commit a discovery file or a log record without the required personalized refresh. Because nothing was committed, the previous personalized-scores.json remains in place untouched, and its 72-hour freshness window provides a safe fallback if failures continue. Report the run as failed.

A zero-findings run remains valid and may commit only the refreshed personalized-scores.json together with the run log record that is already required above.

Never silently delete existing library/discovery items or alter user seen/preference state unless explicitly asked. Do not edit generated site files or manifest output. Do not modify the PRIVATE feedback repository at any point. Update only source data files in the PUBLIC catalog repository and commit them directly to the default branch of Lewdcifer666/wtf-scifi-stremio.

After completion, report only the accepted new titles with match scores and one-line reasons, or report that zero high-confidence matches were added. Do not include private feedback text in the user-facing run report.
```

## Behavioural regression cases

These are the cases the interpretation layer must satisfy. They are specification
scenarios, not records: no private feedback content belongs in this public
repository. Case A is the motivating example from the Feedback v2 specification.

| Case | Active evidence | Required interpretation |
|---|---|---|
| **A** | `rating 2`, `premise_interest yes`, liked `premise_concept, science_biology, setting_atmosphere`, disliked `acting, creature_threat, survival_chase` | Poor title/execution fit. Premise neighbourhood **remains desirable**. Biology/science remains desirable. Setting/atmosphere worked. `acting` is EXECUTION → lowers execution fit **only**. `creature_threat` is CONCEPT → one piece of negative conceptual evidence, but one title **cannot** create a creature blacklist. `survival_chase` is TONE → a soft penalty for chase-heavy presentation, and it does **not** imply dislike of creatures. Neither negative aspect overrides `premise_interest=yes`. Biology, research environments, organisms, creatures and scientific mystery all **remain eligible**; a better-executed title in the same neighbourhood may rank highly. |
| **B** | `rating 5`, `premise_interest no` | Title quality positive; do **not** steer discovery toward that premise neighbourhood. |
| **C** | `rating 5`, premise null, no aspects | Strong positive title-quality evidence. Reason unknown. **No** invented content preference. |
| **D** | `rating 1`, premise null, no aspects | Strong negative title-quality evidence. **No** topic or setting rejection. |
| **E** | 3+ independent titles, `premise_interest no`, overlapping neighbourhood | Meaningful negative content preference for that combination — still short of excluding every individual facet. |
| **F** | `premise_interest yes`, disliked `acting, effects, dialogue` | Premise stays desirable; execution fit falls; content eligibility **unchanged**. |
| **G** | `premise_interest yes`, disliked `horror, survival_chase` | Premise stays desirable; soft penalty on horror/chase-heavy presentation; subject **not** blacklisted. |
| **H** | v1 `not_enough_mystery` | Weak evidence **more** mystery is wanted. Never "dislikes mystery". |
| **I** | rating A → retraction B → rating C | **C only.** A and B contribute zero, including premise, aspects and dnf_reasons. |
| **J** | unknown future aspect id | Preserve and read conservatively; invent no semantics; never generalise; never print the raw id publicly. |
| **K** | `A` schema 2 rating → `B` schema 3 event superseding A; automation supports 1 and 2 only | **B stays the chain tip.** `A` does **not** return as active evidence. `B` contributes **no** interpreted taste evidence. If `B` resolves to an imdb_id/source_id the identity is conservatively excluded from new-title discovery. The run records an unsupported-schema diagnostic **without** exposing `B`'s opinion fields. |
