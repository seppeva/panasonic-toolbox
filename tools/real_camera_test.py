#!/usr/bin/env python3
"""
Test Panasonic Toolbox against REAL Panasonic PTZ cameras.

It uses the app's own camera code (app/panasonic_scene.py, app/easyip.py) and the app's own lists of
scene and operator settings (app/web/catalog.js, app/web/commands.js), and checks what the cameras
really answer. Everything it changes is put back at the end; backups are written first.

ONLY use cameras that are not on air: the picture changes, scenes switch, cameras move and go to standby.

  python3 tools/real_camera_test.py --cams 10.0.100.1,10.0.100.2
  python3 tools/real_camera_test.py --cams 10.0.100.1 --user admin --password 12345
  python3 tools/real_camera_test.py --cams 10.0.100.1,10.0.100.2 --network --spare-ip 10.0.100.250

Options
  --cams        comma separated camera IP addresses (required)
  --port        HTTP port of the cameras (default 80)
  --user/--password   camera login when User Auth is on
  --network     also test Easy IP: rename the first camera and move it to --spare-ip, then put both back
  --spare-ip    a free IP address in the same range as the first camera (needed with --network)
  --skip-power  do not put cameras in standby
  --skip-move   do not pan/tilt/zoom or recall presets
  --out         folder for the report, raw log and backups (default tools/test-output/<date-time>)

Output: report.md (read this), results.json (every check with the camera's raw answers), backups/.
Exit code 0 when nothing FAILed.
"""
import argparse
import datetime
import json
import os
import re
import sys
import time
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "app"))
import panasonic_scene as app  # noqa: E402
import easyip  # noqa: E402

SCENE_WAIT = 2.5  # seconds after a scene change


# ---------------------------------------------------------------- data from the app itself
def load_js_json(path, var):
    text = open(os.path.join(ROOT, path), encoding="utf-8").read()
    m = re.search(r"window\." + var + r"\s*=\s*", text)
    return json.loads(text[m.end():].strip().rstrip(";"))


CATALOG = load_js_json("app/web/catalog.js", "PANA_CATALOG")
COMMANDS = load_js_json("app/web/commands.js", "PANA_COMMANDS")

# same list as OPERATOR_SPEC in app/web/app.js
OPERATOR_BASES = ['OSJ:29', '#PST', '#UPVS', 'OSE:71', 'OSJ:A8', 'OSJ:A9', 'OSJ:AA', 'OSJ:AB', 'OSJ:AC', 'OSJ:AD',
                  'OSJ:AE', 'OSE:7C', 'OSE:7D', 'OSJ:5B', 'OSJ:D5', 'OSJ:2B', 'OSJ:2C', '#PRF',
                  'OSJ:2D', '#SWZ', 'OAZ', '#SPF', 'OSJ:45', 'OSJ:46',
                  'OAF', 'OSJ:D8', 'OSE:70', 'OSE:7A', 'OSJ:4E', 'OIS']


def operator_params():
    out = []
    for base in OPERATOR_BASES:
        for c in COMMANDS:
            cc = c.get("c") or ""
            if c.get("q") and (cc in (base + "[Data]", base + ":[Data]") or cc.startswith(base + ":[Data") or cc.startswith(base + "[Data")):
                out.append({"cmd": base, "q": c["q"], "t": "ptz" if base.startswith("#") else "cam", "name": c["n"]})
                break
    return out


def profile(model):
    """Mirror of profileFor() in app/web/app.js."""
    m = (model or "").upper().replace("AW-", "")
    if m.startswith("UE150A"):
        return "UE150A", "UE150A", 4
    if re.match(r"^(UE150|UE155|HE145|UN145)", m):
        return "UE150", "UE150/HE145", 4
    if m.startswith("UE160"):
        return "UE160", "UE160", 8
    if m.startswith("UE100"):
        return "UE100", "UE100", 4
    if re.match(r"^(UE80|UE50|UE40|UE30)", m):
        return "UE80", "UE80/UE50/UE40/UE30", 4
    for pat, col in ((r"^(UE20|HE20)", "UE20/HE20"), (r"^UE4", "UE4"), (r"^UR100", "UR100"), (r"^UE70", "UE70"),
                     (r"^HE130", "HE130"), (r"^HE120", "HE120"), (r"^HE40", "HE40"), (r"^HR140", "HR140")):
        if re.match(pat, m):
            return "GENERIC", col, 4
    return "GENERIC", None, 4


