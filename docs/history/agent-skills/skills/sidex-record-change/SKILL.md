---
name: 'sidex-record-change'
description: '记录自定义改动到 CUSTOMIZATIONS/registry.md。Invoke when AI agent completes a custom feature, bugfix, or any modification to upstream code, to register the change for future merge tracking.'
---

# SideX 自定义改动记录 Skill

本 Skill 用于在 AI Agent 完成一次自定义开发后，将改动结构化记录到 `CUSTOMIZATIONS/registry.md` 文件中。**每次完成自定义修改后必须调用本 Skill**。

## 触发条件

- 完成一个自定义功能开发（feature）
- 完成一个自定义 Bug 修复
- 对上游源码做了任何非新增文件的修改
- 修改了 CUSTOMIZATIONS/ 下的自定义模块
- 用户明确要求"记录这个改动"

## registry.md 的两层结构（先理解再写）

| 层                     | 组织方式                             | 回答什么问题                                 | 更新方式                                                                |
| ---------------------- | ------------------------------------ | -------------------------------------------- | ----------------------------------------------------------------------- |
| **改动总览**（按文件） | 每个文件一节，多轮演进合并为当前状态 | "这个文件现在改了什么？合并上游时怎么处理？" | **该文件已有条目就更新那一节**（合并描述、演进链追加新 id）；没有才新增 |
| **变更日志**（按次）   | 按时间倒序 append-only               | "这次改动何时发生、为什么、怎么验证？"       | 只在顶部追加新条目，**永不改写历史**                                    |

关键原则：**同一文件多轮修改 → 总览里仍是一节**（演进链 `001→003→005` 标注历轮 id），变更日志按轮次各留一条。总览与代码中 `[CUSTOM-BEGIN]` 标记一一对应，是"当前状态"的文档镜像。

## 执行流程

### 第一步：确认仓库位置

如果当前工作目录不是 custom-sidex 仓库根目录，通过用户确认或查找**包含 `CUSTOMIZATIONS/registry.md` 且 `AGENTS.md` 第一部分为 custom-sidex** 的目录来定位。

### 第二步：分析本次改动

```bash
git diff --name-only HEAD
git diff --name-only --cached
git diff --name-only
git ls-files --others --exclude-standard
```

对每个改动文件，判断：改动目的（功能/Bug 修复/配置）、冲突策略（keep-ours / keep-theirs / merge-manual）、是否为纯自定义路径（`CUSTOMIZATIONS/`、`.agents/`、`AGENTS.md` 等上游不存在的文件用 keep-ours）。

### 第三步：为上游文件修改添加标记

对修改上游文件的改动，**必须**在代码中用标记包裹自定义改动区域：

```rust
// [CUSTOM-BEGIN] CUSTOM-YYYYMMDD-NNN - <简要描述>
... 自定义代码 ...
// [CUSTOM-END] CUSTOM-YYYYMMDD-NNN
```

`<change-id>` 格式 `CUSTOM-YYYYMMDD-NNN`。已有标记块内追加修改时复用原 id；**同文件的新逻辑改动区域用新 id 新开标记块**（演进由总览的演进链体现）。

sidex 是多语言仓库，标记注释语法按文件类型适配：

| 文件类型                                   | 注释语法                         |
| ------------------------------------------ | -------------------------------- |
| `.rs` / `.ts` / `.tsx` / `.js` / `.go`     | `// [CUSTOM-BEGIN] ...`          |
| `.toml`（`Cargo.toml`、`tauri.conf` 等）   | `# [CUSTOM-BEGIN] ...`           |
| `.html` / `.vue` 的 `<template>` 区        | `<!-- [CUSTOM-BEGIN] ... -->`    |
| `.json` / `.yaml` / `Cargo.lock` / lock    | 无法注释，总览「标记」列注明「无标记」 |

### 第四步：更新 registry.md（两处）

**改动总览（按文件）**——对每个改动文件：

- 已有条目：更新该节——「标记」列填当前 change-id，「演进链」追加本轮 id，「当前效果」合并描述（把多轮描述融合成"这个文件现在是什么样"，**删除已被后续轮次取代的旧描述**）
- 没有条目：按表头新增一行（纯自定义目录可用 `目录/（文件、文件）` 聚合行）

**变更日志（按次）**——在顶部追加：

```markdown
### CUSTOM-YYYYMMDD-NNN —— <一句话标题>

- **日期**：YYYY-MM-DD
- **类型**：feat / fix / chore / config
- **改动**：<改了什么、为什么、注意事项>
- **验证**：<怎么验证的>
- **基于上游版本**：<main@<short-hash> 或 tag>
```

### 第五步：一致性自检（必须执行）

```bash
sh CUSTOMIZATIONS/scripts/check-registry.sh
```

脚本双向比对代码 `[CUSTOM-BEGIN]` 标记 ↔ 总览表。退出码非 0 时按提示修复（通常是忘了补标记或总览路径写法不匹配），**修到全绿才算登记完成**。

### 第六步：汇报（不自动提交）

登记完成后**停止并汇报**：改动、验证结果、check-registry 状态、建议的提交命令。**不要主动执行 git commit / git push**——提交时机由用户决定（见根 AGENTS.md 禁止操作第一条）。

用户明确要求提交时，提交命令参考：

```bash
git add CUSTOMIZATIONS/registry.md <被标记的修改文件>
git commit -m "docs(custom): record change <change-id> - <简要描述>"
```

功能代码与登记在同一批提交；补录单独提交。

## 重要约束

1. **变更日志只增不改**；总览条目整体废弃时标 `deprecated` 而非删除。
2. **change-id 不可复用**；同一文件多轮修改 → 每轮新 id + 总览演进链。
3. 路径用**仓库根相对路径**（注意分层：前端 `src/vs/...`、Rust `src-tauri/src/commands/...`、crate `crates/sidex-xxx/src/...`、Go `sidexai/sidex-server/internal/...`）；同一目录多文件用 `目录/（a、b、c）` 聚合写法。
4. 描述用中文；frontmatter 字段不随意改（职责表见 CUSTOMIZATIONS/README.md）。
5. 顺带规则：改了代码结构同步 `CUSTOMIZATIONS/architecture.md`；解决了反复折腾的问题回写 `CUSTOMIZATIONS/docs/pitfalls.md`（见根 AGENTS.md 文档更新职责表）。

## 输出要求

向用户报告：

- 本轮 change-id、涉及的文件
- 总览更新了哪些既有节 / 新增了哪些节（体现"合并而非堆叠"）
- check-registry.sh 校验结果（全绿）
- 变更日志当前条目数
