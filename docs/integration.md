# 应用集成

## 1. 先查已验证网站

```powershell
node bin/web-extract.mjs catalog --url "https://www.gxufe.edu.cn/www/myweb/level.html"
```

返回项包含能力 ID、能力版本、范围、状态、网站参考和 `reusable`。`fixture-tested`、`live-tested` 为可复用候选；`reported` 只提示已知现象，不得自动控制路由。即使 `reusable: true`，应用仍要运行自己的影子验证，因为网站可能在 `verifiedAt` 之后变化。

Node 应用也可调用 `findCapabilitiesForUrl(url)`。生产路由推荐顺序：

1. 使用 URL 匹配到的第一个可复用能力。
2. 没有匹配时调用 `detectCapabilities` 分析页面结构。
3. 两者都没有结果时返回明确诊断，不把它解释为没有新信息。

`extract({ capabilityId: 'auto', url, ... })` 已实现上述前两步。

## 2. 判断页面结构

已有 HTML 时运行：

```powershell
node bin/web-extract.mjs detect --url "https://example.test/notices" --html-file fixtures/static-list.html
```

返回的 `recommendations` 按置信度排序。应用应保存 `diagnostics`；不能把空推荐当成“没有新信息”。

## 3. 提取

```powershell
node bin/web-extract.mjs extract --capability static-html-list --url "https://example.test/notices/" --html-file fixtures/static-list.html
```

JSON API 配置示例：

```json
{
  "itemsPath": "data.items",
  "fields": {
    "title": "name",
    "url": "link",
    "publishedAt": "date",
    "summary": "description"
  }
}
```

将配置保存为应用自己的文件，再通过 `--config path/to/config.json` 传入。配置和凭据不提交中央库。

## 4. 固定 Host 与域名迁移

Node API 支持：

```js
await extract({
  capabilityId: 'fixed-dns-host',
  url,
  config: { resolveIp: '203.0.113.10' }
});

await extract({
  capabilityId: 'domain-migration',
  url,
  config: { rewriteMap: { 'old.example.test': 'new.example.test' } }
});
```

映射必须由应用明确配置；库不进行开放代理或未经验证的域名猜测。

## 5. 版本快照

```powershell
node bin/web-extract.mjs bundle --output dist/bundle
```

应用复制整个目录并保存 `bundle-manifest.json`。运行时从应用自己的 vendor 目录导入，不引用兄弟目录，不自动拉取 main。

独立示例：

```powershell
node examples/standalone-consumer/run.mjs --bundle dist/bundle --html-file fixtures/static-list.html
```

Bundle 的 `bundle-manifest.json` 包含 `bundleFormatVersion`、`catalogSha256` 和能力摘要。应用只处理自己明确支持的格式版本；遇到更高格式版本时保留当前 Bundle 并通知维护。更新 Bundle 后必须比较新旧能力目录，并为自己保存的全部网站重新执行 URL 匹配；新增或变化的路由先影子验证，再进入生产。

## 6. 业务层职责

调用应用负责关键词、日期范围、去重、持久化、告警、定时运行、代理策略和凭据生命周期。中央库的 `publishedAt` 可以为空，应用不得仅因日期不可信就假设记录不存在。
