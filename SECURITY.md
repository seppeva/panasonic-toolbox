# Security

## Reporting a problem
Found a security problem? Report it privately through **Security › Report a vulnerability** on GitHub, not in a public issue. You will get a reply within a few days.

## How the app is protected
- The built-in server only listens on `127.0.0.1`, so other computers cannot reach it.
- Every API call needs a random session key that only the app's own window knows. Requests with an unexpected `Host` or `Origin` header are refused (protection against DNS rebinding and cross-site requests).
- A strict Content Security Policy: no external scripts and no code from the internet.
- Commands are only sent to private IP addresses (192.168.x.x, 10.x.x.x, 172.16–31.x.x, 169.254.x.x). Camera web pages can only be opened on those addresses too.
- The camera password is kept in memory only, unless you choose *Remember on this computer*; it is then stored locally in the app's storage and only sent to your own cameras.
- Releases are built by GitHub Actions from this public source code. Each release includes `SHA256SUMS.txt`, which the install scripts check.
- Dependabot keeps the build dependencies up to date.

## Supported versions
Only the latest release receives security updates.
