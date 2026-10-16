# Figma UI 制作规范

这份规范面向需要被 DoomUI 同步到 Cocos Creator 3.8.6 的设计文件。遵循规范可以保留更多语义，并减少整块栅格化和 Button 状态降级。

## Frame 与容器

- Desktop Push 支持手动单选或多选 `FRAME` / Page 直属 `COMPONENT`；只同步明确选择的目标。
- UI 容器优先使用 Frame；`GROUP` 可以导入，但会产生“改用 Frame”的警告。
- `SECTION` 和 `SLICE` 不生成运行时节点。
- Auto Layout 只在受限线性子集中生成 Cocos `Layout`：横向或纵向、No wrap、主轴起点对齐、交叉轴居中且两侧 Padding 相等、交叉轴 Fixed、直接子节点 Auto positioning + Fixed sizing 且不旋转。
- 主轴 Fixed 映射 `Layout.ResizeMode.NONE`；主轴 Hug 映射 `Layout.ResizeMode.CONTAINER`。Padding 和 Item spacing 保留。
- Grid、Wrap、Space between、Reverse z-index、反向排列、Fill、绝对定位子节点和其他超出子集的设置不会生成 `Layout`；Preview 会显示 `AUTO_LAYOUT_BAKED`，并保留 Figma 计算后的最终绝对位置。
- 受支持 Auto Layout 的直接子节点由 `Layout` 管理位置，不再生成定位 `Widget`；其他普通容器仍按 Figma Constraints 映射 `Widget`。

### 从现有 Cocos Prefab 开始

- 在 Cocos 中打开任意 `db://assets/**/*.prefab` 后，进入“创建 Figma 起点”会从当前 Prefab 编辑上下文自动填入完整 URL，不要求资源管理器同步改变选择；非 Prefab 编辑模式才使用资源管理器单选作为后备。多选、无效资源或非 Prefab 不会覆盖已经手填的路径。源目录不再承担类型判定。
- 准备导入前显式选择“UI Frame”或“Item Component”。一次性导入会在指定 Page 分别新建顶层 Frame 或 Page 直属 Component，并尽量保留节点名、层级、位置、尺寸、文字样式/描边/单阴影、Sprite 图片与 alpha、受限 Widget Constraints 和 Button 标记。源 Prefab 只读且保持原路径；后续 Push 仍输出到 DoomUI 标准 View / Item 双 Prefab 路径。
- Figma 没有与 Cocos `Node.scale` 等价的独立持久属性。一次性导入会把从 Prefab 根到当前节点的累计缩放递归烘焙到子树位置、尺寸、文字和 Layout 数值中。例如根节点为 `scale=0.8` 时，内部 `120×120, scale=1` 的按钮在 Figma 中应为 `96×96`；后续回传以 `scale=1` 的等价视觉几何为准，不保留原 Prefab 的 WH/Scale 数值组合。文字非等比缩放在 Figma 中无法无损表达，导入时会显式警告。
- Cocos 不支持或无法无损表达为 Figma 的组件会在导入会话中给出警告；物理组件、ProgressBar 和业务脚本按组件类型聚合并列出节点路径，避免同类组件逐节点刷屏。导入结果是设计起点，不等于像素级验收完成。
- 启用的 Cocos 横向/纵向 `cc.Layout` 只有在使用正向排列、交叉轴居中、`NONE/CONTAINER`、固定且无缩放旋转的直接子节点时才创建 Figma Auto Layout。禁用或 `Type.NONE` 的 Layout 静默忽略；其他 Layout 保留当前坐标并警告。
- 启用的 `cc.Widget` 只有在 target 为直接父节点，且使用绝对单边、绝对中心、同为绝对值的双边拉伸或同为百分比的双边缩放时映射为 Figma Constraints。混合单位、单边百分比、百分比中心或跨层 target 保留当前坐标并警告。
- 接管映射会区分“源节点确实映射了 Widget”和“Figma 自动提供的默认 Left/Top Constraints”。源 Cocos 节点没有可映射 Widget 时，未改变的默认 Left/Top 不会在回传时凭空生成 `cc.Widget`；设计师改成 Center、Right、Bottom、Stretch 或 Scale 后，才按新的明确约束生成 Widget。
- Cocos Button 首次导入只保留按钮节点身份；现有 SCALE/COLOR/SPRITE transition、点击事件、禁用状态和非自身 target 不会自动生成 Figma Variant。插件会明确列出这些差异，交互仍由 Cocos 逻辑维护。
- 不要删除再重建所有已导入节点；保留节点可让后续 Push 复用原 Cocos file ID。新增 Figma 节点会获得新的稳定 file ID。若删除原设计根、清理失效映射后重新导入同一 Prefab，新 Figma node ID 会继续按原 Cocos file ID 与旧节点匹配。
- 同一个 Cocos Prefab UUID 不能重复导入。若确实删除了原导入 Frame / Component，需在原 Figma 文件的 Cocos Sync 中确认并清理失效映射，之后才能重新准备导入；Item Component 移出 Page 直属层级也会被视为失效。
- 导入后按本规范把复用结构整理为 Component/Instance，把 Button 状态整理为 Component Set/Variant，并保持 `$btn_*`、`$txt_*` 等业务绑定名。
- 完成接管后只从 Figma 推送到新的 DoomUI 目标；不要尝试把两边修改自动合并。
- 若源 Prefab 使用 `common` 等公共 Asset Bundle，在 Cocos 的 Figma Sync“Desktop 连接”下方公共面板中，把真实 Bundle 根目录逐行加入“共享纹理 Bundle 根目录”，例如 `db://assets/subpackages/common`。该面板在三个顶层工作流中始终可用；一次性重新导入会自动记录每个 Figma 图片与原 SpriteFrame 的关系，不需要逐图指定。
- 若已删除 DoomUI 的本地生成内容，但 Figma Frame 仍存在，不要把已删除的逻辑 Prefab 再作为“创建 Figma 起点”的源文件；应切换到“同步到 Cocos”，由 Cocos Sync 推送原 Frame，Preview 会按全新重建处理，Apply 后重新生成输出。只有源 Prefab 本身仍真实存在时，才使用“创建 Figma 起点”。

