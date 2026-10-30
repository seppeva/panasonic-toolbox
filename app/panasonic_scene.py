#!/usr/bin/env python3
"""
Panasonic Toolbox — lokale app
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

import easyip
from concurrent.futures import ThreadPoolExecutor
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

APP_NAME = "Panasonic Toolbox"
VERSION = "2.7.0"
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
                return {"ok": False, "status": 401, "error": "Login required or wrong password"}
            last_err = f"HTTP {e.code}"
        except Exception as e:
            last_err = str(getattr(e, "reason", e))
        time.sleep(0.15)
    return {"ok": False, "status": 0, "error": last_err or "unknown error"}


SETTINGS = {}
WINDOW = None  # pywebview window (for native file dialogs)
ALLOWED_EXT = (".json", ".zip", ".s15", ".html", ".csv", ".ps1", ".sh", ".pshow", ".poper")


def settings_path():
    return os.path.join(app_data_dir(), "settings.json")


def load_settings():
    try:
        with open(settings_path()) as f:
            SETTINGS.update(json.load(f))
    except Exception:
        pass


def save_settings():
    try:
        with open(settings_path(), "w") as f:
            json.dump(SETTINGS, f)
    except Exception:
        pass


def default_save_dir():
    home = os.path.expanduser("~")
    d = os.path.join(home, "Downloads") if os.path.isdir(os.path.join(home, "Downloads")) else home
    return os.path.join(d, "Panasonic Toolbox")


def save_dir():
    d = SETTINGS.get("saveDir") or default_save_dir()
    if not os.path.isdir(d):
        try:
            os.makedirs(d, exist_ok=True)
        except OSError:
            d = default_save_dir()
            os.makedirs(d, exist_ok=True)
    return d


def native_dialog(kind, multiple=False):
    """Native folder/file dialog via pywebview. Returns a list of paths, or None if unavailable."""
    if WINDOW is None:
        return None
    import webview
    if kind == "folder":
        res = WINDOW.create_file_dialog(webview.FOLDER_DIALOG, directory=save_dir())
    else:
        res = WINDOW.create_file_dialog(webview.OPEN_DIALOG, directory=save_dir(), allow_multiple=multiple,
                                        file_types=("Panasonic Toolbox files (*.json;*.zip;*.pshow;*.poper;*.s15)", "All files (*.*)"))
    return list(res) if res else []


def list_files(folder):
    folder = os.path.realpath(os.path.expanduser(folder))
    if not os.path.isdir(folder):
        raise ValueError("Folder not found")
    out = []
    for name in sorted(os.listdir(folder)):
        full = os.path.join(folder, name)
        if os.path.isfile(full) and name.lower().endswith(ALLOWED_EXT):
            st = os.stat(full)
            out.append({"name": name, "path": full, "size": st.st_size, "mtime": int(st.st_mtime)})
    return {"folder": folder, "files": out}


def read_file(path):
    path = os.path.realpath(os.path.expanduser(str(path)))
    if not path.lower().endswith(ALLOWED_EXT) or not os.path.isfile(path):
        raise ValueError("File type not allowed or file not found")
    if os.path.getsize(path) > 50_000_000:
        raise ValueError("File too large")
    with open(path, "rb") as f:
        return {"name": os.path.basename(path), "path": path, "dataB64": base64.b64encode(f.read()).decode()}


def safe_name(name):
    base = os.path.basename(str(name or "bestand"))
    base = re.sub(r"[^A-Za-z0-9._ -]+", "_", base).strip(" .") or "bestand"
    if not base.lower().endswith(ALLOWED_EXT):
        raise ValueError("File type not allowed")
    return base[:150]


def save_file(name, data, folder=None):
    d = os.path.realpath(os.path.expanduser(folder)) if folder else save_dir()
    os.makedirs(d, exist_ok=True)
    stem, ext = os.path.splitext(safe_name(name))
    path = os.path.join(d, stem + ext)
    n = 1
    while os.path.exists(path):  # nooit overschrijven
        path = os.path.join(d, f"{stem} ({n}){ext}")
        n += 1
    with open(path, "xb") as f:
        f.write(data)
    return path


def rename_file(path, new_name, data=None):
    """Renames a file the app saved (a preset, say) within its own folder; optionally rewrites its contents.
    Never overwrites another file."""
    src = os.path.realpath(os.path.expanduser(str(path or "")))
    if not os.path.isfile(src) or not src.lower().endswith(ALLOWED_EXT):
        raise ValueError("File not found")
    ext = ".pscene.json" if src.lower().endswith(".pscene.json") else os.path.splitext(src)[1]
    stem = safe_name(re.sub(r"(\.pscene\.json|\.[A-Za-z0-9]+)$", "", os.path.basename(str(new_name))) + ext)[: -len(ext)]
    d = os.path.dirname(src)
    dst = os.path.join(d, stem + ext)
    n = 1
    while os.path.exists(dst) and os.path.realpath(dst) != src:
        dst = os.path.join(d, f"{stem} ({n}){ext}")
        n += 1
    if data is not None:
        tmp = dst + ".tmp"
        with open(tmp, "wb") as f:
            f.write(data)
        os.replace(tmp, dst)
        if os.path.realpath(dst) != src:
            os.remove(src)
    elif os.path.realpath(dst) != src:
        os.rename(src, dst)
    return dst


def reveal(path=None):
    target = path if path and os.path.exists(path) else save_dir()
    if sys.platform == "darwin":
        subprocess.Popen(["open", "-R", target] if os.path.isfile(target) else ["open", target])
    elif sys.platform.startswith("win"):
        subprocess.Popen(["explorer", "/select,", target] if os.path.isfile(target) else ["explorer", target])
    else:
        subprocess.Popen(["xdg-open", os.path.dirname(target) if os.path.isfile(target) else target])


def open_camera_page(url):
    """Open de webpagina van een camera in de standaardbrowser (enkel http(s) naar een privé-IP)."""
    u = urllib.parse.urlsplit(url)
    if u.scheme not in ("http", "https") or not u.hostname or not target_allowed(u.hostname):
        raise ValueError("Only camera addresses on the local network can be opened")
    webbrowser.open(url)
    return {"ok": True}


_ips_cache = {"t": 0.0, "ips": []}
_ips_guard = threading.Lock()


def _hostname_ips(out):
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            out.add(info[4][0])
    except OSError:
        pass


def local_ipv4s():
    """This computer's IPv4 addresses. Cached for a few seconds; the host name lookup can hang for
    seconds on macOS (mDNS), so it runs in a thread with a short limit and never blocks the app."""
    with _ips_guard:
        if time.time() - _ips_cache["t"] < 5:
            return list(_ips_cache["ips"])
    ips = set()
    for probe in ("192.168.0.1", "10.0.0.1", "172.16.0.1", "8.8.8.8"):
        try:
            s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            s.connect((probe, 9))
            ips.add(s.getsockname()[0])
            s.close()
        except OSError:
            pass
    extra = set()
    t = threading.Thread(target=_hostname_ips, args=(extra,), daemon=True)
    t.start()
    t.join(0.5)
    ips |= extra
    out = sorted(i for i in ips if not i.startswith("127.") and not i.startswith("0."))
    with _ips_guard:
        _ips_cache.update(t=time.time(), ips=out)
    return out


def cached_ips():
    with _ips_guard:
        if _ips_cache["t"]:
            return list(_ips_cache["ips"])
    return []


def _ips_refresher():
    while True:
        try:
            with _ips_guard:
                _ips_cache["t"] = 0  # force a fresh lookup
            local_ipv4s()
        except Exception:
            pass
        time.sleep(10)


def expand_targets(spec):
    """'192.168.0.0/24', '192.168.0.10-60' of '192.168.0.10,192.168.0.11'"""
    out = []
    for part in [p.strip() for p in str(spec).split(",") if p.strip()]:
        if "/" in part:
            net = ipaddress.ip_network(part, strict=False)
            if net.num_addresses > 1024:
                raise ValueError("Range too large (max /22)")
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


# Live view: the page gets a random stream id; the server opens the camera's MJPEG stream (with the login)
# and passes it through, so the camera login never ends up in a URL and the page needs no access to the camera.
STREAMS = {}
_streams_guard = threading.Lock()
STREAM_RES = ("1920x1080", "1280x720", "640x360", "320x180")


def open_stream(ip, port, user, password, res):
    sid = secrets.token_urlsafe(18)
    with _streams_guard:
        for k in [k for k, v in STREAMS.items() if v["ip"] == ip or time.time() - v["t"] > 3600]:
            STREAMS[k]["closed"] = True
            del STREAMS[k]
        STREAMS[sid] = {"ip": ip, "port": port, "user": user, "password": password, "res": res, "t": time.time(), "closed": False}
    return sid


def close_stream(sid):
    with _streams_guard:
        s = STREAMS.pop(sid, None)
        if s:
            s["closed"] = True


def api_batch(req):
    ip = str(req.get("ip", "")).strip()
    if not target_allowed(ip):
        raise ValueError(f"Target IP {ip!r} not allowed (private addresses only)")
    port = int(req.get("port") or 80)
    user, pw = req.get("user") or None, req.get("pass") or None
    delay = max(0, min(2000, int(req.get("delayMs", 20)))) / 1000.0
    timeout = float(req.get("timeout", 3.0))
    items = req.get("items") or []
    if len(items) > 1000:
        raise ValueError("At most 1000 commands per batch")
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

def api_scan(req):
    targets = expand_targets(req.get("range", ""))
    if not targets:
        raise ValueError("No (allowed) addresses in range")
    port = int(req.get("port") or 80)
    user, pw = req.get("user") or None, req.get("pass") or None
    with ThreadPoolExecutor(max_workers=64) as ex:
        found = [r for r in ex.map(lambda ip: probe(ip, port, user, pw), targets) if r]
    found.sort(key=lambda x: tuple(int(p) for p in x["ip"].split(".")))
    return {"ok": True, "scanned": len(targets), "cameras": found}


def api_info():
    # Must answer instantly: no file system access (a save folder on a sleeping network drive can hang)
    # and no network lookups; the IP addresses come from a cache that a background thread keeps fresh.
    return {"ok": True, "name": "panasonic-scene", "version": VERSION, "localIps": cached_ips(), "platform": sys.platform,
            "saveDir": SETTINGS.get("saveDir") or default_save_dir(), "nativeDialogs": WINDOW is not None, "time": time.time()}


def api_call(path, req):
    """All app functions. Called by the window directly (pywebview bridge, no network) or over local HTTP (browser mode)."""
    if path == "/api/info":
        return api_info()
    if path == "/api/batch":
        return (api_batch(req))
    if path == "/api/scan":
        return (api_scan(req))
    if path == "/api/save":
        data = base64.b64decode(req.get("dataB64") or "", validate=True)
        return ({"ok": True, "path": save_file(req.get("name"), data, req.get("dir")), "dir": req.get("dir") or save_dir()})
    if path == "/api/rename":
        data = base64.b64decode(req["dataB64"], validate=True) if req.get("dataB64") else None
        return {"ok": True, "path": rename_file(req.get("path"), req.get("name"), data)}
    if path == "/api/reveal":
        p = req.get("path")
        if p and not os.path.exists(os.path.realpath(p)):
            p = None
        reveal(p)
        return ({"ok": True})
    if path == "/api/eip/discover":
        return ({"ok": True, "cameras": easyip.discover(local_ipv4s(), float(req.get("timeout", 3)))})
    if path == "/api/eip/set":
        easyip.configure(str(req.get("mac", "")), str(req.get("ip", "")), str(req.get("mask", "")),
                         str(req.get("gateway", "")), str(req.get("dns1", "0.0.0.0")), str(req.get("dns2", "0.0.0.0")),
                         int(req.get("port") or 80), local_ipv4s())
        return ({"ok": True})
    if path == "/api/stream/open":
        ip, port = str(req.get("ip", "")), int(req.get("port") or 80)
        if not target_allowed(ip):
            raise ValueError("Only cameras on the local network")
        res = req.get("res") if req.get("res") in STREAM_RES else "640x360"
        return ({"ok": True, "id": open_stream(ip, port, req.get("user") or None, req.get("pass") or "", res)})
    if path == "/api/stream/close":
        close_stream(str(req.get("id", "")))
        return ({"ok": True})
    if path == "/api/folder":
        if req.get("set"):
            d = os.path.realpath(os.path.expanduser(str(req["set"])))
            os.makedirs(d, exist_ok=True)
            SETTINGS["saveDir"] = d
            save_settings()
        return ({"ok": True, "dir": save_dir()})
    if path == "/api/choose":
        res = native_dialog(req.get("kind", "folder"), bool(req.get("multiple")))
        if res is None:
            return ({"ok": False, "error": "unavailable"})
        return ({"ok": True, "paths": res})
    if path == "/api/list_files":
        return ({"ok": True, **list_files(req.get("folder") or save_dir())})
    if path == "/api/read_file":
        return ({"ok": True, **read_file(req.get("path"))})
    if path == "/api/open_url":
        return (open_camera_page(str(req.get("url", ""))))
    if path == "/api/quit":
        threading.Timer(0.3, lambda: os._exit(0)).start()
        return {"ok": True}
    raise LookupError("unknown endpoint")


class Handler(BaseHTTPRequestHandler):
    server_version = "PanasonicToolbox"
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
            return self.send_json(403, {"ok": False, "error": "Not allowed"})
        path = urllib.parse.urlparse(self.path).path
        if path == "/api/ping":
            # publiek: enkel om te zien of de app al draait
            return self.send_json(200, {"ok": True, "name": "panasonic-scene", "version": VERSION})
        if path == "/api/info":
            if not self.token_ok():
                return self.send_json(401, {"ok": False, "error": "token"})
            return self.send_json(200, api_info())
        if path.startswith("/api/stream/"):
            with _streams_guard:
                s = STREAMS.get(path.rsplit("/", 1)[-1])
            if not s:
                return self.send_json(404, {"ok": False, "error": "stream closed"})
            return self.proxy_stream(s)
        if path in ("", "/"):
            path = "/index.html"
        root = os.path.realpath(WEB_DIR)
        full = os.path.realpath(os.path.join(root, path.lstrip("/")))
        if os.path.commonpath([root, full]) != root or not os.path.isfile(full):
            return self.send_json(404, {"ok": False, "error": "not found"})
        with open(full, "rb") as f:
            data = f.read()
        if full.endswith("index.html"):
            data = data.replace(b"__PS_TOKEN__", SESSION_TOKEN.encode()).replace(b"__PS_VERSION__", VERSION.encode())
        self.send_response(200)
        self.send_header("Content-Type", STATIC_TYPES.get(os.path.splitext(full)[1].lower(), "application/octet-stream"))
        self.send_header("Cache-Control", "no-store" if full.endswith(".html") else "no-cache")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_POST(self):
        if not self.host_ok() or not self.origin_ok():
            return self.send_json(403, {"ok": False, "error": "Not allowed"})
        if not self.token_ok():
            return self.send_json(401, {"ok": False, "error": "token"})
        if not (self.headers.get("Content-Type") or "").startswith("application/json"):
            return self.send_json(415, {"ok": False, "error": "JSON expected"})
        path = urllib.parse.urlparse(self.path).path
        try:
            n = int(self.headers.get("Content-Length") or 0)
            if n > (60_000_000 if path == "/api/save" else 2_000_000):
                raise ValueError("Request too large")
            req = json.loads(self.rfile.read(n) or b"{}")
        except Exception as e:
            return self.send_json(400, {"ok": False, "error": f"Invalid request: {e}"})
        try:
            return self.send_json(200, api_call(path, req))
        except LookupError as e:
            return self.send_json(404, {"ok": False, "error": str(e)})
        except ValueError as e:
            return self.send_json(400, {"ok": False, "error": str(e)})
        except Exception as e:
            return self.send_json(500, {"ok": False, "error": f"{type(e).__name__}: {e}"})

    def proxy_stream(self, s):
        """Passes the camera's MJPEG stream through. Falls back to JPEG snapshots for cameras without MJPEG."""
        base = f"http://{s['ip']}:{s['port']}/cgi-bin"
        opener = build_opener(s["ip"], s["port"], s["user"], s["password"])
        try:
            up = opener.open(f"{base}/mjpeg?resolution={s['res']}&quality=1", timeout=5)
            ctype = up.headers.get("Content-Type", "")
            if "multipart" not in ctype:
                up.close()
                raise ValueError("no mjpeg")
        except urllib.error.HTTPError as e:
            if e.code == 401:
                return self.send_json(401, {"ok": False, "error": "Login required"})
            up = None
        except Exception:
            up = None
        self.send_response(200)
        self.send_header("Cache-Control", "no-store")
        try:
            if up is not None:
                self.send_header("Content-Type", up.headers.get("Content-Type"))
                self.end_headers()
                with up:
                    while not s["closed"]:
                        chunk = up.read1(65536) if hasattr(up, "read1") else up.read(16384)
                        if not chunk:
                            break
                        self.wfile.write(chunk)
                return
            # snapshot fallback, about 5 frames per second
            self.send_header("Content-Type", "multipart/x-mixed-replace; boundary=frame")
            self.end_headers()
            width = s["res"].split("x")[0]
            fails = 0
            while not s["closed"] and fails < 10:
                try:
                    with opener.open(f"{base}/camera?resolution={width}&quality=1", timeout=4) as r:
                        jpg = r.read()
                    fails = 0
                    self.wfile.write(b"--frame\r\nContent-Type: image/jpeg\r\nContent-Length: " + str(len(jpg)).encode() + b"\r\n\r\n" + jpg + b"\r\n")
                except (BrokenPipeError, ConnectionResetError):
                    raise
                except Exception:
                    fails += 1
                time.sleep(0.2)
        except (BrokenPipeError, ConnectionResetError, OSError):
            pass


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
    raise SystemExit("No free port between %d and %d" % (preferred, preferred + 10))