def scene_params(model):
    fam, col, _ = profile(model)
    lst = CATALOG.get(fam) or CATALOG["GENERIC"]
    if fam == "GENERIC" and col:
        lst = [x for x in lst if x["t"] == "ptz" or not x.get("m") or col in x["m"]]
    return lst


# ---------------------------------------------------------------- results
class Results:
    def __init__(self):
        self.items = []

    def add(self, cam, area, check, status, detail="", raw=None):
        self.items.append({"camera": cam, "area": area, "check": check, "status": status, "detail": detail, "raw": raw})
        mark = {"PASS": "ok  ", "FAIL": "FAIL", "WARN": "warn", "INFO": "info", "SKIP": "skip"}[status]
        print(f"  [{mark}] {area}: {check}" + (f" - {detail}" if detail else ""), flush=True)


R = Results()


# ---------------------------------------------------------------- camera access
class Cam:
    def __init__(self, ip, port, user, pw):
        self.ip, self.port, self.user, self.pw = ip, port, user, pw
        self.model, self.title, self.scene0 = "", "", None

    def batch(self, items, delay_ms=20):
        return app.api_batch({"ip": self.ip, "port": self.port, "user": self.user, "pass": self.pw,
                              "items": items, "delayMs": delay_ms})["results"]

    def cmd(self, c, kind=None):
        kind = kind or ("ptz" if c.startswith("#") else "cam")
        r = self.batch([{"type": kind, "cmd": c}])[0]
        return r

    def body(self, c):
        r = self.cmd(c)
        return (r.get("body") or "").strip() if r.get("ok") else None


def is_err(b):
    return b is None or bool(re.match(r"^(ER\d|eR\d)", b or ""))


def parse_read(p, r):
    """Mirror of parseRead() in app/web/app.js: returns raw (to send back) or None, and an error text."""
    if not r or not r.get("ok"):
        return None, (r or {}).get("error") or "no response"
    b = (r.get("body") or "").strip()
    if is_err(b):
        return None, b[:3].upper()
    if p["t"] == "ptz":
        code = p["cmd"][1:].lower()
        if b.lower().startswith(code):
            return "#" + b.upper(), ""
    elif b.upper().startswith(p["cmd"] + ":"):
        return b, ""
    return None, "unexpected: " + b[:40]


def read_params(cam, params):
    res = cam.batch([{"type": p["t"], "cmd": p["q"]} for p in params])
    out = []
    for p, r in zip(params, res):
        raw, err = parse_read(p, r)
        out.append({"cmd": p["cmd"], "name": p.get("name", ""), "t": p["t"], "raw": raw, "err": err, "answer": r.get("body")})
    return out


def write_raw(cam, items):
    """Send raw values like the import does (two passes). Returns the commands that were refused."""
    res = cam.batch([{"type": "ptz" if x["raw"].startswith("#") else "cam", "cmd": x["raw"]} for x in items])
    failed = [x for x, r in zip(items, res) if not (r.get("ok") and not is_err(r.get("body")))]
    if failed:
        res = cam.batch([{"type": "ptz" if x["raw"].startswith("#") else "cam", "cmd": x["raw"]} for x in failed])
        failed = [x for x, r in zip(failed, res) if not (r.get("ok") and not is_err(r.get("body")))]
    return failed


def get_scene(cam):
    b = cam.body("QSF")
    m = re.match(r"^OSF:(\d+)", b or "", re.I)
    if not m:
        return None, b
    n = int(m.group(1))
    if profile(cam.model)[0] == "UE160" and n >= 8:
        return 0, b
    return n + 1, b


def switch_scene(cam, n):
    r = cam.cmd(f"XSF:{n}")
    time.sleep(SCENE_WAIT)
    return r


def save_json(folder, name, data):
    os.makedirs(folder, exist_ok=True)
    with open(os.path.join(folder, name), "w", encoding="utf-8") as f:
        json.dump(data, f, indent=1, ensure_ascii=False)


