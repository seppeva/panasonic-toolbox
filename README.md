# Panasonic PTZ Scene Files

Web-app om **scene files (alle shading-instellingen van een scène)** uit Panasonic PTZ-camera's te exporteren en terug te importeren — iets wat de AW-RP120/RP150 zelf niet kan. Plus een hulpmiddel om camera's snel toe te wijzen op een **AW-RP150**.

Live: **https://seppevanaken.be/panasonicscene**

## Hoe het werkt

```
Browser (seppevanaken.be/panasonicscene)
        │  fetch http://127.0.0.1:8765
        ▼
Bridge op je laptop (bridge/panasonic_scene_bridge.py, Python 3, geen installatie)
        │  http://<camera-ip>/cgi-bin/aw_cam?cmd=…&res=1
        ▼
PTZ-camera's (AW-UE150 / UE150A / UE160 / UE100 / UE80 …)
```

Een https-website mag in de browser niet zelf naar `http://192.168.x.x` verbinden, en de camera's sturen geen CORS-headers. Daarom draait er een kleine **bridge** op je laptop. Die luistert enkel op `127.0.0.1`, aanvaardt enkel verzoeken van `seppevanaken.be` en stuurt standaard enkel door naar privé-IP-adressen.

## Gebruik op de set

1. Zet je laptop in de IP-range van de camera's (bv. `192.168.0.200 / 255.255.255.0`).
2. Start de bridge: `python3 bridge/panasonic_scene_bridge.py` (Windows: `py bridge\panasonic_scene_bridge.py`).
3. Open https://seppevanaken.be/panasonicscene in Chrome of Edge. Kies **Toestaan** als de browser vraagt om apparaten op het lokale netwerk te gebruiken.
   *Safari of geen internet?* Open dan `http://127.0.0.1:8765/`: de bridge serveert de app zelf (als je de volledige repo gedownload hebt).
4. **Camera's** → scan het netwerk (of voeg IP's manueel toe).
5. **Exporteren** → actieve scène (beeld blijft ongewijzigd) of gekozen scènes 1–4 (1–8 voor UE160). Meerdere camera's worden in één ZIP gebundeld.
6. **Importeren** → sleep `.pscene.json`- of `.zip`-bestanden erin, kies de doelcamera en de doelscène. Standaard wordt eerst een back-up van de doelscène gemaakt, daarna wordt alles teruggelezen en vergeleken.

### Bestandsformaat (`.pscene.json`)

```json
{
  "format": "panasonic-ptz-scene", "version": 1,
  "camera": { "ip": "192.168.0.11", "model": "AW-UE150", "title": "CAM1", "profile": "UE150" },
  "scenes": [ { "scene": 1,
    "params": [ { "cmd": "OSD:A4", "name": "R-G", "group": "Matrix", "raw": "OSD:A4:85", "value": "+5" } ],
    "unavailable": [] } ]
}
```

`raw` is exact het antwoord van de camera en wordt bij import opnieuw als commando gestuurd. Import gebeurt in drie rondes (modi eerst, wat faalt opnieuw, commando's met meerdere velden vereenvoudigd) en wordt daarna gecontroleerd. Bij een AW-UE160 wordt de scène ook opgeslagen met `OSL:90` (SCENE FILE STORE).

## Welke parameters?

Zie **[PARAMETERS.md](PARAMETERS.md)** of de tab *Parameterlijst* in de app (met CSV-export). Per model is dat exact de lijst “commands belonging to the scene” uit de Panasonic *Interface Specifications*:

| Model | Parameters |
|---|---|
| AW-UE150 / UE155 / HE145 | 111 |
| AW-UE150A | 110 |
| AW-UE160 | 198 (8 scene files) |
| AW-UE100 | 98 |
| AW-UE80 / UE50 / UE40 / UE30 | 85 |
| Andere (HE130, UE70, UE20, UE4, …) | algemene lijst, onbekende commando's worden overgeslagen |

Iris-positie, zoom/focus, presets en netwerk- of outputinstellingen horen niet bij een scène en zitten er dus niet in.

## RP150: camera's toewijzen

De RP150 heeft geen netwerk-API voor zijn instellingen. De tab *RP150 toewijzen* biedt:

- **Stappenplan**: neemt de gevonden camera's over (gesorteerd op IP of titel), nummert ze CAM 1…n en maakt een printbare checklist (`CONNECT SETTING › CNNCT MD = LAN`, `MANUAL IP SET › CAM IP`, `UPLOAD`).
- **Network.s15 bewerken (experimenteel)**: `CONNECT SETTING › DATA SAVE` op de RP150, bestand inladen, toewijzing toepassen, terugzetten en `DATA LOAD › YES+NW`. Het formaat is niet publiek. De app zoekt de IP-tabel heuristisch. Het verbindingstype leert hij door een tweede versie van het bestand te vergelijken, waarin je bij één camera het type veranderde. Bewaar altijd het origineel.

## Ontwikkelen / testen zonder camera's

```bash
python3 tools/mock_camera.py 127.0.0.11 8080 AW-UE150 "CAM 1" &
python3 tools/mock_camera.py 127.0.0.12 8080 AW-UE160 "CAM 2" &
python3 bridge/panasonic_scene_bridge.py --allow-origin http://localhost:9000 &
python3 -m http.server 9000     # open http://localhost:9000, scan 127.0.0.10-13 poort 8080
```

`catalog.js` wordt gegenereerd met `tools/build_catalog.py` en `tools/build_final.py` uit de Panasonic-specificaties (via [bitfocus/companion-module-panasonic-cameras](https://github.com/bitfocus/companion-module-panasonic-cameras)/docs).

## Publiceren op seppevanaken.be/panasonicscene

Heb je al een GitHub Pages-site op `seppevanaken.be` (repo `<gebruiker>.github.io` met custom domain)? Maak dan een repo **`panasonicscene`**, push deze bestanden naar `main` en zet *Settings › Pages › Deploy from branch › main / (root)* aan. GitHub publiceert hem automatisch op `https://seppevanaken.be/panasonicscene/`.

---
Niet officieel van Panasonic. Gebruik op eigen risico en test niet terwijl een camera on air is.
