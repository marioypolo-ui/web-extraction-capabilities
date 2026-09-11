# Contributing

先阅读[能力开发指南](docs/capability-authoring.md)和[安全策略](SECURITY.md)。

## 报告列表或详情提取问题

应用不必先完成修复再反馈。使用 [Extraction feedback 表单](https://github.com/marioypolo-ui/web-extraction-capabilities/issues/new?template=problem-feedback.yml)提交最小脱敏报告，包含发生问题的版本、公开 URL、目标、样本、症状与可核对的预期；完整契约见[问题反馈](docs/problem-feedback.md)。

```powershell
node bin/web-extract.mjs feedback:validate --report examples/problem-feedback/detail.json
node bin/web-extract.mjs feedback:reproduce --report examples/problem-feedback/detail.json
```

自己的报告先在应用本地校验，再按问题 key 搜索并补充原单；相同页面、目标、操作与症状不因版本或样本变化重复建单。禁止提交 Cookie、token、浏览器状态、个人信息或私有数据；自动审计不能代替脱敏。表单的 `### Feedback JSON`、`json` 代码块及 `### Sanitized checks` 是机器可读接口，不随意改名。

GitHub 工作流只用默认分支可信代码离线读取样本、复现并运行测试，不访问报告 URL 或执行样本脚本。维护 Agent 定期处理 `feedback/needs-maintainer`，将证据加入 fixture 和回归测试，经评审与发布门禁后发布修复，再在原单关联版本并关闭。无法离线复现的网络、浏览器或会话问题需补充证据，不能写成已修复。

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

自动合并只对仓库所有者配置的可信作者开放，并且只能修改能力目录及其 fixture 和测试。核心、依赖、CI、权限、安全策略和许可证始终人工审核。

向本项目提交贡献即表示该贡献按 Apache License 2.0 提供。