# ---------------------------------------------------------------- tests
def t_identify(cam):
    A = "Identify"
    t0 = time.time()
    rid = cam.cmd("QID")
    dt = time.time() - t0
    if not rid.get("ok"):
        R.add(cam.ip, A, "camera answers (QID)", "FAIL", rid.get("error") or str(rid.get("status")))
        return False
    m = re.match(r"^OID:(.+)$", (rid.get("body") or "").strip(), re.I)
    cam.model = m.group(1).strip() if m else ""
    R.add(cam.ip, A, "model (QID)", "PASS" if cam.model else "FAIL", f"{cam.model or rid.get('body')} in {dt:.2f}s", rid.get("body"))
    fam, col, n = profile(cam.model)
    R.add(cam.ip, A, "profile in the app", "INFO", f"{fam} ({col or 'generic'}), {n} scenes, {len(scene_params(cam.model))} scene settings")
    cam.scene0, raw = get_scene(cam)
    R.add(cam.ip, A, "live scene (QSF)", "PASS" if cam.scene0 is not None else "FAIL", f"scene {cam.scene0} (answer {raw})", raw)
    t = cam.body("QSJ:5C")
    if t and t.upper().startswith("OSJ:5C:"):
        cam.title = t[7:].strip()
        R.add(cam.ip, A, "camera name (QSJ:5C)", "PASS", cam.title, t)
    else:
        R.add(cam.ip, A, "camera name (QSJ:5C)", "INFO", f"not supported ({t}); the app then uses get_basic", t)
    b = app.get_basic(cam.ip, cam.port, cam.user, cam.pw)
    tb = app.title_from_basic(b.get("body")) if b.get("ok") else ""
    if not cam.title:
        cam.title = tb
        R.add(cam.ip, A, "camera name (/cgi-bin/get_basic)", "PASS" if tb else "WARN", tb or f"no cam_title ({b.get('error') or 'answer without cam_title'})",
              (b.get("body") or "")[:300])
    else:
        R.add(cam.ip, A, "camera name via get_basic matches", "PASS" if tb == cam.title else "INFO", f"get_basic gives '{tb}'", (b.get("body") or "")[:300])
    p = cam.body("#O")
    R.add(cam.ip, A, "power state (#O)", "PASS" if p and p.lower() in ("p1", "p0", "p3") else "WARN", p, p)
    return True


def t_scene_read(cam, out):
    A = "Scene file"
    params = scene_params(cam.model)
    t0 = time.time()
    read = read_params(cam, params)
    dt = time.time() - t0
    ok = [r for r in read if r["raw"]]
    er = [r for r in read if not r["raw"] and re.match(r"^ER\d", r["err"] or "")]
    odd = [r for r in read if not r["raw"] and not re.match(r"^ER\d", r["err"] or "")]
    R.add(cam.ip, A, f"read live scene {cam.scene0}", "PASS" if len(ok) > len(params) * 0.8 else "WARN",
          f"{len(ok)}/{len(params)} settings in {dt:.1f}s, {len(er)} refused (ER), {len(odd)} unexpected answers")
    if er:
        R.add(cam.ip, A, "settings the camera refuses", "INFO", ", ".join(f"{r['cmd']} {r['name']} ({r['err']})" for r in er[:40]), [r for r in er])
    if odd:
        R.add(cam.ip, A, "UNEXPECTED answers (catalog may be wrong)", "WARN", "; ".join(f"{r['cmd']}: {r['answer']}" for r in odd[:30]), odd)
    save_json(out, f"{cam.ip}_scene{cam.scene0}_BACKUP.json", {"model": cam.model, "scene": cam.scene0, "params": read})
    return read


def t_scene_switch(cam, backups, out):
    A = "Scene switching"
    _, _, n = profile(cam.model)
    for s in range(1, n + 1):
        switch_scene(cam, s)
        got, raw = get_scene(cam)
        R.add(cam.ip, A, f"XSF:{s} -> scene {s}", "PASS" if got == s else "FAIL", f"QSF says scene {got} ({raw})", raw)
        if s <= 2 and s not in backups:  # back up scene 1 and 2: the import test changes scene 2
            backups[s] = read_params(cam, scene_params(cam.model))
            save_json(out, f"{cam.ip}_scene{s}_BACKUP.json", {"model": cam.model, "scene": s, "params": backups[s]})


