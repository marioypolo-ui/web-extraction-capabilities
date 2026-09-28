# 贡献接收与记录（尚未发布）

当前源码提供维护方本地接收 API，不会自动向 GitHub 提交内容或建立 Issue。
先在应用侧解决能力缺口、补齐回归测试和最小脱敏样本，再按现有贡献格式打包。
公开授权必须覆盖实际包内容；自动扫描和内容哈希不能证明全部匿名化。

## 实际接口

`contribution:protocol` 返回协议版本及 schema 相对路径：

- [贡献元数据 schema](../schemas/contribution.schema.json)：对应包内 `contribution.json`。
- [公开审查 schema](../schemas/contribution-disclosure.schema.json)：对应包外、覆盖实际内容哈希的审查文件。
- [新能力合成示例](../examples/verified-capability-contribution/contribution.json)：实现入口接受单个 input 对象并返回 records/diagnostics，包含旧失败/新通过、旧行为和空输入用例。
- [网站参考合成示例](../examples/verified-website-reference-contribution/contribution.json)：使用已有基准实现，不提交伪造的新能力。

schema 规定 JSON 结构；运行时还检查路径设备名、唯一用例 ID、URL/隐私、文件完整性、
受支持选择器和公开授权。通过 schema 不等于独立验收通过。详情预期引用现有详情结果 schema，
逐层检查表格单元格、图片和附件。离线配置仅允许解析字段，不能带代理、网络请求设置、
原始数据回传或业务筛选策略。渲染后 HTML 可作为离线样本，但不能据此声称浏览器或登录过程已验收。

原 `examples/capability-contribution`、`examples/website-reference-contribution` 保留作旧包兼容样例。
新示例名称中的 verified 表示贡献方准备的验证材料，不表示中央已经完成容器验收、集成或发布。

维护检查 `npm run schema:validate -- <pinned-schema-tools-directory>` 使用 Ajv 8.17.1 和
ajv-formats 3.0.1，验证四份 schema 及真实 API 回执和正反样例。工具目录由维护方独立取得，
不是贡献包提供的依赖；CI 在临时目录用空 npm 配置、禁用安装脚本取得这两个固定版本。
缺工具或检查失败时命令非零退出，不回退为仅检查 JSON 语法。

- `receiveContribution({ storeDir, contributionDir, publicationReview, baseline, image })`：独立校验并记录验收结果。
- `getContributionStatus({ storeDir, contributionKey })`：查询同一能力或网站参考的历次记录。
- `verifyContribution(...)` 的基线、镜像和公开审查参数见 [能力编写说明](capability-authoring.md)。

```text
node bin/web-extract.mjs contribution:receive --store <maintenance-local-directory> --contribution <pack-directory> --publication-review <review-json-file> --baseline <trusted-bundle-directory> --baseline-sha256 <trusted-bundle-hash> --baseline-manifest-sha256 <trusted-manifest-hash> --image <pinned-local-image-id>
node bin/web-extract.mjs contribution:status --store <maintenance-local-directory> --key <returned-contribution-key>
```

`storeDir` 由维护方指定，不能位于贡献包内，不能经过符号链接或 Windows junction。
存储目录应放在维护方私有本地目录中，不提交 Git，不作为公开 Actions 产物。
没有有效公开审查时返回 `needs-disclosure-review`，不创建接收记录。
受损包在接收前拒绝，不因附带 `passed` 或应用回执而绕过验证。

## 接收、验证与采用分别判断

接收返回 `status: received`、`contributionKey`、`eventId`、`duplicate` 和嵌套的
`verification`。`ok: true` 只表示记录成功；必须另查 `verification.status`。
旧包仍可记录为 `needs-evidence`；环境缺失记录为 `blocked`，不伪装成已验证。
接收 CLI 的零退出码也只表示记录成功。

查询结果中的 `events` 保留每次不同结果的包哈希、执行环境标识哈希、验收回执摘要、
完整回执哈希和逐条比较结果。内容地址用于完整性与重试去重，不表示匿名化、签名或公开授权。
`objects/<packSha256>` 保留独立校验过的贡献源文件；后续验证使用这份本地快照，
不依赖应用继续保留原提交目录。已有归档每次重验，不覆盖或自动修复受损历史。
此目录是维护方可信本地记录；他人发送的目录或 JSON 不是可信中央审核证明。
当前不提供导入第三方成功回执的接口。

相同包、相同上下文、相同结果重试会复用事件，不重复建单。每次重试仍执行真实校验；
缺失环境恢复后可原参数重试，新的实际结果产生新事件。改变样本、代码或审查内容后重新打包，
获得新包哈希和对应公开审查；沿原 `contributionKey` 保留补证据记录。
事件集合不代表时间排序，不按“最后一个成功”覆盖旧失败。旧失败需维护方结合新证据审阅。

能力按既有 capability ID 归组，版本保留在贡献包证据中；网站参考按 capability ID、
现有目录匹配规则中的小写 host/pathPrefix 归组，不按应用名或业务项目复制能力。
同一网站展示名的变化不产生另一套能力。实现不同但语义相似的不同 ID 仍需人工通用化审阅。

`mergeStatus`、`releaseStatus` 当前返回 `not-recorded`：此本地接口没有远程状态证据，
绝不能把它解释为已合并、已发布或确定未发布。显式的[远程证据查询](contribution-publication.md)与本地记录分开，
只有关联到真实已验证事件、合并提交和发布提交时才报告对应状态；该查询的真实远程正向验收仍待完成。
顶层 `verifiedContribution: false`、`reusable: false` 不由历史事件自动提升；
单条独立验收通过后仍需集成审阅、发布和消费方自己的升级验收。

## 异常与兼容

`INTAKE_BUSY` 表示另一读写操作持有锁，稍后重试。崩溃留下的锁需维护方确认没有运行中的
操作后处理；程序不会擅自删锁或清理历史。证据损坏返回明确拒绝，不跳过坏记录。
历史报告继续使用原离线校验/复现接口；未修复的应用工单不进入中央代修。
新接口尚未发布，真实容器正向验收及远程状态关联尚未完成；现有 v0.2.0 消费者不能据此宣称已可升级。
