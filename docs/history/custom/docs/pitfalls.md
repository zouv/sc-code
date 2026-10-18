# 历史坑点 / Pitfalls

> **这是什么**：本仓库（custom-sidex）开发与排查中**踩过的坑**的沉淀。新会话动手前先扫一眼标题，
> 避免重复踩坑。每条写清：现象 → 根因 → 解法 → 验证方式。
>
> **维护铁律**：每解决一个"反复折腾才定位到"的问题，就来这里加一条（一次没定位到就解决的不算坑）。
> 配套：代码位置反查见 [`../architecture.md`](../architecture.md)。

---

## 1. Windows 首次构建失败：`aws-lc-sys` 需要 NASM，报 "NASM command not found!"

- **日期**：2026-10-12（CUSTOM-20261012-001，首次 `npm run tauri dev` 时发现）
- **现象**：`npm run tauri dev` 在 Rust 编译到 ~718/943 时中断，退出码 101：
  ```
  cargo:warning=NASM command not found or failed to execute.
  thread 'main' panicked at ...\aws-lc-sys-0.41.0\builder\nasm_builder.rs:138:13:
  NASM command not found! Build cannot continue.
  ```
- **根因**：依赖链里 `aws-lc-sys`（`aws-lc-rs` 的 FFI 层，加密相关）包含汇编优化的加密例程。在 `x86_64-pc-windows-msvc` 上，构建脚本默认调用 **NASM 汇编器**把 `.asm` 编译成目标文件；本机没装 NASM → panic。注意这**不是** MSVC 缺失问题（MSVC Build Tools 已装、`rustc` host 也是 msvc）。
- **解法（二选一）**：
  1. **快速**（推荐，零安装）：构建前设环境变量 `AWS_LC_SYS_PREBUILT_NASM=1`，让该 crate 使用自带的预编译 NASM 目标文件，跳过本地汇编。
     ```bash
     AWS_LC_SYS_PREBUILT_NASM=1 npm run tauri dev
     ```
  2. **治本**：安装 NASM 并加入 PATH（`winget install nasm`，或从 nasm.us 下载），之后无需该环境变量。
- **教训**：Windows 上 Rust 构建失败先看是不是**某个 `-sys` crate 要求外部工具链**（NASM/Perl/CMake/LLVM 都常见），不要一上来怀疑 MSVC 或 Rust 版本。
- **验证**：设上环境变量后重跑，`aws-lc-sys` 顺利编过，最终 `Finished dev profile in 3m 05s` 且应用窗口弹出。

## 2. 扩展"装了但没显示"：SideX 不扫描 `~/.vscode/extensions`，且有两份不一致的扫描路径定义

- **日期**：2026-10-12（排查"Claude Code 扩展装了但对话面板不出现"时发现）
- **现象**：在 SideX 里安装 VS Code 扩展后，界面看不到其视图/面板；扩展宿主日志恒为 `discovered 0 extensions`。而 VS Code 的扩展目录里该扩展确实存在。
- **根因（两层）**：
  1. **运行时实际生效的扫描路径不含其他编辑器目录**。`src-tauri/src/commands/extension_platform.rs` 的 `extension_search_paths()` 里有一条显式注释：
     ```
     // NOTE: we intentionally do NOT scan other editors' extension dirs
     // (~/.vscode/extensions, ~/.cursor/extensions, or their app bundles).
     ```
     候选路径只有：用户扩展目录（`%APPDATA%\SideX\extensions`）、内置扩展目录、`extensions-rust/`、`dist/extensions`、`cwd/extensions`、仓库 `extensions/`。
  2. **同一仓库里另有一份 `crates/sidex-extensions/src/registry.rs` 的 `default_search_paths()`**，它**包含** `~/.vscode/extensions` 与 `~/.cursor/extensions`。两份定义不一致——排查时若读到 crate 那份会被误导，**运行时认的是 `src-tauri` 那份**。
