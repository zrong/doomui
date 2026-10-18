# DoomUI 架构

## 目标

DoomUI 将用户明确选择的 Figma Frame / Page 直属 Component 转成 Cocos Creator 可增量更新的 View / Item 资源，兼容范围为 `>=3.8.6 <3.9.0`，运行态验收基线为 3.8.6。它把设计维护的视觉层与程序维护的逻辑层分开，允许频繁更新视觉而不覆盖业务脚本和事件。

## 仓库结构

```text
doomui/
├── figma-sync/                 # Cocos Creator 扩展：Figma Sync
├── cocos-sync/                 # Figma Desktop 插件：Cocos Sync
├── sandbox/                    # Creator 3.8.6 公开演示与验收工程
├── docs/                       # 架构、协议、规范和验收真值
├── scripts/                    # 版本一致性工具
├── AGENTS.md                   # 全仓指导
├── justfile                    # 根级开发命令接口
└── VERSION                     # 发布版本真值
```

根级 `justfile` 提供稳定、可发现的命令入口，子项目仍保留自己的实现命令。根 `just check` 编排两个插件的构建、类型检查、测试和版本校验。

目录、Cocos 包名、npm 包名和用户可见标题统一使用 `figma-sync` / `Figma Sync` 与 `cocos-sync` / `Cocos Sync`。从旧 Cocos 包名迁移时，扩展首次启动会把 `figma-ui-sync` 的可复用项目设置复制到 `figma-sync` Profile，旧 Profile 保留用于回退；旧双布局 Frame 映射不兼容统一目录规范，会在设置规范化时丢弃。Figma 开发插件继续使用 `cocos-sync/manifest.json` 中随仓库提交的原 plugin ID；已写入设计文件或 `clientStorage` 的旧 key 以及稳定 file ID 哈希盐属于持久化协议，不随产品名称或电脑变化。

## 子项目职责

### Figma Sync（Cocos）

- 提供 Vue 3 编辑器面板和固定扩展消息。
- 保存项目输出设置、共享纹理 Bundle 白名单、字体映射和 Frame 身份映射。
- 从用户指定的既有 Prefab 导出一次性结构/图片会话，并在 Figma 导入完成后保存 Cocos file ID ↔ Figma node ID 与 Figma imageRef ↔ Cocos SpriteFrame 映射。
- 从资源管理器当前单选或多选的共享 Bundle 图片建立短期 Catalog 会话，并保存每个 Figma 文件唯一 Catalog 内的 Component/imageRef ↔ Cocos SpriteFrame 映射。
- 接收 Figma Desktop 本机 Push，将输入统一成标准 IR，规划资源、计算 diff 并校验图片。
- 通过 Scene Script 创建 Cocos Node/Component 并序列化 Prefab。
- 通过 asset-db 写入资源、维护 UUID，并在失败时回滚。
- 只监听回环地址，向 Figma 提供配对和 Push 接口。

### Cocos Sync（Figma）

- 在 Figma Desktop 中读取用户当前明确单选或多选的 Frame / Page 直属 Component，不扫描或附带未选目标。
- 在用户选择的 Page 中把短期 View 会话创建为可编辑 Frame，把 Item 会话创建为 Page 直属 Component。
- 在当前 Page 创建首个 `DoomUI Shared Assets` Catalog Frame，或复用该文件任意 Page 中已经标记的唯一 Catalog；每张共享图片对应一个可复用 Component。
- 用 Figma Plugin API 的 `JSON_REST_V1` 格式导出本地结构。
- 先发送结构，根据 Cocos 返回的缺失资源清单按需导出 image fill 或 PNG。
- 使用八位配对码建立本机会话；不持有外部 API 凭据，也不调用 Figma REST API。

### Sandbox

