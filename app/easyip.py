"""Panasonic Easy IP Setup protocol: find Panasonic cameras on the local network in any IP range and
change their network settings.

The cameras listen for requests on UDP port 10670 and answer with a broadcast on UDP port 10669.
Messages: a 6-byte header (00 01, length, type), the camera MAC, the sender's MAC and IPv4 address,
a fixed block, then tag-length-value fields, closed by FF FF and a 16-bit checksum
(sum of all preceding bytes + 1). Type 0x000D = discovery request, 0x000E = announcement,
0x0002 = reconfiguration. Layout verified against packet captures of the official Easy IP Setup tool.

Cameras only accept a reconfiguration during a limited time after power-on (setting
"Easy IP Setup accommodate period", 20 minutes by default).
"""
import socket
import threading
import time
import uuid

REQUEST_PORT = 10670
ANNOUNCE_PORT = 10669
_MAGIC = bytes([0x20, 0x11, 0x1E, 0x11, 0x23, 0x1F, 0x1E, 0x19, 0x13])
_FIELDS_ASKED = [0x20, 0x21, 0x22, 0x23, 0x25, 0x28, 0x40, 0x41, 0x42, 0x44, 0xA5, 0xA6, 0xA7, 0xA8, 0xAD, 0xB3, 0xB4, 0xB7, 0xB8]
_cache = {}  # mac -> last announcement (dict incl. raw tlvs)
_lock = threading.Lock()


def _finish(pkt):
    pkt = bytearray(pkt) + b"\xff\xff"
    n = len(pkt) + 2 - 52
    pkt[2], pkt[3] = (n >> 8) & 0xFF, n & 0xFF
    ck = (sum(pkt) + 1) & 0xFFFF
    return bytes(pkt) + bytes([ck >> 8, ck & 0xFF])


def _my_mac():
    n = uuid.getnode()
    return bytes((n >> s) & 0xFF for s in (40, 32, 24, 16, 8, 0))


def _ip_bytes(ip):
    return bytes(int(x) for x in ip.split("."))


def _ip_str(b):
    return ".".join(str(x) for x in b[:4])


def discovery_request(src_ip):
    pkt = bytes([0, 1, 0, 0, 0, 0x0D]) + bytes(6) + _my_mac() + _ip_bytes(src_ip)
    pkt += bytes([0, 0]) + _MAGIC + bytes([0, 0, 0, 1]) + bytes(11) + bytes([0xFF, 0xF0, 0, 0x26])
    pkt += b"".join(bytes([t >> 8, t & 0xFF]) for t in _FIELDS_ASKED)
    return _finish(pkt)


def _tlvs(data, start=58):
    out, i = {}, start
    while i + 4 <= len(data) - 4:
        tag = (data[i] << 8) | data[i + 1]
        ln = (data[i + 2] << 8) | data[i + 3]
        if tag == 0xFFFF:
            break
        out[tag] = data[i + 4:i + 4 + ln]
        i += 4 + ln
    return out


def _cstr(b):
    return bytes(b).split(b"\x00", 1)[0].decode("ascii", "replace").strip()


def parse_announcement(data):
    if len(data) < 64 or data[0:2] != b"\x00\x01" or data[4:6] != b"\x00\x0e":
        return None
    t = _tlvs(data)
    if 0x20 not in t:
        return None
    mac = data[6:12]
    dns = t.get(0x23, bytes(8))
    port = t.get(0x25, b"\x00\x50")
    return {
        "mac": ":".join(f"{x:02X}" for x in mac),
        "ip": _ip_str(t[0x20]),
        "mask": _ip_str(t.get(0x21, bytes(4))),
        "gateway": _ip_str(t.get(0x22, bytes(4))),
        "dns1": _ip_str(dns[:4]),
        "dns2": _ip_str(dns[4:8]) if len(dns) >= 8 else "0.0.0.0",
        "port": (port[0] << 8) | port[1] if len(port) >= 2 else 80,
        "model": _cstr(t.get(0xA7, b"")),
        "name": _cstr(t.get(0xA8, b"")),
        "version": _cstr(t.get(0xA9, b"")),
        "_raw": {k: bytes(v) for k, v in t.items()},
        "_macb": bytes(mac),
    }


