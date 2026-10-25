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

## 开发大纲
| 编号 | 优先级 | 任务 | 状态 |
|---|---|---|---|
| S0a | P0 | ~~starter 初始化、完整源码导入、来源清单~~ | ✅ 2026-10-18 |
| S0b | P0 | custom 全功能逐项行为验收 | 部分自动化通过；GUI 项待验 |
| S1a | P0 | ~~独立身份、固定资源打包~~ | ✅ 2026-10-18 |
| S1b | P0 | 安装/升级与历史 WebView 状态验收 | GUI 输入/截图受阻 |
| S2a | P0 | ~~本地 transport 鉴权、密钥禁明文降级、单文件冲突保护~~ | ✅ 2026-10-18 |
| S2b | P0 | CSP/workspace trust、扩展/工具权限边界 | 待开发；不可信项目/扩展不可视作安全 |
| S2c | P0 | 持久恢复 journal、多文件事务、状态锁崩溃恢复 | 待开发；现有 checkpoint 仅单文件内存 |
| S3a | P1 | ~~Node/TS/Rust/Go 回归、真实宿主/侧车 smoke、最新 debug NSIS~~ | ✅ 2026-10-18 |
| S3b | P1 | 干净机器、正式 release/签名和 CI 实际运行 | 待验收 |
| S3c | P1 | 扩展Rust回归：Windows shell超时清理、终端平台测试、remote测试API | 新发现3项未修；生产构建通过不代表全套回归通过 |
| S4a | P1 | ~~JSONC 配置、持久 Memento/工作区隔离、扩展 secret native 桥~~ | ✅ 2026-10-18；真 keyring 未验 |
| S4b | P1 | 全扩展 API 契约、跨窗口同步、ESM 重启策略与真 keyring | 待开发/验收 |
| S5 | P1 | AI 与 IDE 共用文档/LSP/index Runtime | 待开发 |
| S5b | P1 | ACP客户端插件/AgentBackend替换内置Agent | 已评估；本轮未移除，待协议与迁移验收 |
| S5c | P1 | 独立Tab补全适配，修正默认后端路由不一致 | 已定位；不把ACP会话直接当低延迟补全 |
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
| S16 | P1 | ~~桌面壳体验：关于对话框图标、标题栏应用图标置左、Windows 任务栏最近文件夹/工作空间跳转列表与单实例转发~~ | ✅ 2026-10-21；Rust 单测与静态回归通过，GUI 实跑待验收 |
| S17 | P1 | ~~D 版图标接入、版本号 0.2.0、仓库本机路径清理与截图来源清单修复~~ | ✅ 2026-10-22；setup + unpack zip 已上传 GitHub prerelease |
| S18 | P0 | ~~安全面收紧：webview 独立来源、IPC 来源守卫、`git_run` 收紧、asset 授权收窄~~ | ✅ 2026-10-25；dev 实跑 + CDP 验证，Release 包冒烟随 S19；命令面收敛并入 S22 |
| S19 | P1 | ~~性能快修：重活命令移出主线程、文件二进制 IPC、搜索正确性与取消、存储批量写、事件定向~~ | ✅ 2026-10-25；另修复全局搜索失效、终端乱码/退出码、监听丢新建、回收站；dev 实跑验证 |
| S20 | P0 | ~~真实宿主转正前置：`ICustomEditorService`、Node 调试服务（executable 适配器）~~ | ✅ 2026-10-25；宿主 stdio 排空修复；扩展注册缺口归 S10b |
| S21 | P1 | ~~体验缺口：保存参与者、面包屑/Outline 服务、关窗拦截、CLI 打开路径~~ | ✅ 2026-10-25；Explorer 的 Outline 面板与 `--wait` 未做 |
| S22 | P2 | ~~收敛：无消费者的 scCode 桥接服务加载、CUSTOM 标记~~ | ✅ 2026-10-25（部分）；源码文件按来源清单保留，仅解除引用 |

