/* Targeted retry for the citedlogic import's transient "fetch failed" rows.
 * Re-posts ONLY the (keyword_id, platform) pairs that are missing from
 * ranking_reports / audit_logs — so ranking upserts harmlessly and audit gets
 * no duplicates. Same campaign->keyword mapping + pinned date as the importer. */
import fs from "fs";
import pg from "pg";

const CAMPAIGN_OFFSET = 2800000;
const PIN_DATE = "2026-06-30";
const csvPath = process.argv[2];
const apiBase = (process.env.API_BASE ?? "").replace(/\/$/, "");
const token = process.env.EXECUTOR_TOKEN;
const dbUrl = process.env.DATABASE_URL;

const db = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
await db.connect();

function parseCSV(text){const rows=[];let row=[],cur="",inQ=false;for(let i=0;i<text.length;i++){const ch=text[i];if(inQ){if(ch==='"'&&text[i+1]==='"'){cur+='"';i++;}else if(ch==='"')inQ=false;else cur+=ch;}else{if(ch==='"')inQ=true;else if(ch===","){row.push(cur);cur="";}else if(ch==="\r"){}else if(ch==="\n"){row.push(cur);rows.push(row);row=[];cur="";}else cur+=ch;}}if(cur.length>0||row.length>0){row.push(cur);rows.push(row);}return rows;}
const allRows = parseCSV(fs.readFileSync(csvPath,"utf-8")).filter(r=>r.length>1||(r.length===1&&r[0].length>0));
const H = Object.fromEntries(allRows[0].map((h,i)=>[h,i]));
const v = (r,c)=>(r[H[c]]??"").trim();

const kwRes = await db.query("SELECT k.id AS keyword_id, k.business_id, k.client_id, k.aeo_plan_id, b.name AS biz_name FROM keywords k LEFT JOIN businesses b ON b.id=k.business_id WHERE k.client_id=259");
const kwById = new Map(kwRes.rows.map(k=>[k.keyword_id,k]));
const varRes = await db.query("SELECT id, variant_text FROM keyword_variants");
const variantById = new Map(varRes.rows.map(x=>[String(x.id),x.variant_text]));

// what's already in prod
const haveRank = new Set((await db.query("SELECT rr.keyword_id, LOWER(rr.platform) p FROM ranking_reports rr JOIN keywords k ON k.id=rr.keyword_id WHERE k.client_id=259 AND rr.date=$1",[PIN_DATE])).rows.map(r=>`${r.keyword_id}|${r.p}`));
const haveAudit = new Set((await db.query("SELECT keyword_id, LOWER(platform) p FROM audit_logs WHERE keyword_id IN (SELECT id FROM keywords WHERE client_id=259) AND timestamp>=$1 AND timestamp<($1::date+INTERVAL '1 day')",[PIN_DATE])).rows.map(r=>`${r.keyword_id}|${r.p}`));
await db.end();

const toIsoZ = s=>{s=s.trim().replace(" ","T");return /[zZ]$|[+-]\d\d:?\d\d$/.test(s)?s:s+"Z";};
const toRankingStatus = raw=>!raw?null:(raw==="success"||raw==="error")?raw:(raw==="no_rank"?"success":"error");
async function postJson(path,payload){const res=await fetch(`${apiBase}${path}`,{method:"POST",headers:{"Content-Type":"application/json","X-Executor-Token":token},body:JSON.stringify(payload)});if(!res.ok)throw new Error(`${path} ${res.status}: ${(await res.text()).slice(0,150)}`);return res.json();}

const createdAt = `${PIN_DATE}T12:00:00Z`;
let rankFilled=0, auditFilled=0, fail=0;
for(let i=1;i<allRows.length;i++){
  const row=allRows[i]; if(row.length<2) continue;
  const kid=parseInt(v(row,"campaign_id"),10)-CAMPAIGN_OFFSET;
  const kw=kwById.get(kid); if(!kw) continue;
  const platform=(v(row,"platform")||"").toLowerCase();
  const key=`${kid}|${platform}`;
  const needRank=!haveRank.has(key), needAudit=!haveAudit.has(key);
  if(!needRank && !needAudit) continue;
  const keyword=v(row,"keyword"), bizName=v(row,"biz_name");
  const variantId=v(row,"variant_id"); const variantText=variantId?(variantById.get(variantId)??null):null;
  const hhmmss=v(row,"timestamp").slice(11); const timestamp=toIsoZ(`${PIN_DATE}T${hhmmss}`);
  const rank=v(row,"rank_position"), rankTotal=v(row,"rank_total"), dur=v(row,"duration_s");
  try{
    if(needAudit){
      await postJson("/api/audit-logs",{clientId:kw.client_id,businessId:kw.business_id,campaignId:kw.aeo_plan_id,keywordId:kw.keyword_id,bizName:bizName||kw.biz_name||null,campaignName:v(row,"campaign_name")||null,keywordText:keyword,keywordVariant:variantText,timestamp,platform:v(row,"platform")||null,mode:v(row,"mode")||null,device:v(row,"device")||null,status:v(row,"status")||null,durationSeconds:dur?parseFloat(dur):null,rankPosition:rank&&/^\d+$/.test(rank)?parseInt(rank,10):null,rankTotal:rankTotal&&/^\d+$/.test(rankTotal)?parseInt(rankTotal,10):null,mentioned:v(row,"mentioned")||null,rankContext:v(row,"rank_context")||null,screenshotPath:v(row,"screenshot")||null,responseText:v(row,"response_text")||null,prompt:v(row,"prompt")||null,error:v(row,"error")||null,proxyIp:v(row,"proxy_ip")||null,proxyCity:v(row,"proxy_city")||null,proxyRegion:v(row,"proxy_region")||null,proxyZip:v(row,"proxy_zip")||null});
      auditFilled++;
    }
    if(needRank){
      await postJson("/api/ranking-reports",{clientId:kw.client_id,businessId:kw.business_id,keywordId:kw.keyword_id,bizName:bizName||kw.biz_name||null,keyword,keywordVariant:variantText,timestamp,date:PIN_DATE,platform:v(row,"platform")||null,deviceIdentifier:v(row,"device")||null,status:toRankingStatus(v(row,"status")),durationSeconds:dur?parseFloat(dur):null,rankingPosition:rank&&/^\d+$/.test(rank)?parseInt(rank,10):null,rankingTotal:rankTotal||null,proxyIp:v(row,"proxy_ip")||null,proxyCity:v(row,"proxy_city")||null,proxyRegion:v(row,"proxy_region")||null,proxyZip:v(row,"proxy_zip")||null,isInitialRanking:false,createdAt});
      rankFilled++;
    }
  }catch(e){ fail++; console.log(`  retry fail kid=${kid} ${platform}: ${e.message}`); }
}
console.log(`retry done: ranking filled=${rankFilled}, audit filled=${auditFilled}, fail=${fail}`);
