@echo off
setlocal
cd /d "%~dp0"
set "JARVIS_NODE="
for /f "delims=" %%N in ('where node.exe 2^>nul') do if not defined JARVIS_NODE set "JARVIS_NODE=%%N"
if not defined JARVIS_NODE if exist "%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" set "JARVIS_NODE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
if not defined JARVIS_NODE (
  echo Node.js nao encontrado. Instale Node.js 22.12 ou superior para usar o modo de desenvolvimento.
  pause
  exit /b 1
)
echo Jarvis em desenvolvimento. Nenhum navegador sera aberto automaticamente.
echo Mantenha esta janela aberta. Para encerrar, pressione Ctrl+C.
if not exist "node_modules\next\dist\bin\next" (
  echo Dependencias ausentes. Execute pnpm install nesta pasta.
  pause
  exit /b 1
)
"%JARVIS_NODE%" node_modules\tsx\dist\cli.mjs watch --ignore dist --ignore out scripts\dev.ts
if errorlevel 1 pause
