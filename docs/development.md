# 开发指南

## 环境要求

- macOS
- Node.js 18+
- npm（使用各子项目已提交的 `package-lock.json`）
- Cocos Creator 3.8.6
- Figma Desktop
- 推荐：`just`，可通过 `brew install just` 安装

第一版只对以上宿主组合负责。Figma 网页版和 Cocos 3.8.x 其他小版本没有完成运行态验收。

## 根级命令接口

仓库根的 `justfile` 是稳定开发入口：

```bash
just --list                # 查看完整命令
just install               # 安装两个插件的锁定依赖
just build                 # 构建两个插件
just test                  # 运行 Cocos 核心测试
just check                 # 版本、类型、构建和测试总检查
just cocos-watch           # 监听 Cocos 扩展
just figma-watch           # 监听 Figma 插件
just sandbox-link          # 安全创建验收工程扩展软链接
just sandbox-check         # 检查公开示例的 Meta、脚本与资源引用
```

根命令只负责编排，实际构建仍由子项目 npm scripts 负责。遇到问题时可以进入子项目运行同名 npm 命令定位。

## 首次安装

```bash
cd /path/to/doomui
just install
just check
just sandbox-link
```

`sandbox-link` 只在目标不存在时创建：

```text
sandbox/extensions/figma-sync -> ../../figma-sync
```

如果已有同名非软链接路径，命令会停止，不会覆盖。

## Git 提交边界

`doomui/` 是唯一的 Git 仓库根，不需要在三个子项目中分别创建仓库。应提交：

- `figma-sync/` 的 Cocos 扩展源码、测试、面板模板和包锁文件；
- `cocos-sync/` 的 Figma 插件源码、带团队统一 plugin ID 的 `manifest.json` 和包锁文件；
- `sandbox/` 的工程配置、公开 ArticleDemo 场景、控制器、双 Prefab 和对应 `.meta`，用于复现 Cocos Creator 3.8.6 演示与验收环境；
- 根级文档、脚本、`justfile`、`VERSION` 和指导文件。

以下内容只属于本机运行态，不得提交：

- Figma Desktop 的本机插件 Import 状态；
- Sandbox 的 `library/`、`temp/`、`profiles/`、`local/`、`logs/`、`build/`；
- Sandbox 中指向扩展源码的软链接；
- 真实 Frame 生成资产、映射清单、配对码和会话 token。

完整忽略规则以仓库根 `.gitignore` 为准。Sandbox 提交的是公开离线 Fixture；重新同步使用独立的 `roundtrip` Bundle，并忽略其输出及本机映射。已有 `article_ui` Fixture 不携带私有 Figma 映射，首次 Apply 不得覆盖它。直接运行与重新同步的步骤见 [Sandbox 说明](../sandbox/README.md)。

## 启动 Cocos 插件

1. 用 Cocos Creator 3.8.6 打开 `sandbox/`。
2. 等待 asset-db ready 和扩展加载完成。
3. 打开 `扩展 → DoomUI → Figma Sync`。
4. 展开“Desktop 连接”，确认本机服务已启动并记录当前八位配对码。

修改 Cocos 源码后运行：

```bash
just cocos-build
```

然后在 Creator 中重新加载扩展。涉及主进程加载、菜单贡献或本机服务启动的变更，优先完整退出并重启 Creator，避免旧进程仍持有扩展代码或端口。

## 配置 Figma Desktop 插件

### 推荐：Import plugin from manifest

使用 Figma Desktop 的 `Plugins → Development → Import plugin from manifest…` 是本仓库最合适的方式。开发阶段不需要把插件发布到 Figma Community；仓库已经提供完整插件源码和固定 manifest，也不需要每次通过 New plugin 生成新工程。

第一版只验收 Figma Desktop。网页版能否加载本机开发插件不作为支持范围，也不能作为连接 `localhost` Push 服务的验收依据。

Figma 要求开发插件使用由 Figma 分配的数字 ID。首次配置：

1. 回到 DoomUI 根目录执行：

```bash
just figma-check
```

2. 在 Figma Desktop 选择 `Import plugin from manifest…`，打开：

```text
/path/to/doomui/cocos-sync/manifest.json
```

3. 以后从 `Plugins → Development → Cocos Sync` 运行。

`manifest.json` 与其中的 Figma plugin ID 是仓库提交的持久化兼容身份。不同电脑必须导入这个文件，不能通过 `New plugin…` 创建另一个 ID。Figma Desktop 的 Import 状态、配对码和 session token 仍只保存在本机。