- **解法**：
  - **想用某个 VS Code 扩展**：把它复制进 SideX 自己的扩展目录 `%APPDATA%\SideX\extensions\`（应用启动时扫描），重启应用即可。纯 JS/自带原生二进制的扩展（如 Claude Code 是 win32-x64 全量包，含 `claude.exe`）可搬运；依赖 `npm install` 的扩展不行。
  - **想改扫描逻辑**：改 `src-tauri/src/commands/extension_platform.rs` 的 `extension_search_paths()`，并在 `registry.md` 登记（它会与上游合并冲突）。
- **教训**：
  1. 排查扩展问题第一步是看扩展宿主日志的 `discovered N extensions across M search paths`——`N=0` 说明根本没被发现，与"面板渲染坏了"是两回事。
  2. 同仓库存在**同名函数的重复定义**时，先确认哪份真正被打进运行时。
  3. 面板类扩展的落点要看它的 `when` 条件：如 Claude Code 在宿主版本 ≥ 某值时把视图放进 **secondarySidebar（右侧副侧边栏）**，而非左侧活动栏——找不到面板时先看右侧。
- **验证**：复制扩展后重启，日志变为 `discovered 1 extensions`，`extension host started` 且无报错，`claude.exe` 进程随之启动。

## 3. `sidex-server binary not found` —— AI 聊天面板显示未连接，但**不影响编辑器**

- **日期**：2026-10-12（首次运行时发现）
- **现象**：启动日志出现
  ```
  [sidex-server] sidex-server binary not found. Build it with `cd sidexai/sidex-server && go build -tags fts5 -o sidex-server ./cmd/server`
  ```
  聊天面板显示为 disconnected。
- **根因**：AI agent server 是**独立的 Go 进程**（`sidexai/sidex-server`），由 `src-tauri/src/server.rs` 作为子进程拉起。本机未装 Go（需 ≥1.26），二进制没构建，故启动时找不到。
- **解法**：这是**预期行为，非缺陷**。编辑器其余功能全部正常。想启用聊天面板：
  1. 安装 Go ≥1.26
  2. `cd sidexai/sidex-server && go build -tags fts5 -o sidex-server ./cmd/server`
  3. 重启应用（或调 `server_restart`）
- **教训**：SideX 的"AI 能力"与"编辑器能力"是解耦的两块。构建/运行失败时先分清是哪一块——编辑器不需要 Go。
- **验证**：构建出二进制后重启，聊天面板可连接；未构建时其余功能（编辑、终端、Git、搜索）一切正常。

## 4. `tauri build` 出包失败：MSI 拒绝 `-custom.N` 版本号；且产物根本不在 `src-tauri/target/`

- **日期**：2026-10-12（首次打包 v0.1.3-custom.1 时发现，CUSTOM-20261012-002）
- **现象**：Rust 全部编译成功（`Finished release profile in 12m 34s`、`Built application at: ...\SideX.exe`），却在最后一步出包时终止：
  ```
  Info Patching ...\SideX.exe with bundle type information: msi
  Info Verifying wix package
  Downloading https://github.com/wixtoolset/wix3/releases/download/wix3141rtm/wix314-binaries.zip
  failed to bundle project `optional pre-release identifier in app version must be numeric-only and cannot be greater than 65535 for msi target`
  ```
  **一个安装包都没产出**——MSI 先失败，后面的 NSIS 根本没轮到。
- **根因**：WiX 的 MSI `ProductVersion` 只接受 `major.minor.patch.build` 纯数字（major/minor ≤255，patch/build ≤65535），而自定义版本号 `0.1.3-custom.1` 里的 `custom` 是字母。上游能编过是因为它的 tauri 版本是干净的 `0.1.3`。
- **解法**：保留应用版本 `0.1.3-custom.1`（产物名 / exe 资源 / 关于页都用它），另在 `src-tauri/tauri.conf.json` 用 `bundle.windows.wix.version` 单独给 MSI 一个纯数字版本，把 custom 序号塞进第 4 位：
  ```json
  "windows": {
    "webviewInstallMode": { "type": "downloadBootstrapper" },
    "wix": { "version": "0.1.3.1" }
  }
  ```
  **注意**：该字段是手写常量，不会随 `version` 自动变——**每发一个 custom 序号都要同步改**（custom.2 → `0.1.3.2`），否则 Windows 认为 MSI 版本没变、升级安装会跳过或报重复安装。
- **顺带纠正（不是坑但是弯路）**：产物**不在** `src-tauri/target/release/bundle/`，而在**仓库根** `./target/release/bundle/`。因为根 `Cargo.toml` 是 workspace（`[workspace.package]`），cargo 的 target 目录落在 workspace 根，`src-tauri/target/` 始终是空的——盯着它看会误判成"编译还没开始"。原 `sidex-release` skill 文档写的是 `src-tauri/target/...`，已修正。
- **教训**：
  1. Tauri 的"编译完成"不等于"打包成功"，**必须看最后一行是不是 `Finished N bundles at:`**，否则会拿着一个不存在的安装包路径去汇报。
  2. 带语义后缀的版本号（`-custom.N`/`-beta.N`）在 Windows 安装包链路上是"二等公民"，遇到 `must be numeric-only` 直接找该打包器的 version override 字段，别改应用版本迁就。
  3. 多平台产物路径先 `ls` 确认，别信文档。
- **验证**：加 `wix.version` 后重跑（Rust 增量 5m 48s），`Finished 2 bundles at:` 列出
  `bundle/msi/SideX_0.1.3-custom.1_x64_en-US.msi`（18MB）与 `bundle/nsis/SideX_0.1.3-custom.1_x64-setup.exe`（13MB）；产物名仍是 `-custom.1`，而 MSI 内部版本为 `0.1.3.1`。

## 5. Claude Code 扩展报 "the Windows (win32-x64) build could not be found"：同 ID 同版本两个目录并存时**先扫到的赢**，装错平台的包会顶掉正确的包

- **日期**：2026-10-12（用户装完 Claude Code 扩展后无法登录/使用时排查）
- **现象**：Claude Code 面板能打开，但直接红框报错，登录按钮点不动：
  ```
  The Claude Code program for this computer, the Windows (win32-x64) build, could not be found.
  The installed extension holds the Linux build instead. ...
  To fix this, reinstall the extension, or set claudeCode.claudeProcessWrapper to a program that runs Claude Code.
  ```
- **根因（两层）**：
  1. **扩展目录里有两个同 id 的包**：`%APPDATA%\SideX\extensions\` 下同时存在
     `Anthropic.claude-code`（2.1.296，实为 **Linux-arm64** 包）与 `anthropic.claude-code-2.1.296-win32-x64`（2.1.296，正确的 Windows 包）。
     用 `file` 看 native 二进制即可分辨：前者 `ELF 64-bit LSB executable, ARM aarch64, /lib/ld-musl-aarch64.so.1`，`audio-capture/arm64-linux`；后者 `PE32+ executable for MS Windows, x86-64`，`audio-capture/x64-win32`。
     —— 用户拿到的是 **alpine-arm64**（musl ARM）变体。**注意：这不是用户下错包，是 SideX 自己请求错的平台**，见下方"真正的根因"。
  2. **谁赢由扫描顺序决定，不是版本高低**：`scan_extensions()`（`src-tauri/src/commands/extension_platform.rs:548`）用 `HashMap<id, manifest>` 去重，替换条件是
     `is_version_greater(new, existing)`；两个包版本**都是 2.1.296**，`is_version_greater` 在相等时返回 `false` → **不替换 → 先扫到的胜出**。
     而 `fs::read_dir` 在 NTFS 上按字母序返回，`Anthropic.claude-code` 排在 `anthropic.claude-code-2.1.296-win32-x64` 之前 → **坏的 Linux 包赢**，把正确的 Windows 包顶掉。
- **解法**：把错平台的包**移出** `extensions/`（SideX 只扫 `%APPDATA%\SideX\extensions`，移到同级目录即失效，可直接还原）：
  ```bash
  cd "$APPDATA/SideX" && mkdir -p extensions-disabled
  mv extensions/Anthropic.claude-code extensions-disabled/Anthropic.claude-code.linux-arm64-BROKEN
  ```
  正确包保持 VS Code 目录命名 `<publisher>.<name>-<version>-<platform>` 即可被识别。
  **以后下载 VSIX 必须显式带平台**：`.../vsextensions/claude-code/<版本>/vspackage?targetPlatform=win32-x64`
  （marketplace 网页上的 Download 按钮给的不一定是本平台包，这是本次踩坑的来源）。
  兜底方案：在设置里把 `claudeCode.claudeProcessWrapper` 指向一个能跑的 claude（如本机 CLI `~/.local/bin/claude.exe`）。
- **教训**：
  1. 扩展报"平台不对 / 找不到本平台二进制"时，**先 `file` 一下扩展里的 native 二进制**，一眼分辨 ELF/PE、x64/arm64，比读日志快。
  2. 同 id 多副本并存时**别假设"版本高的赢"**——本仓库的实现是"同版本不替换，先扫到的赢"，所以**多余副本必须清掉，不能靠留新版覆盖旧版**。
  3. `%APPDATA%\SideX\extensions\` 下出现两种命名（`<id>` 与 `<id>-<version>-<platform>`）时就是重复安装的信号。
- **验证**（release 包无日志，`tauri_plugin_log` 只在 `debug_assertions` 下启用，所以靠日志和产物文件取证）：
  1. 移走错包后 `extensions/` 只剩 `anthropic.claude-code-2.1.296-win32-x64`。
  2. **抓 init 数据取证**（后端把扩展列表写进 `%TEMP%\sidex-init-<uuid>.json` 交给宿主，宿主读完即 `unlinkSync`，必须在启动瞬间抢读）：
     ```powershell
     $probe='C:\...\Temp\sidex-probe-tmp'; Remove-Item $probe -Recurse -Force; New-Item -ItemType Directory $probe|Out-Null
     $env:TMP=$probe; $env:TEMP=$probe        # 让子进程的 std::env::temp_dir() 指向空目录
     Start-Process '...\target\release\SideX.exe'
     while(...){ $f=Get-ChildItem $probe -File|?{$_.Name -like 'sidex-init-*'}; if($f){Copy-Item $f[0].FullName $out;break} }
     ```
     结果：`extensions` 只有 **1 条** `Anthropic.claude-code` 2.1.296，`extensionLocation.path` = `/C:/Users/.../SideX/extensions/anthropic.claude-code-2.1.296-win32-x64`（**正确的 Windows 目录**）。
     踩过的两个小坑：① `Register-ObjectEvent -Action` 在独立 runspace 执行，引用外部变量得用 `$using:` 或硬编码路径；② 轮询别用 `Get-ChildItem | Select -First 1` 抓"第一个文件"就退出——temp 里有近 10 万个杂项文件，会抓到无关 `.tmp` 而漏掉真正的 init 文件，**必须按文件名过滤**。
  3. **按扩展自身逻辑 A/B 实测**（复刻 `extension.js` 里的解析函数）：
     | 包 | ① `resources/native-binaries/win32-x64/claude.exe` | ③ `resources/native-binary/claude.exe` | 结果 |
     | --- | --- | --- | --- |
     | 好包 win32-x64 | ✗ | **✓** | 解析成功 |
     | 坏包 linux-arm64 | ✗ | ✗ | `undefined` → 抛 `unsupported_platform` |
     坏包一列正是用户截图那句报错的来源，好包走 ③ 回退命中。
  4. 好包自带二进制可执行：`resources/native-binary/claude.exe --version` → `2.1.296 (Claude Code)`。
  5. 启动 SideX 后扩展宿主以子进程形式起来（`node --max-old-space-size=3072 target/release/extension-host/server.cjs`），无扩展加载报错。
- **未验证**：登录环节需在 GUI 里点，无法自动化；修完后用户重启 SideX 方可确认端到端可用。
- **真正的根因（后端日志实锤，2026-10-12 追加）**：日志 `%LOCALAPPDATA%\dev.sidex.app\logs\SideX.log` 里留下了安装时的原始请求：
  ```
  [sidex_lib::commands::extensions][INFO] downloading extension from
    https://marketplace.siden.ai/api/asset/openvsx/vsix-<base64>/Microsoft.VisualStudio.Services.VSIXPackage?redirect=true
  [sidex_lib::commands::extensions][INFO] installed extension Anthropic.claude-code to ...\extensions\Anthropic.claude-code
  ```
  base64 解出来是：`https://open-vsx.org/api/Anthropic/claude-code/alpine-arm64/2.1.296/file/Anthropic.claude-code-2.1.296@alpine-arm64.vsix`
  —— **应用主动请求了 `alpine-arm64` 变体**，装完后那份包自然带的是 musl-ARM 二进制。所以这是**平台选择缺陷，不是用户操作问题**。
  调用链：前端 gallery service（`src/vs/platform/extensionManagement/common/extensionGalleryService.ts`，`CURRENT_TARGET_PLATFORM = getTargetPlatform(platform, arch)`，第 91 行）→ `marketplace.siden.ai/api/gallery`（`product.ts:76` 的 `serviceUrl`）→ 服务端返回 `/api/asset/openvsx/vsix-<base64>/…` 资源 URL → 前端把整条 URL 交给 Rust 的 `install_extension_from_url`（`src-tauri/src/commands/extensions.rs:81`，只负责下载，不参与平台选择）。
  平台值来源：`getTargetPlatform(platform | 'alpine', arch)`（`extensionManagement.ts:115`），其中 `arch` 来自 `base/common/process.js` —— **源码注释明确写着 "arch is undefined in web"**，webview 里它很可能是 `undefined`。`alpine` 分支由 `isAlpineLinux()`（`extensionManagementUtil.ts:209`，读 `/usr/lib/os-release` 判 `ID=alpine`）触发。
  ⚠️ **尚未完全钉死**：`alpine-arm64` 究竟是在客户端算出来的，还是 `marketplace.siden.ai` 服务端在客户端没给出平台时的默认值，还需最后一步确认（下一步可查 `getTargetPlatform` 的实际入参）。**若要根治，应从这里入手，而不是重复删目录。**
