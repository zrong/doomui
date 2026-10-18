# Figma Sync：Cocos Creator 插件设计

> 更新日期：2026-10-18
>
> Cocos 插件：`doomui/figma-sync`
> Figma 插件：`doomui/cocos-sync`

## 1. 第一版边界

第一版的持续同步只实现 `Figma → Cocos Creator Prefab`，Creator 兼容范围为 `>=3.8.6 <3.9.0`，运行态验收基线为 3.8.6：Figma Desktop 伴生插件手动单选或多选 Frame / Page 直属 Component 并推送，只处理明确选择的目标。DoomUI 不提供 PAT 或 Figma REST API 拉取入口。

为已有 UI 或 Item 建立设计起点，允许用户显式触发一次 `Cocos Prefab → Figma Frame / Component` bootstrap。源可以是任意现有 `db://assets/**/*.prefab`；用户显式选择导入为 Frame 或 Component，目录不再参与类型判定。流程不复制源文件、不持续反向同步、不自动合并双端改动；完成节点映射后仍回到上述单向链路。

没有对应 Prefab 的通用 SpriteFrame 通过独立的 Shared Assets Catalog 流程进入 Figma：Cocos 资源管理器支持单选或多选白名单 Bundle 图片，Figma 在当前文件创建或复用唯一 Catalog Frame。Catalog 不要求独立 Page，也不参与日常目标扫描。

PSD 导入 Figma、从 PSD 更新 Figma、自动监听设计修改，以及 Toggle、ScrollView、ProgressBar、Mask、RichText 的专用组件映射均不在当前范围。Desktop Push 支持手动单选或多选 Frame / Page 直属 Component；Mask 和裁剪内容仍按第 4 节规则条件降级。

PSD 可以在工作流之外一次性导入 Figma，但插件不读取、上传或回写 PSD。此前文档中的 PSD 转换方案保留为调研背景，不再作为第一版功能或验收前置条件。

## 2. 架构和数据流

扩展采用 `package_version: 2`、TypeScript 和 Vue 3，宿主版本限定为 `>=3.8.6 <3.9.0`：

1. Cocos 面板提供 Desktop 连接、项目输出配置和 Preview / Apply；同时启动仅监听 `127.0.0.1:38638` 的 Push 服务。栅格节点固定以 1x 导出。
2. Figma Desktop 伴生插件使用 Figma Plugin API 的 `JSON_REST_V1` 格式导出所选 Frame，通过配对后的本机协议上传结构和按需图片；不使用外部 API 凭据或 REST API。
3. Push 输入进入标准化 IR、diff、asset-db 事务、Scene Script 和报告流程。
5. Scene Script 只使用 Cocos 引擎 API 构建 Node/Component，并通过 `EditorExtends.serialize` 序列化 Prefab。
6. `asset-db/create-asset`、`save-asset`、`save-asset-meta` 和 `reimport-asset` 负责资源及 UUID；插件不复制旧工具 `.meta` 模板。
7. 映射清单保存在项目 Profile；项目文件、Prefab、报告和日志均不记录配对凭据。
8. 一次性接管由 Cocos Scene Script 读取 Prefab 节点、图片与精确 SpriteFrame 引用，主进程保存最多 30 分钟的内存会话；Figma 插件在目标 Page 为 View 新建 Frame、为 Item 新建 Page 直属 Component，再回传节点映射和实际 Figma imageRef。源 Prefab 和 `assets` 全程保持不变，同一个 Cocos Prefab UUID 同时只能绑定一个 Figma 设计根。
9. 共享素材使用独立 30 分钟内存会话。Cocos 主进程从当前 AssetDB 单选/多选解析图片、精确 SpriteFrame 和 inset；Figma 加载全部 Page 只为检查 Catalog 唯一性，在当前 Page 创建首个标记 Frame或复用已有标记 Frame，并在完成后回传 Component node ID 和 imageRef。Frame/Component 名不是身份。

