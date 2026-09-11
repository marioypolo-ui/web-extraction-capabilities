# 通用详情提取

`v0.2.0` 增加 `detail` CLI 和 `extractDetail()` Node API，用于提取一个文章、公告或政策详情页。列表仍使用 `extract()`；详情返回独立的 `document` 契约，不改变旧的 `records` 结果。

## 从一个链接开始

在本仓库或已验证的 Bundle 中运行，将 URL 替换为目标详情页：

```powershell
node bin/web-extract.mjs detail --url "https://example.test/articles/1"
```

命令输出 JSON，包括标题、正文全文、日期、表格、图片地址、附件链接和诊断。WorkBuddy 或其他执行 Agent 读取本指南后即可调用公开命令，无需用户指定内部解析文件。仅有链接时，默认模式先尝试可用的静态或已支持平台路径；未知动态接口可能还需要应用提供字段映射，浏览器必须显式启用。

离线验证使用合成 fixture：

```powershell
node bin/web-extract.mjs detail --url "https://example.test/articles/1" --html-file fixtures/detail-article.html
```

此 fixture 用于验证解析行为，不代表任何真实网站已完成在线验证。新能力的 `verifiedTargets` 初始为空。

## Node API

```js
import { extractDetail } from '@marioypolo/web-extraction-capabilities';

const result = await extractDetail({ url: 'https://example.test/articles/1' });
if (!result.document) {
  console.error(result.diagnostics);
} else {
  console.log(result.document.contentText);
  console.error(result.diagnostics);
}
```

签名为 `extractDetail({ url, html?, json?, config?, browserModule? })`，返回 Promise。已有页面内容时传入 `html`，已有 API 响应时传入 `json`；不要同时提供两种输入。JSON 输入需要明确字段映射。顶层 `browserModule` 可指定应用提供的浏览器驱动模块。

## 结果契约

机器可读定义见 [detail-result.schema.json](../schemas/detail-result.schema.json)：

```json
{
  "document": {
    "title": "示例公告",
    "url": "https://example.test/articles/1",
    "publishedAt": "2026-09-11",
    "contentText": "正文第一段。\n正文第二段。",
    "tables": [
      {
        "caption": "办理时间",
        "rows": [
          [{ "text": "事项", "rowSpan": 1, "colSpan": 1, "header": true }],
          [{ "text": "登记", "rowSpan": 1, "colSpan": 1, "header": false }]
        ]
      }
    ],
    "images": [{ "url": "https://example.test/images/process.png", "alt": "办理流程" }],
    "attachments": [{ "url": "https://example.test/files/form.pdf", "title": "申请表" }]
  },
  "diagnostics": [],
  "capabilityId": "web-page-detail",
  "capabilityVersion": "0.2.0"
}
```

- `contentText` 是所选正文的完整文字，不采用列表摘要的 500 字截断。它保留可读的段落分隔，不承诺还原排版。
- `tables` 按表、行、单元格返回；合并关系保存在 `rowSpan`、`colSpan`，`header` 表示表头单元格。`rowSpan: 0` 保留 HTML 中跨至剩余行的语义。
- `images`、`attachments` 只返回地址及说明，不下载文件。相对资源地址按页面地址解析，不能安全解析的资源产生诊断。
- 输出不包含可执行 HTML；所有文字字段均应按纯文本展示，不能直接赋给 `innerHTML`。
- 无可靠日期时 `publishedAt` 为 `null`；其他缺失文字字段为空字符串，缺失集合为空数组。
- 无法取得正文时 `document` 为 `null` 并附诊断。有 `document` 也可能伴随不完整内容的警告，应用不能只检查是否非空。

## 获取模式与配置

配置保存在调用应用自己的 JSON 文件中，通过 `--config path/to/detail-config.json` 或 Node API 的 `config` 传入。

