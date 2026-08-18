# ============================================================
# STC网站 - GitHub Pages 部署脚本
# ============================================================
# 使用方法：
#   1. 双击运行此脚本（PowerShell）
#   2. 输入你的 GitHub 用户名
#   3. 脚本会自动创建部署目录并复制文件
#   4. 然后推送到 GitHub 仓库
# ============================================================

$ErrorActionPreference = "Continue"

Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  STC网站 GitHub Pages 部署工具" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

# 检查 git 是否可用
try {
    git --version | Out-Null
} catch {
    Write-Host "错误：未检测到 git，请先安装 Git" -ForegroundColor Red
    Write-Host "下载地址：https://git-scm.com/download/win" -ForegroundColor Yellow
    Read-Host "按回车键退出"
    exit
}

# 获取 GitHub 用户名
$githubUser = Read-Host "请输入你的 GitHub 用户名"
if (-not $githubUser) {
    Write-Host "错误：用户名不能为空" -ForegroundColor Red
    Read-Host "按回车键退出"
    exit
}

# 仓库名称（用户站点使用 username.github.io）
$repoName = "$githubUser.github.io"
$deployDir = "$env:USERPROFILE\Desktop\$repoName"

Write-Host ""
Write-Host "部署目录: $deployDir" -ForegroundColor Yellow
Write-Host "仓库名称: $repoName" -ForegroundColor Yellow
Write-Host ""

# 创建部署目录
if (Test-Path $deployDir) {
    Write-Host "部署目录已存在，是否清空重建？(Y/N)" -ForegroundColor Yellow
    $confirm = Read-Host
    if ($confirm -eq "Y" -or $confirm -eq "y") {
        Remove-Item -Recurse -Force $deployDir
    } else {
        Write-Host "取消操作" -ForegroundColor Red
        Read-Host "按回车键退出"
        exit
    }
}

New-Item -ItemType Directory -Path $deployDir -Force | Out-Null

# 复制 public 文件夹内容
$sourceDir = Join-Path $PSScriptRoot "public"
if (-not (Test-Path $sourceDir)) {
    Write-Host "错误：找不到 public 文件夹" -ForegroundColor Red
    Read-Host "按回车键退出"
    exit
}

Write-Host "正在复制文件..." -ForegroundColor Green
Copy-Item -Path "$sourceDir\*" -Destination $deployDir -Recurse -Force

# 修改 config.js 填入 Vercel 地址
$configFile = Join-Path $deployDir "js\config.js"
if (Test-Path $configFile) {
    $vercelUrl = Read-Host "请输入你的 Vercel 网站地址（例如 https://stc-website-weld.vercel.app）"
    if ($vercelUrl) {
        $content = Get-Content $configFile -Raw
        $content = $content -replace [regex]::Escape("var API_BASE_CONFIG = '';"), "var API_BASE_CONFIG = '$vercelUrl';"
        Set-Content -Path $configFile -Value $content -NoNewline
        Write-Host "已配置 Vercel API 地址" -ForegroundColor Green
    }
}

# 初始化 git 仓库
Push-Location $deployDir
git init
git add .
git commit -m "STC网站 - GitHub Pages 部署"

# 创建 .nojekyll 文件（让 GitHub Pages 不跳过下划线开头的文件夹）
New-Item -ItemType File -Path (Join-Path $deployDir ".nojekyll") -Force | Out-Null
git add .nojekyll
git commit -m "添加 .nojekyll 文件"

Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  本地仓库已准备好！" -ForegroundColor Green
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "接下来的步骤：" -ForegroundColor Yellow
Write-Host "1. 在 GitHub 上创建仓库: $repoName" -ForegroundColor White
Write-Host "   访问: https://github.com/new" -ForegroundColor Gray
Write-Host "   仓库名填: $repoName" -ForegroundColor White
Write-Host ""
Write-Host "2. 创建后，运行以下命令推送：" -ForegroundColor White
Write-Host "   git remote add origin https://github.com/$githubUser/$repoName.git" -ForegroundColor Gray
Write-Host "   git branch -M main" -ForegroundColor Gray
Write-Host "   git push -u origin main" -ForegroundColor Gray
Write-Host ""
Write-Host "3. 在 GitHub 仓库设置中启用 Pages：" -ForegroundColor White
Write-Host "   Settings -> Pages -> Source 选 main 分支 / (root)" -ForegroundColor Gray
Write-Host ""
Write-Host "4. 等待几分钟后访问：" -ForegroundColor White
Write-Host "   https://$repoName" -ForegroundColor Green
Write-Host ""

$pushNow = Read-Host "是否现在执行推送命令？(Y/N)"
if ($pushNow -eq "Y" -or $pushNow -eq "y") {
    $remoteUrl = "https://github.com/$githubUser/$repoName.git"
    git remote add origin $remoteUrl 2>$null
    git branch -M main
    git push -u origin main
}

Pop-Location
Write-Host ""
Write-Host "完成！" -ForegroundColor Green
Read-Host "按回车键退出"