- **备注**：早期我曾判断"后端没有 VSIX 安装代码、包是外部放进来的"——**那是错的**，只 grep 了 `extension_platform.rs`，漏了 `src-tauri/src/commands/extensions.rs`（`install_extension` / `install_extension_from_url` / `uninstall_extension` 三个命令，均已在 `lib.rs` 注册）。教训：找功能别只搜一个模块，先按命令名在 `lib.rs` 的注册表里反查。

## 6. 排障时"日志在哪"：日志**只在 dev 构建**输出，release 包零日志；落点是 `%LOCALAPPDATA%\<identifier>\logs\`

- **日期**：2026-10-12（排查 Claude Code 扩展问题时顺带摸清）
- **现象**：跑 release 版 `target/release/SideX.exe` 时 stdout 全空、也找不到日志文件，一度以为"这仓库没有日志系统"。
- **根因**：`tauri-plugin-log` 的注册被 `if cfg!(debug_assertions)` 包住（`src-tauri/src/lib.rs:655` 附近）。**release 构建里它根本不注册**，于是所有 `log::info!/warn!/error!`（log crate 的 no-op 实现）被直接丢弃——不是没写日志，是没人接收。
- **落点**（**仅 dev 构建**）：
  - 文件：`%LOCALAPPDATA%\<identifier>\logs\SideX.log`，本机即 `C:\Users\<用户>\AppData\Local\dev.sidex.app\logs\SideX.log`（identifier 来自 `tauri.conf.json` 的 `dev.sidex.app`）
  - 同时输出到 stdout（`npm run tauri dev` 的终端里能直接看到）
  - 配置为 `tauri_plugin_log::Builder::default().level(LevelFilter::Info)`，默认 targets = **Stdout + LogDir**（见 `tauri-plugin-log-2.8.0/src/lib.rs:50-51`）
  - 注意：`%APPDATA%\SideX\`（扩展目录、state db 所在）和日志目录**不是同一个**——前者是 SideX 自定义的路径（`sidex_extensions::paths`），后者是 Tauri 按 identifier 算的。
- **覆盖范围**：Rust 后端全量（扩展发现/安装、sidex-server、命令层）。本次 Claude Code 的根因就是从这个文件直接读到的（`downloading extension from ...alpine-arm64...`）。
- **不覆盖**：
  - 前端 TS 的 `ILogService` —— 只出现在 webview console，**不写进这个文件**
  - 扩展宿主的 stdout/stderr —— 被 Rust 读进内存 buffer（`src-tauri/src/commands/ext_host.rs:298` 的 `stderr_buf`），不落盘
- **其他可用取证点**：`%TEMP%\sidex-init-<uuid>.json`（宿主读完即 `unlinkSync`，要抢读，手法见 #5）；devtools 由 `tauri` 的 `devtools` feature 提供，且在 setup 里**无条件** `window.open_devtools()`（没被 `debug_assertions` 包住，见 `lib.rs` 该段），所以 release 启动时也会多开一个 devtools 窗口。
- **解法/建议**：
  1. 排障、验收时**用 dev 构建**（`npm run tauri dev`）而不是 release exe，否则什么都看不到。
  2. 想长期靠日志排查 release 问题，需要一处自定义改动：把 plugin 注册从 `cfg!(debug_assertions)` 解绑（例如加 `SIDEX_LOG=1` 环境变量或设置项开关）。这是**改上游文件**，要走 `[CUSTOM-BEGIN]` 标记 + registry 登记。
- **教训**：判断"有没有日志"要看**注册代码**而不是搜 `log::` 调用点——调用点满仓库都是，但 release 里全是空操作。
- **验证**：`ls %LOCALAPPDATA%\dev.sidex.app\logs\` → `SideX.log`（含 15 行，从 dev 运行产生）；对照 release exe 运行后该文件无新增行。




## 7. 「没法安装 VSIX 扩展」：前端跑在 Web 模式，VSIX 安装链路整体缺 server；拖拽还被 Tauri 吞掉

- **日期**：2026-10-13（CUSTOM-20261013-001，排查用户安装 `vscode-acp-client-1.0.1.vsix` 失败）
- **现象**：安装本地 `.vsix` 无从下手——「Install from VSIX...」在命令面板和扩展视图「...」菜单里都**不出现**；硬走别的入口（拖拽）也失败（`No Servers` / 无反应）。上游 issue #12「不支持 vsix」关闭时维护者的答复就是 "VSIX installation isn't fully wired up yet, it's planned as the next thing"。
- **根因**（三处叠加，缺一不可）：
  1. **前端是 Web 模式**：Tauri webview 里 `platform.ts` 走 "Web environment" 分支（没有 `process`、非 electron renderer）→ `isWeb === true`。于是 `ExtensionManagementServerService`（`src/vs/workbench/services/extensionManagement/common/extensionManagementServerService.ts:26`）**只注册 `webExtensionManagementServer`**，`localExtensionManagementServer` 恒为 `null`。
  2. **上游 VSIX 链路强依赖 local/remote server**：
     - 菜单 `when` 是 `hasLocalServer || hasRemoteServer`（`extensions.contribution.ts:850/853/879`）→ 两项都为 false，命令与菜单项被隐藏；
     - `installFromVSIX()` → `getManifest(vsix)`（`extensionManagementService.ts:540`）对 `file://` 无分支可走，直接 `Promise.reject('No Servers')`；`installVSIX()` → `getServersToInstall()` 返回 undefined → `reject('No Servers to Install')`；
     - `installFromLocation(location)` 对 `file://` 同样直接 `throw new Error('Local extension management server is not found')`（`extensionManagementService.ts:522`）。
  3. **拖拽进不来**：`src-tauri/tauri.conf.json` 的 `dragDropEnabled: true`（默认值）表示由 **Tauri 接管 OS 拖放**，webview 收不到 HTML5 drop 事件。所以 `extensionsViewlet.ts:684` 那个 DropObserver **在本项目里永远不会触发**；而 `web.main.ts:201` 监听的那个 `sidex-open-paths` 自定义事件**仓库里没有任何地方派发**（死代码）——两头都不通。
  - 补充：Rust 侧能力**早就写好了**（`src-tauri/src/commands/extensions.rs:64` 的 `install_extension` → `crates/sidex-extensions/src/vsix.rs`，解压到 `%APPDATA%\SideX\extensions\<publisher>.<name>`），只是前端从没接过线；`sidexExtensionService.ts:95` 那处 `invoke('install_extension', { extensionId: id })` 参数名与 Rust 的 `vsix_path` 不匹配，是**从未生效的死代码**（别照着它改）。
- **解法**（CUSTOM-20261013-001）：新增自定义模块 `CUSTOMIZATIONS/src/vsix-install/vsixInstall.contribution.ts`（挂在 `src/main.ts`），把两端接起来而不动上游扩展管理逻辑：
  1. 自定义命令 `sidex.extensions.installFromVSIX`（命令面板 + 扩展视图标题「...」菜单 + 资源管理器右键 `.vsix`），文件选择走已桥接 Tauri 的 `IFileDialogService`；
  2. Tauri `install_extension` 解压落盘；
  3. **关键一步**：拿 `IExtensionManagementServerService.webExtensionManagementServer` 直接调 `extensionManagementService.installFromLocation(URI.file(安装目录), currentProfile.extensionsResource)` —— 绕开 workbench 服务对 `file://` 的 `'Local extension management server is not found'` 分支，同时事件仍会经 workbench 服务的 multiplexer 冒泡，触发 `tauriExtensionHost.contribution.ts` **既有**的热加载（`loadExtension` + `activateExtension`）；
  4. 拖拽用 `getCurrentWebviewWindow().onDragDropEvent()` 监听（Tauri 事件，路径里筛 `.vsix`），补上 `dragDropEnabled: true` 下的缺环。
