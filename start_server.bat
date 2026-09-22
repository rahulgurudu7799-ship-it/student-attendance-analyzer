@echo off
title Student Attendance Analyzer - Node.js Express Backend
echo ========================================================
echo   Student Attendance Analyzer Ultimate - Backend Launcher
echo ========================================================
echo.

:: Check if Node is installed
where node >nul 2>nul
if %ERRORLEVEL% EQU 0 (
    echo [OK] Node.js detected.
    if not exist node_modules (
        echo [INFO] Installing required npm packages (express, mysql2, cors, dotenv)...
        call npm install
    )
    echo [INFO] Starting Node.js Express server...
    node server.js
    goto end
)

:: Fallback to Python if Node is not on PATH
where python >nul 2>nul
if %ERRORLEVEL% EQU 0 (
    echo [NOTICE] Node.js not detected in PATH.
    echo [INFO] Launching high-performance standard Python backend mirror...
    python server.py
    goto end
)

echo [ERROR] Neither Node.js nor Python was found in system PATH.
echo Please install Node.js from https://nodejs.org or install Python.
pause

:end
