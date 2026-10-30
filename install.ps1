# Panasonic Scene — installatie op Windows
#   irm https://seppevanaken.be/panasonicscene/install.ps1 | iex
$ErrorActionPreference = 'Stop'
$repo = 'seppeva/panasonicscene'
$url  = "https://github.com/$repo/releases/latest/download/PanasonicScene-Windows-Setup.exe"
$tmp  = Join-Path $env:TEMP 'PanasonicScene-Setup.exe'
Write-Host '-> Downloaden van de installer...'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
Invoke-WebRequest -Uri $url -OutFile $tmp -UseBasicParsing
Write-Host '-> Installeren...'
Start-Process -FilePath $tmp -ArgumentList '/SILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/CURRENTUSER' -Wait
Remove-Item $tmp -Force -ErrorAction SilentlyContinue
$exe = Join-Path $env:LOCALAPPDATA 'Programs\Panasonic Scene\Panasonic Scene.exe'
if (Test-Path $exe) { Start-Process $exe }
Write-Host 'Klaar: Panasonic Scene staat in het Startmenu.'
