# 贡献与远程合并/发布的关联（尚未发布）

集成记录及观察结果结构见 [publication schema](../schemas/contribution-publication.schema.json)，
可通过 `contribution:protocol` 的 publicationSchema 字段发现；schema 通过不证明记录来自中央。

本地 `contribution:status` 只查询维护方接收记录。远程状态由显式调用的
`getContributionPublicationStatus()` / `contribution:publication` 查询，不在正常提取、失败诊断或定时任务中自动联网。
接口固定读取中央公开 GitHub 仓库，不读取用户凭据，不接受提交者指定的 API 地址，不跟随重定向。

## 集成记录

维护方完成通用化和独立验证后，对已验证事件调用：

```text
node bin/web-extract.mjs contribution:integration-record --store <private-intake-store> --key <contribution-key> --event <event-id>
```

对应 API 为 `prepareContributionIntegration({ storeDir, contributionKey, eventId })`。
仅 `verified` 且 `publicReady` 的本地事件可生成记录；旧包、受阻/失败事件或外部 passed JSON 不能生成。
返回的 `record` 包含 schemaVersion:1、contributionKey、packSha256、eventId、verificationDigest。
这些哈希用于绑定证据，不代表匿名化或电子签名。

在获得该集成的提交授权并完成公开审查后，维护方将 `record` 对象作为
`contributions/accepted/<packSha256>.json` 与实际通用化代码一起提交到集成 PR。
命令本身不会写入该文件、创建 PR、推送或发布。样本、原始回执、来源应用名和访问清单不放入此记录。
旧“可信作者 + 路径 + CI”自动合并流程已在当前源码停用，保留原工作流文件与历史；
不再以作者白名单替代独立贡献验收。变更已推送验收分支，尚未合并默认分支，不能据此认定默认分支的自动合并已停用。
维护方必须审查记录与实际代码对应关系；一份标识文件不能独立证明代码语义或生产效果。

## 查询

```text
node bin/web-extract.mjs contribution:publication --store <private-intake-store> --key <contribution-key> --event <event-id> --pull-request <central-pr-number> --release <stable-release-tag>
```

对应 API 为 `getContributionPublicationStatus({ storeDir, contributionKey, eventId, pullRequestNumber, releaseTag })`。
releaseTag 可省略，此时只查合并状态。只接受稳定版本标签 `v主.次.补丁`。

查询先验证本地证据，再检查中央仓库 PR 的实际 merged 标志、merge commit，以及该固定提交中的同一绑定记录。
随后将 Release 标签解析为 commit，比较该 commit 是否包含 merge commit，并在该固定 commit 再次读取绑定记录。
查询结束再次核对标签未变化。任意一次网络错误、404、缺记录或关系不符都返回未验证原因，不能推断发布成功。
提交关系使用 [GitHub Compare API](https://docs.github.com/en/rest/commits/commits#compare-two-commits)，
标签解析使用 [Git references API](https://docs.github.com/en/rest/git/refs#get-a-reference)。

返回 `publicationVersion:1`、ok、reasons，以及：

| 字段 | 值及含义 |
| --- | --- |
| mergeStatus | unverified、pending、closed-unmerged、merged |
| releaseStatus | unverified、not-applicable、not-requested、published |
| mergeCommit / releaseCommit | 对应固定提交，仅有证据时返回 |
| reusable / adopted | 始终 false；查询不提升目录支持状态或替消费方采用 |

PR 关闭不等于合并，稳定 Release 存在不等于包含本贡献。`published` 只证明指定发布标签中的贡献关联；
不代替 Release 资产校验、应用同输入比较、生产验收或回滚门禁。PR 记录可以用于追溯，但对外展示前仍需公开授权。

当前证据规则的正反单元测试已通过，但没有本轮真实已验证/合并/发布贡献可用于远程正向端到端测试。
本功能不宣称当前变更已经推送、合并或发布；实际远程验收仍是交付前待完成项。
