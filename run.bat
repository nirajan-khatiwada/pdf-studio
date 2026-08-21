@echo off
title PDF Studio Desktop
echo Starting PDF Studio Desktop Application...
python main.py
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo Application exited with error code %ERRORLEVEL%.
    pause
)