Preview 不修改 `assets`。Apply 只能使用同一 `planId`，计划有效期十分钟；输入、字体表、Asset Bundle 根目录或共享纹理白名单变化后必须重新 Preview。新图片会先全部接收、解码并转成 PNG，随后才开始 asset-db 写入；任何写入或 Prefab 生成失败都会恢复已修改资源并删除本次创建的资源。

一次性导入保留原 Cocos Prefab file ID，并将它绑定到新建的 Figma node ID。完成接管时，Cocos 端从内存中的源节点树给映射补充约束来源与 Text 文本框基线，不由 Figma 客户端声明：`sourceWidgetMapped=false` 表示默认 MIN/MIN 仅是 Figma 隐式值，不能凭空生成 Widget；Text 基线同时保存源尺寸、初次 Figma 尺寸和 overflow/wrap。后续标准化时仍存在的节点复用这些 file ID；新增 Figma 节点使用正常的稳定 ID。View 接管映射用于所选 UI Frame；Item 接管映射按 `kind=item + fileKey + Page 直属 Component node ID` 独立保存，再进入 Item Prefab 规划，二者都参与 `planId`。重复 file ID 是 blocker，已删除或类型/层级失效的设计节点可由原文件显式清理。同一个源 Prefab 完成“释放失效接管 → 重新导入”时，View 和 Item 都只迁移同类型旧 Frame 的同步映射、资产所有权和 `adoptionKey` 到新的 Figma node ID；Item 不得迁移 View 映射，也不得在每次重新导入后累积同名 Item 映射。

Prefab 接管与 Shared Assets Catalog 都保存 Figma imageRef、源图片 URL/UUID、精确 SpriteFrame UUID、规范化 PNG 内容哈希、是否为全不透明纯白图和九宫格参数；接管映射另保存使用节点 file ID。后续 Preview 优先使用当前节点的精确映射；若节点是改名或从同一 Figma 文件的其他已接管 Frame / Component 或 Catalog 复制而来，则允许通过同文件 imageRef 索引恢复原始图片身份。项目资产候选必须位于用户白名单中且由 AssetDB Meta 确认为 `isBundle=true`；`common` 和 `db://assets/resources` 都遵循这条显式授权。图片 UUID/内容与当前 SpriteFrame inset 也必须一致，才建立 `REUSE` 计划；Apply 写入前再次校验并直接引用原 SpriteFrame UUID。共享资源不纳入插件所有权，不能被写入、覆盖或孤儿清理。同一 imageRef 若对应多个不同且均有效的 SpriteFrame，或任一必要条件不满足，都警告并回退到生成资源，不按名称、路径末段或相似图片猜测；不同 Figma 文件之间不共享该身份索引。

全不透明纯白 Sprite 图片在 Figma 中使用 SOLID 表达，是为了让 Sprite RGBA 可直接编辑，不表示源图片身份被取消。标准化会把能由接管节点 file ID 证明来源的 SOLID 从设计师原生 `__solid_white` 任务中拆出，再按上述规则恢复原 SpriteFrame；没有接管来源的 SOLID 继续生成项目贴图。`db://internal/default_ui/...` 作为受限特例，不进入项目 Bundle 白名单：接管记录源 Creator 版本并导出真实像素，Preview / Apply 仅在当前 Creator 版本以及图片、SpriteFrame、内容和 inset 全部一致时直接引用 internal SpriteFrame，否则生成目标 Bundle 自有贴图。除 `default_ui` 外的其他 internal 命名空间不参与接管图片复用。

## 3. 统一双 Prefab 与所有权

用户配置生成内容的 Asset Bundle 根目录，并可选配置只读共享纹理 Bundle 根目录。`UI_Name` 固定产物：

```text
<bundle-root>/prefabs/view/UI_Name.prefab
<bundle-root>/prefabs/view/figma/UI_Name.root.prefab
<bundle-root>/prefabs/item/<Item>.prefab
<bundle-root>/prefabs/item/figma/<Item>.root.prefab
<bundle-root>/textures/figma/**
```

