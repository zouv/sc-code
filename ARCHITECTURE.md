# 代码链路图谱 · ScCode

## 0. 一句话架构
独立 VS Code web 工作台 + Tauri/Rust 桌面装配 + 受监督 Node 扩展宿主 + Go AI agent；保留 API/命令兼容边界，逐步统一 Workspace Runtime。

## 0.5 作用域路由
| 任务 | 读取入口 | 忽略 |
|---|---|---|
| 自有功能与移植 | src/main.ts、src/sc-code/、docs/import-manifest.json | agent 内部 |
| 品牌与图标 | public/sc-code.svg、docs/icons/README.md、index.html、src/bootstrap-globals.ts、src-tauri/tauri.conf.json、src-tauri/icons/、tests/branding.test.cjs | SVG紫灰/淡紫，平台图标同步；ScBrowser只读，profile/协议 ID 不可盲改 |
| 关于/标题栏布局 | src/vs/workbench/browser/parts/dialogs/dialogHandler.ts、src/vs/base/browser/ui/dialog/{dialog.ts,dialog.css}、src/vs/workbench/browser/parts/titlebar/{titlebarPart.ts,media/titlebarpart.css} | 对话框通用按钮/输入逻辑、窗口状态恢复 |
| 任务栏跳转列表 | src-tauri/src/taskbar.rs、src/sc-code/taskbar/recentJumpList.contribution.ts、src-tauri/src/lib.rs、src-tauri/capabilities/default.json、src-tauri/src/commands/window.rs | Jump List 之外的 shell 集成、真实宿主 |
| Agent/ACP替换评估 | agent/server/{cmd/server,internal/{agent,tools,prompt,api}}、src-tauri/src/{server,commands/orchestrate}.rs、scCodeChat/、scCodeComplete/ | Node扩展宿主/编辑器共享工具不可整删 |
| 启动与 profile | src-tauri/src/app_dirs.rs、src-tauri/src/lib.rs、src-tauri/src/commands/window.rs | 全量工作台 |
| webview 隔离/IPC 来源守卫 | src-tauri/src/{webview_host,ipc_guard}.rs、src-tauri/src/lib.rs（invoke_handler 包装）、public/webview-pre/index.html（signalReady）、src/main.ts、environmentService.ts / webviewExternalEndpoint | src/vs/.../webview/browser/pre/ 为未服务的源副本 |
| 配置保存 | src-tauri/src/commands/settings.rs、crates/sc-code-settings/src/settings.rs、crates/sc-code-workspace/src/file_ops.rs | AI/UI |
| 扩展发现/重载/状态 | src-tauri/src/commands/extension_platform.rs、crates/sc-code-extensions/src/paths.rs、src-tauri/extension-host/{host,server,storage}.cjs、同目录 *.test.cjs | Go tools |
| 扩展 secrets 桥 | src-tauri/src/commands/secrets.rs、crates/sc-code-auth/、src-tauri/extension-host/{storage,host}.cjs、src/vs/workbench/contrib/extensions/browser/tauriExtensionHost.contribution.ts | provider 请求逻辑 |
| 聊天与本地鉴权 | src/vs/workbench/contrib/scCodeChat/browser/{scCodeChatService,localServer}.ts、src-tauri/src/server.rs、agent/server/internal/auth/local_transport.go | 扩展视图 |
| 文件与回滚 | crates/sc-code-runtime/src/、crates/sc-code-workspace/src/file_ops.rs、agent/server/internal/tools/ | UI themes |
| 日常脚本/运行输出 | *.bat、scripts/{daily,build-desktop,package-output,unpack-output}.cjs、.cargo/config.toml、vite.config.ts | 真实用户 profile 与 dist/ 成品包不清理；旧 packages/ 由 clean 清理 |
| 仓库布局/忽略规则 | .gitignore、.gitattributes、嵌套.gitignore、tests/repository-layout.test.cjs、docs/import-manifest.json | .runtime/ 与 dist/ 成品包、用户状态不可入库；生产DLL/WASM/图标不可整类忽略 |
| 打包验证 | scripts/desktop-runtime.cjs、scripts/prepare-desktop-runtime.cjs、scripts/build-desktop.cjs、scripts/smoke-local-server.cjs、tests/、.github/workflows/ | 历史 workflow |
| 真实扩展宿主 | src/vs/workbench/api/node/{scCodeExtHostMain,extHost.sc-code.services}.ts、src/vs/workbench/services/extensions/browser/tauriProcessExtensionHost.ts、src-tauri/src/commands/real_ext_host.rs、scripts/{build-ext-host,vendor-ext-host-node}.cjs | 旧 host.cjs 逻辑 |
| 工作台存储 | src/vs/workbench/services/storage/browser/{storageService,tauriStorageDatabase}.ts、src-tauri/src/commands/storage.rs | 用户 profile 数据 |
| 文件系统/搜索/终端/监听 IPC | src/vs/platform/files/browser/tauriFileSystemProvider.ts、src/vs/workbench/services/search/browser/tauriSearchService.ts、src/vs/workbench/contrib/terminal/browser/tauriTerminalBackend.ts、src-tauri/src/commands/{fs,search,terminal,watch}.rs、src-tauri/src/recycle_bin.rs、crates/sc-code-workspace/src/search.rs | process.rs/sc_code_terminal.rs 的另两套终端（未接入工作台） |
| 性能基线 | scripts/perf-baseline.cjs、vite.config.ts（分包/sourcemap） | 业务逻辑 |

