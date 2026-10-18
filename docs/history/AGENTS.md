# Development Rules

> 本文件分两部分：**第一部分**是本仓库（custom-sidex）的会话级硬约束与自定义开发规则，必须遵守；**第二部分**是上游 sidex 的架构与开发说明，随上游合并更新，**不要按自定义需求改写**。

---

# 第一部分：custom-sidex 自定义开发规则

## 重要

每次回复开头都要先喊一声"啊唯"

## 项目概述

本项目是基于 Sidenai/sidex 的自定义二次开发版本（custom-sidex）。AI Agent 在本仓库工作时，必须严格遵循以下规则。

## 必读文件（开始任何任务前）

1. **CUSTOMIZATIONS/README.md**——自定义开发机制的完整规则（冲突策略、标记格式、frontmatter 职责）
2. **CUSTOMIZATIONS/registry.md**——自定义改动登记账本（开发前读「改动总览」节）
3. **CUSTOMIZATIONS/docs/commands.md**——**常用命令速查**（启动/打包/版本号/日志；忘了命令先翻这里）
4. **本文件「第二部分」**——上游维护的架构说明（四语言层、进程模型、构建注意事项；勿修改）

## 工作流（写代码 / 排查问题前）

1. **先读 `CUSTOMIZATIONS/architecture.md`**：按 §0.5 任务作用域路由表确定该读哪些文件、忽略哪些；按 §2 任务→代码位置表定位。改了代码结构后同步该文件。
2. **排查 bug 前先扫 `CUSTOMIZATIONS/docs/pitfalls.md` 标题**：历史坑点避免重复踩；解决新坑后回写一条。
3. 上游文件改动区域必须用 `[CUSTOM-BEGIN]/[CUSTOM-END]` 标记包裹（`.json`/`.yaml`/lock 等无法注释的文件在 registry.md 总览标注）。

## 技术栈

- **前端**：TypeScript + Vite 6 + Monaco Editor（`src/vs/`，直接移植自 VSCode 工作台；TS 导入用 `.js` 后缀，服务用 `@inject` 装饰器）
- **后端**：Rust + Tauri 2（`src-tauri/`，21 个支撑 crate 在 `crates/sidex-*`）
- **AI agent**：Go（`sidexai/sidex-server/`，需 Go ≥1.26，绑定 loopback 的独立子进程）
- **WASM**：`src-wasm/`、`extensions-rust/`
- **包管理器**：**npm**（锁文件 `package-lock.json`；注意不是 pnpm）
- **Node.js**：≥20（构建脚本需 12GB 堆，`npm run build` 已内置）
- **Rust**：≥1.91（`rust-version` 见 `Cargo.toml`）
- **协议**：MIT（SideX 是 VSCode 的移植，VSCode 同为 MIT）
- **平台**：开发主平台 Windows（MSVC 工具链 + WebView2）

## 构建命令（全部在仓库根执行）

```bash
npm install              # 安装依赖
npm run setup            # 生成扩展元数据（tauri dev/build 前会自动跑）
npm run dev:custom       # 快捷：开发模式（已内置 AWS_LC_SYS_PREBUILT_NASM=1）
npm run build:custom     # 快捷：打包安装包（已内置 AWS_LC_SYS_PREBUILT_NASM=1）
npm run tauri dev        # 开发模式（前端热重载；改 Rust 需重新编译）
npx tauri build          # 打包安装包（内部会跑前端 build）
npm run build            # 仅前端构建
npm run lint             # ESLint
npm run rust:check       # cargo check
npm run rust:clippy      # cargo clippy（-D warnings）
npm run rust:fmt         # cargo fmt --check

# 可选：构建 AI agent server（需 Go ≥1.26，不装则聊天面板显示未连接，不影响编辑器）
npm run server:build
```

**Windows 首次构建必读**：`aws-lc-sys` 需要 NASM，未安装会导致 Rust 编译 panic。构建前设
`AWS_LC_SYS_PREBUILT_NASM=1`（详见 `CUSTOMIZATIONS/docs/pitfalls.md` #1）：

```bash
AWS_LC_SYS_PREBUILT_NASM=1 npm run tauri dev
```

> `npm run dev:custom` / `npm run build:custom` 已内置该变量，或直接双击
> `CUSTOMIZATIONS/scripts/dev.bat` / `build.bat`（bat 会自动切到仓库根）。
> 版本号共**四处**要同步（含 `tauri.conf.json` 的 `bundle.windows.wix.version`，纯数字且递增）；
> 产物在**仓库根** `target/release/bundle/`，不在 `src-tauri/target/`。

## Git 分支规则

