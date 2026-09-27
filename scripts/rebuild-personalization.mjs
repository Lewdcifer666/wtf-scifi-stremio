import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { makePolicy, dnaEligible, hardExcluded, baselineContentPre } from "./dna-score.mjs";

const SUPPORTED = new Set([1, 2, 3]);
const CONTEXTS = new Set(["scifi", "fantasy", "action", "anime", "thriller", null]);
const IMDB = /^tt\d+$/;
const EXEC = new Set(["acting","characters","dialogue","pacing","visuals","effects","ending_payoff","sound_music","originality"]);
const TONE = new Map([["suspense","suspense"],["horror","horror"],["action","action_intensity"],["humor","comedy"],["survival_chase","survival_chase"],["military_focus","military_focus"]]);
const CONCEPT = new Map([
  ["mystery",["mystery"]],["science_biology",["biology_genetics"]],["alien_unknown",["alien_unknown_life","unknown_phenomenon"]],
  ["scientific_investigation",["scientific_investigation"]],["world_rules",["rule_discovery"]],["concept_escalation",["concept_escalation"]],
  ["weirdness",["weirdness"]],["reality_time_anomaly",["reality_anomaly","time_anomaly"]],["mind_consciousness",["mind_consciousness"]],
  ["experiments",["experiments"]],["conspiracy",["conspiracy"]],["creature_threat",["creature_threat"]]
]);
const UNIVERSAL_V3 = new Set(["mystery","world_rules","conspiracy","creature_threat","concept_escalation","weirdness"]);
const PROJECTABLE = ["scientific_investigation","biology_genetics","alien_unknown_life","unknown_phenomenon","mystery","rule_discovery","concept_escalation","weirdness","reality_anomaly","time_anomaly","mind_consciousness","experiments","conspiracy","scientist_presence","research_setting","isolation","creature_threat"];
const LEGACY = { liked:{biology:"science_biology",rule_discovery:"world_rules",impossible_system:"world_rules",fast_pacing:"pacing",great_payoff:"ending_payoff",time_reality:"reality_time_anomaly"}, disliked:{too_slow:"pacing",boring_middle:"pacing",too_much_action:"action",too_much_horror:"horror",psychological_horror:"horror",weak_payoff:"ending_payoff",monster_chase:"survival_chase",weak_characters:"characters"} };
const KNOWN = new Set([...EXEC,...TONE.keys(),...CONCEPT.keys(),"premise_concept","setting_atmosphere","emotion"]);
const clamp=(v,a,b)=>Math.min(Math.max(v,a),b), tier=n=>n<1?0:n===1?.3:n===2?.6:1, shift=n=>n<1?0:n===1?6:n===2?12:20;
const goodId=x=>typeof x==="string"&&IMDB.test(x), obj=x=>x&&typeof x==="object"&&!Array.isArray(x);

function identity(e){ return goodId(e?.imdb_id)?`imdb:${e.imdb_id}`:typeof e?.source_id==="string"&&e.source_id?`source:${e.source_id}`:null; }
function when(x){ return Date.parse(x); }

