# 会话接力 · ScCode

## 当前状态
- 快照：2026-11-13；分支 main；版本 0.6.0；**无进行中任务**。
- v0.6.0：真实扩展宿主兼容（发布版 HTTPS 下 loopback 固定 `ws`、Open VSX 远程 location 修复、native 日志/存储目录预创建与宿主兜底、notebook 数据类型导出）、WebView2 辅助窗口（`on_new_window`）、搜索面板 Searching/结果状态。验证：`npm test` 109/109、`typecheck`、`lint`、`check-docs`、Release 包冒烟（版本 0.6.0 + 搜索结果）通过；VAC 1.15.0 与 Claude Code 2.1.296 已在真实 profile 验证侧边栏/Chat 与辅助窗口。
- v0.6.0 已打包并上传 GitHub prerelease：https://github.com/zouv/sc-code/releases/tag/v0.6.0（`ScCode_0.6.0_x64-setup.exe` + `ScCode_0.6.0_x64-unpack.zip`）。

## 尚需真实环境验收
1. 工作台 trust：实际授权 UI 后确认全部扩展自动恢复；当前程序性 IPC 与合成服务测试不能替代此项。顶层 renderer 控制授权，执行 guard 不是 Node/文件系统沙箱，也不保证终止全部在途后台活动；细粒度授权/强隔离见 ROADMAP。
2. S10b / S24 扩展生态与新接入视图：真实桌面环境下对 typescript/emmet/json 内置扩展激活、依赖 `vscode.git` API 的第三方扩展、VAC/Claude Code/VSIX、Explorer Outline / Timeline / Local History / Call & Type Hierarchy / Merge Editor / Multi-Diff Editor / Bulk Edit Preview / Comments 面板交互逐项 GUI 验收；VAC 1.15.0 的侧边栏/Chat、Claude Code 2.1.296 的激活/Chat 与辅助窗口已在真实 profile 验证（2026-11-13），其余扩展矩阵仍待验收。真实宿主现默认开启，可通过 `SC_CODE_REAL_EXT_HOST=0`、`localStorage['scode.realExtHost']='0'` 或 `?realExtHost=0` 显式回退至旧 `host.cjs`。
3. 外部服务：真实补全上游/付费模型、用户 SSH/多跳/转发/remote FS、真 keyring 尚未验收。现有模型协议与 SSH 用本地隔离服务验证，不读取真实凭据；首次 SSH 主机密钥登记仍需可信渠道核验。
4. Agent 文件任务：Rust patch/regex/LSP/后台 shell 缺口与 local_exec 边界见 ARCHITECTURE §3.5；持久 journal/多文件事务/冲突检测见 ROADMAP，不能把工具声明等同于真实任务可用。
5. 体验：`--wait`、MainThread browserView、实际任务栏 Jump List 点击/About 外观与完整关窗询问流程尚需验收。
6. 性能：Debug 基线不代表 Release；包体与内存、循环 chunk/混合静态动态导入告警、Rust 遗留 warnings 待专项处理。不能声称 strict clippy/fmt 全仓通过；WASM 资产当前为 0，未启用实际加速。旧 terminal crate 已纳入回归，但未替换工作台 Tauri 终端；原历史后台 shell 问题与逃逸子进程清理仍需专项。
7. 扩展日志落盘：`extensionHost.cjs` 未打包 `@vscode/spdlog`，创建文件 logger 时记录 `ERR_MODULE_NOT_FOUND`（被捕获，不影响宿主存活），扩展日志目前只在内存/控制台；需后续补齐原生模块打包或显式降级。

## 如何复验
- npm test；npm run test:transport；npm run typecheck；npm run lint；npm audit；npm audit --omit=dev。
- cargo test --offline --workspace；在 agent/server 执行 go test -tags fts5 ./...（Windows 需可用 CGO 编译器）。
- npm run ext-host:build；npm run test:ext-host；npm run test:server（隔离本地侧车，无 provider 调用）。
- VAC/Claude 回归：`tests/ext-host-directories.test.cjs`、`tests/ext-host-notebook-api.test.cjs`、`tests/ext-host-transport.test.cjs`、`tests/ext-host-location.test.cjs` 与 `tests/auxiliary-window.test.cjs` 随 `npm test` 执行；真实宿主可用 VAC 1.15.0 / Claude Code 2.1.296 VSIX 装入隔离 profile，确认侧边栏、Chat 面板打开且扩展宿主不退出。真实 profile 需确认启动日志出现 `repaired extension location`（Open VSX → file://）与 `[aux-window] created auxiliary-*`（Open in New Window）。
- 搜索状态回归：`tests/search-status.test.cjs` 随 `npm test` 执行；在 1 万+ 文件工作区输入无命中查询，确认先显示 `Searching…`，2 秒后变为 `Searching… still running`，完成后状态隐藏并显示 `No results found`。
- npm run build；npm run smoke:dist；用 Git Bash 执行 bash check-docs.sh（Windows 不要误用 System32 的 WSL bash）。
- 真实桌面：先 npm run runtime:prepare，然后 npm run desktop:build -- --debug --no-bundle --ci（重建当前资源），再 npm run smoke:desktop（含主题/codicon 运行时样式断言）；脚本自行使用一次性 HOME/profile/工作区，拒绝仓库 .env，限时清理自己创建的进程。
- 性能：SC_CODE_HOME 设为新建一次性目录，再 npm run perf:baseline -- --exe .runtime/target/debug/ScCode.exe --seconds 30 --out .runtime/logs；完成后仅清理该测试目录，不使用真实 profile。
- 证据在忽略的 .runtime/logs/all-* 与 perf-*.json；不入库、不作为发行包。

## 不变边界
- 0.4.2 已按用户授权发布；无新的明确要求时不再提交、推送或发布其他版本；.runtime/、dist/、node_modules/、Tauri 生成物与用户状态不入库。新 helper/tests/scripts 是源码，不能漏掉。
- 不访问真实 profile、keyring、私钥、回收站，不调用付费模型；SC_CODE_HOME 同时隔离应用数据/日志/各窗口 WebView2。
- renderer fetch/proxy 每跳 URL/DNS 公网检查并钉住解析结果，直连且不使用环境/系统代理；Agent/provider 的独立网络栈未改，不能泛化为全应用防 SSRF。
- core/platform/editor 不盲拆 chunk（TDZ 黑屏风险）；数据库升级失败保留原库，不自动改名建空库。长期能力规划见 ROADMAP，不借审查擅自移除 Agent 或扩展功能。
- 不要移除 `tauri.conf.json` 的 `dangerousDisableAssetCspModification: ["style-src"]`：Tauri 的 style nonce 会使 `'unsafe-inline'` 失效，VS Code 运行时注入的主题/codicon/菜单样式会被整体拦截；script-src 等加固保持启用。