| 分支             | 用途                              | 谁可以写入                              |
| ---------------- | --------------------------------- | --------------------------------------- |
| `upstream/main`  | 跟踪上游 Sidenai/sidex（只读）    | 只读（仅 fetch）                        |
| `vendor/main`    | 上游版本基线（跟踪 upstream/main）| 只读（仅 merge-upstream skill 可更新）  |
| `vendor/vX.Y.x`  | 上游版本线分支（锚定 tag 时用）   | 只读（同上）                            |
| `custom/main`    | 自定义开发主分支                  | AI Agent 开发合并                       |
| `feature/<name>` | 功能开发分支                      | AI Agent 临时分支                       |

- **remote**：`origin` → https://github.com/zouv/custom-sidex；`upstream` → https://github.com/Sidenai/sidex
- **禁止操作**：
  - **禁止未经用户明确指示 commit / push**：完成改动后只汇报结果（改了什么、验证情况），由用户决定何时提交；用户明确说"提交"/"commit"/"push"时才执行
  - 禁止手动 `git merge` 合并 vendor 到 custom/main（必须通过 `sidex-merge-upstream` skill）
  - 禁止 `git rebase` 改写 custom/main 的历史
  - 禁止直接 push 到 vendor 分支

## 自定义代码规范（硬约束）

1. **代码隔离优先**：新功能尽量放在 `CUSTOMIZATIONS/src/` 下，通过独立模块挂载
2. **修改上游文件时必须加标记**：
   ```
   // [CUSTOM-BEGIN] CUSTOM-YYYYMMDD-NNN - 描述
   ... 自定义代码 ...
   // [CUSTOM-END] CUSTOM-YYYYMMDD-NNN
   ```
   标记注释语法按语言适配（`.rs`/`.ts`/`.go` 用 `//`，`.toml` 用 `#`，`.html` 用 `<!-- -->`）
3. **每次改动必须记录**：完成后调用 `sidex-record-change` skill 更新 CUSTOMIZATIONS/registry.md
4. **不要删除 registry.md 中的历史条目**（标记 deprecated 即可）
5. **合并冲突**：按 CUSTOMIZATIONS/README.md 的冲突策略速查处理
6. **合并上游完成后、发布前**必须运行 `npm install && npm run lint && npm run rust:check && npm run tauri dev`（或 `npx tauri build`）验证

## AI Skills 触发条件

Skill 定义位于 `.agents/skills/`（跨工具共享的工作区级标准路径；上游 `.gitignore` 不忽略该目录，可正常入库）。

| Skill                  | 何时调用                                          |
| ---------------------- | ------------------------------------------------- |
| `sidex-record-change`  | 完成任何自定义功能/修改后                         |
| `sidex-merge-upstream` | 用户要求合并上游/升级版本/同步原仓库时            |
| `sidex-release`        | 用户要求打包/生成安装包/build 时（本地打包）      |
| `sidex-publish`        | 用户要求发布/上传 release/打 tag/推 release 时    |

详细触发场景见各 skill 的 `.agents/skills/<name>/SKILL.md`。

## 项目结构速查

```
src/                        # 前端工作台（TS，移植自 VSCode）
  vs/{base,platform,editor,workbench}/   # 分层：基础/平台服务/Monaco/IDE 外壳
  vs/platform/sidex/        # SideX 自有平台服务桥接
  main.ts                   # 应用入口（注入 __SIDEX_SERVICES__）
src-tauri/                  # Rust 后端（Tauri 2）
  src/lib.rs                # App 装配 + 命令注册（新增命令必须在此注册）
  src/server.rs             # 监管 Go agent server 子进程
  src/commands/             # 52 个命令模块（fs/terminal/git/search/...）
crates/sidex-*/             # 21 个 Rust 支撑 crate
sidexai/sidex-server/       # Go AI agent server（独立进程，loopback）
sidexai/sidex-agent/        # agent 相关子项目
src-wasm/                   # WASM 模块（hash/scroll/tfidf）
extensions-rust/            # Rust 扩展
scripts/                    # 构建与元数据生成脚本
CUSTOMIZATIONS/             # 自定义开发内容（规则、账本、代码地图、坑点库、代码、脚本）
├── README.md               # 机制与规则唯一完整版
├── architecture.md         # 代码链路图谱（AI 加速索引）
├── registry.md             # 改动登记账本
├── docs/pitfalls.md        # 历史坑点沉淀
├── docs/commands.md        # 常用命令速查（启动/打包/版本号/日志）
├── release-notes/ src/ patches/ scripts/
.agents/skills/             # AI Agent 项目级 skills（4 个）
CLAUDE.md                   # 一行指路文件（@AGENTS.md），供 Claude Code 自动加载本文件
```

