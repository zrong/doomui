# Cocos Sync Community 发布资料

## 身份与链接

- 名称：Cocos Sync
- 固定 plugin ID：`1675173114763421112`
- 源码与安装说明：[zrong/doomui](https://github.com/zrong/doomui)
- 支持：[GitHub Issues](https://github.com/zrong/doomui/issues)
- 许可证：MIT
- 当前发布候选版本以根 `VERSION` 为准；Figma 的发布审核状态需在 Desktop / Community 页面单独确认。

## Tagline

Push selected Figma designs to Cocos Creator prefabs.

## Description

Cocos Sync is the Figma Desktop companion plugin for DoomUI, an open-source UI workflow for Cocos Creator 3.8.6.

- Push only the Frames or top-level Components you select.
- Preview changes in Creator before explicitly applying them.
- Keep generated visuals separate from programmer-owned logic prefabs.
- Import an existing Cocos Prefab once to start designing in Figma.
- Reuse shared SpriteFrames through a Shared Assets Catalog.

Requires Figma Desktop and the matching Figma Sync extension running in Cocos Creator on the same computer. Setup: https://github.com/zrong/doomui

Selected design structures and required image bytes are transferred only to the paired local Creator extension at localhost:38638. Cocos Sync has no external analytics or cloud upload service. The connection uses an eight-digit pairing code and a short-lived session token. Pairing information stays in local plugin storage.

Source code and support: https://github.com/zrong/doomui

License: MIT

中文：DoomUI 的 Figma Desktop 伴生插件。手动推送所选 Frame / Page 直属 Component，在 Cocos Creator 中先 Preview，再明确 Apply。支持现有 Prefab 的一次性设计接管与共享素材复用。需要同机运行 Cocos Creator 3.8.6 和 Figma Sync 扩展。

## 图片

- [icon.png](icon.png)：128 × 128 px，原创几何图标。
- [cover.png](cover.png)：1920 × 1080 px，原创工作流示意图，不是真实设计截图。
- 不使用游戏资产、真实设计文件或包含配对信息的截图。

## 数据披露依据

- 插件需要把用户明确选择的设计节点、所需图片及文件映射信息传给同一电脑上的 Cocos Creator 扩展，不能申报为完全不传输数据。
- 只访问 `http://localhost:38638`；不向公网服务器发送设计内容，不包含分析或广告服务。
- 插件在 Figma 文档 plugin-data 保存稳定映射标记，在本机 clientStorage 保存短期连接凭据。
- Cocos 项目 Profile 保存同步映射与设置；Apply 经用户明确执行后才写入插件拥有的视觉资源。
- 不读取账号身份、联系人、支付信息或外部 API 凭据。
- 根据发布表单实际选项填写；账号 2FA 与任何条款接受步骤由账号持有人处理。

## 发布前检查

1. 确认发布的 manifest 来自当前公开仓库，固定 ID 不变；公开和开发网络白名单均只有本机端点。
2. 运行 `just check`；构建会生成 `cocos-sync/dist/code.js` 与 `dist/ui.html`，构建物不提交。
3. 在 Figma Desktop 重新导入该 manifest，并重载插件，以当前构建验证启动、配对、所选目标导出与 Preview。
4. 完成介绍、分类、图片、数据披露与支持链接，提交发布后记录真实审核状态与页面 URL。进入审核不等于已公开上架。
5. 提交并推送公开仓库；不要推送内部仓库、审计报告或本机会话信息。
