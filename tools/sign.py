# -*- coding: utf-8 -*-
"""Ondertekent licenties en tabellenbestanden met de private sleutel.

De private sleutel hoort NIET in een repository. Bewaar hem in een wachtwoordkluis
en zet hem bij het uitgeven van een release als secret in de omgeving.

Gebruik:
    python3 sign.py licentie  jan@example.com  2027-03-01   > licentie.txt
    python3 sign.py tabellen  ../src/fiscaal.js             > fiscaal-2027.json
    python3 sign.py controleer licentie.txt
"""
import base64, json, sys, os, re, datetime

from cryptography.hazmat.primitives.asymmetric import ec, utils as asym_utils
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.exceptions import InvalidSignature

HIER = os.path.dirname(os.path.abspath(__file__))
PRIV = os.path.join(HIER, 'keys', 'private.pem')
PUB = os.path.join(HIER, 'keys', 'public.b64')


def sleutel():
    return serialization.load_pem_private_key(open(PRIV, 'rb').read(), password=None)


def b64u(b):
    return base64.urlsafe_b64encode(b).decode().rstrip('=')


def unb64u(s):
    return base64.urlsafe_b64decode(s + '=' * (-len(s) % 4))


def onderteken(payload):
    """payload: dict -> compacte string 'payload.handtekening' (beide base64url).

    WebCrypto verwacht een rauwe r||s-handtekening van 64 bytes, niet DER.
    """
    ruw = json.dumps(payload, separators=(',', ':'), sort_keys=True).encode()
    der = sleutel().sign(ruw, ec.ECDSA(hashes.SHA256()))
    r, s = asym_utils.decode_dss_signature(der)
    rs = r.to_bytes(32, 'big') + s.to_bytes(32, 'big')
    return b64u(ruw) + '.' + b64u(rs)


def controleer(token):
    spki = base64.b64decode(open(PUB).read().strip())
    pub = serialization.load_der_public_key(spki)
    p, h = token.strip().split('.')
    ruw, rs = unb64u(p), unb64u(h)
    der = asym_utils.encode_dss_signature(int.from_bytes(rs[:32], 'big'),
                                          int.from_bytes(rs[32:], 'big'))
    try:
        pub.verify(der, ruw, ec.ECDSA(hashes.SHA256()))
    except InvalidSignature:
        return None
    return json.loads(ruw)


def leesTabellen(pad):
    """Haalt het HB_FISCAAL-object uit fiscaal.js zodat er één bron van waarheid is.

    Via node, want het is javascript: enkele quotes, commentaar, Infinity.
    """
    import subprocess, tempfile
    script = (
        "global.window={};require(%s);"
        "var f=window.HB_FISCAAL;"
        "process.stdout.write(JSON.stringify(f,function(k,v){"
        "return v===Infinity?'Infinity':v;}));" % json.dumps(os.path.abspath(pad))
    )
    uit = subprocess.run(['node', '-e', script], capture_output=True, check=True)
    return json.loads(uit.stdout.decode())


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return 1
    cmd = sys.argv[1]

    if cmd == 'licentie':
        email, tot = sys.argv[2], sys.argv[3]
        datetime.date.fromisoformat(tot)              # valideert het formaat
        token = onderteken({'v': 1, 'email': email, 'editie': 'pro', 'tot': tot})
        sys.stderr.write('licentie voor %s, updates tot %s\n' % (email, tot))
        print(token)

    elif cmd == 'tabellen':
        tab = leesTabellen(sys.argv[2])
        payload = {'v': 1, 'soort': 'fiscaal', 'data': tab}
        # Optioneel een versieblok meegeven. Dat reist mee met hetzelfde bestand, dus
        # wie op "tabellen bijwerken" drukt hoort meteen of er een nieuwere uitgave is.
        versiepad = sys.argv[3] if len(sys.argv) > 3 else os.path.join(HIER, 'versie.json')
        if os.path.exists(versiepad):
            payload['versie'] = json.load(open(versiepad, encoding='utf-8'))
            sys.stderr.write('versieblok meegenomen: %s\n' % payload['versie'].get('uitgave'))
        token = onderteken(payload)
        sys.stderr.write('tabellen ondertekend, peildatum %s\n' % tab.get('peildatum'))
        print(token)

    elif cmd == 'controleer':
        p = controleer(open(sys.argv[2]).read())
        print(json.dumps(p, ensure_ascii=False, indent=2)[:400] if p else 'ONGELDIG')

    else:
        print(__doc__)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
