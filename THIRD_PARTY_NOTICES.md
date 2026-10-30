# Open source components

Panasonic Toolbox itself is licensed under the [MIT license](LICENSE). The installed app includes the following third-party components:

| Component | Used for | License |
|---|---|---|
| [Python](https://www.python.org/) | Runtime inside the app | Python Software Foundation License |
| [PyInstaller](https://pyinstaller.org/) | Bundles the app (bootloader) | GPL-2.0 with *bootloader exception*: bundled apps may be distributed under their own license |
| [pywebview](https://pywebview.flowrl.com/) | The app window | BSD-3-Clause |
| [bottle](https://bottlepy.org/) (via pywebview) | Used by pywebview | MIT |
| [proxy_tools](https://pypi.org/project/proxy_tools/) (via pywebview) | Used by pywebview | MIT |
| [PyObjC](https://pyobjc.readthedocs.io/) (macOS) | Bridge to WebKit | MIT |
| [pythonnet](https://pythonnet.github.io/) en clr_loader (Windows) | Bridge to Microsoft Edge WebView2 | MIT |

The website uses the [IBM Plex](https://github.com/IBM/plex) typeface (SIL Open Font License 1.1, see `assets/fonts/OFL-IBM-Plex.txt`), self-hosted.

The scene settings in `app/web/catalog.js` and the command list in `app/web/commands.js` are based on Panasonic's public *HD/4K Integrated Camera Interface Specifications* and *Remote Camera Controller Interface Specifications*, using the Markdown transcriptions in [bitfocus/companion-module-panasonic-cameras](https://github.com/bitfocus/companion-module-panasonic-cameras) (MIT). Panasonic is a trademark of Panasonic Holdings Corporation; this project is not affiliated with Panasonic.

The exact versions of the bundled Python packages are listed in the `build-info-*.txt` files of each release.