- **验证**：`npx eslint` 自定义模块无告警；`npm run build` 通过且 `dist/assets/index-*.js` 里能 grep 到 `sidex.extensions.installFromVSIX`。
- **教训**：
  1. 判断"某个 VSCode 功能在 SideX 里能不能用"，**先看它依赖哪个扩展管理 server**——`isWeb === true` 意味着一切 `file://` 相关的安装/卸载入口都可能是断的。
  2. Tauri 里排查"拖拽不管用"，先看 `tauri.conf.json` 的 `dragDropEnabled`：为 `true` 时前端拿不到 HTML5 drop 事件，只能监听 Tauri 的 `onDragDropEvent`。
  3. 仓库里存在**只有监听者、没有派发者**的死代码（`sidex-open-paths`）——别看到监听器就以为链路是通的。
- **追加修复（CUSTOM-20261013-004）**：Tauri 原生拖放监听现已将 `.code-workspace` 直接交给 `IHostService.openWindow({ workspaceUri })`，并由 `src/main.ts` 的 `workspace` URL 参数和 provider 路由完成多根工作区重载。`sidex-open-paths` 仍未接入，也不是这次修复路径。

### 追加（CUSTOM-20261013-002）：`file://` 被改写成 `sidex-asset://`，凡是"读磁盘扩展文件"的路径都会炸

- **现象**：从 VSIX 装完（Rust 侧已落盘、日志有 `installed extension … to …`）后，前端登记阶段抛
  `Cannot find a valid extension from the location file:///c%3A/Users/…/extensions/<id>`。
- **根因**：链路是 `WebExtensionManagementService.install()` → `webExtensionsScannerService.scanExtensionManifest(安装目录)` → `getExtensionManifest()` → `joinPath(location,'package.json')` → `extensionResourceLoaderService.readExtensionResource(uri)`。而该方法第一句是 `uri = FileAccess.uriToBrowserUri(uri)`，SideX 在 `src/vs/base/common/network.ts:328` 加了一处分支：**Tauri 下任何 `file://` 都改写成 `sidex-asset://localhost/<encodeURIComponent(fsPath)>`**（本意是让 `<img src>`/`fetch` 走 Tauri 自定义协议）。改写后 scheme 既不是 http/https/data/tauri，代码便走 `IFileService.readFile(uri)` —— 但 **`sidex-asset` 没有注册 FileSystemProvider**（它只是 `src-tauri/src/lib.rs:477` 的 `register_asynchronous_uri_scheme_protocol`，属于 webview 网络层，不是 workbench 文件层）→ 读取必然失败 → `scanExtensionManifest` 返回 null → 上层报"找不到有效扩展"。
- **解法**：`extensionResourceLoaderService.ts` 的 `readExtensionResource()` 开头加前置分支（`[CUSTOM-BEGIN] CUSTOM-20261013-002`）：Tauri 且 `uri.scheme === Schemas.file` 时直接 `this._fileService.readFile(uri)`，跳过浏览器 URI 改写。
- **教训（重要）**：**别用 `FileAccess.uriToBrowserUri()` 的结果去喂 `IFileService`**。前者返回的是"浏览器/网络层"用的 URI（Tauri 下会变成 `sidex-asset://`），后者只认注册过 provider 的 scheme（`file`/`vscode-file`/`vscode-userdata`/扩展贡献的 scheme）。看到 `sidex-asset://` 出现在 `IFileService` 的报错里，就回到这里找改写点。
- **验证**：待复测（dev 实例安装该 VSIX 后扩展视图出现且激活）。

## 8. `gh` 的默认仓库指向**上游** Sidenai/sidex —— 一条命令就能把 release/PR 发错仓库

- **日期**：2026-10-13（CUSTOM-20261013-003，首次发布 `v0.1.3-custom.1` 时撞到）
- **现象**：`gh release create v0.1.3-custom.1 ...` 报
  `tag v0.1.3-custom.1 exists locally but has not been pushed to Sidenai/sidex, please push it before continuing`
  —— 明明 tag 已经 push 到了 `origin`（zouv/custom-sidex），gh 却在跟**上游**仓库较劲。
- **根因**：`gh` 的默认仓库不是看 `origin`，而是按启发式挑选（远程里带 push URL 的都会被纳入考量）。本仓库有两个 remote（`origin` → zouv/custom-sidex，`upstream` → Sidenai/sidex，且 `upstream` 也配了 push URL 用于 fetch 上游），`gh repo view` 实测解析结果是 **Sidenai/sidex**。若不显式指定，`gh release create` / `gh pr create` / `gh issue create` 都会瞄准上游。
- **解法**：
  1. 一次性钉死本仓库默认：`gh repo set-default zouv/custom-sidex`（写入 `.git/config` 的 `gh-resolved`）；核对 `gh repo view --json nameWithOwner -q .nameWithOwner` → 应为 `zouv/custom-sidex`
  2. 发版类命令**同时显式带** `--repo zouv/custom-sidex`（双保险，换机器/新 clone 时尤其重要）
- **验证**：`gh release create v0.1.3-custom.1 --repo zouv/custom-sidex …` 成功；`gh release view v0.1.3-custom.1 --repo zouv/custom-sidex --json assets` 显示两份产物。
- **教训**：**fork 型仓库做任何 `gh` 写操作前，先确认默认仓库**。`upstream` 配 push URL 是常见做法（为了 `git fetch upstream` 方便），但它会把 gh 的默认目标带偏——发错仓库的 release/PR 是外部可见的、删起来很尴尬。

## 9. 用户设置文件有两套 app-data 根：Workbench 的配置文件与 Rust 缓存/持久化文件分离

- **日期**：2026-10-13（CUSTOM-20261013-005，排查 VAC 的 `vac.agents` / `vac.customModels` 修改不生效时发现）
- **现象**：Settings 的 “Edit in settings.json” 打开的文件含最新 `vac.*` 配置，但扩展通过 `workspace.getConfiguration()` 读取不到。Workbench 文件位于 `%APPDATA%\\dev.sidex.app\\UserData\\User\\settings.json`，Rust store 的文件却是 `%APPDATA%\\SideX\\UserData\\User\\settings.json`。
- **根因**：Tauri UserData provider 原先从 Tauri identifier 解析根目录；Rust `SettingsStore` 用 `app_dirs::app_data_dir()` 解析 SideX 根。Workbench 配置加载又优先读取 Rust user-layer 内存快照，所以直接编辑 Workbench 文件时读回的是旧副本。文件 watcher 也将 `vscode-userdata:` URI 原样当磁盘路径监视，且 watch batch 事件未回映射为原 URI。
- **解法**：统一 UserData provider 与 Rust 设置存储到 SideX app-data 根，默认文件采用 `%APPDATA%\\SideX\\User\\settings.json`；迁移旧数据时只复制目标缺失项、不覆盖、不删旧源。Workbench 配置始终从当前 profile 文件读取；Rust 单键更新保留其他 JSONC/扩展配置，settings_get 先刷新规范文件；watcher 映射真实路径并还原 scheme URI。
- **教训**：桌面移植项目里不要假定 Tauri identifier 数据目录等于手工定义的产品目录。配置编辑器、Rust 状态和扩展 API 读配置必须追到同一物理文件；迁移时优先保留用户实际编辑的 JSONC 文件，永远不要用不完整的缓存整个对象覆盖它。
- **验证**：迁移单测 4 项和 Rust settings 持久化单测 2 项通过；受影响 TS ESLint、Rust fmt、`npm run rust:check` 通过。VAC GUI 端到端仍待手工确认。

## 10. VAC 设置文件正确但 Node 扩展宿主读取默认值：Workbench 配置桥未接入且空 activationEvents 导致早激活

