# Panasonic Scene installer for Windows
#   irm https://seppeva.github.io/panasonicscene/install.ps1 | iex
# Downloads the latest release from GitHub, checks the SHA-256 checksum and installs the app.
$ErrorActionPreference = 'Stop'
$repo = 'seppeva/panasonicscene'
$url  = "https://github.com/$repo/releases/latest/download/PanasonicScene-Windows-Setup.exe"
$tmp  = Join-Path $env:TEMP 'PanasonicScene-Setup.exe'
Write-Host '-> Downloading the installer...'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
Invoke-WebRequest -Uri $url -OutFile $tmp -UseBasicParsing
Write-Host '-> Checking checksum...'
$sums = (Invoke-WebRequest -Uri "https://github.com/$repo/releases/latest/download/SHA256SUMS.txt" -UseBasicParsing).Content
if ($sums -is [byte[]]) { $sums = [Text.Encoding]::UTF8.GetString($sums) }
$line = ($sums -split "`n") | Where-Object { $_ -match ' PanasonicScene-Windows-Setup\.exe\s*$' } | Select-Object -First 1
$expected = if ($line) { ($line -split '\s+')[0].ToLower() } else { '' }
$actual = (Get-FileHash -Algorithm SHA256 $tmp).Hash.ToLower()
if (-not $expected -or $expected -ne $actual) { Remove-Item $tmp -Force; throw 'Checksum does not match. Installation cancelled.' }
Write-Host '-> Installing...'
Start-Process -FilePath $tmp -ArgumentList '/SILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/CURRENTUSER' -Wait
Remove-Item $tmp -Force -ErrorAction SilentlyContinue
$exe = Join-Path $env:LOCALAPPDATA 'Programs\Panasonic Scene\Panasonic Scene.exe'
if (Test-Path $exe) { Start-Process $exe }
Write-Host 'Done: Panasonic Scene is in the Start menu.'
