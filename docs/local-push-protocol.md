# Cocos Sync 本机协议

## 协议身份

- 当前协议版本：`12`
- 服务标识：`cocos-sync`
- Cocos 监听：`127.0.0.1:38638`
- Figma 请求基址：`http://localhost:38638`
- 传输范围：同一台电脑上的 Figma Desktop 与 Cocos Creator

`localhost` 用于满足 Figma 开发插件的网络白名单；Cocos 服务器仍只绑定 IPv4 回环地址，不对局域网或公网监听。

协议产品名统一为 **Cocos Sync 本机协议**。Figma → Cocos Push 只是协议内的日常同步操作；同一协议还承载配对、连接确认、一次性 Cocos Prefab → Figma 接管和 Shared Assets Catalog 更新，因此不把整套协议称为 “Cocos Push 协议”。

## 配对与认证

1. Cocos 启动扩展时生成八位十六进制配对码，面板显示“等待配对”。
2. Figma 先调用 `GET /v1/protocol`，确认协议版本和服务标识完全一致。
3. 用户把配对码输入 Figma 插件；Figma 通过 `POST /v1/pair` 同时提交配对码和自己的协议版本。
4. Cocos 校验版本与配对码后返回随机会话 token，并立即轮换配对码。此时 token 尚未确认，Cocos 仍显示“等待配对”。
5. Figma 保存 token，随后以 `Authorization: Bearer <token>` 发出首次鉴权请求；Cocos 收到后才显示“已配对”。协议不兼容时 Figma 撤销 token；收到 401 时清除本地失效 token。
6. Figma 主动断开时调用 `POST /v1/disconnect`；Cocos 重置配对或扩展卸载/重载时也会清空会话 token。Figma 插件打开期间每 10 秒用一个 single-flight `GET /v1/status` 检查本机会话；短暂网络失败只标记当前不可用并保留 token，供后续检查自动恢复。

协议预检或配对失败不得让 Cocos 进入“已配对”状态。DoomUI 不读取或传递外部 API 凭据；本机会话只使用短期配对码和 token。

## 接口

### `GET /v1/protocol`

无需认证。Figma 在提交配对码之前先确认服务身份和协议版本：

```json
{
  "protocolVersion": 12,
  "service": "cocos-sync"
}
```

旧服务未提供该接口或版本不一致时，Figma 必须停止配对并提示重载 Cocos 端 Figma Sync。

### `POST /v1/pair`

无需认证。

请求：

```json
{
  "code": "A1B2C3D4",
  "protocolVersion": 12
}
```

成功响应：

```json
{
  "protocolVersion": 12,
  "token": "<random-session-token>",
  "endpoint": "http://127.0.0.1:38638"
}
```

配对码错误返回 401；协议版本不一致或缺失返回 409，且不签发 token、不轮换配对码、不改变 Cocos 配对状态。

### `GET /v1/status`

需要 Bearer token。用于验证已保存会话是否仍有效，并一次返回当前 Prefab 接管会话和 Shared Assets Catalog 会话摘要。响应只暴露伴生插件所需的安全字段，不包含 `pairingCode`、token、内部错误或上次 Push 详情。

```json
{
  "protocolVersion": 12,
  "running": true,
  "endpoint": "http://127.0.0.1:38638",
  "activeAdoption": null,
  "activeSharedAssets": null
}
```

存在会话时，`activeAdoption` 与 `activeSharedAssets` 分别使用下文对应的摘要结构。协议 v12 不再提供 `/v1/adoptions/active` 和 `/v1/shared-assets/active`；Figma 的一次定时连接检查因此只产生一个 HTTP 请求。

### `POST /v1/disconnect`

需要 Bearer token。Figma 主动断开时撤销当前 token；Cocos 随即回到“等待配对”。

```json
{
  "protocolVersion": 12,
  "disconnected": true
}
```

### 一次性 Cocos Prefab → Figma

以下接口使用相同 Bearer token，只服务用户在 Cocos 面板显式创建的短期会话。会话只在内存中保留 30 分钟，源 Prefab 不复制、不修改。

#### `GET /v1/status` 的 `activeAdoption`

返回当前会话摘要；没有会话时 `activeAdoption` 为 `null`：