## 1. 文件职责
- public/sc-code.svg：无字体依赖的 SC/编辑器矢量品牌源；Tauri icon 派生 src-tauri/icons/ 的 PNG/ICO/ICNS；index.html favicon 与 titlebarpart.css 共用矢量。tests/branding.test.cjs 验证显示名、资产接入与尺寸。
- docs/icons/：用户选定 D 版图标资源包，也是应用图标导出源（sc-code.svg、16–1024px PNG、七帧 ICO 与 README）；public/sc-code.svg 与 src-tauri/icons/ 已由该包替换。
- src-tauri/src/taskbar.rs：Windows 任务栏 Jump List（最近文件夹/工作区）与单实例转发；仅接受 file: URI，参数用 base64 URL-safe 编码；Win32 COM/窗口代码集中在 windows_impl / windows_single_instance。
- src/sc-code/taskbar/recentJumpList.contribution.ts：监听 IWorkspacesService 最近列表，去抖后调用 taskbar_update_jump_list；仅 Tauri 环境注册，非 Windows 后端 no-op。
- src/sc-code/：VSIX 安装/拖拽、accessibility 服务、profile 扩展同步；普通功能模块，不走 Custom overlay。
- src/vs/：保留定制 workbench；内部命令/设置 ID 统一使用 sc-code 前缀，不代表上游关联。
- src-tauri/src/lib.rs：原生装配、独立资源、数据库失败保留原文件（state DB 改名为 `*.db.corrupt-<ts>` 再新建）、退出清理；setup 内用 build_workbench_window 创建 main 窗口（conf 中 `create:false`）；应用命令经 ipc_guard 包装后才进入 generate_handler。
- src-tauri/src/webview_host.rs：回环 HTTP（127.0.0.1:随机端口）只提供 public/webview-pre 的 index/fake/service-worker（include_bytes!），作为扩展 webview 独立来源。
- src-tauri/src/recycle_bin.rs：move_to_trash（Windows SHFileOperationW+FOF_ALLOWUNDO，unsafe 仅限 windows_impl）；其它平台返回不支持。
- src-tauri/src/ipc_guard.rs：按 IPC 请求浏览器设置的 Origin 放行工作台来源（tauri.localhost；`tauri dev` 下加 devUrl），其余拒绝。
- src-tauri/src/app_dirs.rs：独立 profile 与隔离测试环境。
- crates/sc-code-runtime/：冲突保护 checkpoint；当前为内存单文件边界。
- crates/sc-code-settings/：JSONC 和分层设置；crates/sc-code-auth/：OS keyring 与非秘密元数据。
- crates/sc-code-extensions/src/paths.rs：扩展安装/profile/globalStorage 路径；tests/profile_paths.rs 以子进程验证 SC_CODE_HOME。
- src-tauri/extension-host/：5 个生产 CJS 文件，带本地会话 token；storage.cjs 专管 profile 路径、持久 Memento、旧存储只复制、显式禁用和 secret 请求接口。
- src-tauri/extension-host/host-behavior.test.cjs：实际 fork 生产宿主，合成扩展验证配置门、TreeView、重启/工作区状态、dialog URI 回包、CJS 入口更新、ESM 和 secret 成败；不接触真实用户 keyring。
- src-tauri/src/commands/secrets.rs + Workbench 扩展桥：extension_secret 命令与请求/结果转发；不把秘密写入 Memento。
- agent/server/：Go agent 和受认证本地 HTTP/WS。
- scripts/daily.cjs + 8 个 BAT：setup/run/dev/build/package/test/verify/clean；foreground+exitCode，sourceFingerprint 拒绝旧源码包；cleanTargets 先验证全部绝对路径/链接，仅删允许生成物，不强杀、不碰用户 profile。
- scripts/build-desktop.cjs / package-output.cjs：buildDesktop(args,{exportPackages}) 在 exportPackages=false 时只编译（build.bat）；为 true 时（package.bat / release）先prepareUnpack校验，再用exportUnpacked把未压缩运行目录发布到`dist/<dev|release>/unpack`，随后archiveUnpack以该目录为源生成zip（zip根目录无版本子目录）；Release再按构建前快照只选新NSIS/MSI及签名并exportPackages至dist/release；失败不导出旧包。buildPaths解析Debug/target并固定.runtime输出；package.bat 依次跑 Debug 与 Release 两个通道。tests/package-output.test.cjs隔离验证分类、旧包、失败、清理保留与链接拒绝。
- scripts/unpack-output.cjs：validateUnpack校验已构建profile内Node/Go/5CJS逐文件hash、扩展treeHash/94项清单；prepareUnpack复制EXE+运行资源+同级DLL+许可证至.runtime/package-staging（Debug另含PDB），exportUnpacked用partial目录校验后替换`dist/<mode>/unpack`，archiveUnpack用scripts/zip-writer.cjs（纯Node deflate/读取校验，无系统zip/tar依赖）以unpack目录为源生成根目录无版本子目录的zip，随后删除暂存目录。Release zip不含Cargo缓存/PDB/用户文件；拒绝链接与测试模块。tests/unpack-output.test.cjs与unpack-fixture.cjs验证资源契约、源码搬离、dev/release命名与内容、zip根条目、失败保护。
- .cargo/config.toml / vite.config.ts / scripts/dev-desktop.cjs：Cargo 输出 .runtime/target，前端 .runtime/dist、public，开发扩展 URL 指向 .runtime/desktop/extensions；runtime overlay .runtime/tauri.runtime.conf.json。
- scripts/runtime-lock.json：固定 Windows Node/内置扩展下载与 SHA256；生成资源不纳入版本管理。
- docs/import-manifest.json + scripts/verify-import.cjs：3664 项保留来源校验，允许独立修改但不许遗漏；7 个重复 shell-integration 以 consolidated-source 指向已有同 hash 终端源，只有一个 canonical 条目且 hash 相同才允许目标复用。

