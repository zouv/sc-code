# 变更记录 · ScCode

## [未发布]
- 变更：全面移除旧品牌兼容层——命令/设置 ID、`sc-code://` 协议、`.sc-code` 配置目录、`sc-code.toml` 扩展清单、keyring 服务名与环境变量统一为 ScCode 自有标识，不再读取旧名称。
- 变更：移除首次启动旧数据导入、旧数据目录探测与 `SC_CODE_MIGRATION_SOURCES`；应用只使用独立 ScCode profile。
- 变更：移除旧 keyring 服务、旧环境变量、WASM 清单旧文件名、项目配置目录与信任文件等全部回退逻辑。
- 变更：Rust workspace、WASM 包、Go Agent 目录（`agent/` 的 `server`/`core`/`cli`）与产物 `sc-code-agent.exe` 统一为 `sc-code-*` 命名。
- 变更：工作台内部面板、服务、文件、CSS 变量与持久化键统一为 ScCode 命名。
- 变更：`packages` 目录结构为 `dev`（`unpack/` 未压缩目录 + `ScCode_<version>_x64-unpack-debug.zip`）与 `release`（`unpack/` 未压缩目录 + `ScCode_<version>_x64-setup.exe` + `ScCode_<version>_x64-unpack.zip`）；不再生成旧的 `packages/unpack` 路径。
- 变更：打包顺序改为先校验并导出 `packages/<dev|release>/unpack/`，再以该目录为源生成 `ScCode_<version>_x64-unpack[-debug].zip`；zip 根目录直接是程序文件，不再包含版本外壳目录。
- 变更：`docs/` 清理为当前有效内容——删除 `docs/history/`、`docs/releases/` 与空模板 `00/01/02`，保留 `docs/import-manifest.json` 与新的 ScCode 截图；来源清单相应调整为 3664 项。
- 变更：README 按 ScBrowser 风格重排，补充徽章、功能、下载安装、构建、目录结构与安全边界，并接入真实 ScCode 工作台截图。

