import test from 'node:test';
import assert from 'node:assert/strict';
import {bundleSchema,recordSchemas,toolSchemas} from '../src/schema.ts';
import {select} from '../src/tools.ts';
import {readFileSync} from 'node:fs';
const bundle=bundleSchema.parse(JSON.parse(readFileSync('.local-data/fixture/bundle.json','utf8')));
test('unsupported expression filters must never be silently discarded',()=>{
  for(const field of ['disease','age','donor','dataset_id']) assert.equal(toolSchemas.get_expression_summary.safeParse({genes:['TESTGENE'],[field]:'x'}).success,false);
});
test('unknown age does not satisfy a cohort filter; source missingness is preserved',()=>{
  assert.deepEqual(select(bundle,'search_datasets',{age_min_years:20}).items,[]);
  const rows=select(bundle,'get_expression_summary',{genes:['TESTGENE']}).items as any[];
  assert.equal(rows[0].mean,null);assert.equal(rows[0].detection_fraction,0);
});
test('scope-level cell counts cannot be labeled as region composition',()=>{
  assert.equal(recordSchemas.region.safeParse({...bundle.regions[0],composition_scope:'scope_level_only',cell_types:[{name:'neuron',cells:3}]}).success,false);
});
test('exports cannot escape the data directory by traversal',()=>{
  assert.equal(recordSchemas.export.safeParse({...bundle.exports[0],object_key:'../auth/config.json'}).success,false);
});
