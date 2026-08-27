// GENERATED AT CONVERGENCE - this repo's frozen DNA vocabulary.
//
// This is the one file written from the profile rather than copied verbatim, and
// it is what lets validate-profile.mjs stay genre-neutral and vendored. The guard
// it feeds is deliberately strict: data/taste-profile.json must declare EXACTLY
// these dimensions and EXACTLY these tags, no more and no fewer, so a typo
// becomes a loud failure instead of quiet new metadata.
//
// Changing this list is a schema decision. It means a registry version bump, a
// migration for every already-enriched record, and a review of every consumer -
// never a casual edit.

export const CANONICAL_DIMENSIONS = [
  "scientific_investigation",
  "biology_genetics",
  "alien_unknown_life",
  "unknown_phenomenon",
  "mystery",
  "suspense",
  "rule_discovery",
  "concept_escalation",
  "weirdness",
  "reality_anomaly",
  "time_anomaly",
  "mind_consciousness",
  "experiments",
  "conspiracy",
  "scientist_presence",
  "research_setting",
  "isolation",
  "creature_threat",
  "survival_chase",
  "horror",
  "action_density",
  "action_intensity",
  "military_focus",
  "space_opera",
  "superhero",
  "comic_book_universe",
  "comedy",
  "pace_speed"
];

export const CANONICAL_DNA_TAGS = [
  "glacier",
  "research_station",
  "lab",
  "underwater",
  "space_station",
  "small_town",
  "alien_ecology",
  "mutation",
  "parasite",
  "infection",
  "dimension",
  "simulation",
  "time_loop",
  "parallel_reality",
  "body_horror",
  "first_contact",
  "artifact",
  "signal",
  "containment",
  "experiment_gone_wrong"
];

// The single deliberate exception to the shared absent..dominant scale:
// pace_speed measures slow..fast. Exactly one dimension may be slow_to_fast.
export const SLOW_TO_FAST_DIMENSION = "pace_speed";
