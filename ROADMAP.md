# 总体开发计划 · ScCode

## 总进度
2026-10-18：starter 初始化和 3704 项完整源码导入完成；独立运行、安全基础、扩展状态与 Windows debug NSIS 链路已实现并做自动化回归。**完整行为验收尚未完成，未签名、未发布。**
2026-10-19：完成真实 Node 扩展宿主 PoC（实验开关）、profile SQLite 存储迁移、Go/WASM 懒启动、依赖清理与性能基线；真实宿主已在隔离 profile 中启动并激活合成扩展，默认仍走旧宿主。
2026-10-19：v0.1.1 已打包并上传 GitHub Release（prerelease）：Windows x64 NSIS 安装包 + unpack zip；版本号、About 回退值与打包文档同步。
2026-10-19：packages 目录精简为 dev（仅 Debug unpack zip，含 PDB）与 release（setup + unpack zip），移除 packages/unpack。
2026-10-19：内部与外部标识统一为 ScCode：Rust crate/SDK/WASM 包、Go Agent 目录与产物、命令/设置 ID、协议、配置目录与扩展清单全部使用 ScCode 命名；移除旧品牌兼容层与首次数据导入。`docs/` 清理为当前有效内容，README 重排并补截图。
2026-10-19：打包输出增加未压缩 `packages/<dev|release>/unpack/`，zip 以该目录为源且根目录不再包含版本外壳子目录。
2026-10-20：Go Agent 使用内置 Go 1.26 + llvm-mingw 编译通过；`release.bat` 重新构建 0.1.1 成品成功（setup exe + unpack 目录 + zip），隔离 profile 冒烟通过；尚未重新上传 Release。
2026-10-20：`build.bat` 改为只编译；打包统一为 `package.bat`（一次生成 Debug + Release）与 `manager.sh package`，产物目录从 `packages/` 迁到 `dist/`（`dev`/`release` + `unpack/`，zip 根目录无版本外壳）。
2026-10-20：v0.1.2 已打包并上传 GitHub Release（prerelease）：`ScCode_0.1.2_x64-setup.exe` + `ScCode_0.1.2_x64-unpack.zip`；隔离 profile 冒烟通过。
2026-10-21：桌面壳体验补齐：关于对话框产品图标、标题栏应用图标置左、Windows 任务栏最近文件夹/工作空间跳转列表；新增按 profile 隔离的单实例参数转发。
2026-10-22：应用 D 版 ScCode 图标并替换标题栏/About/桌面图标；版本号升至 0.2.0；清理仓库内本机路径并修复截图来源清单。
2026-10-22：v0.2.0 已打包并上传 GitHub Release（prerelease）：`ScCode_0.2.0_x64-setup.exe` + `ScCode_0.2.0_x64-unpack.zip`；Release unpack 隔离 profile 冒烟通过。
2026-10-25：完成 S18–S22（安全加固、性能与正确性、真实宿主前置、体验补齐、收敛）；v0.3.0 已打包并上传 GitHub Release（prerelease）：`ScCode_0.3.0_x64-setup.exe` + `ScCode_0.3.0_x64-unpack.zip`；Release 包内验证搜索/终端/webview 隔离/CLI 定位/隔离 profile。
2026-10-27：移除迁移期来源清单与验证链，`docs/` 只保留开发文档与资源、不再被测试读取；清理残留 CUSTOM 标记、未参与构建的锁文件与 vendor 脚本。
2026-10-27：v0.4.0 已打包并上传 GitHub Release（prerelease）：`ScCode_0.4.0_x64-setup.exe` + `ScCode_0.4.0_x64-unpack.zip`；Release 包隔离 profile 启动冒烟通过。