- 宿主固定为 Cocos Creator 3.8.6。
- 验证扩展加载、菜单、面板、Scene Script、asset-db 和 Prefab 运行态。
- `ArticleDemo` 的场景、最小控制器、双 Prefab 和 Meta 是可提交的公开离线 Fixture；私有设计输出、映射与宿主缓存保持本地。

## 界面工作流

两端都按用户任务而不是传输协议组织成三个顶层页签：“同步到 Cocos”、“创建 Figma 起点”和“共享素材”。同一时刻只展示当前工作流的输入、状态和主操作，避免把不同生命周期的操作混在一张长表单中。

- Cocos 的“同步到 Cocos”只保留 Desktop Push 的输出设置和 Preview / Apply 审查区。
- Desktop 连接信息在需要时展开；界面不显示 PAT、Frame URL 或外部 API 次数。
- Preview 变更按节点、Component Prefab、贴图、解除管理和其他资源分组；每项先显示可读名称，再提供可换行复制的完整路径。`ORPHAN / 解除管理` 与物理删除明确分开。Apply 产生的孤儿候选持久化到项目 Profile，并在独立卡片中等待用户显式确认。
- Cocos 的“创建 Figma 起点”只负责准备 Prefab 短期会话；Figma 的同名页只负责选择 Page 并导入。
- Cocos 面板把“Desktop 连接”和其下方的共享 Bundle 白名单作为两个独立公共面板，统一放在三个顶层工作流 TAB 之前；“共享素材”工作流读取资源管理器当前单选或多选图片并准备短期会话，Figma 的同名页只负责更新当前文件的唯一 Catalog。
- Figma 的“同步到 Cocos”只显示当前明确选择的同步目标和推送操作，连接状态作为三个工作流共用的紧凑前置状态。

## 同步链路

### 高频链路：Figma Desktop Push

```text
用户在 Figma 明确单选或多选 Frame / Page 直属 Component
        ↓
Cocos Sync 导出 JSON_REST_V1
        ↓ POST /v1/prepare
Figma Sync 标准化、规划、diff
        ↓ 返回缺失图片清单
Cocos Sync 按需导出并 PUT 图片
        ↓ POST /v1/complete
Cocos 面板展示 Preview
        ↓ 用户确认 Apply
asset-db + Scene Script 事务写入
```

`JSON_REST_V1` 是 Figma Plugin API 的本地结构导出格式名，不代表网络 REST 调用。整条链路不持有 PAT、不调用 Figma REST API，也不消耗其调用额度。Push 完成只产生 Preview，绝不自动 Apply。

### 一次性接管链路：Cocos Prefab → Figma

```text
用户在 Cocos 打开或选择任意现有 db://assets/**/*.prefab
        ↓ Scene Prefab 编辑上下文提供 UUID；AssetDB 解析为完整 db:// URL
        ↓ 非 Prefab 编辑模式才回退到资源管理器单选；也允许手动填写
“创建 Figma 起点”显式选择 UI Frame / Item Component 并确认源 Prefab
        ↓ 只读 Scene Script 导出结构和图片
30 分钟内存会话（不复制 Prefab，不写 assets）
        ↓ 已配对的本机接口
Cocos Sync 在用户选择的 Page 新建 Frame / Component
        ↓ 回传 node ID ↔ file ID、imageRef ↔ SpriteFrame 映射
项目 Profile 保存 adoption mapping
        ↓ Prefab UUID 唯一约束
重复准备时定位原文件/设计节点并阻断
        ↓ 原文件确认节点已失效且用户清理
软释放映射；下次导入迁移原资产所有权
        ↓
后续只走 Figma → Cocos Push / Preview / Apply
```

这条链路是一次性 bootstrap，不是双向同步。它不会自动覆盖 Figma 中已有节点，也不会在导入时修改源逻辑 Prefab。同一个 Prefab UUID 不能同时拥有多个有效 Figma 节点映射；当前文件不能验证其他 Figma 文件里的节点是否删除，因此跨文件映射不会自动释放。View 后续选择原 Frame 推送，Item 后续选择原 Component 推送；需要一起更新时显式多选。Item 确认导入后需先备份/迁移程序逻辑，再人工删除旧双 Prefab；第一次 Apply 才按标准所有权重新创建，服务不自动移动或覆盖旧业务资产。

