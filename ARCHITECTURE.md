# 代码链路图谱 · ScCode

## 0. 一句话架构
独立 VS Code web 工作台 + Tauri/Rust 桌面装配 + 受监督 Node 扩展宿主 + Go AI agent；保留 API/命令兼容边界，逐步统一 Workspace Runtime。

## 0.5 作用域路由
| 任务 | 读取入口 | 忽略 |
|---|---|---|
| 自有功能与移植 | src/main.ts、src/sc-code/ | agent 内部 |
| 品牌与图标 | public/sc-code.svg、docs/icons/README.md、index.html、src/bootstrap-globals.ts、src-tauri/tauri.conf.json、src-tauri/icons/、tests/branding.test.cjs | SVG紫灰/淡紫，平台图标同步；ScBrowser只读，profile/协议 ID 不可盲改 |
| 关于/标题栏布局 | src/vs/workbench/browser/parts/dialogs/dialogHandler.ts、src/vs/base/browser/ui/dialog/{dialog.ts,dialog.css}、src/vs/workbench/browser/parts/titlebar/{titlebarPart.ts,media/titlebarpart.css} | 对话框通用按钮/输入逻辑、窗口状态恢复 |
| 任务栏跳转列表 | src-tauri/src/taskbar.rs、src/sc-code/taskbar/recentJumpList.contribution.ts、src-tauri/src/lib.rs、src-tauri/capabilities/default.json、src-tauri/src/commands/window.rs | Jump List 之外的 shell 集成、真实宿主 |
| Agent/ACP替换评估 | agent/server/{cmd/server,internal/{agent,tools,prompt,api}}、src-tauri/src/{server,commands/orchestrate}.rs、scCodeChat/、scCodeComplete/ | Node扩展宿主/编辑器共享工具不可整删 |
| 启动与 profile | src-tauri/src/app_dirs.rs、src-tauri/src/lib.rs、src-tauri/src/commands/window.rs | 全量工作台 |
| webview 隔离/IPC 来源守卫 | src-tauri/src/{webview_host,ipc_guard}.rs、src-tauri/src/lib.rs（invoke_handler 包装）、public/webview-pre/index.html（signalReady）、src/main.ts、environmentService.ts / webviewExternalEndpoint | src/vs/.../webview/browser/pre/ 为未服务的源副本 |
| 配置保存 | src-tauri/src/commands/settings.rs、crates/sc-code-settings/src/settings.rs、crates/sc-code-workspace/src/file_ops.rs | AI/UI |
| 扩展发现/重载/状态 | src-tauri/src/commands/extension_platform.rs、crates/sc-code-extensions/src/paths.rs、src-tauri/extension-host/{host,server,storage}.cjs、同目录 *.test.cjs | Go tools |
| 扩展 secrets 桥 | src-tauri/src/commands/secrets.rs、crates/sc-code-auth/、src-tauri/extension-host/{storage,host}.cjs、src/vs/workbench/contrib/extensions/browser/tauriExtensionHost.contribution.ts | provider 请求逻辑 |
| 聊天与本地鉴权 | src/vs/workbench/contrib/scCodeChat/browser/{scCodeChatService,chatPersistence,localServer}.ts、src-tauri/src/server.rs、agent/server/internal/auth/local_transport.go | 扩展视图 |
| 文件与回滚 | crates/sc-code-runtime/src/、crates/sc-code-workspace/src/file_ops.rs、agent/server/internal/tools/ | UI themes |
| 日常脚本/运行输出 | *.bat、scripts/{daily,build-desktop,package-output,unpack-output}.cjs、.cargo/config.toml、vite.config.ts | 真实用户 profile 与 dist/ 成品包不清理；旧 packages/ 由 clean 清理 |
| 仓库布局/忽略规则 | .gitignore、.gitattributes、嵌套.gitignore、tests/repository-layout.test.cjs（忽略规则、checkout 属性与真实 Bash 字节行尾） | .runtime/ 与 dist/ 成品包、用户状态不可入库；生产DLL/WASM/图标不可整类忽略 |
| 打包验证 | scripts/desktop-runtime.cjs、scripts/prepare-desktop-runtime.cjs、scripts/build-desktop.cjs、scripts/smoke-local-server.cjs、tests/、.github/workflows/ | 历史 workflow |
| 真实扩展宿主 | src/vs/workbench/api/node/{scCodeExtHostMain,extHost.sc-code.services}.ts、src/vs/workbench/api/common/{extHost.api.impl,scCodeGitExtensionApi}.ts、src/vs/workbench/services/extensions/browser/tauriProcessExtensionHost.ts、src/vs/workbench/services/extensionManagement/browser/builtinExtensionsScannerService.ts、src-tauri/src/commands/real_ext_host.rs、scripts/build-ext-host.cjs | 旧 host.cjs 逻辑 |
| VS Code 核心模块（近期/中期） | src/vs/workbench/workbench.common.main.ts、src/vs/workbench/api/browser/{extensionHost.contribution,mainThreadTimeline,mainThreadComments,mainThreadUriOpeners}.ts、src/vs/workbench/contrib/{outline,callHierarchy,typeHierarchy,timeline,localHistory,mergeEditor,multiDiffEditor,bulkEdit,emmet,inlayHints,codeActions,dropOrPasteInto,scrollLocking,comments,externalUriOpener,welcomeWalkthrough,welcomeViews}/ | 未接入的 notebook/interactive/share/profileContentHandlers |
| 工作台存储 | src/vs/workbench/services/storage/browser/{storageService,tauriStorageDatabase}.ts、src-tauri/src/commands/storage.rs | 用户 profile 数据 |
| 文件系统/搜索/终端/监听 IPC | src/vs/platform/files/browser/tauriFileSystemProvider.ts、src/vs/platform/scCode/browser/scCodeFileSystemProvider.ts（简单路径 API）、src/vs/workbench/services/search/browser/tauriSearchService.ts、src/vs/workbench/contrib/terminal/browser/tauriTerminalBackend.ts、src-tauri/src/commands/{fs,search,terminal,watch}.rs、src-tauri/src/recycle_bin.rs、crates/sc-code-workspace/src/search.rs | process.rs/sc_code_terminal.rs 的另两套终端（未接入工作台） |
| DB/聊天迁移 | crates/sc-code-db/src/{db,chat_sessions,window_state}.rs、src-tauri/src/commands/chat_sessions.rs、scCodeChat/browser/chatPersistence.ts | 真实用户数据库；不得失败后自动建空库 |
| SSH 主机验证 | crates/sc-code-remote/src/ssh.rs / ClientHandler、check_known_host_at | 用户私钥/profile；未知密钥不自动信任 |
| 上下文关键词搜索 | crates/sc-code-context/src/search/bm25.rs / tokenize、Bm25Index::search；同 crate tests/integration.rs | 模型/向量服务 |
| 网络代理 | src-tauri/src/commands/proxy.rs / validate_url、validate_redirect、PublicDns::resolve、validate_public_ip、get_client、append_body_chunk | renderer proxy 直连；Agent/provider 独立代理不在这条边界内 |
| 工作区信任/原生执行权限 | src/sc-code/security/workspaceTrust.contribution.ts、src-tauri/src/workspace_permissions.rs、lib.rs / invoke_handler | 不是 Node/文件系统沙箱；顶层 renderer 控制授权 |
| CSP/WASM/桌面验收 | src-tauri/tauri.conf.json、index.html、public/workbench-globals.js、base/common/{hashWasm,tfIdfWasm}.ts、scripts/{smoke-dist,smoke-desktop}.cjs、tests/csp-style.test.cjs | smoke 使用临时 profile/合成工作区，不触碰真实凭据 |
| 性能基线 | scripts/perf-baseline.cjs、vite.config.ts（分包/sourcemap） | 窗口句柄非交互就绪；debug 非 Release 数据 |

