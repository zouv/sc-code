---
name: sc-code-publish
description: 把已打包的 ScCode 版本发布到 GitHub Releases（版本一致性、release notes、提交/tag/push、上传安装包与 unpack zip、核验资产）。仅当用户明确要求「发布 / 上传 Release / 打 tag / publish」时调用。
---

# ScCode 发布到 GitHub Skill

把**已定好版本并完成本地打包**的 ScCode 发布到 `zouv/sc-code` 的 GitHub Releases。

## 与 sc-code-release 的分工

| Skill | 职责 | 起点 → 终点 |
|---|---|---|
| `sc-code-release` | 源码 → 本地成品 | `packages/release/` 下的 setup exe 与 unpack zip |
| **`sc-code-publish`（本）** | 成品 → GitHub Release | 版本号 + notes + 产物 → Release 上线 |

**本仓库无自动发布流水线**：发布 = 本地打包 + 手动上传。

## 触发条件

- 用户说「发布」「上传 release」「打 tag」「发版」「publish」
- 需要创建 GitHub Release 并附安装包

## 前置检查（缺一不可）

```bash
git branch --show-current                  # 通常为 main
git status --porcelain                     # 必须干净（发布改动已提交）
gh auth status                             # 已登录
gh repo view --json nameWithOwner -q .nameWithOwner   # 期望 zouv/sc-code
gh repo set-default zouv/sc-code           # 不是就钉死，避免发错仓库
```

**产物必须已存在**（否则先走 `sc-code-release`）：

```bash
ls -la packages/release/ScCode_<version>_x64-setup.exe \
       packages/release/ScCode_<version>_x64-unpack.zip
```

版本一致性核对：

```bash
node -p "require('./package.json').version"
node -p "require('./src-tauri/tauri.conf.json').version"
grep -n '^version' src-tauri/Cargo.toml | head -1
git tag -l "v<version>"
```

## 执行流程

### 1. 确认版本号

版本来自 `package.json`（如 `0.1.1`），tag 为 `v<version>`（如 `v0.1.1`）。不要复用已存在的 tag。

### 2. 写 release notes

路径：`.runtime/release-notes-v<version>.md`（临时文件，不提交）。内容从 `CHANGELOG.md` 对应版本小节汇总：

```markdown
# v<version>

本版本为 Windows x64 本地未签名构建。

## 新增
- ...

## 变更 / 修复
- ...

## 产物
- `ScCode_<version>_x64-setup.exe`：NSIS 安装包
- `ScCode_<version>_x64-unpack.zip`：免安装完整目录（zip 根目录即程序根目录，解压后运行 ScCode.exe；需已安装 WebView2）
```

### 3. 提交 + 打 tag + 推送

> ⚠️ **写操作前必须获得用户明确指示**（AGENTS.md §6：未经明确要求不得 commit/push/发布）。本 skill 不自动执行。

```bash
git add <本次改动文件>
git commit -m "变更：版本号升至 <version> 并生成 unpack 发布包"
git tag -a v<version> -m "ScCode v<version>"
git push origin main
git push origin v<version>
```

提交信息标题使用 CHANGELOG 类别前缀（`新增：`/`修复：`/`变更：` 等）。

### 4. 创建 GitHub Release 并上传产物

**两个资产缺一不可**：NSIS 安装包 + unpack zip。

```bash
gh release create v<version> \
  --repo zouv/sc-code \
  --title "ScCode v<version>" \
  --notes-file .runtime/release-notes-v<version>.md \
  --prerelease \
  "packages/release/ScCode_<version>_x64-setup.exe" \
  "packages/release/ScCode_<version>_x64-unpack.zip"
```

- 当前版本未签名、为开发验收版，默认 `--prerelease`。
- 只上传当前平台能产出的产物；不要上传 `packages/dev/` 的 Debug 包、解压目录本体、`.runtime/` 或源码。
- 漏传资产可用 `gh release upload v<version> <file> --repo zouv/sc-code` 补齐；重传同名文件加 `--clobber`。

### 5. 核验

```bash
gh release view v<version> --repo zouv/sc-code
gh release view v<version> --repo zouv/sc-code --json assets --jq '.assets[] | "\(.name) \(.size)"'
```

必须确认：

1. 资产列表同时包含 `-setup.exe` 与 `-unpack.zip`；
2. 两个文件 size 均非 0，且 zip 明显大于安装包（当前 Release zip 约 95MB，setup 约 69MB）；
3. 正文来自 `CHANGELOG.md` 对应版本小节，不是模板。

## 重要约束

1. **未经用户明确指示，禁止 commit / tag / push / 创建 Release**。
2. **版本号、tag、产物文件名三者必须一致**；不一致就停下修正，不要上传旧版本文件。
3. **unpack zip 是发布硬要求**：只传安装包视为发布未完成；若构建未生成 zip，回 `sc-code-release` 补包，不得手工拼凑。
4. 已推送 tag 不要删除；需要修正时发新版本。
5. 发布后把结果（Release URL、资产列表）写回 `HANDOFF.md` / `ROADMAP.md`，并按 CHANGELOG 约定清理未发布区。
