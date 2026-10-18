---
name: 'sidex-merge-upstream'
description: 'Merge upstream Sidenai/sidex updates into the custom repository. Invoke when user asks to sync/merge/update from upstream, upgrade to a new version, or pull upstream changes.'
---

# SideX 上游合并 Skill

本 Skill 用于将 Sidenai/sidex 上游仓库的更新合并到自定义仓库中。**所有跨上游/自定义分支的合并操作必须通过本 Skill 执行，禁止手动 git merge。**

## 触发条件

- 用户说"合并上游"、"更新到最新版本"、"升级到 vX.Y.Z"、"sync upstream"
- 需要将上游的 bugfix/新功能合入自定义版本
- 用户要求"同步原仓库"

## sidex 上游分支模型（先理解）

- 上游开发分支就是 **`main`**（默认分支，无 `develop`）
- 发布走 **tag**（当前 `v0.1.2`；`v0.1.3` 在 `main` 上开发中），无 `release/*` 分支
- 本仓库对应：`vendor/main`（默认基线，跟踪 upstream/main）与 `vendor/vX.Y.x`（锚定 tag 时可选）

## 参数收集

开始前确认以下信息（从用户输入或通过询问获取）：

1. **目标版本**：
   - `upstream/main` 最新（**默认**，跟随开发线）
   - tag（如 `v0.1.2`）→ 精确版本
   - 指定 commit hash
   - 如果用户未指定，默认取 upstream/main 最新并展示待合并提交数

2. **是否需要构建验证**：默认需要，除非用户明确跳过

## 前置检查

### 1. 确认仓库状态

```bash
git branch --show-current        # 必须在 custom/main 上
git status --porcelain           # 必须干净

# 不干净时先处理（stash/commit），或：
git stash push -m "auto-stash before upstream merge $(date -Iseconds)"
```

### 2. 同步 vendor 分支

```bash
pwsh CUSTOMIZATIONS/scripts/sync-vendor.ps1 -Ref upstream/main
# 或锚定 tag：
pwsh CUSTOMIZATIONS/scripts/sync-vendor.ps1 -Ref v0.1.2
```

### 3. 预览待合并内容

```bash
git log --oneline custom/main..vendor/main | head -50   # 提交列表
git diff --stat custom/main..vendor/main                 # 改动范围
```

**重点分析**：把改动文件与 `CUSTOMIZATIONS/registry.md` 的「改动总览」比对——凡是既被上游改动、又被我们标记过的文件，就是**潜在冲突点**，按总览的「冲突策略」列预判处理方式。

## 合并执行

### 冲突策略（速查，完整版见 CUSTOMIZATIONS/README.md）

| 优先级 | 条件                                    | 策略                                     |
| ------ | --------------------------------------- | ---------------------------------------- |
| 1      | `CUSTOMIZATIONS/src/` 或 `patches/` 下  | `keep-ours`                              |
| 2      | registry 条目为 keep-ours               | `keep-ours`                              |
| 3      | registry 条目为 keep-theirs             | `keep-theirs`                            |
| 4      | `package-lock.json`                     | 用上游版后 `npm install` 重新生成        |
| 5      | `Cargo.lock`                            | 用上游版后 `cargo build` 重新生成        |
| 6      | 含 `[CUSTOM-BEGIN]` 标记的文件          | `merge-manual`（按标记块保留自定义代码） |
| 7      | 其他                                    | `merge-manual`（AI 逐块分析）            |

**核心原则**：标记外的区域优先采用上游版本；`[CUSTOM-BEGIN]...[CUSTOM-END]` 块必须保留。上游重构导致位置漂移时，按函数名/组件名/模块路径定位新位置，而不是按行号。

### 执行合并

在 `custom/main` 上合并 `vendor/main`：

```bash
git merge vendor/main --no-commit   # 先不自动提交，便于处理冲突与检查
```

逐文件按上表策略解决冲突 → 检查 `git diff --cached` 确认无误 → 提交：

```bash
git commit -m "merge(upstream): integrate upstream <ref> into custom/main"
```

## 合并后必做

### 1. 构建验证

```bash
npm install
AWS_LC_SYS_PREBUILT_NASM=1 npm run tauri dev   # Windows 必须带该环境变量（pitfalls #1）
npm run lint
npm run rust:check
```

发布前还应跑 `npx tauri build`。上游若改了 `Cargo.toml`/前端依赖，`Cargo.lock`/`package-lock.json` 可能需重新生成。

### 2. 校验自定义标记未丢失

```bash
sh CUSTOMIZATIONS/scripts/check-registry.sh
pwsh CUSTOMIZATIONS/scripts/list-custom.ps1
```

确认每个自定义文件仍含其 `[CUSTOM-BEGIN]` 标记。

### 3. 更新 registry.md frontmatter

| 字段                                                   | 填什么                    |
| ------------------------------------------------------ | ------------------------- |
| `current_upstream_version` / `current_upstream_commit` | 新基线版本与 commit       |
| `vendor_branch`                                        | 若跨版本线则更新          |
| `last_merge_date`                                      | 本次合并日期              |

并在**变更日志顶部**追加一条 `merge(upstream)` 记录（合并了哪些版本、冲突怎么解决的、验证结果）。

## 重要约束

1. **禁止 `git rebase` 改写 custom/main 历史**。
2. **禁止直接 push 到 vendor 分支**（只有本 skill 能更新它）。
3. 冲突解决中若遇到"上游把我们的自定义功能原生实现了"的情况，把该条总览条目标 `merged-upstream` 并移除对应标记块（保留历史记录）。
4. 提交时机：合并属重大操作，**动手前先向用户确认目标版本**；合并完成后汇报，除非用户已明确要求提交。