// Rebuilding must never turn a partial or malformed feedback history into a
// fresh-looking snapshot. These are the common fields used by this resolver;
// extra schema-owned fields remain inert. Unsupported schemas fail the entire
// rebuild, so an opaque correction can never resurrect its older opinion.
function validateFeedback(events) {
  if (!Array.isArray(events)) throw new Error("feedback snapshot must be an array");
  const byId = new Map();
  for (const e of events) {
    if (!obj(e) || !SUPPORTED.has(e.schema_version)) throw new Error("unsupported or missing feedback schema_version");
    if (typeof e.feedback_id !== "string" || !e.feedback_id.trim()) throw new Error("feedback_id must be a nonempty string");
    if (byId.has(e.feedback_id)) throw new Error("duplicate feedback_id");
    if (e.supersedes != null && (typeof e.supersedes !== "string" || !e.supersedes.trim())) throw new Error("supersedes must be a feedback_id or null");
    if (e.imdb_id !== null && !goodId(e.imdb_id)) throw new Error("imdb_id must be a valid IMDb id or null");
    if (e.source_id != null && (typeof e.source_id !== "string" || !e.source_id.trim())) throw new Error("source_id must be a nonempty string or null");
    if (typeof e.status !== "string" || !e.status.trim()) throw new Error("feedback status must be a nonempty string");
    if (typeof e.rated_at !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(e.rated_at)
      || !Number.isFinite(when(e.rated_at))
      || new Date(when(e.rated_at)).toISOString().slice(0, 19) !== e.rated_at.slice(0, 19)) throw new Error("rated_at must be a valid UTC timestamp");
    if (e.rating != null && (!Number.isInteger(e.rating) || e.rating < 1 || e.rating > 5)) throw new Error("rating must be an integer from 1 to 5 or null");
    if (e.schema_version === 3 && !CONTEXTS.has(e.profile_context)) throw new Error("unsupported or missing schema-3 profile_context");
    for (const side of ["liked", "disliked"]) {
      if (e[side] != null && (!Array.isArray(e[side]) || e[side].some(x => typeof x !== "string" || !x.trim()))) throw new Error(`${side} must be an array of aspect names`);
    }
    const interest = e.schema_version === 1 ? e.more_like_this : e.premise_interest;
    if (interest != null && !["yes", "no", "maybe"].includes(interest)) throw new Error("unsupported feedback interest value");
    byId.set(e.feedback_id, e);
  }
  for (const e of byId.values()) {
    if (e.supersedes != null && !byId.has(e.supersedes)) throw new Error("incomplete feedback history: superseded event is missing");
  }
  const complete = new Set();
  for (const start of byId.keys()) {
    const chain = new Set();
    let id = start;
    while (id != null && !complete.has(id)) {
      if (chain.has(id)) throw new Error("invalid feedback history: supersedes cycle");
      chain.add(id);
      id = byId.get(id).supersedes ?? null;
    }
    for (const id of chain) complete.add(id);
  }
  return byId;
}

export function resolveFeedback(events){
  const byId=validateFeedback(events);
  const superseded=new Set([...byId.values()].map(e=>e.supersedes).filter(x=>typeof x==="string"&&x));
  const out=new Map(), loose=[];
  for(const e of byId.values()){
    if(superseded.has(e.feedback_id)) continue;
    const k=identity(e); if(!k){loose.push(e);continue;}
    const p=out.get(k); if(!p||when(e.rated_at)>when(p.rated_at)||(when(e.rated_at)===when(p.rated_at)&&e.feedback_id>p.feedback_id)) out.set(k,e);
  }
  return [...out.values(),...loose].sort((a, b) => a.feedback_id < b.feedback_id ? -1 : a.feedback_id > b.feedback_id ? 1 : 0);
}

function add(store,key,title,val){ if(!val) return; if(!store.has(key)) store.set(key,new Map()); const m=store.get(key); m.set(title,clamp((m.get(title)||0)+val,-1,1)); }
function summarize(store){ const out=new Map(); for(const [k,m] of store){ const v=[...m.values()]; if(v.length) out.set(k,(v.reduce((a,b)=>a+b,0)/v.length)*tier(v.length)); } return out; }
function aspect(raw,side,v){ if(v!==1) return KNOWN.has(raw)?raw:null; return KNOWN.has(raw)?raw:(LEGACY[side][raw]||null); }
function supported(e){ return SUPPORTED.has(e.schema_version) && (e.schema_version!==3||CONTEXTS.has(e.profile_context)); }

