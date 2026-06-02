@echo off
echo Capturing full God Mode panel (hardened defaults)...
node capture-app.js --target god-mode --wait 4500 --retries 4 %1 %2
pause