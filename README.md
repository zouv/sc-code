# ScCode

独立桌面代码编辑器与 AI 开发工作台。以 custom-sidex 功能为迁移基线，后续独立迭代，不使用 Custom overlay，也不跟随上游同步或更新渠道。

**当前：0.1.0 开发验收版本，未签名、未发布。源码完整导入不等于全部行为验收完成。**

## Windows 开发和构建

需要 Node.js 22、npm、Rust stable（至少 1.91）、MSVC C++ 构建工具及 WebView2。准备脚本固定下载并校验 Node/内置扩展；Go agent 编译需要 Go 1.26+ 和支持 CGO 的 C 编译器。工具路径可用 `SC_CODE_GO_BINARY` / `CC` 指定（详见脚本）；本地 `.runtime/tools` 工具不会提交。

日常入口（可从任意当前目录调用）：

| 脚本 | 用途 |
|---|---|
| `setup.bat` | 安装依赖、准备固定 Node/Go/内置扩展并生成元数据 |
| `run.bat [应用参数]` | 前台启动当前 Debug 桌面；缺失或源码变化时自动重建 |
| `dev.bat` | Tauri 热更新开发，带完整 runtime 资源配置 |
| `build.bat [Debug或Release]` | 构建 NSIS 安装包及完整 unpack 免安装目录；默认 Debug |
| `release.bat` | 一键构建优化 Release 安装包及 unpack 免安装目录，不自动签名/发布 |
| `test.bat` | Node/transport/TS + 选定原生模块和桌面 lib 回归 |
| `verify.bat` | 上述测试 + 来源清单/runtime/真实本地服务/文档检查 |
| `clean.bat` | 清理生成输出；保留 packages/ 成品包、工具下载缓存、node_modules 和所有用户配置 |

所有脚本支持 `--help` / `--dry-run`；不提交、不发布、不强杀应用。清理遇到文件占用会失败，请先自行关闭对应 ScCode 实例。`test.bat` 不包含已记录失败的 sidex-agent shell timeout、sidex-terminal Unix路径与 sidex-remote 测试，不代表全 Rust 套件通过。

```powershell
Set-Location D:\Git\zgithub\sc-code
.\setup.bat
.\run.bat
.\build.bat Debug
.\release.bat
# 也可直接调用：
npm run runtime:prepare -- --test-go
npm run desktop:dev
npm run desktop:build -- --debug --target x86_64-pc-windows-msvc --bundles nsis
```

正常安装/运行请使用桌面构建；`npm run dev` 只是 web 工作台开发服务器，不包含原生服务，不代表完整编辑器运行。首次准备需要网络；构建中间产物统一收拢至 `.runtime/`：`desktop/` 是 Node、94 个内置扩展、Go exe、生产宿主及许可证，`target/` 是 Cargo/安装包，`dist/` 是前端，`public/metadata/` 是静态资源和扩展元数据，`logs/` 是本地验证日志。`downloads/tools/` 保存缓存/工具。上述不入库；`scripts/`、扩展宿主源文件、锁文件和终端集成源仍需入库。Tauri 的 `src-tauri/gen/` 是工具强制生成的 schema，也忽略；npm 依赖仍按标准放 `node_modules/`。

Release 成品包路径：`packages/release/ScCode_0.1.0_x64-setup.exe`。

Debug（dev）成品包路径：`packages/dev/ScCode_0.1.0_x64-setup.exe`。

`build.bat`、`release.bat` 及 `npm run desktop:build` 均在构建成功后导出本次新生成的安装包（NSIS `.exe`、MSI `.msi` 及其新签名），同时生成包含主程序与完整运行资源的 unpack 目录；源包保留在 `.runtime/target/.../bundle/`。`--no-bundle` 只编译，不导出历史安装包或 unpack；构建命令失败/资源缺失不覆盖成品。同名安装包更新、其它版本保留；unpack 按 Debug/Release 分开替换。`packages/` 已加入 `.gitignore`，`clean.bat` 不删除成品包。安装包文件名随版本和架构变化。

