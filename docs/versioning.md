# 版本与发布

## 版本格式

DoomUI 使用 [zrong/skills](https://github.com/zrong/skills) 仓库中的 [git-commit skill](https://github.com/zrong/skills/tree/main/git-commit) 定义的 CalVer：

```text
YY.WW.MICRO
```

- `YY`：ISO 年份后两位，不补前导零。
- `WW`：ISO 周数，不补前导零。
- `MICRO`：仓库内全局递增，从 1 开始，跨年不重置。

版本号必须由已安装的 `git-commit` skill 中 `scripts/calver.py` 计算。仓库不复制该脚本，也不允许人工推算版本。

安装方式见上游仓库，也可使用：

```bash
npx skills add zrong/skills --skill git-commit
```

安装后从实际安装目录运行 `scripts/calver.py`，不要把本机安装路径写入项目文档。

## 版本真值与同步范围

发布时以下位置必须一致：

- 根 `VERSION`
- `figma-sync/package.json`
- `figma-sync/package-lock.json` 及其根 package 记录
- `cocos-sync/package.json`
- `cocos-sync/package-lock.json` 及其根 package 记录
- 当前发布提交上的 Git Tag

Cocos 面板运行时直接显示 `figma-sync/package.json` 的版本，禁止在模板中硬编码。

`figma-ui-sync-sandbox/package.json.version` 是 Cocos Creator 工程版本，由 Creator 3.8.6 维护并固定为 `3.8.6`；它不是 DoomUI 产品版本，也不参与 CalVer 同步。`version-check` 会单独验证 sandbox 的 `version` 与 `creator.version` 都为 `3.8.6`。

## 校验与更新命令

```bash
just version-check
just set-version 26.35.1   # 参数必须来自 calver.py；此处仅展示格式
just release-check         # 额外要求 HEAD 上存在同名 Tag
```

`set-version` 只负责机械同步文件，不负责生成版本、提交或打 Tag。

## 发布流程

1. 完成功能、文档和测试，按可独立构建/测试的逻辑边界做原子提交。
2. 运行 `just check`，确保工作区只剩预期发布版本修改或完全干净。
3. 从当前安装的 `git-commit` skill 目录运行其 `scripts/calver.py`，记录输出为 `VERSION` 候选。
4. 执行 `just set-version <候选版本>`，提交一个独立的 `chore(release)` 版本同步提交。
5. 在最后一个提交完成后再次运行同一个 `calver.py`；因为尚未新增 Tag，输出必须仍与文件版本一致，否则停止并重新检查并发发布或 Tag 状态。
6. 以该输出为当前 `HEAD` 创建不带前缀的 Tag，例如 `26.35.1`。
7. 运行 `just release-check`，验证代码、版本文件和 Tag。
8. 只有用户明确要求时才执行 `git push` 和 `git push --tags`。

`git-commit` skill 的核心顺序仍然是“提交完成 → 运行 calver.py → 打 Tag”。步骤 3 只为准备版本文件，步骤 5 才是最终 Tag 使用的版本计算。

## Commit 规范

Commit Message 使用简体中文 Conventional Commits，并包含：

```text
<type>(<scope>): <简体中文摘要>

<背景与动机>

Agent-Task: <原始任务或任务 ID>
Agent-Model: <本轮模型>
Agent-Decision: <关键决策与理由>
Agent-Limitation: <已知限制或后续 TODO>
```

代码重构、新功能、测试、文档和发布版本同步应按逻辑边界分开。生成缓存、Figma 本机 Import 状态、真实设计映射和配对 token 不提交；`cocos-sync/manifest.json` 中的稳定 plugin ID 是必须提交的持久化身份。

## 公开基线与后续发布

公开仓库使用经整理的源码快照建立，保留产品基线 `26.36.28`，但不迁入旧历史与旧 Tag，也不因初始化 Git 重置 MICRO。初始提交只运行 `just check` 和 `just version-check`，不是带 Tag 的新版本发布，不能宣称通过 `just release-check`。

后续发布仍由维护者使用其已安装的 `git-commit` skill 计算版本。没有该工具的贡献者只需提交代码并运行 `just check`，无需改动版本文件。当前 `calver.py` 根据运行目录下的 Git Tag 取得 MICRO 基准，因此维护者应在保留完整发布标签的仓库上下文运行该脚本，再将输出同步到公开仓库，确保后续 MICRO 继续递增。不要直接在无历史 Tag 的公开副本中采用默认起点；若无法取得既有发布基准，应停止发布而不是手算或重置版本。