```json
{
  "protocolVersion": 12,
  "activeAdoption": {
    "kind": "view",
    "sessionId": "<random-session-id>",
    "prefabUrl": "db://assets/subpackages/example/prefabs/view/UI_Name.prefab",
    "prefabName": "UI_Name",
    "nodeCount": 42,
    "assetCount": 7,
    "warningCount": 1,
    "nodes": [
      {
        "path": "UI_Name/$btn_close",
        "name": "$btn_close",
        "kind": "frame"
      }
    ],
    "assets": [
      {
        "key": "sprite-frame-0123456789abcdef",
        "sourceUrl": "db://assets/subpackages/example/textures/close.png",
        "sourceImageUuid": "<cocos-image-uuid>",
        "sourceSpriteFrameUuid": "<cocos-sprite-frame-uuid>",
        "contentHash": "<normalized-png-sha256>",
        "sliced": true,
        "insets": { "left": 15, "right": 15, "top": 15, "bottom": 15 },
        "sourceNodeFileIds": ["<source-prefab-file-id>"],
        "mimeType": "image/png",
        "width": 64,
        "height": 64
      }
    ],
    "warnings": [
      "节点 $btn_close 的自定义组件不会导入 Figma"
    ],
    "status": "ready",
    "createdAt": "<ISO timestamp>",
    "expiresAt": "<ISO timestamp>"
  }
}
```

`nodes`、`assets` 和 `warnings` 是可选增强字段，供两端面板展示可折叠明细。摘要只包含节点显示路径、图片来源/尺寸和警告文本，不包含 Prefab 原始序列化内容或图片二进制。

#### `GET /v1/adoptions/bindings?fileKey={fileKey}`

返回当前 Figma 文件中仍有效的一次性接管映射。`kind=view` 要求目标仍为 Frame；`kind=item` 要求目标仍为 Page 直属 Component。Figma 插件只检查当前文件中的节点身份和层级，不跨文件猜测删除状态：

```json
{
  "protocolVersion": 12,
  "bindings": [
    {
      "kind": "view",
      "sourcePrefabUrl": "db://assets/subpackages/example/prefabs/view/UI_Name.prefab",
      "sourcePrefabUuid": "<cocos-prefab-uuid>",
      "fileKey": "<figma-file-key-or-local-id>",
      "fileName": "Design File",
      "nodeId": "2013:35",
      "nodeType": "FRAME",
      "normalizedUrl": "https://www.figma.com/design/...?...",
      "createdAt": "<ISO timestamp>"
    }
  ]
}
```

#### `POST /v1/adoptions/bindings/release`

只有用户在 Cocos Sync 中点击“清理失效映射”，且插件再次确认当前文件内的 `nodeId` 已不存在、类型已改变，或 Item Component 已不再是 Page 直属节点时调用：

```json
{
  "fileKey": "<figma-file-key-or-local-id>",
  "nodeId": "2013:35"
}
```

Cocos 将映射标记为已释放，但不删除或修改任何工程资产。之后允许同一 Prefab UUID 再次创建导入会话；View 新 Frame 完成导入时，原 Frame 已拥有的同步映射和资产所有权会迁移到新 node ID。Item 不迁移 View Frame 的同步映射，因此此处只清理旧接管记录；Item 首次 Push / Apply 后会按 Component node ID 建立自己的目标映射。若原映射属于另一个 Figma 文件，当前文件不得调用释放接口。

#### `GET /v1/adoptions/{sessionId}`

返回可在 Figma 创建的 Prefab 节点树、PNG 资源描述和不支持项警告。节点包含源 Cocos `fileId`；返回体不得包含 Prefab 原始序列化文本、业务脚本内容或凭据。

协议 v3 为节点增加的可选线性布局字段在 v7 中保持不变：

```json
{
  "layout": {
    "direction": "horizontal",
    "resizeMode": "none",
    "paddingLeft": 12,
    "paddingRight": 12,
    "paddingTop": 8,
    "paddingBottom": 8,
    "spacing": 6
  }
}
```

该字段只表示受支持的横向/纵向子集。禁用的 `cc.Layout` 不返回该字段；Grid、反向排列、`ResizeMode.CHILDREN`、非居中或两侧 Padding 不相等的交叉轴、受缩放影响或含非固定直接子节点的布局只返回绝对坐标并进入 `warnings`。

协议 v5 为文字节点增加可选描边字段。Cocos 3.8.6 的 `Label.enableOutline`，以及旧 Prefab 中仍存在的独立 `cc.LabelOutline` 组件，都会导入为 Figma Text 的单色 `strokes` 和 `strokeWeight`：

