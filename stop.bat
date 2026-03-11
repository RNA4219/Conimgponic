@echo off
echo Stopping Conimgponic development server...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":5173"') do (
    taskkill /F /PID %%a 2>nul
)
echo Server stopped.