### 使用 Cocos 通用素材而不接管 Prefab

- 在 Cocos 的 Figma Sync“共享素材”页签中配置真实的共享纹理 Asset Bundle 根目录，然后在资源管理器中单选或多选图片并点击“准备共享素材”。选择中只要有一项不在白名单 Bundle、没有明确 SpriteFrame 或尚未导入，整批都不会建立会话。
- 在 Figma 的 Cocos Sync“共享素材”页签点击“导入到 Shared Assets Catalog”。当前文件尚无 Catalog 时，插件在当前 Page 新建 `DoomUI Shared Assets` Frame；已有 Catalog 时无论它位于哪个 Page 都复用，不要求建立专用 Page。全文件只能保留一个带插件标记的 Catalog Frame。
- Catalog 中每张图是一个 Component。Frame/Component 名称只用于阅读，可以改名；身份不依赖名称，而由插件标记、Figma fileKey/node ID/imageRef 和 Cocos SpriteFrame UUID/hash/inset 共同确定。不要复制整个 Catalog Frame 来分类；需要整理时移动唯一 Frame，或在其内部调整 Component 顺序。
- 设计新界面时，从 Catalog 拖出 Instance，或复制带相同 IMAGE fill 的节点。日常 Push 只处理明确选择的 UI Frame / Item Component，Catalog 自身不需要随界面一起选择。
- 再次从 Cocos 选择素材并导入会增量创建或更新 Catalog Component，不删除未选择的旧条目。若人为留下多个带标记 Catalog，插件会阻断并要求人工合并，不会按 Frame 名猜一个继续写入。

### 坐标、文字对齐与 Constraints

Figma 与 Cocos 使用不同的坐标基准，界面中名称相近的设置也承担不同职责：

