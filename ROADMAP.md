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
| S10b | P0 | 真实宿主全量验收：VAC/Claude Code 等第三方扩展、内置扩展矩阵、多窗口宿主隔离、异常恢复 | 待开发；实测真实宿主未注册扩展贡献命令（typescript/emmet 等 MISSING），旧宿主同样缺（2026-10-25） |
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
| S21 | P1 | ~~体验缺口：保存参与者、面包屑/Outline 服务、关窗拦截、CLI 打开路径~~ | ✅ 2026-10-25；Explorer 的 Outline 面板与 `--wait` 未做 |
| S23 | P0 | ~~项目审查修复：DB/chat、SSH、原子编辑、补全协议、跨窗宿主/搜索、文件元数据、DNS/CSP/trust、依赖与构建测试~~ | ✅ 2026-11-02；自动化及隔离 WebView2 核心链路通过，完整扩展/真实服务仍待验收，已完成 v0.4.1 打包与预发布 |
| S22 | P2 | ~~收敛：无消费者的 scCode 桥接服务加载、CUSTOM 标记~~ | ✅ 2026-10-27；CUSTOM 标记与不必要桥接已清理 |

## 移植验收矩阵
| 兼容场景 | 当前证据 | 尚待验收 |
|---|---|---|
| 文件/功能不遗漏、独立产品身份 | 普通功能模块与产品身份自动检查；扩展宿主、打包、仓库布局回归 | 自动化不替代行为验收 |
| 扩展配置/启动/TreeView | 真生产 Node 宿主配置门、配置值、Tree provider 自动测试 | 活动栏图标、启动视图恢复、WebviewView dispose GUI |
| 打开/保存对话框 | 真宿主模拟 Workbench 回包；Uri/fsPath/中文空格路径/取消 | 桌面文件选择器真实 UI |
| 扩展更新/状态 | CJS 新入口/命令撤销/树刷新；ESM初次加载；状态重启、多根切换 | ESM真正热重载、第三方扩展完整生命周期 |
| VSIX/profile扩展同步/工作区拖拽 | 源码保留、类型与模块检查 | 安装 VSIX、标签拖动、拖文件不变脏、区域语义逐项 GUI |
| 设置/数据隔离 | JSONC并发保存；隔离 HOME/profile；当前 WebView2 双窗/日志同一 SC_CODE_HOME | 安装升级、历史状态迁移、真 keyring |
| AI通信 | 取消/重连/endpoint；补全协议与持久化回归；真实 Go REST/WS 鉴权 smoke | 实际 provider 模型、细粒度工具授权、长会话故障恢复 |
| 构建/发布脚本与文档 | 独立打包与文档同步 | 正式签名发行、跨平台构建 |

## 下一批交付顺序
1. P0 行为验收：可交互 Windows 会话/干净机器执行完整 profile 全矩阵。
2. P0 安全：在已启用 DNS/CSP/窗口级 trust 的基础上，继续做细粒度扩展/Agent 权限与 Node/文件系统沙箱，验证工作台真实信任 UI→宿主恢复；独立 Agent/provider 与浏览器出站流量边界另行设计，不把 renderer proxy 直连当全应用 SSRF 防护。
3. P0 恢复：持久 journal + 崩溃恢复状态机 + 多文件 prepare/commit/rollback + 内容冲突检测；进程锁应先辨别活跃持有者，禁止超时直接删除锁。
4. P1 Runtime：文档版本/编辑源一致性 → LSP/index共享 → agent只消费同一文档快照；逐步替换双份服务，不先重写工作台。

## Agent 当前兼容风险
- Go注册66种工具但不是66种完整桌面能力：本机LSP仍是提示文本；patch/regex、后台shell与read_lints路由缺少Rust处理；编排local_exec=false与server拒绝workspace工具的策略冲突。
- Tab补全已对齐默认本地 Agent 契约；仍需配置可用 COMPLETION_SERVER_URL/VLLM_URL 上游，自动化模拟服务不等于真实模型验收。自定义外部 endpoint 默认按 OpenAI 协议；云Agent设置明确无托管后端。
- 本轮未调用真实模型/账户验证；移除内置Agent前必须以真实编辑、语言语义、取消/权限和历史会话迁移为验收项。

