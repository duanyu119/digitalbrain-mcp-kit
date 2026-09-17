import { randomBytes, createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync, renameSync } from 'node:fs';
import { resolve } from 'node:path';
const [command, name = 'researcher'] = process.argv.slice(2);
const dir = resolve(process.env.AUTH_DIR || '.local-data/auth');
mkdirSync(dir, {recursive:true,mode:0o700});
const file = `${dir}/config.json`;
const save = cfg => { writeFileSync(`${file}.tmp`,JSON.stringify(cfg,null,2),{mode:0o600}); renameSync(`${file}.tmp`,file); };
function add(cfg,id,role) {
  if (!/^[a-zA-Z0-9_-]{1,50}$/.test(id) || cfg.users.some(u=>u.id===id) || existsSync(`${dir}/${id}.key`)) throw Error('Invalid or existing user; choose a new ID.');
  const key=`db_${randomBytes(32).toString('base64url')}`;
  writeFileSync(`${dir}/${id}.key`,`${key}\n`,{mode:0o600,flag:'wx'});
  cfg.users.push({id,role,key_hash:createHash('sha256').update(key).digest('hex'),active:true,expires_at:Math.floor(Date.now()/1000)+90*86400});
}
if(command==='init') {
  if(existsSync(file)) throw Error('Already initialized; refusing to overwrite credentials.');
  const cfg={signing_key:randomBytes(32).toString('hex'),users:[]}; add(cfg,'researcher','human');add(cfg,'gateway','gateway');save(cfg);
  mkdirSync('.local-data/state',{recursive:true,mode:0o700});
  if(!existsSync('.env')) writeFileSync('.env',`LOCAL_UID=${process.getuid?.()||1000}\nLOCAL_GID=${process.getgid?.()||1000}\n`,{mode:0o600,flag:'wx'});
  console.log('Created auth/config.json, researcher.key and gateway.key under AUTH_DIR (default .local-data/auth). Keys expire in 90 days; their values are never printed.');
} else if(command==='rotate-gateway') {
  const cfg=JSON.parse(readFileSync(file,'utf8'));const user=cfg.users.find(u=>u.id==='gateway'&&u.role==='gateway');
  if(!user) throw Error('Gateway service identity missing');
  const key=`db_${randomBytes(32).toString('base64url')}`;
  user.key_hash=createHash('sha256').update(key).digest('hex');user.active=true;user.expires_at=Math.floor(Date.now()/1000)+90*86400;
  writeFileSync(`${dir}/gateway.key.tmp`,key+'\n',{mode:0o600});renameSync(`${dir}/gateway.key.tmp`,`${dir}/gateway.key`);save(cfg);
  console.log('Gateway credential rotated. Update the Worker secret before restoring traffic.');
} else if(command==='add' || command==='revoke') {
  const cfg=JSON.parse(readFileSync(file,'utf8'));
  if(command==='add') add(cfg,name,'human');
  else {const user=cfg.users.find(u=>u.id===name);if(!user) throw Error('Unknown user');user.active=false;}
  save(cfg);console.log(`${command}: ${name}; effective on next request.`);
} else throw Error('Usage: node scripts/admin.mjs init | add USER | revoke USER | rotate-gateway');
