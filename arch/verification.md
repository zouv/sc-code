# 验收矩阵 / 兼容风险 / 验证边界

> 从 ROADMAP.md 拆出，保留历史细节；计划与完成度仍以 ROADMAP 为准。

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

## 下一批交付顺序
1. P0 行为验收：可交互 Windows 会话/干净机器执行完整 profile 全矩阵。
2. P0 安全：在已启用 DNS/CSP/窗口级 trust 的基础上，继续做细粒度扩展/Agent 权限与 Node/文件系统沙箱，验证工作台真实信任 UI→宿主恢复；独立 Agent/provider 与浏览器出站流量边界另行设计，不把 renderer proxy 直连当全应用 SSRF 防护。
3. P0 恢复：持久 journal + 崩溃恢复状态机 + 多文件 prepare/commit/rollback + 内容冲突检测；进程锁应先辨别活跃持有者，禁止超时直接删除锁。
4. P1 Runtime：文档版本/编辑源一致性 → LSP/index共享 → agent只消费同一文档快照；逐步替换双份服务，不先重写工作台。