### 共享素材链路：Cocos SpriteFrame → Figma Catalog

```text
用户在 Cocos 资源管理器单选或多选共享 Bundle 图片
        ↓
Figma Sync 校验白名单、真实 Asset Bundle 和精确 SpriteFrame
        ↓ 规范化 PNG；30 分钟内存会话
Cocos Sync 下载全部图片并检查全 Figma 文件
        ↓
不存在 Catalog：在当前 Page 创建一个标记 Frame
已有一个 Catalog：无论位于哪个 Page 都复用
存在多个 Catalog：阻断，不猜测、不自动删除
        ↓
每张图创建或更新一个带稳定插件标记的 Component
        ↓ 全部成功后回传 Catalog/Component node ID 与 imageRef
项目 Profile 保存当前 Figma fileKey 的精确 SpriteFrame 映射
```

Catalog 不要求独立 Page，Frame 名和 Component 名都只用于展示；身份来自插件私有标记、Figma fileKey/node ID/imageRef 与 Cocos 图片 UUID、SpriteFrame UUID、内容哈希和 inset。新 Catalog 只在执行时的当前 Page 创建；之后设计师可以把它移动到该文件的其他 Page，下一次仍按标记复用。导入失败会移除本轮新建节点并恢复已更新 Component；不会删除 Catalog 中未选的既有 Component，也不会修改或复制 Cocos 源图片。Project Profile schema 8 为每个 Figma 文件保存一个 Catalog 映射。

## 统一双 Prefab 所有权

用户配置生成内容的 Asset Bundle 根目录；若要复用既有公共资源，再显式配置一个或多个“共享纹理 Bundle 根目录”。所有新生成内容固定输出：

```text
<bundle-root>/
├── prefabs/view/UI_Name.prefab          # 仅首次创建的逻辑外壳
├── prefabs/view/figma/UI_Name.root.prefab # 插件持续维护的 UI 视觉 Prefab
├── prefabs/item/item_Name.prefab        # 仅首次创建的 Item 逻辑壳
├── prefabs/item/figma/item_Name.root.prefab # 插件持续维护的 Item 视觉 Prefab
└── textures/figma/                      # 内容寻址的生成图片
```

- 视觉 Prefab、Component Prefab 和生成贴图归插件所有。
- View 与 Item 逻辑 Prefab 归程序员所有；业务脚本和事件只挂在逻辑层。插件只在默认 Item 路径为空时创建一次逻辑壳，之后不覆盖。
- Figma node ID 对应稳定的 Cocos file ID，资源路径对应稳定 asset UUID。
- 同一 Bundle 内，相同 Figma 图片内容使用同一路径和 SpriteFrame UUID；九宫格导入设置冲突时 Preview 阻断，不复制第二份图片。
- 一次性接管或 Shared Assets Catalog 都可记录原始图片内容哈希、精确 SpriteFrame UUID 和纯白图片标记。后续 Figma 图片未变化、原项目资源仍位于白名单中的真实 Asset Bundle、内容和九宫格参数一致时，Preview 显示 `REUSE` 并直接引用该 SpriteFrame；`db://assets/resources` 与业务 `common` 使用相同的显式 Bundle 白名单。纯白图即使在 Prefab 接管流程中显示成可编辑 SOLID，也会按接管节点身份恢复原 SpriteFrame；Catalog 始终保留 IMAGE fill 以携带 imageRef，设计师原生 SOLID 仍生成 `__solid_white`。共享资源不归插件所有，不写入、不删除、不进入 orphan。
- `db://internal/default_ui/...` 只允许一次性接管所引用的真实图片进入 Figma，并额外记录 Creator 版本。Preview 与 Apply 在版本、图片 UUID/内容、SpriteFrame UUID 和 inset 全部一致时直接引用当前引擎内置 SpriteFrame；校验失败则生成目标 Bundle 贴图。其他 internal 命名空间不开放，避免形成不可追踪的引擎私有依赖。
- 一次性接管的节点映射还记录 Widget 约束是否确实来自源 Cocos、Text 的源/初次导入尺寸和 overflow/wrap，以及空 SpriteFrame 运行时槽位的 RGBA 与 SIMPLE/SLICED 来源。默认 Left/Top 不伪造 Widget；未被设计师改过尺寸的 Text 回传时恢复源文本框和中心坐标；未改动的透明 Sprite 占位回传为 `spriteFrame = null`，不生成 `__solid_white` 资产。
- Figma 换图、原文件/Meta 漂移、SpriteFrame 丢失、九宫格不一致或路径不在共享白名单时，不猜测同名资源；Preview 警告并回退到 `textures/figma` 生成资源。Apply 在写入前重新验证 `REUSE`，避免 Preview 后的共享依赖漂移。
- 目标路径存在非插件资源时 Preview 阻断；失去引用的旧资源先报告 orphan，不自动删除。
- 逻辑 Prefab 被人工删除后只警告，不自动重建，以免覆盖人工恢复。

