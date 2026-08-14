# -*- coding: utf-8 -*-
"""Bouwt de app in twee uitvoeringen, uit dezelfde bron.

  kern  — importeren, categoriseren, budget, transacties, kas, dashboard.
          Dit is wat in de publieke repository staat.
  pro   — plus prognose, potjes, analyse, doorlichting en belasting.
          De bestanden pro.js en licentie.js horen in de private repository.

De schakelaar is het blok <!--PRO--> … <!--/PRO--> in het sjabloon: dat wordt in de
kern-uitvoering weggeknipt, zodat de betaalde onderdelen daar niet in terechtkomen —
ook niet verborgen.

Gebruik:
    python3 build_app.py                 # alles wat er is
    python3 build_app.py --alleen-kern   # zonder de pro-bestanden
"""
import base64, datetime, json, os, re, shutil, sys

HIER = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HIER, 'src')
OUT = '/mnt/user-data/outputs'
REPO = os.path.join(HIER, 'repo')          # publiek: alleen de kern
PRIVE = os.path.join(HIER, 'repo-pro')     # privé: de pro-uitvoering

ALLEEN_KERN = '--alleen-kern' in sys.argv

# Adres waar de updateknop het ondertekende tabellenbestand ophaalt.
# Openbaar te hosten: belastingtarieven zijn openbare informatie, en de handtekening
# zorgt ervoor dat er onderweg niet mee geknoeid kan worden.
TABELLEN_URL = 'https://yourpersonalbudget.app/tabellen/fiscaal-nl.txt'

BUILD_DATUM = datetime.date.today().isoformat()


def lees(naam, map_=SRC):
    return open(os.path.join(map_, naam), encoding='utf-8').read()


css = lees('styles.css')
parsers = lees('parsers.js')
i18n = lees('i18n.js')
fiscaal = lees('fiscaal.js')
app = lees('app.js')
tpl = lees('index.tpl.html')
pro_js = lees('pro.js')
licentie_js = lees('licentie.js')
rules = lees('rules.json', HIER)
rules_generiek = lees('rules-generic.json', HIER)

PUBKEY = open(os.path.join(HIER, 'tools', 'keys', 'public.b64')).read().strip()
licentie_js = (licentie_js.replace('__PUBKEY__', PUBKEY)
                          .replace('__TABELLEN_URL__', TABELLEN_URL)
                          .replace('__BUILD_DATUM__', BUILD_DATUM))

VEND = '/tmp/hb/vendor'
pdfjs = lees('pdf.min.js', VEND)
pdfworker = base64.b64encode(open(os.path.join(VEND, 'pdf.worker.min.js'), 'rb').read()).decode()
xlsxjs = lees('xlsx.full.min.js', VEND)

# Persoonlijke leningen horen niet in de repository: ze staan in leningen.json
# (genegeerd door git), naast data.json en budget.json.
LENINGEN = []
_leningen_pad = os.path.join(HIER, 'leningen.json')
if os.path.exists(_leningen_pad):
    LENINGEN = json.loads(open(_leningen_pad, encoding='utf-8').read())

PRO_BLOK = re.compile(r'<!--PRO-->.*?<!--/PRO-->', re.S)


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


def bouw(data_js, doel, pro=True, pwa=False):
    sjabloon = tpl if pro else PRO_BLOK.sub('', tpl)
    html = (sjabloon.replace('/*__PDFJS__*/', pdfjs)
                    .replace('/*__PDFWORKER__*/', pdfworker)
                    .replace('/*__XLSX__*/', xlsxjs)
                    .replace('/*__CSS__*/', css)
                    .replace('/*__FISCAAL__*/', fiscaal if pro else '')
                    .replace('/*__I18N__*/', i18n)
                    .replace('/*__PARSERS__*/', parsers)
                    .replace('/*__APP__*/', app)
                    .replace('/*__LICENTIE__*/', licentie_js)
                    .replace('/*__PRO__*/', pro_js if pro else '')
                    .replace('/*__DATA__*/', data_js)
                    .replace('<!--__PWA__-->', PWA if pwa else ''))
    if not pro:
        # niets van de betaalde module mag in de gratis uitgave zitten
        for verboden in ('function renderBelasting', 'function berekenPersoon',
                         'function auditRecurring', 'g.HB_PRO ='):
            assert verboden not in html, 'pro-code lekt in de kern: ' + verboden
    os.makedirs(os.path.dirname(doel), exist_ok=True)
    open(doel, 'w', encoding='utf-8').write(html)
    return round(os.path.getsize(doel) / 1024)


