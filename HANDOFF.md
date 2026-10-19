# 会话接力 · ScCode

- 快照：2026-10-20；分支 `main`；**无进行中任务**。
- 最新发布：[v0.1.1](https://github.com/zouv/sc-code/releases/tag/v0.1.1)（GitHub prerelease）：`ScCode_0.1.1_x64-setup.exe` + `ScCode_0.1.1_x64-unpack.zip`。
- 2026-10-20 已在本地用 `release.bat` 重新构建 0.1.1 成品（含去品牌化改动）；尚未重新上传 Release。
- 仓库边界不变：源码/文档/脚本/锁文件入库；`.runtime/`、`packages/`、`node_modules/`、Tauri 生成物、用户 profile 不入库。上游来源仓库只读。

## 本次已完成（2026-10-19 ~ 2026-10-20）

- 全量去旧品牌：文件/目录/类/服务/CSS token/持久化键/命令与设置 ID/协议统一为 ScCode 命名。
- 移除旧项目兼容层：环境变量 alias、WASM 清单旧文件名、配置与数据目录回退、keyring 旧服务名、首次数据导入与旧 profile 探测。
- 文档四件套与 `docs/import-manifest.json` 同步更新，仓库内不再有旧品牌文本或路径。
- Go Agent 已用 `.runtime/tools` 内置 Go 1.26 + llvm-mingw 编译通过；`release.bat` 全量构建成功。

## 下一步（未排期）

1. **发布前版本决策**：当前源码包含 `[未发布]` 变更，但版本仍是已发布的 `0.1.1`。若重新上传，应先决定是否升到新版本（如 `0.1.2`）并同步所有版本落点，避免覆盖既有 v0.1.1 资产。
2. 真实宿主全量验收（S10b）：VAC、Claude Code、VSIX 安装、树视图、webview、对话框、配置读取。
3. 真实宿主 `MainThread*` 覆盖补齐：comments/timeline/browserView/externalUriOpener 尚未移植。
4. 多窗口宿主隔离：`real_ext_host_start` 目前是应用级单进程。
5. ESM 扩展热重载不完整；宿主随窗口 reload 重建后需验证。

## 最近验证（2026-10-20）

- 通过：`npm run typecheck`。
- 通过：`npm run build`（生产前端打包，含 93 个扩展描述符）。
- 通过：`npm test`（74/74）。
- 通过：`npm run verify:import`（3664 项，0 errors）。
- 通过：`cargo check --workspace`；`cargo test -p sc-code --lib`（72 项）。
- 通过：`cargo test -p sc-code-runtime -p sc-code-auth -p sc-code-workspace -p sc-code-settings -p sc-code-extensions -p sc-code-agent`（374 项）。
- 通过：`cd agent/cli && cargo check`。
- 通过：Go Agent 发布参数编译（`CGO_ENABLED=1`、`-tags fts5`、llvm-mingw gcc）。
- 通过：`release.bat`（exit 0）：Rust Release 编译 7m08s，NSIS 安装包、unpack 目录与 zip 均生成。
- 通过：Release unpack 冒烟——隔离 profile 启动 `ScCode.exe`，运行 20s 后正常关闭。
- 未执行：Go `go test -tags fts5 ./...`（仅验证了 build）。
- 已知既有失败（与本次改动无关）：`cargo test -p sc-code-db` 的 `window_state`/`chat_sessions` 用例因 v4 schema 缺列失败；`sc-code-lsp`/`sc-code-syntax`/`sc-code-remote` 测试目标存在既存编译缺口。

## 打包与发布

- 本地打包：`npm run desktop:release`（或 `release.bat`）。
- 2026-10-20 构建产物（`packages/release/`）：
  - `unpack/`（243 MB，未压缩运行目录）
  - `ScCode_0.1.1_x64-setup.exe`（66 MB，2026-10-20 新生成）
  - `ScCode_0.1.1_x64-unpack.zip`（91 MB，829 项，根目录无版本外壳）
  - 目录内另有旧的 `ScCode_0.1.0_x64-setup.exe`（历史产物，未删除）。
- zip 关键条目已验证：`ScCode.exe`、`sc-code-agent.exe`、`bin/node.exe`、`extension-host/extensionHost.cjs`、`runtime-manifest.json`、`unpack-manifest.json`；无 PDB、Cargo 缓存或用户 profile。
- Debug 通道未在本次构建；产物结构与顺序见 `.claude/skills/sc-code-release/SKILL.md`。
- 发布 skill：`.claude/skills/sc-code-publish`。

## 运行/验证

```powershell
npm run setup
npm run runtime:prepare        # 内含 ext-host:build
npm test
npm run typecheck
npm run desktop:release
# 解压 packages/release/ScCode_<version>_x64-unpack.zip 到任意目录（zip 内无版本子目录）后：
$env:SC_CODE_HOME='D:\Temp\sc-code-smoke'
.\ScCode.exe
```

## 实现边界

- 真实宿主 bundle 输出在 `.runtime/ext-host/extensionHost.cjs`；prepare 时复制到运行资源 `extension-host/extensionHost.cjs`。
- 工作台存储首次启动从 IndexedDB 复制到 SQLite，空库才迁移。
- 旧 `host.cjs` 保留作为默认回退；不要在真实宿主验证完成前删除。
- 打包约束：base/platform/editor 不得拆成不同 chunk（TDZ 黑屏）；见 ARCHITECTURE §3.6。
- unpack 默认用户数据仍是 `%APPDATA%\ScCode`（或 `SC_CODE_HOME`），不是目录内 portable 模式。
