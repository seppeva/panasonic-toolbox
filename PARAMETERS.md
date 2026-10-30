# Parameters in een scene file

Dit zijn alle parameters die mee veranderen wanneer je op een controller van scène wisselt (XSF). Bron: per model de tabel *"When switching scene, update notification of each command belonging to the scene will be sent"* uit de officiële Panasonic *Interface Specifications*, aangevuld met de *Compatible model Table* (maart 2025).

Elke parameter wordt uitgelezen met het opvraagcommando (bv. `QSD:A4`) en teruggezet door het antwoord (bv. `OSD:A4:80`) opnieuw te sturen naar `/cgi-bin/aw_cam`. Dag/Nacht gaat via `/cgi-bin/aw_ptz` (`#D6`).

Andere modellen (HE130, UE70, UE20, UE4, UR100, HR140 …) gebruiken een algemene lijst van alle bekende scène-commando’s; wat de camera niet kent (`ER1`) wordt overgeslagen.

## AW-UE150 / UE155 / HE145 / UN145 — 111 parameters

| Groep | Parameter | Zetten | Opvragen |
|---|---|---|---|
| Brightness | Picture Level | `OSD:48:[Data]` | `QSD:48` |
| Brightness | Iris Mode | `ORS:[Data]` | `QRS` |
| Brightness | Auto Iris Speed | `OSJ:01:[Data]` | `QSJ:01` |
| Brightness | Auto Iris Window | `OSJ:02:[Data]` | `QSJ:02` |
| Brightness | Auto Iris Close Limit | `OSJ:C0:[Data]` | `QSJ:C0` |
| Brightness | Shutter Mode | `OSJ:03:[Data]` | `QSJ:03` |
| Brightness | Shutter Step Value | `OSJ:06:[Data]` | `QSJ:06` |
| Brightness | Shutter Synchro Value | `OSJ:09:[Data]` | `QSJ:09` |
| Brightness | ELC Limit | `OSD:BF:[Data]` | `QSD:BF` |
| Brightness | Gain | `OGU:[Data]` | `QGU` |
| Brightness | Super Gain | `OSI:28:[Data]` | `QSI:28` |
| Brightness | AGC Max Gain | `OSD:69:[Data]` | `QSD:69` |
| Brightness | Frame mix | `OSA:65:[Data]` | `QSA:65` |
| Brightness | ND Filter | `OFT:[Data]` | `QFT` |
| Brightness | Day/Night | `#D6[Data]` | `#D6` |
| Picture | White Balance Mode | `OAW:[Data]` | `QAW` |
| Picture | Color Temperature | `OSI:20:[Data]` | `QSI:20` |
| Picture | R Gain [OSG:39] | `OSG:39:[Data]` | `QSG:39` |
| Picture | B Gain [OSG:3A] | `OSG:3A:[Data]` | `QSG:3A` |
| Picture | AWB Color Temperature | `OSJ:4A:[Data]` | `QSJ:4A` |
| Picture | R Gain (AWB R Gain) | `OSJ:4B:[Data]` | `QSJ:4B` |
| Picture | B Gain (AWB B Gain) | `OSJ:4C:[Data]` | `QSJ:4C` |
| Picture | G Axis | `OSJ:4D:[Data]` | `QSJ:4D` |
| Picture | AWB Gain Offset | `OSJ:0C:[Data]` | `QSJ:0C` |
| Picture | ATW Speed | `OSI:25:[Data]` | `QSI:25` |
| Picture | ATW Target R | `OSJ:0D:[Data]` | `QSJ:0D` |
| Picture | ATW Target B | `OSJ:0E:[Data]` | `QSJ:0E` |
| Picture | Chroma Level | `OSD:B0:[Data]` | `QSD:B0` |
| Picture | Chroma Phase | `OSJ:0B:[Data]` | `QSJ:0B` |
| Picture | Master Pedestal | `OSJ:0F:[Data]` | `QSJ:0F` |
| Picture | R Pedestal | `ORP:[Data]` | `QRP` |
| Picture | G Pedestal | `OSJ:10:[Data]` | `QSJ:10` |
| Picture | B Pedestal | `OBP:[Data]` | `QBP` |
| Picture | Pedestal Offset | `OSJ:11:[Data]` | `QSJ:11` |
| Picture | Detail | `ODT:[Data]` | `QDT` |
| Picture | Master Detail | `OSA:30:[Data]` | `QSA:30` |
| Picture | Detail Coring | `OSJ:12:[Data]` | `QSJ:12` |
| Picture | V Detail Level | `OSD:A1:[Data]` | `QSD:A1` |
| Picture | Detail Frequency | `OSD:A2:[Data]` | `QSD:A2` |
| Picture | Level Depend. | `OSJ:13:[Data]` | `QSJ:13` |
| Picture | Knee Aperture Level | `OSG:3F:[Data]` | `QSG:3F` |
| Picture | Detail Gain(+) | `OSA:38:[Data]` | `QSA:38` |
| Picture | Detail Gain(-) | `OSA:39:[Data]` | `QSA:39` |
| Picture | Skin Detail | `OSA:40:[Data]` | `QSA:40` |
| Picture | Skin Detail Effect | `OSD:A3:[Data]` | `QSD:A3` |
| Picture | DownCon Detail | `OSJ:14:[Data]` | `QSJ:14` |
| Picture | DC. Master Detail | `OSJ:15:[Data]` | `QSJ:15` |
| Picture | DC. Detail Coring | `OSJ:16:[Data]` | `QSJ:16` |
| Picture | DC. V Detail Level | `OSJ:17:[Data]` | `QSJ:17` |
| Picture | DC. Detail Frequency | `OSJ:18:[Data]` | `QSJ:18` |
| Picture | DC. Level Depend. | `OSJ:19:[Data]` | `QSJ:19` |
| Picture | DC. Knee Aperture Level | `OSJ:1A:[Data]` | `QSJ:1A` |
| Picture | Gamma Mode | `OSE:72:[Data]` | `QSE:72` |
| Picture | Gamma | `OSA:6A:[Data]` | `QSA:6A` |
| Picture | F-REC Dynamic Level | `OSA:10:[Data]` | `QSA:10` |
| Picture | F-REC Black STR. Level | `OSA:0F:[Data]` | `QSA:0F` |
| Picture | V-REC Knee Slope | `OSA:25:[Data]` | `QSA:25` |
| Picture | V-REC Knee Point | `OSA:21:[Data]` | `QSA:21` |
| Picture | Black Gamma | `OSA:07:[Data]` | `QSA:07` |
| Picture | Black Gamma Range | `OSJ:1B:[Data]` | `QSJ:1B` |
| Picture | DRS | `OSE:33:[Data]` | `QSE:33` |
| Picture | Knee mode | `OSA:2D:[Data]` | `QSA:2D` |
| Picture | Auto Knee Response | `OSG:97:[Data]` | `QSG:97` |
| Picture | Knee Point | `OSA:20:[Data]` | `QSA:20` |
| Picture | Knee Slope | `OSA:24:[Data]` | `QSA:24` |
| Picture | HLG Knee | `OSI:40:[Data]` | `QSI:40` |
| Picture | HLG Knee Point | `OSI:41:[Data]` | `QSI:41` |
| Picture | HLG Knee Slope | `OSI:42:[Data]` | `QSI:42` |
| Picture | White Clip | `OSA:2E:[Data]` | `QSA:2E` |
| Picture | White Clip Level | `OSA:2A:[Data]` | `QSA:2A` |
| Picture | DNR | `OSD:3A:[Data]` | `QSD:3A` |
| Matrix | Matrix Type | `OSE:31:[Data]` | `QSE:31` |
| Matrix | Adaptive Matrix | `OSJ:4F:[Data]` | `QSJ:4F` |
| Matrix | Matrix(R-G) | `OSD:A4:[Data]` | `QSD:A4` |
| Matrix | Matrix(R-B) | `OSD:A5:[Data]` | `QSD:A5` |
| Matrix | Matrix(G-R) | `OSD:A6:[Data]` | `QSD:A6` |
| Matrix | Matrix(G-B) | `OSD:A7:[Data]` | `QSD:A7` |
| Matrix | Matrix(B-R) | `OSD:A8:[Data]` | `QSD:A8` |
| Matrix | Matrix(B-G) | `OSD:A9:[Data]` | `QSD:A9` |
| Matrix | Color Correction B_Mg Saturation | `OSD:80:[Data]` | `QSD:80` |
| Matrix | Color Correction B_Mg Phase | `OSD:81:[Data]` | `QSD:81` |
| Matrix | Color Correction Mg Saturation | `OSD:82:[Data]` | `QSD:82` |
| Matrix | Color Correction Mg Phase | `OSD:83:[Data]` | `QSD:83` |
| Matrix | Color Correction Mg_R Saturation | `OSD:84:[Data]` | `QSD:84` |
| Matrix | Color Correction Mg_R Phase | `OSD:85:[Data]` | `QSD:85` |
| Matrix | Color Correction Mg_R_R Saturation | `OSD:9A:[Data]` | `QSD:9A` |
| Matrix | Color Correction Mg_R_R Phase | `OSD:9B:[Data]` | `QSD:9B` |
| Matrix | Color Correction R Saturation | `OSD:86:[Data]` | `QSD:86` |
| Matrix | Color Correction R Phase | `OSD:87:[Data]` | `QSD:87` |
| Matrix | Color Correction R_R_Yl Saturation | `OSD:9C:[Data]` | `QSD:9C` |
| Matrix | Color Correction R_R_Yl Phase | `OSD:9D:[Data]` | `QSD:9D` |
| Matrix | Color Correction R_Yl Saturation | `OSD:88:[Data]` | `QSD:88` |
| Matrix | Color Correction R_Yl Phase | `OSD:89:[Data]` | `QSD:89` |
| Matrix | Color Correction R_Yl_Yl Saturation | `OSD:9E:[Data]` | `QSD:9E` |
| Matrix | Color Correction R_Yl_Yl Phase | `OSD:9F:[Data]` | `QSD:9F` |
| Matrix | Color Correction Yl Saturation | `OSD:8A:[Data]` | `QSD:8A` |
| Matrix | Color Correction Yl Phase | `OSD:8B:[Data]` | `QSD:8B` |
| Matrix | Color Correction Yl_Yl_G Saturation | `OSJ:1C:[Data]` | `QSJ:1C` |
| Matrix | Color Correction Yl_Yl_G Phase | `OSJ:1D:[Data]` | `QSJ:1D` |
| Matrix | Color Correction Yl_G Saturation | `OSD:8C:[Data]` | `QSD:8C` |
| Matrix | Color Correction Yl_G Phase | `OSD:8D:[Data]` | `QSD:8D` |
| Matrix | Color Correction G Saturation | `OSD:8E:[Data]` | `QSD:8E` |
| Matrix | Color Correction G Phase | `OSD:8F:[Data]` | `QSD:8F` |
| Matrix | Color Correction G_Cy Saturation | `OSD:90:[Data]` | `QSD:90` |
| Matrix | Color Correction G_Cy Phase | `OSD:91:[Data]` | `QSD:91` |
| Matrix | Color Correction Cy Saturation | `OSD:92:[Data]` | `QSD:92` |
| Matrix | Color Correction Cy Phase | `OSD:93:[Data]` | `QSD:93` |
| Matrix | Color Correction Cy_B Saturation | `OSD:94:[Data]` | `QSD:94` |
| Matrix | Color Correction Cy_B Phase | `OSD:95:[Data]` | `QSD:95` |
| Matrix | Color Correction B Saturation | `OSD:96:[Data]` | `QSD:96` |
| Matrix | Color Correction B Phase | `OSD:97:[Data]` | `QSD:97` |

