# Web Extraction Capabilities

一个面向独立应用的网页信息获取中央能力库。它把网站类型、识别特征、获取实现、失败诊断、fixture 和测试放在同一版本中。应用负责业务筛选、存储和通知，库只负责把网页转换为统一记录。

[English](README.en.md) | [集成指南](docs/integration.md) | [能力开发](docs/capability-authoring.md) | [诊断码](docs/diagnostics.md)

## 设计边界

- 不静默失败：抓取失败、动态页面、0 条记录、登录、验证码和缺依赖均返回 `diagnostics`。
- 不托管秘密：账号、Cookie、token 和浏览器 Profile 由调用应用保存。
- 不绕过验证：滑块或验证码返回 `HUMAN_VERIFICATION_REQUIRED`。
- 应用独立运行：生产应用复制带 SHA256 的固定版本 bundle，不在运行时连接本仓库。
- 无业务规则：关键词、日期窗口、去重、数据库、飞书和调度不属于本库。

## 环境

- Node.js 22 或更高版本。
- HTTP、API 和静态 HTML 能力无第三方运行依赖。
- 浏览器能力由调用应用安装 `playwright`，并传入自己的会话配置。

```powershell
git clone https://github.com/marioypolo-ui/web-extraction-capabilities.git
cd web-extraction-capabilities
npm ci
npm test
```

## CLI

所有 CLI 正常输出均为 JSON，适合其他程序调用。

```powershell
node bin/web-extract.mjs catalog
node bin/web-extract.mjs validate --capability static-html-list
node bin/web-extract.mjs detect --url "https://example.test/notices" --html-file fixtures/static-list.html
node bin/web-extract.mjs extract --capability static-html-list --url "https://example.test/notices/" --html-file fixtures/static-list.html
node bin/web-extract.mjs bundle --output dist/bundle
node bin/web-extract.mjs contribution:pack --source examples/capability-contribution --output dist/contribution
```

这些命令由 `npm run docs:smoke` 自动执行。完整参数见[集成指南](docs/integration.md)。

## Node API

```js
import { detectCapabilities, extract } from '@marioypolo/web-extraction-capabilities';

const detected = await detectCapabilities({ url, html });
const result = await extract({
  capabilityId: detected.recommendations[0]?.capabilityId,
  url,
  html
});
```

统一结果：

```json
{
  "records": [
    {
      "title": "Example notice",
      "url": "https://example.test/notices/1",
      "publishedAt": "2026-07-20",
      "summary": "",
      "raw": {}
    }
  ],
  "diagnostics": [],
  "capabilityId": "static-html-list",
  "capabilityVersion": "0.1.0"
}
```

## 当前能力

`catalog` 提供机器可读清单。v0.1.0 包括静态 HTML、JSON API、SPA API、复杂 JS 浏览器、点击流程、登录会话、人工验证检测、固定 DNS/Host、域名迁移、动作链接解析，以及从真实生产场景迁移的平台家族适配器。

浏览器类能力状态为 `conditional`：安装 Playwright 后可执行；未安装时返回 `CAPABILITY_DEPENDENCY_MISSING`。验证码类能力状态为 `human-required`。

## 独立应用使用

```powershell
node bin/web-extract.mjs bundle --output dist/bundle
node examples/standalone-consumer/run.mjs --bundle dist/bundle --html-file fixtures/static-list.html
```

应用提交 bundle 中的 `src/`、`capabilities/`、`schemas/`、`package.json` 和 `bundle-manifest.json`，记录版本和总 SHA256。升级前在临时目录验证，影子比较新旧结果，成功后原子切换；失败则继续使用旧目录。详见[升级与回滚](docs/upgrades.md)。

## 贡献新能力

复制 `examples/capability-contribution`，提供能力清单、实现、脱敏 fixture 和测试，然后执行：

```powershell
node bin/web-extract.mjs contribution:pack --source examples/capability-contribution --output dist/contribution
```

中央 CI 自动检查 schema、测试、文档命令、敏感信息和 bundle 可复现性。自动合并仅对可信作者和受限路径开放；核心运行时、CI、依赖、权限和许可证始终需要人工审核。详见[贡献指南](CONTRIBUTING.md)。

## 许可证

[Apache License 2.0](LICENSE)