```json
{
  "text": {
    "characters": "打乱",
    "fontSize": 36,
    "lineHeight": 40,
    "color": { "r": 255, "g": 255, "b": 255, "a": 255 },
    "bold": true,
    "italic": false,
    "underline": false,
    "overflow": "clamp",
    "wrap": false,
    "outline": {
      "color": { "r": 70, "g": 31, "b": 10, "a": 255 },
      "width": 3
    },
    "shadow": {
      "color": { "r": 0, "g": 0, "b": 0, "a": 128 },
      "offsetX": 2,
      "offsetY": -2,
      "blur": 4
    },
    "horizontalAlign": "center",
    "verticalAlign": "center"
  }
}
```

Figma → Cocos 仍只接受单个可见 SOLID stroke 且 `strokeWeight > 0` 的文字描边；其他复杂描边不伪造为 `LabelOutline`。

协议 v6 扩展一次性接管的首阶段可编辑语义：

- 文字增加 `bold`、`italic`、`underline`、`overflow`、`wrap` 和可选 `shadow`。阴影仅支持一个普通 `DROP_SHADOW`，保留颜色、偏移和 blur；Cocos 与 Figma 的 Y 轴方向相反，协议在转换时取反。`SHRINK` 在 Figma 没有等价文本框，导入固定尺寸并警告，回传时降级为 `CLAMP`。
- 节点增加可选 `constraints`，只接受 Figma Plugin API 的 `MIN/CENTER/MAX/STRETCH/SCALE`。Cocos `Widget` 必须启用且 target 为直接父节点；绝对单边、绝对中心、同单位双边才能映射，混合单位、单边百分比和百分比中心保留绝对坐标并警告。
- Sprite 图片 fill 保留 alpha。源图片所有像素均为不透明纯白时，Figma 创建可编辑 SOLID fill 并使用 Sprite RGBA；资源记录同时保存 `solidWhite=true`，因此该 SOLID 回传时仍可恢复原 SpriteFrame，而不是退化为 `__solid_white`。其他图片保留原图和 alpha，非白 RGB 染色不能无损表达时明确警告。
- `RigidBody2D`、`Collider2D`、`ProgressBar` 和业务脚本等运行时组件不进入 Figma，按组件类型聚合为一条迁移提示并列出节点路径。Button transition、事件、非默认 target，以及 TILED/FILLED/grayscale Sprite 均给出局部支持提示，不再静默丢失。

协议 v7 为每个导出的图片资源增加原始图片 UUID、精确 SpriteFrame UUID、规范化 PNG 内容哈希、九宫格参数和使用它的 Prefab file ID。当前兼容结构另带可选 `solidWhite`；`db://internal/default_ui/...` 还带 `sourceCreatorVersion`。Figma 完成导入时必须回传每个资源实际创建的 `imageRef`。这些服务端来源字段只用于后续验证“该 Figma 表达仍来自接管时的 SpriteFrame”，不能据此自动接管任意同名或同路径资源。

#### `GET /v1/adoptions/{sessionId}/assets/{assetKey}`

返回单张经规范化的 `image/png`。资源只能来自当前 Prefab 实际引用的 `db://assets/...` 图片，或受限的 `db://internal/default_ui/...` 图片；其他 internal 资源拒绝导出。

#### `POST /v1/adoptions/{sessionId}/complete`

Figma 新建设计根节点后提交映射。View 使用 `FRAME`，Item 使用 Page 直属 `COMPONENT`：

```json
{
  "fileKey": "<figma-file-key-or-local-id>",
  "fileName": "Design File",
  "nodeId": "2013:35",
  "nodeType": "FRAME",
  "normalizedUrl": "https://www.figma.com/design/...?...",
  "nodes": {
    "2013:35": {
      "cocosFileId": "<source-prefab-file-id>",
      "cocosNodeName": "UI_Name"
    }
  },
  "images": {
    "sprite-frame-0123456789abcdef": "<figma-image-ref>"
  }
}
```

Cocos 校验 kind 对应的 Figma node type、fileKey、node ID、源 file ID、资源 key 和 Figma imageRef 后，把节点与图片来源映射保存到项目 Profile。一个会话只能成功完成一次；同一个 Cocos Prefab UUID 同时只能有一个有效 Figma 节点映射。该映射仅用于后续 Figma → Cocos 同步复用 file ID 和经过验证的共享 SpriteFrame，不开启反向监听。