def app_data_dir():
    if sys.platform == "darwin":
        base = os.path.expanduser("~/Library/Application Support")
    elif sys.platform.startswith("win"):
        base = os.environ.get("APPDATA") or os.path.expanduser("~")
    else:
        base = os.environ.get("XDG_DATA_HOME") or os.path.expanduser("~/.local/share")
    d = os.path.join(base, APP_NAME)
    os.makedirs(d, exist_ok=True)
    return d


class WindowBridge:
    """Direct line between the app window and the Python side: no network, ports or session key involved."""

    def call(self, path, body=None):
        try:
            return api_call(str(path), body or {})
        except LookupError as e:
            return {"ok": False, "status": 404, "error": str(e)}
        except ValueError as e:
            return {"ok": False, "status": 400, "error": str(e)}
        except Exception as e:
            return {"ok": False, "status": 500, "error": f"{type(e).__name__}: {e}"}


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
    global WINDOW
    WINDOW = webview.create_window(APP_NAME, url + "?app=1", width=1320, height=900, min_size=(900, 600), js_api=WindowBridge())
    try:
        # Niet-privé modus + vaste map: camera-lijst en instellingen blijven bewaard tussen sessies
        webview.start(private_mode=False, storage_path=app_data_dir())
    except TypeError:
        webview.start()
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

    load_settings()
    if running_instance(a.port):
        webbrowser.open(f"http://127.0.0.1:{a.port}/")
        return
    threading.Thread(target=_ips_refresher, daemon=True).start()
    srv, port = start_server(a.port)
    url = f"http://127.0.0.1:{port}/"
    print(f"{APP_NAME} {VERSION} running at {url}  (stop: close the window or Ctrl+C)")
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
