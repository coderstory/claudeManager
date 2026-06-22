# M2.16-mica-fallback — 决定性验证脚本
# 设纯红壁纸 + 启动 release exe + 切 glass-clear + 截图 + 读像素
# 用法: powershell -ExecutionPolicy Bypass -File mica-red-wallpaper-test.ps1

$ErrorActionPreference = 'Stop'

# --- 1. 记录原壁纸 ---
$origWallpaper = (Get-ItemProperty -Path "HKCU:\Control Panel\Desktop" -Name Wallpaper).Wallpaper
Write-Host "[orig] wallpaper = $origWallpaper"

# --- 2. 生成纯红 BMP (1920x1080 确保覆盖全屏) ---
Add-Type -AssemblyName System.Drawing
$redBmp = New-Object System.Drawing.Bitmap(1920, 1080)
$g = [System.Drawing.Graphics]::FromImage($redBmp)
$g.Clear([System.Drawing.Color]::FromArgb(255, 255, 0, 0))
$redPath = "$env:TEMP\red-wallpaper.bmp"
$redBmp.Save($redPath, [System.Drawing.Imaging.ImageFormat]::Bmp)
$g.Dispose(); $redBmp.Dispose()
Write-Host "[red] generated $redPath"

# --- 3. 设壁纸 (SystemParametersInfo SPI_SETDESKWALLPAPER) ---
Add-Type -TypeDefinition @"
using System.Runtime.InteropServices;
public class Wall {
  [DllImport("user32.dll", CharSet=CharSet.Auto)]
  public static extern int SystemParametersInfo(int uAction, int uParam, string lpvParam, int fuWinIni);
}
"@
# SPI_SETDESKWALLPAPER=0x0014, SPIF_UPDATEINIFILE|SPIF_SENDCHANGE = 0x01|0x02 = 3
$ret = [Wall]::SystemParametersInfo(0x0014, 0, $redPath, 0x01 -bor 0x02)
Write-Host "[wall] SystemParametersInfo ret = $ret (non-zero = success)"
Start-Sleep -Seconds 1

# 验证壁纸已切换
$nowWall = (Get-ItemProperty -Path "HKCU:\Control Panel\Desktop" -Name Wallpaper).Wallpaper
Write-Host "[wall] now = $nowWall"

# 把原壁纸路径写到文件，便于后续恢复
$origWallpaper | Out-File -FilePath "$env:TEMP\orig-wallpaper.txt" -Encoding utf8 -NoNewline
Write-Host "[orig] saved to $env:TEMP\orig-wallpaper.txt"
