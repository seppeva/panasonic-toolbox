#!/usr/bin/env python3
"""
Panasonic Scene Bridge
======================
Kleine lokale helper (alleen Python 3 standaardbibliotheek) die de web-app op
https://seppevanaken.be/panasonicscene laat praten met Panasonic PTZ-camera's.

Waarom nodig?  Een https-website mag in de browser niet rechtstreeks naar
http://192.168.x.x verbinden (mixed content) en de camera's sturen geen
CORS-headers mee, dus de browser zou de antwoorden toch niet mogen lezen.
Deze bridge draait op je laptop op http://127.0.0.1:8765 , ontvangt de
commando's van de app en stuurt ze door naar /cgi-bin/aw_cam en /cgi-bin/aw_ptz.

Starten:   python3 panasonic_scene_bridge.py
Opties:    --port 8765   --allow-origin https://andere.site   --allow-public-ips

De bridge luistert enkel op 127.0.0.1 en accepteert enkel verzoeken van de
toegelaten websites. Standaard stuurt hij enkel door naar privé-IP-adressen
(192.168.x.x, 10.x.x.x, 172.16-31.x.x, 169.254.x.x).
"""
import argparse
import ipaddress
import json
import os
import socket
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

VERSION = "1.0.0"
DEFAULT_ORIGINS = {
    "https://seppevanaken.be",
    "https://www.seppevanaken.be",
}
ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
STATIC_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".ico": "image/x-icon",
    ".md": "text/plain; charset=utf-8",
}

CONFIG = {"origins": set(DEFAULT_ORIGINS), "allow_public": False, "port": 8765}
# Eén lock per camera: Panasonic-camera's houden niet van gelijktijdige commando's.
_cam_locks = {}
_cam_locks_guard = threading.Lock()


def cam_lock(ip):
    with _cam_locks_guard:
        if ip not in _cam_locks:
            _cam_locks[ip] = threading.Lock()
        return _cam_locks[ip]


def target_allowed(ip):
    try:
        addr = ipaddress.ip_address(ip)
    except ValueError:
        return False
    if addr.is_loopback:
        return True  # handig voor tests met een mock-camera
    if CONFIG["allow_public"]:
        return True
    return addr.is_private or addr.is_link_local


def build_opener(ip, port, user, password):
    handlers = []
    if user:
        mgr = urllib.request.HTTPPasswordMgrWithDefaultRealm()
        mgr.add_password(None, f"http://{ip}:{port}/", user, password or "")
        handlers += [urllib.request.HTTPDigestAuthHandler(mgr), urllib.request.HTTPBasicAuthHandler(mgr)]
    # Nooit een systeem-proxy gebruiken voor lokale camera's.
    handlers.append(urllib.request.ProxyHandler({}))
    return urllib.request.build_opener(*handlers)


def send_command(ip, port, kind, cmd, user=None, password=None, timeout=3.0, retries=2):
    """Stuur één AW-commando. kind = 'cam' (aw_cam) of 'ptz' (aw_ptz)."""
    path = "aw_ptz" if kind == "ptz" else "aw_cam"
    q = urllib.parse.quote(cmd, safe=":")
    url = f"http://{ip}:{port}/cgi-bin/{path}?cmd={q}&res=1"
    opener = build_opener(ip, port, user, password)
    last_err = None
    for attempt in range(retries + 1):
        try:
            with opener.open(url, timeout=timeout) as r:
                body = r.read().decode("ascii", "replace").strip()
                # ER2 = camera bezig -> even wachten en opnieuw
                if body.upper().startswith("ER2") and attempt < retries:
                    time.sleep(0.3)
                    continue
                return {"ok": True, "status": r.status, "body": body}
        except urllib.error.HTTPError as e:
            if e.code == 401:
                return {"ok": False, "status": 401, "error": "Authenticatie vereist of fout wachtwoord"}
            last_err = f"HTTP {e.code}"
        except Exception as e:  # timeout, connection refused, ...
            last_err = str(getattr(e, "reason", e))
        time.sleep(0.15)
    return {"ok": False, "status": 0, "error": last_err or "onbekende fout"}


