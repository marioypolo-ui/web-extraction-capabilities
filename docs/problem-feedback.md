# 应用本地诊断与贡献迁移

本页对应 v0.3.0 的迁移行为；新接口不能假定已存在于固定 v0.2.0 Bundle。v0.2.0 的离线报告格式、`validateProblemReport`、`reproduceProblem` 和对应 CLI 保持兼容，但“公开故障报告后由中央代修”的默认流程退役。

## 责任与本地流程

- 宕机、404、超时、限流等站点/网络问题由应用处理。
- 登录权限、URL、字段配置、依赖和业务规则属于应用问题。
- 原因未知先在应用定位，不自动判中央能力缺陷。
- 已复现能力缺口由应用维护 agent 在应用自有适配层修复并测试；计划任务不得自行改生产代码。
- 中央接收已解决且验证过的可复用实现、回归测试和最小样本，再独立验证。已有能力适用时只贡献网站参考即可。

报告默认留在应用本地。普通调用和诊断失败均不自动上报，真实网址、栏目清单及来源应用信息也可能暴露业务关系。

```powershell
node bin/web-extract.mjs feedback:validate --report examples/problem-feedback/detail.json
node bin/web-extract.mjs feedback:reproduce --report examples/problem-feedback/detail.json
node bin/web-extract.mjs feedback:validate --report examples/problem-feedback/list.json
node bin/web-extract.mjs feedback:reproduce --report examples/problem-feedback/list.json
```

例子是合成内容。详情预期满足时状态为 `not-reproduced`；列表示例会产生 `reproduced`。校验有效退出 0；复现只有 `not-reproduced` 退出 0，其他状态退出 1。退出码不取代结构化回执。

当前源码提供 `classifyProblem({ diagnosticCodes, applicationIssue, reproduction })` 和 `feedback:classify --report <本地分类输入.json>`。分类输入可以包含实际诊断码、明确的应用原因，以及上述复现回执。返回 `category`、`owner`、`nextAction`、`autoSubmit:false` 和 `verifiedContribution:false`。分类不会读取凭据、请求网站或提交 Issue；自报 `passed` 不构成验证证据。

| category | 处理 |
|---|---|
| site-network-failure | 应用恢复站点或网络条件 |
| application-problem | 应用修正会话、配置或业务策略 |
| unknown | 本地继续定位，不认定中央缺陷 |
| reproduced-capability-gap | 应用先修复并验证，再准备贡献 |

“已验证能力贡献”和“网站参考”属于贡献接收结果，不由本地故障分类接口授予。

## 报告包含什么

报告必须声明 `schemaVersion: 1` 和 `sanitized: true`。机器可读定义和完整可运行示例随版本提供；以 [详情示例](../examples/problem-feedback/detail.json) 和[列表示例](../examples/problem-feedback/list.json)为起点。

| 字段 | 含义 |
|---|---|
| `operation` | `list` 或 `detail` |
| `symptom` | `missing-record`、`missing-title`、`missing-link`、`wrong-date`、`missing-body`、`missing-table`、`missing-image` 或 `missing-attachment` |
| `pageUrl` | 发生问题的公开页面地址 |
| `libraryVersion` | 应用当时使用的库版本 |
| `capabilityId`、`capabilityVersion` | 当时实际使用的能力及版本 |
| `target` | 要核对的目标标题和 URL；详情通常为当前文章，列表为出问题的记录 |
| `sample` | `format: "html"` 配 `stage: "static"` 或 `"rendered"`；`format: "json"` 配 `stage: "api"`。`content` 为脱敏后的内容字符串 |
| `expected` | 样本中能核对的预期日期、正文片段、表格文字、图片或附件地址；标题与链接由 `target` 表达 |
| `config` | 复现所需的纯解析配置，例如选择器或 JSON 字段映射 |

预期内容应来自样本证据，不能把推测或业务筛选结果当成解析错误。一个报告聚焦一个目标和一种症状；同页不同目标或不同症状分别反馈。

列表只接受 `missing-record`、`missing-title`、`missing-link` 和 `wrong-date`；详情接受除 `missing-record` 外的症状。标题和链接问题均以 `target` 给出的正确值核对。

`expected` 支持 `contentIncludes`、`tableTextIncludes`、`imageUrls`、`attachmentUrls` 字符串数组，以及 `publishedAt` 日期字符串。复现会在同一个目标条目上核对标题、URL 和全部期望，不能用不同记录分别满足条件来掩盖错误。

`wrong-date` 需给出 `expected.publishedAt`；正文、表格、图片、附件症状分别需给出非空的 `contentIncludes`、`tableTextIncludes`、`imageUrls`、`attachmentUrls`。漏记录、标题或链接问题可以只提供 `target`。

