#!/usr/bin/env python3
"""
Panasonic Scene — lokale app
============================
Exporteer en importeer scene files (shading) van Panasonic PTZ-camera's.

Het programma start een kleine webserver op http://127.0.0.1:8765 en opent de
interface in een eigen venster (pywebview) of, als dat niet lukt, in je
standaardbrowser. Alle communicatie met de camera's gebeurt vanaf je laptop
via /cgi-bin/aw_cam en /cgi-bin/aw_ptz.

Starten vanuit broncode:  python3 panasonic_scene.py   [--browser] [--port 8765]
"""
import argparse
import base64
import re
import subprocess
import ipaddress
import json
import os
import secrets
import socket
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import webbrowser
from concurrent.futures import ThreadPoolExecutor
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

APP_NAME = "Panasonic Scene"
VERSION = "2.0.0"
DEFAULT_PORT = 8765


def resource_dir():
    # PyInstaller pakt bestanden uit in sys._MEIPASS
    base = getattr(sys, "_MEIPASS", os.path.dirname(os.path.abspath(__file__)))
    return os.path.join(base, "web")


WEB_DIR = resource_dir()
STATIC_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json",
    ".webmanifest": "application/manifest+json",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".ico": "image/x-icon",
    ".woff2": "font/woff2",
}

CONFIG = {"origins": set(), "allow_public": False, "port": DEFAULT_PORT}
# Willekeurige sleutel per sessie: enkel de eigen interface (die de sleutel in de pagina krijgt)
# kan de API gebruiken. Beschermt tegen andere websites/processen die naar 127.0.0.1 sturen.
SESSION_TOKEN = secrets.token_urlsafe(32)
SECURITY_HEADERS = {
    "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
                               "img-src 'self' data: blob:; font-src 'self'; connect-src 'self' https://api.github.com; "
                               "object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Cross-Origin-Opener-Policy": "same-origin",
}
_cam_locks = {}
_cam_locks_guard = threading.Lock()


def cam_lock(ip):
    with _cam_locks_guard:
        return _cam_locks.setdefault(ip, threading.Lock())


def target_allowed(ip):
    try:
        addr = ipaddress.ip_address(ip)
    except ValueError:
        return False
    if addr.is_loopback:
        return True  # testen met mock-camera's
    return CONFIG["allow_public"] or addr.is_private or addr.is_link_local


def build_opener(ip, port, user, password):
    handlers = []
    if user:
        mgr = urllib.request.HTTPPasswordMgrWithDefaultRealm()
        mgr.add_password(None, f"http://{ip}:{port}/", user, password or "")
        handlers += [urllib.request.HTTPDigestAuthHandler(mgr), urllib.request.HTTPBasicAuthHandler(mgr)]
    handlers.append(urllib.request.ProxyHandler({}))  # nooit een systeem-proxy voor camera's
    return urllib.request.build_opener(*handlers)


def send_command(ip, port, kind, cmd, user=None, password=None, timeout=3.0, retries=2):
    """Eén AW-commando. kind = 'cam' (aw_cam) of 'ptz' (aw_ptz)."""
    path = "aw_ptz" if kind == "ptz" else "aw_cam"
    url = f"http://{ip}:{port}/cgi-bin/{path}?cmd={urllib.parse.quote(cmd, safe=':')}&res=1"
    opener = build_opener(ip, port, user, password)
    last_err = None
    for attempt in range(retries + 1):
        try:
            with opener.open(url, timeout=timeout) as r:
                body = r.read().decode("ascii", "replace").strip()
                if body.upper().startswith("ER2") and attempt < retries:  # camera bezig
                    time.sleep(0.3)
                    continue
                return {"ok": True, "status": r.status, "body": body}
        except urllib.error.HTTPError as e:
            if e.code == 401:
                return {"ok": False, "status": 401, "error": "Authenticatie vereist of fout wachtwoord"}
            last_err = f"HTTP {e.code}"
        except Exception as e:
            last_err = str(getattr(e, "reason", e))
        time.sleep(0.15)
    return {"ok": False, "status": 0, "error": last_err or "onbekende fout"}


def save_dir():
    home = os.path.expanduser("~")
    d = os.path.join(home, "Downloads") if os.path.isdir(os.path.join(home, "Downloads")) else home
    d = os.path.join(d, "Panasonic Scene")
    os.makedirs(d, exist_ok=True)
    return d


def safe_name(name):
    base = os.path.basename(str(name or "bestand"))
    base = re.sub(r"[^A-Za-z0-9._ -]+", "_", base).strip(" .") or "bestand"
    if not re.search(r"\.(json|zip|s15|html|csv)$", base, re.I):
        raise ValueError("Bestandstype niet toegelaten")
    return base[:150]


