import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
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
function when(x){ const t=Date.parse(x||""); return Number.isFinite(t)?t:-Infinity; }

export function resolveFeedback(events){
  if(!Array.isArray(events)) throw new Error("feedback snapshot must be an array");
  const byId=new Map();
  for(const e of events){ if(!obj(e)||typeof e.feedback_id!=="string"||!e.feedback_id) continue; if(byId.has(e.feedback_id)) throw new Error(`duplicate feedback_id: ${e.feedback_id}`); byId.set(e.feedback_id,e); }
  const superseded=new Set([...byId.values()].map(e=>e.supersedes).filter(x=>typeof x==="string"&&x));
  const out=new Map(), loose=[];
  for(const e of byId.values()){
    if(superseded.has(e.feedback_id)) continue;
    const k=identity(e); if(!k){loose.push(e);continue;}
    const p=out.get(k); if(!p||when(e.rated_at)>when(p.rated_at)||(when(e.rated_at)===when(p.rated_at)&&e.feedback_id>p.feedback_id)) out.set(k,e);
  }
  return [...out.values(),...loose];
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

function args(argv){const o={publicRoot:".",output:null,signalsOutput:null,feedbackSnapshot:null,feedbackDir:null,executionEvidence:null,generatedAt:null}; for(let i=0;i<argv.length;i++){const a=argv[i],v=argv[i+1]; if(a==="--public-root")o.publicRoot=v;else if(a==="--output")o.output=v;else if(a==="--signals-output")o.signalsOutput=v;else if(a==="--feedback-snapshot")o.feedbackSnapshot=v;else if(a==="--feedback-dir")o.feedbackDir=v;else if(a==="--execution-evidence")o.executionEvidence=v;else if(a==="--generated-at")o.generatedAt=v;else throw new Error(`unknown argument: ${a}`);i++;}return o;}
function feedback(o){if(o.feedbackSnapshot){const p=loadJson(o.feedbackSnapshot);return Array.isArray(p)?p:p.events;}if(o.feedbackDir)return files(o.feedbackDir).map(loadJson);throw new Error("provide --feedback-snapshot or --feedback-dir");}
async function main(){const o=args(process.argv.slice(2)),root=path.resolve(o.publicRoot),profile=loadJson(path.join(root,"data/taste-profile.json")),catalogs=loadJson(path.join(root,"config/catalogs.json")),publicItems=loadPublicItems(root),feedbackEvents=feedback(o),executionEvidence=o.executionEvidence?loadJson(o.executionEvidence):{}; if(!Array.isArray(feedbackEvents))throw new Error("feedback snapshot must contain an array"); const {snapshot,automationSignals,diagnostics}=buildPersonalizedSnapshot({profile,catalogs,publicItems,feedbackEvents,executionEvidence,generatedAt:o.generatedAt||new Date()}); const text=JSON.stringify(snapshot)+"\n"; if(o.output)fs.writeFileSync(o.output,text);else process.stdout.write(text); if(o.signalsOutput)fs.writeFileSync(o.signalsOutput,JSON.stringify(automationSignals)+"\n"); process.stderr.write(`personalization: ${JSON.stringify(diagnostics)}\n`);}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) main().catch(e=>{console.error(`rebuild-personalization: ${e.message}`);process.exit(1);});
