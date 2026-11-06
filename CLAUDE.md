# Panasonic Toolbox

Desktop app (Mac + Windows) for Panasonic PTZ cameras and remotes. See README.md for what it does and how the code is laid out.

- App: `app/panasonic_scene.py` (local server + window), interface in `app/web/` (`index.html`, `app.js`, `style.css`), Easy IP in `app/easyip.py`.
- Version: `VERSION` in `app/panasonic_scene.py`. Every push to `main` that touches `app/`, `installer/` or the workflow builds and **publishes a release**. Work on a branch and ask the user before merging into `main`.
- Mock cameras for development: `tools/mock_camera.py`, `tools/mock_easyip.py` (see README).

## Testing on real cameras

When the user asks to test the app on real cameras, follow **TESTING.md**: ask for the camera IPs, login and a free IP first, then run `tools/real_camera_test.py` and `tools/ui_real_test.js`, and report per camera with the raw answers and a proposed fix. The user's test cameras may be changed in every way (they are not on air); the scripts put everything back. RP150 assignment is not tested until there is a real `Network.s15` file.