def local_ipv4s():
    ips = set()
    for probe in ("192.168.0.1", "10.0.0.1", "172.16.0.1", "8.8.8.8"):
        try:
            s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            s.connect((probe, 9))
            ips.add(s.getsockname()[0])
            s.close()
        except OSError:
            pass
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            ips.add(info[4][0])
    except OSError:
        pass
    return sorted(i for i in ips if not i.startswith("127."))


def expand_targets(spec):
    """'192.168.0.0/24', '192.168.0.10-60' of '192.168.0.10,192.168.0.11'"""
    out = []
    for part in [p.strip() for p in str(spec).split(",") if p.strip()]:
        if "/" in part:
            net = ipaddress.ip_network(part, strict=False)
            if net.num_addresses > 1024:
                raise ValueError("Bereik te groot (max /22)")
            out += [str(h) for h in net.hosts()]
        elif "-" in part:
            a, b = part.split("-", 1)
            base = a.rsplit(".", 1)
            start = int(base[1])
            end = int(b.rsplit(".", 1)[-1])
            out += [f"{base[0]}.{i}" for i in range(start, end + 1)]
        else:
            out.append(part)
    return [ip for ip in dict.fromkeys(out) if target_allowed(ip)]


def probe(ip, port, user, password):
    r = send_command(ip, port, "cam", "QID", user, password, timeout=0.8, retries=0)
    if not r.get("ok") and r.get("status") != 401:
        return None
    info = {"ip": ip, "port": port}
    if r.get("status") == 401:
        info["auth"] = True
        info["model"] = "?"
        return info
    body = r["body"]
    if not body.upper().startswith("OID:"):
        return None
    info["model"] = body[4:]
    t = send_command(ip, port, "cam", "QSJ:5C", user, password, timeout=1.0, retries=0)
    if t.get("ok") and t["body"].upper().startswith("OSJ:5C:"):
        info["title"] = t["body"][7:]
    p = send_command(ip, port, "ptz", "#O", user, password, timeout=1.0, retries=0)
    if p.get("ok"):
        info["power"] = p["body"]
    return info