2026-11-02：完成项目审查与安全后续修复：数据迁移/原子编辑、聊天/补全、DNS 连接地址校验、CSP、窗口级原生执行信任、SSH 执行协议、终端回归、多窗/CLI 与隔离日志；全量/生产 npm 审计 0。0.4.1 已完成 Windows x64 Debug/Release 打包，Release ZIP 隔离 WebView2 冒烟 9/9，setup 与 unpack ZIP 均已上传 GitHub prerelease。
2026-11-02：修复 0.4.1 的 CSP 回归（Tauri 给静态 `<style>` 注入的 nonce 使 `style-src 'unsafe-inline'` 失效，运行时主题/codicon/菜单样式被拦截，图标与排版异常）：仅对 style-src 关闭 Tauri 自动 nonce/hash 注入，并新增配置回归与真实桌面主题/图标冒烟断言。
2026-11-07：完成 S24（近期与中期 VS Code 核心模块全量接入及真实扩展宿主默认开启，产品版本升至 0.5.0）：补齐 Outline、Call/Type Hierarchy、Timeline + Local History、Merge Editor、Multi-Diff Editor、Bulk Edit Preview、Comments、External URI Opener、Welcome Walkthrough/Views、CodeEditor/Emmet/InlayHints/CodeActions/DropOrPasteInto/ScrollLocking 等 18 项工作台模块与 MainThread 桥接；修复 Tauri 下内置扩展 `file://` 路径扫描并默认启用真实 Node 扩展宿主；新增 `vscode.git` v1 API 扩展宿主兼容层。
2026-11-07：修复 `dev.bat` 点击无反应并调整为“先编译、再启动开发模式”（未改 Go 源码时复用已校验的 `sc-code-agent.exe`，先打包真实宿主并完成 `cargo build` 再启动 `tauri dev`），产品版本升至 0.5.1 并完成 Windows x64 Debug/Release 打包与 GitHub Release 发布。
2026-11-12：修复默认真实扩展宿主下 VAC 崩溃：native `logs/localProcess` 与扩展存储根目录未预创建，首次 `createOutputChannel` 的非递归 mkdir 以 ENOENT 终止整个宿主；VAC 1.15.0 在隔离 profile 的侧边栏/Chat 验证通过。同轮修复 Claude Code 2.1.296 激活失败（模块加载即调用 `NotebookCellOutputItem.error`，API 未导出 notebook 数据类型），Chat 面板可打开。2026-11-13 修复发布版 HTTPS workbench 下真实宿主误用 `wss` 连接明文 `ws` 回环端口的 `ERR_SSL_PROTOCOL_ERROR`，profile 中 Open VSX 远程 location 导致扩展无法加载，以及 WebView2 `window.open` 被拦截导致「Open in New Window」弹出浏览器提示；VAC/Claude 在 HTTPS origin、真实 profile 与辅助窗口下验证通过，真实安装包与其余第三方扩展矩阵仍待验收。
2026-11-13：发布 v0.6.0（真实扩展宿主兼容、WebView2 辅助窗口与搜索面板状态），完成 Windows x64 Debug/Release 打包、Release 包冒烟与 GitHub prerelease。