## 1. 文件职责
- src-tauri/src/workspace_permissions.rs：窗口/session/revision 信任状态与高风险命令 gate；reset/revoke 同步 detach/stop 对应真实宿主，legacy 共享宿主保守全局停；关窗清状态。
- src/sc-code/security/workspaceTrust.contribution.ts：工作台信任→native 递增版本同步；canonical workspaceResolved 后释放启动 barrier，避免 remote resolver 与 final trust 等待循环；授信任时按最新 generation 恢复真实宿主。
- public/workbench-globals.js：同源同步启动全局变量；index 不含内联脚本。hashWasm/tfIdfWasm 直接导入同源 glue，缺资产保留 JS fallback。
- scripts/smoke-desktop.cjs：fresh Windows 二进制/WebView2 隔离集成，限时 native IPC、双窗权限/宿主、PTY/跨源 frame 和单实例 CLI；stdout/报告/截图仅 .runtime/logs。
- tests/csp-style.test.cjs：CSP 配置守卫；style-src 必须保留 `'unsafe-inline'`，且只对 style-src 关闭 Tauri nonce/hash 注入（否则运行时主题/codicon/菜单样式被整体拦截）；script-src 保持无 unsafe-inline。
- scripts/perf-baseline.cjs：仅隔离 SC_CODE_HOME，白名单 OS env，无窗口/进程提前退出/采样失败则报错，finally 清自己的进程树；仅窗口句柄与进程树 working set，不证明扩展交互就绪。
- src/vs/workbench/contrib/scCodeChat/browser/chatPersistence.ts：每会话保存队列/稳定消息 ID/有限重试/失败提示；创建确认丢失可由幂等 session_create 重试。
- scripts/lint-project.cjs：跨平台 ESLint Node API，常规 lint 只检查 ScCode-owned TS；lint:all 显式检查全部上游源码基线。
- public/sc-code.svg：无字体依赖的 SC/编辑器矢量品牌源；Tauri icon 派生 src-tauri/icons/ 的 PNG/ICO/ICNS；index.html favicon 与 titlebarpart.css 共用矢量。tests/branding.test.cjs 验证显示名、资产接入与尺寸。
- docs/icons/：用户选定 D 版图标资源包，也是应用图标导出源（sc-code.svg、16–1024px PNG、七帧 ICO 与 README）；public/sc-code.svg 与 src-tauri/icons/ 已由该包替换。docs/ 只作为开发文档与资源目录，构建和测试不读取；测试校验实际交付的 src-tauri/icons。
- src-tauri/src/taskbar.rs：Windows 任务栏 Jump List（最近文件夹/工作区）与单实例转发；仅接受 file: URI，参数用 base64 URL-safe 编码；Win32 COM/窗口代码集中在 windows_impl / windows_single_instance。
- src/sc-code/taskbar/recentJumpList.contribution.ts：监听 IWorkspacesService 最近列表，去抖后调用 taskbar_update_jump_list；仅 Tauri 环境注册，非 Windows 后端 no-op。
- src/sc-code/：VSIX 安装/拖拽、accessibility 服务、profile 扩展同步；普通功能模块，不走 Custom overlay。
- src/vs/：保留定制 workbench；内部命令/设置 ID 统一使用 sc-code 前缀，不代表上游关联。
- src-tauri/src/lib.rs：原生装配、独立资源、数据库失败保留原文件并报错（锁占用/损坏/版本过新均不自动建空库）、退出清理；setup 内用 build_workbench_window 创建 main 窗口（conf 中 `create:false`）；应用命令经 ipc_guard 包装后才进入 generate_handler。
- src-tauri/src/webview_host.rs：回环 HTTP（127.0.0.1:随机端口）只提供 public/webview-pre 的 index/fake/service-worker（include_bytes!），作为扩展 webview 独立来源。
- src-tauri/src/recycle_bin.rs：move_to_trash（Windows SHFileOperationW+FOF_ALLOWUNDO，unsafe 仅限 windows_impl）；其它平台返回不支持。
- src-tauri/src/ipc_guard.rs：按 IPC 请求浏览器设置的 Origin 放行工作台来源（tauri.localhost；`tauri dev` 下加 devUrl），其余拒绝。
- src-tauri/src/app_dirs.rs：独立 profile 与隔离测试环境。
- crates/sc-code-runtime/：冲突保护 checkpoint；当前为内存单文件边界。checkpoint.rs 与 sc-code-agent/src/tests.rs 的 test_dir 仅在 Unix 解析临时根目录的系统别名，生产路径仍拒绝链接；symlink_targets_and_ancestors_remain_rejected 覆盖目标/祖先链接及未创建文件。
- crates/sc-code-settings/：JSONC 和分层设置；crates/sc-code-auth/：OS keyring 与非秘密元数据。
- crates/sc-code-extensions/src/paths.rs：扩展安装/profile/globalStorage 路径；tests/profile_paths.rs 以子进程验证 SC_CODE_HOME。
- src-tauri/extension-host/：5 个生产 CJS 文件，带本地会话 token；storage.cjs 专管 profile 路径、持久 Memento、旧存储只复制、显式禁用和 secret 请求接口。
- src-tauri/extension-host/host-behavior.test.cjs：实际 fork 生产宿主，合成扩展验证配置门、TreeView、重启/工作区状态、dialog URI 回包、CJS 入口更新、ESM 和 secret 成败；不接触真实用户 keyring。
- src-tauri/src/commands/secrets.rs + Workbench 扩展桥：extension_secret 命令与请求/结果转发；不把秘密写入 Memento。
- agent/server/：Go agent 和受认证本地 HTTP/WS。
- scripts/daily.cjs + 8 个 BAT：setup/run/dev/build/package/test/verify/clean；foreground+exitCode，sourceFingerprint 拒绝旧源码包；cleanTargets 先验证全部绝对路径/链接，仅删允许生成物，不强杀、不碰用户 profile。
- scripts/build-desktop.cjs / package-output.cjs：buildDesktop(args,{exportPackages}) 在 exportPackages=false 时只编译（build.bat）；为 true 时（package.bat / release）先prepareUnpack校验，再用exportUnpacked把未压缩运行目录发布到`dist/<dev|release>/unpack`，随后archiveUnpack以该目录为源生成zip（zip根目录无版本子目录）；Release再按构建前快照只选新NSIS/MSI及签名并exportPackages至dist/release；失败不导出旧包。buildPaths解析Debug/target并固定.runtime输出；package.bat 依次跑 Debug 与 Release 两个通道。tests/package-output.test.cjs隔离验证分类、旧包、失败、清理保留与链接拒绝。
- scripts/unpack-output.cjs：validateUnpack校验已构建profile内Node/Go/5CJS逐文件hash、扩展treeHash/94项清单；prepareUnpack复制EXE+运行资源+同级DLL+许可证至.runtime/package-staging（Debug另含PDB），exportUnpacked用partial目录校验后替换`dist/<mode>/unpack`，archiveUnpack用scripts/zip-writer.cjs（纯Node deflate/读取校验，无系统zip/tar依赖）以unpack目录为源生成根目录无版本子目录的zip，随后删除暂存目录。Release zip不含Cargo缓存/PDB/用户文件；拒绝链接与测试模块。tests/unpack-output.test.cjs与unpack-fixture.cjs验证资源契约、源码搬离、dev/release命名与内容、zip根条目、失败保护。
- .cargo/config.toml / vite.config.ts / scripts/dev-desktop.cjs：Cargo 输出 .runtime/target，前端 .runtime/dist、public，开发扩展 URL 指向 .runtime/desktop/extensions；runtime overlay .runtime/tauri.runtime.conf.json；`devDesktop` 先构建 `extensionHost.cjs`、校验/准备桌面运行时、生成扩展元数据并执行 `cargo build --no-default-features` 编译，再启动 `tauri dev` 开发模式。
- scripts/runtime-lock.json：固定 Windows Node/内置扩展下载与 SHA256；生成资源不纳入版本管理。

