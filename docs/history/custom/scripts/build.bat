@echo off
chcp 65001 >nul
setlocal

REM ============================================================================
REM build.bat - 打包 SideX 安装包（release）
REM 等价命令: npm run build:custom
REM
REM 位置: CUSTOMIZATIONS\scripts\build.bat （脚本会自动切到仓库根目录）
REM 产物: <仓库根>\target\release\bundle\{msi,nsis}\
REM       注意产物不在 src-tauri\target\ 下——根 Cargo.toml 是 workspace，
REM       cargo 的 target 目录落在 workspace 根（详见 pitfalls.md #4）
REM
REM 打包前本脚本会先打印「四处」版本号供核对（最容易漏 wix.version）:
REM   package.json / tauri.conf.json 的 version / wix.version / Cargo.toml
REM   wix.version 必须是纯数字且随 custom 序号递增（MSI 不接受 -custom.N）
REM ============================================================================

cd /d "%~dp0..\.."
if errorlevel 1 (
    echo [X] 无法切换到仓库根目录
    pause
    exit /b 1
)

if not exist "node_modules\" (
    echo [!] 未找到 node_modules，请先执行: npm install
    pause
    exit /b 1
)

echo === 打包前版本号自查（四处须一致；wix 为纯数字且递增）===
node -e "const p=require('./package.json'),t=require('./src-tauri/tauri.conf.json');const w=t.bundle&&t.bundle.windows&&t.bundle.windows.wix;console.log('  package.json            : '+p.version);console.log('  tauri.conf.json version : '+t.version);console.log('  tauri wix.version       : '+(w&&w.version?w.version:'(未设置! MSI 会打包失败)'));"
findstr /B /C:"version = " src-tauri\Cargo.toml
echo.

echo === 开始打包 ===
call npm run build:custom
set "ERR=%ERRORLEVEL%"

if not "%ERR%"=="0" (
    echo.
    echo [X] 打包失败（退出码 %ERR%）
    pause
    exit /b %ERR%
)

echo.
echo === 产物 ===
if exist "target\release\bundle\" (
    for /r "target\release\bundle" %%F in (*.msi *.exe *.dmg *.AppImage *.deb) do echo   %%F
) else (
    echo   [X] 未找到 target\release\bundle\ —— 打包未真正成功
)
echo.
echo 提示: 输出必须以 "Finished N bundles at:" 结尾才算打包成功；
echo       编译成功 != 打包成功（曾出现过编译过了但零安装包的情况，见 pitfalls.md #4）。

exit /b 0
