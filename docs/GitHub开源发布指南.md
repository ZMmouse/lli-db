# GitHub 开源发布指南

本项目的公开主仓库为 `https://github.com/ZMmouse/lli-db`。公开仓库使用经过验证的当前源码建立全新 Git 历史，不复制 Gitee 私有仓库的 `.git`、旧分支、tag 或历史对象。

## 快照边界

公开快照包含源码、测试、示例、种子数据、许可证、包元数据和面向使用者的文档，并明确排除：

- `.git`、`.qoder`、`.idea` 等版本历史或本地工具状态；
- `node_modules`、`dist`、`coverage`、`artifacts` 和临时目录；
- SQLite 数据库及 journal、shm、wal sidecar；
- 仅用于私有仓库处置的安全扫描报告、历史重写手册和内部审计计划。

测试、示例和种子数据中的邮箱统一使用 `example.com` 保留示例域。公开快照必须携带 `security-scan-allowlist.json`，但不能依靠白名单放行远程连接凭据、真实身份或数据库文件。

## 建立公开历史

1. 从当前安全工作树按上述边界复制文件到仓库外的新目录。
2. 在新目录执行当前内容安全扫描、类型检查、lint、175 项 SQLite 测试和构建。
3. 确认 GitHub 远程仓库为空。
4. 在新目录执行 `git init -b main`，只创建一个新的初始提交。
5. 检查 `git log --all` 只有公开历史，`git remote -v` 只包含 GitHub。
6. 推送 `main`，不得使用 `--mirror`、`--all` 或从 Gitee fetch 旧 refs。

## 后续维护

GitHub 作为公开主仓库和 npm package 元数据指向的源码地址。Gitee 可以继续保留为私有历史存档，但旧数据库凭据仍必须轮换；私有属性不能替代凭据失效。若未来需要同步代码，应使用审核后的补丁或当前文件快照，不能把 Gitee 旧历史合并进 GitHub `main`。

仓库已提供 `.github/workflows/ci.yml`，在 main 推送和 pull request 上运行 security、quality、SQLite、package smoke 与 SBOM 检查；`.github/workflows/publish.yml` 仅响应 `v*` tag，通过受保护的 `npm` Environment 和 OIDC trusted publishing 发布。首次推送后仍需启用分支与 tag 保护，并在 npm 包设置中登记 `publish.yml`。PostgreSQL 契约继续按当前范围暂缓。
