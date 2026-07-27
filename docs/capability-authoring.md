# 开发和反馈新能力

## 目录

从 `examples/capability-contribution` 复制一份，至少包含：

- `capability.json`：稳定 ID、版本、类型、范围、识别特征、要求和文件映射。
- `adapter.mjs`：实现代码。
- 脱敏 fixture。
- 真实行为测试。

能力范围使用：

- `generic`：不依赖单一组织或域名。
- `platform-family`：同一 CMS、接口协议或产品家族。
- `site-specific`：只能验证一个网站，必须明确标注。

不能自动完成的能力使用 `conditional`、`human-required` 或 `unsupported`，不得返回伪造记录。

## 本地验证

```powershell
npm test
node bin/web-extract.mjs validate
node bin/web-extract.mjs contribution:pack --source examples/capability-contribution --output dist/contribution
```

贡献包拒绝 `.github`、依赖清单、锁文件和符号链接。PR 中涉及核心运行时、CI、权限、依赖、安全规则或许可证时，不属于自动合并范围。

## 测试要求

测试必须证明正常提取和至少一个失败路径。API 失败、0 记录、登录、缺浏览器依赖或人工验证不得静默。fixture 只能是合成内容或已脱敏的公开页面。
