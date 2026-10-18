#!/usr/bin/env pwsh
<#
.SYNOPSIS
    列出当前 custom/main 相对于 vendor 分支的所有自定义提交和改动文件。
.DESCRIPTION
    供 AI Agent 快速查看当前有哪些自定义改动。
#>

$ErrorActionPreference = "Stop"

# 从 CUSTOMIZATIONS/registry.md 读取 vendor branch
$vendorBranch = "vendor/main"
if (Test-Path "CUSTOMIZATIONS/registry.md") {
    $content = Get-Content "CUSTOMIZATIONS/registry.md" -Raw
    if ($content -match 'vendor_branch:\s*"([^"]+)"') {
        $vendorBranch = $Matches[1]
    }
}

$vendorExists = git rev-parse --verify "$vendorBranch" 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Host "Vendor 分支 $vendorBranch 不存在，请先初始化或 sync" -ForegroundColor Red
    exit 1
}

Write-Host "=== 自定义改动清单（相对于 $vendorBranch）===" -ForegroundColor Cyan
Write-Host ""

Write-Host "--- 自定义提交 ---" -ForegroundColor Yellow
git log --oneline "$vendorBranch..HEAD"

Write-Host ""
Write-Host "--- 改动文件统计 ---" -ForegroundColor Yellow
git diff --stat "$vendorBranch..HEAD"

Write-Host ""
Write-Host "--- 改动文件列表 ---" -ForegroundColor Yellow
git diff --name-status "$vendorBranch..HEAD"

Write-Host ""
