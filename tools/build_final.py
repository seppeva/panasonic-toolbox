import re, json
import os
# SPEC_DIR: map met de clone van bitfocus/companion-module-panasonic-cameras en de pdftotext -layout uitvoer van de specificaties
D=os.environ.get('SPEC_DIR','./spec/')
raw=json.load(open(D+'raw.json'))
compat=raw['compat']; scene=raw['scene']
FIX={'OSE:D0':'OSJ:D0','OSE:D1':'OSJ:D1','OSE:D2':'OSJ:D2','OSD:1C':'OSJ:1C','OSD:1D':'OSJ:1D','OCG:3F':'OSG:3F'}
SKIP={'#D3','OSJ:D2'}  # #D3 == ORS ; ND filter status is read-only status
fams={
 'UE150':dict(file='UE150_HE145_InterfaceSpecification_E.txt',col='UE150/HE145',groups=['Brightness','Picture','Matrix'],end='  Lens'),
 'UE150A':dict(file='UE150A_InterfaceSpecification_E.txt',col='UE150A',groups=['Brightness','Picture','Matrix'],end='  Lens'),
 'UE100':dict(file='UE100_InterfaceSpecification_E.txt',col='UE100',groups=['Brightness','Picture','Matrix'],end='Lens'),
 'UE80':dict(file='UE80_UE50_UE40_InterfaceSpecification_E.txt',col='UE80/UE50/UE40/UE30',groups=['Brightness','Picture','Matrix'],end='  Lens'),
 'UE160':dict(file='UE160_InterfaceSpecification_E.txt',col='UE160',groups=['PAINT','COLOR TEMP SETTING','RGB GAIN CONTROL SETTING','FLARE','GAMMA/BLACK GAMMA','KNEE','WHITE CLIP','DRS','DETAIL SETTING','DOWNCON SETTING','SKIN TONE DETAIL SETTING','LINEAR MATRIX','COLOR CORRECTION','DNR','V-LOG PAINT','HDR PAINT'],end='PAINT SWITCH',start_after='IP SIGNAL'),
}
tok=re.compile(r'(?<![A-Z0-9#])(O[A-Z]{2}(?::[0-9A-F]{2})?|#D6|#D3)(?![0-9A-Z])')
def menu_order(f):
    L=open(D+f['file']).read().splitlines()
    i=[k for k,l in enumerate(L) if 'Menu-Command Corres' in l][0]
    if f.get('start_after'):
        i=[k for k,l in enumerate(L) if k>i and l.strip()==f['start_after']][0]
    order=[]; grp=f['groups'][0]; names={}
    for l in L[i+1:]:
        s=l.strip()
        if l.startswith(f['end']) and len(s)<=len(f['end'].strip())+2 and s==f['end'].strip(): break
        if s in f['groups']: grp=s; continue
        for m in tok.finditer(l):
            c=FIX.get(m.group(1),m.group(1))
            if c not in names:
                names[c]=grp; order.append(c)
            # menu name = text before first command on the line
        nm=re.match(r'^\s*([A-Za-z][\w .()/+\-&|]*?)\s{2,}(O[A-Z]{2}(?::[0-9A-F]{2})?|#D6)\b',l)
        if nm:
            c=FIX.get(nm.group(2),nm.group(2)); MENUNAME.setdefault(f['file'],{}).setdefault(c,nm.group(1).strip())
    return order,names
MENUNAME={}

def clean(s): return re.sub(r'\s+',' ',s.replace('<br>',' ')).strip()
def tokens(s): return [t.strip() for t in s.split('<br>')]