- `*.root.prefab` 及其生成贴图依赖由插件维护。
- `prefabs/view/*.prefab` 和 `prefabs/item/*.prefab` 是逻辑外壳，只在目标为空时创建一次，之后绝不修改；业务脚本和事件只挂在逻辑层。
- Figma node ID 生成稳定的 Cocos Prefab file ID。
- Component Prefab 路径使用规范化后的 Component 名；不同组件生成同一路径时 Preview 阻断，要求设计端改成唯一名称。
- 原始图片使用 Figma 图片内容 hash，栅格结果使用稳定渲染摘要，在同一 Bundle 的 `textures/figma` 中内容寻址；同一内容与相同导入设置共用一个 SpriteFrame UUID。
- 同一图片若被要求使用不同九宫格边距，Preview 阻断，不静默复制第二份图片。跨 Asset Bundle 不承诺物理去重。
- 唯一允许的跨 Bundle 去重是 Prefab 接管或 Shared Assets Catalog 建立的精确映射：白名单、图片内容和 SpriteFrame 参数全部验证通过后直接复用；Preview 用 `REUSE` 与普通 `ADD/UPDATE` 区分。
- 目标路径若存在非插件拥有的资源，Preview 阻断。失去引用的旧资源只报告 `ORPHAN / 解除管理`，不自动删除磁盘文件；界面不得把这类记录混称为“删除”。
- 逻辑 Prefab 被人工删除后只警告，不自动重建。

首次生成的逻辑根节点为 `UI_Name`，尺寸跟随 Figma Frame，带四边对齐的 `Widget`；视觉 Prefab 实例是唯一直接子节点 `root`。视觉根自身不强制 Widget，保持 Figma Frame 尺寸；内部节点按 Constraints 映射 Widget。Scene Script 不添加 `UIView`、遮罩、输入阻断或业务脚本。`mask`、`block`、`isFull` 和 `showType` 由 `defineUIConfig` 与业务类维护。

Item Component 使用同样的双 Prefab，但 Item 逻辑根不添加 View 的四边 Widget。Figma Page 的直属 `COMPONENT` 是独立 Item 定义，不要求在 UI Frame 或 `$list_*` 中放置 Instance；DoomUI 持续更新 `prefabs/item/figma/<Item>.root.prefab`，只在 `prefabs/item/<Item>.prefab` 不存在时创建一次逻辑壳。`ListExtent.tmpPrefab` 由程序员在 Cocos 中指向 Item 逻辑 Prefab，DoomUI 不保存或推断 List→Item 关系。

既有 Item 的接管采用显式切换，不做原地迁移：用户从 `prefabs/item/<Item>.prefab` 导入 Figma Component 后先检查设计结果并备份/迁移程序员维护的脚本、事件和组件，随后在第一次 Item Push / Apply 前人工删除旧 `prefabs/item/<Item>.prefab` 与对应旧视觉 Prefab。用户需明确选择该 Component；Apply 在空目标上重新创建 Item 双 Prefab，程序逻辑需重新挂载。旧文件仍存在时按所有权或 wrapper 校验阻断，服务不自动覆盖、改名、移动或拆分旧业务 Prefab。

不迁移旧 `prefabs/frame/*.root.prefab`。升级时由项目方删除该 Frame 映射记录的全部旧产物（包括旧视觉、逻辑壳和生成依赖），再重新 Preview；当磁盘上的全部已跟踪产物都不存在时，DoomUI 按全新基线重建。只删除一部分或仍保留旧目录映射时会以 `OUTPUT_LAYOUT_REQUIRES_REBUILD` 阻断，避免新旧引用混用。

Asset Bundle 根目录写入 Frame 映射。已经同步的 Frame 不能切换 Bundle；同名非插件逻辑 Prefab 也不会被接管。项目 Profile schema 8 保留 schema-3 View/Item 接管记录，并为每个 Figma fileKey 增加一个 Shared Assets Catalog 映射；旧 schema-2 View 接管记录仍迁移为 `kind=view` 的通用节点模型，不猜测旧记录为 Item。

