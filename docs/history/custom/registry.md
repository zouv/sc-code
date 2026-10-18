---
current_upstream_version: 'v0.1.3-dev'
current_upstream_commit: 'ad978652682270a593e7029269beff5411477a70'
custom_version: 'v0.1.3-custom.6'
last_merge_date: '2026-10-12'
last_release_version: 'v0.1.3-custom.6'
last_release_date: '2026-10-17'
vendor_branch: 'vendor/main'
upstream_remote: 'https://github.com/Sidenai/sidex.git'
---

# SideX 自定义改动登记

> **本文件是改动登记账本（纯数据）**。机制与规则（冲突策略、标记格式、类型/状态字典、frontmatter 字段职责）见 [`CUSTOMIZATIONS/README.md`](./README.md)。
>
> **两层结构（怎么用）**：
>
> - **改动总览（按文件）**——查"某个文件现在改了什么、上游合并时怎么处理"：**只读这一节**，每个文件一条，多轮演进已合并为当前状态，无需读历史轮次。
> - **变更日志（按次）**——查"某次改动何时发生、为什么、怎么验证"：按时间倒序的 append-only 流水，只增不改（历史是事实）。
>
> **AI Agent 注意**：
>
> 1. 开发前读**改动总览**定位相关文件与冲突策略（不必通读变更日志）
> 2. 完成改动后调用 `sidex-record-change` skill：**总览里已有该文件就更新那一节**（合并描述、追加演进链 id），没有就新增一节；变更日志追加一轮记录
> 3. 合并上游时按总览的冲突策略列处理
> 4. 不要删除历史（总览条目整体废弃时标 deprecated，变更日志永不删改）
> 5. 一致性自检：`sh CUSTOMIZATIONS/scripts/check-registry.sh`（代码标记 ↔ 总览表双向比对）
6. 总览表「文件」列**不要加反引号或任何装饰**，直接写仓库根相对路径（脚本不剥离反引号，会把 `` `path` `` 当成不存在的文件报 `FILE-NOT-FOUND`）；多文件用「、」聚合在一行

---

## 仓库信息

- **上游仓库**：https://github.com/Sidenai/sidex
- **当前基于上游版本**：{{current_upstream_version}}
- **当前基于上游 Commit**：{{current_upstream_commit}}
- **当前 Vendor 分支**：{{vendor_branch}}
- **最近一次上游合并**：{{last_merge_date}}
- **最近一次发布版本**：{{last_release_version}} ({{last_release_date}})

---

## 改动总览（按文件）

> **每个文件一条**：该文件当前生效的全部自定义改动（多轮演进已合并）；「标记」列为代码中 `[CUSTOM-BEGIN]` 的 change-id（即该文件自定义区的当前真相），演进链标注历轮 id。代码位置速查见 [`architecture.md`](./architecture.md) §1。
>
> **状态字典**：`active`（生效中）/ `deprecated`（已废弃）/ `merged-upstream`（上游已原生支持）。**冲突策略**字典见 README.md。