## 文档更新职责（改完代码必须同步）

| 改动类型                              | 更新哪里                                                    |
| ------------------------------------- | ----------------------------------------------------------- |
| 任何自定义改动                        | `CUSTOMIZATIONS/registry.md`（走 `sidex-record-change`）    |
| 代码结构 / 目录 / 新增关键文件        | `CUSTOMIZATIONS/architecture.md`                            |
| 解决了一个"反复折腾才定位到"的问题    | `CUSTOMIZATIONS/docs/pitfalls.md`                            |
| 新增 / 修改了常用命令                 | `CUSTOMIZATIONS/docs/commands.md`（命令速查）               |
| 机制规则本身变化                      | `CUSTOMIZATIONS/README.md`（唯一规则源）                    |
| 发布新自定义版本                      | `CUSTOMIZATIONS/release-notes/`（走 `sidex-publish`）       |

---

# 第二部分：上游 sidex 架构与开发说明

> 以下随上游合并更新，**不要按自定义需求改写**。更完整的上游说明见根目录 `README.md` 与 `ARCHITECTURE.md`。

## 一句话定位

SideX 是 **VSCode 的 Tauri 移植版**：用 Tauri（Rust 后端 + 系统原生 webview）替换 Electron，目标是去掉捆绑的 Chromium 以大幅降低内存占用。前端 TypeScript 工作台直接移植自 VSCode（MIT），后端用 Rust 重写了原本由 Node.js 原生模块承担的能力。

## 进程模型

```
┌─────────────────────────────────────────────────────────────┐
│ Tauri Webview（前端 TS 工作台）                              │
│   base → platform → editor(Monaco) → workbench              │
│   ↑ Tauri invoke()/events      ⇅ HTTP/WS on 127.0.0.1       │
├─────────────────────────────────────────────────────────────┤
│ Tauri Rust 后端（src-tauri/ + crates/）                      │
│   fs · terminal(portable-pty) · git · search · sqlite        │
│   LSP · DAP · 扩展宿主(sidecar) · providers(模型凭据)        │
├─────────────────────────────────────────────────────────────┤
│ Go agent server（sidexai/sidex-server，子进程，仅 loopback） │
└─────────────────────────────────────────────────────────────┘
```

## Electron → Tauri 映射（对照用）

| VSCode (Electron)         | SideX (Tauri)                    |
| ------------------------- | -------------------------------- |
| Electron 主进程           | Tauri Rust 后端                  |
| `BrowserWindow`           | `WebviewWindow`                  |
| `ipcMain`/`ipcRenderer`   | `invoke()` + Tauri events        |
| `node-pty`                | `portable-pty`（Rust）           |
| `@parcel/watcher`         | `notify`（Rust）                 |
| `@vscode/sqlite3`         | `rusqlite`                       |
| Renderer（DOM + TS）      | 相同，跑在原生 webview           |
| Extension host            | Sidecar 进程（进行中）           |
| （无）                    | Go agent server（loopback）      |

## 关键约定

- **Rust 命令注册**：`src-tauri/src/commands/` 定义 → **必须在 `src-tauri/src/lib.rs` 注册**，否则前端调用失败
- **前端 TS 导入**：使用 `.js` 后缀（ESM 约定）
- **模型凭据**：只经进程环境变量 `SIDEX_PROVIDER_<PROVIDER>_KEY`/`_BASE_URL`/`_AUTH` 传给 agent server，绝不写配置文件、绝不发 webview
- **agent server 安全边界**：只绑 `127.0.0.1`；非回环地址需显式 `SIDEX_ALLOW_UNAUTHENTICATED=1`（它会代用户执行 shell 命令）
- **扩展发现**：运行时的实际扫描路径在 `src-tauri/src/commands/extension_platform.rs` 的 `extension_search_paths()`——**有意不扫描 `~/.vscode/extensions`**（注意 `crates/sidex-extensions/src/registry.rs` 另有一份包含该路径的定义，二者不一致，运行时认前者）
- **`target/` 不入库**：Rust 构建产物体积巨大

## 当前状态（上游 v0.1.3-dev，随上游更新）

- **稳定**：Monaco 编辑器、文件资源管理器、集成终端（完整 PTY）、Git 全套、主题、原生菜单、文件/全文搜索、SQLite 存储
- **进行中**：扩展宿主、调试器
- **内置 AI agent**：无需账号，自带 provider 配置（设置 → 模型）；凭据解析顺序为「设置 key → 环境变量 → 可选复用 Claude Code/Codex CLI 登录 → 自动检测本地模型服务」
