import re, json, sys
import os
# SPEC_DIR: map met de clone van bitfocus/companion-module-panasonic-cameras en de pdftotext -layout uitvoer van de specificaties
D=os.environ.get('SPEC_DIR','./spec/')
md=open(D+'companion-module-panasonic-cameras/docs/InterfaceSpecifications_CompatibleModelTable_E.md').read().splitlines()
# --- parse compat table
hdr=None; rows=[]
for l in md:
    if l.startswith('| ITEM |'):
        hdr=[c.strip() for c in l.strip('|').split('|')]; continue
    if hdr and l.startswith('| ') and not l.startswith('|---'):
        cells=[c.strip() for c in l.strip().strip('|').split('|')]
        if len(cells)!=len(hdr): continue
        rows.append(dict(zip(hdr,cells)))
    elif hdr and not l.startswith('|'):
        if rows: hdr=None
models=hdr if hdr else None
cmdcol=[k for k in rows[0] if k.startswith('Command')][0]
datacol='Data'; contcol=[k for k in rows[0] if k.startswith('Data Contents')][0]
mcols=list(rows[0].keys())[4:]
compat={}
for r in rows:
    cc=[k for k in r if k.startswith('Command')]
    if not cc: continue
    parts=[p.strip() for p in r[cc[0]].split('<br>')]
    ctrl=None; query=None
    for p in parts:
        m=re.match(r'^(#?[A-Z]{1,3}(?::[0-9A-F]{2})?)(?::?\[Data|$)',p)
        if not m: continue
        base=m.group(1)
        if base.startswith('Q') or (base.startswith('#') and p==base): query=query or base
        elif ctrl is None: ctrl=base
    if ctrl is None: continue
    key=ctrl
    entry=dict(name=re.sub(r'<br>',' ',r['ITEM']),ctrl=ctrl,query=query,
               data=r.get('Data',''),contents=next((r[k] for k in r if k.startswith('Data Contents')),''),
               support={m:r[m] for m in list(r.keys())[4:]})
    compat.setdefault(key,[]).append(entry)
print('compat commands',len(compat),file=sys.stderr)
print('model cols',mcols,file=sys.stderr)
# --- scene lists from spec text
specs={'UE150':('UE150_HE145_InterfaceSpecification_E.txt','belonging to the scene'),
       'UE150A':('UE150A_InterfaceSpecification_E.txt','belonging to the scene'),
       'UE100':('UE100_InterfaceSpecification_E.txt','belonging to the scene'),
       'UE80':('UE80_UE50_UE40_InterfaceSpecification_E.txt','belonging to the scene'),
       'UE160':('UE160_InterfaceSpecification_E.txt','belonging to the SCENE')}
tok=re.compile(r'(?<![A-Z0-9#])(O[A-Z]{2}(?::[0-9A-F]{2})?|#D6|#D3)(?![0-9A-Z])')
scene={}
for fam,(fn,marker) in specs.items():
    L=open(D+fn).read().splitlines()
    i=[k for k,l in enumerate(L) if marker in l][0]
    out=[]
    for l in L[i+1:]:
        if re.search(r'Command name\s+Category',l) or 'When load USER FILE' in l: break
        # item names: text before command
        for m in tok.finditer(l):
            c=m.group(1)
            if c not in out: out.append(c)
    scene[fam]=out
    print(fam,len(out),file=sys.stderr)
json.dump(dict(compat=compat,scene=scene,models=mcols),open('/home/claude/gen/raw.json','w'),indent=1)
