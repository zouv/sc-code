# 会话接力 · ScCode

- 快照：2026-10-18；分支 main，origin 仅 zouv/sc-code。无进行中开发任务；本轮按用户授权首次提交与推送，实际提交号/远端状态以 Git 为准；未发布、签名、安装或委派。来源 custom-sidex/sc-browser 始终只读。
- 仓库边界：源码/文档/构建脚本/锁文件入库；.runtime/、packages/、node_modules/、Tauri生成物和本地会话/秘密不入库。4项工作台logs源码已解除误忽略；保留生产DLL/WASM/平台图标。Bash入口LF与可执行位、BAT CRLF；无大规模目录搬动。
- 最新验证：本地及index干净导出均Node74/74、TS通过；transport20/20、文档机械检查通过。干净导出独立npm ci与前端build通过（无下载桌面runtime，仅主题fallback）；3704来源条目/0错误，全部唯一目标在index。干净Windows检出的hash统计差异来自Git行尾转换，来源hash仍保留。证据.runtime/logs/repository-audit.json与repository-{node-tests,import,typecheck,transport,docs,clean-install,clean-import,clean-tests,clean-typecheck,clean-docs,clean-build}.log，导出位置见repository-checkout-path.txt。
- 本轮未重跑完整Rust/Go或重打桌面包；旧源码有少量既有空白格式告警，未扩大本次修改；本轮规则/回归/根文档diff检查无空白问题。既有核心Rust358/358、桌面lib78/78与Go基线不等于所有crate已通过。CI实际运行待查。
- 运行入口：根目录setup/run/dev/build/release/test/verify/clean.bat，支持--help/--dry-run；release默认优化Release，build默认Debug。安装包packages/dev与release，免安装packages/unpack/dev与release；中间产物.runtime，clean保留packages，不强杀或删用户profile。
- 现有成品待验：Debug安装包为图标调色前产物；Release包完整构建日志/图标待核验。现有两份unpack各94内置扩展/823文件hash、Node22.22.3、5CJS语法和扩展服务health通过，Release Go隔离smoke10/10；证据.runtime/logs/unpack-*与unpack-inventory.json。没有新SVG配色的完整GUI/干净机器验收；需要最新源码成品须重跑build/release，而非直接用旧包。
- unpack边界：必须搬整个目录，需系统WebView2；数据默认%APPDATA%/ScCode，不是包内portable-data。hostSourceHash含开发shim，发布资源须逐文件hash校验，不能与源码treeHash直接比较。
- 下一步：在可交互Windows/干净机器，用合成隔离profile验收新包启动提示、标题/图标、custom GUI/VSIX/拖拽和安装升级；真实迁移须用户确认、备份并关闭旧应用，禁止自动操作真实profile/keyring。按ROADMAP S3c诊断已知Rust回归，不靠放宽断言掩盖。
- 数据与兼容边界：Sc-Code优先只复制迁移，继承来源journal、稳定扩展凭据身份且保留keyring服务ID；真实凭据操作/旧数据GUI迁移未验。Agent仅默认收起，未移除/停止Go自启/实现ACP；替换须保留Node宿主、语言服务、文件/终端与通用聊天UI。
- 已知回归：sidex-agent shell timeout实耗88秒超过7秒；sidex-terminal Unix绝对路径Windows用例失败；sidex-remote fixture引用不存在的russh_keys API，测试编译失败。生产构建成功不能替代这些行为验收。
- 工具/路径：Node22/MSVC；.runtime/tools/go/bin/go.exe与.runtime/tools/llvm-mingw-20261006-ucrt-x86_64/bin/gcc.exe。桌面构建清CC/CXX并设AWS_LC_SYS_PREBUILT_NASM=1，不能用裸cargo build代替Tauri custom-protocol。check-docs用C:/Program Files/Git/bin/bash.exe。
- 其它待验：CSP/workspace trust、持久checkpoint/跨文件事务、共享LSP/index、跨窗口Memento/change、ESM重启/崩溃锁、真keyring及模型工具矩阵；secret namespace不是授权沙箱，secure_delete不保证历史秘密页清除。已完成实现细节归CHANGELOG，规划归ROADMAP。
