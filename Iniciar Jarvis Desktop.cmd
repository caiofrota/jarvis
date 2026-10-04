@echo off
setlocal
cd /d "%~dp0"
if not exist "node_modules\electron\dist\electron.exe" (
  echo Dependencias desktop ausentes. Execute pnpm install na pasta do projeto.
  pause
  exit /b 1
)
if not exist "dist\desktop\main.js" (
  echo Execute pnpm build antes de abrir o aplicativo desktop.
  pause
  exit /b 1
)
if not exist "out\index.html" (
  echo Interface ausente. Execute pnpm build antes de abrir o aplicativo desktop.
  pause
  exit /b 1
)
"node_modules\electron\dist\electron.exe" .
