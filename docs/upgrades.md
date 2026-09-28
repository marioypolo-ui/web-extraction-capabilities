# 应用升级与回滚

新贡献契约的接入字段、回执和应用责任见[消费方交接清单](consumer-contribution-handoff.md)。
候选版本来源校验后，通过可选 `runtime.contributionProtocol` 或 `contribution:protocol` 检查协议声明及 schema 路径；
旧 Bundle 没有声明时保持旧流程，不猜测新接口。当前源码实现尚未发布，不能据此认定已有可升级 Release。

中央库通过 GitHub Releases 提供稳定版本、bundle 和 SHA256，但不会强制应用自动更新，也不会在应用中自行创建计划任务。

## v0.2.0 升级

v0.2.0 新增 `detail` 命令与 `extractDetail()` API，返回详情页的 `document`、诊断和版本信息；旧的列表 `extract()` 及 `records` 契约保持不变，Bundle 格式仍为 `1`。详情的全文、表格、图片与附件链接契约见[详情提取](detail-extraction.md)。

同一版本提供 `feedback:validate`、`feedback:reproduce`，可继续在应用本地诊断。当前源码已迁移旧公开报错入口，应用先解决并验证能力缺口，再贡献可复用成果；详见[诊断与历史迁移](problem-feedback.md)。不能把当前源码的新贡献接口当作已发布 v0.2.0 的接口。中央接受或发布贡献不会替应用下载、接受或部署 Bundle。

先用可信 Release 渠道在归档外提供的 SHA256 校验下载内容，再执行归档中的代码。候选版本应放入独立且不可变的 `vendor/web-extraction-capabilities/0.2.0` 目录，随后明确校验版本：

```powershell
node vendor/web-extraction-capabilities/0.2.0/bin/web-extract.mjs bundle:validate --bundle vendor/web-extraction-capabilities/0.2.0 --expected-version 0.2.0
```

```js
import { createBundleRuntime } from './web-extraction-capabilities/src/index.mjs';

const candidate = await createBundleRuntime({
  bundleDir: 'vendor/web-extraction-capabilities/0.2.0',
  expectedVersion: '0.2.0'
});
if (typeof candidate.extractDetail === 'function') {
  const detail = await candidate.extractDetail({ url, html });
  // Compare the document and diagnostics with the application's expected result.
}
```

`extractDetail` 是 Bundle 运行时的可选 API：新版加载器仍可加载没有此接口的旧 Bundle，应用必须先检测，再明确决定是否使用详情流程。中央库不会替应用接受候选版本，也不会修改应用的失败回退策略。

升级时继续执行现有列表影子验证；新增详情流程应使用相同的页面快照或经授权取得的内容，核对标题、正文末尾、表格合并关系、资源地址和诊断。新能力没有新增的真实网站详情验证记录，合成测试不代表应用目标站点已验证。影子验证、接受标准、晋升与回滚仍由调用应用负责；发现未解释的正文缺失或诊断时保留当前版本。

接收贡献或历史 issue 关联的新版本时，应用应保存原问题 key 和贡献标识，在自己的候选 Bundle 上复跑同一脱敏样本，并完成真实环境所需的授权验证。中央库关闭 issue、打包或测试通过不等于应用已采用或原生产故障已经修复；应用的通知与版本切换继续遵守已确认策略。

## v0.1.3 升级

v0.1.3 保持 Bundle 格式 `1` 和现有提取结果结构兼容，修正静态 HTML 动作链接诊断，并加强独立 Bundle 校验。每个版本必须放在独立且不可变的目录中；当前版本和候选版本可由应用同时加载比较：

```js
import { createBundleRuntime } from './web-extraction-capabilities/src/index.mjs';

const candidate = await createBundleRuntime({
  bundleDir: 'vendor/web-extraction-capabilities/0.1.3',
  expectedVersion: '0.1.3'
});
```

从可信 Release 下载后，先使用归档外、来自可信 Release 渠道的 SHA256 校验整个归档；完成前不得执行归档内任何代码，包括候选 Bundle 自带 CLI。通过后再解压，并运行 `bundle:validate --bundle <candidate-dir> --expected-version 0.1.3`；源码检出使用 `validate`。Bundle 自校验只证明 manifest、实际树、文件 hash 和 package 身份内部一致，不能替代 Release 归档来源校验。中央校验不决定应用回退或晋升。候选创建失败时保留已加载的当前运行时，不删除或覆盖当前目录。