## Agent 解耦交付建议（评估，不代表本轮已实现）
1. 定义插件级 AgentBackend/会话模型；保留通用聊天、流式渲染、文件上下文、diff和权限UI，模型/推理/记忆交给外部Agent。
2. ScCode 实现 ACP Client + Agent启动/生命周期 + 能力协商；建立 initialize/new/prompt/update/cancel、permission、可选文件/终端/会话恢复的fake Agent契约测试，默认拒绝未知权限。
3. 固定至少一个外部Agent版本做真实编辑/取消/失败/重连/授权验收；未实现能力显示不可用，不模拟成功。ACP不是VSIX扩展协议，不能仅安装Agent而省略Client。
4. 按通用文件/文档版本检查接入读写，保留 unsaved buffer、路径/工作区权限和取消后子进程清理边界；ACP不自动保证权限沙箱。
5. 会话导入/导出与设置解析；确认切换不丢历史后停自启Go、移除内置provider/计费/推理/专属MCP&skills设置和资源；不要连带删除共享Node宿主、LSP、DAP、搜索/终端。
6. Tab补全、多Agent DAG/验证器/记忆和长期恢复另做能力矩阵，不承诺ACP可一键替代；安全/事务P0仍需要独立完成。

## 已交付里程碑
- ✅ 2026-11-02：~~v0.4.2 CSP 样式回归修复与发布~~ — [GitHub Release](https://github.com/zouv/sc-code/releases/tag/v0.4.2)，未签名 Windows x64 prerelease（非 draft）；tag `v0.4.2` 指向 `8950484`，修复 0.4.1 因 Tauri style nonce 导致的工作台图标/菜单/主题样式丢失。
  - ScCode_0.4.2_x64-setup.exe：68,840,253 bytes；SHA-256 `53a0f7c7f304af359d0dd96cff72aa78f5b69c77804e206a735e698e3e940e0f`。
  - ScCode_0.4.2_x64-unpack.zip：94,639,283 bytes；SHA-256 `067ddaac5f3cdd497016d3294a3f5ecf3265e66f8101d80e541035506ff7d424`；zip 829 个条目，包脚本逐文件 size/SHA-256 校验通过。
  - Release ZIP 解压后的隔离 WebView2 冒烟 10/10（新增主题/codicon 运行时样式断言）；Debug unpack zip（246,490,919 bytes，含 PDB）已生成但不上传。
- ✅ 2026-11-02：~~v0.4.1 打包与发布~~ — [GitHub Release](https://github.com/zouv/sc-code/releases/tag/v0.4.1)，未签名 Windows x64 prerelease（非 draft）；tag `v0.4.1` 指向 `001413d`，发布代码 [CI 41372567720](https://github.com/zouv/sc-code/actions/runs/41372567720) 六个任务全部通过（frontend/native/agent 与 Windows/Linux/macOS runtime）。
  - ScCode_0.4.1_x64-setup.exe：68,847,226 bytes；SHA-256 `ffbdac20a615d39cd1a39f11d8044b383ec25ad29d6fc5b34887515a0ab485f9`。
  - ScCode_0.4.1_x64-unpack.zip：94,638,208 bytes；SHA-256 `2473446a0c6f4709061aef9aea1fdf54318c2065023f943ec56f6b99cb904b0b`。
  - Release ZIP 829 个条目、828 个清单文件逐一校验 size/SHA-256，通过 94 个内置扩展与运行资源 hash 检查；EXE ProductVersion/FileVersion 均为 0.4.1，解压后的真实 WebView2 隔离冒烟 9/9；没有执行安装器。
  - 本地 Debug unpack 与 `ScCode_0.4.1_x64-unpack-debug.zip`（247,040,685 bytes）已生成并通过清单验证，含 PDB，不上传；两通道未压缩目录位于 `dist/dev/unpack` 与 `dist/release/unpack`。远端两资产的大小/SHA-256 与本地一致，正文来自 CHANGELOG 0.4.1。
- ✅ 2026-11-02：~~S23 项目审查及安全后续修复~~ — 前端/Go/Rust、生产 CSP 工作台、隔离 WebView2 双窗/信任/宿主/PTY/frame/CLI 与本地真实 SSH 专项通过，npm 审计 0；已随 v0.4.1 预发布交付，不代替第三方扩展、付费模型、私有服务与真 keyring 验收。
- ✅ 2026-10-22：~~D 版图标接入与 0.2.0 发布~~ — `docs/icons/` 资源已替换应用图标；`v0.2.0` setup + unpack zip 已上传 GitHub prerelease，Release unpack 隔离 profile 冒烟通过。
以上 ✅ 为实现里程碑；最新 v0.4.2 的 Windows x64 安装包与 unpack ZIP 已上传 GitHub prerelease。自动化测试通过不代表所有 GUI、用户数据或第三方扩展都兼容。

## 回归缺口复验（2026-11-02）
- crates/sc-code-agent/src/tools/shell.rs / timeout_terminates_long_running_child：本轮原 7 秒上限断言通过，未放宽；历史 88 秒异常不能由一次环境复验判定根因已解决，取消/逃逸子进程清理仍需专项验收。
- crates/sc-code-terminal/src/link_detection.rs：旧 crate 已加入当前 Cargo workspace 和跨平台 CI，88 项通过，含多路径/Unicode 前缀/Windows+Unix 识别；未接入工作台，不等于替换生产终端。
- crates/sc-code-remote/src/ssh.rs：已对齐依赖公开 API，真实 loopback russh 握手在认证前拒绝未知/变更密钥，已知非标准端口成功，exec 正确返回 stdout/stderr/退出码（含 EOF 后状态）。临时内存密钥/合成密码，不触碰用户私钥；用户服务器、多跳与转发仍未验。

## 当前验证与性能边界（2026-11-02，0.4.1/0.4.2）
- 0.4.2 复验：前端 npm test 99/99；typecheck/lint、生产 build + smoke:dist 通过；Release ZIP 解压后隔离 WebView2 冒烟 10/10（含主题/codicon 运行时样式断言）。本轮未改 Rust/Go 代码，下列 Rust/Go 数据沿用同日 0.4.1 全量回归。
- 前端 npm test 97/97；transport 20/20；真实 Node 宿主进程 smoke 2/2；自有 TS lint 105 个文件零告警与 typecheck 通过。
- Rust workspace 1797 passed / 2 原有 ignored；Go fts5 全包通过；独立真实 Go 侧车 10 项 REST/WS 本地鉴权通过。
- 生产 frontend build 与 CSP smoke 通过；native Debug/Release 均已用当前资源重建，Release ZIP 解压后的隔离 WebView2 核心集成 9/9（含 restricted 搜索 Channel、双窗宿主、PTY、跨源 frame 与单实例 CLI）。信任状态通过程序性 IPC 验证，尚未实际点击授权 UI 验证工作台自动恢复全部扩展。
- npm audit 全量/生产均 0；Rust 遗留 warnings 未清零，不能把测试通过写成 strict clippy/fmt 全仓通过。
- 构建统计：JS 12.21 MB / CSS 642 kB / 总计 12.96 MB / WASM 资产 0。保留现有 chunk，未盲拆 core/platform/editor，循环 chunk/混合静态动态导入告警仍待有行为证据的专项优化。
- 隔离 debug 空工作区开发基线：窗口句柄 1.446 s；进程树 11 个进程，约 6.3/16.1/31.2 s 的 working set 为 639/612/592 MiB。仅一次开发测量，不当 Release 指标或 workbench 交互就绪时间；高内存与包体需以相同环境的后续基线专项优化。
