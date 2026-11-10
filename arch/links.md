# 关键链路与反模式（分册）

> 由 ARCHITECTURE.md §3 / §3.5 / §3.6 拆出；路由入口见 ARCHITECTURE §0.5。

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
12. 数据损坏/锁占用/未来 schema 必须可见报错并保留文件，禁止自动改名 DB 后建空库假恢复。sc-code-db 当前 schema v5：v4→v5 事务创建聊天表/索引与 user_version；window_state 仅存 OS 几何。消息与会话计数同事务，updated_at 不倒退。
- 聊天落盘：ScCodeChatService._ensureDbSession → ChatSessionPersistence（捕获 session/workspace）→ 幂等 session_create → session_save_message；只有成功才 mark saved，失败最多重试三次再提示，下一消息可重试失败项。按秒级 created_at + 包含毫秒/序号的稳定 ID 排序，防迟到重试乱序；旧会话异步写不能改投新会话。
- 批量编辑：multi_edit 先在内存依次验证/替换；old 不能为空且必须唯一命中，任一失败原文件不变，全部成功一次 atomic_write。祖先 symlink 安全拒绝保持不变。
- SSH：ClientHandler::check_server_key 比较 known_hosts 中实际公钥/端口/真实 SHA256 指纹；未知、变更、已撤销密钥均拒绝。首次登记需用户通过可信 SSH 客户端核验；未实现自动接受/CA 认证交互。exec_inner 读取 ChannelMsg Data/ExtendedData/ExitStatus 至 Close，EOF 后仍收退出码，不再 into_stream 丢 stderr/状态。本地真实 russh 握手/认证/执行回归不代替用户服务器、多跳或转发验收。
- BM25：tokenize 同时拆 Windows/Unix 分隔符并索引文件 stem；保存同一套 doc_lengths，原始 term count 只在评分时做一次长度归一化，增量与全量索引评分一致。避免短无关定义压过多词匹配。

13. Git边界：logs/dist/out/build规则限定根目录，不按“扩展未完成”忽略源码；.runtime/与dist/始终排除。Gitignore回归与源码文件可见性校验必须通过；首次提交还需从index干净导出核验完整性。Bash入口固定LF并保留可执行位，BAT保持CRLF。

14. 任务栏最近记录：WorkspacesService 持久化最近文件夹/工作区 → 贡献点监听 onDidChangeRecentlyOpened 去抖 → invoke taskbar_update_jump_list(entries) → Rust 过滤非 file: URI/去重/限 10 条 → Windows ICustomDestinationList 写“Recent Folders / Recent Workspaces”分类。条目命令为 `ScCode.exe --open-folder=<base64>` 或 `--open-workspace=<base64>`。
15. 单实例：进程启动先按 profile 数据目录 hash 创建命名 mutex；已有实例则通过隐藏窗口 WM_COPYDATA 转发 argv 后退出。首个实例在 setup 创建隐藏窗口，收到目标参数用 spawn_blocking 打开带 ?folder=/workspace= 的新窗口，禁止在 Win32 event/main 线程同步 build WebView2（死锁）；无目标参数仍主线程聚焦 main。禁止两个进程同时打开同一 profile 的 SQLite。
16. webview 隔离：工作台 → iframe `http://127.0.0.1:<port>/index.html`（webview_host）→ 同源内层 fake.html 承载扩展内容；SW 在真实 HTTP 上注册。Windows 上 wry 把 Tauri IPC 脚本（含 invoke key）注入**所有** frame，Tauri 对无 ACL 清单的应用命令不查来源、且把任何自定义协议都视作本地——所以：①webview 不得用自定义协议承载（会被视为本地且 SW 主脚本抓取失败）；②应用命令靠 ipc_guard 校验自定义协议 IPC 的 Origin（浏览器设置、不可伪造）；③postMessage 回退的 headers 可伪造，安全前提是 wry 只订阅顶层 WebMessageReceived、子 frame 消息到不了 Tauri。升级 wry/Tauri 后须用 CDP 复验（WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=<p>：webview frame 内 invoke 应被拒、劫持 fetch 取 key 后经 `window.ipc.postMessage` 伪造 Origin 写文件应无效果、主页面对照应成功）。
18. 关窗：原生 CloseRequested 未被 approve 时 prevent_close 并 eval `window.__sc_code_request_close()`；前端用 `IEditorService.editors.filter(isDirty)` 判断（`IWorkingCopyService.modifiedWorkingCopies` 在本移植里不填充），三按钮 prompt 后：取消/保存失败→不关；保存→`saveAll` 成功后调 close_window；不保存→先 `revertAll({ includeUntitled: true })` 丢弃 untitled 工作副本与备份，再 close_window。`close_window` 先写 approve 标记再 close，标记一次性消费。
19. 命令行：argv[1..] 里找第一个存在的绝对路径（目录→folder，文件→file），`-g/--goto` 或 `路径:行[:列]` 带位置；URL `index.html?file=<uri>&line=&column=`；main.ts 用父目录作为工作区并在命令服务就绪后 `_workbench.open`（options 走 `[column, options]`，`vscode.open` 会丢弃 options）。
17. 文件/搜索/终端 IPC：重活一律 `#[tauri::command(async)]` 或 async+spawn_blocking（同步命令跑在主线程）；对调用顺序敏感的命令（终端写入、设置、聊天会话）保持同步。文件内容走 `tauri::ipc::Response`/raw body，禁止 `Vec<u8>`↔`number[]`。搜索列号一律 UTF-16（Rust 侧转换），glob 按工作区相对 `/` 路径匹配、排除目录在遍历时剪枝；文本搜索必须经 SearchModel 的 notebook 段，notebook 空桩不得缺方法。终端输出 = 每终端 Channel（data…exit 有序），按 UTF-16 字符计流控（高 10 万/低 5 千，最长暂停 5s）；close 与等待共享条件锁，防通知丢失，暂停后必须回落到低水位（含虚假唤醒）；Windows ConPTY 退出靠等待线程 try_wait→记录退出码→释放 PTY，不能等读端 EOF。监听事件按路径合并：add+change=add、add+remove=无、remove+add=change。