| 文件 | 标记（当前） | 演进链 | 当前效果（合并后） | 冲突策略 | 状态 |
| ---- | ------------ | ------ | ------------------ | -------- | ---- |
| src-tauri/Cargo.toml、Cargo.lock | CUSTOM-20261012-002（Cargo.toml） | 002 | Cargo package 与 lockfile 版本改为 custom 版本号 `0.1.3-custom.3`（每次发布由 `sidex-release` 递增）；workspace 根的 `[workspace.package] version` 不动 | merge-manual | active |
| package.json、package-lock.json、src-tauri/tauri.conf.json | 无标记（JSON 不支持注释） | 002 → 004 → 017-001 | 版本号与 Cargo.toml 同步（三处必须一致）；`tauri.conf.json` 另加 `bundle.windows.wix.version` 纯数字版本——MSI/WiX 要求纯数字，custom 序号 N 放在第 4 位（当前应用 `0.1.3-custom.3` / wix `0.1.3.3`）。**004 追加**：`scripts` 里新增 `dev:custom` / `build:custom` 两个快捷命令（`cross-env AWS_LC_SYS_PREBUILT_NASM=1 npm run tauri dev|build`）。**017-001 追加**：`app.windows[0].dragDropEnabled` 由 `true` 改 `false`——Windows 下 Tauri 原生拖放接管（wry 在窗口 HWND 上 `RegisterDragDrop` 且只认 `CF_HDROP`）会吞掉 webview 内**全部** HTML5 拖拽，导致编辑器标签/资源管理器/视图重排都拖不动（详见 pitfalls #15；代价是 Tauri `onDragDropEvent` 不再触发，`.vsix`/`.code-workspace` 拖入改由 HTML5 接管） | merge-manual | active |
| CUSTOMIZATIONS/scripts/（dev.bat、build.bat、build-release.bat、release.js） | 无标记（纯自定义路径） | 004 → 005 → 016-002 | 快捷启动 / 打包脚本：自动切到仓库根、校验 node_modules、CRLF + `chcp 65001`；`build.bat` 先打印四处版本号再打包并列出产物；`build-release.bat`/`release.js` 只打包（打印当前版本号核对 + `build:custom` + 列产物，**不修改任何版本号**，版本号由人工按四处分清单同步） | keep-ours | active |
| src/main.ts | CUSTOM-20261013-001、CUSTOM-20261013-004、CUSTOM-20261014-001、CUSTOM-20261015-003、CUSTOM-20261015-004 | 001 → 004 → 014-001 → 015-003 → 015-004 | 顶部静态导入自定义前端模块（001：VSIX 安装；014-001：补注册 `IAccessibleViewInformationService`，供 `type:"tree"` 扩展视图构造；015-003：启动时把磁盘扩展同步进当前 profile 的 web 扩展管理）；支持 `folder` / `workspace` URL 参数初始化工作区，provider 在文件夹与 `.code-workspace` 间切换时清理旧参数并重载，保持单文件夹启动兼容；015-004：Tauri `getVersion()` 结果写入全局 `__SIDEX_VERSION__` 供 About 显示（`productConfiguration.version` 保持 `1.110.0` 供扩展兼容性校验） | merge-manual | active |
| CUSTOMIZATIONS/src/vsix-install/vsixInstall.contribution.ts | 无标记（纯自定义路径） | 001 → 004 → 017-001 → 017-005 → 017-007 | 从本地 VSIX 安装扩展：命令 `sidex.extensions.installFromVSIX`（命令面板 + 扩展视图标题「...」菜单 + 资源管理器右键 `.vsix` + 拖拽 `.vsix` 进窗口）→ Tauri `install_extension` 解压落盘 → 直接调 web 扩展服务 `installFromLocation(安装目录)`。**004 追加**：Tauri 原生拖放监听同时识别 `.code-workspace` 并调用 `IHostService.openWindow({ workspaceUri })`。**017-001 追加**：`dragDropEnabled` 改 `false` 后 Tauri `onDragDropEvent` 不再触发，拖放改为 **HTML5 `drop`**（捕获阶段，只接管 `.vsix`，其余放行给 workbench 自身的 DnD 处理）。**017-005 追加**：`.vsix` 优先用真实路径（`File.path` / `text/uri-list`，按文件名配对）直接安装，配不上才落临时副本（装完删）；`.code-workspace` 默认**不拦截**（交给 workbench：标签栏=开文件、编辑区=开 workspace，与 VSCode 一致），仅当拿不到真实路径时兜底——标签栏仍放行（未命名副本），编辑区由本模块解析 JSONC（`vs/base/common/json.ts` 的 `parse`，`JSON.parse` 会因注释/尾逗号报 "Expected double-quoted property name"）：**017-007 修正**：folders 全为绝对路径时**不再** `openWindow(folders)`（web 版 `BrowserHostService.doOpenWindow()` 对多个 folderUri 是逐个导航，同一窗口反复重载 → 只剩最后一个目录，见 pitfalls #20），改为把拖入内容**原样写成一份稳定路径的临时 `.code-workspace`**（`<user-data>/workspaces/dropped-<内容哈希>/<原文件名>`，同内容复用）再按 `workspaceUri` 打开——多根、settings、窗口标题都保留；含相对路径则弹通知 + 「Locate File…」让用户重新定位该 `.code-workspace` 文件（文件对话框能拿到真实路径）→ 用 `workspaceUri` 打开。两种情况都由平台完整解析，避免平台把未命名副本当 `workspaceUri` 重载窗口。另：`.code-workspace` 拖入时写一条 `[drop-diag]` 日志（`invoke('plugin:log|log')`，dev 才有输出），记录 `types`/`files`/`uri-list`/落点，便于定位「这次为什么没拿到路径」 | keep-ours | active |
| src/vs/platform/extensionResourceLoader/browser/extensionResourceLoaderService.ts | CUSTOM-20261013-002 | 002 | `readExtensionResource()` 开头加 Tauri 分支：`file://` 直接走 `IFileService.readFile`，跳过 `FileAccess.uriToBrowserUri` 的浏览器 URI 改写（改写结果既非预期 scheme、也非磁盘文件，会让"读磁盘扩展的 package.json"必然失败，从 VSIX 安装时踩到） | merge-manual | active |
| src-tauri/src/app_dirs.rs | CUSTOM-20261013-010 | 010 | Workbench user-data 根从旧 Tauri `UserData` 迁移到 SideX app-data 根；只复制目标缺失的数据、不覆盖已有文件、不删除旧文件。旧 settings 先验证 JSONC、以原文原子迁移并保留来源 | merge-manual | active |
| src-tauri/src/commands/os.rs | CUSTOM-20261013-008 | 008 | `get_user_data_dir` 复用 `app_dirs::app_data_dir()`；启动迁移旧 Workbench `UserData` 数据到 SideX 根，并优先使用旧 Workbench `User/settings.json`，缺失时回退旧 Rust settings 文件 | merge-manual | active |
| src-tauri/src/lib.rs | CUSTOM-20261013-009 | 009 | 在启动初始化消费者前迁移旧 Workbench user data；Rust `SettingsStore` 默认用户设置路径统一到 `<app-data>/User/settings.json` | merge-manual | active |
| src-tauri/src/commands/settings.rs | CUSTOM-20261013-011 | 011 | `settings_get` 前从规范用户设置文件刷新；user-scope 更新仅修改请求键并保留未知键/JSONC 注释，不再序列化整个 user layer 覆盖文件 | merge-manual | active |
| src/vs/platform/configuration/common/configurationModels.ts | CUSTOM-20261013-005 | 005 | 用户配置模型始终从当前 profile 的 `userSettingsResource` 读取，不再优先采用与 profile 无关的 Rust 内存快照 | merge-manual | active |
| src/vs/platform/files/browser/tauriFileSystemProvider.ts | CUSTOM-20261013-007 | 007 | watch batch 按 watch id 分派事件；保留每个监视资源的 URI 映射器，支持 user-data scheme 事件还原 | merge-manual | active |
| src/vs/platform/files/browser/tauriUserDataProvider.ts | CUSTOM-20261013-006 | 006 | Tauri `vscode-userdata:` watcher 监视 URI 映射后的磁盘路径，并把事件路径还原为原 user-data URI，触发配置重载 | merge-manual | active |
| src/vs/workbench/services/configuration/browser/configurationService.ts | CUSTOM-20261013-012 | 012 | 配置变更只将默认 profile 本地 user scope、workspace scope 同步到 Rust；命名 profile、remote profile 和删除设置不会误写默认 Rust user layer | merge-manual | active |
| src/vs/workbench/contrib/extensions/browser/tauriExtensionHost.contribution.ts | CUSTOM-20261013-013、CUSTOM-20261015-002、CUSTOM-20261017-002、CUSTOM-20261017-003 | 013 → 015-002 → 017-002 → 017-003 | 013：将 Workbench `IConfigurationService` 当前有效配置完整快照通过 Node WS 同步给独立扩展宿主；等待配置 ACK 并释放激活门闩后再激活，配置变更 debounce/串行全量替换、重连重发；VAC 键即便未在 Workbench schema 注册也纳入快照。**015-002 追加**：实现 tree data provider 跨进程桥——宿主侧 `getTreeChildren` RPC 结果经代理 `ITreeViewDataProvider` 喂给前端 `TreeView.dataProvider`；`createTreeView`/`registerTreeDataProvider` 时给 TreeView 装代理 provider，`treeViewInvalidate` 事件触发 `treeView.refresh()`；`_getOrCreateTreeView` 缓存 `existing.treeView` 使 refresh 通知能命中。**017-002 追加**：新增 `commandUnregistered` 事件处理，宿主重载扩展时撤掉旧版本已不存在的命令桥（否则菜单点击会在宿主与桥之间来回转发）。**017-003 追加**：修复扩展对话框回传链——`_onShowOpenDialog`/`_onShowSaveDialog` 的回包由 `{id, result}` 改为宿主认得的 `messageResponse` 形状（原形状被 server.cjs 当普通客户端包转发、宿主落 `unknown method` 分支，宿主侧 promise 永不 resolve，120s 超时返回 undefined），value 传 `fsPath` 由宿主包成 Uri（扩展侧写 `picked?.[0]?.fsPath`），`defaultUri` 由 `URI.parse(obj.toString())`（得到 `[object Object]`）改为 `URI.revive()`，并透传 `filters` | merge-manual | active |
| src-tauri/extension-host/（host.cjs、server.cjs、configuration.cjs、configuration.test.cjs） | CUSTOM-20261013-013（host.cjs、server.cjs）、CUSTOM-20261015-002（host.cjs）、CUSTOM-20261017-002（host.cjs）、CUSTOM-20261017-003（host.cjs） | 013 → 015-002 → 017-002 → 017-003 | Node host 区分 manifest defaults / Workbench 快照 / 扩展 runtime update；拦截所有扩展激活直至 Workbench 设置确认，完整替换时删除值回退默认并触发配置事件；支持 VAC section/nested/dotted key 查询；增加配置与激活时序测试。**015-002 追加**：tree data provider 跨进程桥宿主侧——`getTreeChildren` RPC handler 调扩展 provider 的 `getChildren`，把 `TreeItem` 序列化（iconPath/resourceUri/command/themeIcon/checkbox）+ handle 反查表，订阅 `onDidChangeTreeData` 转发 `treeViewInvalidate`；补 WebviewView 的 `onDidDispose`（VSCode 正确 API 名，此前只有 `onDispose`）。**017-002 追加**：扩展代码磁盘指纹与热重载——`_extensionStamp()` 取 package.json + main 入口 + 入口同目录 js 产物的 `mtime+size`（**不递归**整个扩展目录，避免 `.storage`/`.global-storage` 的自身写入被误判为代码变化）；`_activateExtension()`/`_handleLoadExtension()` 发现指纹变化即 `_reloadExtension()`（dispose 旧订阅 → `deactivate()` → 撤销该扩展注册的命令并广播 `commandUnregistered` → 清 `require.cache` 中该扩展目录下的模块 → 标记未激活后重新 activate），修复"应用运行期间更新扩展后宿主仍跑旧代码、点新菜单报 command not found"。**017-003 追加**：`showOpenDialog`/`showSaveDialog` 的宿主侧 promise 改为把 Workbench 回传的**路径字符串**包成 `VscUri.file()`（扩展侧读 `picked?.[0]?.fsPath`，直接给字符串会得到 undefined） | merge-manual | active |
| src/vs/platform/editor/common/editor.ts | CUSTOM-20261017-006 | 017-006 | `IBaseTextResourceEditorInput` 增加 `initialDirtyState?: boolean`：用 `contents` 打开的编辑器默认仍按上游视为未保存（`true`）；拖入文件快照等「内容只是基线」的场景传 `false`，标签以干净状态打开 | merge-manual | active |
| src/vs/workbench/services/untitled/common/（untitledTextEditorService.ts、untitledTextEditorModel.ts） | CUSTOM-20261017-006 | 017-006 | `INewUntitledTextEditorOptions` 新增 `initialDirtyState`，一路透传到 `UntitledTextEditorModel`：构造与 `resolve()` 里 `dirty` 的初值改为 `initialDirtyState ?? (hasAssociatedFilePath \|\| !!initialValue)`（从 backup 恢复出来的内容仍标脏）；未传时行为与上游完全一致 | merge-manual | active |
| src/vs/workbench/services/textfile/common/textEditorService.ts | CUSTOM-20261017-006 | 017-006 | `createTextEditor()` 的 untitled 分支把输入上的 `initialDirtyState` 透传给 `untitledTextEditorService.create()`（配合 dnd/editor.ts 的改动，让拖入文件的副本以干净状态打开） | merge-manual | active |
| src/vs/platform/dnd/browser/dnd.ts | CUSTOM-20261017-005、CUSTOM-20261017-006 | 017-005 → 017-006 | `extractEditorsDropData()` 增加基于 `text/uri-list` 的真实路径来源（`extractFileUrisFromDragEvent()`，只认 `file:` URI）：SideX 关掉 Tauri 原生拖放后，OS 文件拖入时 `getPathForFile()`（Electron `webUtils`）恒为空，只剩「读内容造未命名副本」一条 web 退路；补上真实路径后 ordinary file / 文件夹 / `.code-workspace` 的拖入都按**磁盘资源**处理（编辑区=按 workspace 打开、标签栏=按文件打开，与 VSCode 桌面版一致）。`extractEditorsAndFilesDropData()` 在已拿到真实路径时**跳过** web 的读内容退路，避免同一次拖入开出「真文件 + 未命名副本」两份。**017-006 追加**：`extractFileListData()` 产出的「拖入文件快照」带上 `initialDirtyState: false` 并透传给编辑器输入——副本以**干净状态**打开，只有用户真正编辑后才标脏（否则拖入任意文件一打开就带「未保存」标记，见 pitfalls #19） | merge-manual | active |
| src/vs/base/common/network.ts | CUSTOM-20261015-001 | 015-001 | `uriToBrowserUri` 的 Tauri 分支：`file://` 资源 URL 由自造的 `sidex-asset://localhost/<enc>` 改为 Tauri 官方 asset 协议 `https://asset.localhost/<enc>`（`useHttpsScheme:true`）。原 scheme 从 dev origin 发起的请求被 webview 网络层拒绝，活动栏扩展图标空白；asset 协议 scope 已含 `$HOME/**` | merge-manual | active |
| src/vs/workbench/services/extensions/common/abstractExtensionService.ts | CUSTOM-20261016-001 | 016-001 | `whenInstalledExtensionsRegistered()` 在等待 barrier 前追加 `void this._initializeIfNeeded()`：上游只在 `LifecyclePhase.Restored` 后初始化扩展服务，而 restore 阶段打开扩展视图容器（如 VAC）会走到本方法并死等一个只能由 `_initialize()` 打开的 barrier，形成启动死锁（详见 pitfalls #14） | merge-manual | active |
| src/vs/workbench/browser/parts/dialogs/dialog.ts | CUSTOM-20261015-004 | 015-004 | `createBrowserAboutDialogDetails` 的版本行优先取全局 `__SIDEX_VERSION__`（由 `main.ts` 用 Tauri `getVersion()` 写入），否则回退 `productService.version`——About 对话框显示 SideX 版本号，同时 `productConfiguration.version` 保持 `1.110.0` 不被破坏扩展兼容性 | merge-manual | active |
| CUSTOMIZATIONS/src/accessibility/accessibleViewInformationService.contribution.ts | 无标记（纯自定义路径） | 014-001 | 补注册 `IAccessibleViewInformationService`（`Delayed`，与上游一致）：上游负责注册的 accessibility contribution 未移植，导致 `type:"tree"` 的扩展视图构造抛 "TreeViewPane depends on UNKNOWN service accessibleViewInformationService"，侧边栏容器打不开 | keep-ours | active |
| CUSTOMIZATIONS/src/extension-sync/extensionSync.contribution.ts | 无标记（纯自定义路径） | 015-003 | 启动时（AfterRestored）读 Rust `list_installed_extensions`，把当前 profile 尚未登记的磁盘扩展经 web 扩展服务的 `installFromLocation` 幂等补登记——修复 dev（`http://localhost:1420`）与 release（`https://tauri.localhost`）IndexedDB origin 隔离导致"release 包里看不到已装扩展" | keep-ours | active |