def t_scene_roundtrip(cam, backups):
    """The real use: put the settings of scene 1 into scene 2, check them, then put scene 2 back."""
    A = "Import scene"
    if 1 not in backups or 2 not in backups:
        R.add(cam.ip, A, "scene 1 -> scene 2", "SKIP", "scene 1/2 not read")
        return
    s1 = [x for x in backups[1] if x["raw"]]
    switch_scene(cam, 2)
    t0 = time.time()
    failed = write_raw(cam, s1)
    dt = time.time() - t0
    R.add(cam.ip, A, "send scene 1 values into scene 2", "PASS" if not failed else "WARN",
          f"{len(s1) - len(failed)}/{len(s1)} accepted in {dt:.1f}s" + (f"; refused: {', '.join(x['cmd'] for x in failed[:25])}" if failed else ""),
          [{"cmd": x["cmd"], "raw": x["raw"]} for x in failed])
    back = read_params(cam, [p for p in scene_params(cam.model) if any(p["cmd"] == x["cmd"] for x in s1)])
    want = {x["cmd"]: x["raw"].upper() for x in s1 if x not in failed}
    mism = [b for b in back if b["cmd"] in want and b["raw"] and b["raw"].upper() != want[b["cmd"]]]
    R.add(cam.ip, A, "read back scene 2 = scene 1", "PASS" if not mism else "WARN",
          f"{len(mism)} differ" + (": " + "; ".join(f"{b['cmd']} sent {want[b['cmd']]} got {b['raw']}" for b in mism[:20]) if mism else ""), mism)
    if profile(cam.model)[0] == "UE160":
        r = cam.cmd("OSL:90:2")
        R.add(cam.ip, A, "UE160: store in scene file (OSL:90)", "PASS" if r.get("ok") and not is_err(r.get("body")) else "WARN", r.get("body") or r.get("error"))
    # put scene 2 back
    orig2 = [x for x in backups[2] if x["raw"]]
    failed2 = write_raw(cam, orig2)
    back2 = read_params(cam, [p for p in scene_params(cam.model) if any(p["cmd"] == x["cmd"] for x in orig2)])
    want2 = {x["cmd"]: x["raw"].upper() for x in orig2}
    mism2 = [b for b in back2 if b["cmd"] in want2 and b["raw"] and b["raw"].upper() != want2[b["cmd"]]]
    R.add(cam.ip, A, "scene 2 restored", "PASS" if not mism2 and not failed2 else "WARN",
          f"{len(failed2)} refused, {len(mism2)} differ", {"failed": [x["cmd"] for x in failed2], "differ": mism2})
    if profile(cam.model)[0] == "UE160":
        cam.cmd("OSL:90:2")


def t_operator(cam, out):
    A = "Operator file"
    params = operator_params()
    read = read_params(cam, params)
    ok = [r for r in read if r["raw"]]
    save_json(out, f"{cam.ip}_operator_BACKUP.json", {"model": cam.model, "settings": read})
    R.add(cam.ip, A, "read operator settings", "PASS" if ok else "WARN", f"{len(ok)}/{len(params)} read; not available: " +
          ", ".join(f"{r['cmd']} ({r['err']})" for r in read if not r["raw"])[:400])
    failed = write_raw(cam, ok)
    R.add(cam.ip, A, "write the same values back", "PASS" if not failed else "WARN",
          f"{len(ok) - len(failed)}/{len(ok)} accepted" + (f"; refused: {', '.join(x['cmd'] + '=' + x['raw'] for x in failed)}" if failed else ""))
    back = read_params(cam, [p for p in params if any(p["cmd"] == x["cmd"] for x in ok)])
    want = {x["cmd"]: x["raw"].upper() for x in ok}
    mism = [b for b in back if b["raw"] and b["raw"].upper() != want.get(b["cmd"])]
    R.add(cam.ip, A, "values unchanged after writing", "PASS" if not mism else "WARN", "; ".join(f"{b['cmd']} {want[b['cmd']]} -> {b['raw']}" for b in mism))