| Figma 设置 | Cocos 对应 | 同步语义 |
|---|---|---|
| Position 区域的 Alignment 按钮 | 最终 `Node.position` | 只是 Figma 编辑器执行一次对齐并改写 `x/y`，不是可持续同步的约束 |
| Typography 的横向/纵向 Alignment | `cc.Label` 的 horizontal/vertical alignment | 文字在固定文本框内的排版；与节点位置、Constraints 无关 |
| Constraints | 普通容器子节点上的 `cc.Widget` | 表达父容器尺寸变化时的位置或缩放规则；只在支持子集内双向转换 |
| Auto Layout | `cc.Layout` | 表达容器对子节点的排列；受支持的直接子节点不再额外生成定位 Widget |

Figma 的节点坐标以父节点左上角为原点，X 向右、Y 向下；它没有 Cocos `UITransform.anchorPoint` 的等价持久属性。DoomUI 统一把生成节点锚点设为 `(0.5, 0.5)`，并在同步时把 Figma 左上角坐标换算成 Cocos 中心坐标、反转 Y 轴；Cocos → Figma 使用逆变换。因此同一个节点在两端显示的 `x/y` 数值通常不同，只要尺寸、父节点尺寸和锚点参与换算后相互可逆，就是正确结果。不要通过 Position Alignment 按钮追求两端显示相同的数值。

Figma → Cocos 的标准 Constraints 映射如下；横向和纵向分别计算后合并到同一个 Widget：

| Figma Constraints | Cocos Widget |
|---|---|
| Left / Top | 绝对左边距 / 上边距 |
| Right / Bottom | 绝对右边距 / 下边距 |
| Left and right / Top and bottom | 两侧绝对边距，随父节点拉伸 |
| Center | 绝对 `horizontalCenter` / `verticalCenter` |
| Scale | 两侧百分比边距，随父节点按比例变化 |

Cocos → Figma 只转换能够无歧义表达的 Widget：target 必须是直接父节点；单边和中心必须是绝对值；双边必须同为绝对值或同为百分比。跨层 target、中心与边同时启用、混合单位、单边百分比、百分比中心以及 `alignMode` 的运行时差异都不会伪造为 Constraints，而是保留导入时的绝对视觉位置并给出警告。禁用 Widget 也不会成为 Figma 中可持续保存的约束状态。

一次性接管会记录约束是否确实来自源 Widget。若源节点没有可映射 Widget，Figma 自动附带且未改变的 Left/Top 是隐式默认值，回传时不会凭空创建 Widget。由于 Figma 不保存“用户是否点过默认值”的历史，这种节点无法仅靠仍为 Left/Top 的最终状态声明一个新的 Left/Top Widget；需要改用 Center、Right、Bottom、Stretch 或 Scale 等非默认 Constraints，或由程序员在逻辑 Prefab 的实例层挂载所需组件。

检查文字时应展开 Typography，而不是看 Position 区域的对齐图标。以水平居中、垂直底部的 Cocos Label 为例，导入 Figma 后 Typography 应显示 Center / Bottom；节点本身仍按左上角坐标显示 Position，这是两套独立属性。

### 标准 UI Frame

所有同步 Frame 都使用统一 Prefab 和 UIView 绑定规范：

- 顶层名必须是 `UI_Name`；尺寸由当前设计决定，Figma Frame 多大，视觉 Prefab 就多大。
- 顶层 Frame 本身会成为逻辑 Prefab 的视觉子节点 `root`；不要在 Frame 内再创建直接子节点 `root`。
- `mask`、`block`、`isFull`、打开动画和动态列表由业务代码处理，不放进 Figma 命名协议。
- 基础绑定使用 `$node_*`、`$btn_*`、`$txt_*`、`$sp_*`、`$list_*`，同一个 Frame 内属性名必须唯一。
- `$txt_*` 必须能保留为 Label，`$sp_*` 必须能生成 Sprite，`$btn_*` 必须能生成 Button；富文本或复杂效果导致类型降级时 Preview 会阻断。
- `$layout_`、`$progress_`、`$edit_`、`$slider_`、`$spine_`、`$ctrl_` 暂不支持。使用 `$node_*` 作为视觉槽位，再由 UIView 业务代码创建或控制动态内容。

