import { type AppEnv, keyUser, html, escapeHtml } from './security.ts';

export async function authorize(request: Request, env: AppEnv) {
  if(request.method==='GET') {
    const auth=await env.OAUTH_PROVIDER.parseAuthRequest(request);
    if(auth.codeChallengeMethod!=='S256' || !auth.codeChallenge || !auth.scope.includes('research:read') || auth.scope.some(s=>s!=='research:read')) return new Response('S256 PKCE and research:read scope are required.',{status:400});
    const client=await env.OAUTH_PROVIDER.lookupClient(auth.clientId);
    if(!client) return new Response('Unknown client',{status:400});
    const session=crypto.randomUUID();
    await env.DB.prepare('INSERT INTO consent_sessions(id,request_url,expires_at) VALUES(?,?,?)').bind(session,request.url,Math.floor(Date.now()/1000)+600).run();
    const secure=env.PUBLIC_ORIGIN.startsWith('https://')?'; Secure':'';
    return html(`<h1>连接 DigitalBrain Research MCP</h1><p>客户端 <strong>${escapeHtml(client.clientName||auth.clientId)}</strong> 请求读取获授权的科研目录和结果，并生成短时下载链接。</p><p>授权范围：<code>research:read</code>。不提供写入、模型训练或任意代码执行。</p><form method="post" action="/authorize"><input type="hidden" name="session" value="${session}"><label>你的个人研究访问密钥<input type="password" name="key" required autocomplete="off" maxlength="46"></label><p><label><input type="checkbox" name="consent" value="yes" required> 我同意将只读权限授予上述客户端</label></p><button type="submit">登录并授权</button></form><p><small>每人独立密钥。数据由实验室服务器提供，服务运营者控制访问范围。关闭本页即可取消。</small></p>`,{'Set-Cookie':`db_consent=${session}; HttpOnly; SameSite=Lax; Path=/authorize; Max-Age=600${secure}`});
  }
  if(request.method!=='POST') return new Response('Method not allowed',{status:405});
  if(request.headers.get('origin')!==env.PUBLIC_ORIGIN) return new Response('Invalid origin',{status:403});
  if(!request.headers.get('content-type')?.startsWith('application/x-www-form-urlencoded')) return new Response('Invalid form type',{status:415});
  const form=await request.formData();
  const session=String(form.get('session')||'');
  const cookie=request.headers.get('cookie')?.split(';').map(v=>v.trim()).find(v=>v.startsWith('db_consent='))?.slice(11);
  if(cookie!==session || form.get('consent')!=='yes') return new Response('Invalid consent',{status:403});
  const saved=await env.DB.prepare('DELETE FROM consent_sessions WHERE id=? AND expires_at>? RETURNING request_url').bind(session,Math.floor(Date.now()/1000)).first<{request_url:string}>();
  if(!saved) return new Response('Authorization expired. Reconnect from your MCP client.',{status:400});
  const user=await keyUser(env,String(form.get('key')||''));
  if(!user) return new Response('Invalid or expired access key. Reconnect to retry.',{status:403});
  const auth=await env.OAUTH_PROVIDER.parseAuthRequest(new Request(saved.request_url));
  const { redirectTo }=await env.OAUTH_PROVIDER.completeAuthorization({request:auth,userId:user.id,metadata:{},scope:['research:read'],props:{userId:user.id,scopes:['research:read']}});
  return new Response(null,{status:302,headers:{Location:redirectTo,'Cache-Control':'no-store','Set-Cookie':'db_consent=; Path=/authorize; HttpOnly; SameSite=Lax; Max-Age=0'}});
}
