# -*- mode: python ; coding: utf-8 -*-
# PyInstaller-spec voor Panasonic Scene.  Bouwen:  pyinstaller app/panasonic_scene.spec
import os, re, sys

HERE = os.path.abspath(SPECPATH)
ROOT = os.path.dirname(HERE)
VERSION = re.search(r'VERSION = "([^"]+)"', open(os.path.join(HERE, 'panasonic_scene.py')).read()).group(1)
NAME = 'Panasonic Scene'

a = Analysis(
    [os.path.join(HERE, 'panasonic_scene.py')],
    pathex=[HERE],
    datas=[(os.path.join(HERE, 'web'), 'web')],
    hiddenimports=['webview'],
    excludes=['tkinter', 'unittest', 'pydoc', 'test'],
)
pyz = PYZ(a.pure)

if sys.platform == 'darwin':
    exe = EXE(pyz, a.scripts, [], exclude_binaries=True, name=NAME, console=False,
              icon=os.path.join(ROOT, 'assets', 'icon.icns'))
    coll = COLLECT(exe, a.binaries, a.datas, name=NAME)
    app = BUNDLE(
        coll,
        name=NAME + '.app',
        icon=os.path.join(ROOT, 'assets', 'icon.icns'),
        bundle_identifier='be.seppevanaken.panasonicscene',
        version=VERSION,
        info_plist={
            'CFBundleDisplayName': NAME,
            'CFBundleShortVersionString': VERSION,
            'CFBundleVersion': VERSION,
            'LSMinimumSystemVersion': '11.0',
            'NSHighResolutionCapable': True,
            # macOS 15+: toestemming om camera's op het lokale netwerk te bereiken
            'NSLocalNetworkUsageDescription': 'Panasonic Scene verbindt met je PTZ-camera\'s op het lokale netwerk om scene files uit te lezen en terug te zetten.',
            'NSAppTransportSecurity': {'NSAllowsArbitraryLoads': True, 'NSAllowsLocalNetworking': True},
        },
    )
else:
    exe = EXE(pyz, a.scripts, [], exclude_binaries=True, name=NAME, console=False,
              icon=os.path.join(ROOT, 'assets', 'icon.ico'))
    coll = COLLECT(exe, a.binaries, a.datas, name=NAME)
