#!/usr/bin/env pwsh
<#
.SYNOPSIS
    快速同步 vendor 分支到指定上游 ref。
.DESCRIPTION
    AI Agent 在合并上游前可以先用此脚本查看/同步 vendor 分支。
    sidex 上游开发在 main 分支；ref 可以是：
      - upstream/main（默认，跟随开发线）
      - tag（如 v0.1.2，锚定版本线时同时创建 vendor/vX.Y.x）
.PARAMETER Ref
    目标 ref。留空则使用 upstream/main 最新。
.PARAMETER Push
    是否自动推送到 origin
#>

param(
    [string]$Ref = "",
    [switch]$Push
)

$ErrorActionPreference = "Stop"

Write-Host "=== Vendor 分支同步 ===" -ForegroundColor Cyan

git fetch upstream --tags

if (-not $Ref) {
    $Ref = "upstream/main"
    Write-Host "未指定 ref，使用: $Ref"
}

# tag 则推导版本线分支名（v0.1.2 → vendor/v0.1.x），否则用 vendor/main
if ($Ref -match '^v(\d+)\.(\d+)\.') {
    $vendorBranch = "vendor/v$($Matches[1]).$($Matches[2]).x"
} else {
    $vendorBranch = "vendor/main"
}

Write-Host "目标 ref: $Ref"
Write-Host "Vendor 分支: $vendorBranch"

$currentBranch = git branch --show-current
$vendorExists = git rev-parse --verify "$vendorBranch" 2>$null

if ($LASTEXITCODE -ne 0) {
    Write-Host "创建新 vendor 分支 $vendorBranch ..." -ForegroundColor Yellow
    git checkout -b $vendorBranch $Ref
} else {
    git checkout $vendorBranch
    Write-Host "合并 $Ref 到 $vendorBranch ..." -ForegroundColor Yellow
    git merge --no-edit $Ref
}

if ($Push) {
    git push origin $vendorBranch
    Write-Host "已推送到 origin/$vendorBranch" -ForegroundColor Green
}

git checkout $currentBranch
Write-Host "`n完成。Vendor 分支 $vendorBranch 已同步到 $Ref" -ForegroundColor Green