永久放弃一个同步目标与“删除后重新导入”是不同操作。Cocos 面板必须列出持久化 Frame 映射，并提供二次确认的“退役同步目标”：输入只接受列表返回的 `frameKey`；成功后原子移除该 Frame 映射及关联接管身份，取消尚未 Apply 的 Preview，并把该目标独占的标准生成贴图/视觉 Prefab 加入 `pendingOrphans`。其他 Frame 仍拥有的路径、共享素材、逻辑 Prefab 和非标准目录均不得进入候选；退役阶段不删除文件，物理删除继续走独立孤儿清理与依赖复查。

项目 Profile 与磁盘资源是两个独立状态。若用户已删除某 Frame 映射记录的全部输出，但 Profile 仍存在，Preview 以 `db://assets` 对应的项目源文件为准（不被 AssetDB 残留的 library/import 记录误导），按空基线只读计算并显示“按全新重建”；它不生成旧节点删除或旧绑定破坏性确认，Apply 成功后才原子替换旧映射。仅缺失部分输出属于真实漂移，不得静默套用全新重建。

## 4. 节点和布局映射

| Figma | Cocos | 规则 |
|---|---|---|
| Frame | Node + UITransform | 顶层 Frame 为视觉 Prefab 根 |
| Text | Label | 单一文字样式保留粗体、斜体、下划线、换行/截断、一个 SOLID stroke 和一个普通 DROP_SHADOW；富文本、渐变、多重描边或复杂效果栅格化 |
| Rectangle/简单图片 | Sprite | 纯色复用白色像素；无裁剪的 FIT 图片可使用原图，其余请求 Figma PNG 渲染 |
| Vector/Boolean/Ellipse/复杂效果 | Sprite | 批量请求 Figma PNG 渲染 |
| Page 直属 Component | `prefabs/item/<Component>.prefab` + `prefabs/item/figma/<Component>.root.prefab` | 每个 Component 独立生成 Item 双 Prefab，名称必须唯一 |
| Instance | 嵌套 Prefab | 应用名称、文字、可见性、颜色、图片、尺寸、位置等可表达 override |
| Component Set | 无运行时节点 | 只用于 Variant 分组和 Button 状态分析 |
| Group | 普通容器 | 导入并警告改用 Frame |
| 受限 Auto Layout | `cc.Layout` | 只支持 Horizontal/Vertical、No wrap、主轴起点、交叉轴居中且两侧 Padding 相等、交叉轴 Fixed、直接子节点 Fixed；主轴 Hug 映射 `CONTAINER` |
| Section/Slice | 忽略 | 不生成运行时节点并产生明确警告 |
| Mask/裁剪容器 | 条件降级 | 不生成 Cocos Mask 组件；纯视觉子树以整体栅格化 Sprite 替代，含文字或交互语义的子树保留结构但跳过 Mask/裁剪效果并警告 |

所有 UITransform 使用中心锚点 `(0.5, 0.5)`。优先使用 Figma `relativeTransform` 计算嵌套节点的中心坐标和旋转；回退时用 absolute bounds。Figma Y 轴向下转换为 Cocos Y 轴向上，旋转取反。

Cocos → Figma 接管不能只把当前节点的 `Node.scale` 乘入当前 WH。Figma 没有独立持久的节点 Scale，因此必须递归计算 `cumulativeScale = parentCumulativeScale × abs(localScale)`：当前节点 WH 乘累计缩放，它在父节点中的左上坐标乘父级累计缩放，文字字号/行高/描边/阴影与 Auto Layout padding/spacing 使用同一视觉比例。这会把原 Prefab 的层级 Scale 规范化为 Figma 可编辑几何，并在后续 Figma → Cocos 时生成 `scale=1` 的视觉等价节点。非等比累计缩放的文字字形无法在 Figma Text 中无损表达，以垂直比例保留字号并警告。

Figma 右侧 Position 区域的 Alignment 是一次性编辑命令，只改变最终 `x/y`，不作为同步语义。Typography Alignment 对应 `cc.Label` 文本框内的横向/纵向排版；Constraints 才对应普通父容器子节点的 `cc.Widget`；Auto Layout 对应受限 `cc.Layout`。这四层不能互相替代。Figma 固定使用父节点左上角原点和向下的 Y 轴，也没有 Cocos anchorPoint 的持久等价项，因此两端属性面板显示的坐标不要求相同；同步通过父子尺寸、中心锚点和 Y 轴反转做可逆转换。

