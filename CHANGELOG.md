# 变更记录 · ScCode

## [未发布]
- 新增 setup/run/dev/build/release/test/verify/clean 日常 BAT，前台运行、保留退出码，支持 --help/--dry-run；清理不强杀应用，不删除用户配置。
- 本地 runtime、打包输出、前端生成物、元数据和日志统一放 .runtime 并忽略；终端集成仅保留规范源，7 项重复来源仍保留完整清单校验。
- 默认用户数据目录改为 ScCode，优先只复制旧 Sc-Code；继承迁移来源历史，稳定扩展凭据身份，保留旧目录及 keyring 服务 ID。
- 内置 Agent 每次启动收起侧栏，不恢复旧展开状态；仍可手动打开，本轮未移除 Agent/Go 后台服务。

### 变更
- 桌面打包同步生成 packages/unpack/dev 与 packages/unpack/release：可双击 ScCode.exe 的完整免安装目录，附内置运行资源、许可证与 SHA256 清单；按已构建资源校验后暂存替换，拒绝缺资源/路径链接/额外用户文件，clean 保留。仍需系统 WebView2，默认数据目录保持 %APPDATA%\ScCode。
- 打包成功后将本次 NSIS/MSI 安装包导出至根目录 packages/dev（Debug）或 packages/release（Release）；成品不入库，clean 保留，失败/仅编译不导出历史包。
- ScCode 图标调整为紫灰底与淡紫色 C/光标，保留 SC 字形、编辑器窗口和代码括号；同步 SVG、PNG、ICO、ICNS，与 ScBrowser 的深蓝/青色配色区分。

### 新增
- 以 SC 字母、编辑器窗口与代码括号为元素的无字体 SVG；接入网页 favicon/标题栏和 PNG/ICO/ICNS 平台图标。
- 使用 vibe-coding-starter 初始化；完整导入 custom-sidex 的 3704 项跟踪文件并保存来源校验清单。
- 独立 ScCode 身份、数据目录和 0.1.0 产品版本；保留 VS Code 1.110.0 API 与原命令/设置兼容标识。
- VSIX/工作区拖拽、accessibility 服务和 profile 扩展同步变成普通功能模块。
- 固定版本、SHA256 校验的 Node、94 个内置扩展和原生 Go agent 准备链路；Windows debug NSIS 验收包。
- 只复制、不覆盖、不删除旧数据的首次导入，SQLite Backup 一致快照和可重试迁移记录。
- 扩展 globalState/workspaceState 改为 profile 内持久 Memento；多根/工作区文件身份隔离，状态支持重启恢复和并发合并。
- 扩展 secrets 接入原生 OS keyring 请求桥；按 profile/扩展/key 命名，失败明确报错，不明文降级。

### 修复
- 应用显示品牌、原生窗口/菜单、扩展 env 和终端标识统一为 ScCode，exe名同步；既有 Sc-Code profile 保留为只复制迁移源；旧协议/命令/主题ID保持兼容。
- 首次数据导入提示中文说明目标、安全条件、确定/取消行为；来源按 canonical identity 去重，避免 Windows Roaming 同一路径重复显示。
- 聊天离线发送、重连、取消与超时的生命周期；侧车重启后失效旧端口/凭据。
- 原子文件写、UTF-8 校验和索引工作区切换；回滚检查并发变更。
- Windows 工作区目录非法字符、构建 PATH 大小写冲突、后台命令和临时路径跨平台测试。
- 数据库打开失败不再删除原数据库重建；遗留 MEMORY.md 导入保留来源。
- 配置保存失败不再假成功；JSONC 保留、并发更新序列化、完整扩展键合并及删除文件后刷新。
- 取消原生、Node宿主和服务三处静默硬编码扩展黑名单；显式禁用策略统一覆盖直接加载/激活，不承诺专有 API/服务兼容。
- 扩展不再写安装目录：状态/日志与 ESM shim 进入可写 profile；旧 .global-storage/.storage 文件只复制缺失项，来源保留。
- 修正 extensionMode 为 Production，移除激活时强制清空 Python 状态；工作区切换重新建立 context，避免旧状态混用。
- CJS 扩展更新刷新 package.json/main，撤销旧命令/订阅并加载新入口；ESM 支持顶层 await 和中文/空格路径。
- 自动化补验真实生产宿主的配置/TreeView、状态重启、多根切换、对话框 Uri 回包与取消、CJS 更新与 ESM 初次加载。

### 安全
- Go/Node 本地接口使用随机会话 token、loopback/Host/Origin 校验；普通 REST 不接受 URL token。
- WebView/原生/扩展/agent 统一到独立 profile；隔离测试不读真实浏览器数据；秘密索引开启 secure_delete，旧历史页仍需单独处理。
- 缩小资源授权范围；密钥禁止明文降级；旧凭据复制至新 keyring，不删除旧 keyring。
- 默认禁用旧更新渠道和遥测；新渠道只能显式配置，遥测需显式 opt-in。

### 已知边界
- 扩展Rust回归仍有Windows shell超时清理、终端Unix路径用例及remote测试依赖API缺口；桌面构建成功，不代表所有模块测试通过。
- 未签名、未发布；真实旧数据迁移、完整 custom GUI 行为和第三方扩展矩阵未验收。Windows GUI 截图/输入接口拒绝访问，合成迁移停在确认前，未操作真实旧 profile。
- 真 OS keyring 桌面读写尚未验收；secret namespace 不等于扩展授权或原生代码沙箱，change通知仅当前context。
- 旧内存 Memento/secrets 未落盘值不可恢复；Memento崩溃残留锁需要恢复设计，缓存不跨窗口实时刷新，setKeysForSync未实现云同步，ESM未实现真正热重载。
- CSP/trust、持久 checkpoint、跨文件事务、共享 LSP/index 和旧秘密页残留仍需后续完善；已有 Rust warnings 尚未全部整治。