绑定删除、改名、换类型或移动层级会被视为破坏性变更，需要在 Apply 前明确确认，并同步修改手写的业务绑定代码。业务代码生成工具由使用方自行维护。

Preview 生成的是 Cocos 端 10 分钟有效的短期 Apply 计划，并不表示 Figma 文件会过期。计划失效后，应在 Figma Desktop 的 Cocos Sync 中重新推送所选内容。新的 Preview、取消或插件重载都会替换旧计划。

若用户已把该 Frame 过去生成的全部 Cocos 输出清空，但项目 Profile 仍有旧映射，下一次 Preview 会明确显示“按全新重建”。Preview 不写 Profile；Apply 成功后才替换旧映射。变更详情中的 `ORPHAN / 解除管理` 只表示资源不再由当前 Frame 持有，Apply 不会自动删除磁盘文件。

若 Figma Frame / Component 已永久删除且不准备重新导入，应在 Cocos 的“孤儿资源维护 → 同步目标映射”中选择对应目标并执行“退役”。退役会移除该目标的同步身份，并把不再被其他目标拥有的标准生成贴图和视觉 Prefab 加入待清理列表；它不会删除逻辑 Prefab、共享素材或任何文件。随后检查完整候选路径，勾选永久删除确认并执行“清理孤儿资源”。旧版本遗留文件可先点“扫描旧输出”。插件会阻止删除非插件路径、重新被管理或仍被其他工程资源引用的文件。

如果只是删除后准备重新导入同一个源 Prefab，继续使用 Figma Cocos Sync 的“清理失效映射 → 重新导入”流程；同类型 View / Item 会把旧同步映射和资产所有权迁移到新的 node ID，避免累积同名重复映射。不要用“退役”代替节点重建流程。

## Component 与 Instance

- 需要生成 Item Prefab 的视觉结构创建为 Page 的直属 Figma `COMPONENT`；推荐集中放在 `Items` Page，不要包在额外 Frame 或 Section 内。
- 同一 Asset Bundle 内 Component 名必须唯一；每个 Component 生成 `prefabs/item/<Component>.prefab` 和 `prefabs/item/figma/<Component>.root.prefab`。
- 既有 Item 可直接从 `prefabs/item/<Item>.prefab` 创建 Figma 起点。导入只新建 Component 和身份映射，不修改源文件；先备份或迁移其中程序员维护的脚本、事件和组件，确认视觉正确后，在第一次 Item Push / Apply 前人工删除旧 Item 逻辑与视觉 Prefab，由 Apply 按标准双 Prefab 重新创建并重新挂载程序逻辑。不要让旧业务 Prefab 与插件首次生成发生路径碰撞。
- UI Frame 不需要放置 Item Instance 来声明关联。本地 `INSTANCE` 若确实作为 UI 的静态视觉内容使用，会尽量嵌套对应视觉 Prefab并保留可表达 override。
- 无法取得主组件定义的远程 Instance 会展开当前可见树并警告，不伪造 Prefab 引用。
- `COMPONENT_SET` 只组织 Variant，不直接生成 Cocos 运行时节点。

## List 与 Item Prefab

`$list_*` 可以位于 UI Frame 的任意视觉深度。它表示一个需要在逻辑 Prefab 中挂载 `ListExtent` 的节点，不表示 DoomUI 会把 `ScrollView`、content、事件或业务参数写入视觉 Prefab。

```text
Page: UI
└── Frame: UI_Role
    └── $node_panel
        └── $list_HeadScrollView

Page: Items
└── Component: item_RoleHead
```

