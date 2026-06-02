# =====================================================
# CityWithLifeGrok - Easy Screenshot Tool
# =====================================================
# 
# This script takes a screenshot of your screen and saves it
# into the "screenshots" folder with a timestamp.
#
# HOW TO USE:
#   1. Double-click this file, OR
#   2. Right-click → "Run with PowerShell", OR
#   3. In PowerShell, run: .\take-screenshot.ps1
#
# After it runs, the new screenshot will be in the screenshots/ folder.
# You can then tell me the filename and I'll look at it.
# =====================================================

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$screenshotsDir = Join-Path $scriptDir "screenshots"

# Make sure the folder exists
if (-not (Test-Path $screenshotsDir)) {
    New-Item -ItemType Directory -Path $screenshotsDir | Out-Null
}

# Generate filename with timestamp
$timestamp = Get-Date -Format "yyyy-MM-dd_HH-mm-ss"
$filename = "screenshot_$timestamp.png"
$filepath = Join-Path $screenshotsDir $filename

Write-Host "Taking screenshot..." -ForegroundColor Cyan

try {
    # Load required .NET assemblies
    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -AssemblyName System.Drawing

    # Get the full virtual screen bounds (handles multi-monitor)
    $bounds = [System.Windows.Forms.SystemInformation]::VirtualScreen
    $bitmap = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)

    # Capture the screen
    $graphics.CopyFromScreen($bounds.X, $bounds.Y, 0, 0, $bitmap.Size)
    $graphics.Dispose()

    # Save the image
    $bitmap.Save($filepath, [System.Drawing.Imaging.ImageFormat]::Png)
    $bitmap.Dispose()

    Write-Host "✅ Screenshot saved!" -ForegroundColor Green
    Write-Host "File: $filename" -ForegroundColor Yellow
    Write-Host "Location: $screenshotsDir" -ForegroundColor Gray
    Write-Host ""
    Write-Host "Now tell me in chat: 'Look at $filename'" -ForegroundColor Cyan
}
catch {
    Write-Host "❌ Screenshot failed: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "Trying alternative method..." -ForegroundColor Yellow

    # Fallback using Snipping Tool (if available)
    try {
        Start-Process "ms-screenclip" -ErrorAction Stop
        Write-Host "Snipping Tool opened. Take your screenshot and save it manually into the screenshots folder." -ForegroundColor Cyan
    }
    catch {
        Write-Host "Could not open Snipping Tool either." -ForegroundColor Red
        Write-Host "Please manually take a screenshot (Win + Shift + S) and save it to:" -ForegroundColor Yellow
        Write-Host $screenshotsDir -ForegroundColor White
    }
}