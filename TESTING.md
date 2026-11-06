# Testing Panasonic Toolbox on real cameras

This is the plan for a test run on real Panasonic PTZ cameras, written so that **Claude Code** (or a person) can follow it step by step on a computer in the same network as the cameras.

> The test cameras may be changed in every way: scenes, settings, white balance, tally, power, name and IP address. They are **not** used on air. Everything the tests change is put back at the end, and backups are written first.

## 0. Ask first

Before starting, ask the user for:

- the IP addresses of the test cameras, and the HTTP port if it is not 80;
- the camera login if User Auth is on;
- one **free IP address** in the same range, for the Easy IP test (moving a camera and back);
- which model each camera is, if they know (the test also reads it).

Do not use any other camera than the ones the user names. RP150 assignment is **not** tested yet (no real `Network.s15` file).

## 1. Prepare

```
git clone https://github.com/seppeva/panasonic-toolbox
cd panasonic-toolbox
python3 --version          # 3.9 or newer; on Windows use: py -3
```

No extra Python packages are needed for step 2. For step 3:

```
npm install playwright
npx playwright install chromium
```

Check that the computer reaches the cameras: `curl "http://<camera-ip>/cgi-bin/aw_cam?cmd=QID&res=1"` should answer `OID:AW-...`.

## 2. Protocol test (what the cameras really answer)

```
python3 tools/real_camera_test.py --cams 10.0.100.1,10.0.100.2 --network --spare-ip 10.0.100.250
```

Add `--user` / `--password` when User Auth is on. It takes a few minutes per camera. Per camera it checks:

| Area | What |
|---|---|
| Identify | model (QID), live scene (QSF), name (QSJ:5C and /cgi-bin/get_basic), power |
| Scene file | reads every setting the app's catalog lists for that model; lists refused and **unexpected** answers |
| Scene switching | XSF:1…n and that QSF then reports that scene (QSF counts from 0: OSF:0 = scene 1) |
| Import scene | puts scene 1's values into scene 2, reads them back, puts scene 2 back (UE160: also OSL:90) |
| Operator file | reads the 30 operator settings, writes the same values back, checks nothing changed |
| Live | white Auto/Var/A/B (OAW 0/9/1/2, UE160 fallback OSL:2A/2B), AWB, ABB, red/green tally (TLR/TLG and #DA), day/night (#D6), picture URLs |
| Move | pan, zoom, stop, back to the start position, preset 1 |
| Power | standby, on again while in standby, waits until it is on |
| Offline | 100 commands to an address without a camera must take seconds, not minutes |
| Easy IP | finds the cameras; with `--network`: renames the first camera and puts the name back, moves it to the spare IP and back |

Output in `tools/test-output/<date-time>/`: **report.md** (read this first), results.json (every check with the camera's raw answer), backups/ (scene and operator settings before the test).

If the Easy IP move fails, the report says how to put the camera back with Panasonic's Easy IP Setup. Cameras only accept a new IP within about 20 minutes after they are switched on.

## 3. Interface test (the app itself, clicked through)

Start the app **with its own empty data folder**, so the user's projects are not touched:

```
# Mac / Linux
HOME=$(mktemp -d) python3 app/panasonic_scene.py --headless
# Windows (PowerShell)
$env:APPDATA = "$env:TEMP\ptoolbox-test"; py -3 app/panasonic_scene.py --headless
```

Then, in a second terminal:

```
CAMS=10.0.100.1,10.0.100.2 node tools/ui_real_test.js
# with a login: CAM_USER=admin CAM_PASS=12345; other port: PORT=8080
```

It adds the cameras, edits them, presses every Live tile (white, AWB, ABB, tally, day/night, focus, iris, scenes, home, standby/on), exports scenes 1 and 2 and the operator files, imports them back with a backup and undoes that, makes a show from the cameras, recalls and edits it, sends a command and makes a script on the Parameters page, and saves and closes the project. Screenshots of every tab and `ui-log.txt` go to `tools/test-output/ui-<date-time>/`. The step "Live: every tile" lists for every button what the page showed, which tiles were lit and any message.

## 4. Look at the results

For every WARN or FAIL, find out whether the app or the expectation is wrong. Typical things to check:

- **Unexpected answers** in the scene or operator read: the catalog (`app/web/catalog.js`, made by `tools/build_catalog.py`) may list a command the model answers differently.
- **White Auto/Var/A/B**: does the mode the camera shows in its own menu (or web page) match the button? The app sends OAW 0 = Auto (ATW), 9 = Var, 1 = A, 2 = B.
- **Tally**: if commands are accepted but the lamp stays off, "Tally Enable" is off in the camera menu; that is a setting, not an app bug.
- **Names**: older models get their name from /cgi-bin/get_basic; check that the right name shows in the Cameras list.
- **Timing**: a camera that is off or unplugged must give "Not reachable" within seconds everywhere (Cameras, Live, Export, Import, Shows).
- Also open the app with its window once (`python3 app/panasonic_scene.py`) and start it a second time: the open window must come to the front, no browser tab.

Write a short report for the user: per camera what works, what does not, the raw answers that show why, and a proposed fix.

## 5. Fixing

Make fixes on a **new branch** and test them again with the same scripts. Ask the user before merging into `main`: every push to `main` that changes the app builds and publishes a new release automatically.