## AW-UE150A — 110 parameters

| Groep | Parameter | Zetten | Opvragen |
|---|---|---|---|
| Brightness | Picture Level | `OSD:48:[Data]` | `QSD:48` |
| Brightness | Iris Mode | `ORS:[Data]` | `QRS` |
| Brightness | Auto Iris Speed | `OSJ:01:[Data]` | `QSJ:01` |
| Brightness | Auto Iris Window | `OSJ:02:[Data]` | `QSJ:02` |
| Brightness | Auto Iris Close Limit | `OSJ:C0:[Data]` | `QSJ:C0` |
| Brightness | Shutter Mode | `OSJ:03:[Data]` | `QSJ:03` |
| Brightness | Shutter Step Value | `OSJ:06:[Data]` | `QSJ:06` |
| Brightness | Shutter Synchro Value | `OSJ:09:[Data]` | `QSJ:09` |
| Brightness | ELC Limit | `OSD:BF:[Data]` | `QSD:BF` |
| Brightness | Gain | `OGU:[Data]` | `QGU` |
| Brightness | Super Gain | `OSI:28:[Data]` | `QSI:28` |
| Brightness | AGC Max Gain | `OSD:69:[Data]` | `QSD:69` |
| Brightness | Frame Mix | `OSA:65:[Data]` | `QSA:65` |
| Brightness | ND Filter | `OFT:[Data]` | `QFT` |
| Brightness | Day/Night | `#D6[Data]` | `#D6` |
| Picture | White Balance Mode | `OAW:[Data]` | `QAW` |
| Picture | Color Temperature | `OSI:20:[Data]` | `QSI:20` |
| Picture | R Gain [OSG:39] | `OSG:39:[Data]` | `QSG:39` |
| Picture | B Gain [OSG:3A] | `OSG:3A:[Data]` | `QSG:3A` |
| Picture | AWB Color Temperature | `OSJ:4A:[Data]` | `QSJ:4A` |
| Picture | R Gain (AWB R Gain) | `OSJ:4B:[Data]` | `QSJ:4B` |
| Picture | B Gain (AWB B Gain) | `OSJ:4C:[Data]` | `QSJ:4C` |
| Picture | G Axis | `OSJ:4D:[Data]` | `QSJ:4D` |
| Picture | AWB Gain Offset | `OSJ:0C:[Data]` | `QSJ:0C` |
| Picture | ATW Speed | `OSI:25:[Data]` | `QSI:25` |
| Picture | ATW Target R | `OSJ:0D:[Data]` | `QSJ:0D` |
| Picture | ATW Target B | `OSJ:0E:[Data]` | `QSJ:0E` |
| Picture | Chroma Level | `OSD:B0:[Data]` | `QSD:B0` |
| Picture | Chroma Phase | `OSJ:0B:[Data]` | `QSJ:0B` |
| Picture | Master Pedestal | `OSJ:0F:[Data]` | `QSJ:0F` |
| Picture | R Pedestal | `ORP:[Data]` | `QRP` |
| Picture | G Pedestal | `OSJ:10:[Data]` | `QSJ:10` |
| Picture | B Pedestal | `OBP:[Data]` | `QBP` |
| Picture | Pedestal Offset | `OSJ:11:[Data]` | `QSJ:11` |
| Picture | Detail | `ODT:[Data]` | `QDT` |
| Picture | Master Detail | `OSA:30:[Data]` | `QSA:30` |
| Picture | Detail Coring | `OSJ:12:[Data]` | `QSJ:12` |
| Picture | V Detail Level | `OSD:A1:[Data]` | `QSD:A1` |
| Picture | Detail Frequency | `OSD:A2:[Data]` | `QSD:A2` |
| Picture | Level Depend. | `OSJ:13:[Data]` | `QSJ:13` |
| Picture | Knee Aperture Level | `OSG:3F:[Data]` | `QSG:3F` |
| Picture | Detail Gain(+) | `OSA:38:[Data]` | `QSA:38` |
| Picture | Detail Gain(-) | `OSA:39:[Data]` | `QSA:39` |
| Picture | Skin Detail | `OSA:40:[Data]` | `QSA:40` |
| Picture | Skin Detail Effect | `OSD:A3:[Data]` | `QSD:A3` |
| Picture | DownCon Detail | `OSJ:14:[Data]` | `QSJ:14` |
| Picture | DC. Master Detail | `OSJ:15:[Data]` | `QSJ:15` |
| Picture | DC. Detail Coring | `OSJ:16:[Data]` | `QSJ:16` |
| Picture | DC. Detail Frequency | `OSJ:18:[Data]` | `QSJ:18` |
| Picture | Gamma Mode | `OSE:72:[Data]` | `QSE:72` |
| Picture | Gamma | `OSA:6A:[Data]` | `QSA:6A` |
| Picture | F-REC Dynamic Level | `OSA:10:[Data]` | `QSA:10` |
| Picture | F-REC Black STR. Level | `OSA:0F:[Data]` | `QSA:0F` |
| Picture | V-REC Knee Slope | `OSA:25:[Data]` | `QSA:25` |
| Picture | V-REC Knee Point | `OSA:21:[Data]` | `QSA:21` |
| Picture | Black Gamma | `OSA:07:[Data]` | `QSA:07` |
| Picture | Black Gamma Range | `OSJ:1B:[Data]` | `QSJ:1B` |
| Picture | DRS | `OSE:33:[Data]` | `QSE:33` |
| Picture | Knee Mode | `OSA:2D:[Data]` | `QSA:2D` |
| Picture | Auto Knee Response | `OSG:97:[Data]` | `QSG:97` |
| Picture | Knee Point | `OSA:20:[Data]` | `QSA:20` |
| Picture | Knee Slope | `OSA:24:[Data]` | `QSA:24` |
| Picture | HLG Knee | `OSI:40:[Data]` | `QSI:40` |
| Picture | HLG Knee Point | `OSI:41:[Data]` | `QSI:41` |
| Picture | HLG Knee Slope | `OSI:42:[Data]` | `QSI:42` |
| Picture | White Clip | `OSA:2E:[Data]` | `QSA:2E` |
| Picture | White Clip Level | `OSA:2A:[Data]` | `QSA:2A` |
| Picture | DNR | `OSD:3A:[Data]` | `QSD:3A` |
| Matrix | Matrix Type | `OSE:31:[Data]` | `QSE:31` |
| Matrix | Adaptive Matrix | `OSJ:4F:[Data]` | `QSJ:4F` |
| Matrix | Matrix(R-G) | `OSD:A4:[Data]` | `QSD:A4` |
| Matrix | Matrix(R-B) | `OSD:A5:[Data]` | `QSD:A5` |
| Matrix | Matrix(G-R) | `OSD:A6:[Data]` | `QSD:A6` |
| Matrix | Matrix(G-B) | `OSD:A7:[Data]` | `QSD:A7` |
| Matrix | Matrix(B-R) | `OSD:A8:[Data]` | `QSD:A8` |
| Matrix | Matrix(B-G) | `OSD:A9:[Data]` | `QSD:A9` |
| Matrix | Color Correction B_Mg Saturation | `OSD:80:[Data]` | `QSD:80` |
| Matrix | Color Correction B_Mg Phase | `OSD:81:[Data]` | `QSD:81` |
| Matrix | Color Correction Mg Saturation | `OSD:82:[Data]` | `QSD:82` |
| Matrix | Color Correction Mg Phase | `OSD:83:[Data]` | `QSD:83` |
| Matrix | Color Correction Mg_R Saturation | `OSD:84:[Data]` | `QSD:84` |
| Matrix | Color Correction Mg_R Phase | `OSD:85:[Data]` | `QSD:85` |
| Matrix | Color Correction Mg_R_R Saturation | `OSD:9A:[Data]` | `QSD:9A` |
| Matrix | Color Correction Mg_R_R Phase | `OSD:9B:[Data]` | `QSD:9B` |
| Matrix | Color Correction R Saturation | `OSD:86:[Data]` | `QSD:86` |
| Matrix | Color Correction R Phase | `OSD:87:[Data]` | `QSD:87` |
| Matrix | Color Correction R_R_Yl Saturation | `OSD:9C:[Data]` | `QSD:9C` |
| Matrix | Color Correction R_R_Yl Phase | `OSD:9D:[Data]` | `QSD:9D` |
| Matrix | Color Correction R_Yl Saturation | `OSD:88:[Data]` | `QSD:88` |
| Matrix | Color Correction R_Yl Phase | `OSD:89:[Data]` | `QSD:89` |
| Matrix | Color Correction R_Yl_Yl Saturation | `OSD:9E:[Data]` | `QSD:9E` |
| Matrix | Color Correction R_Yl_Yl Phase | `OSD:9F:[Data]` | `QSD:9F` |
| Matrix | Color Correction Yl Saturation | `OSD:8A:[Data]` | `QSD:8A` |
| Matrix | Color Correction Yl Phase | `OSD:8B:[Data]` | `QSD:8B` |
| Matrix | Color Correction Yl_Yl_G Saturation | `OSJ:1C:[Data]` | `QSJ:1C` |
| Matrix | Color Correction Yl_Yl_G Phase | `OSJ:1D:[Data]` | `QSJ:1D` |
| Matrix | Color Correction Yl_G Saturation | `OSD:8C:[Data]` | `QSD:8C` |
| Matrix | Color Correction Yl_G Phase | `OSD:8D:[Data]` | `QSD:8D` |
| Matrix | Color Correction G Saturation | `OSD:8E:[Data]` | `QSD:8E` |
| Matrix | Color Correction G Phase | `OSD:8F:[Data]` | `QSD:8F` |
| Matrix | Color Correction G_Cy Saturation | `OSD:90:[Data]` | `QSD:90` |
| Matrix | Color Correction G_Cy Phase | `OSD:91:[Data]` | `QSD:91` |
| Matrix | Color Correction Cy Saturation | `OSD:92:[Data]` | `QSD:92` |
| Matrix | Color Correction Cy Phase | `OSD:93:[Data]` | `QSD:93` |
| Matrix | Color Correction Cy_B Saturation | `OSD:94:[Data]` | `QSD:94` |
| Matrix | Color Correction Cy_B Phase | `OSD:95:[Data]` | `QSD:95` |
| Matrix | Color Correction B Saturation | `OSD:96:[Data]` | `QSD:96` |
| Matrix | Color Correction B Phase | `OSD:97:[Data]` | `QSD:97` |
| Other | Auto F.Mix Max Gain | `OSE:74:[Data]` | `QSE:74` |
| Other | AUTO IRIS WINDOW POSITION | `OSL:CD:[Data]` | `QSL:CD` |

