@echo off
echo Capturing Crown Jewel / Drama Scorecard section (hardened defaults)...
node capture-app.js --target crown --wait 5200 --retries 4 --stable-wait %1 %2
pause