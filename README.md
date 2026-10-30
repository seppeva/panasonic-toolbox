# Panasonic Scene

Desktop app for **macOS and Windows** to **export and import the scene files (all shading settings of a scene)** of Panasonic PTZ cameras, something an AW-RP120/RP150 cannot do. It also looks up every HTTP command of the cameras (for Bitfocus Companion), opens a camera's web pages already logged in, and helps assign cameras to an **AW-RP150**.

Download page: **https://seppeva.github.io/panasonicscene/**

## Repository layout

| Path | What |
|---|---|
| `index.html`, `privacy.html`, `install.sh`, `install.ps1`, `assets/` | The website (GitHub Pages): download buttons, explanation, privacy statement and install scripts |
| `app/panasonic_scene.py` | The app: a local server on `127.0.0.1:8765` plus its own window (pywebview) |
| `app/web/` | The interface (HTML/JS/CSS), `catalog.js` (scene settings per model) and `commands.js` (all HTTP commands) |
| `app/panasonic_scene.spec`, `app/entitlements.plist` | PyInstaller build (macOS .app and Windows .exe) |
| `installer/windows.iss` | Inno Setup script for the Windows installer |
| `.github/workflows/release.yml` | Builds the Mac and Windows versions and publishes a GitHub Release |
| `tools/` | Mock camera for testing and the generators for `catalog.js` and `commands.js` |
| `PARAMETERS.md` | Every setting in a scene file, per model |
| `PRIVACY.md`, `SECURITY.md`, `SIGNING.md`, `LICENSE`, `THIRD_PARTY_NOTICES.md` | Privacy, security, code signing, license (MIT) and open source components |

## How it works

```
Panasonic Scene (app on your computer)
  ├─ window with the interface ──►  http://127.0.0.1:8765  (built-in server)
  └─ built-in server           ──►  http://<camera-ip>/cgi-bin/aw_cam?cmd=…&res=1
                                    http://<camera-ip>/cgi-bin/aw_ptz?cmd=…&res=1
```

Everything runs locally; no internet connection is needed except for the optional update check. Files are saved in *Downloads › Panasonic Scene* and are never overwritten.

## Releasing a new version

Change `VERSION = "x.y.z"` in `app/panasonic_scene.py` and push to `main`. GitHub Actions then builds:

- `PanasonicScene-macOS-AppleSilicon.dmg` / `.zip`
- `PanasonicScene-macOS-Intel.dmg` / `.zip`
- `PanasonicScene-Windows-Setup.exe`
- `PanasonicScene-Windows-Portable.zip`
- `SHA256SUMS.txt` and `build-info-*.txt`

It then publishes release `vX.Y.Z`. The download buttons point to `releases/latest/download/…`, so they work right away. Pushing a tag `vX.Y.Z` works too.

Without code signing, macOS and Windows show a warning the first time; the Terminal and PowerShell install commands avoid it. See [SIGNING.md](SIGNING.md) to enable signing (Apple notarization runs automatically once the secrets are set).

## The website

Turn it on under *Settings › Pages › Deploy from branch › `main` / (root)*. It is then served at `https://seppeva.github.io/panasonicscene/`. To use your own domain later:

- Subdomain, e.g. `panasonicscene.seppevanaken.be`: add a **CNAME** record pointing to `seppeva.github.io` at your DNS provider and enter the domain under *Settings › Pages › Custom domain*.
- `seppevanaken.be/panasonicscene`: only possible if the main domain is also served by a GitHub Pages site of `seppeva`.

The install commands on the page adapt to the address automatically.

## Developing without cameras

```bash
pip install pywebview            # optional; without it the app opens in your browser
python3 tools/mock_camera.py 127.0.0.11 8080 AW-UE150 "CAM 1" &
python3 tools/mock_camera.py 127.0.0.12 8080 AW-UE160 "CAM 2" &
python3 app/panasonic_scene.py   # or --browser / --headless
# in the app: scan 127.0.0.10-13 on port 8080
```

## File format (`.pscene.json`)

```json
{
  "format": "panasonic-ptz-scene", "version": 1,
  "camera": { "ip": "192.168.0.11", "model": "AW-UE150", "title": "CAM1", "profile": "UE150" },
  "scenes": [ { "scene": 1,
    "params": [ { "cmd": "OSD:A4", "name": "R-G", "group": "Matrix", "raw": "OSD:A4:85", "value": "+5" } ],
    "unavailable": [] } ]
}
```

`raw` is exactly what the camera answered; on import it is sent back as a command, in three passes (in order with modes first, retry what failed, simplify multi-field commands). Every value is then read back and compared. On an AW-UE160 the scene is also stored with `OSL:90` (SCENE FILE STORE).

## Which settings?

| Model | Settings |
|---|---|
| UE150 | 111 |
| UE150A | 110 |
| UE160 | 198 |
| UE100 | 98 |
| UE80 series | 85 |

The full list is in [PARAMETERS.md](PARAMETERS.md).

---
Not affiliated with Panasonic. Use at your own risk and don't test on a camera that is on air.
