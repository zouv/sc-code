---
name: 'sidex-publish'
description: 'Publish the custom sidex build to GitHub Releases (version bump, release notes, commit, tag, push, upload local artifacts, verify). Invoke when user asks to publish/upload a release to GitHub, push a release, cut a new version, or create a GitHub Release.'
---

# SideX 发布到 GitHub Skill

把**已定好的版本**发布到 GitHub Releases。本 skill 覆盖「版本号 → release 上线」这一段。

## 与 sidex-release 的分工

| Skill                    | 职责                          | 起点 → 终点                                 |
| ------------------------ | ----------------------------- | ------------------------------------------- |
| `sidex-release`          | 从源码到**本地安装包**        | 干净工作区 → `target/release/bundle/**`（仓库根） |
| **`sidex-publish`（本）** | 从版本号到 **GitHub Release** | 版本号 + release notes → release 上线       |

**本仓库无 CI 发布流水线**（上游 sidex 不发布预编译二进制），因此发布 = **本地打包产物 + 手动上传**。发布前先走 `sidex-release` 拿到安装包。

## 触发条件

- 用户说"发布"、"上传 release"、"打 tag"、"发版"、"publish"
- 需要创建 GitHub Release 并附安装包

## 前置检查（缺一不可）

```bash
git branch --show-current        # 必须是 custom/main
git status --porcelain           # 必须干净（发布前所有改动已提交）
sh CUSTOMIZATIONS/scripts/check-registry.sh    # 必须全绿
gh auth status                   # gh CLI 已登录

# ⚠️ 必须确认 gh 的默认仓库是本仓库，而不是上游！（本仓库 upstream 也配了 push URL，
#    gh 实测会把默认解析成 Sidenai/sidex —— 不指定就会把 release 发到上游，见 pitfalls #8）
gh repo view --json nameWithOwner -q .nameWithOwner   # 期望 zouv/custom-sidex
gh repo set-default zouv/custom-sidex                 # 不是就钉死它
```

**产物必须已存在**（否则先跑 `sidex-release`）：

```bash
ls -la target/release/bundle/msi/ target/release/bundle/nsis/ 2>/dev/null
```

## 执行流程

### 1. 确认版本号

格式 `v<上游版本>-custom.<N>`。读已有 tag 取最大序号 +1：

```bash
git tag -l "v*-custom.*" --sort=-v:refname | head -5
```

### 2. 同步版本号落点（三处）

同 `sidex-release`：`package.json`、`src-tauri/tauri.conf.json`、`src-tauri/Cargo.toml` 都改成 `0.1.3-custom.N`（不带 `v`）。
（**注意**：workspace 根 `Cargo.toml` 的 `[workspace.package] version` 是内部 crate 版本，不动。）

### 3. 写 release notes

路径：`CUSTOMIZATIONS/release-notes/vX.Y.Z-custom.N.md`

```markdown
# vX.Y.Z-custom.N

**基于上游**：Sidenai/sidex `<tag 或 main@<short-hash>>`

## 自定义改动

- <从 registry.md 变更日志汇总本轮 feature/fix>

## 上游同步

- <本次合并了上游哪些版本，若无则写"无">
```

### 4. 更新 registry.md frontmatter

| 字段                                             | 填什么        |
| ------------------------------------------------ | ------------- |
| `custom_version`                                 | 新自定义版本  |
| `last_release_version` / `last_release_date`     | 本次版本/日期 |

### 5. 提交 + 打 tag + 推送

```bash
git add package.json src-tauri/tauri.conf.json src-tauri/Cargo.toml \
        CUSTOMIZATIONS/registry.md \
        CUSTOMIZATIONS/release-notes/vX.Y.Z-custom.N.md
git commit -m "chore(release): bump version to vX.Y.Z-custom.N"

git tag -a vX.Y.Z-custom.N -m "Release vX.Y.Z-custom.N

Based on upstream Sidenai/sidex <upstream-ref>"

git push origin custom/main
git push origin vX.Y.Z-custom.N
```

> ⚠️ **推送前必须获得用户明确指示**（见根 AGENTS.md 禁止操作第一条）。本 skill 不自动 push。

### 6. 创建 GitHub Release 并上传产物

```bash
gh release create vX.Y.Z-custom.N \
  --repo zouv/custom-sidex \
  --title "vX.Y.Z-custom.N" \
  --notes-file CUSTOMIZATIONS/release-notes/vX.Y.Z-custom.N.md \
  --prerelease \
  target/release/bundle/nsis/*-setup.exe \
  target/release/bundle/msi/*.msi
```

- 自定义版本默认标 `--prerelease`；稳定版可去掉
- 只上传**当前平台**能产出的产物；跨平台产物需在对应平台各自打包后追加：

  ```bash
  gh release upload vX.Y.Z-custom.N <新增产物路径> --repo zouv/custom-sidex
  ```

### 7. 核验

```bash
gh release view vX.Y.Z-custom.N --repo zouv/custom-sidex            # 确认正文与资产列表
gh release view vX.Y.Z-custom.N --repo zouv/custom-sidex --json assets --jq '.assets[].name'
```

确认资产数量与文件名符合预期、正文是我们的 release notes（而非模板）。

## 重要约束

1. **禁止在未获用户明确指示时 commit / tag / push / 发布**——本 skill 的所有写操作都必须先征得同意。
2. **版本号三处（外加 tag）必须一致**，否则产物文件名与 tag 对不上。
3. **不发布预编译二进制的上游惯例**：本仓库的产物是我们自己打的包，需在 release 正文注明"基于上游 <ref>、仅 <平台> 产物"。
4. 发布后如发现正文/产物有误，`gh release edit` / `gh release upload --clobber` 可修正；**不要删除已推送的 tag**（改 tag 会破坏引用），必要时发一个新的 `-custom.N+1`。
