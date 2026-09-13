@echo off
chcp 65001 >nul
title STC 电脑端 - 手机电脑互传
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   没有检测到 Node.js。
  echo   请先安装（安装时一路默认即可）：https://nodejs.org/
  echo.
  pause
  exit /b 1
)

node server.js %*
echo.
echo   电脑端已退出。
pause
