#!/usr/bin/env pwsh
<#
.SYNOPSIS
    初始化 sidex 自定义开发仓库结构。
.DESCRIPTION
    用于在 clone 本仓库后，一键配置 upstream remote、创建分支结构、
    校验 CUSTOMIZATIONS 目录完整性。幂等：已存在的配置跳过。
    （首次初始化已由 2026-10-12 完成，此脚本主要供重新 clone 后使用。）
.PARAMETER UpstreamUrl
    上游仓库 URL
.PARAMETER BaseRef
    基线 ref，默认 upstream/main
#>

param(
    [string]$UpstreamUrl = "https://github.com/Sidenai/sidex.git",
    [string]$BaseRef = "upstream/main"
)

$ErrorActionPreference = "Stop"

Write-Host "=== SideX 自定义仓库初始化 ===" -ForegroundColor Cyan

if (-not (Test-Path ".git")) {
    Write-Error "当前目录不是 git 仓库"
    exit 1
}
if (-not (Test-Path "CUSTOMIZATIONS/registry.md")) {
    Write-Error "未找到 CUSTOMIZATIONS/registry.md（本仓库应从 zouv/custom-sidex clone，含完整机制目录）"
    exit 1
}

# [1] 配置 upstream
Write-Host "`n[1/4] 配置 upstream remote..." -ForegroundColor Yellow
$existingUpstream = git remote get-url upstream 2>$null
if ($LASTEXITCODE -eq 0 -and $existingUpstream) {
    Write-Host "  upstream 已存在: $existingUpstream"
    if ($existingUpstream -ne $UpstreamUrl) {
        git remote set-url upstream $UpstreamUrl
        Write-Host "  已更新为: $UpstreamUrl"
    }
} else {
    git remote add upstream $UpstreamUrl
    Write-Host "  已添加 upstream: $UpstreamUrl"
}

# [2] Fetch 上游
Write-Host "`n[2/4] 获取上游信息（main + tags）..." -ForegroundColor Yellow
git fetch upstream main --tags
if ($LASTEXITCODE -ne 0) { Write-Error "git fetch upstream 失败"; exit 1 }

# [3] 校验分支结构
Write-Host "`n[3/4] 校验分支结构..." -ForegroundColor Yellow
foreach ($b in @("vendor/main", "custom/main")) {
    git rev-parse --verify $b 2>$null | Out-Null
    if ($LASTEXITCODE -ne 0) {
        if ($b -eq "vendor/main") {
            git branch vendor/main upstream/main
            Write-Host "  已创建 vendor/main (基于 upstream/main)"
        } else {
            git branch custom/main vendor/main
            Write-Host "  已创建 custom/main"
        }
    } else {
        Write-Host "  $b 已存在"
    }
}
git checkout custom/main

# [4] 一致性自检
Write-Host "`n[4/4] registry 一致性自检..." -ForegroundColor Yellow
sh CUSTOMIZATIONS/scripts/check-registry.sh

Write-Host "`n=== 初始化完成 ===" -ForegroundColor Green
Write-Host "当前分支: $(git branch --show-current)"
Write-Host "基线: $BaseRef ($(git rev-parse --short $BaseRef))"
Write-Host ""
Write-Host "下一步："
Write-Host "  - 在 custom/main 上开发，完成后用 sidex-record-change 记录改动"
Write-Host "  - 合并上游版本时用 sidex-merge-upstream"
Write-Host "  - 发布到 GitHub 用 sidex-publish（本地打包用 sidex-release）"