**免安装运行入口（Windows x64）：**
- Release：`packages/unpack/release/ScCode.exe`（推荐日常使用）。
- Debug：`packages/unpack/dev/ScCode.exe`（开发调试）。

双击对应 `ScCode.exe` 即可；迁移到其它位置时复制**整个目录**，不能只复制 EXE。目录包含内置 Node、Agent 侧车、扩展宿主、94 个内置扩展、终端集成、许可证、运行说明和 SHA256 文件清单，不含 Cargo 缓存、PDB 或用户配置。无需另外安装 Node 或保留源码仓库，但电脑必须已有 **Microsoft Edge WebView2 Runtime**；unpack 不执行安装器的 WebView2 引导下载。

免安装不等于数据内置的 portable 模式：默认用户数据仍是 `%APPDATA%\ScCode`，可用 `SC_CODE_HOME` 指定其它目录。不要在 unpack 目录内存放项目/用户数据；检测到额外文件或目录会拒绝替换，避免重打包误删。重打包前关闭该 unpack 应用；脚本不会强杀占用进程。

## 数据迁移

1. 完全关闭旧 Sc-Code、SideX/custom-sidex 和其 agent；首次启动 ScCode 时确认导入源。
   首次提示不是报错：确定后导入，取消退出本次启动且下次仍提示。显示名和默认 profile 目录统一为 ScCode。
2. Windows 默认 profile 为 `%APPDATA%\ScCode`，优先从同级旧 `%APPDATA%\Sc-Code` 导入，再考虑 SideX 等旧来源。旧配置、扩展、profile、工作区/agent 数据只复制缺失项；不覆盖目标，不移动或删除来源。
3. SQLite 使用一致快照并跳过 WAL/SHM；其它数据库仍要求旧应用停止。目标冲突保留现有数据，异常不删除数据库假恢复。
4. Sc-Code 改名迁移继承已完成来源记录，防止从 SideX 重新导入用户删掉的数据。扩展凭据保存稳定的非秘密 profile 身份，延用旧目录的凭据命名；OS keyring 服务 ID 不变，旧凭据保留，keyring 不可用会报错而非明文保存。真实 keyring/旧数据 GUI 迁移仍待验收。
5. 旧 WebView 历史状态和第三方扩展兼容性尚未全量验收；保留旧数据作为恢复源。目标已有文件时不会自动合并内容。

### 隔离测试 / 自定义 profile

```powershell
$env:SC_CODE_HOME = 'D:\Temp\sc-code-test-profile'
# 设置 HOME 后默认不探测/导入真实旧 profile；需要时显式指定合成源：
$env:SC_CODE_MIGRATION_SOURCES = 'D:\Temp\synthetic-old-profile'
# 多来源在 Windows 用分号；Linux/macOS 用冒号
npm run desktop:dev
```

WebView、原生数据、扩展宿主及自管 agent 使用同一新 profile 根。关闭应用后清除测试环境变量，避免误把测试 profile 当默认应用。

内置 Agent 面板每次启动默认收起，包括旧版保存为展开的布局；本次会话可手动打开。仅修改面板恢复策略，不移除内置 Agent 或停止后台 Go 服务；ACP 替换仍是后续独立任务。

## 扩展状态与凭据

- `globalState` 位于 `<profile>/data/User/globalStorage/<extension-id>/.sc-code-state.json`；`workspaceState` 位于 `<profile>/data/workspaceStorage/<workspace-hash>/<extension-id>/.sc-code-state.json`。多根有序路径/工作区文件 URI 区分身份；空工作区的 workspaceState 仅内存。
- 旧扩展目录 `.global-storage`/`.storage` 首次只复制缺失文件；旧共享 workspace 文件按每个工作区首次使用作种子，之后隔离。原宿主内存 Map 中未落盘的状态/秘密无法恢复，不能以文件复制承诺恢复这些值。
- 保存串行、锁保护、重读合并、临时文件 fsync/rename；损坏/失败报错，不清空数据。崩溃残留 `.lock` 不自动抢占；遇锁错误应停止相关实例并保留数据等待恢复，勿在运行时手动删锁。
- 扩展 secrets 经 Workbench → 原生 OS keyring，失败不改存明文；目前仅自动验证模拟 native 回包和原生命名逻辑，**真实 OS keyring 桌面链路仍待验收**。命名隔离不是原生扩展安全沙箱。
- Memento 的 `setKeysForSync` 尚未实现云同步，缓存/secret change 不跨窗口实时广播；CJS 更新可重载，ESM 初次加载支持顶层 await，但 ESM 热重载仍需重启策略。