标准 Figma Constraints → Cocos Widget 的轴向映射为：`MIN` 生成绝对 Left/Top，`MAX` 生成绝对 Right/Bottom，`STRETCH` 生成两侧绝对边距，`CENTER` 生成绝对中心偏移，`SCALE` 生成两侧百分比边距。横纵两轴独立计算并合并为一个 Widget。普通、非 Auto Layout 父容器中的标准 Constraints 均按此规则处理。

Cocos Widget → Figma Constraints 不是完整逆映射，只接受以下无歧义子集：

| Cocos Widget 轴向设置 | Figma Constraints |
|---|---|
| 启用一个绝对边 | MIN 或 MAX |
| 仅启用绝对中心 | CENTER |
| 启用两个绝对边 | STRETCH |
| 启用两个百分比边 | SCALE |

target 非直接父节点、同轴中心与边同时启用、混合绝对/百分比单位、单边百分比、百分比中心和 `alignMode` 运行时语义均不进入 Constraints；导入保留最终绝对位置并警告。禁用 Widget 也没有 Figma 的持久等价状态。接管映射由 Cocos 端记录 `sourceWidgetMapped`，用来区分真实源 Widget 与 Figma 自动产生的默认 MIN/MIN。源节点没有可映射 Widget 且 Constraints 仍为默认 Left/Top 时，回传抑制 Widget；设计师选择非默认 Constraints 后才创建。Figma 不保存“用户触碰过默认 Constraints”的历史，因此仍为 Left/Top 的最终状态不能声明新 Widget，这是有意保留的歧义边界。

受支持的 Auto Layout 转换为 Cocos `Layout`，并由 Layout 独占直接子节点的位置；这些子节点不再生成定位 Widget。主轴 Fixed 对应 `ResizeMode.NONE`，主轴 Hug 对应 `ResizeMode.CONTAINER`，Padding 与 Item spacing 原样保留。Grid、Wrap、Space between、Reverse z-index、交叉轴非居中或两侧 Padding 不相等、交叉轴 Hug、Fill、Absolute positioning 或旋转直接子节点不做语义转换，Preview 产生 `AUTO_LAYOUT_BAKED` 警告并保留最终绝对位置。

字体必须显式配置 `Figma family/style = db://...ttf|otf`。缺失映射时使用系统字体并警告，不猜测项目文件名。

一次性 Cocos → Figma 接管时，兼容范围内 Cocos Label 的粗体、斜体、下划线、overflow/wrap、描边和单阴影进入协议 v6；旧 Prefab 中独立的 `cc.LabelOutline`、`cc.LabelShadow` 也会规范化。反向同步只接受一个可见 SOLID stroke 和一个普通 DROP_SHADOW；这些映射保留参数语义，但不承诺两个渲染器逐像素一致。接管创建 Text 时固定为源 `UITransform` 尺寸，避免 Figma 字体度量把文本框自动收缩；若接管映射中的初次尺寸仍未被设计师修改，标准化会恢复源尺寸、overflow/wrap，并按尺寸差的一半修正中心坐标。Figma 没有 `SHRINK` 等价文本框，因此导入时保留固定尺寸并警告，回传降级为 `CLAMP`。

Auto Layout 直接子节点仍由 Layout 独占定位。Sprite 的图片 alpha 双向保留；全不透明纯白源图转成可编辑 SOLID fill，普通图片的非白 RGB 染色只保留图片与 alpha 并警告。

一次性导入不把运行时职责伪装成设计语义。`RigidBody2D`、`Collider2D`、`ProgressBar` 和业务脚本按组件类型聚合列出节点路径，继续由逻辑 Prefab/业务代码维护；Button transition/事件和 TILED/FILLED/grayscale Sprite 只给出局部支持警告，Variant 与特殊 Sprite 模式留到后续阶段。