从旧目录 `cocos-ui-push/` 迁移后，Figma Desktop 仍可能保留旧绝对路径和旧标题。重新导入仓库中的 `cocos-sync/manifest.json` 即可切换到 `Cocos Sync`；不得创建新的开发插件 ID。

## Push 调试流程

1. Cocos 面板展开“Desktop 连接”，确认本机服务已启动。
2. Figma 运行 `Cocos Sync`，输入 Cocos 当前配对码。
3. Figma 画布中选择一个或多个需要同步的 Frame / Page 直属 Component。
4. 点击“推送所选内容到 Cocos”。
5. Cocos 面板应自动出现 Preview；同步过程不要求或读取外部 API 凭据。
6. 检查 warning 和 blocker；无 blocker 且确有变更时才点击 Apply。

## 一次性接管现有 Cocos Prefab

该流程用于把既有 UI 或 Item 的视觉结构放到 Figma 作为后续设计起点，不是双向同步：

1. 在 Cocos 中打开任意现有工程 Prefab，再进入“创建 Figma 起点”；面板从当前 Prefab 编辑上下文取得 UUID，并通过 AssetDB 解析为完整 `db://` URL，不依赖资源管理器右侧是否同步选中。未处于 Prefab 编辑模式时，资源管理器单选作为后备，也可以手动填写任意 `db://assets/**/*.prefab`。面板不限制源 Prefab 所在目录；准备前需显式选择导入为 UI Frame 或 Item Component。空选择、多选、无效资源和非 Prefab 不会覆盖输入框。
2. 点击“准备导入”。此时只读取源 Prefab 并建立 30 分钟内存会话；资产目录中不应新增 `reference/*.source.prefab` 或任何 `.meta`。
3. 在已配对的 `Cocos Sync` 中切到“创建 Figma 起点”，确认会话摘要，选择目标 Page，点击“从 Cocos 导入”。
4. View 应新建并选中 `UI_Name` Frame；Item 应新建并选中 Page 直属 `item_Name` Component。Cocos 项目 Profile 保存 kind、source file ID ↔ Figma node ID 与图片身份映射。
5. 在 Figma 按制作规范整理设计根。保留的导入节点会在后续 Push 中复用原 file ID；新增节点使用 DoomUI 生成的稳定 ID。
6. View 选择原 Frame 推送；Item 选择原 Component 推送。需要一起更新时可显式多选，未选择的 Frame / Component 不进入计划。
7. Item 必须先备份或迁移旧逻辑 Prefab 中程序员维护的脚本、事件和组件，确认 Figma Component 正确后，再在第一次 Preview / Apply 前人工删除旧 `prefabs/item/<Item>.prefab` 与对应旧视觉 Prefab；否则 Preview / Apply 会按所有权或 wrapper 校验阻断。Apply 在空路径上重新创建标准 Item 双 Prefab，程序逻辑需重新挂载。

同一个 Cocos Prefab UUID 只能完成一次有效导入。再次点击“准备导入”会显示原 Figma 文件和设计节点，并拒绝创建重复会话。若原节点已删除、类型改变，或 Item Component 不再是 Page 直属节点，在原 Figma 文件打开 Cocos Sync 并显式清理。View 重新导入会迁移旧同步映射和资产所有权；Item 只替换接管记录。其他 Figma 文件不能代替原文件清理。

若正式目标本来已经存在同名业务 Prefab，Preview 会按所有权规则阻断，不会原地接管或覆盖。Item 接管的人工删除步骤是用户确认后的显式所有权切换；扩展不会代替项目方删除旧资产。

### 验证坐标、文字对齐与 Widget / Constraints

1. 在源 Prefab 记录父子 `UITransform` 尺寸、anchor、`Node.position`、Label 横纵对齐，以及是否真实挂载并启用 Widget；不要只比较两端属性面板里的 `x/y`。
2. 导入 Figma 后检查节点 Position 尺寸与位置，再在 Typography 中检查文字 Center/Bottom 等框内对齐。Position 区域的 Alignment 按钮只是一次性改写 `x/y`，不是 Label 对齐，也不是 Constraints。
3. 检查 Constraints：Left/Top、Right/Bottom、Center、Stretch、Scale 应分别对应绝对单边、绝对另一边、绝对中心、双边绝对和双边百分比 Widget。Auto Layout 的直接子节点不应再生成定位 Widget。
4. 对源节点没有可映射 Widget 的接管案例，保持 Figma 默认 Left/Top 后 Push；Preview / Apply 结果不应新增 Widget，未改动 Text 应恢复源文本框尺寸、overflow/wrap 与换算后的中心坐标。
5. 将同一节点明确改成 Center、Right、Bottom、Stretch 或 Scale 后重新 Push，Preview 应保留新的 Widget。仍为 Left/Top 的最终值无法表达“设计师刚刚创建了默认 Widget”；如业务必须使用该组合，应在逻辑 Prefab 的实例层维护组件。
6. 跨层 target、混合单位、单边百分比、百分比中心、同轴中心与边同时启用等 Cocos Widget 应保留导入视觉位置并出现降级警告，不能被文档或验收描述为完整双向映射。

