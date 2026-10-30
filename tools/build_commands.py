"""Genereert app/web/commands.js: alle Panasonic AW-commando's (camera + pan/tilt) uit de
Compatible Model Table (markdown-transcriptie in bitfocus/companion-module-panasonic-cameras/docs).
Gebruik: SPEC_DIR=... python3 tools/build_commands.py"""
import json, os, re
D = os.environ.get('SPEC_DIR', './spec/')
md = open(D + 'companion-module-panasonic-cameras/docs/InterfaceSpecifications_CompatibleModelTable_E.md').read().splitlines()
MODEL_SHORT = {'UE150A': 'UE150A', 'UB50/UB10': 'UB50', 'UE160': 'UE160', 'UE80/UE50/UE40/UE30': 'UE80', 'UE20/HE20': 'UE20',
               'UR100': 'UR100', 'UE100': 'UE100', 'UE4': 'UE4', 'UE150/HE145': 'UE150', 'HR140': 'HR140', 'UB300': 'UB300',
               'UE70series': 'UE70', 'HE75series': 'HE75', 'HE70series': 'HE70', 'HE130': 'HE130', 'HE120': 'HE120', 'HE60': 'HE60', 'HE50': 'HE50'}
hdr = None; section = None; out = []
def clean(s): return re.sub(r'\s+', ' ', s.replace('<br>', ' ')).strip()
for l in md:
    if l.startswith('## '): section = l[3:].strip()
    if l.startswith('| ITEM |'):
        hdr = [c.strip() for c in l.strip().strip('|').split('|')]; continue
    if not hdr or not l.startswith('| ') or l.startswith('|---'): 
        if hdr and l.strip() and not l.startswith('|'): hdr = None
        continue
    cells = [c.strip() for c in l.strip().strip('|').split('|')]
    if len(cells) != len(hdr): continue
    r = dict(zip(hdr, cells))
    cmdcell = next(v for k, v in r.items() if k.startswith('Command'))
    # samengevoegde regels herstellen (bv. '#HAC[Data1]...[<br>Data4]')
    raw_lines = [x.strip() for x in cmdcell.split('<br>') if x.strip()]
    lines = []
    for x in raw_lines:  # regels die midden in [DataN] afgebroken zijn weer samenvoegen
        if lines and (lines[-1].count('[') > lines[-1].count(']') or re.match(r'^(ata|\d\]|\[Data|:\[Data)', x)):
            lines[-1] += x
        else:
            lines.append(x)
    if not lines: continue
    ptz = section.startswith('PT')
    ctrl = query = None; resp = []
    for x in lines:
        if ptz:
            if x.startswith('#'):
                if '[Data' in x and ctrl is None: ctrl = x
                elif '[Data' not in x and query is None and ctrl is not None: query = x
                elif '[Data' not in x and ctrl is None: ctrl = x
            else: resp.append(x)
        else:
            if x.startswith('Q') and query is None: query = x
            elif ctrl is None and not x.startswith('Q'): ctrl = x
            else: resp.append(x)
    if ctrl is None and query: ctrl = None
    # PT: '#O' zonder data is zowel query als (met data) besturing
    if ptz and ctrl and '[Data' not in ctrl and resp and '[Data' in resp[0]:
        query = ctrl; ctrl = ctrl + '[Data]'
    models = []
    for k, v in r.items():
        if k in MODEL_SHORT and v.strip() not in ('---', ''):
            models.append(MODEL_SHORT[k] if v.strip() == '○' else MODEL_SHORT[k] + '*')
    if not models: continue
    out.append({'n': clean(r['ITEM']), 't': 'ptz' if ptz else 'cam', 'c': ctrl, 'q': query,
                'd': [t.strip() for t in r.get('Data', '').split('<br>')],
                'v': [t.strip() for t in next((v for k, v in r.items() if k.startswith('Data Contents')), '').split('<br>')],
                'm': models})
# Bedieningscommando's van de controller zelf (Remote Camera Controller Interface Specifications v2.10).
# Te sturen naar het IP-adres van de RP150/RP120/RP60 via /cgi-bin/aw_cam.
RP = ['RP150', 'RP120', 'RP60']
out += [
    {'n': 'Controller: select camera (CAM number)', 't': 'cam', 'c': 'XCN:01:[Data]', 'q': 'XQC:01', 'd': ['1', '-', '200'], 'v': ['CAM1', '-', 'CAM200'], 'm': RP, 'rp': 1},
    {'n': 'Controller: select camera (group and port)', 't': 'cam', 'c': 'XCN:02:[Data1]:[Data2]', 'q': 'XQC:02', 'd': ['[Data1] 1-20', '[Data2] 1-10'], 'v': ['Group', 'Port'], 'm': RP, 'rp': 1},
    {'n': 'Controller: select port', 't': 'cam', 'c': 'XPT:[Data]', 'q': None, 'd': ['1', '-', '10'], 'v': ['Port1', '-', 'Port10'], 'm': RP, 'rp': 1},
    {'n': 'Controller: select group', 't': 'cam', 'c': 'XGP:[Data]', 'q': None, 'd': ['1', '-', '20'], 'v': ['Group1', '-', 'Group20'], 'm': RP, 'rp': 1},
    {'n': 'Controller: play preset memory', 't': 'cam', 'c': 'XPM:01:[Data]', 'q': None, 'd': ['001', '-', '100'], 'v': ['Preset001', '-', 'Preset100'], 'm': RP, 'rp': 1},
    {'n': 'Controller: tracing memory standby', 't': 'cam', 'c': 'XTM:02:[Data]', 'q': None, 'd': ['001', '-', '010'], 'v': ['TracingNo1', '-', 'TracingNo10'], 'm': ['RP150', 'RP120'], 'rp': 1},
    {'n': 'Controller: tracing memory play', 't': 'cam', 'c': 'XTM:01:000', 'q': None, 'd': ['-'], 'v': ['Play'], 'm': ['RP150', 'RP120'], 'rp': 1},
    {'n': 'Controller: tracing memory stop', 't': 'cam', 'c': 'XTM:00:[Data]', 'q': None, 'd': ['001', '-', '010'], 'v': ['TracingNo1', '-', 'TracingNo10'], 'm': ['RP150', 'RP120'], 'rp': 1},
]
json.dump(out, open('/tmp/commands.json', 'w'))
js = '// Gegenereerd door tools/build_commands.py uit de Panasonic "Compatible model Table" (maart 2025).\nwindow.PANA_COMMANDS = ' + json.dumps(out, ensure_ascii=False, separators=(',', ':')) + ';\n'
open(os.path.join(os.path.dirname(__file__), '..', 'app', 'web', 'commands.js'), 'w').write(js)
print(len(out), 'commands,', len(js), 'bytes')
