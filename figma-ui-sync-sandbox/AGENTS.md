# Figma Sync Sandbox 指导

本目录只用于 Cocos Creator 3.8.6 验收。除本文件外，同时遵循仓库根 `AGENTS.md`。

- 不放入真实游戏代码、业务脚本、生产字体、密钥或不可公开的 Figma 响应。
- `extensions/figma-sync` 必须是指向 `../../figma-sync` 的本机软链接，不提交软链接。
- `library/`、`temp/`、`profiles/`、`local/`、日志、真实设计生成资产和 `settings/v2/packages/figma-sync.json` 都是本机状态，不提交；旧 `figma-ui-sync.json` 也只用于迁移，不提交。
- 可提交的验收 Fixture 必须离线、最小、可重建，且不含 PAT、配对 token、真实设计 JSON 或个人数据。
- 运行态验收至少区分：扩展加载、菜单/面板、asset-db import、Prefab 预览、Figma Push Preview、Apply 后 UUID/file ID/逻辑 Prefab 哈希稳定性。
- 修改验收证据时同步更新根 `docs/acceptance.md`，不得用构建通过代替 Cocos/Figma 宿主验收。