- `UI_Role` 与 `item_RoleHead` 在 Figma 中没有运行时关联；Component 本身就是独立 Item 导出目标。
- Item Component 不需要被挂到某个 UI Frame。日常 Push 可以单独选择 Component，也可以与一个或多个 Frame 一起多选；只有明确选择的 Component 才生成或更新 Item Prefab，并按接管映射恢复 Cocos 身份。
- Item Component `item_RoleHead` 的视觉层生成到 `prefabs/item/figma/item_RoleHead.root.prefab`；逻辑壳首次生成到 `prefabs/item/item_RoleHead.prefab`。
- Item 逻辑壳与 UI 逻辑壳使用相同所有权分层：外层归程序员，唯一直接视觉子节点名为 `root` 并实例化对应 `.root.prefab`。Item 外层不自动添加 View 的四边 Widget。
- `ListExtent.tmpPrefab` 必须引用 `item_RoleHead.prefab` 逻辑壳，不能直接引用 `item_RoleHead.root.prefab`。Item 业务脚本挂在逻辑壳，DoomUI 后续只更新视觉 `.root.prefab`。
- 程序员在 `UI_Role.prefab` 的 `root/.../$list_HeadScrollView` 实例节点下创建 `view/content`，挂载 `ScrollView` 与 `ListExtent`，再把 `tmpPrefab` 指向合适的 Item 逻辑 Prefab。DoomUI 不推断或保存这条关系。
- 缺少 `ListExtent` 时 Preview 只警告；Item 逻辑壳引用错误视觉 Prefab 时阻断，若视觉 Prefab 在本次 Apply 才首次生成，则写入后立即校验并在失败时回滚。DoomUI 不校验 `tmpPrefab` 的 Item 选择。
- `$item_template` 已弃用。旧设计中的该节点会被导出器剔除并提示删除，不再建立关联。若只为设计预览列表效果，应使用明确的设计稿样例区，不要把样例放入运行时 UI Frame。

## Component Set 的创建

先创建多个独立 Component，分别表示需要的组合，然后在 Figma 中全部选中并执行 **Combine as variants**。这会生成 Component Set；不是在一个 Component 内继续嵌套创建 Component。

属性建议：

```text
State = Default | Hover | Pressed | Disabled
Size  = Small | Medium | Large
Theme = Primary | Secondary
Icon  = None | Leading
```

只有名为 `State` 的属性用于交互状态。`Size`、`Theme`、`Icon` 等属性定义不同视觉 Prefab 组合，不会被当成 Cocos Button 状态。

## Button 识别与四态

满足任一规则会识别为 Button（允许相同规则前带 `$`）：

- Component Set 名以 `Button/` 开头；
- Component Set 名以 `btn_` 开头；
- Instance 名以 `btn_` 开头。

状态映射：

| Figma `State` | Cocos Button |
|---|---|
| `Default` / `Normal` | Normal |
| `Hover` | Hover |
| `Pressed` / `Down` | Pressed |
| `Disabled` | Disabled |

- 必须且只能有一个 Normal/Default；缺失或重复会阻断同步。
- Hover、Pressed、Disabled 缺失时显式回退到 Normal。
- Button 实例建议命名为 `btn_login`、`btn_close`。
- 状态目标背景建议使用根 Sprite；否则使用唯一名为 `bg` 或 `background` 的子 Sprite。

Variant 并不是“每个 Component 自动对应 Button 的每个状态”。只有 `State` 这一维按上述固定值映射状态；其他属性仍是组件外观组合。

## Button Transition 限制

- 只有目标图片不同：生成 `SPRITE` transition。
- 只有目标颜色不同：生成 `COLOR` transition。
- 只有根节点等比缩放不同：生成 `SCALE` transition。
- 多个子节点或多类属性同时变化：导入 Default 视觉，设置 `Transition.NONE` 并警告。

若同步 Frame 的导出子树不包含 Component Set 的其他状态定义，插件不会发起额外外部查询，而是降级并提示 `BUTTON_VARIANTS_UNAVAILABLE`。

## 文字与字体

