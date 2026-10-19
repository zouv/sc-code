# 会话接力 · ScCode

- 快照：2026-10-19；分支 `feature/runtime-rebase`（未提交、未推送）。本轮在 `custom-sidex` 的评估基础上，对 ScCode 做底层调整：真实 Node 扩展宿主、存储迁移、懒启动/依赖清理、性能基线。
- 仓库边界不变：源码/文档/脚本/锁文件入库；`.runtime/`、`packages/`、`node_modules/`、Tauri 生成物、用户 profile 不入库。来源 `custom-sidex/sc-browser` 只读。

## 本轮已完成（自动化验证通过）

- `npm run typecheck`、`npm test`（74/74）、`npm run test:ext-host`、`npm run verify:import`（3704 项 0 错误）、`npm run build`（分包产物 12.17MB JS）、`npm run smoke:dist`、`cargo check -p sc-code`、`sh check-docs.sh` 均通过。
- 真实宿主 bundle 可独立启动并完成 PersistentProtocol 握手（`tests/ext-host-smoke.cjs`）。
- 真实宿主 GUI 实测（隔离 profile `D:/Temp/sc-code-realhost-test`，`SC_CODE_REAL_EXT_HOST=1`）：
  - 日志出现 `[extHost] real extension host initialized`；
  - 宿主加载 63 个扩展（93 个内置 + 1 个合成用户扩展中的 Node 部分）；
  - 合成扩展 `sc-code-test.hello` 已在首扫描前注册。
- 存储已切到 profile SQLite；Go server 与 WASM 运行时改为懒启动/懒初始化；`jsonwebtoken` 移除后 `aws-lc-sys`/NASM 不再进入依赖图。

## 最新修复：Release 黑屏（2026-10-19）

- 现象：新 Release 包启动后黑屏。CDP 抓到 `ReferenceError: Cannot access 'ua' before initialization`（`assets/monaco-*.js`）。
- 根因：上一轮把 `base/platform/editor` 拆成独立 chunk，VSCode 三层存在运行时循环（platform ↔ editor），生产包出现 TDZ。
- 修复：`vite.config.ts` 只拆 `terminal/xterm`，其余回到单一 `core`（由 `nls` 优先加载）；新增 `npm run smoke:dist`（Vite preview + Playwright headless，断言 `didStartWorkbench`），CI 增加 Playwright chromium 安装与该冒烟。
- 验证：`npm run build` 后 `smoke:dist` 通过；`npm run desktop:release` 重建的 `packages/unpack/release/ScCode.exe` 在隔离 profile 下启动，工作台渲染、`didStartWorkbench`/`Restored`/`didLoadExtensions` 均出现；新安装包 `packages/release/ScCode_0.1.0_x64-setup.exe`（10:25）。
- 注意：不要把 base/platform/editor 再拆成不同 chunk；详见 ARCHITECTURE §3.6 末尾约束。

## 真实宿主当前已知问题（下一步）

1. 宿主 `MainThread*` 覆盖仍不完整：comments/timeline/browserView/externalUriOpener 相关 contribution 未移植，已从 `mainThread` 客户列表移除；使用这些 API 的扩展会得到“不可用”而非崩溃，但需逐个确认。
2. 内置扩展 63 个在真实宿主内激活，需核对哪些应保留（`vscode.*` Node 扩展可能拉起语言服务/进程）；下一步做扩展白名单/矩阵。
3. 真实宿主仍是实验开关（默认关闭）。需要在 `SC_CODE_REAL_EXT_HOST=1` 下回归 VAC、Claude Code、VSIX 安装、树视图、webview、对话框、配置读取。
4. 多窗口仍未建模：`real_ext_host_start` 是应用级单进程；后续按窗口或按窗口组切分。
5. ~~`sidex-server` 仍会被聊天服务在启动时触发~~（已修）：聊天服务不再在构造时 `_fetchServerInfo`/定时连；补全 provider 改为首次请求时 resolve endpoint。实测启动后 2 分钟无 `sidex-server` 进程，打开聊天/触发补全时才启动。
6. ESM 扩展热重载仍不完整；真实宿主随窗口 reload 重建后需验证。

## 运行/验证

```powershell
npm run setup
npm run runtime:prepare        # 内含 ext-host:build
$env:SC_CODE_HOME='D:\Temp\sc-code-realhost-test'
$env:SC_CODE_REAL_EXT_HOST='1'
npm run desktop:dev
# 无 GUI 时：
npm run ext-host:build; npm run test:ext-host
npm run perf:baseline
```

## 数据与兼容边界

- 真实宿主 bundle 输出在 `.runtime/ext-host/extensionHost.cjs`；prepare 时复制到运行资源 `extension-host/extensionHost.cjs`，ripgrep 平台包复制到 `extension-host/node_modules/@vscode/ripgrep-win32-x64`。
- 工作台存储首次启动从 IndexedDB 复制到 SQLite（`app/`、`profile/<id>/`、`workspace/<id>/` 前缀），空库才迁移。
- 旧 `host.cjs` 保留作为默认回退；不要在真实宿主验证完成前删除。