## 验证

```powershell
npm run verify:import
npm test
npm run test:transport
npm run typecheck
cargo test -p sc-code-runtime -p sidex-auth -p sidex-workspace -p sidex-settings -p sidex-extensions
cargo test -p sc-code --lib
npm run runtime:prepare -- --test-go
npm run test:server
# Git Bash 执行
bash check-docs.sh
```

`npm test` 包含实际 fork 生产 Node 宿主的合成扩展测试；不读取用户 profile 或真实 keyring。`test:server` 启动真实 Go exe，只用临时 profile 和随机凭据，验证 REST/WS/Origin/Host；不注入用户 API key，不调用模型。

## 实验开关：真实 Node 扩展宿主

默认仍使用旧的 `host.cjs` 仿制宿主。启用 VSCode 真实扩展宿主（`src/vs/workbench/api/node` + `extensionHost.cjs`）：

```powershell
npm run ext-host:build          # 构建 .runtime/ext-host/extensionHost.cjs
$env:SC_CODE_REAL_EXT_HOST='1'  # 构建期注入；也可用 ?realExtHost=1
npm run desktop:dev
```

真实宿主通过 loopback WebSocket + `PersistentProtocol` 通信，扩展在独立的 Node 进程中运行；`extension-host/extensionHost.cjs` 会随 `runtime:prepare`/打包进入运行资源。当前为实验路径，第三方扩展矩阵尚未验收。

性能基线：`npm run perf:baseline`（冷启动到窗口时间 + 进程树工作集，输出 `.runtime/logs/perf-*.json`）。设置/UI 状态在桌面版存于 profile 内 SQLite，首次启动自动从 IndexedDB 复制一次。

## 兼容与安全边界

- 原 command/settings IDs 和 VS Code API 1.110.0 保留；产品版本独立。原定制功能基线见 `docs/history/custom/registry.md`，3704 项来源清单见 `docs/import-manifest.json`。
- 扩展发现不再静默封禁固定 ID。可通过 `SC_CODE_DISABLE_EXTENSION_IDS`（逗号分隔、大小写不敏感）禁用；旧 `SIDEX_DISABLE_EXTENSION_IDS` 作为显式 alias。发现不等于兼容：专有 API/身份服务/扩展许可需逐项验证。
- 自管 Go/Node 使用每进程 token，只监听 loopback。独立手动启动 Go server 必须配置 `SC_CODE_LOCAL_TOKEN`；只有桌面自管链路会自动传凭据，远程 server 凭据 UI 尚未实现。
- 默认关闭旧自动更新和遥测；`SC_CODE_TELEMETRY=1` 显式启用遥测。`SC_CODE_LIVE_PRICING=0` 可禁用 OpenRouter 公共定价刷新；这不是 telemetry 开关。
- 当前 checkpoint 是内存恢复与单文件冲突保护，不是持久化多文件事务，也不保证回滚任意 shell/Git/worktree 副作用。
- CSP/trust 尚未完善；不要把当前版本当作完全沙箱，不要运行不可信扩展/项目。秘密索引 secure_delete 不能保证旧 WAL/空闲页已彻底擦除。
- Windows x64 打包链路已实测；其它平台、签名、安装升级、全部 GUI/扩展矩阵和性能基准仍待验收。

## 维护入口与许可

`AGENTS.md` 工作规则；`ARCHITECTURE.md` 链路导航；`ROADMAP.md` 完成度；`HANDOFF.md` 待办；`CHANGELOG.md` 用户变更。

本项目保留 `LICENSE` 和第三方版权/许可声明；独立项目不意味着移除来源归属。未自动提交、推送或发布。