## 3.5 品牌与 Agent 替换边界
- 显示品牌统一 ScCode（含 native菜单/窗口、extension env、终端 TERM_PROGRAM、Go模型请求标题与prompt）；Cargo bin 为 ScCode。PROFILE_DIR_NAME 为 ScCode，identifier dev.sccode.app、sc-code 协议/命令/设置统一使用 ScCode 标识。
- 内部实现与外露标识统一为 `sc-code-*` / `sc_code_*`（Rust crate、WASM 包、`agent/`、`sc-code-agent` 进程、`sc-code.*` 命令/设置 ID、`sc-code://` 协议、`.sc-code` 目录、`sc-code.toml` 扩展清单、keyring 服务名与数据目录）。
- 内置 Agent 为受监督Go进程 + Rust local-exec工具桥 + Workbench chat/inline/orchestration；registerAll有66种工具声明，不等于每个后端已端到端验收。browser工具未在Go registry启用，云agent无远端实现。
- Agent工具链部分未打通：crates/sc-code-agent/src/tools/lsp.rs仅返回说明文本；Rust dispatch缺patch_file/regex_replace以及后台shell/read_lints等处理，而Go LocalExecTools会把它们派本机；orchestrate/run_agent_session传local_exec=false，server又禁止非sandbox的workspace执行，不能承诺真实文件任务已可用。后续ACP必须验收真实行为、不能只测工具声明/成功回包。
- Tab FIM：默认受监督 Agent 的 /v1/completions 使用 prefix/suffix/file_path/language，返回 completion；Agent 上游仍需 COMPLETION_SERVER_URL（兼容 VLLM_URL）。自定义外部 endpoint 保持 OpenAI prompt/choices/SSE；远程 Agent 不自动识别。仅向精确本地 Agent origin附 token，取消后不回调结果。ACP替换应单列补全服务，协议通过不代表真实模型已配置。
- 内置 Agent 的 SC_CODE_HIDDEN 默认 true，load 覆盖旧可见状态；每次启动收起，本次会话仍可手动打开。未停 Go 自启，未移除Agent。推荐 AgentBackend → ACP客户端/进程transport → session/权限/文件/终端能力契约验收 → 停止自启Go → 删除推理/provider/用量及Agent专属数据/构建依赖；editor共享LSP/index/terminal与Node扩展宿主保留。

## 3.6 真实 Node 扩展宿主（S10a / S24）

