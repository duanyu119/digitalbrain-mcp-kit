# 数据接入约定

实验室提供一个目录，包含 `bundle.json` 和已批准的导出文件。程序启动时校验并加载一个固定版本。只读挂载这个目录，认证配置与审计库分别保存在另两个目录。

```text
data/
  bundle.json
  RELEASE_ID/
    SHA256/
      approved-result.csv
```

`bundle.json` 顶层恰好包含 `release`、`datasets`、`regions`、`expressions`、`evidence`、`exports`。五类记录数组可以为空，每类 ID 不能重复。严格格式定义在 [`src/schema.ts`](../src/schema.ts)。用 `npm run fixture` 生成完整的合成示例；它不是科研数据，不要拿其数值做科研验证。

```bash
node --experimental-strip-types scripts/check-bundle.ts /ABSOLUTE/PATH/TO/data
```

## 发布记录

`release` 包含：

- `id`：稳定唯一 ID；`data_version`：团队数据版本。
- `retrieved_at`：ISO 8601 UTC 时间。
- `authorization_reference`：团队发布批准记录编号/说明。
- `authorization_scope`：`internal_pilot` 或 `external_research`。前者只能在 loopback origin 下启动；后者需由运营者真实取得相应权限。
- `sources`：至少一个 HTTPS 来源，每条含 `url`、`locator`（可 null）和 `kind`（`official_website` / `primary_paper` / `authorized_export`）。
- `limitations`：至少一条限制，模型客户端每次都能读到。

## 记录语义

每条记录必须有 `sources`、`limitations`、`cell_count`、`donor_count`。缺失的数量必须用 null，不能用 0 代替；对不同基因的支撑计数不能直接相加成总供体数。

| 记录 | 关键约束 |
| --- | --- |
| dataset | `collection`、样本类型、年龄上下限、数量可以 null；脑区和疾病数组只能填已知标签。年龄搜索采用“已知区间相交”，不是每个细胞都处在该年龄区间。ID 必须在不同 collection 之间唯一。 |
| region | `naming_system` 与来源位置必须说明统计范围；`composition_scope` 为 `region_resolved` 时才能填写 `cell_types` 中的整数计数；不从边际统计反推联合组成。当前样本不导入网站的组成比例。 |
| expression | `scope` 固定为 `global_cross_study`；`weighting` 只接受 `cell_weighted` / `donor_balanced`；检出比例须为 0–1 或 null；均值为有限数字或 null；单位用 `expression_scale` 明示，未核实则 null。 |
| evidence | 把作者主张、验证依据和推断分开；`publication_status` 不因来源是网站而自动设为同行评议。 |
| export | 路径必须严格等于 `release.id/sha256/filename`；字节数和 SHA-256 必须匹配；最大 100 MB；每次生成链接和实际下载均校验内容。 |

脑区表达查询按 `region` 的原样标签匹配；不会自动合并缩写、同义词、脑回标签和 Brodmann 标签。基因大小写不敏感，但不自动进行基因别名映射。查询未指定细胞类型时只返回 `cell_type:null` 的区域汇总，不将细胞类型明细再次汇总。

`search_datasets` 和 `get_expression_summary` 返回 `next_offset`；客户端应翻页直到 null。最多 25 条/页、5 个基因/次，响应正文上限 60 KB，过大时应减小 limit。`NO_MATCH` 只说明当前批准数据包没有相应记录，不代表生物学阴性。

## 团队已有数据库时

Cloudflare 只调用固定实验室地址的 `POST /v1/tools/工具名`，JSON 参数与 MCP 工具一致。必须带实验室服务密钥和已注册用户编号。接口返回 MCP 工具结果形状：`content`（文本）和 `structuredContent`（结构化对象）。后者包含 `status`、`items` 及版本/来源/范围等信息。

现成服务在 `src/server.ts`；查询选择逻辑在 `src/tools.ts`。数据库适配应放在实验室一侧，使用参数化查询，并保持权限检查、配额、严格参数和缺失值语义。Cloudflare 不接收数据库密码，不透传研究者 OAuth token，也不允许客户端提交任意 URL、SQL、文件路径或代码。

更新时先在独立目录运行校验和验收，备份旧目录，再切换 `DATA_PATH` 并 `docker compose up -d --force-recreate`。不要在容器运行时逐个覆盖同一发布目录中的文件；回滚采用同样方式恢复旧目录。
