---
name: 'sidex-release'
description: 'Build and package local installers of the custom sidex (version bump, pre-release checks, tauri build). Invoke when user asks to build, package, or make an installer of the custom sidex. 发布到 GitHub 请用 sidex-publish skill。'
---

# SideX 自定义版本打包 Skill

把自定义 sidex 源码**构建打包成本地安装包**，终点是仓库根的 `target/release/bundle/` 下的平台安装包。

**发布到 GitHub（提交 / tag / Release / 上传产物）已拆到 `sidex-publish` skill** —— 打完包后走那边。

## 与 sidex-publish 的分工

| Skill                   | 职责                        | 起点 → 终点                                                    |
| ----------------------- | --------------------------- | -------------------------------------------------------------- |
| **`sidex-release`（本）** | 从源码到**本地安装包**      | 干净工作区 → `target/release/bundle/**`（仓库根）              |
| `sidex-publish`         | 从版本号到 **GitHub Release** | 版本号 + release notes → release 上线（产物由本地打包上传）    |

> 上游 sidex 目前**不发布预编译二进制**（README 明示 "Pre-built binaries are not distributed yet"），也没有可复用的全平台 CI 发布流水线。因此本仓库的发布 = **本地打包 + 手动上传产物**。

## 触发条件

- 用户说"打包"、"打个包"、"生成安装包"、"build"、"package"
- 需要拿到安装包做本地验证
- 发布前需要本地产物

## 参数收集

1. **版本号**：格式 `v<上游版本>-custom.<N>`（如 `v0.1.3-custom.1`）。**必须在打包前定好**——版本号内嵌在产物文件名与 exe 资源里。未指定时读已有 tag 取最大序号 +1：

   ```bash
   git tag -l "v*-custom.*" --sort=-v:refname | head -5
   ```

2. **打包类型**：
   - 完整打包（默认）：`npx tauri build`
   - 仅调试运行（最快，不做安装包）：`npm run tauri dev`

## 前置检查

```bash
git branch --show-current      # 必须是 custom/main
git status --porcelain         # 建议干净
sh CUSTOMIZATIONS/scripts/check-registry.sh   # 登记一致性必须全绿
```

## 版本号落点（四处，必须同步改）

sidex 的版本号分散在四处，**打包前必须**一并更新为同一个 `<版本>`（不带 `v` 前缀）：

| 文件                       | 字段              | 当前值  | 说明                                   |
| -------------------------- | ----------------- | ------- | -------------------------------------- |
| `package.json`             | `version`         | `0.1.3` | 前端 / npm 侧版本                      |
| `src-tauri/tauri.conf.json`| `version`         | `0.1.3` | **Tauri 打包真正读取的版本**（字面量） |
| `src-tauri/Cargo.toml`     | `version`         | `0.1.3` | Rust 可执行文件版本（带 CUSTOM 标记）  |
| `src-tauri/tauri.conf.json`| `bundle.windows.wix.version` | `0.1.3.1` | **MSI 专用纯数字版本**（见下） |

> 注意：workspace 根 `Cargo.toml` 的 `[workspace.package] version`（当前 `0.2.0`）是**内部 crate 的版本**，与应用版本无关，**不要动**。

### MSI 需要单独的纯数字版本（必做）

WiX 的 MSI `ProductVersion` 只接受纯数字（`major.minor.patch.build`），带 `-custom.1` 会直接失败：

```
failed to bundle project `optional pre-release identifier in app version must be numeric-only
and cannot be greater than 65535 for msi target`
```

所以 `tauri.conf.json` 的 `bundle.windows.wix.version` 要按 custom 序号递增，把 N 放第 4 位：

| 应用版本            | `wix.version` |
| ------------------- | ------------- |
| `0.1.3-custom.1`    | `0.1.3.1`     |
| `0.1.3-custom.2`    | `0.1.3.2`     |

**忘了改会让 Windows 认为 MSI 版本未变，升级安装被跳过。** 详见 `docs/pitfalls.md` #4。

示例（`v0.1.3-custom.1`）：

```bash
# 三处都改成 0.1.3-custom.1
```

## 打包执行

```bash
npm install

# 快捷方式（已内置 AWS_LC_SYS_PREBUILT_NASM=1，等价于下面那条）
npm run build:custom
# 或双击 / 调用 bat（会先打印四处版本号自查，再打包并列出产物）
CUSTOMIZATIONS/scripts/build.bat

# 等价的原生命令
AWS_LC_SYS_PREBUILT_NASM=1 npx tauri build
```

- **Windows**：`AWS_LC_SYS_PREBUILT_NASM=1` 必须带（`aws-lc-sys` 需要 NASM，见 `docs/pitfalls.md` #1）；
  `dev:custom` / `build:custom` 与两个 bat 已内置，无需再手写
- 首次打包 Rust 编译需 **5–10 分钟**；后续增量快得多
- 前端构建已内置 12GB 堆上限；若仍 OOM，自行 `NODE_OPTIONS="--max-old-space-size=16384"`

## 产物位置

⚠️ 产物在**仓库根**的 `target/`，**不是** `src-tauri/target/`（根 `Cargo.toml` 是 workspace，cargo 的 target 目录落在 workspace 根；`src-tauri/target/` 永远不存在）。

```
target/release/bundle/
├── msi/     *.msi        # WiX 安装包
├── nsis/    *-setup.exe  # NSIS 安装包
├── dmg/     *.dmg        # macOS
├── appimage/ deb/        # Linux
```

`tauri.conf.json` 的 `bundle.targets` 为 `"all"`，即按当前平台产出全部可用格式。

**判断成功只看最后一行**：`Finished N bundles at:` 并列出所有产物路径。Tauri 的"编译完成"（`Built application at: ...exe`）**不等于**打包成功——某一种格式失败会中断后续格式，可能出现"编译成功却零安装包"的情况（见 `docs/pitfalls.md` #4）。

## 打包后

1. **冒烟测试**：运行生成的安装包/可执行文件，确认能启动、打开文件夹、终端可用
2. **登记**：若本次为发布做了版本号改动或打包相关的源码修改，走 `sidex-record-change` 登记
3. **汇报**：产物路径、大小、冒烟结果；**不要主动 git commit / push**（除非用户明确要求）

## 输出要求

向用户报告：

- 版本号（三处文件是否已同步）
- 产物路径与文件大小
- 冒烟测试结果
- 是否可以直接进入 `sidex-publish` 发布
