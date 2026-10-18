@echo off
chcp 65001 >nul
setlocal

REM ============================================================================
REM dev.bat - 快捷启动 SideX 桌面应用（开发模式）
REM 等价命令: npm run dev:custom
REM
REM 位置: CUSTOMIZATIONS\scripts\dev.bat （脚本会自动切到仓库根目录）
REM 行为: 前端 TS 热重载；改动 Rust 会自动重新编译后再启动
REM 日志: %LOCALAPPDATA%\dev.sidex.app\logs\SideX.log（仅 dev 构建有日志，
REM       release 包没有，详见 CUSTOMIZATIONS\docs\pitfalls.md #6）
REM
REM 为什么要设 AWS_LC_SYS_PREBUILT_NASM=1:
REM   依赖链里的 aws-lc-sys 在 Windows 上默认调用 NASM 汇编器；本机未装 NASM
REM   会导致 Rust 编译 panic。设为 1 时改用该 crate 自带的预编译目标文件。
REM   详见 CUSTOMIZATIONS\docs\pitfalls.md #1
REM ============================================================================

cd /d "%~dp0..\.."
if errorlevel 1 (
    echo [X] 无法切换到仓库根目录
    pause
    exit /b 1
)

if not exist "node_modules\" (
    echo [!] 未找到 node_modules，请先在本目录执行: npm install
    pause
    exit /b 1
)

echo === SideX 开发模式启动 ===
echo   仓库: %CD%
echo   日志: %LOCALAPPDATA%\dev.sidex.app\logs\SideX.log
echo.

call npm run dev:custom
set "ERR=%ERRORLEVEL%"

if not "%ERR%"=="0" (
    echo.
    echo [X] 启动失败（退出码 %ERR%）
    pause
)

exit /b %ERR%
