import { createServer } from 'node:http';
import { readFileSync, realpathSync, statSync, mkdirSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { createMcpHandler } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { bundleSchema, toolSchemas, type ToolName } from './schema.ts';
import { makeServer, select, toolResult, type Bundle } from './tools.ts';

const origin=new URL(process.env.PUBLIC_ORIGIN || 'http://localhost:8787');
if(origin.origin!==origin.href.replace(/\/$/,'')) throw Error('PUBLIC_ORIGIN must be an origin without a path.');
const local=['localhost','127.0.0.1','[::1]'].includes(origin.hostname);
if(!local && origin.protocol!=='https:') throw Error('Public deployment requires HTTPS.');
const dataDir=realpathSync(process.env.DATA_DIR || '.local-data/data');
const authPath=resolve(process.env.AUTH_DIR || '.local-data/auth','config.json');
const stateDir=resolve(process.env.STATE_DIR || '.local-data/state');mkdirSync(stateDir,{recursive:true,mode:0o700});
if(statSync(`${dataDir}/bundle.json`).size>100_000_000) throw Error('Bundle exceeds 100 MB; use a database adapter for larger releases.');
const bundle:Bundle=bundleSchema.parse(JSON.parse(readFileSync(`${dataDir}/bundle.json`,'utf8')));
for(const records of [bundle.datasets,bundle.regions,bundle.expressions,bundle.evidence,bundle.exports]) if(new Set(records.map(r=>r.id)).size!==records.length) throw Error('Duplicate record IDs');
if(bundle.release.authorization_scope==='internal_pilot' && !local) throw Error('Internal validation data cannot be served at a public origin. Supply a release approved for external research.');
const configSchema=z.strictObject({signing_key:z.string().regex(/^[a-f0-9]{64}$/),users:z.array(z.strictObject({id:z.string().regex(/^[a-zA-Z0-9_-]{1,50}$/),role:z.enum(['human','gateway']),key_hash:z.string().regex(/^[a-f0-9]{64}$/),active:z.boolean(),expires_at:z.number().int()}))});
const config=()=>configSchema.parse(JSON.parse(readFileSync(authPath,'utf8')));config();
const db=new DatabaseSync(`${stateDir}/usage.sqlite`);db.exec(`PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS usage(user TEXT,day TEXT,count INTEGER,PRIMARY KEY(user,day)); CREATE TABLE IF NOT EXISTS audit(at TEXT,user TEXT,tool TEXT,status TEXT);`);
const quota=Number(process.env.DAILY_QUOTA || 1000);
if(!Number.isInteger(quota)||quota<1||quota>100000) throw Error('Invalid DAILY_QUOTA');
const now=()=>Math.floor(Date.now()/1000);
const hash=(value: string|Buffer)=>createHash('sha256').update(value).digest('hex');
const active=(id:string)=>config().users.find(u=>u.id===id && u.role==='human' && u.active && u.expires_at>now());
const sign=(value:string)=>createHmac('sha256',config().signing_key).update(value).digest('hex');
const clean=()=>{db.exec("DELETE FROM audit WHERE at < strftime('%Y-%m-%dT%H:%M:%fZ','now','-30 days'); DELETE FROM usage WHERE day < date('now','-30 days');");};
clean();const cleanup=setInterval(clean,3600000);cleanup.unref();
function exportBytes(id:string) {
  const item=bundle.exports.find(e=>e.id===id);if(!item) throw Error('Export not found');
  if(item.object_key!==`${bundle.release.id}/${item.sha256}/${item.filename}`) throw Error('Invalid export manifest');
  const path=realpathSync(resolve(dataDir,item.object_key));if(!path.startsWith(dataDir+sep)||statSync(path).size!==item.bytes) throw Error('Invalid export path or size');
  const bytes=readFileSync(path);if(hash(bytes)!==item.sha256) throw Error('Export checksum mismatch');
  return {item,bytes};
}
async function run(name:ToolName,args:unknown,user:string) {
  try {
    toolSchemas[name].parse(args);
    const row=db.prepare('INSERT INTO usage(user,day,count) VALUES(?,?,1) ON CONFLICT(user,day) DO UPDATE SET count=count+1 WHERE count<? RETURNING count').get(user,new Date().toISOString().slice(0,10),quota);
    if(!row) return toolResult({status:'QUOTA_EXCEEDED',items:[],reset:'00:00 UTC'},true);
    const result=select(bundle,name,args);
    if(name==='get_export' && result.status==='OK') {
      const {item}=exportBytes(toolSchemas.get_export.parse(args).export_id);
      const expires=now()+300;const signed=JSON.stringify([bundle.release.id,item.id,user,expires]);
      const url=new URL('/download',origin);url.search=new URLSearchParams({release:bundle.release.id,id:item.id,user,expires:String(expires),sig:sign(signed)}).toString();
      const {object_key,storage_md5,...publicItem}=item;
      result.items=[{...publicItem,url:url.href,expires_at:new Date(expires*1000).toISOString()}];
    }
    const output=toolResult(result);
    db.prepare('INSERT INTO audit VALUES(?,?,?,?)').run(new Date().toISOString(),user,name,String(output.structuredContent.status));
    return output;
  } catch(e) {
    const status=e instanceof z.ZodError?'INVALID_ARGUMENTS':'DATA_UNAVAILABLE';
    db.prepare('INSERT INTO audit VALUES(?,?,?,?)').run(new Date().toISOString(),user,name,status);
    return toolResult({status,items:[],message:'Check parameters or ask the data operator to inspect the release.'},true);
  }
}
const response=(value:unknown,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'}});
async function route(request:Request):Promise<Response> {
  const url=new URL(request.url);
  if(url.origin!==origin.origin) return response({error:'Invalid host'},403);
  if(request.headers.has('origin') && request.headers.get('origin')!==origin.origin) return response({error:'Invalid origin'},403);
  if(url.pathname==='/health' && request.method==='GET') return response({status:'ok',service:'digitalbrain-mcp-kit',version:'1.0.0',data_scope:bundle.release.authorization_scope,server_llm_calls:0});
  if(url.pathname==='/download' && request.method==='GET') {
    const p=url.searchParams;const release=p.get('release')||'',id=p.get('id')||'',user=p.get('user')||'',expires=Number(p.get('expires')),sig=p.get('sig')||'';
    if(release!==bundle.release.id || !Number.isInteger(expires)||expires<=now()||expires>now()+300||!active(user)||!/^[a-f0-9]{64}$/.test(sig)||!timingSafeEqual(Buffer.from(sig,'hex'),Buffer.from(sign(JSON.stringify([release,id,user,expires])),'hex'))) return response({error:'Invalid or expired link'},403);
    try {const {item,bytes}=exportBytes(id);return new Response(bytes,{headers:{'Content-Type':item.media_type,'Content-Disposition':`attachment; filename="${item.filename}"`,'X-Content-SHA256':item.sha256,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'}});} catch {return response({error:'Export unavailable or checksum mismatch'},503);}
  }
  const token=request.headers.get('authorization')?.match(/^Bearer (db_[A-Za-z0-9_-]{43})$/)?.[1];
  const principal=token?config().users.find(u=>u.key_hash===hash(token) && u.active && u.expires_at>now()):undefined;
  if(!principal) return response({error:'Authentication required'},401);
  if(url.pathname==='/mcp' && principal.role==='human') {
    // One factory closure per request prevents user context from crossing requests.
    const handler=createMcpHandler(()=>makeServer((name,args)=>run(name,args,principal.id)));
    const result=await handler.fetch(request);
    return result;
  }
  const name=url.pathname.slice('/v1/tools/'.length) as ToolName;
  if(url.pathname.startsWith('/v1/tools/') && Object.hasOwn(toolSchemas,name) && request.method==='POST' && principal.role==='gateway') {
    const user=request.headers.get('x-research-user')||'';
    if(!active(user)) return response({error:'User revoked or expired'},403);
    if(!request.headers.get('content-type')?.startsWith('application/json')) return response({error:'JSON required'},415);
    return response(await run(name,await request.json(),user));
  }
  return response({error:'Not found'},404);
}
const server=createServer(async(req,res)=>{
  try {
    if(req.headers.host!==origin.host) {res.writeHead(403);res.end('Invalid host');req.resume();return;}
    let size=0;const chunks:Buffer[]=[];
    for await(const chunk of req) {size+=chunk.length;if(size>16384) {res.writeHead(413);res.end('Request too large');return;}chunks.push(chunk);}
    const headers=new Headers();for(const [key,value] of Object.entries(req.headers)) if(value) headers.set(key,Array.isArray(value)?value.join(','):value);
    const request=new Request(new URL(req.url||'/',origin),{method:req.method,headers,...(req.method!=='GET'&&req.method!=='HEAD'?{body:Buffer.concat(chunks)}:{})});
    const result=await route(request);res.writeHead(result.status,Object.fromEntries(result.headers));
    if(result.body) {const reader=result.body.getReader();res.on('close',()=>void reader.cancel().catch(()=>{}));for(;;){const {done,value}=await reader.read();if(done) break;res.write(value);}}
    res.end();
  } catch {if(!res.headersSent) res.writeHead(400,{'Content-Type':'application/json'});res.end('{"error":"Request failed"}');}
});
server.requestTimeout=15000;server.headersTimeout=10000;
server.listen(Number(process.env.PORT || 8787),process.env.HOST || '127.0.0.1',()=>console.log(JSON.stringify({event:'ready',port:Number(process.env.PORT||8787),release:bundle.release.id})));
process.on('SIGTERM',()=>{server.close(()=>{db.close();process.exit(0);});setTimeout(()=>process.exit(0),10000).unref();});
