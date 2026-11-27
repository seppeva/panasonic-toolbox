"""Collects the license texts that must travel with the built app into app/licenses/.

Run in the build after the dependencies are installed:  python tools/collect_licenses.py
The folder is bundled by app/panasonic_scene.spec, so the licenses of Python, pywebview, PyObjC/pythonnet and
the other bundled packages are inside every copy of the app, next to the app's own MIT license.
"""
import importlib.metadata as md
import os
import re
import shutil
import sys
import sysconfig

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "app", "licenses")
SKIP = {"pip", "setuptools", "wheel"}
LICENSE_FILE = re.compile(r"(^|/)(licen[cs]e|copying|notice|authors)[^/]*$", re.I)


def main():
    shutil.rmtree(OUT, ignore_errors=True)
    os.makedirs(OUT)
    shutil.copy(os.path.join(ROOT, "LICENSE"), os.path.join(OUT, "Panasonic-Toolbox-LICENSE.txt"))
    shutil.copy(os.path.join(ROOT, "THIRD_PARTY_NOTICES.md"), os.path.join(OUT, "THIRD_PARTY_NOTICES.md"))
    # Python itself
    for base in {sys.base_prefix, sysconfig.get_paths()["stdlib"]}:
        for name in ("LICENSE.txt", "LICENSE"):
            p = os.path.join(base, name)
            if os.path.isfile(p):
                shutil.copy(p, os.path.join(OUT, "Python-LICENSE.txt"))
                break
    found = []
    for dist in md.distributions():
        name = (dist.metadata["Name"] or "").strip()
        if not name or name.lower() in SKIP:
            continue
        texts = []
        for f in dist.files or []:
            if LICENSE_FILE.search(str(f)):
                try:
                    with open(dist.locate_file(f), encoding="utf-8", errors="replace") as fh:
                        texts.append(f"----- {f} -----\n" + fh.read())
                except OSError:
                    pass
        lic = dist.metadata.get("License-Expression") or dist.metadata.get("License") or ""
        header = f"{name} {dist.version}\nLicense: {lic.splitlines()[0] if lic else 'see below'}\n\n"
        with open(os.path.join(OUT, f"{re.sub(r'[^A-Za-z0-9._-]', '_', name)}-LICENSE.txt"), "w", encoding="utf-8") as fh:
            fh.write(header + ("\n\n".join(texts) if texts else "(no license file in the package; see the license above)") + "\n")
        found.append(f"{name} {dist.version}")
    print(f"Collected licenses for Python and {len(found)} packages into {OUT}")


if __name__ == "__main__":
    main()