| `config.mode` | 用途 |
|---|---|
| `auto`（默认） | 尝试可用的静态 HTML、Article JSON-LD 和已支持的平台详情路径；明确 JSON 配置可用于 API 响应 |
| `static` | 解析已有或通过 HTTP 获取的 HTML，不执行页面脚本 |
| `json` | 按应用明确配置的路径和字段映射读取 JSON 详情 |
| `platform` | 使用既有的平台详情适配器；未知平台不会通过猜测私有接口解决 |
| `browser` | 使用应用提供的 Playwright 打开页面，完成配置的点击后解析渲染 HTML |

浏览器默认不启动。只有 `mode: "browser"` 或自动模式下的 `browserFallback: true` 才允许浏览器执行；后者要求未取得正文、明确出现 `DYNAMIC_RENDERING_REQUIRED`，且没有其他阻止回退的诊断。单纯正文缺失不会启动浏览器，HTTP 失败、登录、验证码或错误配置也不回退。安装浏览器依赖本身不等于启用回退。

静态正文选择依次使用显式 `contentSelector`、常见 CMS 正文容器或 `itemprop="articleBody"`、`article`、`main`/`role="main"`、带 `articleBody` 的 Article/NewsArticle/BlogPosting JSON-LD，最后尝试较长且链接密度低的通用文字容器。最后一种路径会产生 `LOW_CONFIDENCE_CONTENT`。通用结构识别可能取错范围，未知布局应配置选择器并核对结果。

标题默认从正文内 `h1`、页面 `h1`、`og:title`、页面 `title` 中选择；JSON-LD 正文使用 `headline`。日期取自明确发布日期元数据、`time`、显式 `dateSelector` 或 JSON-LD `datePublished`，不把正文中任意截止日期当成发布日期。

页面含多篇 Article JSON-LD 时，使用 `url`、`@id` 或 `mainEntityOfPage` 匹配当前页面，不按正文最长者猜测。无法唯一确定时返回 `STRUCTURED_DATA_AMBIGUOUS`，单篇明确指向其他页面时返回 `STRUCTURED_DATA_URL_MISMATCH`；已经提取到的可见正文仍保留。

平台路径复用已有的 researchApp、南宁产投和广西政府采购网详情适配逻辑；既有列表网站参考和本轮合成测试不等于对应详情 URL 已完成新的在线验证。

### 明确正文范围

```json
{
  "mode": "static",
  "contentSelector": "#article .content",
  "titleSelector": "h1.title",
  "dateSelector": "time[datetime]"
}
```

选择器支持标签名、`#id`、`.class`、`[attr]`、`[attr="value"]`、同一简单选择器内的组合，以及空格分隔的后代关系。它是有限子集，不支持逗号列表、`>`、`+`、`~`、伪类或其他属性运算符。

不支持的语法返回 `CONFIG_INVALID` 和 `document: null`。显式选择器没有匹配时返回 `SELECTOR_NO_MATCH`，该字段不回退猜测；正文选择器没有匹配时 `document` 为 `null`。

### JSON 详情

JSON 字段映射必须包含 `fields.content`。`itemPath` 是单个详情对象的点分路径，空字符串表示根对象；它与列表提取中的 `itemsPath` 不同。

```json
{
  "mode": "json",
  "itemPath": "data.article",
  "fields": {
    "title": "name",
    "url": "link",
    "publishedAt": "date",
    "content": "body"
  },
  "contentFormat": "html"
}
```

```powershell
node bin/web-extract.mjs detail --url "https://example.test/articles/1" --json-file path/to/detail-response.json --config path/to/detail-config.json
```

`contentFormat` 默认是 `text`，普通文字中的尖括号不会被当成 HTML。只有已确认正文是 HTML 时才设为 `html`，此时会从该片段提取文字、表格、图片和附件。可选的 `fields.images`、`fields.attachments` 指向资源集合；具体资源元素以 URL 字符串或结果契约中的对象表示。

如果详情页面通过已知 API 返回数据，可在上述配置中加入 `apiUrl`。该地址必须由应用明确提供；库不会自动探测未知私有 API，也不会从字段名称猜测业务语义。