def t_live(cam, restore):
    A = "Live"
    fam = profile(cam.model)[0]
    # white balance mode: OAW 0 = ATW (Auto), 9 = VAR, 1 = A, 2 = B (what the app sends)
    q = cam.body("QAW")
    R.add(cam.ip, A, "white mode read (QAW)", "PASS" if q and q.upper().startswith("OAW:") else "WARN", q, q)
    if q and q.upper().startswith("OAW:"):
        restore.append(("OAW:" + q.split(":")[1], "white mode"))
    elif fam == "UE160":
        a, b = cam.body("QSL:2A"), cam.body("QSL:2B")
        R.add(cam.ip, A, "UE160 white mode read (QSL:2A / QSL:2B)", "INFO", f"{a} / {b}", [a, b])
        if a and a.upper().startswith("OSL:2A:"):
            restore.append((a, "ATW"))
        if b and b.upper().startswith("OSL:2B:"):
            restore.append((b, "white memory"))
    for label, val, ue160 in (("Auto", "0", ["OSL:2A:1"]), ("Var", "9", ["OSL:2A:0", "OSL:2B:4"]),
                              ("A", "1", ["OSL:2A:0", "OSL:2B:0"]), ("B", "2", ["OSL:2A:0", "OSL:2B:1"])):
        r = cam.cmd("OAW:" + val)
        used = "OAW:" + val
        if not r.get("ok") or is_err(r.get("body")):
            for c in ue160:
                r = cam.cmd(c)
            used = " + ".join(ue160)
        time.sleep(0.4)
        back = cam.body("QAW")
        good = r.get("ok") and not is_err(r.get("body"))
        exact = back and back.upper() == "OAW:" + val
        R.add(cam.ip, A, f"White {label} ({used})", "PASS" if good and (exact or used != "OAW:" + val) else ("WARN" if good else "FAIL"),
              f"answer {r.get('body')}, read back {back}" + ("" if exact or used != "OAW:" + val else " - CHECK on the camera menu which mode is really active"), [r.get("body"), back])
        if label == "A":
            w = cam.cmd("OWS")
            R.add(cam.ip, A, "AWB in memory A (OWS)", "PASS" if w.get("ok") and not is_err(w.get("body")) else "WARN", w.get("body") or w.get("error"))
            time.sleep(3)
    k = cam.cmd("OAS")
    R.add(cam.ip, A, "ABB (OAS)", "PASS" if k.get("ok") and not is_err(k.get("body")) else "WARN", k.get("body") or k.get("error"))
    time.sleep(3)
    # tally
    for col in ("R", "G"):
        before = cam.body(f"QL{col}")
        if before and re.match(rf"^OL{col}:[01]$", before, re.I):
            restore.append((f"TL{col}:{before[-1]}", f"{col} tally"))
        for v in ("1", "0"):
            r = cam.cmd(f"TL{col}:{v}")
            back = cam.body(f"QL{col}")
            R.add(cam.ip, A, f"{'Red' if col == 'R' else 'Green'} tally {'on' if v == '1' else 'off'} (TL{col}:{v})",
                  "PASS" if r.get("ok") and not is_err(r.get("body")) and back == f"OL{col}:{v}" else "WARN",
                  f"answer {r.get('body')}, read back {back}", [r.get("body"), back])
    for v in ("1", "0"):
        r = cam.cmd(f"#DA{v}")
        back = cam.body("#DA")
        R.add(cam.ip, A, f"red tally via pan/tilt command #DA{v} (fallback)", "PASS" if r.get("ok") and not is_err(r.get("body")) and back and back.lower() == f"da{v}" else "WARN",
              f"answer {r.get('body')}, read back {back} (app expects dA{v})", [r.get("body"), back])
    # day / night
    d = cam.body("#D6")
    if d and re.match(r"^d6[01]$", d, re.I):
        restore.append(("#D6" + d[-1], "day/night"))
    for v, lab in (("1", "Night"), ("0", "Day")):
        r = cam.cmd("#D6" + v)
        time.sleep(1.5)
        back = cam.body("#D6")
        R.add(cam.ip, A, f"{lab} (#D6{v})", "PASS" if r.get("ok") and not is_err(r.get("body")) and back and back.lower() == f"d6{v}" else "WARN",
              f"answer {r.get('body')}, read back {back}", [r.get("body"), back])
    # auto focus / auto iris read
    for q, lab in (("QAF", "auto focus"), ("#D3", "auto iris")):
        b = cam.body(q)
        R.add(cam.ip, A, f"{lab} read ({q})", "PASS" if b and not is_err(b) else "WARN", b, b)
    # live picture (the app's Live page uses these through the app)
    for path in (f"/cgi-bin/camera?resolution=640&quality=1", f"/cgi-bin/mjpeg?resolution=640&quality=1"):
        try:
            op = app.build_opener(cam.ip, cam.port, cam.user, cam.pw)
            with op.open(f"http://{cam.ip}:{cam.port}{path}", timeout=5) as r:
                ct = r.headers.get("Content-Type", "")
                chunk = r.read(4096)
            R.add(cam.ip, A, f"picture {path.split('?')[0]}", "PASS" if ("jpeg" in ct.lower() or "multipart" in ct.lower() or chunk[:2] == b"\xff\xd8") else "WARN", ct)
        except Exception as e:
            R.add(cam.ip, A, f"picture {path.split('?')[0]}", "WARN", str(e))