完成请求只提交 Figma 实际创建的 node ID 与 imageRef，不允许客户端自行声明 Cocos 来源。服务端从仍在内存中的可信源 Prefab 树补充三类接管 provenance：`sourceWidgetMapped` 记录源 Widget 是否成功转成 Constraints；`sourceText` 记录源/初次 Figma 文本框尺寸和 overflow/wrap；`sourceEmptySpriteFrame` 记录空 SpriteFrame 槽位的 Sprite RGBA 与 SIMPLE/SLICED 类型。后续标准化据此抑制源节点不存在 Widget 时的默认 MIN/MIN、恢复未改动 Text 的源文本框与中心坐标，并把未改动的透明占位恢复成 `spriteFrame = null`。这些字段属于 Cocos 项目 Profile 的持久化映射，不是本机 complete 请求的可伪造字段。

### Cocos Shared Assets → Figma Catalog

以下接口使用相同 Bearer token。用户在 Cocos 面板“共享素材”页签中从资源管理器单选或多选图片，单次上限 100 项；服务端先验证每张图片位于已配置且 Meta 标记为 `isBundle=true` 的共享 Bundle 根目录，并拥有明确的 `cc.SpriteFrame` 子资源。会话只保留 30 分钟，准备阶段不写 Cocos `assets` 或 Figma 文件。

#### `GET /v1/status` 的 `activeSharedAssets`

没有会话时 `activeSharedAssets` 为 `null`；否则返回素材数量、来源、尺寸和状态：

```json
{
  "protocolVersion": 12,
  "activeSharedAssets": {
    "sessionId": "<random-session-id>",
    "assetCount": 2,
    "assets": [
      {
        "key": "sprite-frame-0123456789abcdef",
        "sourceUrl": "db://assets/subpackages/common/buttons/confirm.png",
        "sourceImageUuid": "<cocos-image-uuid>",
        "sourceSpriteFrameUuid": "<cocos-sprite-frame-uuid>",
        "contentHash": "<normalized-png-sha256>",
        "sliced": true,
        "insets": { "left": 12, "right": 12, "top": 12, "bottom": 12 },
        "mimeType": "image/png",
        "width": 160,
        "height": 56
      }
    ],
    "status": "ready",
    "createdAt": "<ISO timestamp>",
    "expiresAt": "<ISO timestamp>"
  }
}
```

#### `GET /v1/shared-assets/{sessionId}`

返回完整可信清单，`protocolVersion` 固定为 12。Figma 插件必须先下载和验证全部条目，再修改 Catalog。

#### `GET /v1/shared-assets/{sessionId}/assets/{assetKey}`

返回单张规范化 `image/png`。Catalog 即使遇到全不透明纯白图也保留 IMAGE fill 与实际 imageRef，避免把共享 SpriteFrame 身份退化为设计师原生 SOLID。

#### `POST /v1/shared-assets/{sessionId}/complete`

Figma 更新 Catalog 后回传：

```json
{
  "fileKey": "<figma-file-key-or-local-id>",
  "fileName": "Design File",
  "catalogNodeId": "2013:35",
  "retainedSourceSpriteFrameUuids": ["<cocos-sprite-frame-uuid>"],
  "items": {
    "sprite-frame-0123456789abcdef": {
      "componentNodeId": "2013:36",
      "figmaImageRef": "<figma-image-ref>"
    }
  }
}
```

服务端要求本次会话每个 asset key 恰好映射一个不同 Component，并从可信会话补全 Cocos URL/UUID/hash/inset，客户端不能声明这些来源字段。同一 `fileKey` 只保存一个 Catalog Frame。Figma 以私有插件标记而不是 Frame 名定位 Catalog：首次在执行时的当前 Page 创建，之后即使人工移动到其他 Page 也继续复用；发现多个标记 Catalog 时阻断，不自动合并或删除。`retainedSourceSpriteFrameUuids` 只用于在同一 Catalog node ID 下保留仍存在的旧条目；若 Catalog node ID 改变，服务端丢弃旧 Component 映射，避免继续采信已删除节点。

### `POST /v1/prepare`

