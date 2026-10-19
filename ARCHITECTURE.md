# 代码链路图谱 · ScCode

## 0. 一句话架构
独立 VS Code web 工作台 + Tauri/Rust 桌面装配 + 受监督 Node 扩展宿主 + Go AI agent；保留 API/命令兼容边界，逐步统一 Workspace Runtime。

## 0.5 作用域路由
| 任务 | 读取入口 | 忽略 |
|---|---|---|
| 自有功能与移植 | src/main.ts、src/sc-code/、docs/import-manifest.json | agent 内部 |
| 品牌与图标 | public/sc-code.svg、index.html、src/bootstrap-globals.ts、src-tauri/tauri.conf.json、src-tauri/icons/、tests/branding.test.cjs | SVG紫灰/淡紫，平台图标同步；ScBrowser只读，profile/协议 ID 不可盲改 |
| Agent/ACP替换评估 | agent/server/{cmd/server,internal/{agent,tools,prompt,api}}、src-tauri/src/{server,commands/orchestrate}.rs、scCodeChat/、scCodeComplete/ | Node扩展宿主/编辑器共享工具不可整删 |
| 启动与 profile | src-tauri/src/app_dirs.rs、src-tauri/src/lib.rs | 全量工作台 |
| 配置保存 | src-tauri/src/commands/settings.rs、crates/sc-code-settings/src/settings.rs、crates/sc-code-workspace/src/file_ops.rs | AI/UI |
| 扩展发现/重载/状态 | src-tauri/src/commands/extension_platform.rs、crates/sc-code-extensions/src/paths.rs、src-tauri/extension-host/{host,server,storage}.cjs、同目录 *.test.cjs | Go tools |
| 扩展 secrets 桥 | src-tauri/src/commands/secrets.rs、crates/sc-code-auth/、src-tauri/extension-host/{storage,host}.cjs、src/vs/workbench/contrib/extensions/browser/tauriExtensionHost.contribution.ts | provider 请求逻辑 |
| 聊天与本地鉴权 | src/vs/workbench/contrib/scCodeChat/browser/{scCodeChatService,localServer}.ts、src-tauri/src/server.rs、agent/server/internal/auth/local_transport.go | 扩展视图 |
| 文件与回滚 | crates/sc-code-runtime/src/、crates/sc-code-workspace/src/file_ops.rs、agent/server/internal/tools/ | UI themes |
| 日常脚本/运行输出 | *.bat、scripts/{daily,build-desktop,package-output,unpack-output}.cjs、.cargo/config.toml、vite.config.ts | 真实用户 profile 与 packages/ 成品包不清理 |
| 仓库布局/忽略规则 | .gitignore、.gitattributes、嵌套.gitignore、tests/repository-layout.test.cjs、docs/import-manifest.json | .runtime/packages/与用户状态不可入库；生产DLL/WASM/图标不可整类忽略 |
| 打包验证 | scripts/desktop-runtime.cjs、scripts/prepare-desktop-runtime.cjs、scripts/build-desktop.cjs、scripts/smoke-local-server.cjs、tests/、.github/workflows/ | 历史 workflow |
| 真实扩展宿主 | src/vs/workbench/api/node/{scCodeExtHostMain,extHost.sc-code.services}.ts、src/vs/workbench/services/extensions/browser/tauriProcessExtensionHost.ts、src-tauri/src/commands/real_ext_host.rs、scripts/{build-ext-host,vendor-ext-host-node}.cjs | 旧 host.cjs 逻辑 |
| 工作台存储 | src/vs/workbench/services/storage/browser/{storageService,tauriStorageDatabase}.ts | 用户 profile 数据 |
| 性能基线 | scripts/perf-baseline.cjs、vite.config.ts（分包/sourcemap） | 业务逻辑 |

