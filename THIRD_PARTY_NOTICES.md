# Open-sourcecomponenten

Panasonic Scene zelf valt onder de [MIT-licentie](LICENSE). De geïnstalleerde app bevat de volgende componenten van derden:

| Component | Gebruik | Licentie |
|---|---|---|
| [Python](https://www.python.org/) | Runtime in de app | Python Software Foundation License |
| [PyInstaller](https://pyinstaller.org/) | Bundelt de app (bootloader) | GPL-2.0 met *bootloader exception*: toegestaan om gebundelde apps onder eigen licentie te verspreiden |
| [pywebview](https://pywebview.flowrl.com/) | Eigen app-venster | BSD-3-Clause |
| [bottle](https://bottlepy.org/) (via pywebview) | Hulpcode van pywebview | MIT |
| [proxy_tools](https://pypi.org/project/proxy_tools/) (via pywebview) | Hulpcode van pywebview | MIT |
| [PyObjC](https://pyobjc.readthedocs.io/) (macOS) | Koppeling met WebKit | MIT |
| [pythonnet](https://pythonnet.github.io/) en clr_loader (Windows) | Koppeling met Microsoft Edge WebView2 | MIT |

De webpagina gebruikt het lettertype [IBM Plex](https://github.com/IBM/plex) (SIL Open Font License 1.1, zie `assets/fonts/OFL-IBM-Plex.txt`), zelf gehost.

De lijst met scène-parameters in `app/web/catalog.js` is opgesteld op basis van de openbare *HD/4K Integrated Camera Interface Specifications* van Panasonic, via de Markdown-transcripties in [bitfocus/companion-module-panasonic-cameras](https://github.com/bitfocus/companion-module-panasonic-cameras) (MIT). Panasonic is een handelsmerk van Panasonic Holdings Corporation; dit project is niet verbonden aan Panasonic.

De exacte versies van de gebundelde Python-pakketten staan in de bestanden `build-info-*.txt` bij elke release.
