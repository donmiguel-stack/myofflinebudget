# -*- coding: utf-8 -*-
"""Bouwt My Offline Budget tot één los html-bestand.

Er is nog maar één uitgave: alles zit erin — import, budget, transacties, kas,
leningen, investeringen, prognose, potjes, analyse en de belastingschatter.
Vroeger was dit gesplitst in een gratis kern en een betaalde pro-uitgave; die
splitsing is vervallen, de hele app is gratis en open.

Gebruik:
    python3 build.py                     # schrijft index.html naast dit bestand
    python3 build.py --uit MAP           # schrijft index.html in MAP
    python3 build.py --pwa               # met manifest-/service-worker-haakjes
                                         # (voor de gehoste kopie op de website)

Wat je nodig hebt: de map vendor/ met pdf.min.js, pdf.worker.min.js en
xlsx.full.min.js. Ontbreekt die, dan haalt dit script ze op van cdnjs — één keer.
Ze worden volledig in het html-bestand gezet, zodat de app daarna nooit meer
internet nodig heeft.
"""
import argparse, base64, json, os, sys
from urllib.request import urlopen

HIER = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HIER, 'src')
VEND = os.path.join(HIER, 'vendor')
TOOLS = os.path.join(HIER, 'tools')

# Adres waar de updateknop het ondertekende tabellenbestand ophaalt. Openbaar te
# hosten: belastingtarieven zijn openbare informatie, en de handtekening zorgt
# ervoor dat er onderweg niet mee geknoeid kan worden.
TABELLEN_URL = 'https://myofflinebudget.app/tabellen/fiscaal-nl.txt'

BIBLIOTHEKEN = {
    'pdf.min.js': 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
    'pdf.worker.min.js': 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js',
    'xlsx.full.min.js': 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
}

PWA = '''<link rel="manifest" href="manifest.json">
<meta name="theme-color" content="#2a78d6">
<link rel="apple-touch-icon" href="icoon-192.png">
<script>
// Alleen op een echte webserver: op file:// bestaan service workers niet.
if ('serviceWorker' in navigator && location.protocol.indexOf('http') === 0) {
  addEventListener('load', function () {
    navigator.serviceWorker.register('sw.js').catch(function () {});
  });
}
</script>'''


def lees(naam, map_=SRC):
    with open(os.path.join(map_, naam), encoding='utf-8') as f:
        return f.read()


def bibliotheken():
    os.makedirs(VEND, exist_ok=True)
    for naam, url in BIBLIOTHEKEN.items():
        pad = os.path.join(VEND, naam)
        if os.path.exists(pad):
            continue
        print('ophalen:', naam)
        with urlopen(url) as r, open(pad, 'wb') as uit:
            uit.write(r.read())


def bouw(pwa=False):
    bibliotheken()
    versie = json.loads(lees('versie.json', TOOLS))
    build_datum = versie['uitgave']

    licentie = (lees('licentie.js')
                .replace('__PUBKEY__', lees('public.b64', TOOLS).strip())
                .replace('__TABELLEN_URL__', TABELLEN_URL)
                .replace('__BUILD_DATUM__', build_datum))

    # Een verse installatie start leeg; de voorbeelddata zit erbij en laadt pas
    # wanneer de gebruiker er zelf om vraagt (?demo=1 of de knop op het dashboard).
    data = ('window.HB_DATA={accounts:[],owners:[],banks:[],groups:[],categories:[],tx:[],sunclass:[]};\n'
            'window.HB_RULES=' + lees('rules.json') + ';\n'
            'window.HB_DEMO=' + lees('demo.json') + ';\n'
            'window.HB_LENINGEN=[];')

    with open(os.path.join(VEND, 'pdf.worker.min.js'), 'rb') as f:
        worker = base64.b64encode(f.read()).decode()

    html = (lees('index.tpl.html')
            .replace('/*__PDFJS__*/', lees('pdf.min.js', VEND))
            .replace('/*__PDFWORKER__*/', worker)
            .replace('/*__XLSX__*/', lees('xlsx.full.min.js', VEND))
            .replace('/*__CSS__*/', lees('styles.css'))
            .replace('/*__FISCAAL__*/', lees('fiscaal.js'))
            .replace('/*__I18N__*/', lees('i18n.js'))
            .replace('/*__PARSERS__*/', lees('parsers.js'))
            .replace('/*__APP__*/', lees('app.js'))
            .replace('/*__LICENTIE__*/', licentie)
            .replace('/*__PRO__*/', lees('pro.js'))
            .replace('/*__DATA__*/', data)
            .replace('<!--__PWA__-->', PWA if pwa else ''))

    # Een build met een onvervangen haakje erin is stuk; liever nu stuklopen.
    for haakje in ('/*__PDFJS__*/', '/*__CSS__*/', '/*__APP__*/', '/*__PRO__*/',
                   '/*__LICENTIE__*/', '/*__DATA__*/', '__PUBKEY__', '__BUILD_DATUM__'):
        if haakje in html:
            sys.exit('bouwen mislukt: %s is niet ingevuld' % haakje)
    # Niets persoonlijks in een uitgave die de deur uit gaat.
    for verboden in ('window.HB_LICENTIE=', 'window.HB_CATS_EXTRA=', 'BEGIN EC PRIVATE KEY'):
        if verboden in html:
            sys.exit('bouwen mislukt: %s hoort hier niet in' % verboden)
    return html, versie


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--uit', default=HIER, help='map waarin index.html komt')
    p.add_argument('--pwa', action='store_true', help='manifest en service worker meenemen')
    a = p.parse_args()

    html, versie = bouw(pwa=a.pwa)
    os.makedirs(a.uit, exist_ok=True)
    doel = os.path.join(a.uit, 'index.html')
    with open(doel, 'w', encoding='utf-8') as f:
        f.write(html)
    print('%s — %d KB — uitgave %s (%s)'
          % (doel, round(os.path.getsize(doel) / 1024), versie['naam'], versie['uitgave']))


if __name__ == '__main__':
    main()