开关：Tauri 桌面环境下默认开启（`isRealExtensionHostEnabled() === true`）；可通过 `SC_CODE_REAL_EXT_HOST=0`（构建期）、`?realExtHost=0` 或 `localStorage['scode.realExtHost']='0'` 显式回退至 `host.cjs` 仿制宿主。

```
构建：npm run ext-host:build
  └─ esbuild: src/vs/workbench/api/node/scCodeExtHostMain.ts → .runtime/ext-host/extensionHost.cjs (CJS, node22)
       ├─ extHost.common.services + extHost.sc-code.services（Node 版服务注册）
       ├─ ScCodeGitExtensionHostBridge（合成 vscode.git 扩展与 getAPI(1) 兼容桥）
       ├─ ExtensionHostMain（VSCode 真实扩展宿主）
       └─ ws server (127.0.0.1, token 校验) + PersistentProtocol

启动：src/main.ts → BuiltinExtensionsScannerService + ExtensionService._initialize
  ├─ invoke('get_builtin_extensions_dir') / invoke('get_user_data_dir') → 写入 globalThis
  ├─ BuiltinExtensionsScannerService 将内置扩展 location 解析为 file:// URI（TargetPlatform.UNIVERSAL）
  ├─ hasLocalProcess = isRealExtensionHostEnabled()（Tauri 默认 true）
  ├─ ScCodeExtensionHostKindPicker：ui/workspace/web 全部 → LocalProcess
  ├─ _scanWebExtensions → _registerDiskExtensions（先 list_installed_extensions + installFromLocation）
  └─ TauriProcessExtensionHost.start()
       ├─ invoke real_ext_host_start(hostId) → Rust 按 (原生 window.label, hostId) spawn Node（strip_verbatim，token 环境变量）
       ├─ BrowserSocketFactory.connect(ws://127.0.0.1:port?token)
       ├─ PersistentProtocol → 等 Ready → 发 initData（globalStorageHome/workspaceStorageHome/logsLocation 均为 file:// URI，uiKind=Desktop） → 等 Initialized
       └─ ExtensionHostManager 接管 RPC（mainThread* 客户，含 Comments/Timeline/UriOpeners/MultiDiff）
```

生命周期：RealExtensionHost 只共享 supervisor，不共享进程；每 (原生窗口, hostId) 独占 Node + token + ExtensionHostMain。每进程只接受一个认证 renderer。stop 仅处理调用窗口的 hostId，迟到 stop 不关闭新一代；Destroyed 清该窗口，app exit 清全部。启动/连接/握手中 dispose 或失败均 stop，并释放握手监听器；清进程时不持全局实例表锁。tests/ext-host-smoke.cjs 使用临时 profile 验证 A 退出 B 仍运行及拒绝第二 renderer；完整桌面多窗口行为仍需 GUI 验收。

约束：`ICustomEditorService` 来自恢复的 `contrib/customEditor/browser/customEditors.ts`，`MainThreadCustomEditors` 依赖它；旧宿主无法 resolve 自定义编辑器，因此 contributed 编辑器在旧宿主下不注册（`isRealExtensionHostEnabled()` 门控），旧宿主仍用内置 imagePreview。扩展宿主 stdout/stderr 必须持续排空（握手后仍继续读，否则 64KB 管道写满即卡死）。宿主侧 `extHost.api.impl` 的代理断言需排除未移植的 notebook/interactive/share/profile；工作台侧已恢复并注册 `mainThreadComments/Timeline/UriOpeners`（仅 `mainThreadBrowsers` 未注册）。内置 `git` 扩展不在打包清单中重复注册 SCM 视图（避免与原生 `TauriGitScmProvider` 冲突），改由 `scCodeGitExtensionApi.ts` 在扩展宿主内合成 `vscode.git` 扩展及 `getAPI(1)` 接口供第三方扩展调用。Node 进程不能在安装目录写文件；ESM shim/状态写 profile。

前端分包约束：**不要把 `vs/base`、`vs/platform`、`vs/editor` 拆成不同 chunk**。三者存在运行时循环（platform ↔ editor），拆开会在生产包触发 `Cannot access '…' before initialization`（TDZ）并黑屏；只允许把 `terminal/xterm` 这类 core 不反向依赖的模块单独拆出，且必须用生产构建做 headless 启动验证。