- **日期**：2026-10-13（CUSTOM-20261013-013，继续排查 VAC 1.1.0 的 `vac.agents` / `vac.customModels`）
- **现象**：`%APPDATA%\\SideX\\User\\settings.json` 确有 2 个 agent 与 8 个 custom model，VAC Agents 可出现 manifest 默认项，自定义模型却没出现在 picker。dev 日志只能看到 Rust 启动扩展宿主；Node stderr 由 Rust 以 debug 级别读取，Workbench `[ExtHost]` 日志在 DevTools，不进入 `SideX.log`。
- **根因**：VAC 作为带 `main` 的 Node 扩展运行于 SideX 自有 WebSocket host，而非标准 Workbench extension host。`host.cjs` 只读自己内存的 configuration Map 并初始化 manifest defaults；WorkBench 原先没有任何 `setConfiguration` 调用。VAC 的 `activationEvents: []` 还会让 Node host 在收到 websocket handshake 前就启动 `activate()`，所以仅 handshake 后发配置也有竞态。`server.cjs`→Node 转发 RPC 回复时也需保留 WebSocket client request id，才能使 Workbench 的 ACK request 正常完成。
- **解法**：活动的 `tauriExtensionHost.contribution.ts` 从 Workbench `IConfigurationService.keys()` + `getValue()` 生成有效快照，显式涵盖未注册的 VAC keys；通过现有 WebSocket request 同步并等待 ACK 后再释放 Node activation gate。配置变更完整快照串行替换，删除项回退 manifest default，重连先关 gate 再同步。Node host 分层保存 defaults、Workbench override 与扩展 runtime update，提供 section/nested/dotted 配置读取。新增快照计数日志，不记录设置值或 agent command/env。
- **教训**：独立 extension host 不会自动继承 Workbench 配置 API；应沿 UI Settings → Workbench configuration service → host transport → shim `workspace.getConfiguration()` 全链路核查。激活事件为空或 `*` 时需要在宿主进程侧提供配置就绪门闩，握手之后异步注入是不充分的。WS 转发请求要端到端保留请求 id；检查日志时确认 Rust log level 是否实际持久化 Node stderr。
- **验证**：Node 配置语义与真实子进程首次/重连激活时序单测 9 项通过；受影响 TS ESLint、前端 build、Rust check 通过；VAC GUI 端到端待在新的 dev 实例里手工确认。

## 11. VAC 侧边栏图标空白 / 树卡 loading / webview 永久 Loading：扩展视图链路的四处移植缺口

- **日期**：2026-10-15（CUSTOM-20261014-001 / CUSTOM-20261015-001 / CUSTOM-20261015-002）
- **现象**：VAC 扩展（`zouv.vscode-acp-client`）的活动栏图标空白；Agents 树先报 "There is no data provider registered..."、修掉后卡 "Loading sessions…"；Dashboard/Chat 两个 webview 永久显示 "Loading"。在真实 VSCode 里全部正常。
- **根因**（四个独立缺口，逐个踩）：
  1. **`IAccessibleViewInformationService` 未注册**：上游负责注册的 accessibility contribution 没移植，但 `TreeViewPane` 构造强制注入它 → 任何 `type:"tree"` 扩展视图构造抛 `TreeViewPane depends on UNKNOWN service accessibleViewInformationService`，整个容器打不开（侧边栏空白）。
  2. **`sidex-asset://` scheme 不通**：`network.ts` 的 `uriToBrowserUri` 在 Tauri 下把 `file://` 改写成自造的 `sidex-asset://localhost/<enc>`。从 dev origin（`http://localhost:1420`）发起的 `<img>`/`fetch` 请求在 webview 网络层就被拒绝（非 http(s) scheme），到不了 Rust 注册的协议处理器 → 图标空白。探针实测同一路径用 Tauri 官方 `https://asset.localhost/<enc>` 返回 200。
  3. **tree data provider 跨进程桥完全缺失**：VAC 用 `vscode.window.createTreeView` 注册树，宿主 `host.cjs` 存了 provider 但不暴露 `getChildren` RPC；前端 `tauriExtensionHost.contribution.ts` 建了空 `TreeView` 却从不给 `dataProvider` 赋值 → "no data provider"。补上桥之后仍卡 loading，因为 `_getOrCreateTreeView` 对 `contributes.views` 声明的 `existing.treeView` 分支没缓存进 `_treeViews`，`treeViewInvalidate → refresh()` 通知拿不到 TreeView 直接 return，树永远不重拉。
  4. **WebviewView 缺 `onDidDispose`**：host.cjs 的 webviewView 对象只有 `onDispose`（非 VSCode API 名），VAC 的 `resolveWebviewView` 调 `e.onDidDispose(...)` 直接抛 `e.onDidDispose is not a function`，导致后续 `setVisible/refresh/post` 全不执行 → dashboard/chat 永久 loading。该错误只在宿主 stderr，UI 完全静默。
- **解法**：见 registry `CUSTOM-20261014-001` / `CUSTOM-20261015-001` / `CUSTOM-20261015-002`。要点：在 ViewPane 创建前注册 accessibility 服务；`file://` 资源 URL 改走 Tauri 官方 asset 协议；宿主侧加 `getTreeChildren` RPC + `TreeItem` 序列化 + handle 反查表，前端造代理 `ITreeViewDataProvider` 喂给 `TreeView.dataProvider`，并缓存 `existing.treeView` 使 refresh 命中；补 `onDidDispose`（保留 `onDispose` 兼容）。
- **教训**：
  - **扩展视图是「前端 ViewPane 构造 + 宿主 provider 数据」两段，缺一段就静默**。排这类问题要在宿主侧给 `log()` 接文件落点（或 `SIDEX_EXT_HOST_LOG` 环境变量），并把 `uncaughtException`/`unhandledRejection` 也落进去——`resolveWebviewView` 的同步 throw 会被宿主 try/catch 吞掉并只写 stderr，UI 无任何提示。
  - **验证资源 URL 用「正对照探针」**：同文件同时测 `data:` URI（必通）、`https://asset.localhost`（官方协议）、目标 scheme，才能区分"探针机制坏了"还是"目标写法不通"，别拿 open-vsx.org 这种网络依赖当对照。
  - **前端 TreeView 的 dataProvider 是唯一数据入口**（`treeView.ts` 的 setter 才激活加载），只建空 TreeView 不装 provider 必然 "no data provider"；装了 provider 还要保证 `onDidChangeTreeData → refresh` 的通知能命中 TreeView 实例（缓存！）。
- **验证**：`getTreeChildren` RPC 实测根返回 2 顶层节点、展开返回 258 个 sessions；`onDidChangeTreeData → treeViewInvalidate` 后前端重拉成功；图标与 dashboard/chat 由用户 GUI 确认正常。

## 12. release 包看不到已装扩展：web 扩展「已安装」记录在 IndexedDB，而 IndexedDB 按 origin 隔离（dev ≠ release）