九宫格仅识别完整语法：

```text
panel @9slice{l:12,r:12,t:12,b:12}
```

缺项、空值、负数、超过节点尺寸或下载后超过真实图片像素尺寸时，按普通 Sprite 导入并警告；例如 `t:` 必须报告 `NINE_SLICE_INVALID`，不能通过 JavaScript 数值转换被解释成 `0`。同一图片可由普通 Sprite 与一种九宫格 Sprite 共享：SpriteFrame 保存一份 border，普通节点以 `Sprite.Type.SIMPLE` 忽略 border，九宫格节点以 `Sprite.Type.SLICED` 使用它。只有多个使用点提供了不同的非空九宫格边距时 Preview 才会阻断。

一次性从 Cocos 导入的 `cc.Sprite.Type.SLICED` 节点必须写入同一 `@9slice{...}` 标记，并在 Figma 使用 `IMAGE/FILL` 展示。反向推送时，只有带有效九宫格标记的 `FILL` 才直接复用原始图片并恢复 `SLICED` 与四边 inset；JSON_REST_V1 为标准 `FILL` 自动附带的 image transform 仅用于 Figma 预览，不使九宫格背景退化。普通 `FILL` 仍视为 Figma 裁剪语义；它若直接作为含语义子节点的容器背景，Preview 必须以 `CONTAINER_BACKGROUND_UNSUPPORTED` 阻断并要求改用 `FIT`、显式九宫格或独立视觉背景，不能生成一个无背景的容器。这样带文字或图标子节点的按钮 Frame 可以保留父节点背景，不需要把整个交互子树栅格化。

上述标记只适用于拥有真实 SpriteFrame 图片的节点。SpriteFrame 为空的运行时 Sprite 槽位不携带九宫格标记；接管映射记录其空 Frame、Sprite RGBA 和 SIMPLE/SLICED 来源，Figma 仅用全透明 SOLID fill 表达占位。该占位未改动时，Figma → Cocos 必须保留 `cc.Sprite` 组件并恢复 `spriteFrame = null`，且从资源计划移除无人使用的 `__solid_white`，不能把占位实现泄漏成目标 Bundle 资产；占位被改成可见 Fill 后才按普通视觉资产处理。旧映射可对“`$sp_`、无源图片身份、全透明 generated-solid”做保守兼容，但无法恢复旧映射未记录的 SIMPLE/SLICED 来源。UIView 绑定名称在校验和生成属性名之前必须先剥离九宫格标记，因此 `$node_`、`$btn_`、`$txt_`、`$sp_` 后可以安全附加该视觉元数据。

## 5. Component Set 与 Button

以下任一条件成立时识别为 Button：

- Component Set 名为 `Button/...`；
- Component Set 名以 `btn_` 开头；
- Instance 名以 `btn_` 开头。

只有属性名恰为 `State`（大小写不敏感）的 Variant 才映射交互状态：

| Figma State | Cocos Button 状态 |
|---|---|
| Default / Normal | Normal |
| Hover | Hover |
| Pressed / Down | Pressed |
| Disabled | Disabled |

`Size`、`Theme`、`Icon` 等其他属性组成不同的 Component Prefab 族，不会被误当成 Button 状态。缺少 Hover、Pressed、Disabled 时显式回退 Normal；缺少或重复 Normal 是阻断错误。

Transition 判定：

- 只有目标 SpriteFrame 不同：`SPRITE`；
- 只有目标 Sprite 颜色不同：`COLOR`；
- 只有根节点等比缩放不同：`SCALE`；
- 多个节点或多类属性同时变化：Normal 视觉 + `NONE`，并警告。

Transition target 优先根 Sprite，否则选择唯一名为 `bg` 或 `background` 的子 Sprite。无法唯一确定时不猜测。

### 5.1 UIView 绑定契约

所有 `UI_Name` Frame 都执行以下运行时绑定检查：

| Figma 节点名 | Cocos 类型 |
|---|---|
| `$node_*` | `Node` |
| `$btn_*` | `Button` |
| `$txt_*` | `Label` |
| `$sp_*` | `Sprite` |
| `$list_*` | 外层逻辑 Prefab mounted `ListExtent` |