def t_move(cam):
    A = "Move"
    pos = cam.body("#APC")
    R.add(cam.ip, A, "position read (#APC)", "INFO", pos, pos)
    for c, lab in (("#PTS6050", "pan right"), ("#PTS5050", "stop"), ("#Z60", "zoom in"), ("#Z50", "zoom stop")):
        r = cam.cmd(c)
        R.add(cam.ip, A, f"{lab} ({c})", "PASS" if r.get("ok") and not is_err(r.get("body")) else "WARN", r.get("body") or r.get("error"))
        time.sleep(0.5)
    if pos and pos.lower().startswith("apc") and len(pos) >= 11:
        r = cam.cmd("#APC" + pos[3:11].upper())
        R.add(cam.ip, A, "back to the start position", "PASS" if r.get("ok") and not is_err(r.get("body")) else "WARN", r.get("body"))
    r = cam.cmd("#R00")
    R.add(cam.ip, A, "recall preset 1 (#R00)", "PASS" if r.get("ok") and not is_err(r.get("body")) else "WARN", r.get("body") or r.get("error"))
    time.sleep(3)


def t_power(cam):
    A = "Power"
    r = cam.cmd("#O0")
    R.add(cam.ip, A, "standby (#O0)", "PASS" if r.get("ok") and not is_err(r.get("body")) else "FAIL", r.get("body") or r.get("error"))
    time.sleep(4)
    R.add(cam.ip, A, "state in standby (#O)", "INFO", cam.body("#O"))
    r = cam.cmd("#O1")
    R.add(cam.ip, A, "power on (#O1) while in standby", "PASS" if r.get("ok") and not is_err(r.get("body")) else "FAIL", r.get("body") or r.get("error"))
    t0 = time.time()
    st = None
    while time.time() - t0 < 120:
        st = cam.body("#O")
        if st and st.lower() == "p1":
            break
        time.sleep(3)
    R.add(cam.ip, A, "back on (p1)", "PASS" if st and st.lower() == "p1" else "FAIL", f"after {time.time() - t0:.0f}s: {st}")


def t_offline(port):
    A = "Offline camera"
    ip = "10.255.255.77"
    t0 = time.time()
    r = app.api_batch({"ip": ip, "port": port, "items": [{"cmd": "QSD:%02X" % i} for i in range(100)]})["results"]
    dt = time.time() - t0
    R.add("-", A, "100 commands to an address without a camera", "PASS" if dt < 15 else "FAIL", f"{dt:.1f}s (should be seconds, not minutes); last: {r[-1].get('error')}")


