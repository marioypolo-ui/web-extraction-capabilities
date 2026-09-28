# 真实隔离验收入口（待运行）

`npm run test:contribution-isolation` 是独立的环境验收命令，不会因普通单元测试通过而自动算通过。
缺少固定输入、Docker 或 Linux 镜像时返回 `blocked` 并以非零退出；没有 skip 或宿主执行回退。

```text
npm run test:contribution-isolation -- --image <pinned-local-linux-image-id> --baseline <trusted-v0.2.0-bundle-directory> --baseline-sha256 <trusted-bundle-hash> --baseline-manifest-sha256 <trusted-manifest-file-hash>
```

只在维护方信任的中央源码中运行。基线归档必须先由归档外的可信校验值验证，
两个基线哈希也由维护方确认；不能取提交者自报的成功回执代替。
容器镜像必须预先取得并核实，实际贡献执行过程中不拉取镜像或安装依赖。

验收脚本使用仓库自己编写的合成样本，先证明容器可正常读取指定只读样本，随后检查：

- 未挂载的宿主合成标记不可读；挂载文件和根文件系统不可写，宿主文件保持原值。
- 容器使用非 root 用户。
- 宿主自己能连接临时 TCP 测试服务，而容器不能连接同一地址和端口。服务只用于当前验收，结束时关闭。
- 新能力、已有能力扩展修复、网站参考通过独立基准/候选比较和贡献测试。
- 故意失败的测试、跳过的测试、改错的样本被拒收；恢复原包后通过。
- 验证通过的同包重试去重，但接收状态仍不自动等于可复用或应用采用。

输出只有固定检查名、状态和原因码。源快照、失败样本和原始输出留在临时维护目录，
不作为公开日志或 Actions artifact 上传。这些检查只证明所测隔离边界，不声称覆盖所有容器逃逸方式。

## 可用后端的准备

本地环境目前没有 Docker/Linux 后端，用户也没有可提供的环境。
仓库已准备 `.github/workflows/contribution-isolation.yml`：仅手动触发，使用临时 Ubuntu runner，
只读仓库权限，checkout 不持久保存凭据，输入固定官方 Node 镜像摘要及 v0.2.0 基线三项校验值。
先下载并校验固定公开依赖，再运行凭据隔离的容器测试；不合并代码或发布 Release，不上传样本产物。

该工作流尚未推送、触发或验证成功。提前推送测试分支并执行远程验收需核对对应授权。
不要把工作流存在、缺环境时正确拒绝、普通 npm test 通过，当成真实隔离验收已经通过。
