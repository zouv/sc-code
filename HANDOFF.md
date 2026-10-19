# 会话接力 · ScCode

- 快照：2026-10-19；分支 `main`；**无进行中任务**。
- 最新发布：[v0.1.1](https://github.com/zouv/sc-code/releases/tag/v0.1.1)（GitHub prerelease）：`ScCode_0.1.1_x64-setup.exe` + `ScCode_0.1.1_x64-unpack.zip`。
- 仓库边界不变：源码/文档/脚本/锁文件入库；`.runtime/`、`packages/`、`node_modules/`、Tauri 生成物、用户 profile 不入库。来源 `custom-sidex/sc-browser` 只读。

## 下一步（未排期）

1. 真实宿主全量验收（S10b）：VAC、Claude Code、VSIX 安装、树视图、webview、对话框、配置读取。
2. 真实宿主 `MainThread*` 覆盖补齐：comments/timeline/browserView/externalUriOpener 尚未移植；使用这些 API 的扩展会得到“不可用”。
3. 内置扩展保留矩阵：真实宿主内会激活约 63 个扩展，需要白名单/矩阵确认。
4. 多窗口宿主隔离：`real_ext_host_start` 目前是应用级单进程。
5. ESM 扩展热重载不完整；宿主随窗口 reload 重建后需验证。

## 打包与发布

- 本地打包：`npm run desktop:release`（或 `release.bat`）。
- 产物：
  - `packages/dev/ScCode_<version>_x64-unpack-debug.zip`（Debug，含 PDB）
  - `packages/release/ScCode_<version>_x64-setup.exe`
  - `packages/release/ScCode_<version>_x64-unpack.zip`
- 不再生成 `packages/unpack` 目录；zip 校验通过后暂存目录会被删除。
- 发布 skill：`.claude/skills/sc-code-release`、`.claude/skills/sc-code-publish`。

## 运行/验证

```powershell
npm run setup
npm run runtime:prepare        # 内含 ext-host:build
npm test
npm run typecheck
npm run desktop:release
# 解压 packages/release/ScCode_<version>_x64-unpack.zip 后：
$env:SC_CODE_HOME='D:\Temp\sc-code-smoke'
.\ScCode_<version>_x64-unpack\ScCode.exe
```

## 数据与兼容边界

- 真实宿主 bundle 输出在 `.runtime/ext-host/extensionHost.cjs`；prepare 时复制到运行资源 `extension-host/extensionHost.cjs`。
- 工作台存储首次启动从 IndexedDB 复制到 SQLite，空库才迁移。
- 旧 `host.cjs` 保留作为默认回退；不要在真实宿主验证完成前删除。
- 打包约束：base/platform/editor 不得拆成不同 chunk（TDZ 黑屏）；见 ARCHITECTURE §3.6。
- unpack 默认用户数据仍是 `%APPDATA%\ScCode`（或 `SC_CODE_HOME`），不是目录内 portable 模式。
