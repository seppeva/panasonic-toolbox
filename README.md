# Panasonic Scene

Desktop-app voor **macOS en Windows** om **scene files (alle shading-instellingen van een scène)** van Panasonic PTZ-camera's te exporteren en terug te importeren. Dat kan een AW-RP120/RP150 zelf niet. De app heeft ook een hulpmiddel om camera's snel toe te wijzen op een **AW-RP150**.

Download- en uitlegpagina: **https://seppeva.github.io/panasonicscene/** (later eventueel op een eigen domein, zie onderaan)

## Opbouw van deze repo

| Pad | Wat |
|---|---|
| `index.html`, `privacy.html`, `install.sh`, `install.ps1`, `assets/` | De webpagina (GitHub Pages) met downloadknop, uitleg, privacyverklaring en installatiescripts |
| `app/panasonic_scene.py` | De app: lokale server op `127.0.0.1:8765` + eigen venster (pywebview) |
| `app/web/` | De interface (HTML/JS/CSS) en `catalog.js` met alle scène-parameters per model |
| `app/panasonic_scene.spec` | PyInstaller-configuratie (macOS .app en Windows .exe) |
| `installer/windows.iss` | Inno Setup-script voor de Windows-installer |
| `.github/workflows/release.yml` | Bouwt de Mac- en Windows-versies en zet ze in een GitHub Release |
| `tools/` | Mock-camera voor tests en de generatoren van `catalog.js` |
| `PARAMETERS.md` | Alle parameters in een scene file, per model |
| `PRIVACY.md`, `SECURITY.md`, `SIGNING.md`, `LICENSE`, `THIRD_PARTY_NOTICES.md` | Privacyverklaring, beveiliging, ondertekening, licentie (MIT) en open-sourcecomponenten |

## Hoe het werkt

```
Panasonic Scene (app op je laptop)
  ├─ venster met de interface  ──►  http://127.0.0.1:8765  (ingebouwde server)
  └─ ingebouwde server         ──►  http://<camera-ip>/cgi-bin/aw_cam?cmd=…&res=1
                                    http://<camera-ip>/cgi-bin/aw_ptz?cmd=…&res=1
```

Alles draait lokaal. Er is geen internet nodig, behalve voor de optionele controle op updates via de GitHub-releases.

## Een nieuwe versie publiceren

1. Eenmalig: maak de **publieke** repo `seppeva/panasonicscene`, push deze bestanden naar `main` en zet *Settings › Pages › Deploy from branch › `main` / root* aan. De pagina staat dan op `https://seppeva.github.io/panasonicscene/`.
2. Maak een tag en push hem:
   ```bash
   git tag v2.0.0
   git push origin v2.0.0
   ```
3. GitHub Actions bouwt dan automatisch:
   - `PanasonicScene-macOS-AppleSilicon.dmg` / `.zip`
   - `PanasonicScene-macOS-Intel.dmg` / `.zip`
   - `PanasonicScene-Windows-Setup.exe`
   - `PanasonicScene-Windows-Portable.zip`

   Daarna maakt Actions een Release aan. De downloadknoppen wijzen naar `releases/latest/download/…` en werken dus meteen. Het versienummer in de app wordt uit de tag gehaald.

Elke release bevat `SHA256SUMS.txt`; de installatiescripts controleren de download daarmee. Zonder ondertekening toont macOS of Windows de eerste keer een melding. Hoe je ondertekening aanzet (Apple-notarisatie gaat automatisch zodra de secrets er zijn), staat in [SIGNING.md](SIGNING.md).

## Eigen domein koppelen (later)
- Subdomein, bv. `panasonicscene.seppevanaken.be`: zet bij je DNS-beheerder een **CNAME** naar `seppeva.github.io` en vul het domein in onder *Settings › Pages › Custom domain*.
- `seppevanaken.be/panasonicscene`: kan alleen als het hoofddomein ook via een GitHub Pages-site van `seppeva` loopt.

De installatieregels op de pagina passen zich vanzelf aan het adres aan.

## Ontwikkelen zonder camera's

```bash
pip install pywebview            # optioneel; zonder pywebview opent de app in je browser
python3 tools/mock_camera.py 127.0.0.11 8080 AW-UE150 "CAM 1" &
python3 tools/mock_camera.py 127.0.0.12 8080 AW-UE160 "CAM 2" &
python3 app/panasonic_scene.py   # of --browser / --headless
# in de app: scan 127.0.0.10-13 op poort 8080
```

## Bestandsformaat (`.pscene.json`)

```json
{
  "format": "panasonic-ptz-scene", "version": 1,
  "camera": { "ip": "192.168.0.11", "model": "AW-UE150", "title": "CAM1", "profile": "UE150" },
  "scenes": [ { "scene": 1,
    "params": [ { "cmd": "OSD:A4", "name": "R-G", "group": "Matrix", "raw": "OSD:A4:85", "value": "+5" } ],
    "unavailable": [] } ]
}
```

Bestanden worden opgeslagen in *Downloads › Panasonic Scene* (bestaande bestanden worden nooit overschreven). `raw` is exact het antwoord van de camera en wordt bij import opnieuw als commando gestuurd. Import gebeurt in drie rondes:

1. alles in volgorde, met de modi eerst;
2. wat faalde nog eens;
3. commando's met meerdere velden vereenvoudigd.

Daarna wordt alles teruggelezen en vergeleken. Bij een AW-UE160 wordt de scène ook opgeslagen met `OSL:90` (SCENE FILE STORE).

## Welke parameters?

Per model exact de lijst met commando's die volgens de Panasonic *Interface Specifications* bij een scène horen:

| Model | Parameters |
|---|---|
| UE150 | 111 |
| UE150A | 110 |
| UE160 | 198 |
| UE100 | 98 |
| UE80-reeks | 85 |

De volledige lijst staat in [PARAMETERS.md](PARAMETERS.md).

---
Niet officieel van Panasonic. Gebruik op eigen risico en test niet terwijl een camera on air is.