## AW-UE160 (8 scene files) — 198 parameters

| Groep | Parameter | Zetten | Opvragen |
|---|---|---|---|
| PAINT | AGC | `OSL:26:[Data]` | `QSL:26` |
| PAINT | Iris Mode | `ORS:[Data]` | `QRS` |
| PAINT | ATW | `OSL:2A:[Data]` | `QSL:2A` |
| PAINT | Auto Shutter | `OSL:2E:[Data]` | `QSL:2E` |
| PAINT | Knee Mode [OSL:46] | `OSL:46:[Data]` | `QSL:46` |
| PAINT | Gain [OSL:25] | `OSL:25:[Data]` | `QSL:25` |
| PAINT | Gain [OGU] | `OGU:[Data]` | `QGU` |
| PAINT | AGC Max Gain | `OSD:69:[Data]` | `QSD:69` |
| PAINT | Frame Mix SW | `OSL:27:[Data]` | `QSL:27` |
| PAINT | Frame Mix [OSL:28] | `OSL:28:[Data]` | `QSL:28` |
| PAINT | Frame Mix [OSA:65] | `OSA:65:[Data]` | `QSA:65` |
| PAINT | Day/Night | `#D6[Data]` | `#D6` |
| PAINT | AUTO IRIS WINDOW POSITION | `OSL:CD:[Data]` | `QSL:CD` |
| PAINT | Picture Level | `OSD:48:[Data]` | `QSD:48` |
| PAINT | White Balance Mode [OSL:2B] | `OSL:2B:[Data]` | `QSL:2B` |
| PAINT | White Balance Mode [OAW] | `OAW:[Data]` | `QAW` |
| PAINT | Color Temperature | `OSI:20:[Data]` | `QSI:20` |
| PAINT | ATW Speed | `OSI:25:[Data]` | `QSI:25` |
| PAINT | ATW Target R | `OSJ:0D:[Data]` | `QSJ:0D` |
| PAINT | ATW Target B | `OSJ:0E:[Data]` | `QSJ:0E` |
| PAINT | Shockless WB SW | `OSL:2C:[Data]` | `QSL:2C` |
| PAINT | Shockless WB Speed | `OSL:2D:[Data]` | `QSL:2D` |
| PAINT | Shutter SW | `OSG:59:[Data]` | `QSG:59` |
| PAINT | Auto Shutter Limit | `OSD:BF:[Data]` | `QSD:BF` |
| PAINT | Shutter Mode [OSG:5A] | `OSG:5A:[Data]` | `QSG:5A` |
| PAINT | Shutter Mode [OSJ:03] | `OSJ:03:[Data]` | `QSJ:03` |
| PAINT | Shutter Step Value | `OSJ:06:[Data]` | `QSJ:06` |
| PAINT | Shutter Synchro Value | `OSJ:09:[Data]` | `QSJ:09` |
| PAINT | Master Pedestal | `OSJ:0F:[Data]` | `QSJ:0F` |
| PAINT | R Pedestal | `OSG:4C:[Data]` | `QSG:4C` |
| PAINT | G Pedestal | `OSG:4D:[Data]` | `QSG:4D` |
| PAINT | B Pedestal | `OSG:4E:[Data]` | `QSG:4E` |
| PAINT | Pedestal Offset | `OSJ:11:[Data]` | `QSJ:11` |
| PAINT | Chroma Level SW | `OSG:93:[Data]` | `QSG:93` |
| PAINT | Chroma Level [OSL:B0] | `OSL:B0:[Data]` | `QSL:B0` |
| PAINT | Chroma Level [OSD:B0] | `OSD:B0:[Data]` | `QSD:B0` |
| COLOR TEMP SETTING | AWB Color Temperature | `OSJ:4A:[Data]` | `QSJ:4A` |
| COLOR TEMP SETTING | R Gain ACH (AWB R Gain) | `OSJ:4B:[Data]` | `QSJ:4B` |
| COLOR TEMP SETTING | B Gain ACH (AWB B Gain) | `OSJ:4C:[Data]` | `QSJ:4C` |
| COLOR TEMP SETTING | G Axis ACH | `OSJ:4D:[Data]` | `QSJ:4D` |
| COLOR TEMP SETTING | Color Temp BCH | `OSL:2F:[Data]` | `QSL:2F` |
| COLOR TEMP SETTING | R Gain BCH (Color Temp R Gain Bch) | `OSL:32:[Data]` | `QSL:32` |
| COLOR TEMP SETTING | B Gain BCH (Color Temp B Gain Bch) | `OSL:33:[Data]` | `QSL:33` |
| COLOR TEMP SETTING | G Axis BCH | `OSL:34:[Data]` | `QSL:34` |
| RGB GAIN CONTROL SETTING | G Gain Rel Control SW | `OSL:35:[Data]` | `QSL:35` |
| RGB GAIN CONTROL SETTING | R Gain | `OSL:36:[Data]` | `QSL:36` |
| RGB GAIN CONTROL SETTING | G Gain | `OSL:37:[Data]` | `QSL:37` |
| RGB GAIN CONTROL SETTING | B Gain | `OSL:38:[Data]` | `QSL:38` |
| RGB GAIN CONTROL SETTING | R Gain ACH (RGB Gain R Gain Ach) | `OSL:39:[Data]` | `QSL:39` |
| RGB GAIN CONTROL SETTING | G Gain ACH | `OSL:3A:[Data]` | `QSL:3A` |
| RGB GAIN CONTROL SETTING | B Gain ACH (RGB Gain B Gain Ach) | `OSL:3B:[Data]` | `QSL:3B` |
| RGB GAIN CONTROL SETTING | Gain Offset ACH | `OSJ:0C:[Data]` | `QSJ:0C` |
| RGB GAIN CONTROL SETTING | R Gain BCH (RGB Gain R Gain Bch) | `OSL:3C:[Data]` | `QSL:3C` |
| RGB GAIN CONTROL SETTING | G Gain BCH | `OSL:3D:[Data]` | `QSL:3D` |
| RGB GAIN CONTROL SETTING | B Gain BCH (RGB Gain B Gain Bch) | `OSL:3E:[Data]` | `QSL:3E` |
| RGB GAIN CONTROL SETTING | Gain Offset BCH | `OSL:3F:[Data]` | `QSL:3F` |
| FLARE | Flare | `OSA:11:[Data]` | `QSA:11` |
| FLARE | Master Flare | `OSL:40:[Data]` | `QSL:40` |
| FLARE | R Flare | `OSL:41:[Data]` | `QSL:41` |
| FLARE | G Flare | `OSL:42:[Data]` | `QSL:42` |
| FLARE | B Flare | `OSL:43:[Data]` | `QSL:43` |
| GAMMA/BLACK GAMMA | Gamma | `OSA:0A:[Data]` | `QSA:0A` |
| GAMMA/BLACK GAMMA | Gamma Mode Select | `OSJ:D7:[Data]` | `QSJ:D7` |
| GAMMA/BLACK GAMMA | Master Gamma | `OSA:6A:[Data]` | `QSA:6A` |
| GAMMA/BLACK GAMMA | R Gamma | `OSI:35:[Data]` | `QSI:35` |
| GAMMA/BLACK GAMMA | B Gamma | `OSI:36:[Data]` | `QSI:36` |
| GAMMA/BLACK GAMMA | Black Gamma (Black Gamma SW) | `OSA:0B:[Data]` | `QSA:0B` |
| GAMMA/BLACK GAMMA | Master Black Gamma [OSA:07] | `OSA:07:[Data]` | `QSA:07` |
| GAMMA/BLACK GAMMA | R Black Gamma [OSA:08] | `OSA:08:[Data]` | `QSA:08` |
| GAMMA/BLACK GAMMA | B Black Gamma [OSA:09] | `OSA:09:[Data]` | `QSA:09` |
| GAMMA/BLACK GAMMA | Black Gamma Range | `OSJ:1B:[Data]` | `QSJ:1B` |
| GAMMA/BLACK GAMMA | Initial Gamma | `OSL:44:[Data]` | `QSL:44` |
| KNEE | Knee [OSL:45] | `OSL:45:[Data]` | `QSL:45` |
| KNEE | Knee Mode [OSA:2D] | `OSA:2D:[Data]` | `QSA:2D` |
| KNEE | Knee Master Point | `OSA:20:[Data]` | `QSA:20` |
| KNEE | Knee R Point | `OSA:22:[Data]` | `QSA:22` |
| KNEE | Knee B Point | `OSA:23:[Data]` | `QSA:23` |
| KNEE | Knee Master Slope | `OSA:24:[Data]` | `QSA:24` |
| KNEE | Knee R Slope | `OSA:26:[Data]` | `QSA:26` |
| KNEE | Knee B Slope | `OSA:27:[Data]` | `QSA:27` |
| KNEE | Auto Knee Response | `OSG:97:[Data]` | `QSG:97` |
| WHITE CLIP | White Clip | `OSA:2E:[Data]` | `QSA:2E` |
| WHITE CLIP | Master White Clip Level | `OSA:2A:[Data]` | `QSA:2A` |
| WHITE CLIP | R White Clip Level | `OSL:47:[Data]` | `QSL:47` |
| WHITE CLIP | B White Clip Level | `OSL:48:[Data]` | `QSL:48` |
| WHITE CLIP | Hi-Color | `OSL:49:[Data]` | `QSL:49` |
| WHITE CLIP | Hi-Color Level | `OSL:4A:[Data]` | `QSL:4A` |
| DRS | DRS | `OSA:0D:[Data]` | `QSA:0D` |
| DRS | Effect Depth | `OSL:4B:[Data]` | `QSL:4B` |
| DETAIL SETTING | Detail | `ODT:[Data]` | `QDT` |
| DETAIL SETTING | Master Detail | `OSA:30:[Data]` | `QSA:30` |
| DETAIL SETTING | Peak Frequency | `OSG:30:[Data]` | `QSG:30` |
| DETAIL SETTING | Crisp | `OSD:22:[Data]` | `QSD:22` |
| DETAIL SETTING | Detail Gain(+) | `OSA:38:[Data]` | `QSA:38` |
| DETAIL SETTING | Detail Gain(-) | `OSA:39:[Data]` | `QSA:39` |
| DETAIL SETTING | Detail Clip(+) | `OSG:40:[Data]` | `QSG:40` |
| DETAIL SETTING | Detail Clip(-) | `OSG:41:[Data]` | `QSG:41` |
| DETAIL SETTING | Knee Aperture Level | `OSG:3F:[Data]` | `QSG:3F` |
| DETAIL SETTING | Detail Knee | `OSL:4C:[Data]` | `QSL:4C` |
| DETAIL SETTING | Level Dependent SW | `OSG:3E:[Data]` | `QSG:3E` |
| DETAIL SETTING | Level Dependent | `OSD:26:[Data]` | `QSD:26` |
| DETAIL SETTING | Dark Detail SW | `OSL:4D:[Data]` | `QSL:4D` |
| DETAIL SETTING | Dark Detail | `OSL:4E:[Data]` | `QSL:4E` |
| DOWNCON SETTING | Down Convert Chroma Level SW | `OSL:4F:[Data]` | `QSL:4F` |
| DOWNCON SETTING | Down Convert Chroma Level | `OSL:50:[Data]` | `QSL:50` |
| DOWNCON SETTING | Down Convert Detail | `OSJ:14:[Data]` | `QSJ:14` |
| DOWNCON SETTING | Down Convert Master Detail | `OSJ:15:[Data]` | `QSJ:15` |
| DOWNCON SETTING | Down Convert H Detail Level | `OSL:51:[Data]` | `QSL:51` |
| DOWNCON SETTING | Down Convert V Detail Level | `OSJ:17:[Data]` | `QSJ:17` |
| DOWNCON SETTING | Down Convert Detail Peak Frequency | `OSL:52:[Data]` | `QSL:52` |
| DOWNCON SETTING | Down Convert V Detail Frequency | `OSL:53:[Data]` | `QSL:53` |
| DOWNCON SETTING | Down Convert Detail Crisp | `OSL:54:[Data]` | `QSL:54` |
| DOWNCON SETTING | Down Convert Detail Clip(+) | `OSL:57:[Data]` | `QSL:57` |
| DOWNCON SETTING | Down Convert Detail Clip(-) | `OSL:58:[Data]` | `QSL:58` |
| DOWNCON SETTING | Down Convert Detail Knee Aperture Level | `OSL:5A:[Data]` | `QSL:5A` |
| DOWNCON SETTING | Down Convert Detail Knee | `OSL:5B:[Data]` | `QSL:5B` |
| DOWNCON SETTING | Down Convert Detail Level Dependent SW | `OSL:5C:[Data]` | `QSL:5C` |
| DOWNCON SETTING | Down Convert Detail Level Dependent | `OSL:5D:[Data]` | `QSL:5D` |
| DOWNCON SETTING | Down Convert Dark Detail SW | `OSL:5E:[Data]` | `QSL:5E` |
| DOWNCON SETTING | Down Convert Dark Detail | `OSL:5F:[Data]` | `QSL:5F` |
| DOWNCON SETTING | Down Convert Skin Tone Detail | `OSL:60:[Data]` | `QSL:60` |
| DOWNCON SETTING | Down Convert Skin Tone Detail Memory Select | `OSL:B1:[Data]` | `QSL:B1` |
| DOWNCON SETTING | Down Convert Skin Tone Detail Zebra | `OSL:61:[Data]` | `QSL:61` |
| DOWNCON SETTING | Down Convert Skin Tone Detail Zebra Effect Memory | `OSL:62:[Data]` | `QSL:62` |
| DOWNCON SETTING | Down Convert Skin Tone Effect Memory | `OSL:63:[Data]` | `QSL:63` |
| DOWNCON SETTING | Down Convert Skin Tone Crisp | `OSL:64:[Data]` | `QSL:64` |
| DOWNCON SETTING | Down Convert Skin Tone Detail I Center | `OSL:65:[Data]` | `QSL:65` |
| DOWNCON SETTING | Down Convert Skin Tone Detail I Width | `OSL:66:[Data]` | `QSL:66` |
| DOWNCON SETTING | Down Convert Skin Tone Detail Q Width | `OSL:67:[Data]` | `QSL:67` |
| DOWNCON SETTING | Down Convert Skin Tone Detail Q Phase | `OSL:68:[Data]` | `QSL:68` |
| SKIN TONE DETAIL SETTING | Skin Tone Detail | `OSA:40:[Data]` | `QSA:40` |
| SKIN TONE DETAIL SETTING | Memory Select | `OSL:69:[Data]` | `QSL:69` |
| SKIN TONE DETAIL SETTING | Zebra | `OSA:49:[Data]` | `QSA:49` |
| SKIN TONE DETAIL SETTING | Zebra Effect Memory | `OSL:6A:[Data]` | `QSL:6A` |
| SKIN TONE DETAIL SETTING | Skin Tone Effect Memory | `OSG:48:[Data]` | `QSG:48` |
| SKIN TONE DETAIL SETTING | Skin Tone Crisp | `OSG:49:[Data]` | `QSG:49` |
| SKIN TONE DETAIL SETTING | I Center | `OSA:45:[Data]` | `QSA:45` |
| SKIN TONE DETAIL SETTING | I Width | `OSA:46:[Data]` | `QSA:46` |
| SKIN TONE DETAIL SETTING | Q Width | `OSA:47:[Data]` | `QSA:47` |
| SKIN TONE DETAIL SETTING | Q Phase | `OSG:4F:[Data]` | `QSG:4F` |
| LINEAR MATRIX | Preset Matrix | `OSE:31:[Data]` | `QSE:31` |
| LINEAR MATRIX | Matrix | `OSA:84:[Data]` | `QSA:84` |
| LINEAR MATRIX | Linear Matrix | `OSL:6C:[Data]` | `QSL:6C` |
| LINEAR MATRIX | Linear Table | `OSA:00:[Data]` | `QSA:00` |
| LINEAR MATRIX | Color Correction | `OSA:85:[Data]` | `QSA:85` |
| LINEAR MATRIX | Color Correct Table | `OSL:6E:[Data]` | `QSL:6E` |
| LINEAR MATRIX | Matrix (R-G)_N | `OSD:2F:[Data]` | `QSD:2F` |
| LINEAR MATRIX | Matrix (R-G)_P | `OSL:6F:[Data]` | `QSL:6F` |
| LINEAR MATRIX | Matrix (R-B)_N | `OSD:30:[Data]` | `QSD:30` |
| LINEAR MATRIX | Matrix (R-B)_P | `OSL:70:[Data]` | `QSL:70` |
| LINEAR MATRIX | Matrix (G-R)_N | `OSD:31:[Data]` | `QSD:31` |
| LINEAR MATRIX | Matrix (G-R)_P | `OSL:71:[Data]` | `QSL:71` |
| LINEAR MATRIX | Matrix (G-B)_N | `OSD:32:[Data]` | `QSD:32` |
| LINEAR MATRIX | Matrix (G-B)_P | `OSL:72:[Data]` | `QSL:72` |
| LINEAR MATRIX | Matrix (B-R)_N | `OSD:33:[Data]` | `QSD:33` |
| LINEAR MATRIX | Matrix (B-R)_P | `OSL:73:[Data]` | `QSL:73` |
| LINEAR MATRIX | Matrix (B-G)_N | `OSD:34:[Data]` | `QSD:34` |
| LINEAR MATRIX | Matrix (B-G)_P | `OSL:74:[Data]` | `QSL:74` |
| COLOR CORRECTION | Color Correction G Saturation | `OSD:8E:[Data]` | `QSD:8E` |
| COLOR CORRECTION | Color Correction G_Cy Saturation | `OSD:90:[Data]` | `QSD:90` |
| COLOR CORRECTION | Color Correction Cy Saturation | `OSD:92:[Data]` | `QSD:92` |
| COLOR CORRECTION | Color Correction Cy_B Saturation | `OSD:94:[Data]` | `QSD:94` |
| COLOR CORRECTION | Color Correction B Saturation | `OSD:96:[Data]` | `QSD:96` |
| COLOR CORRECTION | Color Correction B_Mg Saturation | `OSD:80:[Data]` | `QSD:80` |
| COLOR CORRECTION | Color Correction Mg Saturation | `OSD:82:[Data]` | `QSD:82` |
| COLOR CORRECTION | Color Correction Mg_R Saturation | `OSD:84:[Data]` | `QSD:84` |
| COLOR CORRECTION | Color Correction R Saturation | `OSD:86:[Data]` | `QSD:86` |
| COLOR CORRECTION | Color Correction R_Yl Saturation | `OSD:88:[Data]` | `QSD:88` |
| COLOR CORRECTION | Color Correction Yl Saturation | `OSD:8A:[Data]` | `QSD:8A` |
| COLOR CORRECTION | Color Correction Yl_G Saturation | `OSD:8C:[Data]` | `QSD:8C` |
| COLOR CORRECTION | Color Correction G Phase | `OSD:8F:[Data]` | `QSD:8F` |
| COLOR CORRECTION | Color Correction G_Cy Phase | `OSD:91:[Data]` | `QSD:91` |
| COLOR CORRECTION | Color Correction Cy Phase | `OSD:93:[Data]` | `QSD:93` |
| COLOR CORRECTION | Color Correction Cy_B Phase | `OSD:95:[Data]` | `QSD:95` |
| COLOR CORRECTION | Color Correction B Phase | `OSD:97:[Data]` | `QSD:97` |
| COLOR CORRECTION | Color Correction B_Mg Phase | `OSD:81:[Data]` | `QSD:81` |
| COLOR CORRECTION | Color Correction Mg Phase | `OSD:83:[Data]` | `QSD:83` |
| COLOR CORRECTION | Color Correction Mg_R Phase | `OSD:85:[Data]` | `QSD:85` |
| COLOR CORRECTION | Color Correction R Phase | `OSD:87:[Data]` | `QSD:87` |
| COLOR CORRECTION | Color Correction R_Yl Phase | `OSD:89:[Data]` | `QSD:89` |
| COLOR CORRECTION | Color Correction Yl Phase | `OSD:8B:[Data]` | `QSD:8B` |
| COLOR CORRECTION | Color Correction Yl_G Phase | `OSD:8D:[Data]` | `QSD:8D` |
| DNR | DNR | `OSD:3A:[Data]` | `QSD:3A` |
| DNR | DNR Level | `OSG:B5:[Data]` | `QSG:B5` |
| HDR PAINT | Hlg Mode | `OSI:39:[Data]` | `QSI:39` |
| HDR PAINT | Sdr Convert Mode | `OSI:3A:[Data]` | `QSI:3A` |
| HDR PAINT | Black Gamma (Black Gamma SW (HDR Paint)) | `OSI:3C:[Data]` | `QSI:3C` |
| HDR PAINT | Master Black Gamma (Master Black Gamma (HDR Paint)) | `OSI:3D:[Data]` | `QSI:3D` |
| HDR PAINT | R Black Gamma (R Black Gamma (HDR Paint)) | `OSI:3E:[Data]` | `QSI:3E` |
| HDR PAINT | B Black Gamma (B Black Gamma (HDR Paint)) | `OSI:3F:[Data]` | `QSI:3F` |
| HDR PAINT | Knee (Knee SW (HDR Paint)) | `OSI:40:[Data]` | `QSI:40` |
| KNEE | Knee Point | `OSI:41:[Data]` | `QSI:41` |
| KNEE | Knee Slope | `OSI:42:[Data]` | `QSI:42` |
| HDR PAINT | Gain (SDR Convert Gain (HDR Paint)) | `OSI:43:[Data]` | `QSI:43` |
| KNEE | Point | `OSL:88:[Data]` | `QSL:88` |
| KNEE | Slope | `OSL:89:[Data]` | `QSL:89` |
| KNEE | Black Offset | `OSL:8A:[Data]` | `QSL:8A` |
| Other | ND Filter | `OFT:[Data]` | `QFT` |