### 验证共享 SpriteFrame 精确复用

1. 在“Desktop 连接”下方、三个顶层工作流共同可见的“共享纹理 Bundle 根目录”面板中逐行配置允许复用的根，例如 `db://assets/subpackages/common` 和 `db://assets/resources`，并确认目录的 AssetDB Meta 确实启用了 Asset Bundle；目录名包含 `common` 或 `resources` 本身不构成授权。`db://internal/default_ui/...` 是不加入此列表的受限引擎特例。
2. 验证无 Prefab 的 Catalog 路径：保持 Cocos“共享素材”页签可见，在资源管理器中分别单选、多选该 Bundle 内图片，面板应自动更新选择数量和可导入清单，无需切换页签；准备后，Figma 当前文件没有 Catalog 时，应在执行时的当前 Page 创建一个 `DoomUI Shared Assets` Frame 和对应 Component。再次选择其他图片导入应增量复用同一 Frame，不删除未选条目。
3. 把唯一 Catalog 移动到另一个普通 Page 后再导入，必须继续复用；人为复制带插件标记的 Catalog 后应阻断。Frame 改名不影响识别，插件不得创建或要求名为 Shared Assets 的专用 Page。
4. 使用仍真实存在的源 Prefab 重新执行一次性接管，让 Cocos 端记录源图片 UUID、精确 SpriteFrame UUID、规范化 PNG 内容哈希、九宫格与 Figma 实际 imageRef。旧映射缺少这些字段时不要期待按名称自动共享。
5. 分别把 Catalog Instance 和接管得到的图片放入一个新 UI Frame 并 Push。未改图片与九宫格时，Preview 应显示 `REUSE`，且该项不要求 Figma 上传资源；未选择目标不应进入计划。
6. Apply 后检查生成视觉 Prefab 引用原共享 SpriteFrame UUID，目标 Bundle 没有同图副本，共享图片与 Meta 哈希未改变，并确认共享路径没有进入 `ownedAssets` 或 orphan 候选。
7. 分别验证安全降级：移除共享根白名单、替换 Figma 图片、修改九宫格、修改源图片内容或让精确 SpriteFrame 失效。Preview 应给出 warning 并改为目标 `textures/figma` 生成资源，不得猜测同名文件。
8. Preview 后、Apply 前改变共享图片、Meta 或白名单，Apply 应因重校验失败而停止，不能继续使用陈旧 `REUSE` 计划。
9. 使用 `db://assets/resources/textures/singleColor.png` 这类纯白 Sprite 做 Prefab 接管：Figma 中应显示为可编辑 SOLID；未更换来源时 Preview 应显示原 SpriteFrame 的 `REUSE`，而同一目标中新建的普通 SOLID 仍应生成 `__solid_white`。通过 Catalog 导入的纯白图应继续是 IMAGE fill，以携带可验证 imageRef。
10. 使用 `db://internal/default_ui/...` 做接管：当前 Creator 版本未变时应保留真实图像并 `REUSE` 内置 SpriteFrame；把映射中的来源版本改为其他版本后应安全降级为生成贴图。Catalog 不接受 internal 资源。

### 在业务工程中验证统一 UI Prefab

1. 在共享配置中填写目标 Asset Bundle 根目录，例如 `db://assets/subpackages/doomui_test`。
2. 显式选择并推送符合制作规范的 `UI_DoomUITest`；需要同时生成 Item 时一并选择对应 Page 直属 Component。核对所选 UI/Item 的逻辑、视觉和贴图路径，并确认未选择目标没有进入 Preview。
3. 首次 Apply 后只在逻辑 Prefab 根节点挂载手写的 `UIView` 子类，并通过 `defineUIConfig` 注册 `prefabs/view/UI_DoomUITest`。
4. 使用 `UIMgr.open('doomui_test', 'UI_DoomUITest')` 验证直接子节点 `root`、绑定路径和点击回调。
5. 第二次修改设计并 Apply，核对视觉更新、逻辑 Prefab 文件哈希和业务组件不变。

