# Onderhoud

Wat er bij het uitgeven van een nieuwe versie komt kijken. Voor dagelijks gebruik van de
app hoef je hier niets van te weten — zie [README.md](README.md).

## De sleutel

Er is één sleutelpaar. De publieke helft staat in `tools/public.b64` en wordt bij het
bouwen in het html-bestand gezet; daarmee controleert de app of een opgehaald
tabellenbestand onderweg niet is veranderd. De private helft hoort **nergens in een
repository**: bewaar hem in een wachtwoordkluis, en zet hem als secret `PRIVE_SLEUTEL`
in de repository-instellingen als je de release-workflow wilt laten ondertekenen.

Raak je hem kwijt, dan kun je geen nieuwe tabellenbestanden meer ondertekenen die door
bestaande uitgaven worden geaccepteerd. Maak er een back-up van.

`tools/sign.py` zoekt de sleutels in `tools/keys/` (`private.pem` en `public.b64`); die
map staat in `.gitignore` en hoort leeg te blijven in de repository.

Sinds september 2026 zijn er geen licentiecodes meer — alles zit in dezelfde gratis
uitgave. Het `licentie`-commando in `sign.py` is daarmee een overblijfsel; alleen
`tabellen` wordt nog gebruikt.

## Tabellen ondertekenen

```bash
python3 tools/sign.py tabellen src/fiscaal.js > fiscaal-nl.txt
```

Zet `fiscaal-nl.txt` op de website onder `/tabellen/`. Vanaf dat moment vindt de knop
**Tabellen bijwerken** op het tabblad Belasting de nieuwe versie. Het bestand mag gerust
openbaar staan: belastingtarieven zijn openbare informatie, en de handtekening zorgt
ervoor dat er onderweg niet mee geknoeid kan worden.

## Een nieuwe versie aankondigen

De app werkt zichzelf niet bij, maar kan wel melden dát er iets nieuws is. Zet in
`tools/versie.json` de datum, de naam, het adres en per taal één zin over wat er nieuw is:

```json
{ "uitgave": "2027-01-08", "naam": "2027.1",
  "url": "https://myofflinebudget.app/#downloaden",
  "wat": { "nl": "Belastingtarieven 2027.", "en": "2027 tax rates." } }
```

Die datum is ook de build-datum die in het html-bestand terechtkomt, dus bump hem bij elke
uitgave. Het blok reist mee in het ondertekende tabellenbestand: wie op **Tabellen
bijwerken** drukt en een oudere uitgave heeft, ziet de aankondiging met een knop naar de
downloadpagina, en de uitleg dat je eerst een back-up maakt en die in het nieuwe bestand
inleest. Is de aangekondigde datum niet nieuwer dan de build, dan verschijnt er niets.
Omdat het meelift op het ondertekende bestand kan niemand anders zo'n melding verzinnen.

## De jaarlijkse ronde

1. **September** — Prinsjesdag; het Belastingplan voor het volgende jaar komt uit.
2. **December** — de tarieven staan vast zodra beide Kamers akkoord zijn.
3. **Begin januari** — werk `src/fiscaal.js` bij: een nieuw blok onder `jaren`, de
   peildatum en de bron. Verder verandert er niets in de code.
4. Bump `tools/versie.json` en tag de release (`git tag v2027.1 && git push --tags`).
   De workflow bouwt `index.html`, ondertekent de tabellen als de sleutel als secret
   klaarstaat, en hangt allebei aan de release.
5. Zet `fiscaal-nl.txt` op de website onder `/tabellen/`.

## Meerdere landen

`src/fiscaal.js` bevat een blok `landen` met per land de tabellen, een lijstje `velden`
dat bepaalt welke invoervelden zichtbaar zijn, en een eigen `bron`. De rekenkern kiest op
basis van de landcode: `berekenNL` of `berekenDE` in `src/pro.js`. Een land toevoegen is
een tabel plus een rekenfunctie; de rest van het tabblad past zich aan.

Nederland rekent met schijven en heffingskortingen. Duitsland gebruikt de formule van
§32a EStG met vijf zones, plus Ehegattensplitting, Solidaritätszuschlag, Kirchensteuer en
de Abgeltungsteuer op vermogensinkomsten.

**Controleer de Duitse coëfficiënten voordat je uitlevert.** De waarden in `zones` zijn
afgeleid uit de gepubliceerde zonegrenzen en marginale tarieven; ze sluiten aan op de twee
officiële constanten tot op ruim een euro na. Voor een schatting is dat ruim genoeg, maar
vervang ze door de letterlijke getallen uit de wettekst.

## Wat de app wel en niet over de lijn stuurt

De updateknop doet één ding: een GET naar het adres uit het veld op het tabblad Over
(standaard `TABELLEN_URL` in `build.py`), en alleen wanneer de gebruiker erop drukt. Er
gaat geen boeking mee, geen bedrag en geen identificatie. Werkt de app zonder internet,
dan kan de gebruiker hetzelfde bestand handmatig downloaden en inlezen — het resultaat is
identiek, inclusief de controle op de handtekening.

Let op de oorsprong: wordt de app als los bestand geopend, dan is dat `file://` en mag de
pagina in sommige browsers niet naar buiten. Safari blokkeert dit; Chrome en Firefox staan
het meestal toe. Reken er niet op. De app vangt het af: bij een netwerkfout verschijnt de
melding met twee knoppen om het adres te openen en het bestand handmatig in te lezen.
Draait de app achter een webserver, dan is er niets aan de hand.

Test dit per uitgave in de browser waarin je gebruikers zitten, niet alleen in de jouwe.

## Testen

```bash
node tests/parsers.test.js     # de importlezers, zonder dependencies
python3 build.py               # bouwt index.html opnieuw
```

De GitHub Actions-workflow draait dezelfde twee stappen en controleert daarna dat er
niets persoonlijks in de build is beland.
