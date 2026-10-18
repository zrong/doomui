# DoomUI 项目指导

本文件适用于整个 DoomUI 仓库。进入子项目后，还必须同时遵循该目录自己的 `AGENTS.md`。

## 项目边界

- `figma-sync/` 是 Cocos Creator 3.8.6 扩展，包名和标题固定为 **Figma Sync**，入口固定为 `扩展 → DoomUI → Figma Sync`。
- `cocos-sync/` 是 Figma Desktop 伴生插件，npm 包名和标题固定为 **Cocos Sync**。
- `sandbox/` 用于 Cocos Creator 3.8.6 的公开演示与扩展验收；公开离线 Fixture 随仓库提交，实际游戏工程保持独立。
- 设计、协议、制作规范、开发和验收文档统一放在 `docs/`；子项目 README 只保留该项目的最短入口说明。

## 固定产品决策

1. Figma Desktop Push 支持手动单选或多选 Frame / Page 直属 Component，只同步明确选择的目标；PSD、自动监听设计变更不在范围内。
2. 唯一的日常同步入口是 Figma Desktop 手动 Push；该路径使用 Figma Plugin API，不提供 PAT 或 Figma REST API 拉取功能。
3. Preview 不得修改 `assets`；Apply 必须使用当前 `planId`，并保持失败回滚。
4. 插件只持续拥有 `*.visual.prefab`、组件视觉 Prefab 和生成贴图；逻辑 `*.prefab` 只在首次同步创建，后续不得覆盖。
5. 不自动删除 orphan，不覆盖非插件拥有的同路径资源，不手写或复制 `.meta` 模板。
6. Figma Desktop Push 仅监听回环地址，接收后只产生 Preview，不自动 Apply。
7. 允许通过同一对插件把一个现有 Cocos Prefab 一次性导入 Figma，作为设计接管起点；源 Prefab 必须直接读取且保持不变，不复制到 `reference/`，完成映射后仍只允许 Figma → Cocos 单向持续同步。
8. `figma-ui-sync` 旧项目 Profile 只在首次启动时复制到 `figma-sync`，旧数据保留用于回退；稳定 file ID 哈希盐和 Figma plugin-data key 属于持久化协议，不随产品改名。

## 开发接口

- 根级命令以 `justfile` 为统一入口；先运行 `just --list`，提交前运行 `just check`。
- 两个插件保留各自的 npm 命令，根命令只是稳定编排层，不应复制实现逻辑。
- Cocos 宿主版本固定为 3.8.6，扩展声明范围保持 `>=3.8.6 <3.9.0`。
- 修改本机 Push 请求/响应时，同时更新两端类型、自动测试和 `docs/local-push-protocol.md`。
- 修改 Figma→Cocos 映射时，同时更新测试、`docs/figma-authoring-guide.md` 和详细设计文档。

## 版本与 Git

- 版本格式固定为 `YY.WW.MICRO`，MICRO 全局递增且跨年不重置。
- 版本号必须由已安装的 [git-commit skill](https://github.com/zrong/skills/tree/main/git-commit) 内 `scripts/calver.py` 生成，禁止心算、复制旧版本或在仓库内维护另一份生成器。
- `VERSION`、两个插件的 `package.json`、两个 `package-lock.json` 根包版本和发布 Tag 必须一致；用 `just version-check` 和 `just release-check` 验证。Sandbox 的 `package.json.version` 是 Cocos Creator 工程版本，固定为 `3.8.6`，不参与 DoomUI CalVer。
- Commit 使用简体中文 Conventional Commits，并包含 `Agent-Task`、`Agent-Model`、`Agent-Decision`、`Agent-Limitation` 尾注。
- 按可独立构建和测试的逻辑边界做原子提交。没有用户明确授权时不得 push。

## 安全与仓库卫生

- `cocos-sync/manifest.json` 与其中的 Figma plugin ID 是跨电脑读取私有 plugin-data 的持久化身份，必须提交并保持稳定；配对码、会话 token 与本机导入状态禁止提交。
- Cocos `library/`、`temp/`、`profiles/`、`local/`、扩展软链接、真实设计生成资产和真实 Frame 映射均禁止提交。
- Figma 配对码和会话令牌是短期本机会话信息；不得记录到报告或日志。
- 仓库外文件和临时目录不属于默认修改范围；操作前取得用户明确授权。

## 完成标准

- 代码变更必须有与风险相称的自动测试，并运行 `just check`。
- 涉及 Cocos/Figma 宿主行为的变更不能只以 TypeScript 构建成功宣称完成；应在 `sandbox` 做运行态验收，或明确记录尚未完成的外部验收。
- 更新验收结论时要区分自动化、Cocos 运行态、Figma 运行态和真实设计端到端证据。
