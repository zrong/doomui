# Figma Sync 开发指导

本目录是 Cocos Creator 扩展。除本文件外，同时遵循仓库根 `AGENTS.md`。

## 稳定身份与入口

- 包名和面板标题固定为 `figma-sync` / `Figma Sync`。
- 菜单父路径固定为 `i18n:menu.extension/DoomUI`，叶子 `label` 固定为 `Figma Sync`；用户看到的是 `扩展 → DoomUI → Figma Sync`。不要把叶子名重复写进 `path`，否则运行态会多一层同名子菜单。
- Cocos 兼容范围与实测版本按根 `AGENTS.md` 执行；包声明和产品介绍保持一致。
- 面板显示版本必须读取 `package.json`，禁止再次硬编码。

## 分层约束

- `source/core/` 保持纯 TypeScript，可脱离 Creator 单元测试。
- 主进程负责设置、diff、资源校验、资源事务和本机 Push 服务；设计结构与图片只由 Cocos Sync 通过本机协议推送。
- Scene Script 负责通过 Cocos 引擎 API 创建组件和序列化 Prefab。
- 资源写入使用 asset-db 消息，禁止手写 `.meta` 或直接伪造 UUID。
- 已匹配 Figma node ID 的 Cocos file ID 和已存在资产 UUID 必须稳定。
- 旧包 `figma-ui-sync` 的 Profile 必须以复制方式迁移并保留回退数据；`source/core/hash.ts` 的旧盐不得因改名而变化。
- 一次性 Cocos → Figma 接管只读取用户指定的现有 Prefab，结构和图片保存在短期内存会话；禁止为导入而复制 Prefab、`.meta` 或真实设计数据。

## 同步安全

- Preview 只读；Apply 使用现有 plan，过期或配置变化后必须重新 Preview。
- 写入前先完成资源校验，失败时恢复已修改资源并删除本轮新建资源，最后才保存映射。
- 逻辑 Prefab 后续同步哈希必须保持不变；视觉 Prefab 不允许挂业务脚本。
- 本机服务固定绑定 `127.0.0.1:38638`，协议变更需提升协议版本并同步更新伴生插件和协议文档。
- 错误、日志和报告不得返回 Push Bearer token。

## 验证

```bash
npm run check
npm pack --dry-run --json
```

映射、diff、回滚或 Push 协议变更必须补 Vitest。`dist/` 是构建产物，不提交。