- 单一文字样式映射为 Cocos `Label`。
- Figma Text 的一个可见 SOLID stroke 和正数 `strokeWeight` 映射为 Cocos Label 描边；一次性 Cocos → Figma 导入同时识别 `Label.enableOutline` 和旧 `cc.LabelOutline`，写回同样的 Text stroke/宽度。
- 粗体、斜体、下划线、换行/单行截断，以及一个普通 DROP_SHADOW 可双向映射。阴影保留颜色、偏移和 blur，但不同渲染器仍可能存在像素差异。
- Figma Auto width/height、Auto height 和 fixed box 分别映射为 `NONE`、`RESIZE_HEIGHT`、`CLAMP`。Cocos `SHRINK` 导入 Figma 时保留固定文本框并警告，回传时降级为 `CLAMP`。
- 从 Cocos 接管的 Text 默认保持源 `UITransform` 文本框尺寸，不使用 Figma 字体度量自动收缩。接管映射同时记录初次 Figma 尺寸、源尺寸和 overflow/wrap；节点仍处于初次尺寸时回传恢复源文本框和中心坐标，设计师明确改过文本框尺寸后则以 Figma 为准。这样可避免同一段文字因两端字体度量差异发生半宽/半高的位置漂移。
- Figma 与 Cocos 的描边渲染算法并非逐像素相同；多重描边、渐变描边或其他复杂效果不进入 Label 语义映射。
- 富文本、渐变文字或 Cocos 无法表达的文字效果会栅格化。
- 字体必须在 Cocos 面板显式配置：`Figma family/style = db://assets/...ttf|otf`。
- 未匹配字体使用系统字体预览并产生警告；插件不会猜文件名。

示例：

```text
Inter/Regular = db://assets/fonts/Inter-Regular.ttf
Source Han Sans SC/Bold = db://assets/fonts/SourceHanSansSC-Bold.otf
```

## 图片、矢量与九宫格

