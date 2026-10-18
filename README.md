# DoomUI

DoomUI 是一套连接 Figma 与 Cocos Creator 的开源 UI 工具链。设计师在 Figma 中调整界面，手动推送所选设计；程序员在 Cocos 中预览变更，确认后生成或更新 Prefab，让设计迭代进入游戏工程。

兼容范围：Cocos Creator `>=3.8.6 <3.9.0`。当前已在 macOS + Figma Desktop + Creator 3.8.6 完成运行态验证，范围内其他补丁版本尚未逐一验收。

[DoomUI 官方网站](https://zengrong.net/project/doomui/) · [GitHub 源码](https://github.com/zrong/doomui)

## 子项目

| 目录 | 产品标题 | 作用 |
|---|---|---|
| `figma-sync/` | Figma Sync | Cocos Creator 扩展；提供 Preview、Apply、Prefab/贴图写入和 Cocos Sync 本机服务 |
| `cocos-sync/` | Cocos Sync | Figma Desktop 开发插件；导入 Cocos View / Item 与共享素材，或手动把明确选择的 Frame / Component 推送到 Cocos |
| `sandbox/` | DoomUI Sandbox | Cocos Creator 3.8.6 可运行演示与扩展验收工程 |

## 快速开始

前置要求：macOS、Node.js 18+、Cocos Creator `>=3.8.6 <3.9.0`、Figma Desktop。推荐安装 [`just`](https://just.systems/) 作为根级命令入口。仓库中的 Sandbox 使用 Creator 3.8.6 保存。

```bash
just install
just check
just sandbox-link
```

随后：

1. 用 Cocos Creator 3.8.6 打开 `sandbox/`。
   - 直接运行 `assets/ArticleDemo.scene` 可体验按钮逻辑与九宫格；无需先连接 Figma。
   - 重新走同步流程见 [Sandbox 说明](sandbox/README.md)，使用独立输出 Bundle 保留公开 Fixture。
2. 从 `扩展 → DoomUI → Figma Sync` 打开 Cocos 插件。
3. 按 [开发指南](docs/development.md) 配置并导入 Figma 插件。
4. 在 Figma Desktop 手动单选或多选需要同步的 Frame / Page 直属 Component，运行 `Cocos Sync`，配对后推送所选内容。
5. 回到 Cocos 检查 Preview；只有在无阻断项时执行 Apply。

完整命令用 `just --list` 查看。直接进入子目录运行 `npm` 也受支持。

若本机曾从旧的 `cocos-ui-push/manifest.json` 导入开发插件，目录迁移后需在 Figma Desktop 重新导入仓库提交的 `cocos-sync/manifest.json`；其中的稳定 ID 不得重建。

Cocos 扩展的内部包名也已统一为 `figma-sync`。首次加载会把旧 `figma-ui-sync` 项目 Profile 中的输出设置和 Frame/接管映射复制到新 Profile；旧数据不会删除。Figma plugin ID 和持久化映射 key 保持不变。

## 文档

| 文档 | 内容 |
|---|---|
| [文档索引](docs/README.md) | 文档真值与阅读顺序 |
| [架构](docs/architecture.md) | 子项目边界、同步链路、Shared Assets Catalog 和资源所有权 |
| [Cocos Sync 本机协议](docs/local-push-protocol.md) | 配对、接口、资源上传和安全边界 |
| [Figma 制作规范](docs/figma-authoring-guide.md) | Frame、Component、Variant、Button 和九宫格规则 |
| [开发指南](docs/development.md) | 安装、构建、导入、调试和验收 |
| [版本与发布](docs/versioning.md) | `YY.WW.MICRO`、版本文件和 Git Tag 同步规则 |
| [详细设计](docs/figma-to-cocos-prefab-tool-design.md) | 映射、diff、事务和第一版边界 |
| [验收记录](docs/acceptance.md) | 自动化与 Cocos/Figma 运行态证据 |
| [Community 发布](docs/community/publishing.md) | 插件介绍、图标、封面、数据披露与发布流程 |

## 当前边界

- Desktop Push 只处理用户明确单选或多选的 Frame / Page 直属 Component；不处理 PSD，也不自动监听设计修改。
- Figma Desktop Push 是唯一的日常同步链路，使用 Figma Plugin API；仓库不提供 PAT 或 Figma REST API 拉取功能。
- 现有 Cocos View / Item Prefab 只允许一次性导入 Figma 以建立 Frame / Component 节点映射；源文件不复制、不修改，后续仍为 Figma → Cocos 单向同步。Item 在确认导入后由项目方显式删除旧双 Prefab，再由首次 Apply 重建标准产物。
- 没有 Prefab 的共享 Bundle 图片可由 Cocos 资源管理器单选或多选后导入当前 Figma 文件的唯一 Catalog；Catalog 首次在当前 Page 创建，但不要求独立 Page，后续按私有标记跨 Page 复用。
- 逻辑 Prefab 只在首次同步创建；后续只更新插件拥有的视觉 Prefab 和依赖资源。

## 版本

当前版本记录在 [`VERSION`](VERSION)，两个插件的 `package.json` 与发布 Tag 必须保持一致。Sandbox 的 `package.json.version` 由 Cocos 固定为 `3.8.6`，不参与发布版本。公开初始快照保留产品版本，但不携带旧历史或发布 Tag；初始化提交不代表新版本发布。后续版本由维护者通过 [git-commit skill](https://github.com/zrong/skills/tree/main/git-commit) 的 `calver.py` 生成；详见[版本与发布](docs/versioning.md)。

## 许可证

项目源码采用 [MIT 许可证](LICENSE)，版权人 zrong。依赖的软件包和宿主工具使用各自的许可证，见[第三方依赖说明](docs/third-party.md)。
