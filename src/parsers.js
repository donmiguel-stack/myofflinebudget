/* Huishoudboekje — importparsers. Alles draait lokaal in je browser.
   Ondersteund: ING (CSV en PDF), ABN AMRO (TXT-mutatiebestand), Knab (PDF),
   Rabobank (PDF), ICS/Visa (PDF), American Express (xlsx), CAMT.052/053/054 (XML),
   plus generieke CSV/Excel (incl. aparte debet/credit-kolommen) en plakken. */
(function (global) {
  'use strict';

  // ---------------------------------------------------------------- helpers
  function nl(s) {                        // "1.234,56" -> 1234.56, "1,234.56" -> 1234.56
    if (typeof s === 'number') return s;
    if (!s) return NaN;
    s = String(s).trim().replace(/\s/g, '').replace(/€/g, '');
    var neg = /^-/.test(s) || /-$/.test(s);
    s = s.replace(/[+-]/g, '');
    // Het decimaalteken is het teken dat het laatst voorkomt: Nederlands
    // "1.234,56" heeft de komma achteraan, Engels "1,234.56" de punt.
    var lk = s.lastIndexOf(','), lp = s.lastIndexOf('.');
    if (lk > -1 && lp > -1) {
      if (lk > lp) s = s.replace(/\./g, '').replace(',', '.');
      else s = s.replace(/,/g, '');
    } else if (lk > -1) {
      // alleen komma's: één is een decimaalteken ("12,50"), meerdere zijn duizendtallen
      s = (s.match(/,/g) || []).length > 1 ? s.replace(/,/g, '') : s.replace(',', '.');
    } else if ((s.match(/\./g) || []).length > 1) {
      s = s.replace(/\./g, '');
    }
    var v = parseFloat(s);
    return isNaN(v) ? NaN : (neg ? -v : v);
  }

  function iso(d, m, y) {
    y = String(y); if (y.length === 2) y = (+y > 70 ? '19' : '20') + y;
    return y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
  }

  // order: 'dmy' (Europees, standaard) of 'mdy' (Amerikaans, o.a. American Express)
  function dateFromAny(s, order) {
    if (s instanceof Date && !isNaN(s)) {
      return iso(s.getUTCDate(), s.getUTCMonth() + 1, s.getUTCFullYear());
    }
    if (typeof s === 'number' && s > 20000 && s < 60000) {      // Excel-serienummer
      var d0 = new Date(Date.UTC(1899, 11, 30) + Math.round(s) * 86400000);
      return iso(d0.getUTCDate(), d0.getUTCMonth() + 1, d0.getUTCFullYear());
    }
    s = String(s || '').trim();
    var m;
    if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})/))) return m[1] + '-' + m[2] + '-' + m[3];
    if ((m = s.match(/^(\d{4})(\d{2})(\d{2})$/))) return m[1] + '-' + m[2] + '-' + m[3];
    if ((m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/))) {
      var a = +m[1], b = +m[2];
      if (a > 12) return iso(a, b, m[3]);            // eerste getal kan alleen een dag zijn
      if (b > 12) return iso(b, a, m[3]);            // tweede getal kan alleen een dag zijn
      return order === 'mdy' ? iso(b, a, m[3]) : iso(a, b, m[3]);
    }
    return null;
  }

  // Leidt af of een datumkolom dag-eerst of maand-eerst is
  function detectOrder(values) {
    var dagEerst = false, maandEerst = false;
    values.forEach(function (v) {
      var m = String(v || '').trim().match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
      if (!m) return;
      if (+m[1] > 12) dagEerst = true;
      if (+m[2] > 12) maandEerst = true;
    });
    if (maandEerst && !dagEerst) return 'mdy';
    return 'dmy';
  }

  var MON3 = { jan: 1, feb: 2, mrt: 3, maa: 3, apr: 4, mei: 5, jun: 6, jul: 7, aug: 8, sep: 9, okt: 10, nov: 11, dec: 12 };
  var MONFULL = { januari: 1, februari: 2, maart: 3, april: 4, mei: 5, juni: 6, juli: 7, augustus: 8, september: 9, oktober: 10, november: 11, december: 12 };

  function clean(s) { return String(s || '').replace(/\s+/g, ' ').trim(); }

  // ---------------------------------------------------------------- CSV
  function splitCSV(text) {
    var delim = ';';
    var head = text.split(/\r?\n/)[0] || '';
    if ((head.match(/\t/g) || []).length >= 2) delim = '\t';
    else if ((head.match(/;/g) || []).length < (head.match(/,/g) || []).length) delim = ',';
    var rows = [], row = [], cur = '', q = false;
    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if (q) {
        if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; }
        else if (c === '"') q = false;
        else cur += c;
      } else if (c === '"') q = true;
      else if (c === delim) { row.push(cur); cur = ''; }
      else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
      else if (c !== '\r') cur += c;
    }
    if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
    return rows.filter(function (r) { return r.some(function (c) { return clean(c) !== ''; }); });
  }

  // ---------------------------------------------------------------- ABN AMRO (TXT)
  // Het tab-gescheiden mutatiebestand ("TXT-bestand" in internetbankieren): geen
  // kopregel, per regel: rekening, valuta, transactiedatum (jjjjmmdd), saldo voor,
  // saldo na, rentedatum, bedrag, omschrijving. Streng gecontroleerd: als ook maar
  // één regel niet klopt, geven we null terug zodat de generieke parser het probeert.
  function parseAbnTxt(text) {
    var lines = text.split(/\r?\n/).filter(function (l) { return l.trim(); });
    if (!lines.length) return null;
    var out = [];
    for (var i = 0; i < lines.length; i++) {
      var f = lines[i].split('\t');
      if (f.length < 8) return null;
      if (!/^[A-Z]{3}$/.test(clean(f[1]))) return null;
      if (!/^\d{8}$/.test(clean(f[2]))) return null;
      var d = dateFromAny(clean(f[2]));
      var v = nl(f[6]);
      if (!d || isNaN(v)) return null;
      var acc = clean(f[0]);
      if (/^\d{9,10}$/.test(acc)) acc = 'ABN AMRO ' + acc;
      out.push({ date: d, amount: Math.round(v * 100) / 100,
                 desc: clean(f.slice(7).join(' ')).slice(0, 200),
                 account: acc, bank: 'ABN AMRO', owner: '' });
    }
    return out.length ? out : null;
  }

  // ---------------------------------------------------------------- CAMT (XML)
  // Het officiële SEPA-exportformaat (camt.052/053/054) dat vrijwel elke bank naast
  // CSV aanbiedt. Gestructureerd en stabiel: geen kolomraden zoals bij CSV/PDF.
  var IBAN_BANK = { INGB: 'ING', RABO: 'Rabobank', ABNA: 'ABN AMRO', KNAB: 'Knab',
                    TRIO: 'Triodos', BUNQ: 'bunq', SNSB: 'SNS', ASNB: 'ASN',
                    RBRB: 'RegioBank', FVLB: 'Van Lanschot' };
  function parseCamt(xmlText) {
    if (typeof DOMParser === 'undefined') return null;
    if (!/<(\w+:)?(BkToCstmrStmt|BkToCstmrAcctRpt|BkToCstmrDbtCdtNtfctn)[\s>]/.test(xmlText)) return null;
    var doc = new DOMParser().parseFromString(xmlText, 'text/xml');
    if (doc.getElementsByTagName('parsererror').length) return null;
    function els(node, name) { return node.getElementsByTagNameNS('*', name); }
    function first(node, name) { var e = els(node, name); return e.length ? e[0] : null; }
    function txt(node, name) { var e = first(node, name); return e ? e.textContent.trim() : ''; }
    var out = [];
    var stmts = els(doc, 'Stmt');
    if (!stmts.length) stmts = els(doc, 'Rpt');
    if (!stmts.length) stmts = els(doc, 'Ntfctn');
    Array.prototype.forEach.call(stmts, function (st) {
      var acct = first(st, 'Acct');
      var iban = acct ? txt(acct, 'IBAN') : '';
      var bank = IBAN_BANK[iban.slice(4, 8)] || 'Bank';
      Array.prototype.forEach.call(els(st, 'Ntry'), function (ntry) {
        var amtEl = first(ntry, 'Amt');
        if (!amtEl) return;
        var v = parseFloat(amtEl.textContent);
        if (isNaN(v)) return;
        if (txt(ntry, 'CdtDbtInd') === 'DBIT') v = -v;
        var bd = first(ntry, 'BookgDt') || first(ntry, 'ValDt');
        var d = bd ? dateFromAny(txt(bd, 'Dt') || txt(bd, 'DtTm')) : null;
        if (!d) return;
        var delen = [];
        Array.prototype.forEach.call(els(ntry, 'TxDtls'), function (tx) {
          var pties = first(tx, 'RltdPties');
          if (pties) {
            var wie = v < 0 ? first(pties, 'Cdtr') : first(pties, 'Dbtr');
            if (wie) { var nm = txt(wie, 'Nm'); if (nm && delen.indexOf(nm) < 0) delen.push(nm); }
          }
          Array.prototype.forEach.call(els(tx, 'Ustrd'), function (u) {
            var t = u.textContent.trim();
            if (t && delen.indexOf(t) < 0) delen.push(t);
          });
        });
        if (!delen.length) { var ai = txt(ntry, 'AddtlNtryInf'); if (ai) delen.push(ai); }
        out.push({ date: d, amount: Math.round(v * 100) / 100,
                   desc: clean(delen.join(' ')).slice(0, 200),
                   account: iban || bank, bank: bank, owner: '' });
      });
    });
    return out.length ? out : null;
  }

  // ---------------------------------------------------------------- generiek tabelmodel
  var HINTS = {
    date: /^(datum|date|boekdatum|transactiedatum|geboekt op|rentedatum|valutadatum)/i,
    desc: /^(naam|omschrijving|description|mededeling|naam \/ omschrijving|tegenpartij|begunstigde|kaartlid)/i,
    amount: /^(bedrag|amount|bedrag \(eur\)|mutatie|af bij|bedrag eur)/i,
    debcred: /^(af bij|af\/bij|debet\/credit|bij\/af|type)/i,
    account: /^(rekening|iban|rekeningnummer|account)/i
  };

  function mapColumns(header) {
    var map = { date: -1, desc: -1, amount: -1, debcred: -1, account: -1, extra: [] };
    header.forEach(function (h, i) {
      var t = clean(h);
      if (map.date < 0 && HINTS.date.test(t)) map.date = i;
      else if (map.amount < 0 && HINTS.amount.test(t) && !/af bij|af\/bij/i.test(t)) map.amount = i;
      else if (map.debcred < 0 && /^af bij$|^af\/bij$|^bij\/af$|^debet\/credit$/i.test(t)) map.debcred = i;
      else if (map.desc < 0 && HINTS.desc.test(t)) map.desc = i;
      else if (map.account < 0 && HINTS.account.test(t)) map.account = i;
      else map.extra.push(i);
    });
    return map;
  }

  function fromTable(aoa, opts) {
    opts = opts || {};
    // eerste rij met >=3 gevulde cellen die op een header lijkt
    var hi = 0;
    for (var i = 0; i < Math.min(aoa.length, 15); i++) {
      var r = aoa[i].map(clean);
      if (r.filter(Boolean).length >= 3 && r.some(function (c) { return HINTS.date.test(c); })) { hi = i; break; }
    }
    var header = aoa[hi].map(clean);
    var map = mapColumns(header);
    // Geen enkele bedragkolom? Sommige banken (o.a. Triodos) splitsen in aparte
    // debet- en credit-kolommen; herken dat paar en reken credit − debet.
    var deb = -1, cred = -1;
    if (map.amount < 0) {
      header.forEach(function (h, i) {
        var t = clean(h);
        if (deb < 0 && /^(debet|debit|af|uitgaven?|withdrawal)$/i.test(t)) deb = i;
        else if (cred < 0 && /^(credit|bij|ontvangsten?|inkomsten|deposit)$/i.test(t)) cred = i;
      });
      if (deb > -1 && cred > -1) {
        map.extra = map.extra.filter(function (k) { return k !== deb && k !== cred; });
      } else { deb = -1; cred = -1; }
    }
    if (map.date < 0 || (map.amount < 0 && deb < 0)) return { rows: [], error: 'Geen datum- en bedragkolom herkend. Kolommen: ' + header.join(' | ') };
    var out = [];
    var order = detectOrder(aoa.slice(hi + 1).map(function (r) { return r && r[map.date]; }));
    for (var j = hi + 1; j < aoa.length; j++) {
      var row = aoa[j];
      if (!row) continue;
      var d = dateFromAny(row[map.date], order);
      if (!d) continue;
      var amt;
      if (deb > -1) {
        var dv = nl(row[deb]), cv = nl(row[cred]);
        if (isNaN(dv) && isNaN(cv)) continue;
        amt = (isNaN(cv) ? 0 : Math.abs(cv)) - (isNaN(dv) ? 0 : Math.abs(dv));
      } else {
        amt = nl(row[map.amount]);
        if (isNaN(amt)) continue;
        if (map.debcred >= 0 && /^af$|^d$|^debet$/i.test(clean(row[map.debcred]))) amt = -Math.abs(amt);
        if (map.debcred >= 0 && /^bij$|^c$|^credit$/i.test(clean(row[map.debcred]))) amt = Math.abs(amt);
      }
      var desc = map.desc >= 0 ? clean(row[map.desc]) : '';
      map.extra.forEach(function (k) {
        var v = clean(row[k]);
        if (v && v.length > 2 && !/^\d+([.,]\d+)?$/.test(v) && desc.indexOf(v) < 0) desc += ' ' + v;
      });
      out.push({ date: d, amount: Math.round(amt * 100) / 100, desc: clean(desc).slice(0, 200),
                 account: opts.account || (map.account >= 0 ? clean(row[map.account]) : ''),
                 bank: opts.bank || '', owner: opts.owner || '' });
    }
    return { rows: out };
  }

  // ---------------------------------------------------------------- ING CSV
  function parseIngCsv(text) {
    var rows = splitCSV(text);
    var h = rows[0].map(clean);
    if (h.indexOf('Af Bij') < 0 || h.indexOf('Bedrag (EUR)') < 0) return null;
    var ix = {}; h.forEach(function (x, i) { ix[x] = i; });
    var out = [];
    for (var i = 1; i < rows.length; i++) {
      var r = rows[i];
      var d = dateFromAny(r[ix['Datum']]);
      if (!d) continue;
      var v = nl(r[ix['Bedrag (EUR)']]);
      if (clean(r[ix['Af Bij']]) === 'Af') v = -v;
      var med = clean(r[ix['Mededelingen']] || '')
        .replace(/(Valutadatum|Kenmerk|Machtiging ID|Incassant ID|Datum\/Tijd|Pasvolgnr|Transactie):[^]*?(?=(Naam:|Omschrijving:|IBAN:|$))/g, '');
      out.push({ date: d, amount: Math.round(v * 100) / 100,
                 desc: clean(clean(r[ix['Naam / Omschrijving']]) + ' ' + med).slice(0, 200),
                 account: clean(r[ix['Rekening']] || ''), bank: 'ING', owner: '' });
    }
    return out.length ? out : null;
  }

  // ---------------------------------------------------------------- PDF-layout
  // Zet pdf.js-tekstitems om naar regels met x-posities, plus een tekstregel met
  // uitgelijnde spaties (vergelijkbaar met pdftotext -layout).
  function pageToLines(items) {
    var byY = {};
    items.forEach(function (it) {
      if (!it.str || !it.str.trim()) return;
      var x = it.transform[4], y = Math.round(it.transform[5] / 2) * 2;
      (byY[y] = byY[y] || []).push({ s: it.str, x: x, x1: x + (it.width || 0) });
    });
    return Object.keys(byY).map(Number).sort(function (a, b) { return b - a; }).map(function (y) {
      var parts = byY[y].sort(function (a, b) { return a.x - b.x; });
      var words = [], txt = '', col = 0;
      parts.forEach(function (p) {
        var start = Math.round(p.x / 4.6);
        if (start > col) { txt += ' '.repeat(start - col); col = start; }
        else if (txt && !/\s$/.test(txt)) { txt += ' '; col++; }
        txt += p.s; col += p.s.length;
        p.s.trim().split(/\s+/).forEach(function (w) { if (w) words.push({ s: w, x: p.x, x1: p.x1 }); });
      });
      return { y: y, text: txt.replace(/\s+$/, ''), words: words, parts: parts };
    });
  }

  // ---------------------------------------------------------------- Knab (PDF)
  function parseKnab(pages) {
    var ibanM = pages[0].map(function (l) { return l.text; }).join('\n').match(/Rekeningnummer\s+(\S+)/);
    var iban = ibanM ? ibanM[1] : 'Knab';
    var afX = null, bijX = null, out = [], cur = null;
    var DATE = /^\d{2}-\d{2}-\d{4}$/;
    pages.forEach(function (lines) {
      lines.forEach(function (l) {
        l.parts.forEach(function (p) {
          var t = p.s.trim();
          if (t === 'Af' && afX === null) afX = p.x1;
          if (t === 'Bij' && bijX === null) bijX = p.x1;
        });
      });
      lines.forEach(function (l) {
        var w = l.words;
        if (w.length > 1 && DATE.test(w[0].s) && DATE.test(w[1].s)) {
          if (cur) out.push(cur);
          var amt = null;
          for (var i = 2; i < w.length; i++) {
            if (/^-?[\d.]*\d,\d{2}$/.test(w[i].s)) {
              var v = nl(w[i].s);
              var mid = (afX !== null && bijX !== null) ? (afX + bijX) / 2 : 430;
              amt = w[i].x1 <= mid + 2 ? -v : v;
            }
          }
          var txtParts = w.slice(2).filter(function (x) { return !/^-?[\d.]*\d,\d{2}$/.test(x.s); })
            .map(function (x) { return x.s; });
          var p = w[0].s.split('-');
          cur = { date: iso(p[0], p[1], p[2]), amount: amt, desc: txtParts.join(' '),
                  account: iban, bank: 'Knab', owner: '' };
        } else if (cur) {
          var t = l.text.trim();
          if (!t || /^(Aan dit overzicht|Transactie|datum$|Pagina|Rekeningnummer|Type|Periode|Betreft|Datum download|Saldo op|Totaal)/.test(t)) return;
          cur.desc += ' ' + t;
        }
      });
    });
    if (cur) out.push(cur);
    return out.filter(function (r) { return r.amount !== null; })
      .map(function (r) { r.desc = clean(r.desc).slice(0, 200); return r; });
  }

  // ---------------------------------------------------------------- ING (PDF)
  function parseIngPdf(pages) {
    var TXL = /^\s*(\d{2}-\d{2}-\d{4})\s(.+?)\s{2,}([A-Za-z][A-Za-z ./|-]*?)\s{2,}([+-]?[\d.]*\d,\d{2})\s*$/;
    var out = [], cur = null;
    pages.forEach(function (lines) {
      lines.forEach(function (l) {
        var m = TXL.exec(' ' + l.text);
        if (m) {
          if (cur) out.push(cur);
          var p = m[1].split('-');
          cur = { date: iso(p[0], p[1], p[2]), amount: nl(m[4]), desc: clean(m[2]),
                  account: 'ING', bank: 'ING', owner: '' };
          return;
        }
        var s = l.text.trim();
        if (!s || !cur) return;
        if (/^(Geboekt op|Rekeningnummer|NL\d\d|Afschrift|Dit product|ING Bank|Periode|Valutadatum|Pasvolgnr|Transactie:|Machtiging ID|Incassant ID|Kenmerk|Pagina)/.test(s)) return;
        cur.desc += ' ' + s;
      });
    });
    if (cur) out.push(cur);
    return out.map(function (r) { r.desc = clean(r.desc).slice(0, 200); return r; });
  }

  // ---------------------------------------------------------------- Rabobank (PDF)
  function parseRabo(pages, fallbackYear) {
    // Het rekeningnummer staat op het afschrift zelf; lees het daaruit in plaats
    // van iets aan te nemen. Valt terug op "Rabobank" als er geen IBAN gevonden wordt.
    var kop = pages[0].map(function (l) { return l.text; }).join('\n');
    var ibanM = kop.match(/\b[A-Z]{2}\d{2}(?: ?[A-Z]){4}(?: ?\d){10}\b/);
    var iban = ibanM ? ibanM[0].replace(/\s/g, '') : 'Rabobank';
    // De Af/Bij-kolomgrenzen uit de kopwoorden van het afschrift zelf halen, zodat
    // een layout-wijziging van de bank het teken niet stilletjes omdraait. Lukt dat
    // niet, dan gelden de oude vaste posities als terugval.
    var afX = null, bijX = null;
    pages.forEach(function (lines) {
      lines.forEach(function (l) {
        l.parts.forEach(function (p) {
          var t = p.s.trim();
          if (t === 'Af' && afX === null) afX = p.x1;
          if (t === 'Bij' && bijX === null) bijX = p.x1;
        });
      });
    });
    var grens = 380, mid = 490;
    if (afX !== null && bijX !== null) {
      grens = Math.min(afX, bijX) - 80;
      mid = (afX + bijX) / 2;
    }
    var HEAD = /^(\d{2}-\d{2})\s+([a-z]{2})\s/;
    var out = [], cur = null;
    pages.forEach(function (lines) {
      lines.forEach(function (l) {
        var t = l.text.trim();
        if (HEAD.test(t)) {
          if (cur) out.push(cur);
          var amt = null;
          l.words.forEach(function (w) {
            if (/^[\d.]*\d,\d{2}$/.test(w.s) && w.x > grens) {
              var v = nl(w.s);
              amt = w.x1 < mid ? -v : v;
            }
          });
          var parts = l.words.slice(2).filter(function (w) {
            return !(/^[\d.]*\d,\d{2}$/.test(w.s) && w.x > grens);
          }).map(function (w) { return w.s; });
          cur = { rdate: t.slice(0, 5), amount: amt, desc: parts.join(' '),
                  account: iban, bank: 'Rabobank', owner: '', date: null };
        } else if (cur) {
          if (/^Verwerkingsdatum:/.test(t)) {
            var d = dateFromAny(t.split(':')[1]);
            if (d) cur.date = d;
          } else if (!/^(Rekeningafschrift|Rabo |Ten name|IBAN|Rente|datum$|Blad|Datum|Beginsaldo|Eindsaldo|Totaal|Kenmerk machtiging|Transactiereferentie|BIC)/.test(t) && t) {
            cur.desc += ' ' + t;
          }
        }
      });
    });
    if (cur) out.push(cur);
    return out.filter(function (r) { return r.amount !== null; }).map(function (r) {
      if (!r.date) { var p = r.rdate.split('-'); r.date = iso(p[0], p[1], fallbackYear || new Date().getFullYear()); }
      delete r.rdate; r.desc = clean(r.desc).slice(0, 200); return r;
    });
  }

  // ---------------------------------------------------------------- ICS / Visa (PDF)
  function parseIcs(pages) {
    var all = [].concat.apply([], pages).map(function (l) { return l.text; });
    var txt = all.join('\n');
    var m = txt.match(new RegExp('(\\d{1,2}) (' + Object.keys(MONFULL).join('|') + ') (\\d{4})'));
    if (!m) return [];
    var sm = MONFULL[m[2]], sy = +m[3];
    var TX = /^\s*(\d{2})\s+([a-z]{3})\.?\s+(\d{2})\s+([a-z]{3})\.?\s+(.+?)\s{2,}([\d.]*\d,\d{2})\s+(Af|Bij)\s*$/;
    var CARD = /Uw Card met als laatste vier cijfers (\d{4})/;
    var out = [], holder = '';
    all.forEach(function (line) {
      var c = CARD.exec(line);
      if (c) { holder = c[1]; return; }
      var t = TX.exec(' ' + line);
      if (!t) return;
      var mm = MON3[t[2]];
      if (!mm) return;
      var yy = mm <= sm ? sy : sy - 1;
      var v = nl(t[6]);
      out.push({ date: iso(t[1], mm, yy), amount: t[7] === 'Bij' ? v : -v,
                 desc: clean(t[5].replace(/\s{2,}[\d.]*\d,\d{2}\s*$/, '')).slice(0, 200),
                 account: 'ICS Visa', bank: 'ICS Visa', owner: '', card: holder });
    });
    return out;
  }

  // ---------------------------------------------------------------- Amex (xlsx)
  function parseAmex(aoa) {
    var hi = -1;
    for (var i = 0; i < Math.min(aoa.length, 20); i++) {
      var r = (aoa[i] || []).map(clean);
      if (r[0] === 'Datum' && r.indexOf('Bedrag') > -1) { hi = i; break; }
    }
    if (hi < 0) return null;
    var h = aoa[hi].map(clean);
    var iD = h.indexOf('Datum'), iO = h.indexOf('Omschrijving'), iB = h.indexOf('Bedrag'),
        iK = h.indexOf('Kaartlid'), iE = h.indexOf('Aanvullende informatie');
    var out = [];
    var order = detectOrder(aoa.slice(hi + 1).map(function (r) { return r && r[iD]; }));
    if (order === 'dmy') order = 'mdy';   // Amex hanteert de Amerikaanse notatie
    for (var j = hi + 1; j < aoa.length; j++) {
      var row = aoa[j]; if (!row) continue;
      var d = dateFromAny(row[iD], order); if (!d) continue;
      var v = nl(row[iB]); if (isNaN(v)) continue;
      var desc = clean(row[iO]);
      if (iE > -1 && clean(row[iE])) desc += ' | ' + clean(row[iE]).slice(0, 80);
      var kl = iK > -1 ? clean(row[iK]) : '';
      out.push({ date: d, amount: Math.round(-v * 100) / 100, desc: desc.slice(0, 200),
                 account: 'AMEX', bank: 'American Express',
                 owner: kl ? (kl.split(' ')[0].charAt(0) + kl.split(' ')[0].slice(1).toLowerCase()) : '' });
    }
    return out.length ? out : null;
  }

  // ---------------------------------------------------------------- herkenning
  function detectAndParse(pages, filename) {
    var head = pages[0].map(function (l) { return l.text; }).join('\n');
    var full = pages.map(function (p) { return p.map(function (l) { return l.text; }).join('\n'); }).join('\n');
    if (/Knab/i.test(head) && /Transactie\s+Boekdatum|Tegenrekening/i.test(full)) {
      return { bank: 'Knab', rows: parseKnab(pages) };
    }
    if (/International Card Services|ICS-klantnummer/i.test(head)) {
      return { bank: 'ICS Visa', rows: parseIcs(pages) };
    }
    if (/Rabobank|Rabo Standaard|RABONL2U/i.test(head)) {
      var y = (head.match(/(\d{2})-(\d{2})-(\d{4})/) || [])[3] || new Date().getFullYear();
      return { bank: 'Rabobank', rows: parseRabo(pages, y) };
    }
    if (/ING Bank|Afschrift Betaalrekening|Afschrift Oranje/i.test(head)) {
      return { bank: 'ING', rows: parseIngPdf(pages) };
    }
    return { bank: 'onbekend', rows: parseIngPdf(pages), warning:
      'Het type afschrift is niet herkend; er is een algemene poging gedaan. Controleer de regels voordat je ze toevoegt.' };
  }

  global.HBParsers = {
    nl: nl, dateFromAny: dateFromAny, clean: clean, splitCSV: splitCSV,
    fromTable: fromTable, detectOrder: detectOrder, parseIngCsv: parseIngCsv, parseAmex: parseAmex,
    parseAbnTxt: parseAbnTxt, parseCamt: parseCamt,
    pageToLines: pageToLines, detectAndParse: detectAndParse,
    parseKnab: parseKnab, parseIngPdf: parseIngPdf, parseRabo: parseRabo, parseIcs: parseIcs
  };
})(window);