---

## 变更日志（按次，时间倒序 append-only）

### CUSTOM-20261017-007 —— 修复拖入 `.code-workspace` 后「只打开了一个目录」

- **日期**：2026-10-17
- **类型**：fix
- **改动**：
  - **现象**：把配置了多个 folders 的 `.code-workspace` 拖进编辑区，侧边栏只出现一个目录（用户提供 `Dev_k.可视化编辑.code-workspace`：4 个 folders，实际只挂载了 1 个）。
  - **根因**：无路径兜底原先走 `IHostService.openWindow([{folderUri}…])`（4 个 folder）。但 **web 版** `BrowserHostService.doOpenWindow()` 对每个 folder openable 都是单独 `doOpen()`（`src/vs/workbench/services/host/browser/browserHostService.ts`），而 SideX 的 workspace provider 是「导航当前窗口」（`?folder=…`）——同一个窗口被连续导航，最后只有最后一个目录生效。（桌面版 VSCode 由 Electron 主进程处理同一数组，会合成多根工作区，所以桌面没有此问题。）
  - **改动**（`CUSTOMIZATIONS/src/vsix-install/vsixInstall.contribution.ts`）：folders 全绝对时，把拖入的文件内容**原样**写到 `<user-data>/workspaces/dropped-<内容哈希>/<原文件名>`（`get_user_data_dir` + `mkdir` + `write_file`；同内容复用同一路径，workspace 身份稳定），再 `openWindow([{ workspaceUri }])` → 平台按文件完整解析 folders/settings → 多根 + 设置 + 标题全部正确。含相对路径仍走「Locate File…」。
- **验证**：ESLint 无告警；`tsc --noEmit` 相关文件无错误；`npm run build` 通过（产物含 `dropped-` 逻辑）；GUI 待用户确认拖入后 4 个根都在。
- **基于上游版本**：main@ad978652（v0.1.3-dev）

### CUSTOM-20261017-006 —— 修复「拖入文件打开后立刻是脏状态」

- **日期**：2026-10-17
- **类型**：fix
- **改动**：
  - **现象**：把文件拖到编辑器标签栏/编辑区后，打开的标签立刻带「未保存」圆点（用户反馈为 bug）。
  - **根因**：资源管理器拖入在 WebView2 里拿不到磁盘路径（CUSTOM-20261017-005 的实测结论），平台只能走 web 退路：`extractFileListData()` 读出内容 → 以 `untitled:` 副本打开。而 VSCode 的未命名模型规定**带初始内容即脏**（`untitledTextEditorModel.ts`：`this.dirty = this.hasAssociatedFilePath || !!this.initialValue`）——对「拖入文件的快照」来说这是误报：内容只是原文件的基线，用户还没改过任何东西。
  - **改动**：新增 `initialDirtyState?: boolean` 选项并贯穿整条链——`IBaseTextResourceEditorInput`（`src/vs/platform/editor/common/editor.ts`）→ `TextEditorService.createTextEditor()` → `INewUntitledTextEditorOptions` → `UntitledTextEditorService.doCreate()` → `UntitledTextEditorModel` 的构造与 `resolve()`；`extractFileListData()` 产出的拖入快照显式传 `false`。语义：**初始内容不算未保存修改**，用户真正编辑后 `onModelContentChanged` 仍会正常标脏；从 backup 恢复出来的内容也仍标脏。未传该选项处行为与上游完全一致。
- **验证**：ESLint 无告警；`tsc --noEmit` 相关文件无错误（全仓仅 `sidexChat` 5 处既有错误）；`npm run build` 通过；GUI 待用户确认拖入文件打开后无脏标记、编辑后才出现。
- **基于上游版本**：main@ad978652（v0.1.3-dev）

### CUSTOM-20261017-005 —— 修复 `.code-workspace` 拖入语义：恢复 VSCode 的「标签栏=开文件 / 编辑区=开工作区」，并补上 OS 文件拖入的真实路径

