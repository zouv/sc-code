# 常用命令速查

> **忘了命令先翻这里。** 一处集中本仓库最常用的命令与坑，不用去翻散落在 AGENTS.md / README / skill 里的说明。
>
> 相关：[pitfalls.md](./pitfalls.md)（踩过的坑）· [../architecture.md](../architecture.md)（代码位置反查）· [../registry.md](../registry.md)（改动账本）

---

## 0. 最短路径（90% 的情况只需要这四条）

| 我要…         | 命令                                                                 |
| ------------- | -------------------------------------------------------------------- |
| 启动应用       | `npm run dev:custom`　或双击 `CUSTOMIZATIONS/scripts/dev.bat`          |
| 打包安装包     | `npm run build:custom`　或双击 `CUSTOMIZATIONS/scripts/build.bat`      |
| 登记自检       | `sh CUSTOMIZATIONS/scripts/check-registry.sh`                         |
| 看日志         | `%LOCALAPPDATA%\dev.sidex.app\logs\SideX.log`（**只有 dev 构建有**）   |

> 两个 custom 命令已内置 `AWS_LC_SYS_PREBUILT_NASM=1`，**不需要**再手写环境变量（原因见 §1）。

---

## 1. 自定义快捷命令（本仓库新增）

| 命令                                  | 作用                       | 说明                                                             |
| ------------------------------------- | -------------------------- | ---------------------------------------------------------------- |
| `npm run dev:custom`                  | 启动桌面应用（开发模式）   | 前端 TS 热重载；改 Rust 会自动重编译。日志见 §5                   |
| `npm run build:custom`                | 打包安装包（release）      | 产物见 §3。会先打印四处版本号                                    |
| `CUSTOMIZATIONS/scripts/dev.bat`      | 同上（bat 包装）           | 自动 `cd` 到仓库根、校验 `node_modules`；可双击运行               |
| `CUSTOMIZATIONS/scripts/build.bat`    | 同上 + 版本号自查 + 列产物 | 打包前打印四处版本号，打包后列出 `target/release/bundle/` 内容    |
| `CUSTOMIZATIONS/scripts/build-release.bat` | 一键打 release 包（只打包） | 打印当前版本号核对 → `npm run build:custom` → 列产物；**不改版本号**；等价 `node CUSTOMIZATIONS/scripts/release.js` |

- bat 与 npm 脚本是**同一件事**（bat 只是薄包装），逻辑只有一份，不会两头不一致。
- **为什么必须带 `AWS_LC_SYS_PREBUILT_NASM=1`**：`aws-lc-sys` 在 Windows 上默认调用 NASM
  汇编器，本机未装 NASM 会直接编译 panic。设 1 让它用自带的预编译目标文件。
  → `npm run tauri dev` / `npx tauri build` 这类原生命令**仍需自己加**。
- 两个 bat 是 **CRLF + UTF-8（无 BOM）+ `chcp 65001`**——改动它们时别把行尾弄成 LF，否则
  cmd.exe 的多行 `if (...)` 块会出错。

---

## 2. 开发 / 构建（上游原生命令）

```bash
npm install              # 安装依赖（换机器 / 改依赖后跑）
npm run setup            # 生成扩展元数据（tauri dev/build 前会自动跑，一般不用手动）
npm run tauri dev        # 开发模式（原生写法，需自己带 AWS_LC_SYS_PREBUILT_NASM=1）
npx tauri build          # 打包（原生写法，同上）
npm run build            # 仅前端构建（不含 Tauri 打包）
npm run preview          # 预览前端构建产物
```

**校验 / 格式**

```bash
npm run lint             # ESLint（src/**/*.ts）
npm run lint:fix         # ESLint 自动修
npm run format           # Prettier 写入
npm run rust:check       # cargo check
npm run rust:clippy      # cargo clippy（-D warnings）
npm run rust:fmt         # cargo fmt --check
npm run rust:fmt:fix     # cargo fmt 自动修
```

**可选：AI agent server**（不装则聊天面板显示未连接，**不影响编辑器**）

```bash
npm run server:build     # 需 Go ≥1.26
```

---

## 3. 打包 / 发布

```bash
npm install
npm run build:custom     # 等价于 CUSTOMIZATIONS/scripts/build.bat
```

- 一键 release（只打包；版本号请先按 §4 手工同步四处）：
  ```bash
  CUSTOMIZATIONS/scripts/build-release.bat       # 双击或命令行
  node CUSTOMIZATIONS/scripts/release.js         # 等价
  ```

- ⚠️ **产物在仓库根 `target/release/bundle/`**，不是 `src-tauri/target/`
  （根 `Cargo.toml` 是 workspace，cargo 的 target 目录落在 workspace 根）。

```
target/release/bundle/
├── msi/     *.msi          # WiX 安装包
└── nsis/    *-setup.exe    # NSIS 安装包
```

