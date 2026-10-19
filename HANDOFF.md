# 会话接力 · ScCode

- 快照：2026-10-19；分支 `main`（工作区有未提交改动）。
- 仓库边界不变：源码/文档/脚本/锁文件入库；`.runtime/`、`packages/`、`node_modules/`、Tauri 生成物、用户 profile 不入库。来源 `custom-sidex/sc-browser` 只读。

## 当前任务：v0.1.1 发布

**目标**：版本升至 0.1.1，打包并发布到 GitHub Release；发布资产必须包含 NSIS 安装包与 unpack zip。

**完成定义**：
1. 版本号落点全部为 0.1.1（package.json / package-lock / tauri.conf version+WiX / src-tauri/Cargo.toml / src/main.ts 回退值）。
2. `scripts/build-desktop.cjs` 打包成功后生成 `packages/release/ScCode_0.1.1_x64-unpack.zip`（含单一根目录、`ScCode.exe`、`unpack-manifest.json`）。
3. 新增 `sc-code-release` / `sc-code-publish` 两个项目 skill。
4. `npm test` 通过；Release 构建成功；GitHub Release 同时包含 setup exe 与 unpack zip。

## 已完成（本轮）

- 版本号已同步到上述文件（`Cargo.lock` 的 `sc-code` 包版本同步）。
- 新增 `scripts/zip-writer.cjs`（纯 Node ZIP，无系统 zip/tar 依赖）；`unpack-output.cjs / archiveUnpack` 由 `build-desktop.cjs` 在 publishUnpack 后调用。
- 新增测试：`tests/unpack-output.test.cjs` 验证 zip 路径/签名/根目录/关键条目；`tests/package-output.test.cjs` 验证 buildDesktop 生成 zip。目标测试 18/18 通过。
- 新增 `.claude/skills/sc-code-release/SKILL.md`、`.claude/skills/sc-code-publish/SKILL.md`；AGENTS.md 已登记。
- README / ARCHITECTURE / CHANGELOG / daily help 已更新；发布说明 `docs/releases/v0.1.1.md` 已创建。

## 下一步

1. 运行 `npm test` 与 `npm run typecheck`（全量）。
2. 检查 diff 后提交并推送 `main`。
3. `npm run desktop:release` 构建 Release（Windows x64）；确认 `packages/release` 下 setup exe 与 unpack zip 均存在。
4. 冒烟：隔离 `SC_CODE_HOME` 启动 `packages/unpack/release/ScCode.exe`（GUI 不可用则如实说明）。
5. `git tag v0.1.1` + push；`gh release create v0.1.1 --repo zouv/sc-code --prerelease` 上传两个资产并核验。
6. 收尾：更新 ROADMAP/HANDOFF/CHANGELOG 状态。

## 真实宿主已知问题（与本次发布无关，继续保留）

1. `MainThread*` 覆盖不完整：comments/timeline/browserView/externalUriOpener 未移植；使用这些 API 的扩展会得到“不可用”。
2. 内置扩展 63 个在真实宿主内激活，需做保留矩阵/白名单。
3. 真实宿主仍是实验开关（默认关闭）；VAC/Claude Code/VSIX/树视图/webview/对话框等需回归。
4. 多窗口未建模：`real_ext_host_start` 是应用级单进程。
5. ESM 扩展热重载不完整。

## 运行/验证

```powershell
npm run setup
npm run runtime:prepare        # 内含 ext-host:build
npm test
npm run typecheck
npm run desktop:release
$env:SC_CODE_HOME='D:\Temp\sc-code-smoke'
.\packages\unpack\release\ScCode.exe
```

## 数据与兼容边界

- 真实宿主 bundle 输出在 `.runtime/ext-host/extensionHost.cjs`；prepare 时复制到运行资源 `extension-host/extensionHost.cjs`。
- 工作台存储首次启动从 IndexedDB 复制到 SQLite，空库才迁移。
- 旧 `host.cjs` 保留作为默认回退；不要在真实宿主验证完成前删除。
- 打包约束：base/platform/editor 不得拆成不同 chunk（TDZ 黑屏）；见 ARCHITECTURE §3.6。
