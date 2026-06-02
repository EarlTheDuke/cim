@echo off
echo Capturing current state of http://localhost:5173/ (hardened defaults)...
node capture-app.js --wait 3800 --retries 4 %1 %2
pause