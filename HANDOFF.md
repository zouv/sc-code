# 会话接力 · ScCode

- 快照：2026-10-22；分支 `main`；**无进行中任务**。
- 本地版本：**0.2.0**（尚未打包/发布）。
- 最新发布：[v0.1.2](https://github.com/zouv/sc-code/releases/tag/v0.1.2)（GitHub prerelease）：
  - `ScCode_0.1.2_x64-setup.exe`（68,692,521 B）
  - `ScCode_0.1.2_x64-unpack.zip`（94,430,194 B）
- 仓库边界不变：源码/文档/脚本/锁文件入库；`.runtime/`、`dist/`、`node_modules/`、Tauri 生成物、用户 profile 不入库。上游来源仓库只读。

## 下一步（未排期）

1. 0.2.0 打包与发布：运行 `npm run desktop:package`，按需上传 GitHub Release；当前只有版本号与源码改动，未生成 0.2.0 成品。
2. 手工验收 S16 桌面壳体验：关于对话框图标；Windows 任务栏右键“Recent Folders / Recent Workspaces”；运行中点击跳转列表应转发到已运行实例并新开窗口；冷启动点击应直接以目标文件夹/工作区启动。
3. 真实宿主全量验收（S10b）：VAC、Claude Code、VSIX 安装、树视图、webview、对话框、配置读取。
4. 真实宿主 `MainThread*` 覆盖补齐：comments/timeline/browserView/externalUriOpener 尚未移植。
5. 多窗口宿主隔离：`real_ext_host_start` 目前是应用级单进程。
6. ESM 扩展热重载不完整；宿主随窗口 reload 重建后需验证。
7. 其他协作者/克隆需重新拉取或 `git reset --hard origin/main`；旧历史 SHA 已失效。

## 最近验证（2026-10-22）

- 通过：D 版图标已接入 `public/sc-code.svg` 与 `src-tauri/icons/`；PNG 尺寸、七帧 ICO、ICNS 头与 RGBA 透明圆角检查通过。
- 通过：`npm test`（77/77）、`npm run typecheck`、`node scripts/verify-import.cjs`（0 errors）、`sh check-docs.sh`。
- 通过：`cargo check --offline -p sc-code --bin ScCode`（0.2.0 已写入根 Cargo.lock）。
- 通过：README 截图迁移至 `docs/images/preview.jpg`，来源清单目标路径/哈希同步。
- 已清理仓库正文本机路径：README 示例路径、`vendor-ext-host-node.cjs` 默认作者本机路径。
- Git 历史已重写：10 个提交的作者/提交者统一为 `zouv <zouv@163.com>`，9 处 `Co-Authored-By` 已移除；`origin/main` 与 `v0.1.1`/`v0.1.2` 标签已 force-push，本地 `user.name/user.email` 同步更新。
- 已同步版本号 0.2.0：`package.json`、`package-lock.json`、`src-tauri/Cargo.toml`、`src-tauri/tauri.conf.json`/WiX、根 `Cargo.lock`、About 回退值、README/ARCHITECTURE。
- `src-tauri/Cargo.lock` 是导入来源锁文件，不参与当前 workspace 构建，仍保留原始导入版本 0.1.2。

## 前次验证（2026-10-21）

- 通过：`npm run typecheck`。
- 通过：`npm test`（77/77）。
- 通过：`cargo check --offline -p sc-code --bin ScCode`。
- 通过：`cargo test --offline -p sc-code --lib taskbar`（4/4：参数解析、URI 校验、去重/标签、app URL）。
- 通过：`cargo clippy --offline -p sc-code --lib` 对 `taskbar.rs` 无告警。
- 实跑：隔离 `SC_CODE_HOME` 启动 Debug 桌面应用；截图确认标题栏应用图标位于最左侧（菜单之前）。关于对话框与任务栏跳转列表尚需按“下一步 1”做手工验收。
- 注意：默认 profile 下同时运行旧 release 与 dev 会争用 `EBWebView` 数据目录；GUI 冒烟请使用独立 `SC_CODE_HOME`。新单实例锁按 profile 数据目录隔离。

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