- **日期**：2026-10-17
- **类型**：fix
- **改动**：
  - **现象（用户反馈）**：把 `.code-workspace` 拖进来时，标签栏与编辑区都没有按 VSCode 的语义走；且弹出报错 `Dropped 'aki_editor.code-workspace' is not a readable workspace file: Expected double-quoted property name in JSON at position 746`。
  - **根因（两层）**：
    1. CUSTOM-20261017-001 引入的 HTML5 drop 处理器**无条件接管**所有 `.code-workspace`（捕获阶段 + `stopPropagation`），把 workbench 自己的 `ResourcesDropHandler` 挡在外面——而 VSCode 的区域语义恰恰由它实现（标签栏处 `allowWorkspaceOpen: false` → 按文件打开；编辑区 `allowWorkspaceOpen: true` → 按 workspace 打开）。
    2. `.code-workspace` 是 **JSONC**（允许注释/尾逗号），旧代码用 `JSON.parse` → 直接抛（aki_editor 那份 workspace 第 37 行有注释/尾逗号）。
  - **改动**：
    - `src/vs/platform/dnd/browser/dnd.ts`（新标记 CUSTOM-20261017-005）：`extractEditorsDropData()` 增加 `text/uri-list` 路径来源 `extractFileUrisFromDragEvent()`（只认 `file:` URI，刻意不读 VSCode 私有的 `application/vnd.code.uri-list`）；`extractEditorsAndFilesDropData()` 在已拿到真实路径时跳过 web 的「读内容造未命名副本」退路（否则一次拖入会开出真文件 + 未命名副本两份）。
    - `CUSTOMIZATIONS/src/vsix-install/vsixInstall.contribution.ts`：`.vsix` 优先用真实路径按文件名配对后直接安装，配不上才落临时副本；`.code-workspace` 默认不拦截（交给 workbench 走 VSCode 语义），仅在**拿不到真实路径**且落点在编辑区时兜底：用 VSCode 的 JSONC 解析器（`vs/base/common/json.ts` `parse` + `jsonErrorMessages`）读内容，按 folders 的绝对路径开多根工作区（相对路径明确提示）——同时避免平台把未命名副本当 `workspaceUri` 去重载窗口（那会进入 `untitled:` 非法工作区）。
  - **追加（同日）**：`[drop-diag]` 实测（资源管理器 → SideX，8 次拖入，含普通文件与两份 `.code-workspace`）：**`text/uri-list` 恒为空**、`File.path` 恒为 `undef`、`types` 只有 `[Files]`。即「OS 拖入拿真实路径」这条路在 WebView2 里根本不存在；之前偶发成功是那些 workspace 的 folders 全为绝对路径、走了兜底。
  - 因此兜底定型：folders **全绝对** → 直接 `openWindow` 多根工作区（零交互）；**含相对路径** → 通知 + 「Locate File…」按钮让用户重新定位该 `.code-workspace` 文件（`IFileDialogService`，过滤 `*.code-workspace`），拿到真实 URI 后以 `workspaceUri` 打开——settings/相对 folders/多根结构全部由平台还原，与 VSCode 桌面版一致。**不再**用「选目录 + `path.join` 拼 folders」的近似做法。
  - 诊断日志保留：每次带文件的拖入写一条 `[drop-diag]`（原始 `invoke('plugin:log|log', { level: 3, message })`，只 dev 构建落盘），含 `types` / `files[].path` / `text/uri-list` / 落点 / `realPaths`。
  - **已知能力边界（非本仓库可修）**：Windows 上 wry 的 `dragDropEnabled:true` 会 `RevokeDragDrop`+`RegisterDragDrop` 抢占 WebView2 的 OLE drop target（且只认 `CF_HDROP`），页内 HTML5 拖拽随之全哑；而 `dragDropEnabled:false` 时 WebView2 不向页面暴露任何路径。WebView2 的「宿主既能观察拖拽、又放行页内拖拽」的 API 只存在于 **composition hosting**（`ICoreWebView2CompositionController` 的 DragEnter/Drop），wry 0.54 未使用该模式。VSCode 是 Electron（Chromium 单栈 + `webUtils.getPathForFile` 打补丁）所以无此冲突。真要零交互同时兼顾，只能改 wry/Tauri 或等上游支持。
  - **后续（暂缓，单独议题）**：这是一个影响面较大的底层设计问题——`wry` 在 Windows 上以「独占 OLE drop target」换取路径，与页内 HTML5 拖拽不可兼得；已查上游 wry 0.57.0（2026-09-08）/ Tauri 3.0 alpha 的 changelog，**均未修复**（0.55 只是把拖放 handler 去掉 feature gate）。可选方向：① 向上游提 issue/PR（对非 `CF_HDROP` 数据放行 / 提供 composition 模式）；② vendored wry 切 composition hosting（成本高、升级冲突大）。当前决定：**保持 HTML5 拖拽优先 + 无路径时保真兜底**，后续再评估。
  - **调试手段**：中途加过一个临时诊断模块 `CUSTOMIZATIONS/src/dnd-diag/`（挂 `main.ts`，标记 017-004）想记录拖拽事件流，但发现 webview 的 `console.*`/`ILogService` 都**不会**进 `SideX.log`（只有 `invoke('plugin:log|log')` 那条路，见 pitfalls #6/#14），定位完已删除。
- **验证**：受影响 TS 文件 ESLint 无告警；`tsc --noEmit` 中相关文件无错误（全仓仅 `sidexChat` 5 处既有错误）；`npm run build` 通过；GUI 待用户确认两种区域语义与 ordinary file 拖入。
- **基于上游版本**：main@ad978652（v0.1.3-dev）

### CUSTOM-20261017-003 —— 修复扩展对话框（选择目录/文件）结果回传链：回包形状错误导致宿主 promise 永不 resolve

- **日期**：2026-10-17
- **类型**：fix
- **改动**：
  - **现象**：VAC 里点「选择目录」→ 系统目录对话框正常弹出、选完确定 → VAC 的工作目录不变（同一操作在 VSCode 里正常）；无任何报错。
  - **根因（三处叠加）**：① `_onShowOpenDialog`/`_onShowSaveDialog` 用 `this._send({ id: reqId, result })` 回包，而 server.cjs 对**没有 `type`** 的客户端包只会 `_forwardToExtHost()` 转给 Node 宿主，宿主 `handleMessage()` 落到 `default` 分支返回 `unknown method: undefined` → 宿主侧 `_pendingRequests` 的 promise 永不 resolve，120s 后超时 `resolve(undefined)`；② 即便送达，回传 URI **字符串**也不对——扩展侧写 `picked?.[0]?.fsPath`（要 Uri 对象）；③ `defaultUri` 是宿主发来的 UriComponents 对象，`URI.parse(options.defaultUri.toString())` 得到 `"[object Object]"`。
  - **改动**：`tauriExtensionHost.contribution.ts` 两个对话框改用 `{ id: this._nextId(), type: 'messageResponse', params: { requestId, value } }`（与同文件 showQuickPick/showInputBox 一致），value 传 `fsPath` 字符串并透传 `filters`，`defaultUri` 改 `URI.revive()`（新增 `_incomingUri()` / `_incomingFilters()` 两个小工具）；`src-tauri/extension-host/host.cjs` 的 `showOpenDialog`/`showSaveDialog` shim 把回传路径用 `VscUri.file()` 包成 Uri 对象。
- **验证**：受影响两文件 ESLint 无告警；全量 `tsc --noEmit` 中这两个文件无错误（仅 `sidexChat` 有 5 处既有错误）；`node --check host.cjs` 通过；GUI 待用户确认「选目录后 VAC 工作目录跟着变」。
- **基于上游版本**：main@ad978652（v0.1.3-dev）

### CUSTOM-20261017-002 —— 扩展代码变化时宿主自动重载：修复「更新扩展后点它新增的菜单报 command not found」

- **日期**：2026-10-17
- **类型**：fix
- **改动**：
  - **现象**：VAC 1.3.0 新增「编辑区标签栏图标（Open VAC Chat）」，按钮渲染出来但点下去报 `command 'vac.openChatFromEditorTab' not found`；VAC 其它功能正常。
  - **实证**：直连本机扩展宿主 WS（`GET http://127.0.0.1:<port>/` 拿端口/token → `ws://` 发 `{type:'getExtensionState'}`）读到的宿主命令表只有 22 个 `vac.*`（1.2.x 的），缺 1.3.0 新增的那个 → 判定为「宿主跑旧代码、Workbench 按新 manifest 渲染菜单」。注意握手会关激活门闩，探完要补 `releaseExtensionActivation`。
  - **根因**：`_handleLoadExtension()` 对已激活扩展直接 `alreadyActive: true` 早退 + `_loadExtensionModule()` 走 `require()` 缓存 → 应用运行期间磁盘上更新扩展后宿主仍跑旧代码；SideX 的扩展宿主是**应用级**进程（不像 VSCode 随窗口 reload 重建），所以重载窗口也救不回来。
  - **改动**：`host.cjs` 新增 `_extensionStamp()`（package.json + main 入口 + 入口同目录 js 产物 mtime+size；**不递归**整个扩展目录，避免 `.storage`/`.global-storage` 自身写入被误判）、`_extensionChanged()`、`_evictRequireCache()`、`_reloadExtension()`、`_trackExtensionCommand()`；`_activateExtension()`/`_handleLoadExtension()` 入口发现指纹变化即重载（撤销该扩展命令并广播 `commandUnregistered` → 清 require 缓存 → 重新 activate）；前端 `tauriExtensionHost.contribution.ts` 新增 `commandUnregistered` 处理，撤掉对应命令桥。
- **验证**：`node --check host.cjs` 通过；受影响 TS 文件 ESLint 无告警、`tsc --noEmit` 无错误；GUI 待用户确认（更新 VAC 后重载窗口/重启，编辑区标签栏按钮可用）。
- **基于上游版本**：main@ad978652（v0.1.3-dev）

### CUSTOM-20261017-001 —— 开启编辑器标签拖拽：关闭 Tauri 原生拖放接管，`.vsix`/`.code-workspace` 拖入改用 HTML5

- **日期**：2026-10-17
- **类型**：feat + fix
- **改动**：
  - **现象**：编辑区 Editor Tab 拖不动（资源管理器/视图重排同理），无任何报错；前端 DnD 代码（`multiEditorTabsControl.ts`、`DragAndDropObserver`、`editorDropTarget.ts`）齐全。
  - **根因**：`tauri.conf.json` 的 `dragDropEnabled: true`（Tauri 默认）下，wry 在窗口 HWND 上 `RevokeDragDrop` + `RegisterDragDrop` 换成自己的 `IDropTarget`，且只处理 `CF_HDROP`；页内 HTML5 拖拽在 Windows 也走 OLE 投到同一 drop target → `DragEnter` 拿不到 HDROP 即 `DROPEFFECT_NONE`。Tauri 官方文档明说：*Disabling it is required to use HTML5 drag and drop on the frontend on Windows*（`tauri-utils-2.8.3/src/config.rs:1668`）。
  - **改动**：`src-tauri/tauri.conf.json` 的 `app.windows[0].dragDropEnabled` 改 `false`（JSON 不能注释 → 本条即标记）；`CUSTOMIZATIONS/src/vsix-install/vsixInstall.contribution.ts` 把原来依赖 Tauri `onDragDropEvent` 的拖放改为 **HTML5 `drop`**（`mainWindow` 捕获阶段，只接管 `.vsix`/`.code-workspace`，其余文件放行给 workbench 自身的 DnD）：`.vsix` 读 `file.arrayBuffer()` → `invoke('write_file_bytes', { path: 临时文件, content: Array.from(bytes) })` → 走既有安装命令；`.code-workspace` 解析 `folders` 后仅当全为绝对路径时打开多根工作区，否则提示改用菜单（HTML5 拿不到原文件路径，相对路径无法还原）。