- .gitignore / .gitattributes / tests/repository-layout.test.cjs：根级生成目录与源码分离；临时Git仓库复制全部忽略规则，用--no-index核验来源清单可见性、源码资源/锁文件保留、本地状态排除和Bash/BAT行尾，不受真实index或全局忽略掩盖。

## 2. 任务定位（函数名优先，源码为准）
| 任务 | 文件 / 函数 |
|---|---|
| 忽略规则/干净检出完整性 | tests/repository-layout.test.cjs / fixture、ignoredPaths；scripts/verify-import.cjs / verifyImport |
| 日常操作/安全清理 | scripts/daily.cjs / main、launch、sourceFingerprint、cleanTargets、clean |
| 成品包分类/安全导出 | scripts/build-desktop.cjs / buildDesktop → scripts/package-output.cjs / buildPaths、installerSnapshot、freshInstallers、exportPackages、assertLocalPath |
| 免安装完整性/发布 | scripts/unpack-output.cjs / validateUnpack、prepareUnpack、exportUnpacked、archiveUnpack、exportUnpack、removeStage；scripts/zip-writer.cjs / writeZip、readZipEntries、readZipEntry |
| 稳定凭据身份 | src-tauri/src/commands/secrets.rs / SecretsStore::new、select_extension_profile_id、profile_hash |
| Agent默认收起 | src/vs/workbench/browser/layout.ts / WorkbenchLayoutStateModel.load、LayoutStateKeys.SC_CODE_HIDDEN |
| 关于对话框图标 | dialogHandler.ts / BrowserDialogHandler.about；base ui/dialog/dialog.ts / Dialog 构造（imageIcon → dialog-image-icon） |
| 标题栏应用图标顺序 | titlebarPart.css / .window-appicon、.menubar、.sc-code-project-name 的 order（0/1/2） |
| 任务栏最近记录 | recentJumpList.contribution.ts / update、toEntries；taskbar.rs / taskbar_update_jump_list、parse_open_target、prepare_entries、windows_impl::update |
| 单实例转发 | taskbar.rs / ensure_single_instance、install_single_instance、windows_single_instance::{send_arguments,window_proc}；commands/window.rs / open_target_window |
| webview 独立来源 | webview_host.rs / start、respond、WebviewHost::origin；lib.rs / webview_host_origin；main.ts 写 `__SC_CODE_WEBVIEW_ORIGIN__`；environmentService.ts / webviewExternalEndpoint |
| IPC 来源守卫 | ipc_guard.rs / is_trusted_origin、dev_origin；lib.rs / invoke_handler 闭包 |
| 窗口创建与 WebView 数据目录 | commands/window.rs / build_workbench_window、isolated_webview_data_dir、open_target_window |
| 通用 Git 命令白名单 | crates/sc-code-git/src/operations.rs / validate_git_args、ALLOWED_GIT_SUBCOMMANDS、BLOCKED_GIT_FLAGS → commands/git.rs / git_run |
| 关窗询问 | closeHandler.contribution.ts / requestClose、ScCodeCloseHandler；window.rs / close_window（先 approve_close）；lib.rs / on_window_event(CloseRequested) |
| 命令行参数 | taskbar.rs / parse_cli_target、split_position；main.ts / openFileFromCommandLine（`_workbench.open` + selection）|
| 保存时处理 | saveParticipants.ts / SaveParticipantsContribution（trim/final newline/formatOnSave/codeActionsOnSave）→ 由 workbench.common.main.ts 以 registerWorkbenchContribution2 注册 |
| 面包屑符号 | documentSymbolsOutline.ts / DocumentSymbolsOutlineCreator（自注册 IOutlineService）|
| 配置读写 | src-tauri/src/commands/settings.rs / SettingsStore、settings_get、settings_update |
| 完整合并与删文件刷新 | crates/sc-code-settings/src/settings.rs / merged、replace_user_layer |
| 单文件原子写 | crates/sc-code-workspace/src/file_ops.rs / write_file_bytes_with_options |
| 扩展发现与启动 | src-tauri/src/commands/extension_platform.rs / scan_extensions、extension_platform_bootstrap |
| 扩展 profile 路径 | crates/sc-code-extensions/src/paths.rs / sc_code_config_dir、extensions_base_dir |
| 状态/禁用策略 | src-tauri/extension-host/storage.cjs / extensionStoragePaths、workspaceKey、createMemento、withStateLock、atomicState、disabledExtension |
| 宿主配置门/工作区/重载 | src-tauri/extension-host/host.cjs / _handleInitialize、_handleLoadExtension、_activateExtension、_reloadExtension、_loadExtensionModule、_createExtensionContext |
| 扩展密钥链路 | storage.cjs / createSecretStorage → host.cjs / _requestExtensionSecret → tauriExtensionHost.contribution.ts / _onExtensionSecretRequest → secrets.rs / extension_secret、extension_secret_key |
| Provider 纯逻辑与安全测试 | src-tauri/src/commands/providers.rs / resolve_direct_with_key；不以明文降级替代测试依赖注入 |
| Go 端口/凭据 | src-tauri/src/server.rs / ServerEndpoint、ServerProc |
| 前端凭据与重连 | localServer.ts / localServerHeaders、localStreamUrl、invalidateServerEndpoint；scCodeChatService.ts / _sendWithContext |
| 原生 agent WS | src-tauri/src/commands/orchestrate.rs / run_agent_session |
| 本地接口安全 | agent/server/internal/auth/local_transport.go / LocalTransportMiddleware |
| 准备与真实侧车验收 | scripts/prepare-desktop-runtime.cjs；scripts/desktop-runtime.cjs / assertPrepared；scripts/smoke-local-server.cjs / smoke、request |
| 真实扩展宿主构建 | scripts/build-ext-host.cjs（esbuild → `.runtime/ext-host/extensionHost.cjs`）；scripts/vendor-ext-host-node.cjs 从 VSCode 1.110.1 补齐 `src/vs/**/node`；入口 src/vs/workbench/api/node/scCodeExtHostMain.ts |
| 真实宿主连接 | src/vs/workbench/services/extensions/browser/tauriProcessExtensionHost.ts / start、_createExtHostInitData、isRealExtensionHostEnabled；src-tauri/src/commands/real_ext_host.rs / real_ext_host_start、strip_verbatim、read_endpoint |
| 真实宿主开关与注册 | src/vs/workbench/services/extensions/browser/extensionService.ts / _scanWebExtensions、_registerDiskExtensions、ScCodeExtensionHostKindPicker；extensionSync.contribution.ts 在真实宿主下让路 |
| 工作台存储 | storageService.ts / createTauriOrIndexedDbStorage（首次从 IndexedDB 迁移）；tauriStorageDatabase.ts / updateItems → storage.rs / storage_apply、StorageDb::apply（单事务） |
| 文件读写/删除 | tauriFileSystemProvider.ts / readFile、writeFile、delete、classify（按 os error 码映射）→ fs.rs / fs_read_binary、fs_write_binary（raw body + `sc-path` 头）、fs_trash；tauriUserDataProvider.ts 覆盖 capabilities（profile 数据不进回收站） |
| 文本/文件搜索 | tauriSearchService.ts / textSearch、fileSearch、folderExcludes、unconditionalGlobs → search.rs / search_text_stream、search_workspace_files、search_cancel、to_text_match → crate search.rs / search_streaming、search_workspace_files、collect_files_with_options、workspace_walker、relative_slash_path |
| 终端 IO | tauriTerminalBackend.ts / TauriPty.start、acknowledgeDataEvent → terminal.rs / terminal_spawn（Channel<TerminalEvent>、退出等待线程）、terminal_ack、FlowControl、Utf8Stream；os.rs / get_windows_build_number |
| 文件监听 | tauriFileSystemProvider.ts / watchMapped（每 watch 一条 Channel）→ watch.rs / watch_start(on_batch)、WatchSink、coalesce_events、event_kind_to_string |
| 自定义编辑器 | src/vs/workbench/contrib/customEditor/**（上游恢复）、workbench.common.main.ts、tauriExtensionHost.contribution.ts（registerCustomEditorProvider 仅记录） |
| 真实宿主 Node 服务 | src/vs/workbench/api/node/extHost.sc-code.services.ts、extHostDebugService.ts、platform/sign/**、workbench/contrib/debug/node/**、platform/externalTerminal/node/**；scripts/build-ext-host.cjs（external: @vscode/windows-process-tree） |
| 扩展宿主进程管道 | src-tauri/src/commands/real_ext_host.rs / read_handshake（握手后继续排空 stdout）、stderr 排空线程 |
| 关窗确认 | src/sc-code/window-close/closeHandler.contribution.ts、src-tauri/src/lib.rs（on_window_event）、src-tauri/src/commands/window.rs（approve_close/take_close_approval）|
| 命令行打开 | src-tauri/src/taskbar.rs / parse_open_target、parse_cli_target、split_position、OpenTarget::app_url；src/main.ts / openFileFromCommandLine |
| 保存参与者/面包屑 | src/vs/workbench/contrib/codeEditor/browser/{saveParticipants,editorFeatures}.ts、outline/documentSymbolsOutline.ts、outline/documentSymbolsTree.ts；workbench.common.main.ts（注册 SaveParticipantsContribution）|
| notebook 空桩 | src/vs/workbench/scCodeNullServices.ts / NullNotebookService、NullNotebookEditorService（文本搜索依赖其方法返回空） |
| 懒启动/性能 | src-tauri/src/server.rs / server_endpoint（首次调用才 spawn）；extension_wasm.rs / state()（首次加载才建 engine）；scripts/perf-baseline.cjs |

## 3. 关键链路与反模式
1. 启动：独立 app_data_dir → 原生服务 → 受监督 Go/Node；自动更新和遥测默认关闭。原生/WebView/扩展/agent 共用 SC_CODE_HOME 根；不要拿真实 profile 做自动测试。
3. 聊天：预留 pending 轮次 → 单次重连发送 → generation 防止取消后迟发；断连必须失效旧 endpoint/token。
4. 本地 API：仅 loopback + Host/Origin 校验 + 随机每进程 token；health 无 token，其余 REST Bearer；query token 仅 WS upgrade。
5. 打包：固定下载 hash → 94 个真实内置扩展 + Node + Go + 5 CJS host → preflight → frontend/native → NSIS + unpack 目录 + zip；unpack只从同次已构建profile资源导出，不拼接当前源码runtime；逐文件hash与extensionsHash验证，hostSourceHash为源码含开发shim指纹，不等于发布host目录hash；不得把空宿主目录当成功。`build.bat` 只编译不导出；`package.bat` 一次跑 Debug（`dist/dev/unpack` + `-debug` zip，含PDB）与 Release（`dist/release/unpack`、setup exe、zip），zip根目录直接是程序文件，不含版本外壳目录。修改 host 后必须重做 runtime:prepare 与包；测试 CJS 不打入生产目录。
6. 配置更新按 mutation锁 → JSONC读取/验证 → 单文件原子写并保permissions → 内存层更新；落盘失败返回错误；删除文件清旧层，merged保留扩展键。
7. 扩展状态：profile/global 或 workspace hash → 缺失旧文件只复制 → JSON snapshot → 本对象 Promise 队列 + 跨对象/进程 wx锁 → 重读合并 → fsync临时文件/rename → 更新缓存；失败不可假成功。锁超时保留文件，不自动抢占崩溃残留锁。
8. 工作区变化：Workbench 先关闭配置门 → initialize变更 identity/folders → detach旧 context → 配置快照 → release → 新 context激活。CJS更新撤销旧命令/订阅/require缓存并刷新 manifest入口；ESM缓存不能真正热重载，尚需宿主重启策略。
9. secrets：Node reqId/pending/10s timeout → Workbench native invoke → profile+extension+key namespace OS keyring → extensionSecretResult → 仅成功后发本 context change。禁止内存/明文 fallback；不得日志记录 value。
10. 扩展默认无固定黑名单；SC_CODE_DISABLE_EXTENSION_IDS 覆盖发现、预载、直接加载和激活。发现/激活成功不代表 API/服务/许可兼容。
11. ESM shim 写 profile/runtime 而非安装目录；file URL 用 pathToFileURL，顶层 await 触发 ERR_REQUIRE_ASYNC_MODULE 时转 import。
12. 数据损坏/锁占用必须可见报错并保留文件，禁止删除 DB 后假恢复。

13. Git边界：logs/dist/out/build规则限定根目录，不按“扩展未完成”忽略源码；.runtime/与dist/始终排除。来源清单物理文件校验与Gitignore回归必须同时通过；首次提交还需从index干净导出核验完整性。Bash入口固定LF并保留可执行位，BAT保持CRLF。

14. 任务栏最近记录：WorkspacesService 持久化最近文件夹/工作区 → 贡献点监听 onDidChangeRecentlyOpened 去抖 → invoke taskbar_update_jump_list(entries) → Rust 过滤非 file: URI/去重/限 10 条 → Windows ICustomDestinationList 写“Recent Folders / Recent Workspaces”分类。条目命令为 `ScCode.exe --open-folder=<base64>` 或 `--open-workspace=<base64>`。
15. 单实例：进程启动先按 profile 数据目录 hash 创建命名 mutex；已有实例则通过隐藏窗口 WM_COPYDATA 转发 argv 后退出。首个实例在 setup 创建隐藏窗口，收到参数后 `run_on_main_thread` 打开带 `?folder=`/`?workspace=` 的新窗口；无目标参数时聚焦 main。禁止两个进程同时打开同一 profile 的 SQLite。
16. webview 隔离：工作台 → iframe `http://127.0.0.1:<port>/index.html`（webview_host）→ 同源内层 fake.html 承载扩展内容；SW 在真实 HTTP 上注册。Windows 上 wry 把 Tauri IPC 脚本（含 invoke key）注入**所有** frame，Tauri 对无 ACL 清单的应用命令不查来源、且把任何自定义协议都视作本地——所以：①webview 不得用自定义协议承载（会被视为本地且 SW 主脚本抓取失败）；②应用命令靠 ipc_guard 校验自定义协议 IPC 的 Origin（浏览器设置、不可伪造）；③postMessage 回退的 headers 可伪造，安全前提是 wry 只订阅顶层 WebMessageReceived、子 frame 消息到不了 Tauri。升级 wry/Tauri 后须用 CDP 复验（WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=<p>：webview frame 内 invoke 应被拒、劫持 fetch 取 key 后经 `window.ipc.postMessage` 伪造 Origin 写文件应无效果、主页面对照应成功）。
18. 关窗：原生 CloseRequested 未被 approve 时 prevent_close 并 eval `window.__sc_code_request_close()`；前端用 `IEditorService.editors.filter(isDirty)` 判断（`IWorkingCopyService.modifiedWorkingCopies` 在本移植里不填充），三按钮 prompt 后：取消/保存失败→不关；保存→`saveAll` 成功后调 close_window；不保存→直接 close_window。`close_window` 先写 approve 标记再 close，标记一次性消费。
19. 命令行：argv[1..] 里找第一个存在的绝对路径（目录→folder，文件→file），`-g/--goto` 或 `路径:行[:列]` 带位置；URL `index.html?file=<uri>&line=&column=`；main.ts 用父目录作为工作区并在命令服务就绪后 `_workbench.open`（options 走 `[column, options]`，`vscode.open` 会丢弃 options）。
17. 文件/搜索/终端 IPC：重活一律 `#[tauri::command(async)]` 或 async+spawn_blocking（同步命令跑在主线程）；对调用顺序敏感的命令（终端写入、设置、聊天会话）保持同步。文件内容走 `tauri::ipc::Response`/raw body，禁止 `Vec<u8>`↔`number[]`。搜索列号一律 UTF-16（Rust 侧转换），glob 按工作区相对 `/` 路径匹配、排除目录在遍历时剪枝；文本搜索必须经 SearchModel 的 notebook 段，notebook 空桩不得缺方法。终端输出 = 每终端 Channel（data…exit 有序），按 UTF-16 字符计流控（高 10 万/低 5 千，最长暂停 5s）；Windows ConPTY 退出靠等待线程 try_wait→记录退出码→释放 PTY，不能等读端 EOF。监听事件按路径合并：add+change=add、add+remove=无、remove+add=change。

## 3.5 品牌与 Agent 替换边界
- 显示品牌统一 ScCode（含 native菜单/窗口、extension env、终端 TERM_PROGRAM、Go模型请求标题与prompt）；Cargo bin 为 ScCode。PROFILE_DIR_NAME 为 ScCode，identifier dev.sccode.app、sc-code 协议/命令/设置统一使用 ScCode 标识。
- 内部实现与外露标识统一为 `sc-code-*` / `sc_code_*`（Rust crate、WASM 包、`agent/`、`sc-code-agent` 进程、`sc-code.*` 命令/设置 ID、`sc-code://` 协议、`.sc-code` 目录、`sc-code.toml` 扩展清单、keyring 服务名与数据目录）。
- 内置 Agent 为受监督Go进程 + Rust local-exec工具桥 + Workbench chat/inline/orchestration；registerAll有66种工具声明，不等于每个后端已端到端验收。browser工具未在Go registry启用，云agent无远端实现。
- Agent工具链部分未打通：crates/sc-code-agent/src/tools/lsp.rs仅返回说明文本；Rust dispatch缺patch_file/regex_replace以及后台shell/read_lints等处理，而Go LocalExecTools会把它们派本机；orchestrate/run_agent_session传local_exec=false，server又禁止非sandbox的workspace执行，不能承诺真实文件任务已可用。后续ACP必须验收真实行为、不能只测工具声明/成功回包。
- Tab FIM默认指向本地agent但前端请求 /v1/completions、本地路由 /complete，且后者依赖 VLLM_URL；不可将现有注册UI认作可用补全。ACP替换应单列补全服务。
- 内置 Agent 的 SC_CODE_HIDDEN 默认 true，load 覆盖旧可见状态；每次启动收起，本次会话仍可手动打开。未停 Go 自启，未移除Agent。推荐 AgentBackend → ACP客户端/进程transport → session/权限/文件/终端能力契约验收 → 停止自启Go → 删除推理/provider/用量及Agent专属数据/构建依赖；editor共享LSP/index/terminal与Node扩展宿主保留。

## 3.6 真实 Node 扩展宿主（S10a）

开关：`SC_CODE_REAL_EXT_HOST=1`（构建期）或 `?realExtHost=1` / `localStorage['scode.realExtHost']='1'`。关闭时仍走 `host.cjs` 仿制宿主。

```
构建：npm run ext-host:build
  └─ esbuild: src/vs/workbench/api/node/scCodeExtHostMain.ts → .runtime/ext-host/extensionHost.cjs (CJS, node22)
       ├─ extHost.common.services + extHost.sc-code.services（Node 版服务注册）
       ├─ ExtensionHostMain（VSCode 真实扩展宿主）
       └─ ws server (127.0.0.1, token 校验) + PersistentProtocol

启动：workbench ExtensionService._initialize
  ├─ hasLocalProcess = isRealExtensionHostEnabled()
  ├─ ScCodeExtensionHostKindPicker：ui/workspace/web 全部 → LocalProcess
  ├─ _scanWebExtensions → _registerDiskExtensions（先 list_installed_extensions + installFromLocation）
  └─ TauriProcessExtensionHost.start()
       ├─ invoke real_ext_host_start → Rust spawn Node（strip_verbatim，token 环境变量）
       ├─ BrowserSocketFactory.connect(ws://127.0.0.1:port?token)
       ├─ PersistentProtocol → 等 Ready → 发 initData → 等 Initialized
       └─ ExtensionHostManager 接管 RPC（mainThread* 客户）
```

约束：`ICustomEditorService` 来自恢复的 `contrib/customEditor/browser/customEditors.ts`，`MainThreadCustomEditors` 依赖它；旧宿主无法 resolve 自定义编辑器，因此 contributed 编辑器在旧宿主下不注册（`isRealExtensionHostEnabled()` 门控），旧宿主仍用内置 imagePreview。扩展宿主 stdout/stderr 必须持续排空（握手后仍继续读，否则 64KB 管道写满即卡死）。宿主侧 `extHost.api.impl` 的代理断言需排除未移植的 notebook/interactive/share/profile；工作台侧不要注册依赖缺失服务的 `mainThreadComments/Timeline/Browsers/UriOpeners`。Node 进程不能在安装目录写文件；ESM shim/状态写 profile。

前端分包约束：**不要把 `vs/base`、`vs/platform`、`vs/editor` 拆成不同 chunk**。三者存在运行时循环（platform ↔ editor），拆开会在生产包触发 `Cannot access '…' before initialization`（TDZ）并黑屏；只允许把 `terminal/xterm` 这类 core 不反向依赖的模块单独拆出，且必须用生产构建做 headless 启动验证。

## 4. 接口契约与边界
- buildPaths = {mode,targetRoot,build,bundle,dist}；unpack-manifest.json={format:1,product:ScCode,mode,platform,builtinCount,createdAt,files:[{path,size,sha256}]}，路径为包内相对路径。成品只支持准备好的Windows x64；免安装不改变SC_CODE_HOME/profile/WebView2前提。`dist/dev/`含`unpack/`未压缩目录与`ScCode_<version>_x64-unpack-debug.zip`；`dist/release/`含`unpack/`未压缩目录、setup exe与`ScCode_<version>_x64-unpack.zip`；zip条目直接位于根目录（无`ScCode_<version>_x64-unpack[-debug]/`外壳），包含unpack-manifest.json与全部运行资源，Release不含Cargo缓存/PDB/用户profile，Debug含PDB。打包顺序为先导出unpack目录、再以其为源生成zip，prepare/zip校验完成后才导出安装包；zip写入失败保留旧zip与安装包，不宣称跨文件事务。
- 产品 0.3.0 与 VS Code API 1.110.0 分离；command/settings IDs 使用 sc-code 前缀。
- taskbar_update_jump_list 入参 `entries=[{kind:'folder'|'workspace', uri:'file:...', label}]`；仅 Windows 写入 Jump List，其他平台 no-op；空列表清除自定义分类。
- Jump List 启动参数 `--open-folder=<base64url(file URI)>` / `--open-workspace=<base64url(file URI)>`；单实例转发只接受这两个前缀且只打开 file: URI。新窗口 label 为 `workspace-<n>`，capabilities 用 `workspace-*` 覆盖。
- About 对话框通过 `ICustomDialogOptions.imageIcon/imageIconAlt` 渲染 `/sc-code.svg`；`imageIcon` 存在时自动使用垂直布局，图标与标题居中、说明文字左对齐。
- ServerEndpoint = {url, port, running, token?}；token 仅运行中返回，前端只能向精确受监督 origin附凭据。
- 关闭流程：`__sc_code_request_close()` 由 `src/sc-code/window-close/closeHandler.contribution.ts` 安装/卸载；`close_window(label)` 会为该窗口放行一次。
- 启动 URL：`?folder=` / `?workspace=` / `?file=&line=&column=`；`line`/`column` 为 1 基。
- SC_CODE_HOME 指定隔离 profile；设置时 WebView2 user data folder = SC_CODE_HOME（其下 EBWebView），未设置时保持 WebView2 默认位置（避免老用户 WebView 状态丢失）。Tauri 2.10 的 WindowConfig→WebviewAttributes 会丢弃 dataDirectory，窗口一律经 build_workbench_window 创建。
- webview_host_origin() → `http://127.0.0.1:<port>`；前端缺失或格式不符时 webview 端点为 `http://127.0.0.1:0/`（失败关闭，不回退同源）。pre/index.html 的 signalReady 对 127.0.0.1 只接受 tauri.localhost / tauri://localhost / http://localhost:<port> 作为 parentOrigin。
- 通用 `git_run` 仅允许 add/branch/checkout/commit/config(--get 单键)/diff/diff-tree/log/merge-base/remote(get-url|add|remove|-v)/rev-list/rev-parse/show/stash/status/tag；网络、改写历史与可执行脚本的操作走专用类型化命令。
- workspaceIdentity 为 .code-workspace configuration URI；无 identity 时使用有序多根路径 hash。空工作区 storageUri undefined/workspaceState仅内存；globalState始终按扩展持久化。
- Memento update：null保留、undefined删除、不可JSON序列化值拒绝；setKeysForSync尚无云同步，get缓存不跨窗口实时刷新。旧内存 Map 未落盘的历史值无法恢复。
- extensionSecretRequest = {reqId, extensionId, operation: get|store|delete, key, value?}；Workbench 回 extensionSecretResult.params = {reqId, result?, error?}。get空值对扩展为undefined；退出拒绝所有pending；错误不回传可能含秘密的诊断。
- extension_secret 原生按稳定 profile身份/ID/key hash命名；sc-code.extension-secret-profile-id.v1 是非秘密索引元数据，OS keyring 服务名为 sc-code；这仅防误串，**不是扩展授权/原生 Node 代码沙箱**；真 OS keyring 桌面链路与跨窗口change广播未验收。
- checkpoint 非跨文件事务、非持久 journal，不覆盖任意 shell/Git/worktree 副作用。
- search_text_stream(root, query, options{max_results,case_sensitive,is_regex,whole_word,include,exclude,use_ignore_files,follow_symlinks,ignore_glob_case}, requestId, onFile: Channel<TextMatch[]>) → {match_count, limit_hit, cancelled}；TextMatch={path,line_number,line_content,column,match_length,preview_column}（UTF-16；超 1000 单位的行只回传命中附近窗口）。前端以 match_count 对账 Channel 迟到消息（最多等 2s）。search_workspace_files(root, pattern, options, requestId?) → {paths, limit_hit}；search_cancel(requestId)。
- fs_write_binary：body=原始字节，头 `sc-path`=encodeURIComponent(路径)、`sc-create`/`sc-overwrite`=`1|0`；fs_read_binary → ArrayBuffer。fs_trash(path)；Trash capability 仅 Windows 的 file 提供者声明。
- storage_apply(inserts: [key,value][], deletes: key[])：单事务，超限条目跳过并在错误中列出，其余提交。
- terminal_spawn(..., onEvent: Channel<{kind:'data',data}|{kind:'exit',exitCode}>) → id；terminal_ack(terminalId, charCount)。watch_start(paths, options, onBatch?: Channel)：不传 onBatch 时仍广播全局 `watch-batch`（扩展宿主桥在用）。
- CSP=null、workspace trust 未启用：不能声称完全沙箱或全扩展兼容。webview 已与工作台跨源且 IPC 按来源拒绝，但工作台自身页面（含 Agent/聊天 UI）仍拥有全部 ~350 条命令；命令面收敛见 ROADMAP S22。