class Handler(BaseHTTPRequestHandler):
    server_version = "PanasonicSceneBridge/" + VERSION

    def log_message(self, fmt, *args):
        if os.environ.get("BRIDGE_VERBOSE"):
            sys.stderr.write("[bridge] " + (fmt % args) + "\n")

    # ---- CORS / Private Network Access ----
    def origin_ok(self):
        origin = self.headers.get("Origin")
        if not origin:
            return True  # zelfde origin (app geserveerd door de bridge) of curl
        own = {f"http://127.0.0.1:{CONFIG['port']}", f"http://localhost:{CONFIG['port']}"}
        return origin in CONFIG["origins"] or origin in own

    def cors(self):
        origin = self.headers.get("Origin")
        if origin and self.origin_ok():
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            self.send_header("Access-Control-Allow-Private-Network", "true")
            self.send_header("Access-Control-Max-Age", "600")

    def send_json(self, code, obj):
        data = json.dumps(obj).encode()
        self.send_response(code)
        self.cors()
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_OPTIONS(self):
        self.send_response(204 if self.origin_ok() else 403)
        self.cors()
        self.send_header("Content-Length", "0")
        self.end_headers()

    def read_json(self):
        n = int(self.headers.get("Content-Length") or 0)
        if n > 2_000_000:
            raise ValueError("Verzoek te groot")
        return json.loads(self.rfile.read(n) or b"{}")

    def do_GET(self):
        if not self.origin_ok():
            return self.send_json(403, {"ok": False, "error": "Origin niet toegelaten"})
        path = urllib.parse.urlparse(self.path).path
        if path == "/api/ping":
            return self.send_json(200, {"ok": True, "name": "panasonic-scene-bridge", "version": VERSION,
                                        "localIps": local_ipv4s(), "allowPublic": CONFIG["allow_public"]})
        # Statische bestanden: de bridge kan de app ook zelf serveren (offline / Safari)
        if path in ("", "/"):
            path = "/index.html"
        full = os.path.abspath(os.path.join(ROOT_DIR, path.lstrip("/")))
        if not full.startswith(ROOT_DIR) or not os.path.isfile(full):
            return self.send_json(404, {"ok": False, "error": "niet gevonden"})
        ext = os.path.splitext(full)[1].lower()
        with open(full, "rb") as f:
            data = f.read()
        self.send_response(200)
        self.send_header("Content-Type", STATIC_TYPES.get(ext, "application/octet-stream"))
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_POST(self):
        if not self.origin_ok():
            return self.send_json(403, {"ok": False, "error": "Origin niet toegelaten"})
        path = urllib.parse.urlparse(self.path).path
        try:
            req = self.read_json()
        except Exception as e:
            return self.send_json(400, {"ok": False, "error": f"Ongeldige JSON: {e}"})
        try:
            if path == "/api/batch":
                return self.send_json(200, self.batch(req))
            if path == "/api/scan":
                return self.send_json(200, self.scan(req))
            return self.send_json(404, {"ok": False, "error": "onbekend endpoint"})
        except ValueError as e:
            return self.send_json(400, {"ok": False, "error": str(e)})
        except Exception as e:
            return self.send_json(500, {"ok": False, "error": f"{type(e).__name__}: {e}"})

    def batch(self, req):
        ip = str(req.get("ip", "")).strip()
        if not target_allowed(ip):
            raise ValueError(f"Doel-IP {ip!r} niet toegelaten (enkel privé-adressen)")
        port = int(req.get("port") or 80)
        user, pw = req.get("user") or None, req.get("pass") or None
        delay = max(0, min(2000, int(req.get("delayMs", 60)))) / 1000.0
        timeout = float(req.get("timeout", 3.0))
        items = req.get("items") or []
        if len(items) > 1000:
            raise ValueError("Max 1000 commando's per batch")
        results = []
        with cam_lock(ip):
            for i, it in enumerate(items):
                if it.get("sleepMs"):
                    time.sleep(min(10000, int(it["sleepMs"])) / 1000.0)
                    results.append({"ok": True, "sleep": True})
                    continue
                kind = "ptz" if it.get("type") == "ptz" else "cam"
                r = send_command(ip, port, kind, str(it.get("cmd", "")), user, pw, timeout)
                r["cmd"] = it.get("cmd")
                results.append(r)
                if r.get("status") == 401:
                    # zinloos om door te gaan zonder juiste login
                    results += [{"ok": False, "status": 401, "cmd": x.get("cmd"), "error": "auth"} for x in items[i + 1:]]
                    break
                if delay and i < len(items) - 1:
                    time.sleep(delay)
        return {"ok": True, "ip": ip, "results": results}

    def scan(self, req):
        targets = expand_targets(req.get("range", ""))
        if not targets:
            raise ValueError("Geen (toegelaten) adressen in bereik")
        port = int(req.get("port") or 80)
        user, pw = req.get("user") or None, req.get("pass") or None
        found = []
        with ThreadPoolExecutor(max_workers=64) as ex:
            for res in ex.map(lambda ip: probe(ip, port, user, pw), targets):
                if res:
                    found.append(res)
        found.sort(key=lambda x: tuple(int(p) for p in x["ip"].split(".")))
        return {"ok": True, "scanned": len(targets), "cameras": found}


def main():
    ap = argparse.ArgumentParser(description="Lokale bridge voor de Panasonic Scene File app")
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--allow-origin", action="append", default=[],
                    help="Extra website die de bridge mag gebruiken (bv. http://localhost:5500)")
    ap.add_argument("--allow-public-ips", action="store_true",
                    help="Ook niet-privé doel-IP's toelaten (normaal niet nodig)")
    a = ap.parse_args()
    CONFIG["port"] = a.port
    CONFIG["origins"] |= set(o.rstrip("/") for o in a.allow_origin)
    CONFIG["allow_public"] = a.allow_public_ips
    srv = ThreadingHTTPServer(("127.0.0.1", a.port), Handler)
    print(f"Panasonic Scene Bridge {VERSION}")
    print(f"  Luistert op http://127.0.0.1:{a.port}")
    print(f"  Toegelaten websites: {', '.join(sorted(CONFIG['origins']))}")
    print(f"  Lokale IP-adressen van deze laptop: {', '.join(local_ipv4s()) or '-'}")
    print(f"  Open nu https://seppevanaken.be/panasonicscene  (of offline: http://127.0.0.1:{a.port}/)")
    print("  Stoppen: Ctrl+C")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\nGestopt.")


if __name__ == "__main__":
    main()