- **验证**：ESLint / `tsc --noEmit`（两文件无错误）/ `node --check host.cjs` / `sh CUSTOMIZATIONS/scripts/check-registry.sh`；**GUI 待用户确认**：编辑区标签可拖动、拖 .vsix 进窗口仍能安装。
- **基于上游版本**：main@ad978652（v0.1.3-dev）

### CUSTOM-20261016-002 —— release 脚本改名 build-release 并去掉自动递增版本号

- **日期**：2026-10-16
- **类型**：chore（开发体验）
- **改动**：`release.bat` 改名为 `build-release.bat`；`release.js` 去掉「版本号四处同步/自动递增」逻辑，改为**只打包**：打印当前版本号核对（四处不一致时告警，但不修改）→ `npm run build:custom` → 列出 `target/release/bundle/` 产物。版本号改由人工按 `docs/commands.md` §4 的四处清单同步。原因：自动递增容易在不经意间抬号（此前一次误触发就把 custom.4→custom.5→…→custom.7），release 打包脚本应只负责构建，版本号是发布决策的一部分，交给人工。
- **验证**：`node --check release.js` 通过；`build-release.bat` 已归一化为 CRLF；`npm run build:custom` 真实打包（见本轮产物）；`sh CUSTOMIZATIONS/scripts/check-registry.sh` 全绿。
- **基于上游版本**：main@ad978652（v0.1.3-dev）

### CUSTOM-20261016-001 —— 修复启动死锁：扩展视图容器停止恢复导致扩展宿主永不启动

- **日期**：2026-10-16
- **类型**：fix
- **改动**：
  - **现象**：`npm run dev:custom` 启动后，点击左侧活动栏的 VAC 容器无反应，扩展视图（插件栏）为空；Rust 侧无 `extension host started`，即**扩展宿主根本没启动**。
  - **根因（四步循环死锁）**：
    1. 工作台 restore 阶段要恢复上次会话的侧边栏容器，本例为 `workbench.view.extension.vac-client`（扩展容器）→ `Layout` 在 `layoutReadyPromises` 里 `await openViewContainer(...)`，该 promise 又 gate 住 `Layout.whenReady`。
    2. `paneCompositePart.ts` 的 `openPaneComposite()`：容器此刻**尚未注册** → `await extensionService.whenInstalledExtensionsRegistered()`。
    3. 该方法只是 `_installedExtensionsReady.wait()`（**不会触发初始化**），而 barrier 只由 `_initialize()` 打开。
    4. `_initialize()` 仅由 `browser/extensionService.ts` 在 `LifecyclePhase.Restored` 后触发，而 `Restored` 又只在 `Layout.whenReady` 完成后设置 → 回到第 1 步，**闭环，永不完成**。
  - **后果**：`Restored` 永不触发 → `AfterRestored` 的所有 contribution 都不构造 → 扩展宿主（`tauriExtensionHost`）与扩展同步（`extensionSync`）都不运行 → 扩展视图全空、点扩展容器无反应。全程**无任何报错**（是 pending promise，不是异常），因此极难定位。
  - **解法**：`abstractExtensionService.ts` 的 `whenInstalledExtensionsRegistered()` 在 `wait()` 前追加 `void this._initializeIfNeeded()`——既然调用方已在等扩展注册，就顺手启动初始化。与上游 `_activateByEvent(ActivationKind.Immediate)` 的既有取舍一致（上游注释亦说明"某些调用方来得很早，先踢一脚扩展宿主创建但不等待"）。初始化后 `viewsContainers`/`views` 扩展点被处理 → 容器注册 → `openPaneComposite` 第二次检查命中 → 正常打开 → restore 完成 → `Restored` → 扩展宿主与 ExtSync 正常启动。
- **验证**：在 `index.html` / `main.ts` / `layout.ts` 插入临时探针（`invoke('plugin:log|log')` 转发 + `performance.getEntriesByType('mark')` 读启动阶段标记）取证，验证后已全部移除。关键证据：
  - 修复前：marks 停在 `code/didRestoreEditors`，缺 `code/willRestoreViewlet` 的配对项与 `code/LifecyclePhase/Restored`；无 `code/willLoadExtensions`。
  - 修复后：marks 出现完整链路 `code/willLoadExtensions` → `code/willHandleExtensionPoint/viewsContainers` → `code/didLoadExtensions` → `code/didRestoreViewlet` → `code/LifecyclePhase/Restored` → `code/willCreateWorkbenchContributions/3`（含 `sidex.extensionSync`）。
  - DOM 快照：活动栏项 6 → **7**（VAC 容器注册）、`pane-header` 0 → **3**（VAC 的 dashboard/sessions/chat 三个视图渲染）。
  - 受影响 TS 文件 ESLint 通过；`sh CUSTOMIZATIONS/scripts/check-registry.sh` 全绿。
  - 注：排障中曾一度把 `tauriExtensionHost` 从 `AfterRestored` 提到 `BlockRestore` 试图解锁，确认根因后已回退，保持最小 diff。
- **基于上游版本**：main@ad978652（v0.1.3-dev）

### CUSTOM-20261015-005 —— 新增 release 打包脚本（版本号四处同步 + 打包）

- **日期**：2026-10-16
- **类型**：chore（开发体验）
- **改动**：新增 `CUSTOMIZATIONS/scripts/release.js`（ESM）与 `release.bat`（纯自定义路径）。`release.js` 把版本号四处同步（`package.json`、`tauri.conf.json` 的 `version` 与 `bundle.windows.wix.version`、`src-tauri/Cargo.toml` 的 `[package] version`）到目标版本——未显式传入时自动把 `custom.N` 递增 1，wix 同步成纯数字 `0.1.3.N`——然后跑 `npm run build:custom` 并列出 `target/release/bundle/` 产物；只改 `[package]` 段的 version，不动根 `Cargo.toml` 的 `[workspace.package]`。`release.bat` 是 CRLF + `chcp 65001` 的双击包装（切根、校验 node_modules、pause）。**踩坑修复**：仓库 `package.json` 是 `type: module`，`.js` 必须写 ESM（初版 CommonJS 直接 `require is not defined`）；Windows 下 `spawnSync('npm.cmd')` 要 `shell: true`（否则 `EINVAL`）；Cargo.toml 版本替换要用正则 `.test()` 判断匹配而非 `replace` 前后是否相等（同版本重跑是幂等场景）。
- **验证**：临时副本验证 bump 逻辑（四处正确、依赖 version 未误改、wix 派生正确）；自动递增/非法版本拒绝单测通过；`sh CUSTOMIZATIONS/scripts/check-registry.sh` 全绿。**真实打包跑通**：`node CUSTOMIZATIONS/scripts/release.js 0.1.3-custom.5` → `Finished 2 bundles at:`，产出 `SideX_0.1.3-custom.5_x64_en-US.msi`（17.4 MB）与 `SideX_0.1.3-custom.5_x64-setup.exe`（13.0 MB）。
- **基于上游版本**：main@ad978652（v0.1.3-dev）

### CUSTOM-20261015-004 —— Help → About 显示 SideX 版本号

- **日期**：2026-10-15
- **类型**：fix
- **改动**：Help → About 对话框此前显示 `productService.version`，而它来自 `src/main.ts` 硬编码的 `productConfiguration.version = '1.110.0'`。**注意该字段不能直接改成 `0.1.3-custom.N`**：它还参与扩展 `engines.vscode` 兼容性校验（`webExtensionsScannerService → validateExtensionManifest → isValidExtensionVersion`），改成 `0.1.3-custom.4` 后 VAC（`^1.85.0`）、Claude Code（`^1.94.0`）都会被判 `DisabledByInvalidExtension`、视图全失效（本次 VAC 按钮无反应的根因）。最终做法：`src/main.ts` 用 `@tauri-apps/api/app` 的 `getVersion()` 把真实版本写入全局 `__SIDEX_VERSION__`，`src/vs/workbench/browser/parts/dialogs/dialog.ts` 的 `createBrowserAboutDialogDetails` 优先取它；`productConfiguration.version` 保持 `1.110.0`。
- **验证**：`npx eslint` 对 `src/main.ts`、`dialog.ts` 无告警；`npm run build` 通过；GUI 待用户确认 About 显示 `0.1.3-custom.4` 且 VAC/Claude Code 视图恢复。
- **基于上游版本**：main@ad978652（v0.1.3-dev）

### CUSTOM-20261015-003 —— 启动时把磁盘扩展同步进当前 profile（修复 release 看不到已装扩展）

