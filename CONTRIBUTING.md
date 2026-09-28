# Contributing

先阅读[能力开发指南](docs/capability-authoring.md)和[安全策略](SECURITY.md)。

## 应用本地诊断与历史报告

列表或详情提取失败先留在应用本地诊断。站点、网络、权限、配置与业务规则由应用处理；原因未知不等于中央缺陷。已复现能力缺口由应用维护 agent 先修复并验证，再按[贡献接收契约](docs/contribution-intake.md)提交可复用成果。不要把未修复报告、采集内容或网站清单直接贴到公开 Issue。

```powershell
node bin/web-extract.mjs feedback:validate --report examples/problem-feedback/detail.json
node bin/web-extract.mjs feedback:reproduce --report examples/problem-feedback/detail.json
```

以上离线接口继续兼容历史报告，不上传样本，也不触发中央代修。历史问题 key、链接与证据保留，不因流程迁移批量关闭或标记解决。迁移说明见[问题反馈](docs/problem-feedback.md)。

当前源码已停用旧公开报告的自动接收和代修入口；远程流程是否生效以实际部署为准。贡献公开之前必须检查全部内容并取得覆盖具体内容的公开授权：公开网址、哈希或“已脱敏”声明不能替代授权与检查。优先使用合成样本；不得提交凭据、浏览器状态、个人或业务私有数据。普通调用与失败不会自动上报使用记录。原每周维护任务的职责迁移另行交接，本次不修改调度。

## 提交代码或网站参考

提交前运行：

```powershell
npm ci
npm test
npm run validate
npm run docs:smoke
npm run audit:sensitive
```

每个新能力必须包含清单、实现、脱敏 fixture、正常路径测试和失败路径测试。不要提交账号、Cookie、token、浏览器状态或第三方私有数据。

已有能力适用于新公开网站时，允许使用 `examples/website-reference-contribution` 只贡献 `verifiedTargets` 网站参考，不需要复制适配器。贡献必须包含 URL 匹配规则、验证级别、日期和脱敏 fixture 或可复跑测试证据；`reported` 项不得宣称可以直接使用。新增参考应递增对应能力的补丁版本。

当前源码已停用旧的可信作者/路径自动合并流程，保留工作流文件和历史。独立验收通过后仍由维护方审阅通用化与集成，再按有效授权提交、合并和发布；本地迁移不代表远程已生效。核心、依赖、CI、权限、安全策略和许可证仍需人工审核。

应用先解决能力缺口，再按[贡献接收契约](docs/contribution-intake.md)回流实现、测试和脱敏证据；
公开前审查和授权不可省略。集成与发布证据见[远程状态说明](docs/contribution-publication.md)。

向本项目提交贡献即表示该贡献按 Apache License 2.0 提供。
