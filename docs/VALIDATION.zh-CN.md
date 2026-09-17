# 真实数据验证记录

验证日期：**2026-09-17**。原始取样来源为 [DigitalBrain 官网](https://digitalbrain-human.com/) 当前前端使用的公开 JSON 接口。采用网站正常匿名会话、小样本顺序读取，不从旧 Git 历史恢复数据，不轮换身份规避额度。原始 JSON、cookie、整理后的数据包和导出文件都保存在本地，被 Git 和 Docker 构建上下文排除。

完整的无密钥记录见 [validation-record.json](validation-record.json)，其中保留来源 URL、获取时间、原始响应字节数、SHA-256、检查项目和结果。它不包含原始数据行、供体标识、访问密钥或下载令牌。

## 取了什么

| 数据 | 实际范围 | 注意 |
| --- | --- | --- |
| 网站目录 | 75 个 collection、109 条 dataset 目录记录 | 目录不等于下载了 109 个原始数据集；其中只补全了 All_neurons 的概况 |
| 单个数据集概况 | Collection-19 / All_neurons | 读取概况中的数量和标签；没有把其中供体条目导入服务 |
| 脑区概况 | M1C、V1C、SN 共 3 条 | 数量限定在 All_neurons；不冒充整个图谱数量 |
| 基因表达 | ASIC2、AKT2；两种网站加权口径；共 648 条区域汇总记录 | 不读取 cell-type detail；不从汇总计算疾病/年龄/供体对照 |
| 证据卡 | 网站表达范围说明 1 条 | 标记为官网信息，未标记为论文结论 |
| 导出 | 本地生成的上述表达汇总 JSON | 用于下载完整性测试，不随代码分发 |

目录返回 109 个数据集；表达索引 `scope` 报告纳入 **99 个数据集**，排除 10 个。这是两个不同层次的覆盖范围。目录名称含疾病不代表该疾病已经可作为表达工具的过滤条件。

## 实际执行结果

| 路径 | 结果 |
| --- | --- |
| Node HTTP 服务 + 官方 MCP 客户端 | 19 项检查通过 |
| Docker 容器 + 官方 MCP 客户端 | 19 项检查通过；容器健康检查通过 |
| Cloudflare 本地 Workers 运行时 → 实验室 HTTP 服务 | 17 项数据与安全检查通过 |
| OAuth 注册、显式同意、PKCE、刷新、重放拒绝等 | 12 项检查通过，含网关到实验室联调 |
| TypeScript 类型检查、4 项语义测试 | 通过 |
| Worker 部署打包 dry run | 通过；并未据此声称已部署公网生产服务 |

三个 MCP 查询路径均逐条核对 648 条表达记录。每条核对均值、检出比例、支撑细胞数、支撑供体数，共 **2,592 个数值字段/路径**，对照的是原始网站 JSON，而不只对照转换后的文件。同时核对目录翻页、数据集数量字段、脑区数量、证据类型和缺失值语义。

真实安全路径检查包括：未认证请求拒绝、外来 Origin 拒绝、超长请求拒绝、不支持的表达过滤条件拒绝、空基因列表拒绝、不存在基因返回 NO_MATCH、签名下载 SHA-256、一处改动后拒绝、过期链接拒绝。Node 和 Docker 路径还在隔离验证数据上执行了**同长度文件篡改**与**用户撤销**测试，最后恢复测试环境。

补充的独立模型审阅两次请求均超时，没有取得独立审阅结论，不计入上述通过项目。运行依赖的 npm audit 在本次检查中报告 0 个已知漏洞；这不等于全面安全审计。

自动化 CI 使用合成数据，不持续抓取官网。它会在干净 Linux 环境中重新安装、检查类型、启动 Docker、调用 MCP 和本地 Cloudflare 网关；首轮公开仓库验收已通过：[GitHub Actions 记录](https://github.com/duanyu119/digitalbrain-mcp-kit/actions/runs/35232002069)（2026-09-17，Linux，耗时 1 分 18 秒）。后续状态以仓库 Actions 记录为准。

## 如何复现

按 README 启动后：

```bash
npm run validate
node --experimental-strip-types scripts/check-bundle.ts .local-data/data
```

取样默认使用现有缓存，便于对同一响应复现；`npm run sample -- --refresh` 才重新读取，必须遵守网站当时的限额和使用条款。网站内容改变会导致校验和改变，生成新的样本版本。`TEST_MUTATIONS=1 npm run validate` 会暂时改动测试导出和用户状态，仅用于独立的本机验证环境，不要对生产包运行。

## 没有验证的事项

没有全量下载/检查 1,600 多万个细胞，没有运行模型权重、复现实验、验证因果关系或提供临床证据。没有进行 100 名研究者并发测试、长周期运行测试，也没有验证团队内网部署后的负载。公开代码是可交付起点，不能把上述集成通过说成论文或产品效果通过。

官网 JSON 没有提供足以确认本样本表达归一化单位的信息，因此 `expression_scale` 保持 null；不把显示色阶 `densityScale` 当作单位。两种加权名称忠实保留，不声称独立核实过其科学实现。统计数量可能随网站版本更新。

## 来源及可靠性

- [官网目录接口](https://digitalbrain-human.com/api/v1/catalog)、[基因索引](https://digitalbrain-human.com/api/v1/gene-data/index.json)、[ASIC2 回包](https://digitalbrain-human.com/api/v1/gene-data/genes/ASIC2.json)、[AKT2 回包](https://digitalbrain-human.com/api/v1/gene-data/genes/AKT2.json)、[All_neurons 概况](https://digitalbrain-human.com/api/v1/overview?collection=Collection-19&dataset=All_neurons)：网站直接维护的原始接口，适合核对“当前网站给出的是什么”；未经本项目独立科学复核，且不是承诺长期稳定的第三方 API。直接打开可能先要求正常网站会话。
- [官方 About 页面](https://digitalbrain-human.com/about.html)：原站说明，属于项目方自述。
- [官方旧仓库迁移说明](https://github.com/LuMengLab/digitalbrain-data-explorer)：原创维护者公告，明确旧数据不能据旧克隆/发布包重新分发。本项目未使用旧副本。
- [预印本原始地址](https://www.biorxiv.org/content/10.64898/2026.04.14.718492v1)：背景引用；本轮没有基于全文或论文附件做结果复现，也没有把二手镜像当作实验数据。

数据版权与许可仍需权利人确定。能够匿名读取并不等于获得重新托管、商业分发或提供公共下载的授权。