若 Frame 含 `$list_*`，不要在列表内放 `$item_template`。把 Item 建成 Figma Page 的直属 Component，例如 `Items/item_RoleHead`；Apply 会生成 `prefabs/item/item_RoleHead.prefab` 与 `prefabs/item/figma/item_RoleHead.root.prefab`。随后在 View 逻辑 Prefab 的 `root/.../$list_*` 实例节点下创建 `view/content`，挂载 `ScrollView` 与 `ListExtent`，并由程序员把 `tmpPrefab` 指向合适的 Item 逻辑 Prefab。重新保存、Reimport 后 Preview；缺少 `ListExtent` 是 warning，错误的 Item `root` wrapper 是 blocker，DoomUI 不校验 `tmpPrefab` 的 Item 选择。

业务代码生成工具不是 DoomUI 的依赖或验收前提，其操作由使用方自行维护。真实游戏工程中的扩展链接、临时 Bundle、测试脚本、生成资产和 Profile 都不得提交；清理时只删除本轮创建的明确目标。

扩展重载后会话 token 失效是预期行为，重新输入新配对码即可。服务连接问题可检查：

```bash
lsof -nP -iTCP:38638 -sTCP:LISTEN
```

正确结果应是 Cocos Creator 进程只监听 `127.0.0.1:38638`。

## 测试与验收

提交前最低要求：

```bash
just check
npm pack ./figma-sync --dry-run --json
```

需要宿主验收的变更还应覆盖：

- Cocos 扩展加载、菜单层级和面板版本；
- 本机端口只绑定回环；
- Figma 开发插件可导入、配对，并分别推送单个 Frame、单个 Page 直属 Component，以及显式多选批次；
- Preview 不写资产；Apply 后 asset-db 资源不是 invalid；
- 已有视觉 Prefab UUID、匹配节点 file ID 和嵌套组件引用稳定；
- 逻辑 Prefab 文件哈希不变；
- 失败回滚恢复资源和映射。

证据写入 [验收记录](acceptance.md) 时，明确标注自动化、Cocos 运行态、Figma 运行态和真实设计端到端四类证据，不相互替代。

## 常见问题

### Figma 提示无法连接 Cocos

- 确认打开的是 Cocos Creator 3.8.6 工程，并在“Desktop 连接”中确认本机服务已启动。
- 确认已提交 `manifest.json` 的发布版 `allowedDomains` 和开发版 `devAllowedDomains` 都只允许 `http://localhost:38638`；只配置开发版白名单会使 Community 安装版连接失败。
- 扩展刚重载时旧 token 已失效，清除配对并使用新码。

### Figma Development 菜单里看不到 Cocos Sync

- 先在仓库根运行 `just figma-check`，确认 `cocos-sync/dist/code.js` 和 `dist/ui.html` 已生成。
- 在 Figma Desktop 使用 `Plugins → Development → Import plugin from manifest…`，选择 `cocos-sync/manifest.json`。
- 已导入的入口固定为 `Plugins → Development → Cocos Sync`；插件不会出现在 Community 已安装插件列表中。

### Cocos 面板仍显示旧版本或旧菜单

- 先运行 `just cocos-build`。
- 完整退出并重启 Cocos Creator，避免旧扩展进程缓存。
- 确认 sandbox 的 `extensions/figma-sync` 软链接仍指向当前 `figma-sync/`。

### Preview 没有 Apply 按钮可用

- 内容未变化时不需要 Apply。
- 有 blocker 时必须先修复设计或路径冲突。
- 修改输入/Asset Bundle 根目录/字体映射后旧 plan 已失效，需要重新 Preview。
- UIView 绑定发生删除、改名、换类型或移动时，需要先勾选绑定契约确认项。

### Cocos 场景编辑器看起来是 3D 场景

- 点击场景编辑器左上角的 `2D` 按钮切换到 UI 编辑视图。
- 天空或网格是编辑器视图背景，不是 Figma Sync 生成的 3D 资源，不需要删除 Camera 或场景节点来“清理”它。
- 检查生成结果时，可以在资源管理器中双击 `prefabs/view/figma/*.root.prefab` 或 `prefabs/item/figma/*.root.prefab` 单独打开视觉 Prefab；需要验证逻辑外壳时再打开或实例化 `prefabs/view/*.prefab`、`prefabs/item/*.prefab`。

## Figma Community 发布

发布介绍、图标、封面和数据披露清单见 [Community 发布资料](community/publishing.md)。发布前运行 `just check`，确认本机导入的 manifest 指向当前公开仓库，而非移动前的旧路径。必须沿用已提交的 plugin ID。
