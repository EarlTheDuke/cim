@echo off
echo Capturing simulation canvas only (hardened defaults)...
node capture-app.js --target canvas --wait 3800 --retries 4 %1 %2
pause