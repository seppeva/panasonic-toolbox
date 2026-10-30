# Ondertekening (optioneel, voor geen beveiligingsmeldingen)

Zonder ondertekening werkt alles, maar macOS en Windows tonen de eerste keer een waarschuwing. De installatieregels op de downloadpagina (Terminal/PowerShell) vermijden die melding nu al.

## macOS: Apple Developer ID + notarisatie
Kost een Apple Developer Program-lidmaatschap (99 USD/jaar; in de eurozone € 99). Daarna doet de workflow alles automatisch.

1. Word lid op developer.apple.com/programs als *Individual*.
2. Maak in Xcode of op developer.apple.com een **Developer ID Application**-certificaat aan en exporteer het (met private key) als `.p12` met een wachtwoord.
3. Maak op appleid.apple.com een **app-specifiek wachtwoord** aan.
4. Voeg in GitHub, onder **Settings › Secrets and variables › Actions**, deze secrets toe:
   | Secret | Waarde |
   |---|---|
   | `APPLE_CERT_P12_BASE64` | `base64 -i certificaat.p12 \| pbcopy` |
   | `APPLE_CERT_PASSWORD` | wachtwoord van de .p12 |
   | `APPLE_ID` | je Apple ID (e-mail) |
   | `APPLE_APP_PASSWORD` | het app-specifieke wachtwoord |
   | `APPLE_TEAM_ID` | je Team ID (10 tekens, zie developer.apple.com › Membership) |
5. Maak een nieuwe tag. De app en de .dmg worden ondertekend (hardened runtime), genotariseerd en "gestapled".

## Windows
- **SignPath Foundation** (gratis voor open-sourceprojecten met een OSI-licentie zoals MIT): aanvragen via signpath.org/apply. Na goedkeuring voeg je een stap toe die het installatieprogramma via de SignPath GitHub Action laat ondertekenen. SignPath vraagt om een vermelding "Free code signing provided by SignPath.io, certificate by SignPath Foundation" en een ondertekeningsbeleid.
- **Azure Artifact Signing** (voorheen Trusted Signing) is voor individuele ontwikkelaars momenteel enkel beschikbaar in de VS en Canada. Organisaties in de EU kunnen wel, mits ze minstens drie jaar actief zijn.
- **Zelf een certificaat kopen** (OV of EV) kan ook, maar sinds maart 2026 zijn die hooguit 460 dagen geldig en zit de sleutel verplicht op hardware (token of cloud-HSM).
