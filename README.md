# Panasonic Toolbox

The all-in-one desktop app for **Panasonic PTZ cameras and remotes**, for **macOS and Windows**. Set up the network, control the cameras live, save and copy their scene files, build shows, look up every camera command and assign cameras to an **AW-RP150**.

Website: **https://seppeva.github.io/panasonic-toolbox/**

## What the app does

| Tab | What it is for |
|---|---|
| **Network setup** | Find every Panasonic camera on the network, in any IP range, and set its name and IP address, like Easy IP Setup. |
| **Cameras** | Your camera list: IP address, name on the camera, your own description, model, zone, live scene and status. Zones let you work on groups of cameras; a camera's IP address can be changed in the app when it got a new one. |
| **Live** | Live picture with control buttons: pan/tilt, zoom, focus, iris, presets, scene files, power, tally, day/night, white and black balance. |
| **Export** | Save the shading settings of any scene (scene files, `.pscene.json`) or an operator's own preferences (operator files, `.poper`), from one or many cameras. |
| **Import** | Put saved settings back on any camera and scene, with a comparison first, a backup and a check afterwards. **Initialize** (Cameras and Live) puts a default scene, saved once per model, into the live scene of all selected cameras the same way. |
| **Shows** | A complete setup (which scene and operator file goes to which camera and scene) recalled with one click. Made from the cameras, or in a grid from saved files, and editable afterwards (`.pshow`). |
| **Parameters** | Every REST command of the cameras and controllers with a ready-made link; scripts (PowerShell or shell) that run an action on many cameras at once, kept in the project and editable, also after reopening a saved script file; and what is in a scene file and an operator file per model. |
| **RP150 assignment** | Assign cameras to the CAM buttons of an AW-RP150 through its `Network.s15` file (experimental). |
| **Settings** | Projects (each with its own cameras, zones, shows, scripts, timing and web page paths), project files to open a project on another computer, closing a project, and the save folder. |

Exports, imports, saving an edited show, opening a project file and closing a project ask for confirmation first and show exactly what will happen. Changes in the app and on the cameras can be undone.

## Repository layout

| Path | What |
|---|---|
| `index.html`, `privacy.html`, `install.sh`, `install.ps1`, `assets/` | The website (GitHub Pages): download buttons, explanation, privacy statement and install scripts |
| `app/panasonic_scene.py` | The app: a local server on `127.0.0.1:8765` plus its own window (pywebview) |
| `app/easyip.py` | Panasonic Easy IP protocol: find cameras in any IP range and change their network settings |
| `app/web/` | The interface (HTML/JS/CSS), `catalog.js` (scene settings per model) and `commands.js` (all REST commands) |
| `app/panasonic_scene.spec`, `app/entitlements.plist` | PyInstaller build (macOS .app and Windows .exe) |
| `installer/windows.iss` | Inno Setup script for the Windows installer |
| `.github/workflows/release.yml` | Builds the Mac and Windows versions and publishes a GitHub Release |
| `tools/` | Mock camera for testing and the generators for `catalog.js` and `commands.js` |
| `PARAMETERS.md` | Every setting in a scene file, per model |
| `PRIVACY.md`, `SECURITY.md`, `SIGNING.md`, `LICENSE`, `THIRD_PARTY_NOTICES.md` | Privacy, security, code signing, license (MIT) and open source components |

## How it works

```
Panasonic Toolbox (app on your computer)
  ├─ window with the interface ──►  http://127.0.0.1:8765  (built-in server)
  └─ built-in server           ──►  http://<camera-ip>/cgi-bin/aw_cam?cmd=…&res=1
                                    http://<camera-ip>/cgi-bin/aw_ptz?cmd=…&res=1
```

Everything runs locally; no internet connection is needed except for the optional update check. Files are saved in the save folder from Settings (by default *Downloads › Panasonic Toolbox*), in a folder per project, and are never overwritten:

```
Panasonic Toolbox\
└── <Project>\
    ├── <Project>_2026-11-04.ptproject   project file
    ├── Scene files\                     .pscene.json and ZIPs
    ├── Operator files\                  .poper and ZIPs
    ├── Shows\                           .pshow
    ├── Backups\2026-11-04\              automatic backups made by an import
    ├── Scripts\                         .ps1 / .sh
    ├── RP150\                           Network.s15 and the original as a backup
    └── Parameter lists\                 CSV exports
```

Renaming a project renames its folder too.

The app's own data (projects, cameras, shows, scripts, settings) is kept in `state.json` in the app data folder: *~/Library/Application Support/Panasonic Toolbox* on a Mac, *%APPDATA%\Panasonic Toolbox* on Windows. It does not depend on the port or on the window, and data from versions before 2.16 is moved there automatically the first time. Camera names come from `QSJ:5C`, on older models from `/cgi-bin/get_basic`, otherwise from Easy IP (UDP 10669/10670), which is also used by Network setup.

## Releasing a new version

Change `VERSION = "x.y.z"` in `app/panasonic_scene.py` and push to `main`. GitHub Actions then builds:

- `PanasonicToolbox-macOS-AppleSilicon.dmg` / `.zip`
- `PanasonicToolbox-macOS-Intel.dmg` / `.zip`
- `PanasonicToolbox-Windows-Setup.exe`
- `PanasonicToolbox-Windows-Portable.zip`
- `SHA256SUMS.txt` and `build-info-*.txt`

It then publishes release `vX.Y.Z`. The download buttons point to `releases/latest/download/…`, so they work right away. Pushing a tag `vX.Y.Z` works too.

Without code signing, macOS and Windows show a warning the first time; the Terminal and PowerShell install commands avoid it. See [SIGNING.md](SIGNING.md) to enable signing (Apple notarization runs automatically once the secrets are set).

## The website

Turn it on under *Settings › Pages › Deploy from branch › `main` / (root)*. It is then served at `https://seppeva.github.io/panasonic-toolbox/`. To use your own domain later:

- Subdomain, e.g. `panasonicscene.seppevanaken.be`: add a **CNAME** record pointing to `seppeva.github.io` at your DNS provider and enter the domain under *Settings › Pages › Custom domain*.
- `seppevanaken.be/panasonicscene`: only possible if the main domain is also served by a GitHub Pages site of `seppeva`.

The install commands on the page adapt to the address automatically.

## Developing without cameras

```bash
pip install pywebview            # optional; without it the app opens in your browser
python3 tools/mock_camera.py 127.0.0.11 8080 AW-UE150 "CAM 1" &
python3 tools/mock_camera.py 127.0.0.12 8080 AW-UE160 "CAM 2" &
python3 tools/mock_camera.py 127.0.0.13 8080 AW-HE130 "CAM 3" basic &   # older model: name only via get_basic
python3 tools/mock_easyip.py &   # two cameras for Network setup
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

Other files the app writes: operator files (`.poper`, format `panasonic-ptz-operator`), shows (`.pshow`, format `panasonic-toolbox-show`, with the scene and operator files embedded) and project files (`.ptproject`, format `panasonic-toolbox-project`: one project with its cameras, zones, descriptions, shows, RP150 rows, scripts, file names, timing and web page paths). Config files from 2.11 to 2.13 (`panasonic-toolbox-config`) can still be opened.

## Which settings?

| Model | Settings |
|---|---|
| UE150 | 111 |
| UE150A | 110 |
| UE160 | 198 |
| UE100 | 98 |
| UE80 series | 85 |

Other models, such as the AW-HE130 and AW-UE70, get every scene setting they support. Operator files hold 30 settings (presets, pan/tilt and lens preferences); tally is not part of them. The scene settings per model are in [PARAMETERS.md](PARAMETERS.md); the operator settings are on the Parameters tab in the app.

---
Not affiliated with Panasonic. Use at your own risk and don't test on a camera that is on air.