def save_file(name, data):
    d = save_dir()
    stem, ext = os.path.splitext(safe_name(name))
    path = os.path.join(d, stem + ext)
    n = 1
    while os.path.exists(path):  # nooit overschrijven
        path = os.path.join(d, f"{stem} ({n}){ext}")
        n += 1
    with open(path, "xb") as f:
        f.write(data)
    return path


def reveal(path=None):
    target = path if path and os.path.exists(path) else save_dir()
    if sys.platform == "darwin":
        subprocess.Popen(["open", "-R", target] if os.path.isfile(target) else ["open", target])
    elif sys.platform.startswith("win"):
        subprocess.Popen(["explorer", "/select,", target] if os.path.isfile(target) else ["explorer", target])
    else:
        subprocess.Popen(["xdg-open", os.path.dirname(target) if os.path.isfile(target) else target])


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
            base, start = a.rsplit(".", 1)
            end = int(b.rsplit(".", 1)[-1])
            out += [f"{base}.{i}" for i in range(int(start), end + 1)]
        else:
            out.append(part)
    return [ip for ip in dict.fromkeys(out) if target_allowed(ip)]


def probe(ip, port, user, password):
    r = send_command(ip, port, "cam", "QID", user, password, timeout=0.8, retries=0)
    if r.get("status") == 401:
        return {"ip": ip, "port": port, "auth": True, "model": "?"}
    if not r.get("ok") or not r["body"].upper().startswith("OID:"):
        return None
    info = {"ip": ip, "port": port, "model": r["body"][4:]}
    t = send_command(ip, port, "cam", "QSJ:5C", user, password, timeout=1.0, retries=0)
    if t.get("ok") and t["body"].upper().startswith("OSJ:5C:"):
        info["title"] = t["body"][7:]
    p = send_command(ip, port, "ptz", "#O", user, password, timeout=1.0, retries=0)
    if p.get("ok"):
        info["power"] = p["body"]
    return info


class Handler(BaseHTTPRequestHandler):
    server_version = "PanasonicScene"
    sys_version = ""

    def log_message(self, fmt, *args):
        if os.environ.get("PSCENE_VERBOSE"):
            sys.stderr.write("[app] " + (fmt % args) + "\n")

    # ---- beveiliging ----
    def host_ok(self):
        """DNS-rebinding: enkel verzoeken naar 127.0.0.1/localhost op onze eigen poort."""
        host = (self.headers.get("Host") or "").lower()
        return host in (f"127.0.0.1:{CONFIG['port']}", f"localhost:{CONFIG['port']}")

    def origin_ok(self):
        origin = self.headers.get("Origin")
        if not origin:
            return True
        own = {f"http://127.0.0.1:{CONFIG['port']}", f"http://localhost:{CONFIG['port']}"}
        return origin in own or origin in CONFIG["origins"]

    def token_ok(self):
        return secrets.compare_digest(self.headers.get("X-PS-Token", ""), SESSION_TOKEN)

    def cors(self):
        origin = self.headers.get("Origin")
        if origin and origin in CONFIG["origins"]:  # enkel voor ontwikkeling (--allow-origin)
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type, X-PS-Token")

    def end_headers(self):
        for k, v in SECURITY_HEADERS.items():
            self.send_header(k, v)
        super().end_headers()

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
        self.send_response(204 if self.host_ok() and self.origin_ok() else 403)
        self.cors()
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self):
        if not self.host_ok() or not self.origin_ok():
            return self.send_json(403, {"ok": False, "error": "Niet toegelaten"})
        path = urllib.parse.urlparse(self.path).path
        if path == "/api/ping":
            # publiek: enkel om te zien of de app al draait
            return self.send_json(200, {"ok": True, "name": "panasonic-scene", "version": VERSION})
        if path == "/api/info":
            if not self.token_ok():
                return self.send_json(401, {"ok": False, "error": "token"})
            return self.send_json(200, {"ok": True, "name": "panasonic-scene", "version": VERSION,
                                        "localIps": local_ipv4s(), "platform": sys.platform})
        if path in ("", "/"):
            path = "/index.html"
        root = os.path.realpath(WEB_DIR)
        full = os.path.realpath(os.path.join(root, path.lstrip("/")))
        if os.path.commonpath([root, full]) != root or not os.path.isfile(full):
            return self.send_json(404, {"ok": False, "error": "niet gevonden"})
        with open(full, "rb") as f:
            data = f.read()
        if full.endswith("index.html"):
            data = data.replace(b"__PS_TOKEN__", SESSION_TOKEN.encode())
        self.send_response(200)
        self.send_header("Content-Type", STATIC_TYPES.get(os.path.splitext(full)[1].lower(), "application/octet-stream"))
        self.send_header("Cache-Control", "no-store" if full.endswith(".html") else "no-cache")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_POST(self):
        if not self.host_ok() or not self.origin_ok():
            return self.send_json(403, {"ok": False, "error": "Niet toegelaten"})
        if not self.token_ok():
            return self.send_json(401, {"ok": False, "error": "token"})
        if not (self.headers.get("Content-Type") or "").startswith("application/json"):
            return self.send_json(415, {"ok": False, "error": "JSON verwacht"})
        path = urllib.parse.urlparse(self.path).path
        try:
            n = int(self.headers.get("Content-Length") or 0)
            if n > (60_000_000 if path == "/api/save" else 2_000_000):
                raise ValueError("Verzoek te groot")
            req = json.loads(self.rfile.read(n) or b"{}")
        except Exception as e:
            return self.send_json(400, {"ok": False, "error": f"Ongeldig verzoek: {e}"})
        try:
            if path == "/api/batch":
                return self.send_json(200, self.batch(req))
            if path == "/api/scan":
                return self.send_json(200, self.scan(req))
            if path == "/api/save":
                data = base64.b64decode(req.get("dataB64") or "", validate=True)
                return self.send_json(200, {"ok": True, "path": save_file(req.get("name"), data), "dir": save_dir()})
            if path == "/api/reveal":
                p = req.get("path")
                if p and os.path.commonpath([save_dir(), os.path.realpath(p)]) != save_dir():
                    p = None  # enkel binnen de eigen map
                reveal(p)
                return self.send_json(200, {"ok": True})
            if path == "/api/quit":
                self.send_json(200, {"ok": True})
                threading.Timer(0.3, lambda: os._exit(0)).start()
                return
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
        delay = max(0, min(2000, int(req.get("delayMs", 20)))) / 1000.0
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
        with ThreadPoolExecutor(max_workers=64) as ex:
            found = [r for r in ex.map(lambda ip: probe(ip, port, user, pw), targets) if r]
        found.sort(key=lambda x: tuple(int(p) for p in x["ip"].split(".")))
        return {"ok": True, "scanned": len(targets), "cameras": found}