需要 Bearer token。发送用户在当前 Page 明确单选或多选的 `FRAME` / Page 直属 `COMPONENT`；每个目标分别由 `JSON_REST_V1` 导出：

```json
{
  "protocolVersion": 12,
  "fileKey": "<figma-file-key-or-local-id>",
  "fileName": "Design File",
  "targets": [
    {
      "kind": "view",
      "normalizedUrl": "https://www.figma.com/design/...?node-id=12-34",
      "document": { "id": "12:34", "name": "UI_Role", "type": "FRAME" }
    },
    {
      "kind": "item",
      "normalizedUrl": "https://www.figma.com/design/...?node-id=56-78",
      "document": { "id": "56:78", "name": "item_RoleHead", "type": "COMPONENT" }
    }
  ],
  "components": {},
  "componentSets": {}
}
```

Cocos 分别标准化每个显式目标，并合并为一个原子 Preview / Apply 批次。未出现在 `targets` 中的 Frame / Component 不读取、不生成，也不会阻断本次同步。`document` 中的 Figma Auto Layout 字段参与受限布局映射；不满足协议子集时 Preview 返回 `AUTO_LAYOUT_BAKED` 警告并保留最终绝对位置：

```json
{
  "preview": {
    "planId": "<content-bound-plan>",
    "fileVersion": "<push-content-version>",
    "changes": [],
    "warnings": [],
    "blockers": [],
    "rebuildFromEmptyOutput": {
      "previousTrackedAssets": 105
    }
  },
  "assetRequests": [
    {
      "key": "<asset-key>",
      "kind": "raster",
      "nodeId": "12:35"
    }
  ],
  "requiresComplete": true
}
```

`rebuildFromEmptyOutput` 是单目标 Preview 的可选字段。只有项目 Profile 仍保留旧目标映射、但该映射记录的逻辑 Prefab、视觉 Prefab、组件 Prefab 与贴图已全部不存在时返回。此时 Preview 保持只读，但使用空基线计算，不把旧节点报告为删除，也不因旧绑定产生破坏性确认；用户 Apply 后才用新结果覆盖旧映射。只缺少部分输出时不得启用该模式，仍按正常漂移规则报告问题。

协议 v9 把一次性接管扩展到标准 Item 逻辑 Prefab，并给接管文档与持久化映射增加 `kind=view|item`。协议 v10 移除 Desktop Push 的隐式 `itemComponents`，改为显式 `targets[]`：

- Cocos 面板允许选择任意现有 `db://assets/**/*.prefab`，并显式指定 `kind=view|item`；Figma 分别创建 Page 直属 Frame 或 Page 直属 Component。源目录不参与类型判定，源 Prefab 始终只读且保持原路径。
- 日常同步支持单选或多选 Frame / Page 直属 Component。Frame 只生成对应 View，Component 只生成对应 Item；未选择的节点不进入计划。
- 多目标共享一个 `planId`，所有图片下载和校验完成后才开始写入；任一目标失败时整个批次回滚，最后一次性提交各目标映射。
- Cocos 以 `fileKey + nodeId` 定位每个目标映射，并将 `kind=view|item` 存入映射、在后续同步时校验；同时仍不推断或传输 `ListExtent.tmpPrefab` 的 List→Item 关系。
- 接管过程不修改源 Item Prefab。用户需先备份或迁移其中程序员维护的脚本、事件和组件；确认 Figma Component 后，在第一次 Figma → Cocos Apply 前人工删除旧 Item 逻辑与视觉 Prefab。首次 Apply 再按统一所有权合同创建 `prefabs/item/<Item>.prefab` 和 `prefabs/item/figma/<Item>.root.prefab`，程序逻辑需重新挂载。服务不自动移动、拆分或覆盖旧业务 Prefab。

协议 v11 增加 Shared Assets Catalog 会话与映射；不改变 v10 的显式 `targets[]` 语义。Catalog 只为当前 Figma fileKey 提供额外共享 SpriteFrame 候选，不会让未选择的 Frame / Component 进入 Push。协议 v12 把连接状态、Prefab 接管摘要和 Shared Assets 摘要合并进一个鉴权后的 `/v1/status`，移除两个独立 active 端点。

Preview 会在 Cocos 内存中生成一个 10 分钟有效的短期 Apply 计划；过期的是该计划，不是 Figma 文件或设计节点。计划失效后，必须回到 Figma Desktop 的 Cocos Sync 重新推送所选内容。插件重载、主动取消或生成新的 Preview 也会让旧计划立即失效。