def reconfiguration(cam, ip, mask, gateway, dns1="0.0.0.0", dns2="0.0.0.0", port=80, src_ip="0.0.0.0"):
    raw = cam.get("_raw", {})

    def tlv(tag, val):
        val = bytes(val)
        return bytes([tag >> 8, tag & 0xFF, len(val) >> 8, len(val) & 0xFF]) + val
    ipb, mb, gb = _ip_bytes(ip), _ip_bytes(mask), _ip_bytes(gateway)
    dns = _ip_bytes(dns1) + _ip_bytes(dns2)
    pb = bytes([port >> 8, port & 0xFF])
    pkt = bytes([0, 1, 0, 0, 0, 0x02]) + cam["_macb"] + _my_mac() + _ip_bytes(src_ip)
    pkt += bytes([0, 1]) + _MAGIC + bytes([0, 0, 2, 2]) + bytes(14) + bytes([1, 3, 0, 1, 0, 1, 0])
    pkt += tlv(0x20, ipb) + tlv(0x21, mb) + tlv(0x22, gb) + tlv(0x23, dns) + tlv(0x25, pb)
    pkt += tlv(0x40, raw.get(0x40, bytes(16))) + tlv(0x41, raw.get(0x41, bytes(16))) + tlv(0x42, raw.get(0x42, bytes(32)))
    pkt += tlv(0x44, pb)
    pkt += tlv(0xA0, ipb) + tlv(0xA1, mb) + tlv(0xA2, gb) + tlv(0xA3, dns) + tlv(0xA6, raw.get(0xA6, b"\x92"))
    return _finish(pkt)


def _broadcast_targets(local_ips):
    targets = {("255.255.255.255", None)}
    for ip in local_ips:
        targets.add(("255.255.255.255", ip))
        parts = ip.split(".")
        targets.add((".".join(parts[:3] + ["255"]), ip))
    return targets


def _send(pkt, local_ips):
    for dst, src in _broadcast_targets(local_ips):
        try:
            s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            s.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
            if src:
                s.bind((src, 0))
            s.sendto(pkt, (dst, REQUEST_PORT))
            s.close()
        except OSError:
            pass


def _listener():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    if hasattr(socket, "SO_REUSEPORT"):
        try:
            s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEPORT, 1)
        except OSError:
            pass
    s.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
    s.bind(("", ANNOUNCE_PORT))
    return s


def discover(local_ips, timeout=3.0):
    """Send discovery requests on every interface and collect the announcements."""
    found = {}
    try:
        lst = _listener()
    except OSError as e:
        raise RuntimeError(f"UDP port {ANNOUNCE_PORT} is in use (is the Panasonic Easy IP Setup tool open?): {e}")
    lst.settimeout(0.25)
    try:
        for ip in (local_ips or ["0.0.0.0"]):
            _send(discovery_request(ip if ip != "0.0.0.0" else "0.0.0.0"), [ip] if ip != "0.0.0.0" else [])
        end = time.time() + timeout
        resent = False
        while time.time() < end:
            if not resent and time.time() > end - timeout / 2:  # second round for slow cameras
                for ip in (local_ips or ["0.0.0.0"]):
                    _send(discovery_request(ip), [ip] if ip != "0.0.0.0" else [])
                resent = True
            try:
                data, _ = lst.recvfrom(4096)
            except socket.timeout:
                continue
            a = parse_announcement(data)
            if a:
                found[a["mac"]] = a
    finally:
        lst.close()
    with _lock:
        _cache.update(found)
    return [public(a) for a in sorted(found.values(), key=lambda x: tuple(int(p) for p in x["ip"].split(".")))]


def public(a):
    return {k: v for k, v in a.items() if not k.startswith("_")}


def configure(mac, ip, mask, gateway, dns1, dns2, port, local_ips):
    with _lock:
        cam = _cache.get(mac.upper())
    if not cam:
        raise ValueError("Camera not found. Search again first.")
    for v in (ip, mask, gateway, dns1, dns2):
        parts = v.split(".")
        if len(parts) != 4 or not all(p.isdigit() and 0 <= int(p) <= 255 for p in parts):
            raise ValueError(f"Invalid address: {v}")
    src = local_ips[0] if local_ips else "0.0.0.0"
    _send(reconfiguration(cam, ip, mask, gateway, dns1, dns2, int(port), src), local_ips)
    return True
