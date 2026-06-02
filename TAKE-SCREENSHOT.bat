@echo off
echo Taking screenshot for Grok...
powershell -ExecutionPolicy Bypass -File "%~dp0take-screenshot.ps1"
pause