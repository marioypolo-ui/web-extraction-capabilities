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
node dist/bundle/bin/web-extract.mjs bundle:validate --bundle dist/bundle --expected-version 0.1.3
```

应用复制整个目录并保存 `bundle-manifest.json`。每个版本使用独立且不可变的目录；运行时从应用自己的 vendor 目录导入，不引用兄弟目录，不自动拉取 main。

```js
import { createBundleRuntime } from './web-extraction-capabilities/src/index.mjs';

const candidate = await createBundleRuntime({
  bundleDir: 'vendor/web-extraction-capabilities/0.1.3',
  expectedVersion: '0.1.3'
});
```

当前版本和候选版本可以同时加载，由应用负责影子比较、回退和晋升。`bundle:validate` 用于已发布 Bundle，`validate` 用于源码检出；中央校验不替应用作切换决策。候选版本创建失败不得破坏已加载的当前运行时。

从可信 Release 下载归档时，先使用归档外、来自可信 Release 渠道的 SHA256 校验整个归档；完成前不得执行归档内任何代码，包括 Bundle 自带 CLI。解压后再运行 `bundle:validate`。该命令是完整性检查而非来源认证：它要求除根 `bundle-manifest.json` 外的实际文件集合与 manifest 完全一致，实际目录与 manifest 路径推导目录完全一致，拒绝额外文件、空目录和符号链接，并核对文件 hash、总 hash 及 `package.json` 名称/版本。

`createBundleRuntime({ validate: false })` 只适用于已经可信且不可变的本地 Bundle。它只跳过实际树和文件内容 hash 校验，不跳过 manifest 解析、Bundle 格式与结构、hash 字段形状、能力摘要、`expectedVersion` 或模块版本一致性校验。

独立示例：

```powershell
node examples/standalone-consumer/run.mjs --bundle dist/bundle --html-file fixtures/static-list.html
```

Bundle 的 `bundle-manifest.json` 包含 `bundleFormatVersion`、`catalogSha256` 和能力摘要。应用只处理自己明确支持的格式版本；遇到更高格式版本时保留当前 Bundle 并通知维护。更新 Bundle 后必须比较新旧能力目录，并为自己保存的全部网站重新执行 URL 匹配；新增或变化的路由先影子验证，再进入生产。

## 6. 国内政务网站直连

中国政府、政府部门和行政事业单位网站即使存在 `HTTP_PROXY`、`HTTPS_PROXY`、`ALL_PROXY` 或系统全局代理，也必须直连。应用网络层必须使用显式 direct dispatcher，或为所有已配置目标主机提供完整 `NO_PROXY` 覆盖；不得在直连失败时静默代理兜底，必须生成应用可见的抓取诊断。

中央库只规定契约，不负责政府站点分类，也不修改 fetch 行为。若应用替换进程级全局 dispatcher，中央库无法保证路由选择；应用必须自行执行直连和逐主机验证。

## 7. 业务层职责

调用应用负责关键词、日期范围、去重、持久化、告警、定时运行、代理策略和凭据生命周期。中央库的 `publishedAt` 可以为空，应用不得仅因日期不可信就假设记录不存在。
