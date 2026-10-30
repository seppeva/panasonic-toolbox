# Panasonic Scene — installatie op Windows
#   irm https://seppeva.github.io/panasonicscene/install.ps1 | iex
# Downloadt de laatste release van GitHub, controleert de SHA-256-checksum en installeert de app.
$ErrorActionPreference = 'Stop'
$repo = 'seppeva/panasonicscene'
$url  = "https://github.com/$repo/releases/latest/download/PanasonicScene-Windows-Setup.exe"
$tmp  = Join-Path $env:TEMP 'PanasonicScene-Setup.exe'
Write-Host '-> Downloaden van de installer...'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
Invoke-WebRequest -Uri $url -OutFile $tmp -UseBasicParsing
Write-Host '-> Checksum controleren...'
$sums = (Invoke-WebRequest -Uri "https://github.com/$repo/releases/latest/download/SHA256SUMS.txt" -UseBasicParsing).Content
if ($sums -is [byte[]]) { $sums = [Text.Encoding]::UTF8.GetString($sums) }
$line = ($sums -split "`n") | Where-Object { $_ -match ' PanasonicScene-Windows-Setup\.exe\s*$' } | Select-Object -First 1
$expected = if ($line) { ($line -split '\s+')[0].ToLower() } else { '' }
$actual = (Get-FileHash -Algorithm SHA256 $tmp).Hash.ToLower()
if (-not $expected -or $expected -ne $actual) { Remove-Item $tmp -Force; throw 'Checksum klopt niet. Installatie afgebroken.' }
Write-Host '-> Installeren...'
Start-Process -FilePath $tmp -ArgumentList '/SILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/CURRENTUSER' -Wait
Remove-Item $tmp -Force -ErrorAction SilentlyContinue
$exe = Join-Path $env:LOCALAPPDATA 'Programs\Panasonic Scene\Panasonic Scene.exe'
if (Test-Path $exe) { Start-Process $exe }
Write-Host 'Klaar: Panasonic Scene staat in het Startmenu.'
