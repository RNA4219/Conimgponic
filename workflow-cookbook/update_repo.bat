@echo off
setlocal enabledelayedexpansion

rem ===== Settings (args) =====
rem 1: repo path (default: current dir)
rem 2: remote   (default: origin)
rem 3: branch   (default: main)

set "REPO=%~1"
if "%REPO%"=="" set "REPO=%CD%"
set "REMOTE=%~2"
if "%REMOTE%"=="" set "REMOTE=origin"
set "BRANCH=%~3"
if "%BRANCH%"=="" set "BRANCH=main"

echo [INFO] Repo   : "%REPO%"
echo [INFO] Remote : %REMOTE%
echo [INFO] Branch : %BRANCH%
echo.

rem ===== Pre checks =====
where git >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Git が見つかりません。Git for Windows をインストールしてください。
  exit /b 1
)

if not exist "%REPO%\." (
  echo [ERROR] 指定のパスが存在しません: "%REPO%"
  exit /b 1
)

pushd "%REPO%" >nul 2>&1 || (
  echo [ERROR] ディレクトリに移動できません: "%REPO%"
  exit /b 1
)

if not exist ".git" (
  echo [ERROR] ここは Git リポジトリではありません（.git がありません）。
  echo         正しいリポジトリのフォルダを指定してください。
  popd >nul
  exit /b 1
)

rem ===== Actions =====
echo [STEP] git status
git status || goto :fail

echo.
echo [STEP] git fetch %REMOTE%
git fetch %REMOTE% || goto :fail

echo.
echo [STEP] 切替: %BRANCH%
git switch %BRANCH% 2>nul || git checkout %BRANCH% || goto :fail

echo.
echo [STEP] git pull %REMOTE% %BRANCH%
git pull %REMOTE% %BRANCH% || goto :fail

echo.
echo [DONE] 最新化に成功しました。
popd >nul
exit /b 0

:fail
echo.
echo [ERROR] 途中で失敗しました。
echo         競合や未コミット変更が原因の可能性があります。状況確認: git status
echo         すべて捨ててリモートに強制合わせる場合は下記（自己責任）:
echo           git fetch %REMOTE%
echo           git reset --hard %REMOTE%/%BRANCH%
popd >nul
exit /b 1