## AW-UE100 — 98 parameters

| Groep | Parameter | Zetten | Opvragen |
|---|---|---|---|
| Brightness | Picture Level | `OSD:48:[Data]` | `QSD:48` |
| Brightness | Control (Iris Mode) | `ORS:[Data]` | `QRS` |
| Brightness | Auto Iris Speed | `OSJ:01:[Data]` | `QSJ:01` |
| Brightness | Auto Iris Window | `OSJ:02:[Data]` | `QSJ:02` |
| Brightness | Iris Limit | `OSJ:90:[Data]` | `QSJ:90` |
| Brightness | Shutter Mode | `OSJ:03:[Data]` | `QSJ:03` |
| Brightness | Control (Shutter Step Value) | `OSJ:06:[Data]` | `QSJ:06` |
| Brightness | Control (Shutter Synchro Value) | `OSJ:09:[Data]` | `QSJ:09` |
| Brightness | ELC Limit | `OSD:BF:[Data]` | `QSD:BF` |
| Brightness | Gain | `OGU:[Data]` | `QGU` |
| Brightness | Super Gain | `OSI:28:[Data]` | `QSI:28` |
| Brightness | AGC Max Gain | `OSD:69:[Data]` | `QSD:69` |
| Brightness | Frame mix | `OSA:65:[Data]` | `QSA:65` |
| Brightness | Auto F.Mix Max Gain | `OSE:74:[Data]` | `QSE:74` |
| Brightness | ND Filter | `OFT:[Data]` | `QFT` |
| Brightness | Day/Night | `#D6[Data]` | `#D6` |
| Picture | White Balance Mode | `OAW:[Data]` | `QAW` |
| Picture | Color Temperature | `OSI:20:[Data]` | `QSI:20` |
| Picture | R Gain [OSG:39] | `OSG:39:[Data]` | `QSG:39` |
| Picture | B Gain [OSG:3A] | `OSG:3A:[Data]` | `QSG:3A` |
| Picture | Control (AWB Color Temperature) | `OSJ:4A:[Data]` | `QSJ:4A` |
| Picture | R Gain (AWB R Gain) | `OSJ:4B:[Data]` | `QSJ:4B` |
| Picture | B Gain (AWB B Gain) | `OSJ:4C:[Data]` | `QSJ:4C` |
| Picture | G Axis | `OSJ:4D:[Data]` | `QSJ:4D` |
| Picture | AWB Gain Offset | `OSJ:0C:[Data]` | `QSJ:0C` |
| Picture | ATW Speed | `OSI:25:[Data]` | `QSI:25` |
| Picture | ATW Target R | `OSJ:0D:[Data]` | `QSJ:0D` |
| Picture | ATW Target B | `OSJ:0E:[Data]` | `QSJ:0E` |
| Picture | Chroma Level | `OSD:B0:[Data]` | `QSD:B0` |
| Picture | Chroma Phase | `OSJ:0B:[Data]` | `QSJ:0B` |
| Picture | Master Pedestal | `OSJ:0F:[Data]` | `QSJ:0F` |
| Picture | R Pedestal | `ORP:[Data]` | `QRP` |
| Picture | G Pedestal | `OSJ:10:[Data]` | `QSJ:10` |
| Picture | B Pedestal | `OBP:[Data]` | `QBP` |
| Picture | Pedestal Offset | `OSJ:11:[Data]` | `QSJ:11` |
| Picture | Detail | `ODT:[Data]` | `QDT` |
| Picture | Master Detail | `OSA:30:[Data]` | `QSA:30` |
| Picture | Detail Coring | `OSJ:12:[Data]` | `QSJ:12` |
| Picture | V Detail Level | `OSD:A1:[Data]` | `QSD:A1` |
| Picture | Detail Frequency | `OSD:A2:[Data]` | `QSD:A2` |
| Picture | Level Depend. | `OSJ:13:[Data]` | `QSJ:13` |
| Picture | Knee Aperture Level | `OSG:3F:[Data]` | `QSG:3F` |
| Picture | Detail Gain(+) | `OSA:38:[Data]` | `QSA:38` |
| Picture | Detail Gain(-) | `OSA:39:[Data]` | `QSA:39` |
| Picture | Skin Detail | `OSA:40:[Data]` | `QSA:40` |
| Picture | Skin Detail Effect | `OSD:A3:[Data]` | `QSD:A3` |
| Picture | Gamma Mode | `OSE:72:[Data]` | `QSE:72` |
| Picture | Gamma | `OSA:6A:[Data]` | `QSA:6A` |
| Picture | Black Gamma | `OSA:07:[Data]` | `QSA:07` |
| Picture | Black Gamma Range | `OSJ:1B:[Data]` | `QSJ:1B` |
| Picture | DRS | `OSE:33:[Data]` | `QSE:33` |
| Picture | Knee mode | `OSA:2D:[Data]` | `QSA:2D` |
| Picture | Auto Knee Response | `OSG:97:[Data]` | `QSG:97` |
| Picture | Knee Point | `OSA:20:[Data]` | `QSA:20` |
| Picture | Knee Slope | `OSA:24:[Data]` | `QSA:24` |
| Picture | White Clip | `OSA:2E:[Data]` | `QSA:2E` |
| Picture | White Clip Level | `OSA:2A:[Data]` | `QSA:2A` |
| Picture | DNR | `OSD:3A:[Data]` | `QSD:3A` |
| Matrix | Matrix Type | `OSE:31:[Data]` | `QSE:31` |
| Matrix | Adaptive Matrix | `OSJ:4F:[Data]` | `QSJ:4F` |
| Matrix | Matrix(R-G) | `OSD:A4:[Data]` | `QSD:A4` |
| Matrix | Matrix(R-B) | `OSD:A5:[Data]` | `QSD:A5` |
| Matrix | Matrix(G-R) | `OSD:A6:[Data]` | `QSD:A6` |
| Matrix | Matrix(G-B) | `OSD:A7:[Data]` | `QSD:A7` |
| Matrix | Matrix(B-R) | `OSD:A8:[Data]` | `QSD:A8` |
| Matrix | Matrix(B-G) | `OSD:A9:[Data]` | `QSD:A9` |
| Matrix | Color Correction B_Mg Saturation | `OSD:80:[Data]` | `QSD:80` |
| Matrix | Color Correction B_Mg Phase | `OSD:81:[Data]` | `QSD:81` |
| Matrix | Color Correction Mg Saturation | `OSD:82:[Data]` | `QSD:82` |
| Matrix | Color Correction Mg Phase | `OSD:83:[Data]` | `QSD:83` |
| Matrix | Color Correction Mg_R Saturation | `OSD:84:[Data]` | `QSD:84` |
| Matrix | Color Correction Mg_R Phase | `OSD:85:[Data]` | `QSD:85` |
| Matrix | Color Correction Mg_R_R Saturation | `OSD:9A:[Data]` | `QSD:9A` |
| Matrix | Color Correction Mg_R_R Phase | `OSD:9B:[Data]` | `QSD:9B` |
| Matrix | Color Correction R Saturation | `OSD:86:[Data]` | `QSD:86` |
| Matrix | Color Correction R Phase | `OSD:87:[Data]` | `QSD:87` |
| Matrix | Color Correction R_R_Yl Saturation | `OSD:9C:[Data]` | `QSD:9C` |
| Matrix | Color Correction R_R_Yl Phase | `OSD:9D:[Data]` | `QSD:9D` |
| Matrix | Color Correction R_Yl Saturation | `OSD:88:[Data]` | `QSD:88` |
| Matrix | Color Correction R_Yl Phase | `OSD:89:[Data]` | `QSD:89` |
| Matrix | Color Correction R_Yl_Yl Saturation | `OSD:9E:[Data]` | `QSD:9E` |
| Matrix | Color Correction R_Yl_Yl Phase | `OSD:9F:[Data]` | `QSD:9F` |
| Matrix | Color Correction Yl Saturation | `OSD:8A:[Data]` | `QSD:8A` |
| Matrix | Color Correction Yl Phase | `OSD:8B:[Data]` | `QSD:8B` |
| Matrix | Color Correction Yl_Yl_G Saturation | `OSJ:1C:[Data]` | `QSJ:1C` |
| Matrix | Color Correction Yl_Yl_G Phase | `OSJ:1D:[Data]` | `QSJ:1D` |
| Matrix | Color Correction Yl_G Saturation | `OSD:8C:[Data]` | `QSD:8C` |
| Matrix | Color Correction Yl_G Phase | `OSD:8D:[Data]` | `QSD:8D` |
| Matrix | Color Correction G Saturation | `OSD:8E:[Data]` | `QSD:8E` |
| Matrix | Color Correction G Phase | `OSD:8F:[Data]` | `QSD:8F` |
| Matrix | Color Correction G_Cy Saturation | `OSD:90:[Data]` | `QSD:90` |
| Matrix | Color Correction G_Cy Phase | `OSD:91:[Data]` | `QSD:91` |
| Matrix | Color Correction Cy Saturation | `OSD:92:[Data]` | `QSD:92` |
| Matrix | Color Correction Cy Phase | `OSD:93:[Data]` | `QSD:93` |
| Matrix | Color Correction Cy_B Saturation | `OSD:94:[Data]` | `QSD:94` |
| Matrix | Color Correction Cy_B Phase | `OSD:95:[Data]` | `QSD:95` |
| Matrix | Color Correction B Saturation | `OSD:96:[Data]` | `QSD:96` |
| Matrix | Color Correction B Phase | `OSD:97:[Data]` | `QSD:97` |