export function deriveSignals({tips,publicItems}){
  const byImdb=new Map(publicItems.filter(x=>goodId(x.imdb_id)).map(x=>[x.imdb_id,x])), owned=new Set(byImdb.keys());
  const cv=new Map(), ev=new Map(), tv=new Map(), ratings=[], cTitles=new Set(), eTitles=new Set(); let unsupported=0, nonOwned=0;
  for(const e of tips){
    if(!supported(e)){unsupported++;continue;} if(e.status==="retracted"||!goodId(e.imdb_id)) continue;
    const own=owned.has(e.imdb_id), title=`imdb:${e.imdb_id}`, src=byImdb.get(e.imdb_id), v3=e.schema_version===3;
    if(!own) nonOwned++;
    const scoped=v3?(e.profile_context==="scifi"||(e.profile_context===null&&own)):own;
    if(scoped&&Number.isInteger(e.rating)&&e.rating>=1&&e.rating<=5) ratings.push(e.rating);
    if(scoped&&own&&src?.dna){
      const p=e.schema_version===1?e.more_like_this:e.premise_interest, mag=e.schema_version===1?.5:1, sign=p==="yes"?1:p==="no"?-1:0;
      if(sign) for(const d of PROJECTABLE) if(Number.isInteger(src.dna[d])&&src.dna[d]>=7){add(cv,d,title,sign*mag);cTitles.add(title);}
    }
    for(const [side,list,sign] of [["liked",e.liked,1],["disliked",e.disliked,-1]]) for(const raw of Array.isArray(list)?list:[]){
      const a=typeof raw==="string"?aspect(raw,side,e.schema_version):null; if(!a) continue;
      if(EXEC.has(a)){ if(scoped||v3){add(ev,a,title,sign);eTitles.add(title);} continue; }
      if(TONE.has(a)){ if(scoped){add(tv,a,title,sign*.3);eTitles.add(title);} continue; }
      const allowed=scoped||(v3&&UNIVERSAL_V3.has(a)); if(!allowed) continue;
      if(a==="premise_concept"){ if(src?.dna) for(const d of PROJECTABLE) if(Number.isInteger(src.dna[d])&&src.dna[d]>=7){add(cv,d,title,sign*.6);cTitles.add(title);} continue; }
      let dims=CONCEPT.get(a)||[]; if(dims.length>1) dims=src?.dna?dims.filter(d=>Number.isInteger(src.dna[d])&&src.dna[d]>=5):[];
      for(const d of dims){add(cv,d,title,sign*.6);cTitles.add(title);}
    }
  }
  return {contentPreferences:summarize(cv),executionPreferences:summarize(ev),tonePreferences:summarize(tv),ratings,contentEvidenceTitles:cTitles.size,executionEvidenceTitles:eTitles.size,unsupportedTips:unsupported,nonOwnedTips:nonOwned};
}

function loadJson(f){ return JSON.parse(fs.readFileSync(f,"utf8")); }
function files(dir){ if(!fs.existsSync(dir)) return []; return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(path.join(dir,e.name)):e.isFile()&&e.name.endsWith(".json")?[path.join(dir,e.name)]:[]).sort(); }
export function loadPublicItems(root){ const lib=loadJson(path.join(root,"data/library.json")); const out=[...(lib.items||[])]; for(const f of files(path.join(root,"data/discoveries"))){const p=loadJson(f), a=Array.isArray(p)?p:p.items||[]; if(!Array.isArray(a)) throw new Error(`${f}: expected items array`); out.push(...a);} return out; }

function contentAdj(item,s,profile){ let raw=0,norm=0,applied=0; for(const [d,p] of s.contentPreferences){const w=profile.dna_baseline.weights[d]; if(typeof w!=="number"||!p) continue; const v=item.dna?.[d]; if(!Number.isInteger(v)) continue; const imp=w===0?5:Math.abs(w); raw+=p*imp*v/10; norm+=Math.abs(p)*imp; if(v) applied++;} return norm&&applied?shift(s.contentEvidenceTitles)*raw/norm:null; }
function execAdj(item,s,evidence){ let raw=0,norm=0; const k=obj(evidence?.[item.imdb_id])?evidence[item.imdb_id]:{}; for(const [a,p] of s.executionPreferences){if((k[a]===1||k[a]===-1)&&p){raw+=p*k[a];norm+=Math.abs(p);}} for(const [a,p] of s.tonePreferences){const d=TONE.get(a),v=item.dna?.[d]; if(p&&Number.isInteger(v)&&v){raw+=p*v/10;norm+=Math.abs(p);}} return norm?shift(s.executionEvidenceTitles)*raw/norm:null; }

