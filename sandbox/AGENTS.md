# DoomUI Sandbox 指导

本目录用于 Cocos Creator 3.8.6 的公开演示与扩展验收。运行与重新同步步骤见 [README](README.md)，同时遵循仓库根 `AGENTS.md`。

- 可提交 `ArticleDemo` 的场景、最小控制器、原始/生成 Prefab 和编辑器生成的 `.meta`，共同构成离线 Fixture；资产引用必须随仓库完整保留。
- 实际游戏代码、生产素材、密钥及私有 Figma 响应保持在业务工程中。
- `extensions/figma-sync` 必须是指向 `../../figma-sync` 的本机软链接，不提交软链接。
- `library/`、`temp/`、`profiles/`、`local/`、日志、扩展链接、调试配置与 `settings/v2/packages/figma-sync.json` 都是本机状态，不提交；旧 `figma-ui-sync.json` 也只用于迁移，不提交。
- 可提交的验收 Fixture 必须离线、最小、可重建，且不含 PAT、配对 token、真实设计 JSON 或个人数据。
- 运行态验收至少区分：扩展加载、菜单/面板、asset-db import、Prefab 预览、Figma Push Preview、Apply 后 UUID/file ID/逻辑 Prefab 哈希稳定性。
- 修改验收证据时同步更新根 `docs/acceptance.md`，不得用构建通过代替 Cocos/Figma 宿主验收。
- 修改 Fixture 后运行根目录的 `just sandbox-check`；Prefab 与 Meta 的持久化仍交给 Creator Scene Script 和 AssetDB，不手改序列化模板。
