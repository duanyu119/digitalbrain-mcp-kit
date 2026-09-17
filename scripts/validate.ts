import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
import {Client,StreamableHTTPClientTransport} from '@modelcontextprotocol/client';
import {bundleSchema} from '../src/schema.ts';
const origin=process.env.TEST_ORIGIN||'http://localhost:8787';
const key=readFileSync(process.env.TEST_KEY_FILE||'.local-data/auth/researcher.key','utf8').trim();
const dataDir=process.env.DATA_DIR||'.local-data/data';
const bundle=bundleSchema.parse(JSON.parse(readFileSync(`${dataDir}/bundle.json`,'utf8')));
const checks:string[]=[];const pass=(s:string)=>checks.push(s);
const client=new Client({name:'digitalbrain-acceptance',version:'1.0.0'});
const request=(path:string,options:RequestInit={})=>fetch(origin+path,{...options,signal:AbortSignal.timeout(15000)});
assert.equal((await request('/health')).status,200);pass('health');
assert.equal((await request('/mcp',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,401);pass('unauthenticated_rejected');
assert.equal((await request('/mcp',{method:'POST',headers:{Origin:'https://untrusted.example',Authorization:`Bearer ${key}`},body:'{}'})).status,403);pass('foreign_origin_rejected');
assert.equal((await request('/mcp',{method:'POST',body:'x'.repeat(17000)})).status,413);pass('oversized_request_rejected');
await client.connect(new StreamableHTTPClientTransport(new URL(origin+'/mcp'),{requestInit:{headers:{Authorization:`Bearer ${key}`}}}));
assert.equal((await client.listTools()).tools.length,6);pass('sdk_initialize_and_six_tools');
async function call(name:string,args:Record<string,unknown>) {const r=await client.callTool({name,arguments:args});assert.notEqual(r.isError,true,JSON.stringify(r));return r.structuredContent as any;}
let allDatasets:any[]=[];let offset:number|null=0;
do {const r=await call('search_datasets',{offset,limit:25});allDatasets.push(...r.items);offset=r.next_offset;}while(offset!==null);
assert.deepEqual(allDatasets,bundle.datasets);pass('dataset_search_all_pages');
const dataset=bundle.datasets.find(d=>d.cell_count!==null)||bundle.datasets[0];
assert.deepEqual((await call('get_dataset_info',{dataset_id:dataset.id})).items,[dataset]);pass('dataset_detail');
for(const region of bundle.regions) assert.deepEqual((await call('get_region_profile',{region_id:region.id})).items,[region]);pass('region_profiles_and_scope');
let allExpressions:any[]=[];
for(const weighting of ['cell_weighted','donor_balanced']) {
  let offset:number|null=0;
  do {const r=await call('get_expression_summary',{genes:[...new Set(bundle.expressions.map(e=>e.gene))],weighting,limit:25,offset});allExpressions.push(...r.items);offset=r.next_offset;}while(offset!==null);
}
assert.deepEqual(allExpressions.toSorted((a,b)=>a.id.localeCompare(b.id)),bundle.expressions.toSorted((a,b)=>a.id.localeCompare(b.id)));pass('expression_all_pages_equal_local_bundle');
let comparisons=0;
if(bundle.release.id.startsWith('website-sample-')) {
  const sourceDir=process.env.SOURCE_DIR||'.local-data';
  for(const row of allExpressions) {
    const raw=JSON.parse(readFileSync(`${sourceDir}/${row.gene}.json`,'utf8'));
    assert.equal(row.mean,raw[row.weighting].regions.mean[row.region]??null);
    assert.equal(row.detection_fraction,raw[row.weighting].regions.detection[row.region]??null);
    assert.equal(row.cell_count,raw.support[row.region]?.cells??null);
    assert.equal(row.donor_count,raw.support[row.region]?.donors??null);comparisons+=4;
    assert.equal(row.expression_scale,null);assert.equal(row.scope,'global_cross_study');
  }
  const overview=JSON.parse(readFileSync(`${sourceDir}/overview.json`,'utf8'));
  assert.equal(dataset.cell_count,overview.metrics.cells);assert.equal(dataset.donor_count,overview.metrics.donors);
  for(const r of bundle.regions) assert.equal(r.cell_count,overview.brodCounts[r.name]);
  pass('independent_source_JSON_values_match');
} else {assert.equal(allExpressions[0].mean,null);assert.equal(allExpressions[0].detection_fraction,0);pass('missing_is_distinct_from_zero');}
assert.equal((await call('get_paper_evidence',{query:bundle.evidence[0].topics[0]})).items[0].id,bundle.evidence[0].id);pass('evidence_with_source_and_status');
for(const key of ['disease','age','donor','dataset_id']) assert.equal((await client.callTool({name:'get_expression_summary',arguments:{genes:[bundle.expressions[0].gene],[key]:'unsupported'}})).isError,true);pass('unsupported_expression_filters_rejected');
assert.equal((await client.callTool({name:'get_expression_summary',arguments:{genes:[]}})).isError,true);pass('empty_genes_rejected');
assert.equal((await call('get_expression_summary',{genes:['NO-SUCH-GENE']})).status,'NO_MATCH');pass('unavailable_gene_not_fabricated');
const exported=(await call('get_export',{export_id:bundle.exports[0].id})).items[0];
const response=await fetch(exported.url);assert.equal(response.status,200);const bytes=Buffer.from(await response.arrayBuffer());
assert.equal(createHash('sha256').update(bytes).digest('hex'),exported.sha256);pass('signed_export_download_sha256');
const tamper=new URL(exported.url);tamper.searchParams.set('id','other');assert.equal((await fetch(tamper)).status,403);pass('tampered_export_rejected');
const expired=new URL(exported.url);expired.searchParams.set('expires','1');assert.equal((await fetch(expired)).status,403);pass('expired_export_rejected');
if(process.env.TEST_MUTATIONS==='1') {
  assert.ok(origin.startsWith('http://localhost:'));assert.equal(bundle.release.authorization_scope,'internal_pilot');
  const file=resolve(dataDir,bundle.exports[0].object_key);const corrupt=Buffer.from(bytes);corrupt[0]^=1;
  try {writeFileSync(file,corrupt);assert.equal((await fetch(exported.url)).status,503);pass('same_size_export_corruption_rejected');}finally{writeFileSync(file,bytes);}
  const cfgPath=resolve(process.env.AUTH_DIR||'.local-data/auth','config.json');const original=readFileSync(cfgPath);
  try {const cfg=JSON.parse(original.toString());const user=cfg.users.find((u:any)=>u.key_hash===createHash('sha256').update(key).digest('hex'));assert.ok(user);user.active=false;writeFileSync(cfgPath,JSON.stringify(cfg));assert.equal((await request('/mcp',{headers:{Authorization:`Bearer ${key}`}})).status,401);assert.equal((await fetch(exported.url)).status,403);pass('revocation_blocks_MCP_and_download');}finally{writeFileSync(cfgPath,original);}
}
await client.close();
const report={at:new Date().toISOString(),transport:origin.includes('8794')?'cloudflare-local-gateway':'node-http',release:bundle.release.id,datasets:bundle.datasets.length,expression_rows:allExpressions.length,source_value_comparisons:comparisons,checks,passed:checks.length,scope:'Integration and value-fidelity checks only; not model accuracy, full atlas validation or a 100-user load test.',...(existsSync('.local-data/source-manifest.json')&&bundle.release.id.startsWith('website-sample-')?{sources:JSON.parse(readFileSync('.local-data/source-manifest.json','utf8'))}:{})};
mkdirSync('artifacts',{recursive:true});writeFileSync(process.env.REPORT_PATH||'artifacts/validation.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({...report,sources:undefined},null,2));