export function buildPersonalizedSnapshot({profile,catalogs,publicItems,feedbackEvents,executionEvidence={},generatedAt=new Date()}){
  const policy=makePolicy(profile), def=catalogs.catalogs.find(x=>x.id==="dna-match"); if(!def||def.dna?.mode!=="baseline_profile") throw new Error("missing baseline dna-match row");
  const tips=resolveFeedback(feedbackEvents), s=deriveSignals({tips,publicItems}), count=s.ratings.length, eBase=count?s.ratings.reduce((a,b)=>a+b,0)/count*20:null, out={}, seen=new Set();
  for(const item of publicItems){
    if(item.status!=="watch"||!goodId(item.imdb_id)) continue; const key=`${item.type}:${item.imdb_id}`; if(seen.has(key)) throw new Error(`duplicate public identity: ${key}`); seen.add(key);
    if(!dnaEligible(policy,item)||hardExcluded(policy,item.dna)||s.contentEvidenceTitles<1||count<2) continue;
    const ca=contentAdj(item,s,profile), ea=execAdj(item,s,executionEvidence); if(ca===null||ea===null) continue;
    let base; try{base=baselineContentPre(policy,item,def.dna.archetype_bonus_max).contentPre;}catch{continue;}
    out[item.imdb_id]={dna_match:Math.round(clamp(base+ca,0,100)),execution_fit:Math.round(clamp(eBase+ea,0,100))};
  }
  const date=generatedAt instanceof Date?generatedAt:new Date(generatedAt); if(!Number.isFinite(date.getTime())) throw new Error("invalid generatedAt");
  const automationSignals={content_preferences:Object.fromEntries([...s.contentPreferences].sort()),execution_preferences:Object.fromEntries([...s.executionPreferences].sort()),tone_preferences:Object.fromEntries([...s.tonePreferences].sort()),rating_count:count,execution_base:eBase===null?null:Math.round(eBase)};
  const snapshot={schema_version:1,generated_at:date.toISOString().replace(/\.\d{3}Z$/,"Z"),items:Object.fromEntries(Object.entries(out).sort())};
  return {snapshot,automationSignals,diagnostics:{resolved_tips:tips.length,supported_ratings:count,content_evidence_titles:s.contentEvidenceTitles,execution_evidence_titles:s.executionEvidenceTitles,unsupported_tips:s.unsupportedTips,non_owned_tips:s.nonOwnedTips,output_items:Object.keys(out).length}};
}

function git(root, ...argv) {
  try { return execFileSync("git", ["-C", root, ...argv], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] }); }
  catch { throw new Error(`feedback Git verification failed (${argv[0]})`); }
}
function isWithin(root, file) {
  const relative = path.relative(root, file);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}