- **日期**：2026-10-15（CUSTOM-20261015-003，用户反馈最新 release 包看不到 Claude Code / VAC）
- **现象**：dev 里（或早前）装好的扩展，装上新的 release 包后扩展视图里消失，活动栏图标也不见；但 `%APPDATA%\SideX\extensions` 里扩展目录还在，Rust 后端也照样扫描并激活它们（扩展宿主正常）。
- **根因**：SideX 前端跑在 Web 模式，扩展「已安装」列表由 web 扩展扫描器（`WebExtensionsScannerService`）从 **IndexedDB** 读；扩展视图列表与 `contributes.viewsContainers`/`views`（活动栏图标、视图容器）都只认这份记录。而 IndexedDB 按 **origin** 隔离：dev 是 `http://localhost:1420`，release（`tauri.conf.json` `useHttpsScheme:true`）是 `https://tauri.localhost`。在 dev 安装只写进 dev origin 的 IndexedDB；release 打开时当前 origin 的 IndexedDB 是空的 → UI 无扩展，但 Rust 扫描的磁盘扩展与 Node 宿主不受影响（命令仍在，只是没有 UI 入口）。取证：`%LOCALAPPDATA%\dev.sidex.app\EBWebView\Default\IndexedDB\` 下 `http_localhost_1420.indexeddb.leveldb` 有数据、`https_tauri.localhost_0.indexeddb.leveldb` 为空。
- **解法**：新增 `CUSTOMIZATIONS/src/extension-sync/extensionSync.contribution.ts`：启动时读 Rust `list_installed_extensions`（磁盘真实安装），对当前 profile 尚未登记的扩展调用 web 扩展服务的 `installFromLocation` 幂等补登记（复用 VSIX 安装链路，CUSTOM-20261013-001），让 dev/release 双向一致。
- **教训**：排查「扩展在磁盘/宿主侧都在，但 UI 不显示」时，先分清两套系统——**磁盘扫描（Rust → Node 宿主，负责激活与视图内容）** 与 **IndexedDB（web 扩展扫描器，负责扩展列表与视图容器注册）**。后者按 origin 隔离，切 dev/release 会「换一份存储」。看 `%LOCALAPPDATA%\<identifier>\EBWebView\Default\IndexedDB\` 下的 `*_indexeddb.leveldb` 目录名即可一眼确认 origin。
- **验证**：ESLint / `npm run build` / check-registry 全绿；GUI 端到端待用户在 release 包复测。

## 13. 想让 About 显示 SideX 版本号时，**不能**改 `productConfiguration.version` —— 它同时是扩展 `engines.vscode` 兼容性基准

- **日期**：2026-10-15（CUSTOM-20261015-004，把 About 版本改成 `0.1.3-custom.4` 后 VAC 按钮无反应）
- **现象**：`src/main.ts` 把 `productConfiguration.version` 从 `'1.110.0'` 改成 `'0.1.3-custom.4'` 后，About 显示对了，但 dev 里点击左侧 VAC 按钮没反应、扩展视图失效。
- **根因**：`productService.version` 不只是给 About 显示用，还作为**扩展版本兼容性基准**参与校验：`webExtensionsScannerService.toScannedExtension` → `validateExtensionManifest(this.productService.version, ...)` → `isValidExtensionVersion` → `isVersionValid`。`0.1.3-custom.4` 不满足 VAC 的 `engines.vscode: ^1.85.0` 与 Claude Code 的 `^1.94.0`，于是 `isValid=false` → `extensionEnablementService` 判 `DisabledByInvalidExtension` → 视图/容器失效。
- **解法**：`productConfiguration.version` 保持 `'1.110.0'`；真实 SideX 版本号用 `@tauri-apps/api/app` 的 `getVersion()` 写入全局 `__SIDEX_VERSION__`，只在 About 详情（`dialog.ts` 的 `createBrowserAboutDialogDetails`）里优先取它。
- **教训**：SideX 是「VSCode 1.110.0 内核 + SideX 外壳」——凡是 VSCode 内部逻辑（扩展校验、API 版本、marketplace 平台判断）都会读 `productService.version`，它必须伪装成 VSCode 版本；只做 UI 展示的版本要放旁路，别污染这个字段。
- **验证**：ESLint / `npm run build` / check-registry 全绿；GUI 待用户确认 VAC 恢复、About 显示 `0.1.3-custom.4`。

## 14. 启动死锁：上次会话停在**扩展视图容器**时，工作台永远恢复不完 —— 扩展宿主不启动、插件栏空、点容器无反应（全程无报错）

- **日期**：2026-10-16（CUSTOM-20261016-001，排查「点 VAC 无反应 + 插件栏看不到插件」）
- **现象**：启动后活动栏/侧边栏能显示，但**点击扩展容器（VAC）无任何反应**，扩展视图（插件栏）为空；Rust 日志里**没有** `extension host started`（扩展宿主压根没启动）。**没有任何报错**，`console` 干净，devtools 也看不出问题。
- **根因（四步循环死锁）**：
  1. `Layout.restore()` 把「恢复侧边栏容器」放进 `layoutReadyPromises`（`layout.ts`，`await openViewContainer(...)`），而 `layoutReadyPromises` gate 住 `Layout.whenReady`；`workbench.ts` 里 `LifecyclePhase.Restored` 只在 `whenReady.finally(...)` 中设置。
  2. 上次会话停的是扩展容器（本例 `workbench.view.extension.vac-client`）。`paneCompositePart.ts` 的 `openPaneComposite()` 先查注册表：容器**尚未注册**（扩展还没被处理）→ 落到 `await extensionService.whenInstalledExtensionsRegistered()`。
  3. 该方法只是 `_installedExtensionsReady.wait()`——**它自己不触发初始化**；barrier 只由 `_initialize()` 打开。
  4. `_initialize()` 仅由 `browser/extensionService.ts` 在 **`LifecyclePhase.Restored` 之后**触发；而 `Restored` 又只能等 `whenReady`（被第 1 步阻塞）→ **闭环，永不完成**。
  - 链式后果：`Restored` 不触发 → `AfterRestored` 的 contribution 全部不构造 → 扩展宿主（`tauriExtensionHost`）与 `extensionSync` 都不跑 → 扩展视图空、点容器无反应。
  - **为什么以前正常**：只有当"上次会话的侧边栏停在某个**尚未注册的扩展容器**"时才会踩到；内置容器（资源管理器等）在注册表里，第一查即命中，直接返回。
- **解法**：`abstractExtensionService.ts` 的 `whenInstalledExtensionsRegistered()` 在 `wait()` 前加 `void this._initializeIfNeeded();`。调用方既然已经在等扩展注册，就顺手启动初始化。这与上游自己在 `_activateByEvent(ActivationKind.Immediate)` 的注释一致（"some callers come in so early that the extension hosts have not even been created yet … kick off the extension host creation, but without awaiting it"）。
- **教训**：
  1. **"无报错但功能全哑"优先怀疑 pending promise 死锁**，而不是异常。判断方法：把启动阶段打点出来——VSCode 各阶段都有 `performance.mark('code/...')`，`performance.getEntriesByType('mark')` 一句就能看出**跑到哪一步停的**（本例停在 `code/didRestoreEditors`，缺 `code/LifecyclePhase/Restored` 与 `code/willLoadExtensions`）。
  2. **前端 `ILogService` 不进 `SideX.log`**（只进 devtools console），release 更是零日志。webview 里想落盘只能走 `invoke('plugin:log|log', { level: 3, message })`（dev 构建注册了该插件；见 #6）。配合 `window.addEventListener('error'|'unhandledrejection')` 与 `console.error` 劫持，可把前端故障接到同一份日志。
  3. **"恢复上次 UI 状态"是启动路径上的隐藏入口**：持久化的容器/视图会把"扩展未就绪"变成"启动卡死"。排查启动问题时，先把 `views.containerToRestore.*` 打出来。
  4. 判断"扩展宿主起没起"最直接的办法是看有没有 node 进程跑 `server.cjs`（`Get-CimInstance Win32_Process` 查 CommandLine），而不是看 UI。
- **验证**：见 registry `CUSTOM-20261016-001`（marks 链路补全、活动栏项 6→7、`pane-header` 0→3）。

## 15. 编辑器标签/资源管理器拖不动：`tauri.conf.json` 的 `dragDropEnabled: true` 在 Windows 下吞掉**所有** HTML5 拖拽

- **日期**：2026-10-17（CUSTOM-20261017-001，用户反馈「编辑区 Editor Tab 不支持拖拽」）
- **现象**：编辑器标签拖不动（资源管理器、视图重排同理）；**没有任何报错**。DOM 上 `draggable="true"` 在（`multiEditorTabsControl.ts`）、`DragAndDropObserver`（`base/browser/dom.ts`）、`editorDropTarget.ts` 也都在，代码看着完全正常——所以第一反应容易怀疑"移植时把 DnD 删了"，其实不是。
- **根因**：`dragDropEnabled: true`（Tauri 默认值）时，wry 在窗口 HWND 上 `RevokeDragDrop` + `RegisterDragDrop` 换成自己的 `IDropTarget`，而它**只处理 `CF_HDROP`**（`wry/src/webview2/drag_drop.rs` 的 `iterate_filenames`）。页内 HTML5 拖拽在 Windows 上也走 OLE 投递到同一个 drop target → `DragEnter` 拿不到 HDROP → `enter_is_valid = false` → 回调都不发就 `DROPEFFECT_NONE`，拖拽在中途就死了。Tauri 官方文档原文（`tauri-utils-2.8.3/src/config.rs:1668`）：*"Whether the drag and drop is enabled or not on the webview. By default it is enabled. **Disabling it is required to use HTML5 drag and drop on the frontend on Windows.**"*
- **解法**（CUSTOM-20261017-001）：`src-tauri/tauri.conf.json` 的 `dragDropEnabled` 改 `false`；原本靠 Tauri `onDragDropEvent` 的两个功能改用 HTML5 `drop`（`CUSTOMIZATIONS/src/vsix-install/vsixInstall.contribution.ts`，捕获阶段 + 只接管 `.vsix`/`.code-workspace`，其余放行给 workbench）：
  - `.vsix`：优先用真实路径（`File.path` / `text/uri-list`）直接安装；拿不到才 `file.arrayBuffer()` → `invoke('write_file_bytes', { path: 临时文件, content: Array.from(bytes) })` → 走既有安装命令
  - `.code-workspace`：**默认不拦截**，交给 workbench 走 VSCode 的区域语义（标签栏=开文件 / 编辑区=开 workspace，见 #18）；只有拿不到真实路径时才由自定义模块兜底
- **教训**：
  1. Windows + Tauri 下"拖拽不管用"，**先看 `dragDropEnabled`**，别去翻前端 DnD 代码。
  2. "关掉原生拖放"不等于失去 OS 文件拖入：HTML5 `drop` 的 `dataTransfer.files` 能拿到 `File`（拿不到路径，但**能拿到内容**）——需要路径的功能要重新设计，比如上面的"写临时文件"。
  3. 该开关影响的是一整个窗口，没有 per-element 的折中方案；想同时要"页内 DnD"和"原生文件拖入带路径"，只能二选一。
- **验证**：见 registry `CUSTOM-20261017-001`；GUI 拖拽由用户确认。

## 16. 扩展更新后点它新增的菜单报 `command '…' not found`：宿主把已激活扩展的代码钉死在 `require` 缓存里

- **日期**：2026-10-17（CUSTOM-20261017-002，用户反馈 VAC 编辑区标签栏按钮报错）
- **现象**：VAC 1.3.0 新增「编辑区标签栏图标（Open VAC Chat）」，按钮正常渲染出来，点下去报 `command 'vac.openChatFromEditorTab' not found`；同一个 VAC 的其它功能全正常。
- **实证手法（值得复用）**：扩展宿主是个**独立 Node 进程 + 本机 WS 服务**，且 `server.cjs` 的 `upgrade` **不校验 token**。直接 `GET http://127.0.0.1:<端口>/` 拿 `connectionToken/pid/extensionCount`，再连 `ws://127.0.0.1:<端口>/` 发 `{id:1,type:'getExtensionState'}`，就能读到宿主**当前真实注册的命令表**（注意：握手会 `beginConfigurationSync` 关掉激活门闩，探完记得补 `releaseExtensionActivation`）。本例读到 22 个 `vac.*`，全是 1.2.x 的，唯独缺新命令 → 一眼定性。
- **根因**：`host.cjs` 的 `_handleLoadExtension()` 对已激活扩展直接 `alreadyActive: true` 早退，`_loadExtensionModule()` 又走 `require()` 缓存 → 应用运行期间磁盘上把扩展更新了（覆盖 `dist/extension.js` + `package.json`）后，**宿主进程继续跑旧代码**；而 Workbench 侧读到的是新 `package.json`，按新 manifest 渲染菜单 → 两边不一致。SideX 的扩展宿主是**应用级**进程（不像 VSCode 那样随窗口 reload 重建），所以**重载窗口也救不回来**，只能重启应用。
- **解法**（CUSTOM-20261017-002）：
  1. `host.cjs` 给每个扩展算「代码指纹」`_extensionStamp()`：package.json + main 入口 + 入口**同目录** js 产物的 `mtime+size`。**刻意不递归**整个扩展目录——`.storage`/`.global-storage` 是扩展自己反复写的，递归会把它们当"代码变了"，每次激活都重载。
  2. `_activateExtension()` / `_handleLoadExtension()` 入口发现指纹变了就 `_reloadExtension()`：dispose 旧订阅 → 尽力 `deactivate()` → 撤销该扩展注册过的命令（`commands.registerCommand` 时用 `_currentActivatingExtension` 记账）并广播 `commandUnregistered` → 清 `require.cache` 里该扩展目录下的模块 → 标记未激活，随后正常重新 activate（Workbench 每次握手都会对每个扩展调 `activateExtension`，这是天然检查点）。
  3. 前端 `tauriExtensionHost.contribution.ts` 新增 `commandUnregistered` 处理：撤掉对应的命令桥（否则菜单还引用它，点下去会在宿主与桥之间来回转发）。撤掉后行为与 VSCode 一致：未注册的命令 → `command '…' not found`。
