/* Belastingtabellen bijwerken.

   Alles gebeurt in de browser. De publieke sleutel staat hieronder; daarmee controleert
   de app of een opgehaald tabellenbestand onderweg niet is veranderd. Er gaat nooit iets
   naar buiten dat met je bankgegevens te maken heeft — bij het bijwerken vraagt de app
   alleen een bestand op, en alleen wanneer jij op de knop drukt.

   De app is in haar geheel gratis en open: er is geen licentiecode meer, alle onderdelen
   zitten in dezelfde uitgave.
*/
(function (g) {
  'use strict';

  var PUBKEY_B64 = '__PUBKEY__';
  var TABELLEN_URL = '__TABELLEN_URL__';

  function unb64u(s) {
    s = String(s).replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    var bin = atob(s), arr = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return arr;
  }

  function b64ToBytes(s) {
    var bin = atob(s), arr = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return arr;
  }

  var pubPromise = null;
  function publiekeSleutel() {
    if (!pubPromise) {
      pubPromise = crypto.subtle.importKey(
        'spki', b64ToBytes(PUBKEY_B64).buffer,
        { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    }
    return pubPromise;
  }

  // token = base64url(payload) '.' base64url(r||s)
  function verifieer(token) {
    return publiekeSleutel().then(function (key) {
      var d = String(token).trim().split('.');
      if (d.length !== 2) return null;
      var ruw = unb64u(d[0]), sig = unb64u(d[1]);
      return crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, sig, ruw)
        .then(function (ok) {
          if (!ok) return null;
          try {
            return JSON.parse(new TextDecoder().decode(ruw));
          } catch (e) { return null; }
        });
    }).catch(function () { return null; });
  }

  // Deze uitgave. Wordt door het bouwscript gezet.
  var BUILD = '__BUILD_DATUM__';

  var L = {
    build: BUILD,
    pro: false,          // zitten alle onderdelen in dit bestand?
    geldig: true,        // alles is gratis; er valt niets af te schermen
    payload: null,
    reden: 'ok',

    /* Er is geen licentie meer. Blijft bestaan zodat bestaande aanroepen blijven werken. */
    init: function () {
      L.pro = !!g.HB_PRO;
      L.reden = L.pro ? 'ok' : 'geen-pro';
      return Promise.resolve(L);
    },

    /* Haalt een ondertekend tabellenbestand op. Alleen op verzoek van de gebruiker. */
    standaardUrl: TABELLEN_URL,

    haalTabellen: function (url) {
      // Een leeg veld betekent uitdrukkelijk "niet bijwerken"; alleen wanneer er
      // helemaal geen adres wordt meegegeven valt hij terug op het ingebouwde.
      url = (url === undefined || url === null ? (TABELLEN_URL || '') : String(url)).trim();
      if (!url || url.indexOf('__') === 0) {
        return Promise.reject(new Error('geen-url'));
      }
      return fetch(url, { cache: 'no-store' })
        .then(function (r) {
          if (!r.ok) throw new Error('http-' + r.status);
          return r.text();
        }, function () {
          // netwerk of cors: onderscheid maken van een verkeerde handtekening,
          // want de oplossing is een andere (zelf downloaden en inlezen)
          throw new Error('netwerk');
        })
        .then(L.leesTabellen);
    },

    /* Zelfde controle, maar dan voor een bestand dat de gebruiker zelf aanlevert. */
    leesTabellen: function (token) {
      return verifieer(token).then(function (p) {
        if (!p || p.soort !== 'fiscaal' || !p.data) throw new Error('handtekening');
        // Een tabellenbestand mag een jaartal dragen ("jaar": 2027); dat is nu alleen
        // informatie. De handtekening wordt wél gecontroleerd: die zegt dat het bestand
        // onderweg niet is veranderd.
        herstelInfinity(p.data);
        // In hetzelfde bestand kan aangekondigd staan dat er een nieuwere uitgave is.
        // Het is ondertekend, dus het kan niet door een ander verzonnen zijn.
        L.nieuwer = null;
        if (p.versie && p.versie.uitgave && p.versie.uitgave > BUILD) {
          L.nieuwer = p.versie;
        }
        return p.data;
      });
    },

    // Deze uitgave is van BUILD; is er iets nieuwers aangekondigd, dan staat het hier.
    nieuwer: null,

    verloopt: function () {
      return L.payload && L.payload.tot ? L.payload.tot : '';
    }
  };

  // JSON kent geen Infinity; het ondertekenscript zet er de tekst 'Infinity' neer.
  function herstelInfinity(o) {
    Object.keys(o).forEach(function (k) {
      if (o[k] === 'Infinity') o[k] = Infinity;
      else if (o[k] && typeof o[k] === 'object') herstelInfinity(o[k]);
    });
  }

  g.HBLicentie = L;
})(window);
