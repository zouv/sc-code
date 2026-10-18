@echo off
chcp 65001 >nul
setlocal
rem ScCode - verify. Use --help for usage, --dry-run for a safe preview.
pushd "%~dp0"
if errorlevel 1 exit /b 1
where node >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Node.js 22+ with npm is required. Add node to PATH.
    popd
    exit /b 1
)
node "scripts\daily.cjs" verify %*
set "CODE=%ERRORLEVEL%"
popd
exit /b %CODE%