- **日期**：2026-10-15
- **类型**：fix
- **改动**：
  - **现象**：最新 release 包（v0.1.3-custom.4）打开后，扩展视图看不到之前装好的 Claude Code、VAC；但磁盘 `%APPDATA%\SideX\extensions` 里两份扩展都在，Rust 后端也能扫描并激活它们。
  - **根因**：前端跑在 Web 模式，扩展「已安装」记录由 web 扩展扫描器写入 IndexedDB，而 IndexedDB 按 origin 隔离——dev 是 `http://localhost:1420`，release（`useHttpsScheme:true`）是 `https://tauri.localhost`。扩展在 dev 里安装只写进 dev origin 的 IndexedDB；release 打开时当前 origin 的 IndexedDB 是空的，于是扩展视图列表、活动栏图标/视图容器（`contributes.viewsContainers`/`views`）都不注册，Rust 侧虽照常激活但无 UI 入口。实测 `%LOCALAPPDATA%\dev.sidex.app\EBWebView\Default\IndexedDB` 下 `http_localhost_1420.indexeddb.leveldb` 有数据、`https_tauri.localhost_0.indexeddb.leveldb` 为空。
  - **解法**：新增纯自定义模块 `CUSTOMIZATIONS/src/extension-sync/extensionSync.contribution.ts`（挂载于 `src/main.ts`）：启动时读 Rust `list_installed_extensions`（磁盘真实安装），对当前 profile 尚未登记的扩展调用 web 扩展服务的 `installFromLocation` 幂等补登记——复用 VSIX 安装链路（CUSTOM-20261013-001），使 dev/release 双向切换一致，也覆盖未来在任一 origin 安装的情况。
- **验证**：`npx eslint` 对新增模块与 `src/main.ts` 无告警；`npm run build` 通过；`sh CUSTOMIZATIONS/scripts/check-registry.sh` 全绿；GUI 端到端待用户在 release 包复测。
- **基于上游版本**：main@ad978652（v0.1.3-dev）

### CUSTOM-20261015-002 —— 实现扩展 TreeView data provider 跨进程桥 + 补 WebviewView onDidDispose

- **日期**：2026-10-15
- **类型**：fix
- **改动**：
  - **背景**：VAC 扩展侧边栏三个视图（vac-dashboard=webview、vac-sessions=tree、vac-chat=webview）此前 tree 视图报 "There is no data provider registered..."，webview 视图永久 loading。
  - **tree 桥接（宿主 + 前端）**：VAC 用 `vscode.window.createTreeView` 注册树，但 tree data provider 的跨进程链路此前完全缺失——宿主存了 provider 却不暴露 `getChildren` RPC，前端建了空 `TreeView` 却不装 dataProvider。宿主侧新增 `getTreeChildren` handler：调扩展 `provider.getChildren(element)`，把返回的 `TreeItem` 序列化（label/description/collapsibleState/contextValue/tooltip/iconPath/resourceUri/command/themeIcon/checkbox）+ handle 反查表，订阅 `onDidChangeTreeData` 转发 `treeViewInvalidate`。前端侧 `_createRemoteTreeDataProvider` 造代理 provider，`getChildren` 转 `_request('getTreeChildren')`，`_onCreateTreeView`/`_onRegisterTreeDataProvider` 时给 `TreeView.dataProvider` 赋值。
  - **refresh 通知失效修复**：`_getOrCreateTreeView` 在 `existing?.treeView`（`contributes.views` 声明的视图）路径没把 treeView 缓存进 `this._treeViews`，导致 `_onTreeViewInvalidate` 用 `_treeViews.get()` 拿不到、`refresh()` 从没执行，树卡在 "Loading sessions…"。已补缓存。
  - **webview onDidDispose**：host.cjs 的 WebviewView 对象只有 `onDispose`，缺 VSCode 正确 API 名 `onDidDispose`；VAC 的 `resolveWebviewView` 调 `e.onDidDispose` 直接抛 "is not a function"，导致 `setVisible/refresh/post` 全不执行、dashboard/chat 永久 loading。已补 `onDidDispose`（保留 `onDispose` 兼容）。
- **验证**：宿主侧 `node --check` 通过；受影响 TS 文件 ESLint 通过；`npm run build` 通过；`sidex-ext-host.log` 实测 `getTreeChildren(vac-sessions, element=root)` 返回 2 顶层节点、展开后返回 258 个 sessions；`onDidChangeTreeData → treeViewInvalidate` 后前端重新拉取成功；GUI 由用户确认（Agents 显示连接、dashboard 不再 Loading）。
- **基于上游版本**：main@ad978652（v0.1.3-dev）

### CUSTOM-20261015-001 —— 修复活动栏扩展图标空白（file:// 资源 URL 改写）

- **日期**：2026-10-15
- **类型**：fix
- **改动**：`src/vs/base/common/network.ts` 的 `uriToBrowserUri` Tauri 分支，把 `file://` 资源 URL 由自造的 `sidex-asset://localhost/<encodeURIComponent(fsPath)>` 改为 Tauri 官方 asset 协议 `https://asset.localhost/<enc>`。实测（Image/fetch 探针）原 scheme 从 dev origin（`http://localhost:1420`）发起的请求被 webview 网络层直接拒绝（请求到不了 `src-tauri/src/lib.rs` 注册的协议处理器），而 `https://asset.localhost/<enc>`（`useHttpsScheme:true`、assetProtocol scope 含 `$HOME/**`）返回 200 且图标正常。`lib.rs` 的 `sidex-asset` 处理器已无调用者但保留未删。
- **验证**：ESLint / `npm run build` 通过；GUI 由用户确认图标已显示。
- **基于上游版本**：main@ad978652（v0.1.3-dev）

### CUSTOM-20261014-001 —— 补注册 IAccessibleViewInformationService（移植缺口）

- **日期**：2026-10-14
- **类型**：fix
- **改动**：新增 `CUSTOMIZATIONS/src/accessibility/accessibleViewInformationService.contribution.ts`（纯自定义模块，挂载于 `src/main.ts`）：`registerSingleton(IAccessibleViewInformationService, AccessibleViewInformationService, InstantiationType.Delayed)`。上游负责注册的 accessibility contribution 未移植，但 `TreeViewPane` 构造要求注入该服务，任何 `type:"tree"` 的扩展视图都会在构造时抛 "TreeViewPane depends on UNKNOWN service accessibleViewInformationService"，导致侧边栏容器打不开（VAC、Claude Code 的 tree 视图容器均受影响）。必须在任何 ViewPane 创建前注册。
- **验证**：ESLint / `npm run build` 通过；GUI 由用户确认 VAC 面板能出内容。
- **基于上游版本**：main@ad978652（v0.1.3-dev）

### CUSTOM-20261013-013 —— 修复独立 Node 扩展宿主读取 Workbench 配置

- **日期**：2026-10-13
- **类型**：fix
- **改动**：Workbench 将当前有效配置快照经独立扩展宿主 WebSocket 传给 Node host；配置快照 ACK 前门闩阻止自动、事件及显式扩展激活；配置变更与重连执行串行全量同步。Node host 分层处理 manifest defaults、Workbench 配置与扩展 runtime update，支持完整替换删除、变更事件、nested/dotted `getConfiguration()` 查询，并提供不含配置敏感值的快照计数日志。
- **验证**：Node host 配置与实际子进程激活时序测试 9 项通过；受影响 TS ESLint、Node syntax check、`npm run build`、`AWS_LC_SYS_PREBUILT_NASM=1 npm run rust:check`、`sh CUSTOMIZATIONS/scripts/check-registry.sh` 通过；VAC GUI 验收已由用户确认正常。
- **基于上游版本**：main@ad978652（v0.1.3-dev）

### CUSTOM-20261013-005 —— 统一 SideX 用户设置文件路径

- **日期**：2026-10-13
- **类型**：fix
- **改动**：
  - Workbench/Tauri UserData 根统一到 `app_dirs::app_data_dir()`：Windows 默认用户设置落在 `%APPDATA%\\SideX\\User\\settings.json`，不再使用 identifier 目录下的 `UserData` 中间层；Rust SettingsStore 启动加载和保存也改用同一文件。
  - 首次启动采用只补缺、不覆盖、不删除源的迁移策略，从旧 Tauri UserData 与 SideX `UserData` 的设置文件迁移到规范目录；settings 保留 JSONC 原文，以旧 Workbench 文件优先，缺失时再用旧 Rust 文件。
  - 用户配置模型从当前 profile 的 settings resource 读盘；Tauri UserData watcher 把物理文件事件还原为 `vscode-userdata:` URI。Rust `settings_get` 也会按同一文件刷新；`settings_update` 只单键改 JSONC，不会用局部缓存覆盖 VAC 等扩展字段。
  - Workbench 只同步默认 profile 的本地 user scope 与 workspace scope 到 Rust，跳过命名 profile、remote profile 和删除更新。