## [0.1.1] - 2026-10-19
- 新增：打包成功后同时生成 `ScCode_<version>_x64-unpack.zip`（带单一根目录的完整免安装目录），与安装包一起放在 `packages/dev` 或 `packages/release`；GitHub Release 必须同时上传安装包与该 zip。
- 变更：产品版本升至 0.1.1（`package.json`、`package-lock.json`、`tauri.conf.json`/WiX、`src-tauri/Cargo.toml`、About 回退值同步）。
- 新增：真实 VSCode Node 扩展宿主（`extensionHost.cjs`，由 `src/vs/workbench/api/node/` 构建），通过 `PersistentProtocol`+WebSocket 与工作台通信；`SC_CODE_REAL_EXT_HOST=1` 或 `?realExtHost=1` 启用，默认仍走旧宿主。为构建该宿主，从 VSCode 1.110.1 引入 `src/vs/**/node` 与 `workbench/api/node` 源码（MIT，保留版权头）。
- 新增：磁盘扩展在扩展服务首次扫描前注册（`ExtensionService._registerDiskExtensions`），修复真实宿主启动时扩展列表为空；真实宿主模式下 `extensionSync` 自动让路。
- 新增：Rust `real_ext_host_start/real_ext_host_stop` 监管真实宿主进程；修复 Windows `\\?\` 路径传给 Node 导致 `EISDIR` 的问题；宿主启动握手失败时回传 stderr。
- 新增：`npm run perf:baseline` 冷启动/进程树内存基线；`npm run ext-host:build`、`npm run test:ext-host`；CI 增加宿主构建与冒烟。
- 变更：工作台设置/UI 状态在 Tauri 下改用 profile 内 SQLite（`storage_list/set/delete`），首次启动从 IndexedDB 一次性迁移；普通浏览器开发仍用 IndexedDB。
- 变更：`src/vs/scCodeBridge.ts` 改用官方 `@tauri-apps/api/core`，修复未启用 `withGlobalTauri` 时所有 `invoke` 返回 `null`；新增 `logToHost` 把前端诊断写入宿主日志。
- 变更：Go agent server 改为首次调用 `server_endpoint` 时懒启动；WASM 运行时改为首次加载 WASM 扩展时才创建 wasmtime engine。
- 变更：前端把 `terminal/xterm` 拆为独立 chunk，其余 `base/platform/editor` 保持单一 `core`（由 `nls` 优先加载）；`SC_CODE_SOURCEMAP=1` 可生成 hidden sourcemap。
- 移除：`jsonwebtoken` 依赖（未被引用，且它是 aws-lc-sys/NASM 构建要求的唯一来源）。
- 变更：`sc-code-terminal` 移出 Cargo workspace 成员（源码保留）；`vite` 配置增加 `SC_CODE_REAL_EXT_HOST` 环境前缀（仅暴露该开关）。
- 修复：Release 包启动黑屏——把 `base/platform/editor` 拆成独立 chunk 后与 `nls` 形成循环依赖，生产包报 `Cannot access 'ua' before initialization`；现已恢复为无环分组，并用无 Tauri 的 headless 浏览器验证工作台完整启动。
- 修复：`storage_list` 命令未在 `lib.rs` 注册，导致 SQLite 存储读取恒为空。
- 修复：真实宿主下移除未移植的 `mainThreadComments/Timeline/Browsers/UriOpeners` 客户与宿主侧未注册的 notebook/share 代理断言。

### 已知边界
- 真实宿主仍为实验开关：第三方扩展 API 矩阵、评论/时间线/浏览器视图等未移植功能、多窗口宿主隔离尚未验收。
- CSP/workspace trust、持久 journal、跨文件事务、共享 LSP/index 仍按 ROADMAP 待办。

- 新增 setup/run/dev/build/release/test/verify/clean 日常 BAT，前台运行、保留退出码，支持 --help/--dry-run；清理不强杀应用，不删除用户配置。
- 本地 runtime、打包输出、前端生成物、元数据和日志统一放 .runtime 并忽略；终端集成仅保留规范源，7 项重复来源仍保留完整清单校验。
- 默认用户数据目录改为 ScCode；扩展凭据使用稳定的 profile 身份命名。
- 内置 Agent 每次启动收起侧栏，不恢复旧展开状态；仍可手动打开，本轮未移除 Agent/Go 后台服务。

### 变更
- 桌面打包同步生成 packages/unpack/dev 与 packages/unpack/release：可双击 ScCode.exe 的完整免安装目录，附内置运行资源、许可证与 SHA256 清单；按已构建资源校验后暂存替换，拒绝缺资源/路径链接/额外用户文件，clean 保留。仍需系统 WebView2，默认数据目录保持 %APPDATA%\ScCode。
- 打包成功后将本次 NSIS/MSI 安装包导出至根目录 packages/dev（Debug）或 packages/release（Release）；成品不入库，clean 保留，失败/仅编译不导出历史包。
- ScCode 图标调整为紫灰底与淡紫色 C/光标，保留 SC 字形、编辑器窗口和代码括号；同步 SVG、PNG、ICO、ICNS，与 ScBrowser 的深蓝/青色配色区分。

### 新增
- 以 SC 字母、编辑器窗口与代码括号为元素的无字体 SVG；接入网页 favicon/标题栏和 PNG/ICO/ICNS 平台图标。
- 使用 vibe-coding-starter 初始化；完整导入上游 workbench 的 3704 项跟踪文件并保存来源校验清单。
- 独立 ScCode 身份、数据目录和 0.1.0 产品版本；保留 VS Code 1.110.0 API。
- VSIX/工作区拖拽、accessibility 服务和 profile 扩展同步变成普通功能模块。
- 固定版本、SHA256 校验的 Node、94 个内置扩展和原生 Go agent 准备链路；Windows debug NSIS 验收包。
- 扩展 globalState/workspaceState 改为 profile 内持久 Memento；多根/工作区文件身份隔离，状态支持重启恢复和并发合并。
- 扩展 secrets 接入原生 OS keyring 请求桥；按 profile/扩展/key 命名，失败明确报错，不明文降级。

### 修复
- 应用显示品牌、原生窗口/菜单、扩展 env 和终端标识统一为 ScCode，exe 名同步。
- 聊天离线发送、重连、取消与超时的生命周期；侧车重启后失效旧端口/凭据。
- 原子文件写、UTF-8 校验和索引工作区切换；回滚检查并发变更。
- Windows 工作区目录非法字符、构建 PATH 大小写冲突、后台命令和临时路径跨平台测试。
- 数据库打开失败不再删除原数据库重建。
- 配置保存失败不再假成功；JSONC 保留、并发更新序列化、完整扩展键合并及删除文件后刷新。
- 取消原生、Node宿主和服务三处静默硬编码扩展黑名单；显式禁用策略统一覆盖直接加载/激活，不承诺专有 API/服务兼容。
- 扩展不再写安装目录：状态/日志与 ESM shim 进入可写 profile；旧 .global-storage/.storage 文件只复制缺失项，来源保留。
- 修正 extensionMode 为 Production，移除激活时强制清空 Python 状态；工作区切换重新建立 context，避免旧状态混用。
- CJS 扩展更新刷新 package.json/main，撤销旧命令/订阅并加载新入口；ESM 支持顶层 await 和中文/空格路径。
- 自动化补验真实生产宿主的配置/TreeView、状态重启、多根切换、对话框 Uri 回包与取消、CJS 更新与 ESM 初次加载。

### 安全
- Go/Node 本地接口使用随机会话 token、loopback/Host/Origin 校验；普通 REST 不接受 URL token。
- WebView/原生/扩展/agent 统一到独立 profile；隔离测试不读真实浏览器数据；秘密索引开启 secure_delete，旧历史页仍需单独处理。
- 缩小资源授权范围；密钥禁止明文降级。
- 默认禁用旧更新渠道和遥测；新渠道只能显式配置，遥测需显式 opt-in。

### 已知边界
- 扩展Rust回归仍有Windows shell超时清理、终端Unix路径用例及remote测试依赖API缺口；桌面构建成功，不代表所有模块测试通过。
- 未签名、未发布；完整 custom GUI 行为和第三方扩展矩阵未验收。Windows GUI 截图/输入接口拒绝访问。
- 真 OS keyring 桌面读写尚未验收；secret namespace 不等于扩展授权或原生代码沙箱，change通知仅当前context。
- 旧内存 Memento/secrets 未落盘值不可恢复；Memento崩溃残留锁需要恢复设计，缓存不跨窗口实时刷新，setKeysForSync未实现云同步，ESM未实现真正热重载。
- CSP/trust、持久 checkpoint、跨文件事务、共享 LSP/index 和旧秘密页残留仍需后续完善；已有 Rust warnings 尚未全部整治。