`config` 只接受 `contentSelector`、`titleSelector`、`dateSelector`、`itemsPath`、`itemPath`、`contentFormat`、`fields` 和 `actionUrlTemplate`。`fields` 只接受 `title`、`url`、`publishedAt`、`summary`、`content`、`images`、`attachments` 的字符串路径。不能把运行配置中的网络或浏览器设置复制进报告。

`sample.content` 最长 40,000 字符，整个序列化报告最长 60,000 字符；提交足够重现问题的最小内容。JSON 样本的 `content` 仍是字符串，其内容必须可解析为 JSON；根对象字段映射可省略 `itemPath`。

只提交纯解析配置。Cookie、Authorization、token、账号密码、storage state、浏览器 Profile、CDP 会话地址、个人信息、内网地址及私有业务数据不得进入公开 issue、样本或附件。URL 的查询参数、HTML 属性、内嵌 JSON、注释和脚本内容也要检查并脱敏。`sanitized: true` 是提交者声明，自动审计无法代替脱敏。


## 隐私边界

`feedback:validate` 是诊断格式与部分敏感特征检查，不是公开许可，也不能识别所有商业秘密和个人信息。`sanitized:true` 仅是提交者声明。不得将报告全文直接粘贴到公开 Issue 或评论。

准备贡献时，优先用合成内容保留触发问题的结构；只包含必要文件。公开前检查所有文件、路径及元数据，并取得覆盖具体内容的授权；真实网站是公开的，不代表其关注清单可公开。内容发生变化后需要重新审查。哈希仅用于完整性和去重，不能匿名化网址。

GitHub 创建 Issue 后再检查不能阻止首次泄露。历史材料如疑似泄露，只记录不含敏感值的定位和处置需求，不复述内容、不擅删历史或撤销凭据。

## 复现范围

复现只解析报告中的样本，不读取 `pageUrl`，不执行样本脚本，不启动浏览器或访问私有 API。`sample.stage: "rendered"` 只表示内容由应用从渲染页面保存，不表示中央库重新执行了浏览器操作。

因此，离线样本可以证明文字、表格和链接的解析差异，不能证明真实网络、代理、登录会话、验证码、点击时序或浏览器环境正常。只在运行环境发生的问题需要补充脱敏证据或交给授权人员处理；不能声称未知网站都可以自动修复。

报告记录的是应用发生问题时的版本，GitHub 工作流使用中央仓库默认分支的可信代码复现，不下载或执行报告指定版本、模块或代码。新版已修复时可能无法再现旧版错误，应核对工作流回执与发布版本。

复现回执包含 `status`、`problemKey`、`reportedVersion`、`testedVersion`、`operation`、`symptom`、`replayMode`、逐项 `checks` 和 `diagnosticCodes`，不回显完整样本或正文。`ok: true` 表示完成了复现操作，不能据此认定已修复；应读取 `status` 和各项检查。

`reproduced` 表示至少一项预期不满足，`not-reproduced` 表示本次回放中全部预期满足；`needs-maintainer` 表示复现过程需要维护者检查，`invalid` 表示报告被拒绝。任何状态都应结合实际测试版本和样本范围解释。


## 历史兼容与接收迁移

历史 Issue、评论、问题 key、版本、样本和回执保留原状。不能因迁移批量关闭、重开、改标签或宣称原故障解决。原单中的旧标签只代表历史状态，不是继续自动代修的授权。应用自己的记录继续保留历史链接。

`.github/workflows/problem-feedback.yml` 保留工作流身份和历史运行记录，但不再监听 Issue/评论，也不再上传报告或维护任务产物。手动运行仅返回迁移说明，不能算复现成功。旧 `scripts/problem-intake.mjs prepare/publish` CLI 返回 `LEGACY_PUBLICATION_DISABLED` 和非零退出码，不读取输入事件、不写产物、不对外请求。源码中的旧分诊辅助函数仅保留历史兼容测试，不属于新接入入口；默认程序化发布也已禁用。

需要复现历史报告时，在应用本地使用原来的 `feedback:validate` / `feedback:reproduce`。复现成功、旧 Issue 关闭都不等于应用已采用修复。

准备已验证成果请使用[贡献指南](capability-authoring.md)。当前源码的 `contribution:protocol` 可查询协议；`contribution:validate --contribution <贡献包目录>` 仅做独立静态核验，通过状态 `ready-for-independent-validation` 仍不是中央测试完成或可复用声明。缺少新证据的旧包返回 `needs-evidence`。

中央维护心跳的现有配置属于外部调度，本次源码迁移不修改它。若仍包含“代修未解决报告”的旧指令，须按新的应用/中央职责交接，不能宣称已经同步。发布及应用升级仍遵守[升级与回滚](upgrades.md)中的各自门禁。
