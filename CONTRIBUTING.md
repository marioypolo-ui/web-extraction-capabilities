# Contributing

先阅读[能力开发指南](docs/capability-authoring.md)和[安全策略](SECURITY.md)。

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
