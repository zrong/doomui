# 验收记录

本文区分自动化、Cocos 运行态、Figma 运行态和真实设计端到端证据。产品规则见[详细设计](figma-to-cocos-prefab-tool-design.md)，可复现操作见[开发指南](development.md)。

## 公开基线

产品版本保持 `26.36.28`。公开仓库从经整理的源码快照建立，不携带早期提交和发布标签；初始化提交不等于新版本发布。

本次整理保留运行时代码、协议、稳定插件身份、兼容 key、测试断言和数值，替换业务案例注释，移除个人路径、真实设计身份、资源 UUID、现场哈希和本机配置。下述既有宿主结论来自开源整理前的验收记录，经过泛化，不能作为本次公开副本已重新完成宿主验收的证明。

## 2026-10-17：Community 发布准备

- 候选版本为 `26.42.29`，由维护者安装的 `git-commit` skill 在保留产品发布标签的仓库上下文生成；公开初始基线仍为 `26.36.28`。
- manifest 为 Community 安装版开放与开发版相同的唯一回环端点，并明确用途；移除私有 Plugin API 开关。插件在私有 `fileKey` getter 不可用时沿用既有本地文件标识，不再为本地标识生成无效云文件链接。
- 增加文件身份与发布网络权限回归。`just check` 通过：28 个测试文件、181 个测试通过，两端类型检查和构建通过。测试中的长文件 key 字面量也替换为明确示例，避免与真实设计身份混淆。
- 发布图标与封面为原创几何图，不含实际设计素材、配对信息或宿主截图。
- 发布账号已完成 2FA 设置；刷新 Desktop 后发布提交成功，Figma 明确确认已收到申请。[Community 页面](https://www.figma.com/community/plugin/1675173114763421112/cocos-sync)已创建第 1 版，目前等待审核且仅作者可见，尚未公开上架。
- 本轮尚未以当前构建完成配对和真实 Push Preview，也未完成 Community 安装版的宿主端到端验收。提交发布不替代这些运行态验证。

## 2026-10-16：公开副本自动化

- `just install` 成功；根级 `just check` 通过，27 个 Vitest 文件、176 个测试通过，两端 TypeScript 构建与 Figma 插件类型检查通过。产品版本仍为 `26.36.28`，Sandbox 宿主版本为 `3.8.6`。
- 38 个运行源码、模板及 manifest 文件与整理前基线逐字节相同；测试改动仅泛化两处注释。
- 公开候选文件经内部名称、个人路径、常见密钥格式和敏感 URL 参数模式扫描，再作定点复核；未发现对应命中。此扫描不等同于完整安全审计。
- 本轮不执行 Cocos Creator / Figma Desktop 运行态验收，也不导入任何真实设计文件。
- 移除 Sandbox 的本机 splash 与服务配置后，Creator 3.8.6 重新打开、生成本机状态以及扩展加载仍需宿主验证；其余最小工程配置保留。

## 依赖审计（2026-10-16）

- 对锁定依赖执行 `npm audit --json`：Figma Sync 共 8 项（2 critical、3 high、3 moderate），Cocos Sync 为 0 项。统计按 npm 报告中的依赖包计数，不能直接等同于可利用漏洞数量。
- `npm audit --omit=dev --json` 确认 Figma Sync 的运行依赖包含 2 项 high：sharp 与 source-map-js；Cocos Sync 运行依赖为 0 项。完整审计另涉及 Vitest、Vite、vite-node、tinypool、@vitest/mocker 与传递 esbuild。
- 例如 [sharp 的 libvips 公告](https://github.com/advisories/GHSA-f88m-g3jw-g9cj)、[source-map-js 公告](https://github.com/advisories/GHSA-68fv-2mgg-jv7q) 与 [Vitest 公告](https://github.com/advisories/GHSA-5xrq-8626-4rwp)。审计使用的版本与上游公告会随时间变化。
- 本次工作保持依赖版本和运行行为，未执行 `npm audit fix` 或跨版本升级；上述依赖问题仍待单独修复与验证。

## 既有自动化覆盖

- 两插件 TypeScript 构建、Figma 插件类型检查、产品版本与 Sandbox 宿主版本一致性。
- 坐标、旋转、Widget、文字对齐、字体回退、布局、九宫格、Button Variant、Component、列表绑定与稳定 file ID。
- Preview 只读、Apply 事务回滚、逻辑 Prefab 所有权、共享资源精确复用、孤儿确认与目标映射退役。
- 回环 Push 的配对、认证、资源上传、安全状态响应和多目标批次；当前日常链路不使用 PAT / REST Pull。
- 一次性 Prefab 接管、共享素材 Catalog、编辑上下文选取与资源选择快照。
- 累计缩放回归保留原数值：根尺寸 `126×155` 乘 `0.8` 为 `100.8×124`；子节点 `120×120` 变为 `96×96`，后代还叠加自身 `0.7` 比例。注释使用通用 Fixture 名称。

## 既有 Cocos 运行态证据

- Creator 3.8.6 曾完成扩展加载、菜单与面板打开，回环服务只监听 `127.0.0.1:38638`。
- Sandbox 离线 Fixture 曾完成 Label、Button、Widget 视觉 Prefab 序列化和 asset-db 导入；再次更新时视觉资产 UUID 保持稳定，逻辑 Prefab 文件哈希不变。
- PNG 转 SpriteFrame 与九宫格边距持久化曾验证通过。
- 合成 Push Fixture 曾完成首次与第二次 Apply、Prefab 实例化与绑定契约检查。这是 Cocos 宿主验证，不是真实 Figma 设计验收。
- 一次性接管的当前 Prefab 编辑上下文优先于资源管理器选择，以及共享素材页保持可见时跟随单选变化，曾单独完成宿主检查。

## 既有 Figma 运行态与真实设计证据

- Figma Desktop 曾通过本机开发 manifest 运行伴生插件，完成配对和真实设计 Push Preview；未变化的输入未写入逻辑或视觉 Prefab。
- 部分真实设计曾完成 Preview / Apply，检查过九宫格和跨接管根共享 SpriteFrame 引用；这些局部证据不覆盖全部后续功能。
- 文字框坐标和 Typography 对齐曾作只读核对；它们不证明后续 Text / Widget 修复已在双宿主重新验收。
- 真实设计响应、映射、生成资产与本机会话凭据均不作为公开 Fixture。

## 剩余外部验收

以下项目仍需在 Creator 3.8.6 与 Figma Desktop 加载当前公开副本后验证：

- 协议 v12 重新配对、安全状态响应、动态页面事件及长时间运行后 callback 错误是否消失。
- 最新面板布局、目标映射退役的二次确认及 Item 重新接管。
- 显式单选 Component、多选 Frame / Component、未选目标不生成以及整批失败回滚。
- 累计父子缩放、文字字号/行高/描边/阴影和 Auto Layout 参数的真实视觉结果；非等比文字警告。
- 接管后 Text 框尺寸、坐标与 Widget 来源恢复；空 SpriteFrame 槽位回传为 `null`。
- Shared Assets Catalog 的当前 Page 首建、跨 Page 唯一复用、增量导入以及真实 Push / Apply 的 `REUSE`。
- 纯白来源图与新建 SOLID 的区分、引擎内置 SpriteFrame 的同版本复用及跨版本降级。
- 二次 Apply 的逻辑 Prefab 哈希、视觉 UUID、匹配节点 file ID 和嵌套 Component 稳定性。
- 由使用方提供最小运行时绑定与打开逻辑，验证按钮回调、列表实例化、真实 Variant 四态、本地 Instance override 和远程组件展开。
- 与真实设计进行不超过 1 px 的视觉对比。

上述外部验收尚未完成，自动检查通过不能替代这些结论。