## 1. 文件职责
- public/sc-code.svg：无字体依赖的 SC/编辑器矢量品牌源；Tauri icon 派生 src-tauri/icons/ 的 PNG/ICO/ICNS；index.html favicon 与 titlebarpart.css 共用矢量。tests/branding.test.cjs 验证显示名、资产接入与尺寸。
- src/sc-code/：VSIX 安装/拖拽、accessibility 服务、profile 扩展同步；普通功能模块，不走 Custom overlay。
- src/vs/：保留定制 workbench；内部命令/设置 ID 统一使用 sc-code 前缀，不代表上游关联。
- src-tauri/src/lib.rs：原生装配、独立资源、数据库失败保留原文件、退出清理。
- src-tauri/src/app_dirs.rs：独立 profile 与隔离测试环境。
- crates/sc-code-runtime/：冲突保护 checkpoint；当前为内存单文件边界。
- crates/sc-code-settings/：JSONC 和分层设置；crates/sc-code-auth/：OS keyring 与非秘密元数据。
- crates/sc-code-extensions/src/paths.rs：扩展安装/profile/globalStorage 路径；tests/profile_paths.rs 以子进程验证 SC_CODE_HOME。
- src-tauri/extension-host/：5 个生产 CJS 文件，带本地会话 token；storage.cjs 专管 profile 路径、持久 Memento、旧存储只复制、显式禁用和 secret 请求接口。
- src-tauri/extension-host/host-behavior.test.cjs：实际 fork 生产宿主，合成扩展验证配置门、TreeView、重启/工作区状态、dialog URI 回包、CJS 入口更新、ESM 和 secret 成败；不接触真实用户 keyring。
- src-tauri/src/commands/secrets.rs + Workbench 扩展桥：extension_secret 命令与请求/结果转发；不把秘密写入 Memento。
- agent/server/：Go agent 和受认证本地 HTTP/WS。
- scripts/daily.cjs + 8 个 BAT：setup/run/dev/build/release/test/verify/clean；foreground+exitCode，sourceFingerprint 拒绝旧源码包；cleanTargets 先验证全部绝对路径/链接，仅删允许生成物，不强杀、不碰用户 profile。
- scripts/build-desktop.cjs / package-output.cjs：buildDesktop成功后先prepareUnpack校验；再用exportUnpacked把未压缩运行目录发布到`packages/<dev|release>/unpack`，随后archiveUnpack以该目录为源生成zip（zip根目录无版本子目录）；Release再按构建前快照只选新NSIS/MSI及签名并exportPackages至packages/release；失败/--no-bundle不导出旧包。buildPaths解析Debug/target并固定.runtime输出。tests/package-output.test.cjs隔离验证分类、旧包、失败、清理保留与链接拒绝。
- scripts/unpack-output.cjs：validateUnpack校验已构建profile内Node/Go/5CJS逐文件hash、扩展treeHash/94项清单；prepareUnpack复制EXE+运行资源+同级DLL+许可证至.runtime/package-staging（Debug另含PDB），exportUnpacked用partial目录校验后替换`packages/<mode>/unpack`，archiveUnpack用scripts/zip-writer.cjs（纯Node deflate/读取校验，无系统zip/tar依赖）以unpack目录为源生成根目录无版本子目录的zip，随后删除暂存目录。Release zip不含Cargo缓存/PDB/用户文件；拒绝链接与测试模块。tests/unpack-output.test.cjs与unpack-fixture.cjs验证资源契约、源码搬离、dev/release命名与内容、zip根条目、失败保护。
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
| 工作台存储 | storageService.ts / createTauriOrIndexedDbStorage（首次从 IndexedDB 迁移）；tauriStorageDatabase.ts；Rust commands/storage.rs（`storage_list` 已在 lib.rs 注册） |
| 懒启动/性能 | src-tauri/src/server.rs / server_endpoint（首次调用才 spawn）；extension_wasm.rs / state()（首次加载才建 engine）；scripts/perf-baseline.cjs |

## 3. 关键链路与反模式
1. 启动：独立 app_data_dir → 原生服务 → 受监督 Go/Node；自动更新和遥测默认关闭。原生/WebView/扩展/agent 共用 SC_CODE_HOME 根；不要拿真实 profile 做自动测试。
3. 聊天：预留 pending 轮次 → 单次重连发送 → generation 防止取消后迟发；断连必须失效旧 endpoint/token。
4. 本地 API：仅 loopback + Host/Origin 校验 + 随机每进程 token；health 无 token，其余 REST Bearer；query token 仅 WS upgrade。
5. 打包：固定下载 hash → 94 个真实内置扩展 + Node + Go + 5 CJS host → preflight → frontend/native → NSIS + unpack 目录 + zip；unpack只从同次已构建profile资源导出，不拼接当前源码runtime；逐文件hash与extensionsHash验证，hostSourceHash为源码含开发shim指纹，不等于发布host目录hash；不得把空宿主目录当成功。Debug输出`packages/dev/unpack`未压缩目录与`-debug` zip（含PDB），Release输出`packages/release/unpack`未压缩目录、setup exe与zip；zip根目录直接是程序文件，不含版本外壳目录。修改 host 后必须重做 runtime:prepare 与包；测试 CJS 不打入生产目录。
6. 配置更新按 mutation锁 → JSONC读取/验证 → 单文件原子写并保permissions → 内存层更新；落盘失败返回错误；删除文件清旧层，merged保留扩展键。
7. 扩展状态：profile/global 或 workspace hash → 缺失旧文件只复制 → JSON snapshot → 本对象 Promise 队列 + 跨对象/进程 wx锁 → 重读合并 → fsync临时文件/rename → 更新缓存；失败不可假成功。锁超时保留文件，不自动抢占崩溃残留锁。
8. 工作区变化：Workbench 先关闭配置门 → initialize变更 identity/folders → detach旧 context → 配置快照 → release → 新 context激活。CJS更新撤销旧命令/订阅/require缓存并刷新 manifest入口；ESM缓存不能真正热重载，尚需宿主重启策略。
9. secrets：Node reqId/pending/10s timeout → Workbench native invoke → profile+extension+key namespace OS keyring → extensionSecretResult → 仅成功后发本 context change。禁止内存/明文 fallback；不得日志记录 value。
10. 扩展默认无固定黑名单；SC_CODE_DISABLE_EXTENSION_IDS 覆盖发现、预载、直接加载和激活。发现/激活成功不代表 API/服务/许可兼容。
11. ESM shim 写 profile/runtime 而非安装目录；file URL 用 pathToFileURL，顶层 await 触发 ERR_REQUIRE_ASYNC_MODULE 时转 import。
12. 数据损坏/锁占用必须可见报错并保留文件，禁止删除 DB 后假恢复。