- .gitignore / .gitattributes / tests/repository-layout.test.cjs：根级生成目录与源码分离；临时Git仓库复制全部忽略规则，用--no-index核验源码资源可见性、源码资源/锁文件保留、本地状态排除和Bash/BAT行尾，不受真实index或全局忽略掩盖。

## 2. 任务定位（函数名优先，源码为准）
| 任务 | 文件 / 函数 |
|---|---|
| 忽略规则/干净检出完整性 | tests/repository-layout.test.cjs / fixture、ignoredPaths |
| 日常操作/安全清理 | scripts/daily.cjs / main、launch、sourceFingerprint、cleanTargets、clean；scripts/dev-desktop.cjs / devDesktop、cargoBuildArgs |
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
| 窗口创建与 WebView 数据目录 | commands/window.rs / build_workbench_window、isolated_webview_data_dir、create_window（async+主窗口协议）、open_target_window；taskbar.rs / dispatch（spawn_blocking） |
| profile 日志 | lib.rs / setup / tauri_plugin_log::Builder.targets（app_data/logs，不用 OS LogDir） |
| native 执行预算 | commands/process.rs / exec、drain_exec_output、exec_output_text |
| workspace trust 与恢复 | workspace_permissions.rs / allows、reset、set_trusted、stop_extension_hosts；workspaceTrust.contribution.ts / whenNativeWorkspaceTrustReady、registerNativeExtensionHostRecovery |
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
| 扩展消息通知 | src-tauri/extension-host/host.cjs / showInformationMessage、showWarningMessage、showErrorMessage；tauriExtensionHost.contribution.ts / _showExtensionMessage、_onShowMessageRequest；经 INotificationService 渲染为右下角 toast（带按钮的消息用通知操作按钮，不走 QuickPick） |
| 扩展密钥链路 | storage.cjs / createSecretStorage → host.cjs / _requestExtensionSecret → tauriExtensionHost.contribution.ts / _onExtensionSecretRequest → secrets.rs / extension_secret、extension_secret_key |
| Provider 纯逻辑与安全测试 | src-tauri/src/commands/providers.rs / resolve_direct_with_key；不以明文降级替代测试依赖注入 |
| Go 端口/凭据 | src-tauri/src/server.rs / ServerEndpoint、ServerProc |
| 前端凭据与重连 | localServer.ts / localServerHeaders、localStreamUrl、invalidateServerEndpoint；scCodeChatService.ts / _sendWithContext |
| 原生 agent WS | src-tauri/src/commands/orchestrate.rs / run_agent_session |
| 本地接口安全 | agent/server/internal/auth/local_transport.go / LocalTransportMiddleware |
| 准备与真实侧车验收 | scripts/prepare-desktop-runtime.cjs / findReusableServer、buildServer；scripts/desktop-runtime.cjs / assertPrepared；scripts/smoke-local-server.cjs / smoke、request |
| 真实扩展宿主构建 | scripts/build-ext-host.cjs（esbuild → `.runtime/ext-host/extensionHost.cjs`）；入口 src/vs/workbench/api/node/scCodeExtHostMain.ts |
| 真实宿主连接 | src/vs/workbench/services/extensions/browser/tauriProcessExtensionHost.ts / start、_createExtHostInitData、isRealExtensionHostEnabled；src/vs/workbench/services/extensionManagement/browser/builtinExtensionsScannerService.ts / BuiltinExtensionsScannerService（`__SC_CODE_BUILTIN_EXTENSIONS_DIR__` → `file://` URI + `TargetPlatform.UNIVERSAL`）；src-tauri/src/commands/os.rs / get_builtin_extensions_dir、get_user_data_dir；src-tauri/src/commands/real_ext_host.rs / real_ext_host_start、start_blocking、read_handshake、shutdown_window、strip_verbatim |
| 真实宿主开关与注册 | src/vs/workbench/services/extensions/browser/extensionService.ts / _scanWebExtensions、_registerDiskExtensions、ScCodeExtensionHostKindPicker；extensionSync.contribution.ts 在真实宿主下让路；src/vs/workbench/api/common/scCodeGitExtensionApi.ts / ScCodeGitExtensionHostBridge（合成 `vscode.git` 扩展与 v1 API） |
| 近期与中期工作台贡献 | src/vs/workbench/workbench.common.main.ts（注册 outline/callHierarchy/typeHierarchy/timeline/localHistory/mergeEditor/multiDiffEditor/bulkEdit.preview/comments/externalUriOpener/codeEditor/emmet/inlayHints/codeActions/dropOrPasteInto/scrollLocking/welcomeWalkthrough/welcomeViews）；src/vs/workbench/api/browser/extensionHost.contribution.ts（注册 mainThreadComments/mainThreadTimeline/mainThreadUriOpeners） |
| 工作台存储 | storageService.ts / createTauriOrIndexedDbStorage（首次从 IndexedDB 迁移）；tauriStorageDatabase.ts / updateItems → storage.rs / storage_apply、StorageDb::apply（单事务） |
| 文件元数据 | crates/sc-code-workspace/src/file_ops.rs / stat、read_dir → fs.rs / stat、read_dir → tauriFileSystemProvider.ts / stat、readdir 与 scCodeFileSystemProvider.ts / stat；tests/file-metadata.test.cjs 执行真实 TS 方法验证毫秒与链接类型 |
| 文件读写/删除 | tauriFileSystemProvider.ts / readFile、writeFile、delete、classify（按 os error 码映射）→ fs.rs / fs_read_binary、fs_write_binary（raw body + `sc-path` 头）、fs_trash；tauriUserDataProvider.ts 覆盖 capabilities（profile 数据不进回收站） |
| 文本/文件搜索 | tauriSearchService.ts / textSearch、fileSearch、folderExcludes、unconditionalGlobs → search.rs / search_text_stream、search_workspace_files、search_cancel、to_text_match → crate search.rs / search_streaming、search_workspace_files、collect_files_with_options、workspace_walker、relative_slash_path |
| 终端 IO | tauriTerminalBackend.ts / TauriPty.start、acknowledgeDataEvent → terminal.rs / terminal_spawn（Channel<TerminalEvent>、退出等待线程）、terminal_ack、FlowControl（wait_for_capacity 的高/低水位滞回，close 在条件锁内通知）、Utf8Stream；os.rs / get_windows_build_number |
| 文件监听 | tauriFileSystemProvider.ts / watchMapped（每 watch 一条 Channel）→ watch.rs / watch_start(on_batch)、WatchSink、coalesce_events、event_kind_to_string |
| 自定义编辑器 | src/vs/workbench/contrib/customEditor/**（VS Code 原生实现）、workbench.common.main.ts、tauriExtensionHost.contribution.ts（registerCustomEditorProvider 仅记录） |
| 真实宿主 Node 服务 | src/vs/workbench/api/node/extHost.sc-code.services.ts、extHostDebugService.ts、platform/sign/**、workbench/contrib/debug/node/**、platform/externalTerminal/node/**；scripts/build-ext-host.cjs（external: @vscode/windows-process-tree） |
| 扩展宿主进程管道 | src-tauri/src/commands/real_ext_host.rs / read_handshake（握手后继续排空 stdout）、stderr 排空线程 |
| 关窗确认 | src/sc-code/window-close/closeHandler.contribution.ts、src-tauri/src/lib.rs（on_window_event）、src-tauri/src/commands/window.rs（approve_close/take_close_approval）|
| 命令行打开 | src-tauri/src/taskbar.rs / parse_open_target、parse_cli_target、split_position、OpenTarget::app_url；src/main.ts / openFileFromCommandLine |
| 保存参与者/面包屑 | src/vs/workbench/contrib/codeEditor/browser/{saveParticipants,editorFeatures}.ts、outline/documentSymbolsOutline.ts、outline/documentSymbolsTree.ts；workbench.common.main.ts（注册 SaveParticipantsContribution）|
| notebook 空桩 | src/vs/workbench/scCodeNullServices.ts / NullNotebookService、NullNotebookEditorService（文本搜索依赖其方法返回空） |
| 懒启动/性能 | src-tauri/src/server.rs / server_endpoint（首次调用才 spawn）；extension_wasm.rs / state()（首次加载才建 engine）；scripts/perf-baseline.cjs |

## 3. 关键链路与反模式

详见 [`arch/links.md`](arch/links.md)。

## 4. 接口契约与边界
- buildPaths = {mode,targetRoot,build,bundle,dist}；unpack-manifest.json={format:1,product:ScCode,mode,platform,builtinCount,createdAt,files:[{path,size,sha256}]}，路径为包内相对路径。成品只支持准备好的Windows x64；免安装不改变SC_CODE_HOME/profile/WebView2前提。`dist/dev/`含`unpack/`未压缩目录与`ScCode_<version>_x64-unpack-debug.zip`；`dist/release/`含`unpack/`未压缩目录、setup exe与`ScCode_<version>_x64-unpack.zip`；zip条目直接位于根目录（无`ScCode_<version>_x64-unpack[-debug]/`外壳），包含unpack-manifest.json与全部运行资源，Release不含Cargo缓存/PDB/用户profile，Debug含PDB。打包顺序为先导出unpack目录、再以其为源生成zip，prepare/zip校验完成后才导出安装包；zip写入失败保留旧zip与安装包，不宣称跨文件事务。
- 产品 0.5.0 与 VS Code API 1.110.0 分离；command/settings IDs 使用 sc-code 前缀。
- taskbar_update_jump_list 入参 `entries=[{kind:'folder'|'workspace', uri:'file:...', label}]`；仅 Windows 写入 Jump List，其他平台 no-op；空列表清除自定义分类。
- Jump List 启动参数 `--open-folder=<base64url(file URI)>` / `--open-workspace=<base64url(file URI)>`；单实例转发只接受这两个前缀且只打开 file: URI。新窗口 label 为 `workspace-<n>`，capabilities 用 `workspace-*` 覆盖。
- About 对话框通过 `ICustomDialogOptions.imageIcon/imageIconAlt` 渲染 `/sc-code.svg`；`imageIcon` 存在时自动使用垂直布局，图标与标题居中、说明文字左对齐。
- 文件 FileStat.modified/created 为毫秒，file:// 主 provider 与 ScCode 简单路径 provider 均直接透传，不再乘 1000；symlink/junction 同时返回 SymbolicLink 与目标 File/Directory 位，dangling 保留 link 位。
- 搜索取消表按 (原生 window.label, requestId) 隔离；同窗重用 ID 先取消旧任务，旧任务完成仅以 Arc identity 清自己的记录，不误删新请求。
- HTTP proxy：marketplace 逐跳 validate_url + allowlist；通用 fetch 逐跳 validate_url，但不套 marketplace 域名表；两者 PublicDns 在 5s 内解析并校验全部 A/AAAA，空答案或混合公网/私网拒绝，将同批已验证 SocketAddr 交给 reqwest 实际连接，避免二次解析重绑定。逐 chunk 检查 50 MiB 上限。客户端 no_proxy，renderer fetch/proxy 直连、不使用系统/环境代理（兼容变化）；不涵盖 Agent/provider 独立网络栈或浏览器直接网络。
- ServerEndpoint = {url, port, running, token?}；token 仅运行中返回，前端只能向精确受监督 origin附凭据。
- 关闭流程：`__sc_code_request_close()` 由 `src/sc-code/window-close/closeHandler.contribution.ts` 安装/卸载；`close_window(label)` 会为该窗口放行一次。
- 启动 URL：`?folder=` / `?workspace=` / `?file=&line=&column=`；`line`/`column` 为 1 基。
- SC_CODE_HOME 指定隔离 profile；设置时所有窗口的 WebView2 user data folder = SC_CODE_HOME（其下 EBWebView），未设置时保持默认位置以保留老用户状态。WindowConfig 转换会丢 dataDirectory，build_workbench_window/create_window 均显式设置；create_window 使用 async 及主窗口 useHttpsScheme。debug 日志 targets 指向同一 app_data/logs，不依赖 OS Known Folders。
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
- CSP 从 null 改为 default-src 'none'；脚本仅 self + wasm-unsafe-eval，无 script unsafe-inline/eval/blob。同步 globals 外置；同源 WASM glue 导入不再 Blob/import，缺资产使用 JS fallback。style unsafe-inline、必要 HTTP(S)/WS/frame/blob worker 能力保留，不宣称所有出站流量隔离。**Tauri 会给静态 `<style>` 注入 nonce 并追加进 `style-src`，而 CSP 规定 nonce/hash 会使 `'unsafe-inline'` 失效；VS Code 的主题变量、codicon 字形与菜单控件样式全部由运行时无 nonce `<style>` 注入（`workbenchThemeService._applyRules`、`iconsStyleSheet`、`createStyleSheet`），因此 `dangerousDisableAssetCspModification: ["style-src"]` 只关闭 style-src 的自动 nonce/hash 注入，script-src 等仍由 Tauri 加固。** 当前构建 WASM 资产 0，不代表实际 WASM 加速已启用。
- workspace trust 默认启用：创建工作台前 reset session；未知 window/session fail closed；窗口级递增 revision 拒绝晚到 grant，revoke/reset 同步停止对应真实宿主，关闭移除状态。高风险 Git/进程/PTY write/debug/task/LSP/两套宿主/Agent/remote/MCP/hooks/browser/secrets/env 命令需信任，普通文件编辑/搜索/设置/chat/cleanup 允许。顶层 renderer 控制授权，不防被攻陷的顶层页，也不是 Node/文件系统沙箱；不承诺停止所有已运行后台活动。
- trust 启动 barrier 等 workspaceResolved 后完成 native 同步，不能等可能依赖 remote resolver 扩展的最终 workspaceTrustInitialized；最终 trust 再精化同步。真实宿主授信任后按最新 generation 重建启动 promise，迟到注册与撤权不误恢复。
- native exec：timeout 包含 child wait 与两流 drain，各保留最多 100000 bytes 但持续排空；无 detached reader，超时回部分输出/marker，root kill_on_drop + 已有树清理。不是全 escaped descendant cleanup，也不证明 Agent shell 历史 88s 异常根因解决。
- crates/sc-code-terminal 已加入 workspace/跨平台 CI，88 项回归包含混合 Unix/Windows 路径检测；未接入工作台或替换 commands/terminal.rs 后端。
