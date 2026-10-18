@echo off
chcp 65001 >nul
setlocal

REM ============================================================================
REM build-release.bat - 打包 SideX 安装包（release，只打包不改版本号）
REM 等价：node CUSTOMIZATIONS\scripts\release.js
REM 流程：打印当前版本号核对 -> npm run build:custom -> 列出 target\release\bundle\ 产物
REM 说明：版本号请手工同步四处（package.json / tauri.conf.json version + wix.version / Cargo.toml）
REM       产物在仓库根 target/，不是 src-tauri/target/（见 docs/pitfalls.md #4）
REM ============================================================================

cd /d "%~dp0..\.."
if errorlevel 1 (
    echo [X] 无法切换到仓库根目录
    pause
    exit /b 1
)

if not exist "node_modules\" (
    echo [!] 未找到 node_modules，请先运行: npm install
    pause
    exit /b 1
)

node "CUSTOMIZATIONS\scripts\release.js"
set "ERR=%ERRORLEVEL%"

if not "%ERR%"=="0" (
    echo.
    echo [X] build-release 脚本退出码 %ERR%
)

echo.
pause
exit /b %ERR%