- **验证**：迁移测试 4 passed；Rust 设置单键持久化测试 2 passed；针对三个受影响 TS 文件的 ESLint 通过；改动 Rust 文件 rustfmt check 通过；`AWS_LC_SYS_PREBUILT_NASM=1 npm run rust:check` 通过。全量 `npm run lint` 因 package.json 脚本传入带单引号 glob，ESLint 报 No files matching `"'src/**/*.ts'"`；VAC GUI 端到端待手工验收。
- **基于上游版本**：main@ad978652（v0.1.3-dev）

### CUSTOM-20261013-004 —— 支持拖拽打开 `.code-workspace`

- **日期**：2026-10-13
- **类型**：feat
- **改动**：
  - Tauri 原生拖放监听保留 `.vsix` 安装流程；另将第一个 `.code-workspace` 路径交给 `IHostService.openWindow({ workspaceUri })`，复用 workbench 已有多根工作区打开链路。
  - `src/main.ts` 新增 `workspace` URL 参数解析和 provider 路由；文件夹仍用既有 `folder` 参数，并在两种类型切换时删除过期参数。
  - 多文件拖放时安装所有 VSIX，并打开第一个工作区文件；其他普通文件和目录行为未改变。
- **验证**：`npx eslint src/main.ts CUSTOMIZATIONS/src/vsix-install/vsixInstall.contribution.ts` 通过；`npm run build` 通过（仅有已有的 Vite chunk/import 警告；setup 提示未找到可选 extensions 目录并使用内置主题回退）；`sh CUSTOMIZATIONS/scripts/check-registry.sh` 全绿。Tauri GUI 端到端拖放待手工验证。
- **基于上游版本**：main@ad978652（v0.1.3-dev）

### CUSTOM-20261013-003 —— 发布 v0.1.3-custom.1（首次自定义发布）+ 钉死 gh 默认仓库

- **日期**：2026-10-13
- **类型**：chore（发布 / 工具链防护）
- **改动**：
  - **发布首个自定义版本**：三次提交（feat VSIX 安装 + docs skills 路径修正 + chore release 记录）推送 `custom/main`，打 tag `v0.1.3-custom.1` 并创建 prerelease，上传 `SideX_0.1.3-custom.1_x64_en-US.msi`（18.2 MB）与 `SideX_0.1.3-custom.1_x64-setup.exe`（13.6 MB）
  - 版本号四处此前已是 `0.1.3-custom.1` / wix `0.1.3.1`，且从未打过 `v*-custom.*` tag → 本次即 custom.1，无需抬号；registry frontmatter 的 `custom_version` / `last_release_*` 一并落位
  - **修正两个 skill 里写错的产物路径**：`src-tauri/target/release/bundle/` → 仓库根 `target/release/bundle/`（`sidex-release` 自身"产物位置"一节本来就写着正确路径，属自相矛盾）
  - **钉死 gh 默认仓库**：本仓库 `upstream` remote 也配了 push URL，`gh` 实测把默认仓库解析成 **Sidenai/sidex**——首次 `gh release create` 直接报 "has not been pushed to Sidenai/sidex"，**若不察觉就会把 release 发到上游**。已 `gh repo set-default zouv/custom-sidex`，并在 `sidex-publish` skill 的前置检查与全部 `gh release` 命令里补上 `--repo zouv/custom-sidex`
- **验证**：
  - `sh CUSTOMIZATIONS/scripts/check-registry.sh` 全绿；提交后工作区干净（打包未污染 tracked 文件）
  - 打包：`npm run build:custom` → 末行 `Finished 2 bundles at:`（MSI + NSIS 均产出）。首次因**旧的 release 实例（PID 8024，来自 CUSTOM-20261012 那次打包）锁住 `target/release/SideX.exe`** 而失败（`failed to remove file ... 拒绝访问 (os error 5)`），结束该进程后重跑成功
  - 冒烟：直接运行 `target/release/SideX.exe`，进程稳定存活（25s 后主动结束）
  - 发布核验：`gh release view v0.1.3-custom.1 --repo zouv/custom-sidex --json assets` → 两份产物俱在；正文为我们的 release notes
- **基于上游版本**：main@ad978652（v0.1.3-dev）
- **备注**：坑点见 `docs/pitfalls.md` #8（gh 默认仓库）与 #4（产物路径）；tag 指向 release 记录提交，本条目为发布后的工具链防护补记（不影响已上传产物）。

### CUSTOM-20261013-002 —— 修复 Tauri 下 `file://` 被改写成 `sidex-asset://` 导致读磁盘扩展清单失败

- **日期**：2026-10-13
- **类型**：fix
- **改动**：
  - **现象**：CUSTOM-20261013-001 的安装链路走到"登记进扩展视图"时抛
    `Cannot find a valid extension from the location file:///c%3A/Users/.../extensions/<id>`
  - **根因**：`FileAccess.uriToBrowserUri()` 有一处 SideX 分支（`src/vs/base/common/network.ts`）：Tauri 下把**任何** `file://` 改写成 `sidex-asset://localhost/<encodeURIComponent(fsPath)>`（供 `<img src>`/`fetch` 走 Tauri 自定义协议）。而 `ExtensionResourceLoaderService.readExtensionResource()` 先调用该改写、再按 scheme 分派——`sidex-asset` 不属 http/https/data/tauri，于是落到 `IFileService.readFile(sidex-asset://…)`；**IFileService 没有该 scheme 的 provider**（`sidex-asset` 只是 `src-tauri/src/lib.rs:477` 注册的 Tauri 网络层协议）→ 读 `package.json` 必失败 → `WebExtensionsScannerService.scanExtensionManifest()` 返回 null → `WebExtensionManagementService.install()` 抛出上面那句
  - **改法**（`src/vs/platform/extensionResourceLoader/browser/extensionResourceLoaderService.ts`，`[CUSTOM-BEGIN] CUSTOM-20261013-002` 标记）：方法开头加前置分支——Tauri 环境且 scheme 为 `file` 时直接 `this._fileService.readFile(uri)` 返回，跳过浏览器 URI 改写
  - 这是**上游 SideX 自身的缺陷**（与 001 的自定义功能无耦合）：任何"通过扩展资源加载服务读磁盘上扩展文件"的路径都会踩到，例如磁盘式扩展的 `package.nls.json`、dev 扩展清单读取
- **验证**：
  - `npm run dev:custom` 启动无异常；端到端（安装 → 扩展视图登记 + 热加载激活）待用户在 dev 实例里复测
- **基于上游版本**：main@ad978652（v0.1.3-dev）
- **备注**：坑点见 `docs/pitfalls.md` #7「追加」段；链路图见 `architecture.md` §3 #1

### CUSTOM-20261013-001 —— 新增「从 VSIX 安装扩展」自定义模块

- **日期**：2026-10-13
- **类型**：feat
- **改动**：
  - **动机**：用户安装本地 `vscode-acp-client-1.0.1.vsix` 失败——SideX 前端跑在 Web 模式（`isWeb === true`），`localExtensionManagementServer` 恒为 `null`，上游 VSIX 链路（`getManifest(vsix)` reject `'No Servers'`、`installVSIX()` reject `'No Servers to Install'`、`installFromLocation(file://)` throw `'Local extension management server is not found'`）全部不通，菜单 `when` 条件（`hasLocalServer || hasRemoteServer`）也把入口全隐藏；拖拽则被 `tauri.conf.json` 的 `dragDropEnabled: true` 吞掉（webview 收不到 HTML5 drop，`sidex-open-paths` 那个监听器在仓库里没有任何派发者）
  - 新增 `CUSTOMIZATIONS/src/vsix-install/vsixInstall.contribution.ts`（本仓库第一个自定义前端模块）：
    - 命令 `sidex.extensions.installFromVSIX`，注册到命令面板、扩展视图标题「...」菜单（group `3_install`，对齐上游位置）、资源管理器右键 `.vsix`
    - 文件选择用已桥接 Tauri dialog 插件的 `IFileDialogService.showOpenDialog`（原生文件框 + `.vsix` 过滤，支持多选）
    - 安装两步：`invoke('install_extension', { vsixPath })` 解压到 `%APPDATA%\SideX\extensions\<publisher>.<name>`，再取 **web 扩展服务**（`IExtensionManagementServerService.webExtensionManagementServer`）的 `installFromLocation(URI.file(安装目录), currentProfile.extensionsResource)` 写入已安装记录并触发 `onDidInstallExtensions` → 由 `tauriExtensionHost.contribution.ts` 既有逻辑热加载 + 激活；卸载沿用既有链路（扩展视图卸载 → `uninstall_extension` 删目录）
    - 拖拽：`getCurrentWebviewWindow().onDragDropEvent()` 监听 Tauri 事件，只筛 `.vsix`（其它文件保持原行为=不响应）；非 Tauri 环境整个模块不注册任何东西（`__SIDEX_TAURI__` 守卫）
    - 进度/结果走 `IProgressService` + `INotificationService` 通知（成功显示扩展名与版本，失败显示原因）
  - 挂载点（**唯一改动的上游文件**）：`src/main.ts` 顶部加一行带 `[CUSTOM-BEGIN] CUSTOM-20261013-001` 标记的静态导入
