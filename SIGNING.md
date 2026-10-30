# Code signing (optional, removes the first-launch warnings)

Everything works without signing, but macOS and Windows show a warning the first time. The install commands on the download page (Terminal/PowerShell) already avoid that warning.

## macOS: Apple Developer ID and notarization
Requires an Apple Developer Program membership (USD 99 per year; € 99 in the euro area). The workflow then does everything automatically.

1. Enroll at developer.apple.com/programs as an *Individual*.
2. Create a **Developer ID Application** certificate in Xcode or on developer.apple.com and export it (including the private key) as a `.p12` file with a password.
3. Create an **app-specific password** at appleid.apple.com.
4. In GitHub, under **Settings › Secrets and variables › Actions**, add these secrets:
   | Secret | Value |
   |---|---|
   | `APPLE_CERT_P12_BASE64` | `base64 -i certificate.p12 \| pbcopy` |
   | `APPLE_CERT_PASSWORD` | the .p12 password |
   | `APPLE_ID` | your Apple ID (email) |
   | `APPLE_APP_PASSWORD` | the app-specific password |
   | `APPLE_TEAM_ID` | your Team ID (10 characters, see developer.apple.com › Membership) |
5. Push a new version. The app and the .dmg are signed (hardened runtime), notarized and stapled.

## Windows
- **SignPath Foundation** (free for open source projects with an OSI license such as MIT): apply at signpath.org/apply. Once approved, add a step that signs the installer through the SignPath GitHub Action. SignPath asks for the credit "Free code signing provided by SignPath.io, certificate by SignPath Foundation" and a code signing policy.
- **Azure Artifact Signing** (formerly Trusted Signing) is currently only available to individual developers in the USA and Canada. Organizations in the EU are eligible if they have a verifiable history of at least three years.
- **Buying a certificate** (OV or EV) is also possible, but since March 2026 they are valid for at most 460 days and the key must be kept in hardware (token or cloud HSM).
