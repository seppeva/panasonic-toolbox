# Panasonic Toolbox

The all-in-one desktop app for **Panasonic PTZ cameras and remotes**, for **macOS and Windows**. Set up the network, control the cameras live, save and copy their scene files, build shows, look up every camera command and assign cameras to an **AW-RP150**.

Website: **https://seppeva.github.io/panasonic-toolbox/**

## What the app does

| Tab | What it is for |
|---|---|
| **Cameras** | One list with your cameras and every other Panasonic camera the network search finds, also in another IP range (Easy IP, like Easy IP Setup). Change a name or IP address right in the list and choose **Apply**: the app sends it, searches again and shows per camera what really changed. A new name goes both to the camera title (`OSJ:5C`) and to the camera name of the web page and the network (`/cgi-bin/set_basic?cam_title=`); an IP change moves the camera in the list along with it. A coloured dot per camera shows at a glance whether it is in this computer's IP range and reachable (green), in another range (amber), not reachable (red) or found but not in your list (blue). **Edit IP settings…** changes name, IP address, subnet mask and gateway of the ticked cameras in one table and sends them. **Search** finds the cameras and reads every listed camera again; **Add…** adds cameras by IP address or scans an IP range; **Zones…** renames zones and sets which cameras are in each. Select cameras and open their live or settings pages in one click, each in its own browser tab. |
| **Live** | Live picture with control buttons: pan/tilt and zoom with a speed readout and a Nominal button, focus, iris, presets, scene files, day/night, white balance (with a field for the VAR colour temperature in kelvin, AWB, and AWB stored in memory A or B). Movements are never buffered: a camera that hangs for a moment does not play back old pan/tilt/zoom commands later, black balance and shooting mode. |
| **Engineering** | One action on one or many cameras at once, with the result and the camera's answer per camera: power on/standby, scene file, tally (enable, red, green, brightness), white balance (Auto/Var/A/B, VAR in kelvin, AWB, AWB stored in memory A or B, ABB), installation (desktop/hanging), preset scope A/B/C, fixed 3200K and 5600K, and **Setup for many cameras**: one form with frequency and format, shooting mode, OSD mix per output (`OSE:7B`, a bit per output), tally, status lamp, install position, pan/tilt and preset settings, wireless control, fans and the white balance of scenes 1 to 4; **Read from a camera…** fills it from one camera, **Apply** puts it on every ticked camera, sends only what differs and reads every value back (a frequency change restarts the camera, about 30 seconds; the app waits for it), IP video (H.264 streams on/off, experimental), and **Initialize** / **Save as default** for the default scene per model. |
| **Export** | Save the shading settings of any scene (scene files, `.pscene.json`) or an operator's own preferences (operator files, `.poper`), from one or many cameras. |
| **Import** | Put saved settings back on any camera and scene, with a comparison first, a backup and a check afterwards. **Initialize** (Engineering and Live) puts a default scene, saved once per model, into the live scene of all selected cameras the same way. |
| **Shows** | A complete setup (which scene and operator file goes to which camera and scene) recalled with one click. Made from the cameras, or in a grid from saved files, and editable afterwards (`.pshow`). |
| **Parameters** | Every REST command of the cameras and controllers with a ready-made link; scripts (PowerShell or shell) that run an action on many cameras at once, kept in the project and editable, also after reopening a saved script file; and what is in a scene file and an operator file per model. |
| **RP150 assignment** | Assign cameras to the CAM buttons of an AW-RP150 through its `Network.s15` file (experimental). |
| **Camera web pages** | The live and settings pages open in your browser through a small pass-through on this computer that signs in with the camera login, because browsers ignore a login in the address and the cameras ask with Digest authentication. |
| **Settings** | Projects (each with its own cameras, zones, shows, scripts, timing and web page paths), project files to open a project on another computer, closing a project, and the save folder. |

Exports, imports, saving an edited show, opening a project file and closing a project ask for confirmation first and show exactly what will happen. Changes in the app and on the cameras can be undone.

### Behaviour verified on a real AW-UE150 (V3.20)

- White balance `OAW`: 0 ATW, 1 A, 2 B, 4 3200K, 5 5600K, 9 VAR (`OAW:3` gives ATW); `QAW` answers 2/3 for A/B but 4/5 for 3200K/5600K. `OSE:77` (frequency) restarts the camera after about 13 s, back after about 26 s, with the format it last had at that frequency. `OSA:87` (format) changes at once and the outputs follow.

- Camera errors come back in upper case (`ER1:OSJ`, `ER2:XSF`, `ER3:XSF`); `ER2` also means "not changeable in the current mode" (Synchro Value while the shutter is in Step mode, Matrix values while the matrix type is Normal, a scene while in standby).
- Import, Initialize and show recall first read the camera (the backup) and only send values that differ. Values that belong to a mode that is off (Matrix and Color Correction with Matrix Type not User, Knee Point with Knee not Manual, F-REC/V-REC/HLG values with another gamma, Synchro/ELC values with another shutter mode, Picture Level with manual iris, ATW and VAR values with another white balance) are written by switching that mode on for a moment and putting it back to the file's value. Not covered: DownCon Detail, Skin Detail Effect and Frame mix (no mode found that enables them).
- Camera title `OSJ:5C` / `QSJ:5C` is 40 hex digits on the UE150 (`43414D38…` = "CAM8"); it is the same name as the web page's `cam_title`.
- `QAW` answers 2 for AWB A and 3 for AWB B (`OAW` takes 1 and 2). `#I` answers `iC80`.
- Easy IP changes need the handshake of the official tool: request `0x0002` from UDP port 10669, the camera answers `0x0003`, the app confirms with `0x0004`.
- Long command series go in parts of 20; a connection attempt that gets no answer within 0.2 s is started again at once instead of after the system's one-second retry.

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
python3 tools/mock_easyip.py &   # cameras in other IP ranges for the Cameras page search
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
