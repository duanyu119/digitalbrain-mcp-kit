import { OAuthProvider } from '@cloudflare/workers-oauth-provider';
import { createMcpHandler } from 'agents/mcp/server';
import { z } from 'zod';
import { authorize } from './auth.ts';
import { makeServer, toolResult } from '../src/tools.ts';
import { toolSchemas, recordSchemas, type ToolName } from '../src/schema.ts';
import { activeUser, boundedBody, html, type AppEnv } from './security.ts';

const kinds={search_datasets:'dataset',get_dataset_info:'dataset',get_region_profile:'region',get_expression_summary:'expression',get_paper_evidence:'evidence',get_export:'export'} as const;
async function proxy(env:Env,user:string,name:ToolName,args:unknown) {
  const parsed=toolSchemas[name].parse(args);
  try {
    const origin=new URL(env.LAB_ORIGIN);
    if(origin.origin!==env.LAB_ORIGIN || (origin.protocol!=='https:' && !(env.PUBLIC_ORIGIN.startsWith('http://localhost:') && ['localhost','127.0.0.1'].includes(origin.hostname)))) throw Error('Invalid lab origin');
    const upstream=await fetch(new URL(`/v1/tools/${name}`,origin),{
      method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${env.LAB_SERVICE_TOKEN}`,'X-Research-User':user},
      body:JSON.stringify(parsed),signal:AbortSignal.timeout(15000),redirect:'manual',
    });
    if(!upstream.ok) throw Error('Upstream unavailable');
    const payload=JSON.parse(new TextDecoder().decode(await boundedBody(upstream,125000)));
    const data=z.object({status:z.enum(['OK','NO_MATCH','INVALID_ARGUMENTS','DATA_UNAVAILABLE','QUOTA_EXCEEDED','RESULT_TOO_LARGE']),items:z.array(z.unknown()).max(25).optional()}).passthrough().parse(payload.structuredContent);
    if(data.status==='OK' || data.status==='NO_MATCH') {
      const schema=name==='get_export'?recordSchemas.export.omit({object_key:true,storage_md5:true}).extend({url:z.url(),expires_at:z.iso.datetime()}):recordSchemas[kinds[name]];
      data.items=z.array(schema).max(25).parse(data.items);
      if(name==='get_export') for(const item of data.items as {url:string}[]) {const link=new URL(item.url);if(link.origin!==origin.origin||link.pathname!=='/download') throw Error('Unexpected download destination');}
    }
    return toolResult(data,!['OK','NO_MATCH'].includes(data.status));
  } catch {return toolResult({status:'LAB_UNAVAILABLE',items:[],message:'The lab endpoint is unavailable or returned an invalid response. No fallback values were generated.'},true);}
}
const defaultHandler:ExportedHandler<AppEnv>={async fetch(request,env){
  const path=new URL(request.url).pathname;
  if(path==='/authorize') return authorize(request,env);
  if(path==='/health'&&request.method==='GET') return Response.json({status:'ok',service:'digitalbrain-mcp-gateway',version:'1.0.0',lab_health:'not_probed',server_llm_calls:0},{headers:{'Cache-Control':'no-store'}});
  if(path==='/'&&request.method==='GET') return html('<h1>DigitalBrain MCP</h1><p>只读科研接口。连接 <code>/mcp</code>，使用团队发放的个人密钥授权。</p><p>原始数据保存在实验室；查询参数和获准返回的摘要会经过本入口与模型客户端。表达汇总不支持疾病、年龄或供体分组。</p><p>独立集成代码，不代表 DigitalBrain 官方认证。</p>');
  return new Response('Not found',{status:404});
}};
const apiHandler={async fetch(request:Request,env:AppEnv,ctx:ExecutionContext){
  const props=z.object({userId:z.string(),scopes:z.array(z.string())}).parse(ctx.props);
  if(!props.scopes.includes('research:read')||!await activeUser(env,props.userId)) return new Response('Access revoked or expired',{status:403});
  const handler=createMcpHandler(()=>makeServer((name,args)=>proxy(env,props.userId,name,args)),{corsOptions:false,allowedHostnames:[new URL(env.PUBLIC_ORIGIN).hostname]});
  return handler(request,env,ctx);
}};
export default {
  async fetch(original,env,ctx){
    try {
      if(new URL(original.url).origin!==env.PUBLIC_ORIGIN) return new Response('Invalid host',{status:403});
      if(original.headers.has('origin')&&original.headers.get('origin')!==env.PUBLIC_ORIGIN) return new Response('Invalid origin',{status:403});
      if(!(await env.REQUEST_LIMITER.limit({key:`ip:${original.headers.get('cf-connecting-ip')||'local'}`})).success) return new Response('Rate limited',{status:429,headers:{'Retry-After':'60'}});
      const request=original.method==='POST'?new Request(original,{body:await boundedBody(original)}):original;
      const provider=new OAuthProvider<AppEnv>({apiRoute:'/mcp',apiHandler,defaultHandler,authorizeEndpoint:'/authorize',tokenEndpoint:'/oauth/token',clientRegistrationEndpoint:'/oauth/register',scopesSupported:['research:read'],allowImplicitFlow:false,allowPlainPKCE:false,accessTokenTTL:3600,refreshTokenTTL:604800,clientRegistrationTTL:604800,resourceMetadata:{resource:`${env.PUBLIC_ORIGIN}/mcp`,...(env.PUBLIC_ORIGIN.startsWith('https://')?{authorization_servers:[env.PUBLIC_ORIGIN]}:{}),scopes_supported:['research:read'],resource_name:'DigitalBrain MCP'},tokenExchangeCallback:options=>({accessTokenProps:{userId:options.userId,scopes:options.requestedScope}}),onError:()=>undefined});
      return await provider.fetch(request,env as AppEnv,ctx);
    } catch(error) {return Response.json({error:error instanceof Error && error.message==='BODY_TOO_LARGE'?'Request too large':'Request failed'},{status:error instanceof Error && error.message==='BODY_TOO_LARGE'?413:400});}
  },
  async scheduled(_event,env,ctx){ctx.waitUntil(env.DB.prepare('DELETE FROM consent_sessions WHERE expires_at<?').bind(Math.floor(Date.now()/1000)).run());},
} satisfies ExportedHandler<Env>;
