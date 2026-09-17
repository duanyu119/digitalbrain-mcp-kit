import {readFileSync,statSync,realpathSync} from 'node:fs';
import {resolve,sep} from 'node:path';
import {createHash} from 'node:crypto';
import {bundleSchema} from '../src/schema.ts';
const dir=realpathSync(process.argv[2]||'.local-data/data');
if(statSync(`${dir}/bundle.json`).size>100_000_000) throw Error('Bundle too large');
const b=bundleSchema.parse(JSON.parse(readFileSync(`${dir}/bundle.json`,'utf8')));
for(const rows of [b.datasets,b.regions,b.expressions,b.evidence,b.exports]) if(rows.length!==new Set(rows.map(r=>r.id)).size) throw Error('Duplicate record IDs');
for(const e of b.exports) {
  if(e.object_key!==`${b.release.id}/${e.sha256}/${e.filename}`) throw Error('Export path must contain release ID and checksum');
  const p=realpathSync(resolve(dir,e.object_key));if(!p.startsWith(dir+sep)||statSync(p).size!==e.bytes) throw Error('Invalid file path/size');
  if(createHash('sha256').update(readFileSync(p)).digest('hex')!==e.sha256) throw Error('Export checksum mismatch');
}
console.log(JSON.stringify({status:'valid',release:b.release.id,authorization_scope:b.release.authorization_scope,datasets:b.datasets.length,expressions:b.expressions.length,exports:b.exports.length}));
