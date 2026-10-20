# 会话接力 · ScCode

- 快照：2026-10-20；分支 `main`；**无进行中任务**。
- 最新发布：[v0.1.2](https://github.com/zouv/sc-code/releases/tag/v0.1.2)（GitHub prerelease）：
  - `ScCode_0.1.2_x64-setup.exe`（68,692,521 B）
  - `ScCode_0.1.2_x64-unpack.zip`（94,430,194 B）
- 仓库边界不变：源码/文档/脚本/锁文件入库；`.runtime/`、`dist/`、`node_modules/`、Tauri 生成物、用户 profile 不入库。上游来源仓库只读。

## 下一步（未排期）

1. 真实宿主全量验收（S10b）：VAC、Claude Code、VSIX 安装、树视图、webview、对话框、配置读取。
2. 真实宿主 `MainThread*` 覆盖补齐：comments/timeline/browserView/externalUriOpener 尚未移植。
3. 多窗口宿主隔离：`real_ext_host_start` 目前是应用级单进程。
4. ESM 扩展热重载不完整；宿主随窗口 reload 重建后需验证。

## 最近验证（2026-10-20）

- 通过：`npm run typecheck`。
- 通过：`npm test`（74/74）。
- 通过：`npm run desktop:package`（exit 0）：Debug + Release 均构建成功。
- 通过：Release unpack 冒烟——解压 `dist/release/ScCode_0.1.2_x64-unpack.zip` 后用隔离 `SC_CODE_HOME` 启动 `ScCode.exe`，运行 25s 正常关闭，profile 生成 SQLite 与会话数据。
- 通过：zip 关键条目——`ScCode.exe`、`unpack-manifest.json`；Debug zip 含 `ScCode.pdb`。
- 已知既有失败（与本次改动无关）：`cargo test -p sc-code-db` 的 `window_state`/`chat_sessions` 用例因 v4 schema 缺列失败；`sc-code-lsp`/`sc-code-syntax`/`sc-code-remote` 测试目标存在既存编译缺口。

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