顶层 Frame 必须匹配 `UI_[A-Za-z0-9_]+`，尺寸可由项目自由定义并直接成为视觉 Prefab 尺寸，但不能再包含直接子节点 `root`。重复属性、前缀和生成组件不匹配、未知 `$` 前缀，以及 `$layout_/$progress_/$edit_/$slider_/$spine_/$ctrl_` 都是 blocker。

映射按 Figma node ID 保存属性名、`root/...` 路径和组件类型。删除、改名、换类型或移动现有绑定会要求用户在当前 `planId` 上显式确认；新增绑定只提示。DoomUI 不生成 `UIBindings` 或业务类，也不集成业务代码生成工具。

`$list_*` 可位于 UI Frame 任意深度，只保存稳定 node/file ID、`root/...` 路径和 `ListExtent` 绑定类型。程序员在外层 View 逻辑 Prefab 的嵌套视觉实例上创建 `view/content`、挂载 `ScrollView` 与 `ListExtent`，再自行设置 `tmpPrefab`；这些 mounted children/components 保存于外层逻辑 Prefab，不进入 DoomUI 持续覆盖的视觉 Prefab。

首次 Item 路径不存在时，Apply 在同一事务内先生成 Item 视觉 Prefab，再创建一次逻辑壳。已有 Item 逻辑 Prefab 归程序员所有且不会被覆盖；视觉 Prefab 已存在时，Preview 会验证逻辑壳是否直接实例化它并命名为 `root`。若视觉 Prefab 在本次 Apply 中首次生成，Apply 会在写入视觉层后立即做同样校验，失败时整笔事务回滚。`$list_*` 缺少 `ListExtent` 只警告，不阻断视觉同步；DoomUI 不校验 `tmpPrefab` 指向哪个 Item。旧 `$item_template` 已弃用，发现时会从 UI 运行时树剔除并提示设计师删除，不能再用于建立关联。

## 6. 本机协议与资源传输

Community 发布版与开发版都只允许访问 `http://localhost:38638`，并在 manifest 声明本机设计同步用途。Community 不启用私有 Plugin API，结构继续由公开 `exportAsync({ format: 'JSON_REST_V1' })` 提供。私有 `figma.fileKey` 不可用时，沿用既有 plugin-data key 的 `local-` 标识；此时不生成 `normalizedUrl`。切换自使用云文件 key 的开发版时，应显式核对项目映射，不自动迁移或覆盖现有资源。

伴生插件先上传 `JSON_REST_V1` 结构，Cocos 返回真正需要更新的 raster/image-fill 清单，Figma 再以二进制方式上传这些资源；未变化且本地仍存在的贴图不会重复导出。这里的格式名不代表网络 REST 调用，DoomUI 不持有 PAT，也不消耗 Figma REST API 额度。

本机服务使用八位配对码换取随机会话令牌；令牌保存在 Figma `clientStorage`，服务重载后失效。服务只绑定回环地址，限制 JSON 和单资源体积，接收完成后只生成 Preview，不自动 Apply。

## 7. 实施与验收状态

本文只维护稳定的产品边界和实现规则，不重复记录会随运行环境变化的完成清单。自动化、Cocos 运行态、Figma 运行态、真实设计端到端证据和剩余未验证项统一维护在[验收记录](acceptance.md)中。

## 8. 参考

- [Figma Plugin exportAsync](https://developers.figma.com/docs/plugins/api/properties/nodes-exportasync/)
- [Figma Plugin Network Requests](https://developers.figma.com/docs/plugins/making-network-requests/)
- [Cocos Creator 3.8 Scene Script](https://docs.cocos.com/creator/3.8/manual/en/editor/extension/scene-script)
- [Cocos Creator 3.8 Profile](https://docs.cocos.com/creator/3.8/manual/zh/editor/extension/profile)
- [Cocos Creator 3.8 Button API](https://docs.cocos.com/creator/3.8/api/zh/class/Button)