# --- 1. de persoonlijke uitvoering, met eigen data en met pro
data = lees('data.json', HIER)
budget = lees('budget.json', HIER)
cats_pad = os.path.join(HIER, 'cats_persoonlijk.json')
cats_persoonlijk = open(cats_pad, encoding='utf-8').read() if os.path.exists(cats_pad) else '{}'
met = ('window.HB_CATS_EXTRA=1;\n'
       'window.HB_CATS_PERSOONLIJK=' + cats_persoonlijk + ';\n'
       'window.HB_DATA=' + data + ';\n'
       'window.HB_BUDGET=' + budget + ';\n'
       'window.HB_RULES=' + rules + ';\n'
       'window.HB_CATTYPE=' + lees('cattype.json', HIER) + ';\n'
       'window.HB_LENINGEN=' + json.dumps(LENINGEN, ensure_ascii=False) + ';\n'
       'window.HB_LICENTIE=' + json.dumps(lees('lic_mike.txt', HIER).strip()) + ';')
kb1 = bouw(met, os.path.join(OUT, 'Huishoudboekje-app.html'), pro=True)

# --- 2. de gratis uitvoering voor de publieke repository
leeg = ('window.HB_DATA={accounts:[],owners:[],banks:[],groups:[],categories:[],tx:[],sunclass:[]};\n'
        'window.HB_RULES=' + rules_generiek + ';\n'
        'window.HB_DEMO=' + lees('demo.json', HIER) + ';\n'
        'window.HB_LENINGEN=[];')
kb2 = bouw(leeg, os.path.join(REPO, 'index.html'), pro=False)

# --- 3. de betaalde uitvoering, leeg, voor de private repository
kb3 = 0
if not ALLEEN_KERN:
    kb3 = bouw(leeg, os.path.join(PRIVE, 'index.html'), pro=True)

# --- 4. dezelfde gratis uitgave, maar dan om te hosten op de website
SITE = '/tmp/hb/site'
kb4 = bouw(leeg, os.path.join(SITE, 'app', 'index.html'), pro=False, pwa=True)

# --- bronbestanden meeleveren
os.makedirs(os.path.join(REPO, 'src'), exist_ok=True)
KERN_BRON = ('styles.css', 'parsers.js', 'app.js', 'i18n.js', 'index.tpl.html')
for f in KERN_BRON:
    shutil.copy(os.path.join(SRC, f), os.path.join(REPO, 'src', f))
# het sjabloon in de publieke repo zonder de pro-blokken
open(os.path.join(REPO, 'src', 'index.tpl.html'), 'w', encoding='utf-8').write(PRO_BLOK.sub('', tpl))
shutil.copy(os.path.join(HIER, 'rules-generic.json'), os.path.join(REPO, 'src', 'rules.json'))
shutil.copy(os.path.join(HIER, 'demo.json'), os.path.join(REPO, 'src', 'demo.json'))
shutil.copy(__file__, os.path.join(REPO, 'build.py'))

if not ALLEEN_KERN:
    os.makedirs(os.path.join(PRIVE, 'src'), exist_ok=True)
    for f in ('pro.js', 'licentie.js', 'fiscaal.js'):
        shutil.copy(os.path.join(SRC, f), os.path.join(PRIVE, 'src', f))

print('pro met data:', kb1, 'KB   ·   kern (publiek):', kb2, 'KB   ·   pro leeg:', kb3,
      'KB   ·   gehost:', kb4, 'KB')
print('build-datum:', BUILD_DATUM)