- ✅ **成功判定：输出最后一行必须是 `Finished N bundles at:` 并列出产物**
  —— 「编译成功」（`Built application at: ...exe`）**不等于**「打包成功」，
  某种格式失败会中断后续格式，可能出现编译过了却零安装包。
- 首次全量约 12 分钟，增量 5–6 分钟。
- 发布到 GitHub（tag / Release / 上传产物）是另一件事 → 用 `sidex-publish` skill。

---

## 4. 版本号（**四处**，打包前必查）

| 文件                        | 字段                          | 示例            |
| --------------------------- | ----------------------------- | --------------- |
| `package.json`              | `version`                     | `0.1.3-custom.2` |
| `src-tauri/tauri.conf.json` | `version`                     | `0.1.3-custom.2` |
| `src-tauri/tauri.conf.json` | `bundle.windows.wix.version`  | `0.1.3.2`       |
| `src-tauri/Cargo.toml`      | `version`                     | `0.1.3-custom.2` |

- **`wix.version` 必须是纯数字**（MSI/WiX 限制），把 custom 序号放第 4 位：`custom.2 → 0.1.3.2`。
  忘了改会让 Windows 认为 MSI 版本没变、**升级安装被跳过**。
- **不要动**根 `Cargo.toml` 的 `[workspace.package] version`（那是内部 crate 版本，与应用无关）。
- 上面两个 custom 命令会**自动打印这四处**供核对，`build.bat` 更是打包前必打。

---

## 5. 排查 / 日志

| 内容           | 位置                                                              |
| -------------- | ----------------------------------------------------------------- |
| **应用日志**   | `%LOCALAPPDATA%\dev.sidex.app\logs\SideX.log`（dev 构建才有）      |
| 扩展目录       | `%APPDATA%\SideX\extensions\`（**不扫描** `~/.vscode/extensions`） |
| 扩展宿主 init  | `%TEMP%\sidex-init-<uuid>.json`（宿主读完即删，排查需抢读）        |
| 应用数据 / 库  | `%APPDATA%\SideX\`（`sidex_state.db` 等）                          |

- ⚠️ **release 包没有任何日志输出**：`tauri-plugin-log` 只在 `debug_assertions`（dev）下注册。
  → **排障要用 dev 构建**，否则什么都看不到。
- 前端 TS 的 `ILogService` **不进**上面那个日志文件，只在 webview console / devtools 里。
- devtools 由 `tauri` 的 `devtools` feature 提供（已编译进来）；`src-tauri/src/lib.rs` 的 setup 里
  有 `open_devtools()`，且**没有被 `debug_assertions` 包住**——即 release 构建也会执行。
- 更细的排查手法（抢读 init 文件、A/B 复刻扩展解析逻辑）见 [pitfalls.md](./pitfalls.md) #5 / #6。

---

## 6. 自定义机制脚本

```bash
# 登记一致性自检（每次 record-change 后必须全绿；代码标记 ↔ 总览表双向比对）
sh CUSTOMIZATIONS/scripts/check-registry.sh

# 初始化仓库（首次 clone 后；已初始化过则跳过）
pwsh CUSTOMIZATIONS/scripts/init-repo.ps1

# 查看当前自定义改动（读 registry.md 的 vendor_branch 定位基线）
pwsh CUSTOMIZATIONS/scripts/list-custom.ps1

# 同步 vendor 分支到指定上游 ref
pwsh CUSTOMIZATIONS/scripts/sync-vendor.ps1 -Ref upstream/main -Push
```

---

## 7. AI Skills（`.agents/skills/`）

| Skill                  | 何时用                                   | 说法示例                     |
| ---------------------- | ---------------------------------------- | ---------------------------- |
| `sidex-record-change`  | 完成任何自定义改动后登记                 | 「记录这个改动」             |
| `sidex-merge-upstream` | 合并上游 / 升级版本 / 同步原仓库         | 「合并上游」「升级到 vX.Y」  |
| `sidex-release`        | 本地打包生成安装包                       | 「打个包」                   |
| `sidex-publish`        | 发布到 GitHub（tag / Release / 上传产物）| 「发布」「发 release」       |

---

## 8. Git 分支速记

| 分支             | 用途                   | 谁能写                        |
| ---------------- | ---------------------- | ----------------------------- |
| `upstream/main`  | 跟踪上游（只读）       | 只 fetch                      |
| `vendor/main`    | 上游基线（只读）       | 仅 `sidex-merge-upstream`     |
| `custom/main`    | 自定义开发主分支       | 正常开发                      |
| `feature/<name>` | 功能临时分支           | 正常开发                      |

**禁止**：未经明确指示 commit / push；手动 `git merge` vendor → custom（走 skill）；`git rebase` 改写 custom/main。
