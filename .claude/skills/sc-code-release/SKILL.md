---
name: sc-code-release
description: 构建 ScCode 的 Windows x64 成品（版本号同步、预检、Debug unpack zip / Release setup + unpack zip、冒烟与文档收尾）。仅当用户明确要求「打包 / 构建安装包 / 出 Release 包 / release build」时调用。
---

# ScCode 打包 Skill

把 ScCode 源码构建为**本地可发布的 Windows x64 成品**。发布到 GitHub 请继续走 `sc-code-publish`。

## 与 sc-code-publish 的分工

| Skill | 职责 | 起点 → 终点 |
|---|---|---|
| **`sc-code-release`（本）** | 源码 → 本地成品 | 干净工作区 → `packages/release/` |
| `sc-code-publish` | 本地成品 → GitHub Release | 版本号 + notes + 产物 → Release 上线 |

本仓库没有自动发布流水线；Release = 本地打包 + 手动上传。**上传前必须确认 unpack zip 已生成**。

## 触发条件

- 用户说「打包」「打个 Release 包」「生成安装包」「出包」「release build」
- 发布前需要本地成品

## 参数与前置检查

1. **版本号**：默认读 `package.json` 的 `version`；用户指定则先同步版本号。
2. **平台**：当前只支持准备好的 Windows x64（`x86_64-pc-windows-msvc`），不要承诺跨平台产物。
3. 前置检查：

```bash
git branch --show-current       # 通常为 main
git status --porcelain          # 建议干净；发布前所有改动先提交
node -p "require('./package.json').version"
npm run desktop:release -- --dry-run   # 只打印路径，不构建
```

## 版本号落点（必须一致）

| 文件 | 字段 | 说明 |
|---|---|---|
| `package.json` | `version` | npm 侧版本 |
| `package-lock.json` | 顶层与 `packages[""]` 的 `version` | 与 package.json 同步 |
| `src-tauri/tauri.conf.json` | `version` | Tauri 打包读取的版本 |
| `src-tauri/tauri.conf.json` | `bundle.windows.wix.version` | 纯数字四段，如 `0.1.1.0` |
| `src-tauri/Cargo.toml` | `[package].version` | Rust 可执行文件版本 |
| `src/main.ts` | `sidexVersion` 回退值 | 取不到 Tauri 版本时的 About 显示 |
| `Cargo.lock` | `name = "sc-code"` 的 `version` | cargo 构建也会自动更新 |

**不要改**：
- `productConfiguration.version` / VS Code API 版本（必须保持 `1.110.0`，否则扩展 engines 校验会把 VAC/Claude Code 判为不兼容）。
- workspace 内部 crate 的 `0.1.0` 版本（与应用版本无关）。

## 构建

```bash
npm run typecheck
npm test                       # 至少跑完；失败必须如实报告
npm run desktop:release        # prepare → Tauri Release → setup exe + unpack zip
```

等价入口：`release.bat`。需要先能准备固定 Node/Go/内置扩展；构建中间产物都在 `.runtime/`。

## 产物（按通道）

```
packages/dev/
└── ScCode_<version>_x64-unpack-debug.zip   # Debug unpack 包（含 PDB），仅用于开发测试

packages/release/
├── ScCode_<version>_x64-setup.exe          # NSIS 安装包
└── ScCode_<version>_x64-unpack.zip         # Release 免安装 zip（发布必须上传）
```

zip 内部统一以一个根目录开头（`ScCode_<version>_x64-unpack[-debug]/`），包含：

```
ScCode.exe
bin/node.exe
sidex-server.exe
extension-host/
extensions/
licenses/
runtime-manifest.json
unpack-manifest.json                 # SHA256 文件清单
README.txt
```

**不再生成 `packages/unpack` 目录**；暂存目录在校验与 zip 写入后删除。

构建脚本在 `scripts/build-desktop.cjs`：Release 只有本次新生成的安装包才会导出；Debug 只写 unpack zip，不导出 setup。unpack 先逐文件 hash 校验，随后 `scripts/unpack-output.cjs / archiveUnpack` 生成 zip（`scripts/zip-writer.cjs`，纯 Node，跨平台、不依赖系统 zip/tar）。

## 构建后验收

```bash
ls -la packages/dev/ packages/release/
# zip 必须存在且关键条目可检索（压缩数据中文件名可读）
grep -a -o 'ScCode_<version>_x64-unpack/ScCode.exe' packages/release/ScCode_<version>_x64-unpack.zip
grep -a -o 'ScCode_<version>_x64-unpack/unpack-manifest.json' packages/release/ScCode_<version>_x64-unpack.zip
grep -a -o 'ScCode_<version>_x64-unpack-debug/ScCode.pdb' packages/dev/ScCode_<version>_x64-unpack-debug.zip
```

- 冒烟：把 Release zip 解压到临时目录，用隔离 profile 启动其中的 `ScCode.exe`（`SC_CODE_HOME=D:\Temp\sc-code-smoke`）；GUI 不可用时至少报告未做 GUI 验收。
- 检查 setup exe 与 zip 大小非 0；Release zip 不应包含 Cargo 缓存、PDB 或用户 profile；Debug zip 应包含 PDB（若本次构建产出）。
- 失败/`--no-bundle` 不导出历史成品；失败时不得宣称打包成功。

## 文档收尾

按 AGENTS.md §5：

1. `CHANGELOG.md`：把 `[未发布]` 整理到 `[<version>]`（带日期）。
2. `ROADMAP.md`：对应条目打 ✅ 或记录交付里程碑。
3. `HANDOFF.md`：刷新状态；任务完结时清掉开工计划痕迹。
4. `ARCHITECTURE.md`：若改了打包链路的文件/函数/接口，同步更新。
5. `docs/releases/v<version>.md`：写发布说明（供 publish 使用）。
6. 跑 `sh check-docs.sh`。

## 输出要求

向用户报告：版本号与同步文件、产物绝对路径与大小、zip 是否包含 unpack、测试/冒烟结果、是否可进入 `sc-code-publish`。

**不要主动 commit / push / 发布**，除非用户明确要求。