def running_instance(port):
    """Draait de app al? Dan gewoon dat venster/die pagina openen."""
    try:
        with urllib.request.build_opener(urllib.request.ProxyHandler({})).open(
                f"http://127.0.0.1:{port}/api/ping", timeout=0.6) as r:
            return json.loads(r.read()).get("name") == "panasonic-scene"
    except Exception:
        return False


def start_server(preferred):
    for port in [preferred] + list(range(preferred + 1, preferred + 11)):
        try:
            srv = ThreadingHTTPServer(("127.0.0.1", port), Handler)
            CONFIG["port"] = port
            threading.Thread(target=srv.serve_forever, daemon=True).start()
            return srv, port
        except OSError:
            continue
    raise SystemExit("Geen vrije poort gevonden tussen %d en %d" % (preferred, preferred + 10))


def open_window(url):
    """Eigen venster via pywebview; anders de standaardbrowser. Geeft True terug als er een venster was."""
    try:
        import webview  # pywebview (zit in de geïnstalleerde app)
    except Exception:
        webbrowser.open(url)
        return False
    try:
        webview.settings["ALLOW_DOWNLOADS"] = True
        webview.settings["OPEN_EXTERNAL_LINKS_IN_BROWSER"] = True
    except Exception:
        pass
    webview.create_window(APP_NAME, url, width=1320, height=900, min_size=(900, 600))
    webview.start()  # blokkeert tot het venster sluit
    return True


def main():
    ap = argparse.ArgumentParser(description=APP_NAME)
    ap.add_argument("--port", type=int, default=DEFAULT_PORT)
    ap.add_argument("--browser", action="store_true", help="Open in de standaardbrowser i.p.v. een eigen venster")
    ap.add_argument("--headless", action="store_true", help="Enkel de server starten (voor tests)")
    ap.add_argument("--allow-origin", action="append", default=[], help="Extra origin voor ontwikkeling")
    ap.add_argument("--allow-public-ips", action="store_true")
    # macOS geeft soms een '-psn_...' argument mee bij starten vanuit Finder
    a, _unknown = ap.parse_known_args()
    CONFIG["origins"] = set(o.rstrip("/") for o in a.allow_origin)
    CONFIG["allow_public"] = a.allow_public_ips

    if running_instance(a.port):
        webbrowser.open(f"http://127.0.0.1:{a.port}/")
        return
    srv, port = start_server(a.port)
    url = f"http://127.0.0.1:{port}/"
    print(f"{APP_NAME} {VERSION} draait op {url}  (stoppen: venster sluiten of Ctrl+C)")
    try:
        if a.headless:
            while True:
                time.sleep(3600)
        if a.browser or not open_window(url):
            if a.browser:
                webbrowser.open(url)
            while True:  # browser-modus: blijf draaien tot Ctrl+C / proces stopt
                time.sleep(3600)
    except KeyboardInterrupt:
        pass
    finally:
        srv.shutdown()


if __name__ == "__main__":
    main()
