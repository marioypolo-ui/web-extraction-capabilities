# 应用集成

## 1. 判断能力

已有 HTML 时运行：

```powershell
node bin/web-extract.mjs detect --url "https://example.test/notices" --html-file fixtures/static-list.html
```

返回的 `recommendations` 按置信度排序。应用应保存 `diagnostics`；不能把空推荐当成“没有新信息”。

## 2. 提取

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

## 3. 固定 Host 与域名迁移

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

## 4. 版本快照

```powershell
node bin/web-extract.mjs bundle --output dist/bundle
```

应用复制整个目录并保存 `bundle-manifest.json`。运行时从应用自己的 vendor 目录导入，不引用兄弟目录，不自动拉取 main。

独立示例：

```powershell
node examples/standalone-consumer/run.mjs --bundle dist/bundle --html-file fixtures/static-list.html
```

## 5. 业务层职责

调用应用负责关键词、日期范围、去重、持久化、告警、定时运行、代理策略和凭据生命周期。中央库的 `publishedAt` 可以为空，应用不得仅因日期不可信就假设记录不存在。