逻辑 Prefab 的直接视觉子节点固定名为 `root`，供 `UIView.getRoot()` 和绑定的 `root/...` 路径使用。View 逻辑根首次创建时跟随 Figma Frame 尺寸并带四边 Widget；Item 逻辑根跟随 Item 视觉尺寸但不添加 View Widget。视觉 `root` 保持设计尺寸且不强制 Widget，内部节点继续按 Figma Constraints 生成 Widget。DoomUI 不依赖业务代码生成工具，也不生成 TypeScript；挂载 `UIView`、`ListExtent`、业务脚本和注册 `defineUIConfig` 仍属于业务逻辑层。

布局同步分成四层：Figma Position Alignment 只把一次性对齐结果写进 `x/y`，Typography Alignment 映射 Label 的框内文字对齐，Constraints 映射普通容器中的 Widget，受支持 Auto Layout 映射 Layout。Figma 固定使用左上角原点和向下 Y 轴，Cocos 生成节点统一使用中心锚点和向上 Y 轴，所以属性面板数值会经过可逆坐标换算而不要求字面相同。Cocos → Figma 的 Widget 仅支持直接父 target、绝对单边/中心、双边同为绝对或同为百分比；其他组合保留视觉位置并告警。接管来源标记会抑制源节点不存在 Widget 时的 Figma 默认 Left/Top，避免一次往返凭空增加组件。

Figma 顶层 Frame 对应 View，Page 直属 Component 对应独立 Item；两者不在 Figma 中建立运行时关联。`$list_*` 只是跨所有权边界的稳定挂载节点。Cocos 保存逻辑 Prefab 时，程序员在任意深度视觉实例上创建的 `view/content` 以及挂载的 `ScrollView`、`ListExtent` 会作为 mounted children/components 保存在外层逻辑 Prefab，而不是写入 `.root.prefab`。Preview 可回读最终树并在缺少 `ListExtent` 时警告，但 `ListExtent.tmpPrefab` 的 Item 选择完全由程序员维护。

旧 `prefabs/frame/*.root.prefab` 不做 AssetDB 迁移。升级时删除对应 Frame 映射记录的全部旧产物后重新 Preview；全部已跟踪产物均不存在时按全新基线重建。若仍残留任一旧产物或旧目录映射，则阻断同步，避免保留引用旧视觉 UUID 的逻辑壳。

## Preview 与事务