function remoteHead(root) {
  const text = git(root, "ls-remote", "--symref", "origin", "HEAD");
  const ref = text.match(/^ref: (refs\/heads\/[^\r\n\t]+)\tHEAD$/m)?.[1];
  const sha = text.match(/^([a-f0-9]{40,64})\tHEAD$/m)?.[1];
  if (!ref || !sha) throw new Error("feedback origin must expose its current default-branch HEAD");
  return { ref, sha };
}
function trackedInventory(root, head, directory) {
  if (directory !== "." && git(root, "cat-file", "-t", `${head}:${directory}`).trim() !== "tree") throw new Error("feedback directory must be a tracked directory");
  const entries = git(root, "ls-tree", "-r", "-z", "--full-tree", head, "--", directory).split("\0").filter(Boolean).map(line => {
    const match = /^(\d+) (\w+) ([a-f0-9]+)\t([\s\S]+)$/.exec(line);
    if (!match) throw new Error("invalid feedback Git inventory");
    return { mode: match[1], type: match[2], sha: match[3], file: match[4] };
  });
  if (entries.some(e => e.type !== "blob" || !["100644", "100755"].includes(e.mode))) throw new Error("feedback directory cannot contain symlinks or submodules");
  return entries.filter(e => /\.json$/i.test(e.file)).sort((a, b) => a.file.localeCompare(b.file, "en"));
}
function requireClean(root, directory) {
  if (git(root, "status", "--porcelain=v1", "--untracked-files=all", "--ignored=matching", "--", directory).trim()) {
    throw new Error("feedback directory contains uncommitted, untracked or ignored files");
  }
}
function containsFeedbackRecord(value) {
  if (Array.isArray(value)) return value.some(containsFeedbackRecord);
  if (!obj(value)) return false;
  if (typeof value.feedback_id === "string"
    || (Number.isInteger(value.schema_version) && ("rated_at" in value || "supersedes" in value))) return true;
  return Object.values(value).some(containsFeedbackRecord);
}

// The publishing CLI only accepts a complete tracked event directory at the
// origin's current default-branch revision. Caller-provided arrays remain useful
// for pure calculations/tests, but are not a source-provenance publishing path.
export function loadCompleteFeedback({ feedbackRepo, feedbackDir }) {
  if (!feedbackRepo || !feedbackDir) throw new Error("provide --feedback-repo and --feedback-dir (the complete repository-relative event directory)");
  const root = fs.realpathSync.native(path.resolve(feedbackRepo));
  const gitRoot = fs.realpathSync.native(git(root, "rev-parse", "--show-toplevel").trim());
  if (path.relative(root, gitRoot) !== "") throw new Error("--feedback-repo must name the checkout root");
  const directory = feedbackDir.replace(/\\/g, "/").replace(/\/$/, "");
  if (!directory || path.isAbsolute(directory) || directory.includes(":") || directory.split("/").some(x => x === ".." || !x || (x === "." && directory !== "."))) throw new Error("--feedback-dir must be a repository-relative directory without traversal");
  const remote = remoteHead(root);
  const head = git(root, "rev-parse", "HEAD").trim();
  if (head !== remote.sha) throw new Error("feedback checkout is not at the current origin default-branch HEAD");
  requireClean(root, directory);
  const inventory = trackedInventory(root, head, directory);
  const selected = new Set(inventory.map(entry => entry.file));
  const events = [];
  // A caller cannot present one nested folder as the complete history. Inspect
  // the whole pinned tree and reject event records omitted by that selection.
  // Unrelated configuration JSON outside the event directory stays inert.
  for (const entry of trackedInventory(root, head, ".")) {
    let payload;
    try { payload = JSON.parse(git(root, "cat-file", "blob", entry.sha)); }
    catch { throw new Error("a tracked source JSON file could not be read"); }
    if (selected.has(entry.file)) events.push(payload);
    else if (containsFeedbackRecord(payload)) {
      throw new Error("incomplete feedback directory: event records exist elsewhere in the source repository");
    }
  }
  if (events.length !== inventory.length) throw new Error("incomplete feedback source inventory");
  validateFeedback(events);
  const assertCurrent = () => {
    const latest = remoteHead(root);
    if (latest.sha !== head || latest.ref !== remote.ref || git(root, "rev-parse", "HEAD").trim() !== head) throw new Error("feedback HEAD changed during rebuild; existing snapshot preserved");
    requireClean(root, ".");
    if (JSON.stringify(trackedInventory(root, head, directory)) !== JSON.stringify(inventory)) throw new Error("feedback inventory changed during rebuild");
  };
  assertCurrent();
  return { events, root, head, eventCount: inventory.length, assertCurrent };
}