若本地资源完整，`requiresComplete` 为 `false`，Cocos 直接向面板广播 Preview。

若 IMAGE fill 来自一次性接管或当前 Figma 文件的 Shared Assets Catalog，且当前 imageRef 命中可信映射、原图仍位于用户允许且 AssetDB Meta 标记 `isBundle=true` 的共享 Asset Bundle、源图片 UUID 与规范化 PNG 内容哈希未漂移、精确 SpriteFrame 仍存在、当前九宫格与其 inset 一致，Preview 返回 `REUSE`，路径指向原共享图片。该资源不进入 `assetRequests`，Apply 直接引用原 SpriteFrame UUID，不写文件、不进入 `ownedAssets`、也不会成为 orphan。Apply 在实际写入前重新执行同一组校验；任一验证失败时停止使用陈旧计划，或在 Preview 阶段返回明确 warning 并按普通 Figma 生成贴图处理。整个流程不按文件名、路径末段或像素相似度猜测资源身份。

### `PUT /v1/assets/{planId}/{assetKey}`

需要 Bearer token。Body 是单个资源二进制：

- `kind=image-fill`：Figma `getImageByHash(...).getBytesAsync()` 的原始图片字节。
- `kind=raster`：对应节点按固定 1x `exportAsync({ format: 'PNG', ... })` 的 PNG。

Cocos 按 `planId + assetKey` 接收资源，响应 `{ "received": <bytes> }`。调用方只能上传 `/v1/prepare` 返回的资源键。

### `POST /v1/complete`

需要 Bearer token。

```json
{ "planId": "<content-bound-plan>" }
```

Cocos 验证所有请求资源齐全后完成 Preview，并广播给 Cocos 面板。该接口不执行 Apply。

## 状态码与错误

| 状态 | 含义 |
|---|---|
| 200 | 成功 |
| 204 | CORS OPTIONS 成功 |
| 400 | JSON、planId、协议数据或资源状态无效 |
| 401 | 配对码错误或 Bearer token 无效 |
| 404 | 接口不存在 |
| 409 | 协议版本不兼容，或存在尚未结束的同类短期会话 |
| 413 | JSON 或单资源超过大小上限 |

错误响应统一为 `{ "error": "可显示的错误信息" }`，不得包含 token 或完整内部堆栈。

## 限制与安全边界

- JSON 请求上限：32 MiB。
- 单资源请求上限：32 MiB。
- 允许 `GET, POST, PUT, OPTIONS`，CORS header 只包含 `Authorization, Content-Type`。
- 服务器设置 `Cache-Control: no-store`。
- 当前 CORS `Access-Control-Allow-Origin: *` 是本机开发插件兼容措施，安全边界依赖回环绑定和 Bearer token；如果未来扩大监听范围，必须先改为显式 Origin、重新威胁建模并升级协议。
- 不持久化完整 Push payload；真实设计数据只在进程内用于 Preview/Apply。
- 一次性接管和共享素材会话不写入项目 assets、Fixture、日志或报告；项目 Profile 只保存完成后的来源身份摘要与节点映射。
- 后台只以 10 秒间隔、single-flight 方式轮询本机 `/v1/status`，不轮询设计内容、不自动 Push、不自动 Apply。
- 接管映射的 Figma 节点有效性只在插件启动或配对完成、Prefab 导入完成、用户进入“创建 Figma 起点”、用户确认清理，以及 Figma 文档停止变化 1 秒后检查。由于插件使用 `documentAccess: dynamic-page`，注册 `documentchange` 前只执行一次 `loadAllPagesAsync()`；若宿主拒绝加载或注册，插件降级为其余流程触发检查，不影响连接和同步。文档事件只用于发现已删除/失效的接管节点，不触发同步。
- `figma.getNodeByIdAsync` 不得进入连接轮询。Figma 节点检查失败只报告对应阶段或等待下次事件重试，不得据此撤销仍有效的 Cocos 会话 token。

## 兼容性规则

协议字段、认证、端点或语义发生不兼容变化时：

1. 同时提升 Cocos 与 Figma 两端的 `PROTOCOL_VERSION`。
2. 同步修改两端类型和测试。
3. 更新本文档与验收记录。
4. 对旧版本明确报“不兼容”，禁止静默猜测或降级。
