#!/usr/bin/env python3
"""Mock Easy IP Setup responder for tests: pretends to be two cameras in other IP ranges.
Run: python3 tools/mock_easyip.py   (listens on UDP 10670, answers on UDP 10669)"""
import os
import socket
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "app"))
import easyip  # noqa: E402

CAMS = [
    {"mac": bytes.fromhex("A81374000001"), "ip": "10.20.30.41", "mask": "255.255.0.0", "gw": "10.20.0.1", "model": "AW-UE150", "name": "CAM-STUDIO-A"},
    {"mac": bytes.fromhex("A81374000002"), "ip": "172.16.5.9", "mask": "255.255.255.0", "gw": "172.16.5.1", "model": "AW-UE160", "name": "CAM-STUDIO-B"},
]


def announcement(c, req_mac, req_ip):
    def tlv(tag, val):
        return bytes([tag >> 8, tag & 255, len(val) >> 8, len(val) & 255]) + bytes(val)
    ip, mask, gw = easyip._ip_bytes(c["ip"]), easyip._ip_bytes(c["mask"]), easyip._ip_bytes(c["gw"])
    pkt = bytes([0, 1, 0, 0, 0, 0x0E]) + c["mac"] + req_mac + req_ip
    pkt += bytes([0, 0]) + easyip._MAGIC + bytes([0, 0, 2, 2]) + bytes(14) + bytes([1, 2, 0, 1, 0, 1, 0])
    pkt += tlv(0x20, ip) + tlv(0x21, mask) + tlv(0x22, gw) + tlv(0x23, bytes(8)) + tlv(0x25, b"\x00\x50")
    pkt += tlv(0x40, bytes(16)) + tlv(0xA6, b"\x92")
    pkt += tlv(0xA7, c["model"].encode().ljust(16, b"\0")) + tlv(0xA8, c["name"].encode().ljust(16, b"\0"))
    return easyip._finish(pkt)


s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
s.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
s.bind(("", easyip.REQUEST_PORT))
print("Mock Easy IP responder on UDP", easyip.REQUEST_PORT)
while True:
    data, addr = s.recvfrom(4096)
    kind = data[4:6]
    if kind == b"\x00\x0d":
        for c in CAMS:
            s.sendto(announcement(c, data[12:18], data[18:22]), ("255.255.255.255", easyip.ANNOUNCE_PORT))
    elif kind == b"\x00\x02":
        t = easyip._tlvs(data)
        for c in CAMS:
            if c["mac"] == data[6:12]:
                c["ip"], c["mask"], c["gw"] = easyip._ip_str(t[0x20]), easyip._ip_str(t[0x21]), easyip._ip_str(t[0x22])
                print("reconfigured", c["name"], "->", c["ip"], flush=True)
