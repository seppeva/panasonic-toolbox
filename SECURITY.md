# Beveiliging

## Een probleem melden
Vond je een beveiligingsprobleem? Meld het via **Security › Report a vulnerability** op GitHub (private melding), niet via een publieke issue. Je krijgt binnen enkele dagen een reactie.

## Hoe de app beveiligd is
- De ingebouwde server luistert enkel op `127.0.0.1` (niet bereikbaar vanaf andere computers).
- Elke API-aanroep vereist een willekeurige sessiesleutel die enkel de eigen interface kent; verzoeken met een vreemde `Host`- of `Origin`-header worden geweigerd (bescherming tegen DNS-rebinding en cross-site requests).
- Strikte Content-Security-Policy; geen externe scripts, geen code van internet.
- Commando's worden enkel naar privé-IP-adressen gestuurd (192.168.x.x, 10.x.x.x, 172.16–31.x.x, 169.254.x.x).
- Camera-wachtwoorden worden nooit opgeslagen, enkel in het geheugen bewaard zolang de app open is.
- Releases worden automatisch gebouwd door GitHub Actions vanuit deze publieke broncode; bij elke release hoort `SHA256SUMS.txt`, die de installatiescripts controleren.
- Dependabot houdt de bouwafhankelijkheden up-to-date.

## Ondersteunde versies
Enkel de laatste release krijgt beveiligingsupdates.
