# Cocos Sync 开发指导

本目录是本地 Figma Desktop 伴生插件。除本文件外，同时遵循仓库根 `AGENTS.md`。

## 稳定身份与范围

- npm 包名固定为 `cocos-sync`，Figma 插件标题固定为 `Cocos Sync`。
- 支持 Figma Desktop、Figma Design 文件和手动单选或多选 `FRAME` / Page 直属 `COMPONENT`；只推送明确选择的目标。
- 不做自动监听、后台推送、PSD 处理，也不声称网页版已验收。
- 结构导出使用 `JSON_REST_V1`；需要的图片按 Cocos `/v1/prepare` 返回清单导出，禁止预先全量导出。
- 可消费 Cocos 面板显式创建的一次性 Prefab 接管会话，在用户选择的 Page 创建一个可编辑 Frame 并回传节点映射；这不是持续反向同步，也不允许自动覆盖已有 Figma Frame。

## 本机协议与安全

- 端点固定为 `http://localhost:38638`；Cocos 服务实际只绑定 `127.0.0.1`。
- 首次用八位配对码换取会话 token，后续使用 Bearer token；token 仅保存在 Figma `clientStorage`。
- Cocos 扩展重载后旧 token 失效；遇到 401 应清除本地 token 并要求重新配对。
- Figma plugin ID、`clientStorage` key 和 plugin-data key 是持久化兼容边界，不随产品或 npm 包改名。
- 该链路不得读取 PAT、调用 Figma REST API 或把真实设计响应写入仓库。
- 协议结构或端点变化必须同步修改 Cocos 端、`src/protocol.ts` 和 `docs/local-push-protocol.md`。

## Manifest

- `manifest.json` 是仓库真值，包含团队统一、由 Figma 分配的稳定数字 ID，必须提交且不得按电脑重新生成。
- Figma Desktop 的 Import 状态、配对码和 `clientStorage` token 仍是本机状态，不得写入仓库。
- 网络白名单只保留本机开发端点；不要增加外网域名。

## 验证

```bash
npm run check
```

构建产物是 `dist/code.js` 和 `dist/ui.html`，不提交。涉及 Figma Plugin API 的变更还需要在 Figma Desktop 重新运行开发插件验证。
