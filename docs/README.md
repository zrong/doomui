# DoomUI 文档索引

本目录是 DoomUI 的产品、架构、协议、开发与验收文档真值。根/子项目 `AGENTS.md` 只记录必须优先遵守的约束，不复制所有实现细节。

## 建议阅读顺序

1. [架构](architecture.md)：先理解三个子项目和 Desktop Push 与一次性接管链路。
2. [Figma 制作规范](figma-authoring-guide.md)：设计人员按可转换语义组织 Frame、Component 和 Variant。
3. [开发指南](development.md)：安装、构建、导入开发插件和运行验收工程。
4. [Cocos Sync 本机协议](local-push-protocol.md)：修改两端通讯时的稳定契约。
5. [详细设计](figma-to-cocos-prefab-tool-design.md)：节点映射、diff、事务、限流和 Button 推断。
6. [版本与发布](versioning.md)：CalVer、原子提交、Tag 和版本一致性。
7. [验收记录](acceptance.md)：区分自动化、宿主运行态与剩余外部验收。
8. [第三方依赖说明](third-party.md)：源码许可证、运行依赖和二进制分发边界。

## 文档维护边界

- 产品范围或不可逆设计决策：更新详细设计，并把最高优先级约束同步到根 `AGENTS.md`。
- Figma→Cocos 映射、一次性 Cocos→Figma 接管或制作规则：更新制作规范、详细设计和对应测试。
- 本机请求/响应、认证或限制：更新 Cocos Sync 本机协议、两端类型和自动测试。
- 安装、命令或目录变化：更新根 README、开发指南和相关子项目 README。
- 完成一次新的真实运行态验收：追加验收记录，写清环境、输入边界、结果和未验证项。

历史讨论中有关 PSD 的内容只保留为范围说明：PSD 可以在工作流外一次性导入 Figma，但当前代码不读取、上传或回写 PSD。
