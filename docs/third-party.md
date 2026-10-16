# 第三方依赖说明

DoomUI 自有源码采用根目录的 [MIT 许可证](../LICENSE)。第三方依赖保留各自的许可证；两个插件的 `package-lock.json` 记录实际安装版本、来源和完整性摘要。

## Cocos 扩展运行依赖

| 包 | 锁定版本 | 许可证 | 上游 |
|---|---|---|---|
| fs-extra | 11.4.0 | MIT | [node-fs-extra](https://github.com/jprichardson/node-fs-extra) |
| sharp | 0.33.5 | Apache-2.0 | [sharp](https://github.com/lovell/sharp) |
| vue | 3.5.42 | MIT | [Vue](https://github.com/vuejs/core) |

sharp 安装时会按平台选择图像处理二进制依赖。例如本次 macOS arm64 安装的 `@img/sharp-libvips-darwin-arm64@1.0.4` 声明 `LGPL-3.0-or-later`，见 [sharp-libvips](https://github.com/lovell/sharp-libvips)。不同平台的实际包以 lock 和安装结果为准。

本源码仓库不包含 `node_modules/`、预编译第三方二进制或宿主软件。若另外制作带依赖的安装包，应逐项携带依赖自身的 LICENSE / NOTICE 和所需源代码信息；根 MIT 许可证不替代这些依赖条款。

## 构建与宿主

TypeScript、Vitest、esbuild、Figma Plugin Typings、Cocos Creator Types 及其传递依赖的声明位于各包元数据和许可证文件中。Cocos Creator 与 Figma Desktop 由使用方独立安装，本仓库不分发宿主软件。