- 图片去重不要求先做成 Figma Component。Figma 相同图片内容会拥有相同 image hash；只要 Cocos 导入设置兼容，插件会在同一 Asset Bundle 的 `textures/figma` 中生成一个文件并让所有 Frame 共享同一 SpriteFrame UUID。
- 对从 Cocos 一次性接管或 Shared Assets Catalog 导入的图片，Preview 会先尝试显示 `REUSE`。节点改名不影响复用；在同一 Figma 文件中复制已接管节点、Catalog Instance、Component 或图片 Fill，也会通过相同 imageRef 找回原始图片身份。它必须同时确认：imageRef 命中当前节点、同文件接管资产索引或当前文件 Catalog 映射，源路径位于显式配置且 `isBundle=true` 的共享 Asset Bundle 根、原图片 UUID与规范化 PNG 内容哈希未漂移、精确 SpriteFrame UUID 仍存在、当前九宫格边距兼容。`db://assets/subpackages/common` 与内置的 `db://assets/resources` 使用同一套项目共享机制，均须把实际 Bundle 根加入公共“共享纹理 Bundle 根目录”面板；不会仅凭名称、目录或像素相似度自动共享。同一 imageRef 若仍对应多个不同的有效 SpriteFrame，则因来源不唯一而安全降级。
- `REUSE` 通过后，Preview 不请求上传该图片，Apply 直接引用原 SpriteFrame UUID；共享资源是外部只读依赖，不写入目标 Bundle、不进入 DoomUI 的 `ownedAssets`，也不参与孤儿清理。Apply 会再次检查共享资源，防止 Preview 后源图、Meta 或白名单发生变化。
- Figma 中替换图片、修改九宫格标记，或 Cocos 公共图片/SpriteFrame 发生漂移时会警告并回退为目标 Bundle 的 `textures/figma` 生成资源。插件不会按文件名、路径末段或像素相似度猜测关联；旧接管映射没有精确图片身份时也必须重新接管，不能自动复用。
- Component 用于复用结构、布局和统一更新；只有希望 Cocos 也复用一个 Component Prefab 时，才需要把整块视觉定义成 Figma Component/Instance。
- 单一 IMAGE fill、`FIT`、无 transform/effect/stroke 的节点会直接复用原图。带有效 `@9slice{...}` 标记的 `FILL` 也会把原图作为九宫格源图复用，这是 Cocos `SLICED` Sprite 一次性导入后的标准往返形式；Figma 为标准 `FILL` 自动附带的 image transform 只影响设计端预览，不覆盖 `@9slice` 的 Cocos 语义。普通 `FILL`、`CROP`、`TILE`、裁剪与特效在独立纯视觉节点上按渲染结果生成 PNG；若它们直接作为含文字或交互子节点的容器背景，Preview 会阻断并要求改为 `FIT`、补全 `@9slice` 或拆出独立背景节点，不能静默丢弃背景。
- 一次性导入时，只有拥有真实 SpriteFrame 图片的 `SLICED` Sprite 会生成九宫格标记。SpriteFrame 为空的 `$sp_` 运行时槽位在 Figma 中使用全透明 SOLID fill 作为可编辑占位；该占位未改动时，回传仍创建 `cc.Sprite` 但保持 `spriteFrame = null`，恢复接管时的 Sprite RGBA 与 SIMPLE/SLICED 类型，不会在目标 Bundle 生成 `__solid_white.png`。若设计师把占位改为可见纯色，则按普通视觉填充生成贴图。UIView 绑定校验会忽略节点名末尾的九宫格标记。
- 一次性导入会把 Sprite alpha 写入 Figma Image fill opacity。若源图片本身是全不透明纯白图，则在 Figma 中改成可编辑 SOLID fill 并直接使用 Sprite RGBA；这只是设计端表达，接管映射仍保留原图片与 SpriteFrame 身份。回传时，来自已接管节点的 SOLID 会在白名单、UUID、内容与 SpriteFrame 校验通过后恢复原 SpriteFrame，例如 `db://assets/resources/textures/singleColor.png`，不会生成 `__solid_white`；同画面里没有接管来源的设计师原生 SOLID 仍生成项目贴图。其他图片的非白 RGB 染色无法由 Figma Image fill 无损表示，会保留图片和 alpha 并警告。
- `db://internal/default_ui/...` 不要求加入项目共享根。接管时读取真实像素供 Figma 显示，并记录 Creator 版本；回传只有在当前 Creator 版本、图片 UUID/内容、SpriteFrame UUID 与九宫格都仍完全一致时才直接引用该内置 SpriteFrame。任一项变化都会降级为目标 Bundle 的生成贴图，以避免跨引擎版本依赖不稳定的 internal 身份。
- Cocos `TILED`、`FILLED` 和 grayscale Sprite 当前只导入普通图片外观/原图颜色，并明确警告；它们不属于首阶段可逆语义。
- 矢量、Boolean、Ellipse、复杂描边、裁剪和特效通常栅格化为 PNG。
- Mask 或 `clipsContent` 容器只有纯视觉子节点时，插件会把该非交互子树整体栅格化，不生成 Cocos `Mask`。
- 遮罩容器内存在文字、Button 或其他语义节点时，插件会保留这些节点，但跳过遮罩效果并警告。需要视觉完全一致时，应把被裁剪的纯视觉内容隔离到独立 Frame，把文字和交互节点放在其外部。
- 需要九宫格时在节点名中使用完整语法：

```text
panel @9slice{l:12,r:12,t:12,b:12}
```

四个参数必须完整、不得留空、非负，且不能超过节点尺寸或真实图片像素范围；否则按普通 Sprite 导入并警告。`t:` 这类空值会报告 `NINE_SLICE_INVALID`，不会被解释成 `0`。同一图片可以同时供普通 Sprite 和一种九宫格 Sprite 使用：资源只保存一份边距，普通 Sprite 会忽略它。只有同一图片出现两套不同的非空九宫格边距时 Preview 才会阻断；此时应统一边距或使用真正不同的源图。

## 当前不支持专用映射

Toggle、ScrollView、ProgressBar、Mask、RichText 和自定义状态脚本在第一版没有专用组件映射。设计仍可通过普通容器、Sprite、Label 或上述条件栅格化进入 Cocos，但业务组件需由程序员挂在逻辑 Prefab。
