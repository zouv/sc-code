# 会话接力 · ScCode

## 当前状态
- 快照：2026-11-02；分支 main；当前进行中：0.4.1 打包、commit/push、GitHub 预发布。
- 版本已同步为 0.4.1；用户已明确授权 commit/push、打包与上传。当前包尚未生成/验收，上传前必须确认新 setup 与 unpack ZIP 同时存在，不复用旧产物。
- 已验收状态见 ROADMAP「当前验证与性能边界」；实现变化见 CHANGELOG「0.4.1」，不在此重复完成清单。

## 尚需真实环境验收
1. 工作台 trust：实际授权 UI 后确认全部扩展自动恢复；当前程序性 IPC 与合成服务测试不能替代此项。顶层 renderer 控制授权，执行 guard 不是 Node/文件系统沙箱，也不保证终止全部在途后台活动；细粒度授权/强隔离见 ROADMAP。
2. S10b 扩展生态：typescript/emmet/json 贡献命令、VAC/Claude Code/VSIX、TreeView/webview/对话框/自定义编辑器、Node 调试与 ESM 重载逐项验收；真实宿主仍受实验开关控制，旧 host.cjs 保留回退。
3. 外部服务：真实补全上游/付费模型、用户 SSH/多跳/转发/remote FS、真 keyring 尚未验收。现有模型协议与 SSH 用本地隔离服务验证，不读取真实凭据；首次 SSH 主机密钥登记仍需可信渠道核验。
4. Agent 文件任务：Rust patch/regex/LSP/后台 shell 缺口与 local_exec 边界见 ARCHITECTURE §3.5；持久 journal/多文件事务/冲突检测见 ROADMAP，不能把工具声明等同于真实任务可用。
5. 体验：Explorer Outline、--wait、MainThread comments/timeline/browserView/externalUriOpener、实际任务栏 Jump List 点击/About 外观与完整关窗询问流程尚需验收。
6. 性能：Debug 基线不代表 Release；包体与内存、循环 chunk/混合静态动态导入告警、Rust 遗留 warnings 待专项处理。不能声称 strict clippy/fmt 全仓通过；WASM 资产当前为 0，未启用实际加速。旧 terminal crate 已纳入回归，但未替换工作台 Tauri 终端；原历史后台 shell 问题与逃逸子进程清理仍需专项。

## 如何复验
- npm test；npm run test:transport；npm run typecheck；npm run lint；npm audit；npm audit --omit=dev。
- cargo test --offline --workspace；在 agent/server 执行 go test -tags fts5 ./...（Windows 需可用 CGO 编译器）。
- npm run ext-host:build；npm run test:ext-host；npm run test:server（隔离本地侧车，无 provider 调用）。
- npm run build；npm run smoke:dist；用 Git Bash 执行 bash check-docs.sh（Windows 不要误用 System32 的 WSL bash）。
- 真实桌面：先 npm run runtime:prepare，然后 npm run desktop:build -- --debug --no-bundle --ci（重建当前资源），再 npm run smoke:desktop；脚本自行使用一次性 HOME/profile/工作区，拒绝仓库 .env，限时清理自己创建的进程。
- 性能：SC_CODE_HOME 设为新建一次性目录，再 npm run perf:baseline -- --exe .runtime/target/debug/ScCode.exe --seconds 30 --out .runtime/logs；完成后仅清理该测试目录，不使用真实 profile。
- 证据在忽略的 .runtime/logs/all-* 与 perf-*.json；不入库、不作为发行包。

## 不变边界
- 本轮仅为用户授权的 0.4.1 commit/push/打包/预发布；无新的明确要求时不再发布其他版本；.runtime/、dist/、node_modules/、Tauri 生成物与用户状态不入库。新 helper/tests/scripts 是源码，不能漏掉。
- 不访问真实 profile、keyring、私钥、回收站，不调用付费模型；SC_CODE_HOME 同时隔离应用数据/日志/各窗口 WebView2。
- renderer fetch/proxy 每跳 URL/DNS 公网检查并钉住解析结果，直连且不使用环境/系统代理；Agent/provider 的独立网络栈未改，不能泛化为全应用防 SSRF。
- core/platform/editor 不盲拆 chunk（TDZ 黑屏风险）；数据库升级失败保留原库，不自动改名建空库。长期能力规划见 ROADMAP，不借审查擅自移除 Agent 或扩展功能。
