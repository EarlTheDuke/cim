# CityWithLifeGrok - One-click Dev Server Starter
# 
# HOW TO USE:
# 1. Right-click this file
# 2. Choose "Run with PowerShell"
#    (If it asks about execution policy, type A and press Enter)
#
# This will automatically:
# - Go to the right folder
# - Stop old servers
# - Clear the cache
# - Start the dev server with --force

cd $PSScriptRoot

Write-Host "Stopping old node processes..." -ForegroundColor Yellow
Get-Process node -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue

Write-Host "Clearing Vite cache..." -ForegroundColor Yellow
Remove-Item -Recurse -Force node_modules\.vite -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force .vite -ErrorAction SilentlyContinue

Write-Host "Starting dev server with --force (cache bypass)..." -ForegroundColor Green
Write-Host "For reliable captures with capture-app.js: use --stable-wait --retries 5 after this is LISTENING on 5173." -ForegroundColor Cyan
npm run dev -- --force
