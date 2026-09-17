import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync, renameSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { bundleSchema } from '../src/schema.ts';

// Small, operator-initiated website sample. Reuse one cookie jar and cached responses.
// No quota retries, cookie rotation, donor-detail requests or historical repository data.
const base='https://digitalbrain-human.com';
const root='.local-data';const out=`${root}/data`;mkdirSync(out,{recursive:true,mode:0o700});
if(existsSync(`${out}/bundle.json`) && JSON.parse(readFileSync(`${out}/bundle.json`,'utf8')).release.authorization_scope!=='internal_pilot') throw Error('Refusing to overwrite a production release.');
const refresh=process.argv.includes('--refresh');
const endpoints:Record<string,string>={catalog:'/api/v1/catalog','gene-index':'/api/v1/gene-data/index.json',overview:'/api/v1/overview?collection=Collection-19&dataset=All_neurons',ASIC2:'/api/v1/gene-data/genes/ASIC2.json',AKT2:'/api/v1/gene-data/genes/AKT2.json'};
if(refresh || Object.keys(endpoints).some(k=>!existsSync(`${root}/${k}.json`))) {
  execFileSync('curl',['--fail','--silent','--show-error','--max-time','45','--cookie',`${root}/cookies.txt`,'--cookie-jar',`${root}/cookies.txt`,`${base}/api/v1/session`,'-o',`${root}/session.json`],{stdio:'pipe'});
}
const sha=(data:Buffer|string)=>createHash('sha256').update(data).digest('hex');
const manifest:any[]=[];const raw:Record<string,any>={};
for(const [key,path] of Object.entries(endpoints)) {
  const file=`${root}/${key}.json`;
  if(refresh || !existsSync(file)) {
    try {execFileSync('curl',['--fail','--silent','--show-error','--max-time','45','--max-filesize','12000000','--cookie',`${root}/cookies.txt`,`${base}${path}`,'-o',`${file}.tmp`],{stdio:'pipe'});JSON.parse(readFileSync(`${file}.tmp`,'utf8'));renameSync(`${file}.tmp`,file);}
    catch {throw Error(`Source unavailable: ${base}${path}. Stop and respect site quota; do not rotate sessions.`);}
  }
  const bytes=readFileSync(file);raw[key]=JSON.parse(bytes.toString());manifest.push({url:base+path,file:key+'.json',sha256:sha(bytes),bytes:bytes.length,retrieved_at:statSync(file).mtime.toISOString(),reused_cache:!refresh});
}
if(!Array.isArray(raw.catalog) || raw.overview.scopeKey!=='dataset' || raw.overview.scopeLabel!=='All_neurons') throw Error('Upstream catalog/overview changed; inspect before adapting.');
const source=(key:string,locator:string|null=null)=>({url:base+endpoints[key],locator,kind:'official_website' as const});
const limitations=['Local validation subset only; no redistribution permission is implied.','Global expression is pooled across studies; disease, age, donor and dataset expression filters are unsupported.','Expression normalization units are not established by these JSON files; mean values retain the source scale.'];
const common={cell_count:null,donor_count:null,limitations:['Metadata unavailable in this response remains null; absence does not mean zero.']};
const datasetId=(collection:string,id:string)=>`${collection}-${sha(id).slice(0,16)}`;
const datasets=raw.catalog.flatMap((c:any)=>c.datasets.map((d:any)=>{
  const enriched=c.id==='Collection-19' && d.id==='All_neurons';
  return {...common,id:datasetId(c.id,d.id),name:d.name,collection:c.name,regions:enriched?raw.overview.brodmannRegions:[],diseases:enriched?raw.overview.statuses:[],sample_type:null,age_min_years:null,age_max_years:null,download_url:null,usage_terms:'Website read access only; contact the data owner for hosting or redistribution rights.',cell_count:enriched?raw.overview.metrics.cells:null,donor_count:enriched?raw.overview.metrics.donors:null,sources:[source('catalog',`${c.id} / ${d.id}`),...(enriched?[source('overview','metrics')]:[])]};
}));
const regions=['M1C','V1C','SN'].map(region=>({...common,id:region,name:region,naming_system:'Website brodmannRegions; Collection-19 / All_neurons ONLY',parent_id:null,composition_scope:'not_provided',cell_types:[],cell_count:raw.overview.brodCounts[region]??null,donor_count:null,sources:[source('overview',`brodCounts.${region}`)],limitations:['Counts apply only to Collection-19 / All_neurons, not the atlas-wide expression layer.','Region composition fractions are not imported or converted to integer cell counts; anatomical labels retain the website spelling.']}));
const expressions:any[]=[];
for(const gene of ['ASIC2','AKT2']) {
  const payload=raw[gene];if(payload.symbol!==gene) throw Error('Unexpected gene symbol');
  for(const weighting of ['cell_weighted','donor_balanced']) {
    const metrics=payload[weighting]?.regions;if(!metrics?.mean || !metrics?.detection) throw Error('Unexpected gene payload');
    for(const region of new Set([...Object.keys(metrics.mean),...Object.keys(metrics.detection)])) {
      const support=payload.support?.[region];
      expressions.push({id:`${gene}-${weighting}-${sha(region).slice(0,16)}`,gene,region,cell_type:null,scope:'global_cross_study',weighting,expression_scale:null,mean:metrics.mean[region]??null,detection_fraction:metrics.detection[region]??null,cell_count:support?.cells??null,donor_count:support?.donors??null,sources:[source(gene,`${weighting}.regions; support.${region}`)],limitations:['Counts are gene-specific support, not total atlas cells or unique donors across regions.','Weighting names are preserved from the website; this adapter does not recompute or validate the aggregation algorithm.','No cell-type detail imported; unknown expression units remain null.']});
    }
  }
}
const evidence=[{...common,id:'website-expression-scope',title:'Website expression layer coverage',topics:['ASIC2','AKT2','expression','scope'],author_claim:`The current website gene index reports ${raw['gene-index'].scope.datasets} included datasets and ${raw['gene-index'].scope.cells} cells; ${raw['gene-index'].scope.excludedDatasets} datasets are excluded.`,validation_evidence:'The adapter checks payload shape and copies two genes without reaggregation; the end-to-end validation compares every sampled row to these source JSON files.',inference:null,publication_status:'not_provided',sources:[source('gene-index','scope')],limitations:['This is a website metadata statement, not a paper result, model benchmark or independent biological replication.']}];
const releaseId=`website-sample-${sha(manifest.map(m=>m.sha256).join('')).slice(0,16)}`;
const exportBytes=Buffer.from(JSON.stringify(expressions,null,2)+'\n');const digest=sha(exportBytes);const filename='expression-sample.json';const object_key=`${releaseId}/${digest}/${filename}`;
mkdirSync(`${out}/${releaseId}/${digest}`,{recursive:true,mode:0o700});writeFileSync(`${out}/${object_key}`,exportBytes,{mode:0o600});
const bundle=bundleSchema.parse({release:{id:releaseId,retrieved_at:new Date().toISOString(),data_version:releaseId,authorization_reference:'Public website read-only access; LOCAL validation only. No right to republish inferred.',authorization_scope:'internal_pilot',sources:[source('catalog'),source('gene-index')],limitations},datasets,regions,expressions,evidence,exports:[{...common,id:'expression-sample',filename,object_key,sha256:digest,bytes:exportBytes.length,media_type:'application/json',sources:[source('ASIC2'),source('AKT2')],limitations:['Local test export; do not redistribute this file without data-owner permission.']}]});
writeFileSync(`${out}/bundle.json.tmp`,JSON.stringify(bundle,null,2),{mode:0o600});renameSync(`${out}/bundle.json.tmp`,`${out}/bundle.json`);
writeFileSync(`${root}/source-manifest.json`,JSON.stringify(manifest,null,2),{mode:0o600});
console.log(JSON.stringify({release:releaseId,datasets:datasets.length,regions:regions.length,expression_rows:expressions.length,output:`${out}/bundle.json`,data_scope:'internal_pilot'}));