function outputPath(file, feedbackRoot) {
  const absolute = path.resolve(file);
  const realParent = fs.realpathSync.native(path.dirname(absolute));
  const resolved = path.join(realParent, path.basename(absolute));
  if (isWithin(feedbackRoot, resolved) || (fs.existsSync(resolved) && fs.lstatSync(resolved).isSymbolicLink())) throw new Error("outputs must be outside the read-only feedback checkout and cannot be symlinks");
  return resolved;
}
export function publishOutputs(outputs, source) {
  const staged = [];
  try {
    for (const output of outputs) {
      const file = outputPath(output.file, source.root);
      if (staged.some(x => path.relative(x.file, file) === "")) throw new Error("snapshot and signals outputs must be different files");
      const temporary = path.join(path.dirname(file), `.personalization-${randomUUID()}.tmp`);
      const original = fs.existsSync(file) ? fs.readFileSync(file) : null;
      fs.writeFileSync(temporary, output.text, { flag: "wx", mode: 0o600 });
      staged.push({ file, temporary, original, published: false });
    }
    for (const output of staged) {
      source.assertCurrent(); // Recheck immediately before each atomic replacement.
      fs.renameSync(output.temporary, output.file);
      output.published = true;
    }
    source.assertCurrent(); // A change noticed during replacement rolls all outputs back.
  } catch (error) {
    for (const output of staged.filter(x => x.published).reverse()) {
      if (output.original === null) fs.rmSync(output.file, { force: true });
      else {
        fs.writeFileSync(output.temporary, output.original, { flag: "wx", mode: 0o600 });
        fs.renameSync(output.temporary, output.file);
      }
    }
    throw error;
  } finally {
    for (const output of staged) fs.rmSync(output.temporary, { force: true });
  }
}
function args(argv) {
  const options = { publicRoot: ".", output: null, signalsOutput: null, feedbackRepo: null, feedbackDir: null, executionEvidence: null };
  const names = new Map([["--public-root", "publicRoot"], ["--output", "output"], ["--signals-output", "signalsOutput"], ["--feedback-repo", "feedbackRepo"], ["--feedback-dir", "feedbackDir"], ["--execution-evidence", "executionEvidence"]]);
  const seen = new Set();
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i], value = argv[i + 1];
    if (!names.has(flag)) throw new Error(`unsupported argument: ${flag}; arbitrary snapshots and timestamp overrides are not publishable inputs`);
    if (seen.has(flag) || !value || value.startsWith("--")) throw new Error(`missing or repeated argument: ${flag}`);
    seen.add(flag);
    options[names.get(flag)] = value;
  }
  return options;
}
async function main() {
  const options = args(process.argv.slice(2));
  const root = path.resolve(options.publicRoot);
  const source = loadCompleteFeedback(options);
  const profile = loadJson(path.join(root, "data/taste-profile.json"));
  const catalogs = loadJson(path.join(root, "config/catalogs.json"));
  const publicItems = loadPublicItems(root);
  const executionEvidence = options.executionEvidence ? loadJson(options.executionEvidence) : {};
  const { snapshot, automationSignals, diagnostics } = buildPersonalizedSnapshot({ profile, catalogs, publicItems, feedbackEvents: source.events, executionEvidence });
  const text = JSON.stringify(snapshot) + "\n";
  const outputs = [];
  if (options.signalsOutput) outputs.push({ file: options.signalsOutput, text: JSON.stringify(automationSignals) + "\n" });
  if (options.output) outputs.push({ file: options.output, text }); // Publish the snapshot last.
  publishOutputs(outputs, source);
  if (!options.output) process.stdout.write(text);
  process.stderr.write(`personalization: ${JSON.stringify({ ...diagnostics, source_revision: source.head, inventoried_events: source.eventCount })}\n`);
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) main().catch(e=>{console.error(`rebuild-personalization: ${e.message}`);process.exit(1);});
