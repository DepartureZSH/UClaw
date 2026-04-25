@echo off
setlocal enabledelayedexpansion

echo This script will ERASE the selected disk.
echo.
echo Use "diskpart" then "list disk" to find the correct disk number.
echo.

set /p DISKNUM=Enter disk number to erase:
set /p SHARE_MB=Enter ExFAT shared partition size in MB, e.g. 1024000 for 1TB:

echo.
echo Target disk: %DISKNUM%
echo ExFAT size: %SHARE_MB% MB
echo Remaining space will be left unformatted for macOS APFS.
echo.

set /p CONFIRM=Type ERASE-%DISKNUM% to continue:

if not "%CONFIRM%"=="ERASE-%DISKNUM%" (
  echo Cancelled.
  exit /b 1
)

set SCRIPT=%TEMP%\uclaw_partition_%RANDOM%.txt

(
echo select disk %DISKNUM%
echo detail disk
echo clean
echo convert gpt
echo create partition primary size=%SHARE_MB%
echo format fs=exfat quick label=SHARE_EXFAT
echo assign
echo create partition primary
echo rem Second partition intentionally left unformatted for macOS APFS
echo exit
) > "%SCRIPT%"

diskpart /s "%SCRIPT%"
del "%SCRIPT%"

echo.
echo Done. Now plug the disk into macOS and format the second partition as APFS.
echo Use: diskutil list
echo Then: diskutil eraseVolume APFS MAC_APPS_APFS /dev/diskXsY