- **验证**：
  - `npx eslint CUSTOMIZATIONS/src/vsix-install/vsixInstall.contribution.ts` → 无告警
  - `npm run build` → vite 构建通过（25s），`dist/assets/index-*.js` 中可 grep 到 `sidex.extensions.installFromVSIX`
  - `npm run dev:custom` → 应用正常启动（扩展宿主正常起来，无加载报错），说明挂载点未破坏启动链路
  - 端到端（命令 → 装 `vscode-acp-client-1.0.1.vsix` → 扩展视图出现并可激活）：待用户在同一 dev 实例里点一次确认
- **基于上游版本**：main@ad978652（v0.1.3-dev）
- **备注**：坑点与排查过程已回写 `docs/pitfalls.md` #7；链路图见 `architecture.md` §3 #1。刻意**不**实现本地扩展管理 server（那要动扩展管理核心，回归风险大）。

### CUSTOM-20261012-005 —— 新增「常用命令速查」文档并接入各入口

- **日期**：2026-10-12
- **类型**：docs
- **改动**：
  - 新增 `CUSTOMIZATIONS/docs/commands.md`：把散落在 AGENTS.md / README / skill / registry 里的命令**集中到一处**，供"忘记时直接翻"。含 8 节：最短路径（4 条）· 自定义快捷命令 · 开发/构建 · 打包/发布 · 版本号四处 · 排查/日志 · 自定义机制脚本 · AI Skills · Git 分支速记
  - 目的是消除上一轮 004 留下的问题：命令虽已写入 5 个文件，但**没有单一查阅点**，"下次忘记时查看"仍要挨个翻
  - 接入入口：`AGENTS.md`（必读文件新增第 3 条 + 项目结构速查 + 文档更新职责表新增一行）、`CUSTOMIZATIONS/README.md`（目录结构树 + 核心约定）
  - 同时在 `AGENTS.md` 文档更新职责表加了治理钩子：**新增/修改常用命令 → 同步 commands.md**，避免速查表随命令演进而腐化
- **验证**：文件内所有命令/路径均取自本会话实测结论（`dev:custom`/`build:custom` 已跑通、日志路径已实测存在、产物路径与四处版本号已实测）；`sh CUSTOMIZATIONS/scripts/check-registry.sh` 全绿
- **基于上游版本**：main@ad978652（v0.1.3-dev）
- **备注**：纯自定义路径（keep-ours），总览表不单列条目（与 `docs/pitfalls.md` 的处理一致）

### CUSTOM-20261012-004 —— 新增快捷启动 / 打包命令（npm 脚本 + bat）

- **日期**：2026-10-12
- **类型**：chore（开发体验）
- **改动**：
  - `package.json`：新增 `dev:custom`、`build:custom` 两个脚本，内容为 `cross-env AWS_LC_SYS_PREBUILT_NASM=1 npm run tauri dev|build`
    - 用 `cross-env`（已是依赖）而非 `VAR=1 cmd` 前置语法——后者只在 Git Bash 生效，在 cmd/PowerShell 里无效
    - 带上 `AWS_LC_SYS_PREBUILT_NASM=1`：本机**未装 NASM**，不带则 `aws-lc-sys` 编译 panic（pitfalls #1）
  - `CUSTOMIZATIONS/scripts/dev.bat`、`build.bat`：bat 包装，自动 `cd` 到仓库根并调用上面的 npm 脚本（单一事实来源，bat 不重复写构建逻辑）
    - `build.bat` 打包前先打印**四处版本号**（package.json / tauri.conf.json version / wix.version / Cargo.toml）供核对，打包后列出 `target/release/bundle/` 产物——针对 002 那次"漏改 wix.version + 产物不在 src-tauri/target"的复发预防
    - 两个 bat 均为 **CRLF + 无 BOM UTF-8 + `chcp 65001`**（cmd.exe 对 LF-only 的多行 `if (...)` 块不可靠；中文需切码页才不乱码）
- **验证**：
  - `npm run dev:custom -- --version` → 链路正常执行（`--version` 被内层 npm 消费，未报错）
  - `cmd /c CUSTOMIZATIONS\scripts\build.bat` → 中文正常渲染、四处版本号打印正确（`0.1.3-custom.1` / `0.1.3-custom.1` / `0.1.3.1` / Cargo `0.1.3-custom.1`），并推进到 `tauri build` → vite 构建
  - `cmd /c CUSTOMIZATIONS\scripts\dev.bat` → 横幅与日志路径正确，推进到 vite dev server（`http://localhost:1420/`）+ `tauri dev`
  - 两次测试均在超时后掐断，已确认无残留 node/cargo 进程、1420 端口已释放
- **基于上游版本**：main@ad978652（v0.1.3-dev）
- **备注**：`package.json` 是上游文件但 JSON 无法加注释，故总览标「无标记」；bat 是纯自定义路径（keep-ours）

### CUSTOM-20261012-003 —— 排查 Claude Code 扩展「Windows 构建找不到」并沉淀坑点

- **日期**：2026-10-12
- **类型**：docs（排查记录，无代码改动）
- **改动**：`CUSTOMIZATIONS/docs/pitfalls.md` 新增 #5：扩展目录内同 id 同版本两个包并存时，`scan_extensions()` 的 `is_version_greater` 相等即不替换 → **先扫到的赢**（NTFS 按字母序），装错平台的 Linux-arm64 包会顶掉正确的 win32-x64 包，导致 Claude Code 面板报 "the Windows (win32-x64) build could not be found"
- **验证**：错包移出 `%APPDATA%\SideX\extensions` 后，正确包自带 `claude.exe --version` → `2.1.296 (Claude Code)`；启动 SideX 后扩展宿主子进程正常起来，无加载报错
- **基于上游版本**：main@ad978652（v0.1.3-dev）
- **备注**：本仓库后端无 VSIX 安装逻辑，此类包属外部放入；上游文件未改动，故总览表无变更

### CUSTOM-20261012-002 —— 首次本地打包（v0.1.3-custom.1）

- **日期**：2026-10-12
- **类型**：config（版本号 + 打包配置）
- **改动**：
  - 应用版本号 `0.1.3` → `0.1.3-custom.1`，三处同步：`package.json`、`src-tauri/tauri.conf.json`、`src-tauri/Cargo.toml`（最后者带 `[CUSTOM-BEGIN]` 标记）
  - `src-tauri/tauri.conf.json` 的 `bundle.windows` 增加 `wix.version = "0.1.3.1"`：`npx tauri build` 首次在 MSI 阶段失败——WiX 的 ProductVersion 只接受纯数字，`-custom.1` 里的 `custom` 不是数字。用该字段单独覆盖 MSI 内部版本（`custom.N` 的 N 放第 4 位 build），应用显示版本与产物文件名仍保留 `-custom.1`
  - 版本号未带 `v` 前缀写进三个文件（格式 `0.1.3-custom.1`）；tag 才带 `v`
- **验证**：
  - `AWS_LC_SYS_PREBUILT_NASM=1 npx tauri build` → `Finished 2 bundles`，产出 msi 18MB / nsis 13MB
  - `SideX.exe` 资源版本 `FileVersion/ProductVersion = 0.1.3-custom.1`（`Get-Item .VersionInfo`）
  - 冒烟：运行 `target/release/SideX.exe`，进程存活且枚举到可见窗口 `SideX`（标题非空），随后终止
- **基于上游版本**：main@ad978652（v0.1.3-dev）
- **备注**：registry frontmatter 的 `custom_version` 按职责表留待 `sidex-publish` 发布时更新；**MSI 的 `wix.version` 每次发新 custom 序号时必须同步递增**（N → `0.1.3.N`），否则 MSI 升级安装会认为版本未变

### CUSTOM-20261012-001 —— 初始化 custom-sidex 自定义开发仓库

- **日期**：2026-10-12
- **类型**：chore（仓库初始化）
- **改动**：
  - 基于上游 `Sidenai/sidex` `main@ad978652`（v0.1.3 开发中）建立 fork 结构：`upstream` → Sidenai/sidex，`vendor/main`（跟踪 upstream/main），`custom/main`（工作分支）
  - 引入自定义开发机制目录 `CUSTOMIZATIONS/`（README/architecture/registry/docs/scripts/src/patches/release-notes）
  - 引入跨工具共享 skills `.agents/skills/sidex-{record-change,merge-upstream,release,publish}/`
  - 新增 `AGENTS.md`（会话级硬约束 + 上游架构说明）与 `CLAUDE.md`（一行指路 `@AGENTS.md`）
- **验证**：`git branch -vv` 显示 custom/main@ad978652、vendor/main 跟踪 upstream/main；`sh CUSTOMIZATIONS/scripts/check-registry.sh` 全绿
- **备注**：本次为初始化，尚无对上游源码的改动，故「改动总览」为空