## AW-UE80 / UE50 / UE40 / UE30 — 85 parameters

| Groep | Parameter | Zetten | Opvragen |
|---|---|---|---|
| Brightness | Picture Level | `OSD:48:[Data]` | `QSD:48` |
| Brightness | Iris Mode | `ORS:[Data]` | `QRS` |
| Brightness | Auto Iris Speed | `OSJ:01:[Data]` | `QSJ:01` |
| Brightness | Auto Iris Window | `OSJ:02:[Data]` | `QSJ:02` |
| Brightness | Iris Limit | `OSJ:90:[Data]` | `QSJ:90` |
| Brightness | Shutter Mode | `OSJ:03:[Data]` | `QSJ:03` |
| Brightness | Shutter Step Value | `OSJ:06:[Data]` | `QSJ:06` |
| Brightness | Shutter Synchro Value | `OSJ:09:[Data]` | `QSJ:09` |
| Brightness | ELC Limit | `OSD:BF:[Data]` | `QSD:BF` |
| Brightness | Gain | `OGU:[Data]` | `QGU` |
| Brightness | Super Gain | `OSI:28:[Data]` | `QSI:28` |
| Brightness | AGC Max Gain | `OSD:69:[Data]` | `QSD:69` |
| Brightness | Frame mix | `OSA:65:[Data]` | `QSA:65` |
| Brightness | Auto F.Mix Max Gain | `OSE:74:[Data]` | `QSE:74` |
| Brightness | Backlight COMP. | `OSE:73:[Data]` | `QSE:73` |
| Brightness | Backlight COMP.Level | `OSM:40:[Data]` | `QSM:40` |
| Brightness | Spotlight COMP. | `OSJ:D0:[Data]` | `QSJ:D0` |
| Brightness | Flicker Suppression | `OSJ:D1:[Data]` | `QSJ:D1` |
| Brightness | ND Filter | `OFT:[Data]` | `QFT` |
| Brightness | Day/Night | `#D6[Data]` | `#D6` |
| Picture | White Balance Mode | `OAW:[Data]` | `QAW` |
| Picture | Color Temperature | `OSI:20:[Data]` | `QSI:20` |
| Picture | R Gain | `OSG:39:[Data]` | `QSG:39` |
| Picture | B Gain | `OSG:3A:[Data]` | `QSG:3A` |
| Picture | AWB Color TEMP. Info | `OSJ:4A:[Data]` | `QSJ:4A` |
| Picture | AWB Gain Offset | `OSJ:0C:[Data]` | `QSJ:0C` |
| Picture | ATW Speed | `OSI:25:[Data]` | `QSI:25` |
| Picture | ATW Target R | `OSJ:0D:[Data]` | `QSJ:0D` |
| Picture | ATW Target B | `OSJ:0E:[Data]` | `QSJ:0E` |
| Picture | Chroma Level | `OSD:B0:[Data]` | `QSD:B0` |
| Picture | Chroma Phase | `OSJ:0B:[Data]` | `QSJ:0B` |
| Picture | Master Pedestal | `OSJ:0F:[Data]` | `QSJ:0F` |
| Picture | Detail | `ODT:[Data]` | `QDT` |
| Picture | Master Detail | `OSA:30:[Data]` | `QSA:30` |
| Picture | Detail Coring | `OSJ:12:[Data]` | `QSJ:12` |
| Picture | V Detail Level | `OSD:A1:[Data]` | `QSD:A1` |
| Picture | Skin Detail | `OSA:40:[Data]` | `QSA:40` |
| Picture | Skin Detail Effect | `OSD:A3:[Data]` | `QSD:A3` |
| Picture | Gamma Mode | `OSJ:D7:[Data]` | `QSJ:D7` |
| Picture | Gamma | `OSA:6A:[Data]` | `QSA:6A` |
| Picture | DRS | `OSE:33:[Data]` | `QSE:33` |
| Picture | Knee mode | `OSA:2D:[Data]` | `QSA:2D` |
| Picture | White Clip | `OSA:2E:[Data]` | `QSA:2E` |
| Picture | White Clip Level | `OSA:2A:[Data]` | `QSA:2A` |
| Picture | DNR | `OSD:3A:[Data]` | `QSD:3A` |
| Matrix | Matrix Type | `OSE:31:[Data]` | `QSE:31` |
| Matrix | Adaptive Matrix | `OSJ:4F:[Data]` | `QSJ:4F` |
| Matrix | Matrix(R-G) | `OSD:A4:[Data]` | `QSD:A4` |
| Matrix | Matrix(R-B) | `OSD:A5:[Data]` | `QSD:A5` |
| Matrix | Matrix(G-R) | `OSD:A6:[Data]` | `QSD:A6` |
| Matrix | Matrix(G-B) | `OSD:A7:[Data]` | `QSD:A7` |
| Matrix | Matrix(B-R) | `OSD:A8:[Data]` | `QSD:A8` |
| Matrix | Matrix(B-G) | `OSD:A9:[Data]` | `QSD:A9` |
| Matrix | Color Correction B_Mg Saturation | `OSD:80:[Data]` | `QSD:80` |
| Matrix | Color Correction B_Mg Phase | `OSD:81:[Data]` | `QSD:81` |
| Matrix | Color Correction Mg Saturation | `OSD:82:[Data]` | `QSD:82` |
| Matrix | Color Correction Mg Phase | `OSD:83:[Data]` | `QSD:83` |
| Matrix | Color Correction Mg_R Saturation | `OSD:84:[Data]` | `QSD:84` |
| Matrix | Color Correction Mg_R Phase | `OSD:85:[Data]` | `QSD:85` |
| Matrix | Color Correction Mg_R_R Saturation | `OSD:9A:[Data]` | `QSD:9A` |
| Matrix | Color Correction Mg_R_R Phase | `OSD:9B:[Data]` | `QSD:9B` |
| Matrix | Color Correction R Saturation | `OSD:86:[Data]` | `QSD:86` |
| Matrix | Color Correction R Phase | `OSD:87:[Data]` | `QSD:87` |
| Matrix | Color Correction R_R_Yl Saturation | `OSD:9C:[Data]` | `QSD:9C` |
| Matrix | Color Correction R_R_Yl Phase | `OSD:9D:[Data]` | `QSD:9D` |
| Matrix | Color Correction R_Yl Saturation | `OSD:88:[Data]` | `QSD:88` |
| Matrix | Color Correction R_Yl Phase | `OSD:89:[Data]` | `QSD:89` |
| Matrix | Color Correction R_Yl_Yl Saturation | `OSD:9E:[Data]` | `QSD:9E` |
| Matrix | Color Correction R_Yl_Yl Phase | `OSD:9F:[Data]` | `QSD:9F` |
| Matrix | Color Correction Yl Saturation | `OSD:8A:[Data]` | `QSD:8A` |
| Matrix | Color Correction Yl Phase | `OSD:8B:[Data]` | `QSD:8B` |
| Matrix | Color Correction Yl_Yl_G Saturation | `OSJ:1C:[Data]` | `QSJ:1C` |
| Matrix | Color Correction Yl_Yl_G Phase | `OSJ:1D:[Data]` | `QSJ:1D` |
| Matrix | Color Correction Yl_G Saturation | `OSD:8C:[Data]` | `QSD:8C` |
| Matrix | Color Correction Yl_G Phase | `OSD:8D:[Data]` | `QSD:8D` |
| Matrix | Color Correction G Saturation | `OSD:8E:[Data]` | `QSD:8E` |
| Matrix | Color Correction G Phase | `OSD:8F:[Data]` | `QSD:8F` |
| Matrix | Color Correction G_Cy Saturation | `OSD:90:[Data]` | `QSD:90` |
| Matrix | Color Correction G_Cy Phase | `OSD:91:[Data]` | `QSD:91` |
| Matrix | Color Correction Cy Saturation | `OSD:92:[Data]` | `QSD:92` |
| Matrix | Color Correction Cy Phase | `OSD:93:[Data]` | `QSD:93` |
| Matrix | Color Correction Cy_B Saturation | `OSD:94:[Data]` | `QSD:94` |
| Matrix | Color Correction Cy_B Phase | `OSD:95:[Data]` | `QSD:95` |
| Matrix | Color Correction B Saturation | `OSD:96:[Data]` | `QSD:96` |
| Matrix | Color Correction B Phase | `OSD:97:[Data]` | `QSD:97` |
