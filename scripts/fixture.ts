import {mkdirSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {bundleSchema} from '../src/schema.ts';
const out=process.env.DATA_DIR||'.local-data/fixture';mkdirSync(out,{recursive:true,mode:0o700});
const sources=[{url:'https://example.org/synthetic-test',locator:'Entirely synthetic',kind:'authorized_export' as const}];
const common={sources,limitations:['Synthetic fixture, no biological meaning.'],cell_count:null,donor_count:null};
const bytes=Buffer.from('gene,mean,detection\nTESTGENE,,0\n');const hash=createHash('sha256').update(bytes).digest('hex');
const object_key=`synthetic/${hash}/test.csv`;mkdirSync(`${out}/synthetic/${hash}`,{recursive:true});writeFileSync(`${out}/${object_key}`,bytes);
const bundle=bundleSchema.parse({release:{id:'synthetic',retrieved_at:'2026-09-17T00:00:00Z',data_version:'synthetic-1',authorization_reference:'Generated test data only',authorization_scope:'internal_pilot',sources,limitations:common.limitations},
datasets:[{...common,id:'synthetic-dataset',name:'Synthetic dataset',collection:null,regions:['TEST_REGION'],diseases:[],sample_type:null,age_min_years:null,age_max_years:null,download_url:null,usage_terms:'Synthetic'}],
regions:[{...common,id:'TEST_REGION',name:'TEST_REGION',naming_system:'synthetic',parent_id:null,composition_scope:'not_provided',cell_types:[]}],
expressions:[{...common,id:'synthetic-expression',gene:'TESTGENE',region:'TEST_REGION',cell_type:null,scope:'global_cross_study',weighting:'cell_weighted',expression_scale:null,mean:null,detection_fraction:0}],
evidence:[{...common,id:'synthetic-evidence',title:'Synthetic evidence',topics:['TESTGENE'],author_claim:'Test only',validation_evidence:null,inference:null,publication_status:'not_provided'}],
exports:[{...common,id:'synthetic-export',filename:'test.csv',object_key,sha256:hash,bytes:bytes.length,media_type:'text/csv'}]});
writeFileSync(`${out}/bundle.json`,JSON.stringify(bundle,null,2));console.log(`Synthetic fixture: ${out}`);