def decoder(e):
    d=tokens(e['data']); c=tokens(e['contents'])
    hexre=re.compile(r'^([0-9A-F]+)\s*h?$')
    # linear: lo - mid - hi
    if len(d)==5 and d[1]=='-' and d[3]=='-' and len(c)==5:
        try:
            lo=int(hexre.match(d[0].replace(' ','')).group(1),16); hi=int(hexre.match(d[4].replace(' ','')).group(1),16)
            vlo=float(re.sub(r'[^0-9.+-]','',c[0])); vhi=float(re.sub(r'[^0-9.+-]','',c[4]))
            if hi!=lo: return dict(kind='lin',lo=lo,hi=hi,vlo=vlo,vhi=vhi,unit=re.sub(r'[0-9.+\-\s]','',c[4])[:6])
        except Exception: pass
    if len(d)==3 and d[1]=='-' and len(c)==3:
        try:
            lo=int(hexre.match(d[0].replace(' ','')).group(1),16); hi=int(hexre.match(d[2].replace(' ','')).group(1),16)
            vlo=float(re.sub(r'[^0-9.+-]','',c[0])); vhi=float(re.sub(r'[^0-9.+-]','',c[2]))
            if hi!=lo: return dict(kind='lin',lo=lo,hi=hi,vlo=vlo,vhi=vhi,unit=re.sub(r'[0-9.+\-\s]','',c[2])[:6])
        except Exception: pass
    # enum: equal-length simple
    if len(d)==len(c) and 1<len(d)<=24 and all(re.match(r'^[0-9A-F]{1,3}h?$',x) for x in d):
        m={}
        for a,b in zip(d,c):
            m[str(int(a.rstrip('h'),16))]=b
        return dict(kind='enum',map=m)
    return None

catalog={}
for fam,f in fams.items():
    order,groups=menu_order(f)
    lst=[FIX.get(c,c) for c in scene[fam]]
    lst=[c for c in dict.fromkeys(lst) if c not in SKIP]
    ordered=[c for c in order if c in lst]+[c for c in lst if c not in order]
    params=[]
    for c in ordered:
        if c=='#D6':
            params.append(dict(cmd='#D6',q='#D6',t='ptz',name='Day/Night',g=groups.get(c,f['groups'][0]),dec=dict(kind='enum',map={'0':'Day','1':'Night'})));continue
        es=compat.get(c)
        if not es: print('NO COMPAT',fam,c); continue
        e=es[0]
        q=e['query'] or ('Q'+c[1:])
        sup=e['support'].get(f['col'],'')
        cname=clean(e['name']); mname=MENUNAME.get(f['file'],{}).get(c)
        if ' /' in cname:
            alts=[a.strip() for a in cname.split(' /')]
            if mname:
                mw=set(re.findall(r'[a-z]+',mname.lower()))
                alts.sort(key=lambda a:-len(mw & set(re.findall(r'[a-z]+',a.lower()))))
            cname=alts[0]
        if mname and not cname.lower().startswith('color correction') and len(mname)>2 and not mname.isupper(): cname=mname
        elif mname and mname.isupper() and fam=='UE160' and not cname.startswith(('Color Correction','Down Convert')): cname=mname.title().replace('Atw','ATW').replace('Agc','AGC').replace('Drs','DRS').replace('Dnr','DNR')
        params.append(dict(cmd=c,q=q,t='cam',name=cname,g=groups.get(c,'Other'),
                           sup=None if sup in ('○','') else clean(sup),dec=decoder(e)))
    for p in params:
        n=re.sub(r'\s+',' ',p['name']).replace('Wondow','Window')
        n=re.sub(r'\bSw\b','SW',n); n=re.sub(r'\bWb\b','WB',n); n=re.sub(r'\bAch\b','ACH',n); n=re.sub(r'\bBch\b','BCH',n)
        p['name']=n
    from collections import Counter
    cnt=Counter(p['name'] for p in params)
    for p in params:
        if cnt[p['name']]>1:
            cn=clean(compat[p['cmd']][0]['name']).split(' /')[0] if p['cmd'] in compat else ''
            p['name']=f"{p['name']} ({cn})" if cn and cn.lower()!=p['name'].lower() else f"{p['name']} [{p['cmd']}]"
    catalog[fam]=params
    print(fam,len(params),'groups',sorted(set(p['g'] for p in params)))
# generic: union of all, ordered by UE150 then others
gen=[];seen=set()
for fam in ['UE150','UE150A','UE100','UE80','UE160']:
    for p in catalog[fam]:
        if p['cmd'] in seen: continue
        seen.add(p['cmd']); q=dict(p); q.pop('sup',None); gen.append(q)
catalog['GENERIC']=gen
print('GENERIC',len(gen))
json.dump(catalog,open(D+'catalog.json','w'),indent=0)