## 移植验收矩阵
| 兼容场景 | 当前证据 | 尚待验收 |
|---|---|---|
| 文件/功能不遗漏、独立产品身份 | 3664 项保留清单（原 3704 项，移除 40 项历史文档）；普通功能模块与身份自动检查 | 清单不替代行为验收 |
| 扩展配置/启动/TreeView | 真生产 Node 宿主配置门、配置值、Tree provider 自动测试 | 活动栏图标、启动视图恢复、WebviewView dispose GUI |
| 打开/保存对话框 | 真宿主模拟 Workbench 回包；Uri/fsPath/中文空格路径/取消 | 桌面文件选择器真实 UI |
| 扩展更新/状态 | CJS 新入口/命令撤销/树刷新；ESM初次加载；状态重启、多根切换 | ESM真正热重载、第三方扩展完整生命周期 |
| VSIX/profile扩展同步/工作区拖拽 | 源码保留、类型与模块检查 | 安装 VSIX、标签拖动、拖文件不变脏、区域语义逐项 GUI |
| 设置/数据隔离 | JSONC并发保存；profile 与 HOME 隔离测试 | 安装升级、WebView跨origin历史状态、真keyring |
| AI通信 | 取消/重连/endpoint；真实Go REST/WS鉴权smoke | 实际provider模型、工具权限、长会话故障恢复 |
| 构建/发布脚本与文档 | 独立打包与文档同步 | 正式签名发行、跨平台构建 |

## 下一批交付顺序
1. P0 行为验收：可交互 Windows 会话/干净机器执行完整 profile 全矩阵。
2. P0 安全：梳理需要的资产/网络来源与 Tauri invoke能力 → 收紧 CSP → workspace trust/扩展执行与agent工具授权；回归测试先于强制切换。
3. P0 恢复：持久 journal + 崩溃恢复状态机 + 多文件 prepare/commit/rollback + 内容冲突检测；进程锁应先辨别活跃持有者，禁止超时直接删除锁。
4. P1 Runtime：文档版本/编辑源一致性 → LSP/index共享 → agent只消费同一文档快照；逐步替换双份服务，不先重写工作台。

## Agent 当前兼容风险
- Go注册66种工具但不是66种完整桌面能力：本机LSP仍是提示文本；patch/regex、后台shell与read_lints路由缺少Rust处理；编排local_exec=false与server拒绝workspace工具的策略冲突。
- Tab补全存在 /v1/completions 与 /complete 契约不一致，需外部FIM服务；云Agent设置明确无托管后端。
- 本轮未调用真实模型/账户验证；移除内置Agent前必须以真实编辑、语言语义、取消/权限和历史会话迁移为验收项。

## Agent 解耦交付建议（评估，不代表本轮已实现）
1. 定义插件级 AgentBackend/会话模型；保留通用聊天、流式渲染、文件上下文、diff和权限UI，模型/推理/记忆交给外部Agent。
2. ScCode 实现 ACP Client + Agent启动/生命周期 + 能力协商；建立 initialize/new/prompt/update/cancel、permission、可选文件/终端/会话恢复的fake Agent契约测试，默认拒绝未知权限。
3. 固定至少一个外部Agent版本做真实编辑/取消/失败/重连/授权验收；未实现能力显示不可用，不模拟成功。ACP不是VSIX扩展协议，不能仅安装Agent而省略Client。
4. 按通用文件/文档版本检查接入读写，保留 unsaved buffer、路径/工作区权限和取消后子进程清理边界；ACP不自动保证权限沙箱。
5. 会话导入/导出与设置解析；确认切换不丢历史后停自启Go、移除内置provider/计费/推理/专属MCP&skills设置和资源；不要连带删除共享Node宿主、LSP、DAP、搜索/终端。
6. Tab补全、多Agent DAG/验证器/记忆和长期恢复另做能力矩阵，不承诺ACP可一键替代；安全/事务P0仍需要独立完成。

## 已交付里程碑
- ✅ 2026-10-22：~~D 版图标接入与 0.2.0 发布~~ — `docs/icons/` 资源已替换应用图标；`v0.2.0` setup + unpack zip 已上传 GitHub prerelease，Release unpack 隔离 profile 冒烟通过。
以上 ✅ 为实现里程碑；v0.2.0 的 Windows x64 安装包与 unpack zip 已上传 GitHub prerelease。自动化测试通过不代表所有 GUI、用户数据或第三方扩展都兼容。

## 新发现的回归缺口（2026-10-18）
- crates/sc-code-agent/src/tools/shell.rs / timeout_terminates_long_running_child：1秒超时测试实耗88秒，未满足7秒上限；同步taskkill/pipe清理链路需单独诊断，不能靠放宽断言掩盖。未承诺Agent取消会可靠清理子进程。
- crates/sc-code-terminal/src/link_detection.rs / detect_absolute_path_unix：Windows下Unix绝对路径用例失败；明确跨平台产品语义后修检测或约束测试，不能只为变绿忽略。
- crates/sc-code-remote/src/ssh.rs 测试：依赖的russh_keys::key::ed25519 API不存在，测试目标编译失败；修fixture并重跑SSH测试。生产构建未受此测试编译问题影响。