def t_easyip(cams, args, out):
    A = "Easy IP"
    try:
        found = easyip.discover(app.local_ipv4s(), 3.0)
    except Exception as e:
        R.add("-", A, "discover", "FAIL", str(e))
        return
    R.add("-", A, "discover", "PASS" if found else "WARN", f"{len(found)} camera(s): " + ", ".join(f"{f['ip']} {f.get('model', '')} '{f.get('name', '')}'" for f in found), found)
    save_json(out, "easyip_discover.json", found)
    for cam in cams:
        f = next((x for x in found if x["ip"] == cam.ip), None)
        if not f:
            R.add(cam.ip, A, "found by Easy IP", "WARN", "not in the Easy IP answers (other subnet, or Easy IP blocked)")
            continue
        R.add(cam.ip, A, "found by Easy IP", "PASS", f"mac {f['mac']}, model {f.get('model')}, name '{f.get('name')}', mask {f.get('mask')}, gw {f.get('gateway')}")
        if cam.model and f.get("model") and f["model"].replace("AW-", "") not in cam.model:
            R.add(cam.ip, A, "model matches QID", "WARN", f"Easy IP {f.get('model')} vs QID {cam.model}")
        if cam.title and f.get("name") and f["name"] != cam.title:
            R.add(cam.ip, A, "name matches the camera name", "INFO", f"Easy IP '{f['name']}' vs '{cam.title}'")
    if not args.network:
        R.add("-", A, "rename / change IP", "SKIP", "run with --network --spare-ip <free ip> to test")
        return
    cam = cams[0]
    f = next((x for x in found if x["ip"] == cam.ip), None)
    if not f:
        R.add(cam.ip, A, "rename / change IP", "SKIP", "first camera not found by Easy IP")
        return
    # rename (the app does this with OSJ:5C)
    old = cam.title
    r = cam.cmd("OSJ:5C:PTTEST1")
    time.sleep(1)
    back = cam.body("QSJ:5C")
    R.add(cam.ip, A, "rename to PTTEST1 (OSJ:5C)", "PASS" if back == "OSJ:5C:PTTEST1" else "WARN", f"answer {r.get('body')}, read back {back}")
    found2 = easyip.discover(app.local_ipv4s(), 3.0)
    f2 = next((x for x in found2 if x["mac"] == f["mac"]), None)
    R.add(cam.ip, A, "Easy IP shows the new name", "PASS" if f2 and f2.get("name") == "PTTEST1" else "INFO", f"'{f2.get('name') if f2 else None}'")
    if old:
        cam.cmd("OSJ:5C:" + old)
        time.sleep(1)
        R.add(cam.ip, A, "name restored", "PASS" if cam.body("QSJ:5C") == "OSJ:5C:" + old else "FAIL", old)
    # IP change and back
    if not args.spare_ip:
        R.add(cam.ip, A, "change IP", "SKIP", "no --spare-ip given")
        return
    orig = dict(ip=f["ip"], mask=f["mask"], gateway=f["gateway"], port=f.get("port") or 80)
    save_json(out, f"{cam.ip}_network_BACKUP.json", f)
    try:
        easyip.configure(f["mac"], args.spare_ip, f["mask"], f["gateway"], f.get("dns1", "0.0.0.0"), f.get("dns2", "0.0.0.0"), orig["port"], app.local_ipv4s())
        ok = False
        for _ in range(30):
            time.sleep(2)
            try:
                if (app.send_command(args.spare_ip, cam.port, "cam", "QID", cam.user, cam.pw, 2.0, 0).get("body") or "").startswith("OID"):
                    ok = True
                    break
            except Exception:
                pass
        R.add(cam.ip, A, f"move to {args.spare_ip} (Easy IP)", "PASS" if ok else "FAIL",
              "camera answers on the new address" if ok else "no answer on the new address within 60s (cameras only accept this ~20 min after power on)")
    finally:
        easyip.discover(app.local_ipv4s(), 3.0)  # refresh the cache with the camera's current state
        easyip.configure(f["mac"], orig["ip"], orig["mask"], orig["gateway"], f.get("dns1", "0.0.0.0"), f.get("dns2", "0.0.0.0"), orig["port"], app.local_ipv4s())
        back = False
        for _ in range(30):
            time.sleep(2)
            if (app.send_command(orig["ip"], cam.port, "cam", "QID", cam.user, cam.pw, 2.0, 0).get("body") or "").startswith("OID"):
                back = True
                break
        R.add(cam.ip, A, f"back to {orig['ip']}", "PASS" if back else "FAIL",
              "restored" if back else f"NOT restored: use Easy IP Setup to give mac {f['mac']} address {orig['ip']} / {orig['mask']} / {orig['gateway']}")