## 开发大纲
| 编号 | 优先级 | 任务 | 状态 |
|---|---|---|---|
| S0a | P0 | ~~starter 初始化、完整源码导入、来源清单~~ | ✅ 2026-10-18 |
| S0b | P0 | custom 全功能逐项行为验收 | 部分自动化通过；GUI 项待验 |
| S1a | P0 | ~~独立身份、固定资源打包~~ | ✅ 2026-10-18 |
| S1b | P0 | 安装/升级与历史 WebView 状态验收 | GUI 输入/截图受阻 |
| S2a | P0 | ~~本地 transport 鉴权、密钥禁明文降级、单文件冲突保护~~ | ✅ 2026-10-18 |
| S2b | P0 | CSP/workspace trust、扩展/工具权限边界 | 2026-11-02：CSP 与窗口级高风险原生命令信任已实现并回归；style-src 需关闭 Tauri nonce 注入以保留 VS Code 运行时样式（见 ARCHITECTURE §4）；细粒度扩展/Agent 授权与 Node 沙箱仍待开发 |
| S2c | P0 | 持久恢复 journal、多文件事务、状态锁崩溃恢复 | 待开发；现有 checkpoint 仅单文件内存 |
| S3a | P1 | ~~Node/TS/Rust/Go 回归、真实宿主/侧车 smoke、最新 debug NSIS~~ | ✅ 2026-10-18 |
| S3b | P1 | 干净机器、正式 release/签名和 CI 实际运行 | 待验收 |
| S3c | P1 | 扩展Rust回归：Windows shell超时清理、终端平台测试、remote测试API | 2026-11-02：旧 terminal 纳入 workspace/CI（88 项）；SSH 真实本地握手与 stdout/stderr/状态通过；native exec 有界输出/完整超时已修，Agent 历史异常与逃逸子进程仍需专项 |
| S4a | P1 | ~~JSONC 配置、持久 Memento/工作区隔离、扩展 secret native 桥~~ | ✅ 2026-10-18；真 keyring 未验 |
| S4b | P1 | 全扩展 API 契约、跨窗口同步、ESM 重启策略与真 keyring | 待开发/验收 |
| S5 | P1 | AI 与 IDE 共用文档/LSP/index Runtime | 待开发 |
| S5b | P1 | ACP客户端插件/AgentBackend替换内置Agent | 已评估；本轮未移除，待协议与迁移验收 |
| S5c | P1 | ~~独立Tab补全适配，修正默认后端路由不一致~~ | ✅ 2026-11-02；默认协议契约回归通过，真实模型与延迟待验 |
| S7 | P1 | ~~ScCode显示品牌、SC SVG、多平台图标~~ | ✅ 2026-10-18；含紫灰/淡紫配色区分，重打包/GUI边界见HANDOFF |
| S8 | P1 | ~~日常 BAT（含独立Release入口与packages/dev、release安装包和unpack/dev、release免安装目录）、.runtime 收拢、ScCode profile 与凭据身份、Agent默认收起~~ | ✅ 2026-10-18；自动化与包信息见HANDOFF，真实GUI/keyring待验 |
| S9 | P1 | ~~仓库布局、源码/生成物Git边界与首次提交~~ | ✅ 2026-10-18；干净检出验收通过，提交/推送记录以Git为准 |
| S6 | P2 | 扩展 API/服务/许可矩阵、性能基准与新特性 | 待开发 |
| S10a | P0 | ~~真实 Node 扩展宿主：bundle、Rust 监管、PersistentProtocol/WS、工作台 `IExtensionHost`、磁盘扩展先行注册、开关~~ | ✅ 2026-10-19；实验开关，默认关闭 |
| S10b | P0 | 真实宿主全量验收：VAC/Claude Code 等第三方扩展、内置扩展矩阵、多窗口宿主隔离、异常恢复 | 待开发；实测真实宿主未注册扩展贡献命令（typescript/emmet 等 MISSING），旧宿主同样缺（2026-10-25）；2026-11-12/13 VAC 1.15.0 侧边栏/Chat 与 Claude Code 2.1.296 激活/Chat 已在隔离 profile（含 HTTPS origin）及真实 profile 通过（修复日志目录缺失、notebook 类型缺失、loopback wss/ws 错配与 Open VSX 远程 location），其余矩阵待验收 |
| S10c | P1 | ~~设置/UI 状态迁到 profile SQLite + IndexedDB 一次性迁移~~ | ✅ 2026-10-19 |
| S10d | P1 | ~~Go agent 懒启动、WASM 运行时懒初始化、前端分包、性能基线脚本、IPC 桥修复、依赖清理~~ | ✅ 2026-10-19 |
| S10e | P0 | ~~修复 Release 黑屏（分包循环 TDZ）：恢复 base/platform/editor 单一 core，仅拆 terminal；新增 `smoke:dist` 生产包 headless 冒烟并接入 CI~~ | ✅ 2026-10-19 |
| S11 | P0 | ~~v0.1.1 发布链路：版本号同步、unpack zip、打包/发布 skill、GitHub Release 上传~~ | ✅ 2026-10-19；安装包 + unpack zip 均已上传 |
| S12 | P1 | ~~packages 目录精简：dev 仅 Debug unpack zip（含 PDB），release 为 setup + unpack zip，移除 packages/unpack~~ | ✅ 2026-10-19 |
| S13 | P1 | ~~内部与外部标识统一为 ScCode：Rust crates/SDK/WASM 包、Go Agent 目录与产物、命令/设置 ID、协议、目录与清单；移除旧品牌兼容层与首次数据导入；清理历史 docs 并重排 README~~ | ✅ 2026-10-19；Go 编译已复验（2026-10-20） |
| S14 | P1 | ~~打包输出未压缩 `packages/<dev\|release>/unpack/`，并生成根目录无版本外壳子目录的 zip~~ | ✅ 2026-10-19 |
| S15 | P0 | ~~v0.1.2 发布链路：版本号同步、Debug/Release 打包、隔离 profile 冒烟、GitHub prerelease 上传~~ | ✅ 2026-10-20；setup + unpack zip 均已上传 |
| S16 | P1 | ~~桌面壳体验：关于对话框图标、标题栏应用图标置左、Windows 任务栏最近文件夹/工作空间跳转列表与单实例转发~~ | ✅ 2026-10-21；2026-11-02 修复多窗线程/协议，隔离 WebView2 单实例 CLI 转发通过；真实任务栏点击/About 外观仍待验 |
| S17 | P1 | ~~D 版图标接入、版本号 0.2.0、仓库本机路径清理与截图来源清单修复~~ | ✅ 2026-10-22；setup + unpack zip 已上传 GitHub prerelease |
| S18 | P0 | ~~安全面收紧：webview 独立来源、IPC 来源守卫、`git_run` 收紧、asset 授权收窄~~ | ✅ 2026-10-25；dev 实跑 + CDP 验证，Release 包冒烟随 S19；命令面收敛并入 S22 |
| S19 | P1 | ~~性能快修：重活命令移出主线程、文件二进制 IPC、搜索正确性与取消、存储批量写、事件定向~~ | ✅ 2026-10-25；另修复全局搜索失效、终端乱码/退出码、监听丢新建、回收站；dev 实跑验证 |
| S20 | P0 | ~~真实宿主转正前置：`ICustomEditorService`、Node 调试服务（executable 适配器）~~ | ✅ 2026-10-25；宿主 stdio 排空修复；扩展注册缺口归 S10b |
| S21 | P1 | ~~体验缺口：保存参与者、面包屑/Outline 服务、关窗拦截、CLI 打开路径~~ | ✅ 2026-10-25；Explorer 的 Outline 面板已在 S24 补齐，`--wait` 未做 |
| S23 | P0 | ~~项目审查修复：DB/chat、SSH、原子编辑、补全协议、跨窗宿主/搜索、文件元数据、DNS/CSP/trust、依赖与构建测试~~ | ✅ 2026-11-02；自动化及隔离 WebView2 核心链路通过，完整扩展/真实服务仍待验收，已完成 v0.4.1 打包与预发布 |
| S24 | P1 | ~~近期与中期 VS Code 核心模块全量接入：Outline/Call&Type Hierarchy/Timeline/LocalHistory/MergeEditor/MultiDiffEditor/BulkEditPreview/Comments/ExternalUriOpener/Welcome/Emmet/InlayHints/DropOrPasteInto/ScrollLocking + 真实扩展宿主默认启用与内置扩展 `file://` 扫描 + `vscode.git` API 兼容层~~ | ✅ 2026-11-07；ext-host:build、typecheck、lint、test、test:ext-host、build、smoke:dist 与 rust:check 全部通过 |
| S22 | P2 | ~~收敛：无消费者的 scCode 桥接服务加载、CUSTOM 标记~~ | ✅ 2026-10-27；CUSTOM 标记与不必要桥接已清理 |

