#!/usr/bin/env python3
"""Mock Panasonic PTZ voor tests (zonder echte camera).
Gebruik: python3 mock_camera.py 127.0.0.11 8080 AW-UE150 "CAM 1"
Leest catalog.js om te weten welke scène-commando's het model kent.
"""
import json, os, re, sys, threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

HOST, PORT, MODEL, TITLE = sys.argv[1], int(sys.argv[2]), sys.argv[3], (sys.argv[4] if len(sys.argv) > 4 else "")
root = os.path.join(os.path.dirname(__file__), "..")
cat = json.loads(re.search(r"window\.PANA_CATALOG = (.*);\s*$", open(os.path.join(root, "app", "web", "catalog.js")).read(), re.S).group(1))
fam = "UE160" if "UE160" in MODEL else "UE80" if re.search(r"UE(80|50|40)", MODEL) else "UE150"
params = {p["cmd"]: p for p in cat[fam]}
NSCENE = 8 if fam == "UE160" else 4
lock = threading.Lock()

def default(p, scene):
    if p["cmd"] in ("OSI:20", "OSJ:4A", "OSL:2F"):
        return f"{3200 + scene * 100:05X}:0"
    if p["t"] == "ptz":
        return "0"
    d = p.get("dec")
    if d and d["kind"] == "lin":
        v = (d["lo"] + d["hi"]) // 2 + scene
        return f"{v:0{max(2, len(format(d['hi'], 'X')))}X}"
    return str(scene % 2)

scenes = {s: {c: default(p, s) for c, p in params.items()} for s in range(1, NSCENE + 1)}
cur = {"scene": 1, "store": {}}

class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def do_GET(self):
        u = urlparse(self.path); cmd = parse_qs(u.query).get("cmd", [""])[0]
        body = self.handle_cmd(cmd, u.path.endswith("aw_ptz"))
        b = body.encode(); self.send_response(200); self.send_header("Content-Type", "text/plain")
        self.send_header("Content-Length", str(len(b))); self.end_headers(); self.wfile.write(b)
    def handle_cmd(self, c, ptz):
        global extra
        with lock:
            st = scenes[cur["scene"]]
            if ptz:
                if c == "#O": return "p1"
                if c == "#D6": return "d6" + st["#D6"]
                m = re.match(r"#D6([01])$", c)
                if m: st["#D6"] = m.group(1); return "d6" + m.group(1)
                for k in ("#UPVS", "#PST", "#PRF", "#SWZ", "#SPF", "#TAE"):  # operator settings (camera-wide)
                    if c == k: return k[1:].lower() + extra.get(k, "0")
                    if c.startswith(k): extra[k] = c[len(k):]; return k[1:].lower() + c[len(k):]
                return "eR1"
            if c == "QID": return "OID:" + MODEL
            if c == "QSF": return f"OSF:{cur['scene'] - 1}"
            m = re.match(r"XSF:(\d)$", c)
            if m:
                n = int(m.group(1))
                if 1 <= n <= NSCENE: cur["scene"] = n; return c
                return "ER3:XSF"
            if c == "QSJ:5C": return "OSJ:5C:" + TITLE if TITLE else "ER1:QSJ"
            m = re.match(r"OSL:90:(\d)$", c)
            if m and fam == "UE160": cur["store"][int(m.group(1))] = dict(st); return c
            if c.startswith("Q"):
                key = "O" + c[1:]
                if key in params: return f"{key}:{st[key]}"
                if c[1:4] not in ("SJ:", "SE:", "AF", "AZ", "IS", "SA:"): return "ER1:" + c[:6]
            m = re.match(r"(O[A-Z]{2}(?::[0-9A-F]{2})?):(.+)$", c)
            if m and m.group(1) in params:
                key, val = m.group(1), m.group(2)
                # afhankelijkheid testen: R/B gain enkel als WB-mode niet 4 (=ATW in deze mock)
                if key in ("OSG:39", "OSG:3A") and st.get("OAW") == "4": return "ER3:" + key
                st[key] = val.upper(); return c
            if c.startswith("Q") and c[1:4] in ("SJ:", "SE:", "AF", "AZ", "IS", "SA:"):  # operator settings
                key = "O" + c[1:]; return f"{key}:{extra.get(key, '0')}"
            m = re.match(r"(O[A-Z]{2}(?::[0-9A-F]{2})?):(.+)$", c)
            if m: extra[m.group(1)] = m.group(2).upper(); return c
            return "ER1:" + c[:6]

extra = {}
print(f"Mock {MODEL} ({fam}, {len(params)} params) op http://{HOST}:{PORT}")
ThreadingHTTPServer((HOST, PORT), H).serve_forever()