# ---------------------------------------------------------------- main
def report(out, cams, started):
    fails = [x for x in R.items if x["status"] == "FAIL"]
    warns = [x for x in R.items if x["status"] == "WARN"]
    lines = [f"# Panasonic Toolbox real camera test", "",
             f"Started {started:%Y-%m-%d %H:%M}, app version {app.VERSION}.", "",
             f"**{len([x for x in R.items if x['status'] == 'PASS'])} passed, {len(fails)} failed, {len(warns)} warnings.**", ""]
    lines += ["| Camera | Model | Name |", "|---|---|---|"] + [f"| {c.ip} | {c.model or '?'} | {c.title or ''} |" for c in cams] + [""]
    for title, sel in (("Failed", fails), ("Warnings", warns)):
        if sel:
            lines += [f"## {title}", ""] + [f"- **{x['camera']}** {x['area']}: {x['check']} - {x['detail']}" for x in sel] + [""]
    lines += ["## Everything", "", "| Camera | Area | Check | Result | Detail |", "|---|---|---|---|---|"]
    for x in R.items:
        d = str(x["detail"]).replace("|", "/").replace("\n", " ")[:300]
        lines.append(f"| {x['camera']} | {x['area']} | {x['check']} | {x['status']} | {d} |")
    open(os.path.join(out, "report.md"), "w", encoding="utf-8").write("\n".join(lines) + "\n")
    save_json(out, "results.json", R.items)
    return not fails


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--cams", required=True)
    ap.add_argument("--port", type=int, default=80)
    ap.add_argument("--user")
    ap.add_argument("--password")
    ap.add_argument("--network", action="store_true")
    ap.add_argument("--spare-ip")
    ap.add_argument("--skip-power", action="store_true")
    ap.add_argument("--skip-move", action="store_true")
    ap.add_argument("--out")
    args = ap.parse_args()
    started = datetime.datetime.now()
    out = args.out or os.path.join(ROOT, "tools", "test-output", started.strftime("%Y-%m-%d_%H-%M"))
    os.makedirs(out, exist_ok=True)
    print(f"Panasonic Toolbox {app.VERSION} - real camera test - output in {out}\n")
    cams = [Cam(ip.strip(), args.port, args.user, args.password) for ip in args.cams.split(",") if ip.strip()]
    for cam in cams:
        if not app.target_allowed(cam.ip):
            print(f"{cam.ip} is not a local network address; the app refuses it too.")
            sys.exit(2)

    t_offline(args.port)
    for cam in cams:
        print(f"\n== {cam.ip}")
        if not t_identify(cam):
            continue
        restore, backups = [], {}
        try:
            backups[cam.scene0] = t_scene_read(cam, os.path.join(out, "backups"))
            t_scene_switch(cam, backups, os.path.join(out, "backups"))
            t_scene_roundtrip(cam, backups)
            t_operator(cam, os.path.join(out, "backups"))
            if cam.scene0:
                switch_scene(cam, cam.scene0)
            t_live(cam, restore)
            if not args.skip_move:
                t_move(cam)
            if not args.skip_power:
                t_power(cam)
        except Exception as e:
            R.add(cam.ip, "Test", "unexpected error", "FAIL", repr(e))
        finally:
            for c, what in reversed(restore):
                r = cam.cmd(c)
                if not (r.get("ok") and not is_err(r.get("body"))):
                    R.add(cam.ip, "Restore", what, "WARN", f"{c}: {r.get('body') or r.get('error')}")
            if cam.scene0:
                switch_scene(cam, cam.scene0)
                got, _ = get_scene(cam)
                R.add(cam.ip, "Restore", f"back to live scene {cam.scene0}", "PASS" if got == cam.scene0 else "FAIL", f"now {got}")
            if cam.scene0 in backups:
                failed = write_raw(cam, [x for x in backups[cam.scene0] if x["raw"]])
                R.add(cam.ip, "Restore", f"scene {cam.scene0} settings as before", "PASS" if not failed else "WARN", f"{len(failed)} refused")
    print("\n== Easy IP")
    t_easyip([c for c in cams if c.model], args, out)
    ok = report(out, cams, started)
    print(f"\nReport: {os.path.join(out, 'report.md')}")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