- **教训**：
  1. `require.cache` + `alreadyActive` 早退是"扩展热更新"的经典坑；只要宿主是长生命周期进程，就必须有"磁盘变了 → 重载"这一环。
  2. 只对**代码**做指纹，别把扩展的可写数据目录算进去（否则每次都重载）。
  3. ESM（`import()`）无法从模块缓存驱逐，只有 CJS 能真正重载（VAC 是 CJS）。
- **验证**：见 registry `CUSTOM-20261017-002`；GUI 更新 VAC 后重载窗口/重启确认按钮可用。

## 17. 扩展的目录/文件选择框「选了但没反应」：对话框结果回包形状写错，回传链整条是断的

- **日期**：2026-10-17（CUSTOM-20261017-003，用户反馈 VAC 换工作目录不生效）
- **现象**：VAC 里点「选择目录」→ 系统目录对话框正常弹出、选完点确定 → VAC 的工作目录**没变**（同样操作在 VSCode 里正常）。没有任何报错。
- **根因（三处叠加，缺一不可）**：
  1. **回包形状错**：`_onShowOpenDialog`/`_onShowSaveDialog` 用 `this._send({ id: reqId, result })` 回包（`tauriExtensionHost.contribution.ts`）。而 `server.cjs` 的 `_handleTextMessage()` 对**没有 `type`** 的客户端包只会 `_forwardToExtHost()` 转给 Node 宿主；宿主 `handleMessage()` 落到 `default` 分支返回 `unknown method: undefined`（再经 `sidex:host-reply` 回到前端，落在 `_handleMessage` 里没人处理）→ 宿主侧 `_pendingRequests` 的 promise **永远不 resolve**，120s 后超时 `resolve(undefined)`。扩展拿到的就是 `undefined`。
     - 正确形状：`{ id: this._nextId(), type: 'messageResponse', params: { requestId, value } }`——同一文件里 `showQuickPick` / `showInputBox` / `showMessageRequest` 都是这个形状，唯独两个对话框漏了。
  2. **value 必须是 `Uri` 对象**：扩展侧普遍写 `picked?.[0]?.fsPath`，回传 URI **字符串**会得到 `undefined`。现在前端回传 `fsPath` 字符串，宿主用 `VscUri.file()` 包成 Uri。
  3. **`defaultUri` 是对象不是字符串**：宿主发来的 `defaultUri` 是 UriComponents（JSON 对象），原代码 `URI.parse(options.defaultUri.toString())` 得到 `"[object Object]"`；要用 `URI.revive()`。
- **教训**：
  1. 这套桥有**两个方向**的消息，形状不同：客户端发起 → `{id, type, params}` 且宿主用 `{id, result}` 回；**宿主发起**（`emit('event', {type, id})`）→ Workbench 必须用 `messageResponse` 回，宿主才认。
  2. 排查"扩展拿到的值是空"时，先确认宿主侧 promise 到底 resolve 了没有（本例是超时兜底 `undefined`，看起来像"扩展自己的问题"）。
  3. 顺带补上 `filters`/`defaultUri` 透传，`showOpenDialog`/`showSaveDialog` 的过滤器与默认路径才和 VSCode 一致。
- **验证**：见 registry `CUSTOM-20261017-003`；GUI 由用户确认「选目录后 VAC 工作目录跟着变」。

## 18. 关掉 Tauri 原生拖放之后：OS 文件拖入**拿不到真实路径**，且 `.code-workspace` 有自己的区域语义

- **日期**：2026-10-17（CUSTOM-20261017-005，用户反馈 `.code-workspace` 拖入的行为和报错都不对）
- **现象**：① 把 `.code-workspace` 拖到**标签栏**/拖到**编辑区**，都没有 VSCode 的语义（VSCode：标签栏=当普通文件打开、编辑区=按 workspace 打开）；② 弹出 `Dropped 'aki_editor.code-workspace' is not a readable workspace file: Expected double-quoted property name in JSON at position 746`。
- **根因（三层，前两层是这次的坑，第三层是背景）**：
  1. **自己写的 HTML5 drop 处理器把 workbench 挡在了外面**。CUSTOM-20261017-001 为了拖 `.vsix` 装了捕获阶段监听 + `stopPropagation`，顺手把 `.code-workspace` 也接管了——而 VSCode 的「区域语义」正是 `ResourcesDropHandler` 实现的：`MultiEditorTabsControl.onDrop()` 的外部分支用 `{ allowWorkspaceOpen: false }`（→ 当文件开），编辑区那条链路用 `{ allowWorkspaceOpen: true }`（→ 当 workspace 开）。接管了它，语义就没了。
  2. **`.code-workspace` 是 JSONC 不是 JSON**：允许注释与尾逗号，`JSON.parse` 必然抛（本例第 37 行）。要读内容必须用 `vs/base/common/json.ts` 的 `parse()` + `vs/base/common/jsonErrorMessages.js` 的 `getParseErrorMessage()`。
  3. **HTML5 drop 里没有磁盘路径**：`File.path` 是 Electron 私有能力（WebView2 恒为 `undefined`），`getPathForFile()` 也只在 Electron 里有效。于是 OS 文件拖入原本只能走 web 的退路：`extractFileListData()` 把内容读出来塞进一个 **untitled 副本**。
