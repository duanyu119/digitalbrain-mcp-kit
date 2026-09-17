# 可选 Cloudflare 登录入口

此入口提供 OAuth 授权登录，研究内容由实验室查询服务返回。代码使用官方 OAuth Provider、MCP SDK 和 Cloudflare Agents HTTP 适配器。**本交付包包含可部署配置并完成本地 Workers 运行时联调；没有把官网样本发布为公网科研服务。**

## 先在本机验证

先按 README 启动实验室服务（默认 localhost:8787）。然后：

```bash
node scripts/configure-local.mjs
npx wrangler d1 migrations apply DB --local --config gateway/wrangler.jsonc
node scripts/gateway-user.mjs add researcher
npm run gateway:dev
```

另开终端：

```bash
node scripts/oauth-smoke.mjs
```

脚本执行动态客户端注册、PKCE S256、显式同意、取令牌、六工具查询、下载、刷新与授权码重放拒绝。仅把测试令牌写到被忽略的 `artifacts` 目录。若实验室测试端口是 8795，首次生成配置时使用 `LAB_ORIGIN=http://localhost:8795 node scripts/configure-local.mjs`。已有配置不会被脚本覆盖。

## 部署到团队自己的 Cloudflare 账号

1. 在实验室配置真实域名与 HTTPS 反向代理。将 `PUBLIC_ORIGIN` 设为外部 origin（如 `https://lab-api.example.org`，不带路径），代理保留该 Host；后端仍监听本机端口。挂载的发布包应由团队批准用于 `external_research`。防火墙和代理应对入口、连接数、请求频率与大文件带宽限额；本版实验室服务只实施工具日配额，不包含边缘抗 DDoS 服务。
2. 登录并创建**新的**认证资源：

```bash
npx wrangler login
npx wrangler d1 create digitalbrain-mcp-auth
npx wrangler kv namespace create OAUTH_KV
```

3. 将 `gateway/wrangler.example.jsonc` 复制成 `gateway/wrangler.jsonc`。如果之前生成过本地测试配置，先备份再明确替换。填入新 D1/KV ID、入口 `PUBLIC_ORIGIN` 和实验室 `LAB_ORIGIN`。入口名称可自定；PUBLIC_ORIGIN 必须与部署后的 Workers 域名或自定义域名完全一致。
4. 写入独立的实验室服务密钥并初始化认证库。下列命令不会把密钥放入配置文件或终端输出；密钥来自实验室生成的 gateway.key，应通过团队自己的安全通道交付给入口运营者：

```bash
npx wrangler secret put LAB_SERVICE_TOKEN --config gateway/wrangler.jsonc < .local-data/auth/gateway.key
npx wrangler d1 migrations apply DB --remote --config gateway/wrangler.jsonc
node scripts/gateway-user.mjs add researcher --remote
npm run gateway:deploy
```

5. 在客户端添加 `https://YOUR_GATEWAY/mcp`，用自己的个人研究密钥登录并勾选同意。正式验收至少核对：未登录被拒绝、全部六个工具、数据来源、下载校验、额度和撤销。`/health` 仅说明入口存活，**不会探测实验室服务是否可用**；完整联通必须以工具调用为准。

生产配置与 `.dev.vars` 已被 Git 忽略。`wrangler types gateway/worker-configuration.d.ts --config gateway/wrangler.jsonc` 可重新生成绑定类型。模板没有账户 ID、既有数据库 ID、R2 数据桶或云模型密钥；不会改变交付方已有的私有试点。

## 用户、撤销和故障

新用户先在实验室运行 `node scripts/admin.mjs add USER_ID`，再在入口配置环境运行 `node scripts/gateway-user.mjs add USER_ID --remote`。这个同步脚本读取本地实验室认证记录，只上传该用户的编号、密钥哈希和有效期；不要把完整 auth/config.json 交给无关第三方。

撤销时执行两步：

```bash
node scripts/admin.mjs revoke USER_ID
node scripts/gateway-user.mjs revoke USER_ID --remote
```

实验室撤销立即阻止工具调用和已经发出的下载链接；入口撤销立即阻止该用户现有 OAuth token 调用。仅删除聊天客户端并不等于服务器撤销。服务密钥泄露时，在实验室停用 gateway 用户、运行 `node scripts/admin.mjs rotate-gateway` 生成新服务凭据，再用 `wrangler secret put` 更新 Worker secret；恢复前停止网关流量。

入口每 IP 每分钟 120 次请求，是 Workers 的限流保护，不是严格跨所有边缘节点一致的计费限额。同一机构共用出口 IP 时可能遇到限制，团队应根据实际流量调整。严格工具日配额由实验室 SQLite 负责，按 UTC 日持久化。100 人规模需按实际并发、输出大小、数据版本大小和流量做容量测试；当前没有付费套餐或成本 SLA 承诺。

实验室接口超时或回包异常时返回 `LAB_UNAVAILABLE`，不会生成替代数据。上游只允许固定 origin、不跟随重定向。不要把研究者的 OAuth token 直接交给上游；本包已经使用单独服务密钥。

## 原始技术来源

- [MCP 官方 TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)：协议与客户端实现，原创维护仓库。
- [Cloudflare MCP transport](https://developers.cloudflare.com/agents/model-context-protocol/protocol/transport/)：官方部署参考。
- [MCP authorization](https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization)：官方授权规范，强调受众与令牌边界。
- [Cloudflare OAuth Provider](https://github.com/cloudflare/workers-oauth-provider)：使用的授权实现及维护记录。

版本已在 package-lock.json 固定；升级依赖后需重新运行测试，不把当前验证当作未来版本兼容保证。
