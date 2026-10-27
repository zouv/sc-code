# 会话接力 · ScCode

- 快照：2026-10-27；分支 `main`；**无进行中任务**（迁移期残留清理、扩展通知改右下角 toast、关窗丢弃 untitled 备份、图标样式更新均已完成，见 `CHANGELOG.md` 未发布区）。
- 本轮验证：`npm test`（74/74，含扩展消息路由新用例）、`npm run typecheck`、`cargo check --offline -p sc-code`、`sh check-docs.sh` 全部通过。
- 当前版本：**0.3.0**（已打包并发布为 GitHub prerelease）。
- 最新发布：[v0.3.0](https://github.com/zouv/sc-code/releases/tag/v0.3.0)（GitHub prerelease）：
  - `ScCode_0.3.0_x64-setup.exe`（68,791,143 B）
  - `ScCode_0.3.0_x64-unpack.zip`（94,574,333 B）
- 本轮发布冒烟（Release 包解压 + 隔离 `SC_CODE_HOME`）：搜索命中、终端可启动、Markdown 预览 webview 来自 `http://127.0.0.1:<端口>` 且 `window.parent` 被拒、webview 内 `stat` 被 IPC 守卫拒、`ScCode.exe -g <文件>:1:3` 定位到 `Ln 1, Col 3`、profile 落在 `SC_CODE_HOME` 内。
- 打包：`npm run desktop:package` exit 0；`dist/dev/ScCode_0.3.0_x64-unpack-debug.zip`（含 PDB）、`dist/release/unpack/`、setup exe、unpack zip 均生成。
- 最新发布：[v0.2.0](https://github.com/zouv/sc-code/releases/tag/v0.2.0)（GitHub prerelease）：
  - `ScCode_0.2.0_x64-setup.exe`（68,699,528 B）
  - `ScCode_0.2.0_x64-unpack.zip`（94,455,573 B）
- 仓库边界不变：源码/文档/脚本/锁文件入库；`.runtime/`、`dist/`、`node_modules/`、Tauri 生成物、用户 profile 不入库。

## 下一步（未排期）

1. **打包冒烟**：`npm run desktop:package` 后按 `scripts/smoke-dist.cjs` 与隔离 profile 验证 Release 包内的 webview 隔离、搜索、终端、关窗询问、CLI `-g`（本轮只在 dev 构建里验证过）。
2. 真实宿主（S10b）：扩展贡献命令在真实宿主下 MISSING（typescript/emmet/json 等），旧宿主同样缺；需先修扩展注册/激活链路，再验自定义编辑器与 Node 调试适配器。
3. 剩余体验缺口：Explorer 的 Outline 视图面板（`contrib/outline` 未移植，面包屑已可用）、`--wait`（git `core.editor`）、`IWorkingCopyService.modifiedWorkingCopies` 在本移植中为空（关窗判断改用编辑器脏状态绕开）。
4. 手工验收 S16 桌面壳体验：关于对话框图标；Windows 任务栏右键“Recent Folders / Recent Workspaces”；运行中点击跳转列表应转发到已运行实例并新开窗口；冷启动点击应直接以目标文件夹/工作区启动。
5. 真实宿主全量验收（S10b）：VAC、Claude Code、VSIX 安装、树视图、webview、对话框、配置读取。
6. 真实宿主 `MainThread*` 覆盖补齐：comments/timeline/browserView/externalUriOpener 尚未移植。
7. 多窗口宿主隔离：`real_ext_host_start` 目前是应用级单进程。
8. ESM 扩展热重载不完整；宿主随窗口 reload 重建后需验证。

## 最近验证（2026-10-22）

- 发布：`v0.2.0` 已创建 tag，GitHub Release 为 prerelease；安装包与 unpack zip 两个资产均已上传。
- 打包：`npm run desktop:package` exit 0；Debug zip 与 Release setup/unpack zip 均生成。
- 冒烟：Release unpack 解压到隔离目录，`SC_CODE_HOME` 隔离启动 25 秒正常，profile 生成 SQLite 数据。
- 通过：`npm test`（77/77）、`npm run typecheck`、`sh check-docs.sh`。
- 通过：D 版图标的 PNG 尺寸、七帧 ICO、ICNS 头与 RGBA 透明圆角检查；Release `ScCode.exe` ProductVersion/FileVersion 为 `0.2.0`。
- 通过：`cargo check --offline -p sc-code --bin ScCode`。
- 已清理仓库正文本机路径：README 示例路径；README 截图位于 `docs/images/preview.jpg`。
- Git 历史已重写：10 个历史提交的作者/提交者统一为 `zouv <zouv@163.com>`，9 处 `Co-Authored-By` 已移除；`origin/main` 与 `v0.1.1`/`v0.1.2` 标签已 force-push，本地 `user.name/user.email` 同步更新。
- 已复查工作树与全部 Git 引用：无真实姓名、邮箱、本机路径、设备标识残留；`AGENTS.md` 新增 §3.1「个人信息与仓库卫生」铁律与提交前自检流程。

## 前次验证（2026-10-21）

- 通过：`npm run typecheck`。
- 通过：`npm test`（77/77）。
- 通过：`cargo check --offline -p sc-code --bin ScCode`。
- 通过：`cargo test --offline -p sc-code --lib taskbar`（4/4：参数解析、URI 校验、去重/标签、app URL）。
- 通过：`cargo clippy --offline -p sc-code --lib` 对 `taskbar.rs` 无告警。
- 实跑：隔离 `SC_CODE_HOME` 启动 Debug 桌面应用；截图确认标题栏应用图标位于最左侧（菜单之前）。关于对话框与任务栏跳转列表尚需按“下一步 1”做手工验收。
- 注意：此前 Tauri 丢弃窗口配置的 `dataDirectory`，所有 profile 共用默认 `%LOCALAPPDATA%\dev.sccode.app\EBWebView`；S18 起设置 `SC_CODE_HOME` 时 WebView 数据在该目录内。新单实例锁按 profile 数据目录隔离。

## 打包与发布

- 本地打包：`npm run desktop:package`（或 `package.bat`）。
- 2026-10-20 0.1.2 产物：
  - `dist/dev/unpack/`（Debug 未压缩目录，含 PDB）
  - `dist/dev/ScCode_0.1.2_x64-unpack-debug.zip`（245,484,507 B）
  - `dist/release/unpack/`（Release 未压缩运行目录）
  - `dist/release/ScCode_0.1.2_x64-setup.exe`（68,692,521 B）
  - `dist/release/ScCode_0.1.2_x64-unpack.zip`（94,430,194 B，828 项，根目录无版本外壳）
- 打包中曾遇到 Windows 目录重命名瞬时 `EPERM`（Debug unpack 导出），清理旧产物后重试成功；如复现先关闭占用 `dist/<channel>/unpack/` 的进程再重试。
- 发布 skill：`.claude/skills/sc-code-publish`；打包 skill：`.claude/skills/sc-code-release`。

## 运行/验证

```powershell
npm run setup
npm run runtime:prepare        # 内含 ext-host:build
npm test
npm run typecheck
npm run desktop:package
# 解压 dist/release/ScCode_<version>_x64-unpack.zip 到任意目录（zip 内无版本子目录）后：
$env:SC_CODE_HOME='D:\Temp\sc-code-smoke'
.\ScCode.exe
```

## 实现边界

- 真实宿主 bundle 输出在 `.runtime/ext-host/extensionHost.cjs`；prepare 时复制到运行资源 `extension-host/extensionHost.cjs`。
- 工作台存储首次启动从 IndexedDB 复制到 SQLite，空库才迁移。
- 旧 `host.cjs` 保留作为默认回退；不要在真实宿主验证完成前删除。
- 打包约束：base/platform/editor 不得拆成不同 chunk（TDZ 黑屏）；见 ARCHITECTURE §3.6。
- unpack 默认用户数据仍是 `%APPDATA%\ScCode`（或 `SC_CODE_HOME`），不是目录内 portable 模式。
- Windows 任务栏跳转列表与单实例代码在 `src-tauri/src/taskbar.rs`；Win32/COM 的 `unsafe` 仅限该文件的 `windows_impl` / `windows_single_instance`，不要扩散到业务命令。