## 已交付里程碑
- ✅ 2026-11-13：~~v0.6.0 真实扩展宿主兼容、辅助窗口与搜索状态~~ — [GitHub Release](https://github.com/zouv/sc-code/releases/tag/v0.6.0)，未签名 Windows x64 prerelease；修复 HTTPS workbench 下真实宿主 `wss/ws` 错配、Open VSX 远程 location、native 日志/存储目录与 notebook 类型缺失，新增 WebView2 辅助窗口与搜索中/完成状态；VAC 1.15.0 与 Claude Code 2.1.296 实机验证，`npm test` 109/109，Release 包冒烟通过。
- ✅ 2026-11-07：~~v0.5.1 开发模式编译启动修复与发布~~ — [GitHub Release](https://github.com/zouv/sc-code/releases/tag/v0.5.1)，未签名 Windows x64 prerelease（非 draft）；修复 `dev.bat` 点击无反应并调整为“先编译、再启动开发模式”（`prepare-desktop-runtime.cjs` 复用已校验 `sc-code-agent.exe`、`dev-desktop.cjs` 先执行 `ext-host` 打包与 `cargo build --no-default-features` 再启动 `tauri dev`）。
- ✅ 2026-11-07：~~S24 近期与中期 VS Code 核心模块全量接入及真实扩展宿主默认开启~~ — 补齐 18 个核心工作台模块与 13 处原 stub 的真实实现，恢复 `mainThreadTimeline`、`mainThreadComments`、`mainThreadUriOpeners` 与 `MultiDiffEditor` RPC 契约；修复 Tauri 桌面端内置扩展 `file://` 路径扫描与存储路径，默认启用真实 Node 扩展宿主并内置 `vscode.git` v1 API 兼容层；`ext-host:build`、`typecheck`、`lint`、`npm test`（99/99）、`test:ext-host`（2/2）、`rust:check`、`build` 与 `smoke:dist` 全部通过。
- ✅ 2026-11-02：~~v0.4.2 CSP 样式回归修复与发布~~ — [GitHub Release](https://github.com/zouv/sc-code/releases/tag/v0.4.2)，未签名 Windows x64 prerelease（非 draft）；tag `v0.4.2` 指向 `8950484`，修复 0.4.1 因 Tauri style nonce 导致的工作台图标/菜单/主题样式丢失。
- ✅ 2026-11-02：~~v0.4.1 打包与发布~~ — [GitHub Release](https://github.com/zouv/sc-code/releases/tag/v0.4.1)，未签名 Windows x64 prerelease（非 draft）；tag `v0.4.1` 指向 `001413d`，发布代码 [CI 41372567720](https://github.com/zouv/sc-code/actions/runs/41372567720) 六个任务全部通过（frontend/native/agent 与 Windows/Linux/macOS runtime）。
- ✅ 2026-11-02：~~S23 项目审查及安全后续修复~~ — 前端/Go/Rust、生产 CSP 工作台、隔离 WebView2 双窗/信任/宿主/PTY/frame/CLI 与本地真实 SSH 专项通过，npm 审计 0；已随 v0.4.1 预发布交付，不代替第三方扩展、付费模型、私有服务与真 keyring 验收。
- ✅ 2026-10-22：~~D 版图标接入与 0.2.0 发布~~ — `docs/icons/` 资源已替换应用图标；`v0.2.0` setup + unpack zip 已上传 GitHub prerelease，Release unpack 隔离 profile 冒烟通过。
以上 ✅ 为实现里程碑；最新 v0.4.2 的 Windows x64 安装包与 unpack ZIP 已上传 GitHub prerelease。自动化测试通过不代表所有 GUI、用户数据或第三方扩展都兼容。


## 验收矩阵 / 兼容风险 / 验证边界

详见 [`arch/verification.md`](arch/verification.md)。
