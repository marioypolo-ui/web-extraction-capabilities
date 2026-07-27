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

## 反馈已验证网站

每个能力清单都包含 `verifiedTargets`。应用发现现有能力适用于新的公开网站时，可以只反馈网站参考，不必复制一套解析器。每项参考包含：

```json
{
  "name": "公开网站名称",
  "referenceUrl": "https://example.test/notices",
  "match": {
    "host": "example.test",
    "pathPrefix": "/notices"
  },
  "verification": "fixture-tested",
  "verifiedAt": "2026-07-27",
  "evidence": ["fixtures/example.html", "tests/example.test.mjs"]
}
```

验证级别：

- `fixture-tested`：有脱敏页面或接口 fixture 和自动测试，可作为复用候选。
- `live-tested`：有可复跑测试，并在标注日期实际验证过，可作为复用候选。
- `reported`：只记录已知现象或待验证网站，不参与自动路由。

执行 `node bin/web-extract.mjs catalog --url "<网站URL>"` 检查反馈结果。网站参考只允许公开 HTTP/HTTPS 地址；不得包含账号、Cookie、token、内网地址、个人信息或应用业务规则。新增网站参考必须增加证据；修改已有能力参考时递增该能力的补丁版本。

中央库没有对应方法时，先在应用内验证新能力，再同时反馈能力实现和网站参考。中央库发布稳定版本后，原应用应更新 Bundle、比较 `catalogSha256` 并删除或停用重复的应用私有解析代码。

只反馈网站参考时，复制 `examples/website-reference-contribution`，不需要复制或提交中央适配器：

```powershell
node bin/web-extract.mjs contribution:pack --source examples/website-reference-contribution --output dist/reference
```

## 本地验证

```powershell
npm test
node bin/web-extract.mjs validate
node bin/web-extract.mjs contribution:pack --source examples/capability-contribution --output dist/contribution
node bin/web-extract.mjs contribution:pack --source examples/website-reference-contribution --output dist/reference
```

贡献包拒绝 `.github`、依赖清单、锁文件和符号链接。PR 中涉及核心运行时、CI、权限、依赖、安全规则或许可证时，不属于自动合并范围。

## 测试要求

测试必须证明正常提取和至少一个失败路径。API 失败、0 记录、登录、缺浏览器依赖或人工验证不得静默。fixture 只能是合成内容或已脱敏的公开页面。