Preview 只读取 Figma 和本地状态，输出新增、更新、共享复用、移除、解除管理、未变化、警告和阻断项。计划包含内容摘要并有有效期；输入、字体、输出 Bundle 或共享纹理白名单改变后必须重新 Preview。节点与绑定优先按 Cocos file ID 跨 Figma node ID 匹配，避免重新导入同一 Prefab 产生虚假的全量删除/新增。

项目 Profile 不会因为用户在磁盘清空生成目录而自动消失。若某 Frame 映射记录的所有项目源文件都已不存在，Preview 明示“按全新重建”并以空基线计算，但不修改 Profile；判定以 `db://assets` 的源文件为准，不采信 AssetDB 中可能残留的 library/import 缓存。Apply 成功后才替换映射。只缺少部分输出时仍按漂移处理。

orphan 始终先解除当前 Frame 的所有权，不在 Apply 中自动删除。Apply 成功后，候选路径持久化到项目 Profile；Cocos 面板提供独立的“清理孤儿资源”操作。若设计目标已永久删除，用户还可在同一卡片中显式退役对应同步目标：服务按持久化 `frameKey` 查找真实映射，原子移除 Frame 映射及其关联接管身份，只把不再被其他 Frame 拥有且位于标准生成目录的 `ownedAssets` 加入 `pendingOrphans`，并使当前 Preview 失效。退役本身不调用 AssetDB 删除，也不触碰逻辑 Prefab 或共享只读资源。

用户可显式“扫描旧输出”：它只扫描当前设置和历史 Frame 映射所记录 Bundle 根目录下的标准生成目录，再排除所有当前 `ownedAssets`，扫描本身不删除。只有用户勾选永久删除确认后，扩展才重新检查候选没有被任何当前 Frame 管理、路径位于 `textures/figma/*.png`、`prefabs/view/figma/*.root.prefab` 或 `prefabs/item/figma/*.root.prefab`，且没有工程外部资源依赖，然后通过 AssetDB 删除。逻辑 `prefabs/view/*.prefab`、`prefabs/item/*.prefab`、旧 `prefabs/frame/*.root.prefab`、非插件路径、重新被管理或仍被引用的资源保留并逐项显示原因；已经不存在的旧记录仅从候选列表移除。

一次性 Cocos → Figma 接管、Shared Assets Catalog 与 Desktop Push 使用协议 v12。v9 提供 `kind=view|item`、通用 node ID/type 和 Item 接管映射；v10 用显式 `targets[]` 替代隐式全文件 `itemComponents`；v11 增加共享素材短期会话、图片下载和 Catalog 完成映射；v12 用一个安全的鉴权状态 DTO 合并连接状态、接管摘要和共享素材摘要。Figma 后台以 10 秒 single-flight 连接检查刷新该 DTO，接管 node ID 的宿主校验改为启动/配对、导入完成、进入接管工作流和 debounce 文档事件触发，避免把 `getNodeByIdAsync` 放入高频循环。单选或多选 Frame / Component 都生成一个原子 Preview / Apply 批次，未选择目标不参与读取、校验、写入或所有权变化。无法无损表达的 Button transition、Sprite 模式和运行时组件仍必须显式告警；物理/业务组件按类型聚合并留在逻辑 Prefab 或业务代码中。

Apply 先完成资源获取和校验，再记录恢复信息并写入。任一步骤失败时恢复已更新资源、删除本轮新建资源，最后才提交 Frame 映射。这个顺序是稳定身份与业务资产安全的核心约束。

## 第一版不处理

- PSD 导入或回写
- 自动监听设计变化
- 超出受限线性子集的 Auto Layout（Grid、Wrap、Fill、Space between、绝对定位直接子节点）
- Toggle、ScrollView、ProgressBar、Mask、RichText 的专用映射
- 自定义 Button 状态控制脚本
- UIBase 专用生成，以及对既有逻辑 Prefab 的自动原地改写/持续反向同步

更细的节点、Variant、字体、九宫格和限流规则见[详细设计](figma-to-cocos-prefab-tool-design.md)。