- **解法**：
  - **恢复真实路径**：`extractEditorsDropData()` 增加 `text/uri-list` 来源（`extractFileUrisFromDragEvent()`，只认 `file:` URI）。Windows 的 Chromium/WebView2 拖入 OS 文件时通常会带这份列表，解析出来就是磁盘路径 → ordinary file 打开真文件、文件夹/`.code-workspace` 在编辑区按 workspace 打开、在标签栏按文件打开，**与 VSCode 桌面版一致**。同时在 `extractEditorsAndFilesDropData()` 里「已拿到真实路径就跳过读内容退路」，否则一次拖入会开出两份。
  - **`.vsix` 仍由自定义模块接管**（workbench 不认识这种拖入）：优先用真实路径（按文件名配对）直接安装，拿不到才落临时副本。
  - **`.code-workspace` 兜底**（拿不到真实路径时）：标签栏放行（让 workbench 按未命名副本打开）；编辑区由自定义模块用 JSONC 解析器读内容——folders **全绝对** → 直接开多根工作区（零交互）；**含相对路径** → 弹通知 + 「Locate File…」，让用户重新定位该 `.code-workspace` 文件（文件对话框拿真实路径），再以 `workspaceUri` 打开，settings/相对 folders 全部由平台还原（**不要**自己拿 folders 拼近似工作区）。**编辑区必须拦截**——否则平台会拿 untitled 副本当 `workspaceUri` 去 `openWindow`，窗口会带着一个 `untitled:` 的非法工作区重载。
  - **实测结论（2026-10-17，`[drop-diag]` 日志）**：资源管理器 → WebView2 的 OS 拖入，`dataTransfer.types` 只有 `[Files]`、`files[].path` 恒 `undef`、`text/uri-list` **恒空**（8 次拖入无一例外）。所以**不要指望 HTML5 drop 能拿到 OS 文件路径**：普通文件只能得到内容（未命名副本），`.code-workspace` 相对路径只能让用户重新定位。
  - **为什么 VSCode 能兼顾**：Electron 是 Chromium 单栈，OS 拖入由 Chromium 自己转成 DOM drop，路径由 Electron 的 `webUtils.getPathForFile` 在渲染层打补丁；Tauri 在 Windows 上要拿路径就必须让 wry 抢占窗口唯一的 OLE drop target（`RevokeDragDrop` + 只认 `CF_HDROP`），页内 HTML5 拖拽同时走 OLE，于是被一起掐死。WebView2 的「两者都要」API（`ICoreWebView2CompositionController` 的 DragEnter/Drop）只在 composition hosting 下存在，wry 0.54 未使用——这是**上游能力边界**，不是本仓库能配置出来的。
- **教训**：
  1. **在捕获阶段 `stopPropagation` 之前先想清楚"谁本来该处理它"**：这次是把 workbench 自带的、与 VSCode 行为一一对应的处理链路挡掉了，症状看起来像"功能没实现"，其实是"被自己挡住了"。
  2. **`.code-workspace` / `settings.json` / `tsconfig.json` 一律按 JSONC 处理**，用仓库里的 `parse()`，别用 `JSON.parse`。
  3. 想确认"webview 里到底有什么事件/数据"时，**别指望日志文件**：`console.*` 与 `ILogService` 都不进 `SideX.log`（见 #6/#14），要么开 devtools，要么 `invoke('plugin:log|log', { level: 3, message })`。
  4. 「拖拽进来的文件有没有真实路径」是这类问题的分水岭：有路径 = 一切按磁盘资源处理；没路径 = 只能读到内容。判断方法就是看 `dataTransfer.getData('text/uri-list')`。
- **验证**：见 registry CUSTOM-20261017-005；GUI 由用户确认 `.code-workspace` 两种区域语义、以及 ordinary file 拖入是"真文件"还是"未命名副本"。

## 19. 拖入文件一打开就带「未保存」标记：未命名副本的初始内容被上游当成脏

- **日期**：2026-10-17（CUSTOM-20261017-006，用户反馈「拖拽文件到标签栏打开后文件会变成脏状态」）
- **现象**：从资源管理器把任意文件拖到标签栏/编辑区，标签正常打开（标题是文件名），但立刻带未保存圆点；文件内容看起来也对。
- **根因**：OS 拖入拿不到磁盘路径（见 #18 的实测结论），平台只能走 web 退路 `extractFileListData()`：读出内容 → 以 `untitled:` 副本打开。而 VSCode 的未命名模型规定 **带初始内容即脏**（`untitledTextEditorModel.ts` 构造 + `resolve()`：`dirty = hasAssociatedFilePath || !!initialValue`）——这条规则对「用户新建/粘贴的未命名文件」是对的，对「拖入文件的快照」就是误报。
- **解法**（CUSTOM-20261017-006）：新增 `initialDirtyState?: boolean` 贯穿 `IBaseTextResourceEditorInput` → `TextEditorService` → `INewUntitledTextEditorOptions` → `UntitledTextEditorModel`（构造 + `resolve()`）；`extractFileListData()` 的快照显式传 `false`。语义是「**初始内容只作基线**」：标签干净，用户真正编辑后 `onModelContentChanged` 照常标脏；从 backup 恢复出来的内容仍标脏。未传该选项的调用方行为与上游一致。
- **教训**：
  1. 「打开后是脏的」先看内容是怎么来的：**带 `contents` 打开**的编辑器天然是脏的（上游如此），要区分「这是用户未保存的编辑」还是「这只是某个已存在文件的快照」。
  2. 改这类基础模型时，**保持默认行为不变、只给需要的调用方加显式选项**，能避免影响扩展/其它入口（它们继续按上游语义标脏）。
- **验证**：见 registry CUSTOM-20261017-006；GUI 由用户确认拖入文件无脏标记、编辑后出现。

## 20. web 版 `openWindow([{folderUri}…])` 打开多个目录时只剩最后一个：`BrowserHostService` 是**逐个**导航

- **日期**：2026-10-17（CUSTOM-20261017-007，排查「拖入 `.code-workspace` 只打开了一个目录」）
- **现象**：`.code-workspace` 里配了 4 个 folders（全绝对路径），拖进编辑区后侧边栏只出现 1 个根。
- **根因**：`IHostService.openWindow([{folderUri:A},{folderUri:B},…])` 在 **web 实现**里是逐个处理的——`src/vs/workbench/services/host/browser/browserHostService.ts` 的 `doOpenWindow()` 对每个 folder openable 调用一次 `doOpen()`；而 SideX 的 `workspaceProvider.open` 是「`location.href` 导航当前窗口」，于是同一个窗口被连续导航，**只有最后一个目录生效**。（桌面版 VSCode 里 `openWindow` 由 Electron 主进程处理整个数组，会合成多根工作区，所以桌面没有这个问题。）
- **解法**（CUSTOM-20261017-007）：需要多根时**不要传多个 folderUri**，改按 `workspaceUri` 打开：
  - 有真实 `.code-workspace` 路径 → `openWindow([{ workspaceUri }])`（平台解析 folders/settings）。
  - 拿不到路径（OS 拖入）→ 把内容原样写到稳定路径的临时 workspace（`<user-data>/workspaces/dropped-<内容哈希>/<文件名>`），再按 `workspaceUri` 打开。
  - 顺带：`workspaceEditingService.createAndEnterWorkspace(folders)` 在 web 里会生成 `untitledWorkspacesHome` 下的 workspace 文件、再经 `openWindow([{workspaceUri}])` 导航；要用它，`main.ts` 的 `?workspace=` 参数还得放行 `vscode-userdata:` 等非 file scheme（当前只放行 file / vscode-remote / vscode-vfs）。
- **教训**：**web 版 host 服务的"打开窗口"语义和桌面版不同**——桌面能一次开多个 openable，web 只能导航当前窗口。凡是依赖 `openWindow([...多个])` 的功能（多根、多文件夹拖入）在 SideX 里都要按"单个 workspaceUri/文件夹"重新设计。
- **验证**：见 registry CUSTOM-20261017-007。
