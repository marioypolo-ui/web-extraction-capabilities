# 消费应用接入交接清单（本地实现，尚未发布）

本清单供“招标信息检索”等消费应用维护 agent 对接。中央任务不修改应用、飞书、通知、
计划任务或生产配置。当前新契约仍待真实隔离验收和发布；不要假设已发布 v0.2.0 提供这些接口。

## 应用侧需要做什么

1. 保留本地诊断记录。网站宕机、404、超时、限流、权限、URL 配置和业务规则由应用处理；
   `classifyProblem()` 的 `unknown` 不代表中央缺陷。旧 `validateProblemReport()`、
   `reproduceProblem()` 继续可用，不会自动触发中央代修。
2. 应用维护 agent 在自有适配层修复并验证能力缺口。计划任务只发现问题和记录证据，不能自主改生产代码。
3. 可复用实现提交 capability 包；现有能力已适用的新网站提交 website-reference 包。
   新网站类型用 `new-capability`；修复已有能力用 `capability-fix`，沿用能力 ID，提供原版本基准、
   旧失败/新通过用例和原行为通过用例。参考贡献用 `website-reference`，基准用例必须通过，不伪造实现。
4. 实现、测试、脱敏 fixture 和 `contribution.json` 使用[贡献 schema](../schemas/contribution.schema.json)。
   填写 base 能力 ID/版本及库版本、适用/不适用范围、entryPoint、conditions、dependencies、verification。
   不能仅附 `application-verification.json` 或一个 `passed` 字段。
5. 先审查将离开应用的全部内容。用合成数据保留失败结构，排除账号、签名链接、业务来源组合、
   用户身份、完整页面和浏览器状态。真实公共网址及其组合仍可能暴露业务关系，必须取得覆盖具体内容的公开授权。

## 实际本地接口和顺序

从通过来源校验的固定版本调用，以下路径中的 `<bundle>` 是该版本目录：

```text
node <bundle>/bin/web-extract.mjs contribution:protocol
node <bundle>/bin/web-extract.mjs contribution:pack --source <minimal-contribution-directory> --output <new-pack-directory>
node <bundle>/bin/web-extract.mjs contribution:validate --contribution <new-pack-directory>
```

输出目录必须是新目录，不能覆盖旧包。打包和静态校验不会运行包内测试，也不代表独立验收。
打包回执的 disclosure.contentSha256 对应本次内容审查范围；代码或样本有任何修改后重新打包、重新审查。
公开审查 JSON 按[审查 schema](../schemas/contribution-disclosure.schema.json)单独准备，
不能自动替用户填 `reviewed: true` 来规避授权。审查文件不作为应用身份或匿名化证明。

维护方通过[接收接口](contribution-intake.md)调用 `receiveContribution()`，提供维护方本地 store、
可信基线双哈希和固定 Linux 镜像。该接口会留存源文件并运行独立验收；不会上传 GitHub 或创建 Issue。
当前没有公共托管接收服务。实际对外提交必须走项目允许的贡献渠道，并在发送前完成公开审查和授权。
不要先发公开报错 Issue，再指望 Actions 拦截已泄露的内容。

## 状态怎么判断

| 状态 | 应用侧含义与行动 |
| --- | --- |
| `ready-for-independent-validation` | 静态校验通过，等待中央独立验收 |
| `needs-evidence` | 补实现、基准或回归证据；历史包不会被静默升级为已验证 |
| `needs-disclosure-review` | 缺内容对应的公开审查，保持本地 |
| `blocked` | 隔离环境、镜像、可信基准或存储锁受阻；按原因处理后重试 |
| `rejected` | 修复对应字段、内容、样本或测试后重新打包；保留旧失败记录 |
| `received` | 仅表示记录成功，继续检查嵌套 `verification.status` |
| `verified` | 独立验证通过，仍等通用化、集成审阅和发布；不是应用已采用 |
| `recorded` / `not-found` | 本地接收库的查询结果；不是 GitHub 状态 |

回执带 `receiptVersion: 1`，结构见[回执 schema](../schemas/contribution-receipt.schema.json)。
保存 `contributionKey`、`eventId`、包哈希和必要的公开来源链接；不要把私有路径、原始日志、
正文或访问清单放入公开状态记录。同包重试幂等；补证据使用新包哈希，旧事件保留。
`mergeStatus: not-recorded`、`releaseStatus: not-recorded` 表示尚无关联证据，不能翻译为已经合并或发布。
远程合并/发布关联使用另一个显式的[公开 GitHub 查询](contribution-publication.md)，本地查询不会自动联网。
该关联实现仍待真实远程正向验收，应用不能仅依靠本地记录自动判定新能力可下载。

## 新版本发现和采用

先查是否有新稳定 Release，再准备候选验收样本。没有候选版本时不强制生产扫描；
站点暂不可达记为环境受阻，不记为版本回归，也不能算通过。自动检查/切换策略仍由各应用决定。

下载固定 Release 后，先用归档外的可信 SHA256 校验来源，再执行 Bundle 校验。
`createBundleRuntime()` 在提供该契约的版本上暴露可选 `contributionProtocol`；
检查其中 schemaVersion 和 schema 路径，并检查所需 API 是否存在。
旧 Bundle 缺少这些声明时继续原运行方式；不能因库版本号看起来较新就猜测协议存在。
CLI 也可使用 `contribution:protocol` 发现。不要跟踪 main 作为生产依赖。

应用仍需执行自己的同输入记录级比较、诊断比较、政府/行政事业单位直连及无代理兜底检查、
生产验收和回滚门禁，按自身授权切换。中央测试通过、打包、Issue 关闭、PR 合并或 Release 发布，
均不能单独证明原生产故障已修复。应用自有补丁只在对应 Release 采用并验证等价后再考虑移除。

## 尚未交付的条件

真实容器隔离拒绝宿主读取/网络/写入的实测、固定 Release 下三类贡献的端到端红绿证据、
远程合并/Release 状态证据关联和最终发布尚未完成。schema 已用固定版本 Ajv 完成标准校验和正反样例检查。
每周维护任务的旧职责文字也尚未同步；调度修改不在本任务范围，本清单不代表已修改。
