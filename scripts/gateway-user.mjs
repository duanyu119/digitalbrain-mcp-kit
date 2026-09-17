import {readFileSync,writeFileSync,unlinkSync,mkdirSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
const [command,id,...flags]=process.argv.slice(2);
if(!['add','revoke'].includes(command)||!/^[a-zA-Z0-9_-]{1,50}$/.test(id||'')||flags.some(f=>f!=='--remote')) throw Error('Usage: node scripts/gateway-user.mjs add|revoke USER [--remote]');
const cfg=JSON.parse(readFileSync(resolve(process.env.AUTH_DIR||'.local-data/auth','config.json'),'utf8'));
const user=cfg.users.find(u=>u.id===id&&u.role==='human');if(!user) throw Error('Create the same user with scripts/admin.mjs first');
if(!/^[a-f0-9]{64}$/.test(user.key_hash)||!Number.isInteger(user.expires_at)) throw Error('Invalid user config');
const sql=command==='add'?`INSERT INTO users(id,key_hash,active,expires_at) VALUES('${id}','${user.key_hash}',${user.active?1:0},${user.expires_at}) ON CONFLICT(id) DO UPDATE SET key_hash=excluded.key_hash,active=excluded.active,expires_at=excluded.expires_at;`:`UPDATE users SET active=0 WHERE id='${id}';`;
mkdirSync('artifacts',{recursive:true});const path=resolve(`artifacts/user-${randomUUID()}.sql`);writeFileSync(path,sql,{mode:0o600});
try{execFileSync('npx',['wrangler','d1','execute','DB','--config','gateway/wrangler.jsonc',flags.includes('--remote')?'--remote':'--local','--file',path],{stdio:'pipe'});console.log(`${command}: ${id} on gateway`);}finally{unlinkSync(path);}