13. Git边界：logs/dist/out/build规则限定根目录，不按“扩展未完成”忽略源码；.runtime/与packages/始终排除。来源清单物理文件校验与Gitignore回归必须同时通过；首次提交还需从index干净导出核验完整性。Bash入口固定LF并保留可执行位，BAT保持CRLF。

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

约束：宿主侧 `extHost.api.impl` 的代理断言需排除未移植的 notebook/interactive/share/profile；工作台侧不要注册依赖缺失服务的 `mainThreadComments/Timeline/Browsers/UriOpeners`。Node 进程不能在安装目录写文件；ESM shim/状态写 profile。

前端分包约束：**不要把 `vs/base`、`vs/platform`、`vs/editor` 拆成不同 chunk**。三者存在运行时循环（platform ↔ editor），拆开会在生产包触发 `Cannot access '…' before initialization`（TDZ）并黑屏；只允许把 `terminal/xterm` 这类 core 不反向依赖的模块单独拆出，且必须用生产构建做 headless 启动验证。

## 4. 接口契约与边界
- buildPaths = {mode,targetRoot,build,bundle,packages}；unpack-manifest.json={format:1,product:ScCode,mode,platform,builtinCount,createdAt,files:[{path,size,sha256}]}，路径为包内相对路径。成品只支持准备好的Windows x64；免安装不改变SC_CODE_HOME/profile/WebView2前提。`packages/dev/`含`unpack/`未压缩目录与`ScCode_<version>_x64-unpack-debug.zip`；`packages/release/`含`unpack/`未压缩目录、setup exe与`ScCode_<version>_x64-unpack.zip`；zip条目直接位于根目录（无`ScCode_<version>_x64-unpack[-debug]/`外壳），包含unpack-manifest.json与全部运行资源，Release不含Cargo缓存/PDB/用户profile，Debug含PDB。打包顺序为先导出unpack目录、再以其为源生成zip，prepare/zip校验完成后才导出安装包；zip写入失败保留旧zip与安装包，不宣称跨文件事务。
- 产品 0.1.1 与 VS Code API 1.110.0 分离；command/settings IDs 使用 sc-code 前缀。
- ServerEndpoint = {url, port, running, token?}；token 仅运行中返回，前端只能向精确受监督 origin附凭据。
- SC_CODE_HOME 指定隔离 profile。
- workspaceIdentity 为 .code-workspace configuration URI；无 identity 时使用有序多根路径 hash。空工作区 storageUri undefined/workspaceState仅内存；globalState始终按扩展持久化。
- Memento update：null保留、undefined删除、不可JSON序列化值拒绝；setKeysForSync尚无云同步，get缓存不跨窗口实时刷新。旧内存 Map 未落盘的历史值无法恢复。
- extensionSecretRequest = {reqId, extensionId, operation: get|store|delete, key, value?}；Workbench 回 extensionSecretResult.params = {reqId, result?, error?}。get空值对扩展为undefined；退出拒绝所有pending；错误不回传可能含秘密的诊断。
- extension_secret 原生按稳定 profile身份/ID/key hash命名；sc-code.extension-secret-profile-id.v1 是非秘密索引元数据，OS keyring 服务名为 sc-code；这仅防误串，**不是扩展授权/原生 Node 代码沙箱**；真 OS keyring 桌面链路与跨窗口change广播未验收。
- checkpoint 非跨文件事务、非持久 journal，不覆盖任意 shell/Git/worktree 副作用。
- CSP=null、workspace trust 未启用：不能声称完全沙箱或全扩展兼容。