`createBundleRuntime({ validate: false })` 只适用于已经可信且不可变的本地 Bundle。它只跳过实际树和文件内容 hash，不跳过 manifest 格式与结构、hash 字段形状、能力摘要、`expectedVersion` 或模块版本一致性校验。

中国政府、政府部门和行政事业单位目标必须在应用网络层强制直连，即使配置了 `HTTP_PROXY`、`HTTPS_PROXY`、`ALL_PROXY` 或系统全局代理。应用必须使用显式 direct dispatcher 或完整 `NO_PROXY`，不得静默代理兜底；直连失败必须生成应用可见诊断。中央库只规定契约，不负责站点分类或修改 fetch；应用替换进程级全局 dispatcher 时，路由保证仍由应用负责。

## 接入时确认更新方式

新应用接入中央库时，开发者或执行 Agent 必须告知用户可以检查新版本，并询问用户选择：

1. **自动检查**：应用按用户确认的周期检查稳定 GitHub Releases。
2. **手动检查**：应用提供检查入口，但不创建定时任务。
3. **暂不检查**：应用固定当前版本，不主动访问 GitHub。

“自动检查”只表示自动发现和验证候选版本，不等于自动切换生产版本。是否在验证通过后自动切换，必须由用户单独确认。用户没有作出选择前，应用保持当前固定版本，不创建计划任务、不下载候选版本，也不自动切换。

## 可选的自动检查流程

只有用户选择自动检查后，应用才实施以下流程：

1. 按确认的周期读取稳定 GitHub Releases，不跟踪 `main` 或预发布版本。
2. 发现更高版本时，下载固定 tag 的 bundle 和 SHA256 到候选目录，不覆盖当前版本。

   先检查是否存在新 Release，再收集候选验收所需样本；没有候选时不强制应用重复采样或生产扫描。网站暂不可达时标记环境受阻，保留当前版本；不能自动判作版本回归，也不能算验收通过。取得同一可信输入后再作记录级新旧比较。
3. 在执行候选归档内任何代码前，使用应用自身或系统可信工具核对 Release 归档 SHA256；不一致时隔离候选并停止。
4. 解压后运行候选 Bundle 自带 `bundle:validate`，验证实际文件/目录精确集合、无链接、package 身份、每个文件校验值和总 `bundleSha256`。
5. 检查 `bundleFormatVersion`；应用只处理自己明确支持的格式。遇到更高格式版本时保留当前版本并通知维护，不猜测兼容。
6. 比较 `catalogSha256`；如有变化，列出新增/更新能力及新增网站参考。
7. 用候选版本为应用保存的全部网站重新执行 `catalog --url`，找出新增或变化的能力路由。
8. 对每个已配置的中国政府、政府部门和行政事业单位主机验证代理绕过，确认直连失败会显性诊断且不会代理兜底。
9. 运行中央库验证和应用自己的全部测试。
10. 使用相同输入做新旧版本影子解析，比较记录标题、URL、数量和 diagnostics。
11. 新版本少取记录、增加静默空结果或出现未解释诊断时拒绝升级并通知用户。
12. 只有用户已授权自动切换时才原子切换；否则报告验证结果，等待用户确认。
13. 保留上一版本目录和版本清单，以便立即回滚。

回滚只需把应用导入路径或目录指针切回上一份已验证 bundle。升级检查失败不得删除旧版本，也不得阻塞应用原有业务任务。

应用应记录：支持的 `bundleFormatVersion`、当前版本、候选版本、SHA256、`catalogSha256`、能力目录差异、网站路由差异、测试结果、影子差异、切换时间和回滚结果。

定时任务、GitHub 访问、通知和生产切换均由各应用自行实现。中央库只提供稳定发布资产和本升级协议。

尚未实现本协议的旧应用需要一次性改造；中央库不能主动修改它们。完成该改造后，后续普通能力和网站参考更新都通过 Release、`catalogSha256`、重新匹配和影子验证自动进入候选流程，只有 Bundle 格式升级或应用测试失败才需要维护介入。