### HTTP 与浏览器

`config.http` 复用现有 HTTP 配置，如 `timeoutMs`、`headers`、`method`、`body`、`resolveIp` 和 `rewriteMap`。凭据和私有配置由应用持有，不写入本仓库。

浏览器配置沿用已有的 `clicks`、`storageStatePath`、`cdpEndpoint`、`browserModule`、`headless`、`waitUntil` 和 `timeoutMs`。需要会话的浏览器任务可设 `requireAuthentication: true`，缺少应用自己的会话配置时明确失败：

```json
{
  "mode": "browser",
  "contentSelector": "#article-body",
  "clicks": [{ "selector": "button.show-full-article" }],
  "headless": true
}
```

浏览器驱动及所需浏览器由应用安装。缺驱动返回 `CAPABILITY_DEPENDENCY_MISSING`；登录会话不足返回 `AUTH_SESSION_REQUIRED`；验证码或滑块返回 `HUMAN_VERIFICATION_REQUIRED`，交给授权人员处理。

中国政府、政府部门和行政事业单位网站必须由应用网络层保障直连，包含浏览器及 API 子请求。环境代理或系统全局代理存在时也不能默默改走代理；详细约束见[集成指南](integration.md#6-国内政务网站直连)。

## Bundle 消费示例

先按[升级与回滚](upgrades.md)验证发布归档来源和 SHA256，再执行 Bundle 内代码。源码检出的离线演示：

```powershell
node bin/web-extract.mjs bundle --output dist/bundle
node dist/bundle/bin/web-extract.mjs bundle:validate --bundle dist/bundle --expected-version 0.2.0
node examples/detail-consumer/run.mjs --bundle dist/bundle --url "https://example.test/articles/1" --html-file fixtures/detail-article.html
```

示例输出完整详情 JSON；无正文或出现 error 诊断时退出码为 1。已有的 `createBundleRuntime()` 可同时加载新旧 Bundle；调用详情 API 前检查 `typeof runtime.extractDetail === 'function'`，旧 Bundle 没有此 API 时由应用选择升级或保留原有流程。

## 限制与验证

此能力不保证覆盖所有网站。静态解析不计算外部 CSS 或执行脚本。低置信度范围、破损 HTML、嵌入 iframe、动作下载链接、分页提示和无法读取的内容都有对应诊断，见[诊断码](diagnostics.md)。

库不自动抓取文章下一页、iframe 内文或附件正文，不做 PDF、Word 或图片 OCR，也不推导预算、联系人等业务字段。应用需要更深处理时，保留原 URL 和诊断后选择相应流程。

本能力的可重复证据是合成 fixture 与自动测试；测试文件见 `tests/detail-html.test.mjs` 和 `tests/detail.test.mjs`。实际网站接入仍需核对标题、正文末尾、表格合并关系、资源地址和诊断。只有完成相应网站验证，才能新增 `fixture-tested` 或 `live-tested` 的网站参考。

## 正文、表格或资源提取有误时

保留目标 URL、库与能力版本、最小脱敏 HTML/JSON、实际诊断，以及样本中应提取到的文字、表格内容或资源地址，按[问题反馈流程](problem-feedback.md)提交。`operation` 使用 `detail`，`symptom` 指明 `missing-body`、`missing-table`、`missing-image`、`missing-attachment`、`missing-title`、`missing-link` 或 `wrong-date`，一个报告聚焦一个目标与症状。

```powershell
node bin/web-extract.mjs feedback:validate --report examples/problem-feedback/detail.json
node bin/web-extract.mjs feedback:reproduce --report examples/problem-feedback/detail.json
```

先本地脱敏和校验，再按稳定问题 key 补充原 issue 或创建新单。渲染后的 HTML 用 `sample.stage: "rendered"` 记录来源；它只复现保存下来的解析输入，不证明浏览器、登录、点击或网络已验证。修复发布后，应用仍需按自己的升级与生产验收策略采用版本。
