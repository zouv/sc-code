# 任务定位（ARCHITECTURE §2 分册）

> 本分册是「任务 → 文件/函数」反查表。先用 `ARCHITECTURE.md` §0.5 作用域路由收窄任务范围，
> 再只打开本表对应行指定的文件/函数；函数名优先，行号会漂移。若函数名对不上，以 grep/源码为准
> 并顺手订正本表。改动代码结构时同步更新这里。

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
| 窗口创建与 WebView 数据目录 | commands/window.rs / build_workbench_window、isolated_webview_data_dir、with_auxiliary_window_support（Tauri `on_new_window` → `auxiliary-*`）、create_window（async+主窗口协议）、open_target_window；lib.rs / CloseRequested（辅助窗口跳过工作台确认）；auxiliaryWindowService.ts / whenWindowReady；taskbar.rs / dispatch（spawn_blocking） |
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
| 真实宿主连接 | src/vs/workbench/services/extensions/browser/tauriProcessExtensionHost.ts / start、_createExtHostInitData、isRealExtensionHostEnabled（loopback 固定 `ws`）；src/vs/platform/remote/browser/browserSocketFactory.ts / BrowserSocketFactory.connect（可选 scheme）；src/vs/workbench/api/node/scCodeExtHostMain.ts / ensureInitDataDirectories；src/vs/workbench/services/extensions/browser/scCodeExtHostDirectories.ts / ensureScCodeExtHostDirectories（native 日志/存储根目录预创建）；src/vs/workbench/services/extensionManagement/browser/builtinExtensionsScannerService.ts / BuiltinExtensionsScannerService（`__SC_CODE_BUILTIN_EXTENSIONS_DIR__` → `file://` URI + `TargetPlatform.UNIVERSAL`）；src-tauri/src/commands/os.rs / get_builtin_extensions_dir、get_user_data_dir；src-tauri/src/commands/real_ext_host.rs / real_ext_host_start、start_blocking、read_handshake、shutdown_window、strip_verbatim |
| 真实宿主开关与注册 | src/vs/workbench/services/extensions/browser/extensionService.ts / _scanWebExtensions、_registerDiskExtensions（非 file location 修复）、ScCodeExtensionHostKindPicker；extensionSync.contribution.ts 在真实宿主下让路，legacy 路径同样修复磁盘 location；src/vs/workbench/api/common/extHost.api.impl.ts / createApiFactoryAndRegisterActors（notebook 纯数据类型导出）；src/vs/workbench/api/common/scCodeGitExtensionApi.ts / ScCodeGitExtensionHostBridge（合成 `vscode.git` 扩展与 v1 API） |
| 近期与中期工作台贡献 | src/vs/workbench/workbench.common.main.ts（注册 outline/callHierarchy/typeHierarchy/timeline/localHistory/mergeEditor/multiDiffEditor/bulkEdit.preview/comments/externalUriOpener/codeEditor/emmet/inlayHints/codeActions/dropOrPasteInto/scrollLocking/welcomeWalkthrough/welcomeViews）；src/vs/workbench/api/browser/extensionHost.contribution.ts（注册 mainThreadComments/mainThreadTimeline/mainThreadUriOpeners） |
| 工作台存储 | storageService.ts / createTauriOrIndexedDbStorage（首次从 IndexedDB 迁移）；tauriStorageDatabase.ts / updateItems → storage.rs / storage_apply、StorageDb::apply（单事务） |
| 文件元数据 | crates/sc-code-workspace/src/file_ops.rs / stat、read_dir → fs.rs / stat、read_dir → tauriFileSystemProvider.ts / stat、readdir 与 scCodeFileSystemProvider.ts / stat；tests/file-metadata.test.cjs 执行真实 TS 方法验证毫秒与链接类型 |
| 文件读写/删除 | tauriFileSystemProvider.ts / readFile、writeFile、delete、classify（按 os error 码映射）→ fs.rs / fs_read_binary、fs_write_binary（raw body + `sc-path` 头）、fs_trash；tauriUserDataProvider.ts 覆盖 capabilities（profile 数据不进回收站） |
| 文本/文件搜索 | tauriSearchService.ts / textSearch、fileSearch、folderExcludes、unconditionalGlobs → search.rs / search_text_stream、search_workspace_files、search_cancel、to_text_match → crate search.rs / search_streaming、search_workspace_files、collect_files_with_options、workspace_walker、relative_slash_path；searchView.ts / setSearchingStatus、doSearch、onSearchComplete（搜索中/慢搜索/完成状态） |
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
