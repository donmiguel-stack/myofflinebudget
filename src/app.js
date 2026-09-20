/* Huishoudboekje — lokale budget-app. Geen server, geen tracking: alle data blijft in je browser. */
(function () {
  'use strict';
  var P = window.HBParsers;
  var STORE = 'huishoudboekje.v1';
  var I18N = window.HB_I18N || { UI: {}, GROUPS: {}, CATS: {}, CURRENCIES: ['EUR'], order: ['nl'] };
  var LANG = 'nl', CUR = 'EUR', MONTHS = [];

  function T(key, vars) {
    var d = (I18N.UI[LANG] || {})[key];
    if (d === undefined) d = (I18N.UI.nl || {})[key];
    if (d === undefined) return key;
    if (vars) Object.keys(vars).forEach(function (k) { d = d.split('{' + k + '}').join(vars[k]); });
    return d;
  }
  function TG(g) {           // groepsnaam vertalen (valt terug op het origineel)
    var m = I18N.GROUPS[g];
    return (m && m[LANG]) || g;
  }
  function TC(c) {           // categorienaam vertalen
    var m = I18N.CATS[c];
    return (m && m[LANG]) || c;
  }
  function locale() { return ((I18N.UI[LANG] || {})._locale) || 'nl-NL'; }
  function buildMonths() {
    MONTHS = [];
    for (var i = 0; i < 12; i++) {
      MONTHS.push(new Intl.DateTimeFormat(locale(), { month: 'short' }).format(new Date(Date.UTC(2021, i, 15))));
    }
  }
  var SERIES = ['--series-1', '--series-2', '--series-3', '--series-4', '--series-5', '--series-6', '--series-7', '--series-8'];

  // ---------------------------------------------------------------- state
  var base = window.HB_DATA || { accounts: [], owners: [], banks: [], groups: [], categories: [], tx: [], sunclass: [] };
  var rulesData = window.HB_RULES || { rules: [], eigenRekeningen: [], internPatronen: [] };
  var S = {
    tx: [],            // {id,date,month,year,account,owner,bank,desc,amount,group,cat,zak,src}
    budget: {},        // cat -> bedrag per maand
    overrides: {},     // txid -> {cat,group}
    manual: [],        // handmatige/kasregels
    userRules: [],     // eigen categorieregels: {pat, cat, group}
    catType: {},       // categorie -> 'vast' | 'vrij' | 'opname' | 'sparen'
    potjes: [],        // reserveringen: {naam, doel, datum, stand}
    investeringen: [], // {id,type,naam,aantal,inleg,waarde,datum,notitie}
    splits: {},        // txid -> [{cat,group,amount,desc}, ...] (som moet bedrag van de boeking zijn)
    leningen: [],      // {id,naam,hoofdsom,pct,maanden,start,renteCum,toelichting}
    settings: { theme: 'auto', hideZak: true, jaar: null, lang: null, cur: 'EUR',
                maandBasis: 'hist', inkomenOverride: null, budgetAlleMaanden: false }
  };

  function txId(t) {
    var k = String(t.desc || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 14);
    return t.date + '|' + t.amount.toFixed(2) + '|' + k;
  }

  function loadBase() {
    S.tx = base.tx.map(function (a, i) {
      var t = {
        id: 'b' + i, date: a[0], month: a[0].slice(0, 7), year: +a[0].slice(0, 4),
        account: base.accounts[a[1]], owner: base.owners[a[2]], bank: base.banks[a[3]],
        desc: a[4], amount: a[5], group: base.groups[a[6]], cat: base.categories[a[7]],
        zak: !!a[8], src: 'bank'
      };
      return t;
    });
  }

  function load() {
    var eigenLeningen = false;
    if (window.HB_BUDGET && !localStorage.getItem(STORE)) S.budget = Object.assign({}, window.HB_BUDGET);
    try {
      var raw = localStorage.getItem(STORE);
      if (raw) {
        var d = JSON.parse(raw);
        S.budget = d.budget || S.budget;
        S.overrides = d.overrides || {};
        S.manual = d.manual || [];
        S.userRules = d.userRules || [];
        S.catType = d.catType || {};
        S.potjes = d.potjes || [];
        S.investeringen = d.investeringen || [];
        S.splits = d.splits || {};
        S.settings = Object.assign(S.settings, d.settings || {});
        if (d.imported) S.imported = d.imported;
        if (Object.prototype.hasOwnProperty.call(d, 'leningen')) { S.leningen = d.leningen || []; eigenLeningen = true; }
      }
    } catch (e) { console.warn('opslag lezen mislukt', e); }
    // Stond er nog een lijst in het bronbestand (oude opzet), neem die dan één
    // keer over. Daarna is de opslag leidend: wat je hier weghaalt, blijft weg.
    if (!eigenLeningen && window.HB_LENINGEN && window.HB_LENINGEN.length) {
      S.leningen = window.HB_LENINGEN.map(function (l, i) {
        return {
          id: 'oud' + i, naam: l.naam || ('Lening ' + (i + 1)),
          hoofdsom: +l.hoofdsom || 0,
          pct: (+l.pct || 0) * 100,          // stond als breuk in het bronbestand
          maanden: Math.max(0, Math.round(+l.maanden || 0)),   // 0 = aflossingsvrij
          start: l.renteVanaf || new Date().toISOString().slice(0, 10),
          renteCum: +l.renteCum || 0, toelichting: l.toelichting || ''
        };
      });
    }
  }

  function save() {
    _recSet = null;
    try {
      localStorage.setItem(STORE, JSON.stringify({
        budget: S.budget, overrides: S.overrides, manual: S.manual, userRules: S.userRules,
        catType: S.catType, potjes: S.potjes || [], investeringen: S.investeringen || [], settings: S.settings,
        imported: S.imported || [], splits: S.splits || {}, leningen: S.leningen || []
      }));
      flash(T('saved'));
    } catch (e) { flash(T('save_failed', { e: e.message }), true); }
  }

  function normDesc(d) {
    return String(d || '').toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }

  // Sleutel om terugkerende boekingen te groeperen: naam van de partij zonder ruis.
  var NOISE = /^(NAAM|OMSCHRIJVING|IBAN|KENMERK|MACHTIGING|INCASSANT|PAS|PASVOLGNR|APPLE|PAY|BV|NV|THE|VAN|DER|DEN|VIA|BETREFT|PERIODE|FACTUUR|NOTA|TERM|TRANSACTIE|VALUTADATUM|DOORLOPENDE|INCASSO|EUR|USD|COM|WWW|NLD|BEL|DEU|FRA|USA)$/;
  var BANKCODE = /^(INGB|RABO|KNAB|ABNA|DEUT|SNSB|BUNQ|ADYB|TRIO|ASNB|RBRB|FVLB|BNGH|KRED|GKCC|CITI|BITS|MOYO|NTSB|REVO|ZZZ\d*)$/;
  function payeeKey(desc) {
    var t = normDesc(desc)
      .replace(/\b[A-Z]{2}\d{2}[ ]?[A-Z]{4}[ \d]{6,}/g, ' ')     // iban met spaties
      .replace(/[^A-Z0-9 ]+/g, ' ')
      .split(/\s+/)
      .filter(function (w) {
        if (w.length < 3) return false;
        if (/^\d+$/.test(w)) return false;                        // alleen cijfers
        if (/\d/.test(w) && /[A-Z]/.test(w) && w.length >= 6) return false;  // iban of referentie
        if (/\d/.test(w) && w.length >= 4) return false;          // codes als 3163, R1178
        return !NOISE.test(w) && !BANKCODE.test(w);
      });
    var uniek = [];
    t.forEach(function (w) { if (uniek.indexOf(w) < 0) uniek.push(w); });
    return uniek.slice(0, 3).join(' ');
  }

  // Een regel matcht als álle woorden uit het patroon in de omschrijving voorkomen.
  function ruleMatch(pat, desc) {
    var n = normDesc(desc);
    var woorden = String(pat).toUpperCase().split(/\s+/).filter(Boolean);
    if (!woorden.length) return false;
    for (var i = 0; i < woorden.length; i++) if (n.indexOf(woorden[i]) < 0) return false;
    return true;
  }

  // Leesbare naam van de partij: iban's en veldnamen eruit
  function payeeNaam(desc) {
    var d = String(desc || '')
      .replace(/^[A-Z]{2}\d{2} ?[A-Z]{4}[\d ]{6,}/, '')
      .replace(/^[A-Z]{2}\d{2}[A-Z]{4}\d{6,}/, '')
      .replace(/\bNaam:\s*/gi, ' ')
      .split(/Omschrijving:|Kenmerk|Machtiging|IBAN:|Valutadatum|Transactie:/i)[0]
      .replace(/\s+/g, ' ').trim();
    var w = d.split(' '), out = [];
    for (var i = 0; i < w.length; i++) {                    // herhaalde naam inkorten
      if (i >= 2 && w[i] === w[0] && w[i + 1] === w[1]) break;
      out.push(w[i]);
    }
    d = out.join(' ');
    return (d.length >= 3 ? d : String(desc)).slice(0, 44);
  }

  function applyUserRules(t) {
    var o = S.overrides[t.id];
    if (o) return Object.assign({}, t, o);
    for (var i = 0; i < S.userRules.length; i++) {
      if (ruleMatch(S.userRules[i].pat, t.desc)) {
        return Object.assign({}, t, { cat: S.userRules[i].cat, group: S.userRules[i].group, byRule: true });
      }
    }
    return t;
  }

  function rawTx(id) {
    return S.tx.concat(S.imported || [], S.manual).filter(function (t) { return t.id === id; })[0];
  }

  function allTx() {
    var basis = S.tx.concat(S.imported || [], S.manual).map(applyUserRules);
    var uit = [];
    basis.forEach(function (t) {
      var sp = S.splits[t.id];
      if (sp && sp.length) {
        sp.forEach(function (p, i) {
          uit.push(Object.assign({}, t, {
            id: t.id + '#' + i, cat: p.cat, group: p.group, amount: p.amount,
            desc: '\u21b3 ' + (p.desc ? p.desc + ': ' : '') + t.desc,
            splitParent: t.id, splitPart: true, byRule: false
          }));
        });
      } else {
        uit.push(t);
      }
    });
    return uit;
  }

  var VAST_GROEPEN = ['Wonen', 'Verzekeringen', 'Boodschappen'];
  // noodzakelijke posten die je hoe dan ook begroot, ook als het bedrag schommelt
  var VAST_CAT = /BRANDSTOF|FUEL|LADEN|CHARGING|KINDEREN|OPVANG|CHILDCARE|CRECHE|KITA|GUARDER|MOTORRIJTUIG|ROAD TAX|WEGENBELASTING|ONDERHOUD|STUDIESCHULD|STUDENT LOAN|AFLOSSING|REPAYMENT/i;
  var OPNAME_RE = /CONTANT|GELDOPNAME|GELDMAAT|CASH WITHDRAW|BARGELD|RETIRADA|ESPECES|取现/i;
  // Sparen en beleggen zijn geen uitgave maar een verplaatsing binnen je eigen
  // vermogen: ze blijven buiten het budget en komen terug op Investeringen.
  var SPAAR_RE = /SPAREN|BELEGG/i;
  var _recSet = null;

  function recurringCats() {
    if (_recSet) return _recSet;
    _recSet = {};
    try {
      detectRecurring().forEach(function (r) { if (r.actief) _recSet[r.cat] = 1; });
    } catch (e) { /* nog geen data */ }
    return _recSet;
  }

  // Vast = hoort in het budget. Vrij = uit de vrije ruimte. Opname = geen uitgave.
  function catSoort(cat, groep) {
    if (S.catType[cat]) return S.catType[cat];
    if (window.HB_CATTYPE && window.HB_CATTYPE[cat]) return window.HB_CATTYPE[cat];
    if (OPNAME_RE.test(cat)) return 'opname';
    if (SPAAR_RE.test(cat)) return 'sparen';
    if (groep === 'Inkomen') return 'vast';
    if (VAST_GROEPEN.indexOf(groep) >= 0) return 'vast';
    if (VAST_CAT.test(cat)) return 'vast';
    if (recurringCats()[cat]) return 'vast';
    return 'vrij';
  }

  function catGroep(cat) {
    var g = catList().filter(function (c) { return c.cat === cat; })[0];
    return g ? g.group : 'Overig';
  }

  function budgetTx() {   // wat meetelt in het huishoudbudget
    return allTx().filter(function (t) {
      var s = catSoort(t.cat, t.group);
      return !t.zak && t.group !== 'Interne overboeking' && s !== 'opname' && s !== 'sparen';
    });
  }

  function opnameTx() {   // contante opnames: verplaatsingen, geen uitgaven
    return allTx().filter(function (t) {
      return !t.zak && t.group !== 'Interne overboeking' && catSoort(t.cat, t.group) === 'opname';
    });
  }

  // Geld naar je eigen spaar- of beleggingsrekening. Geen uitgave: het verlaat je
  // huishoudboekje niet, het verhuist naar een andere kolom van je vermogen.
  function spaarTx() {
    return allTx().filter(function (t) {
      return !t.zak && t.group !== 'Interne overboeking' && catSoort(t.cat, t.group) === 'sparen';
    });
  }

  // Per spaar- of beleggingscategorie: netto opzij gezet (opnames gaan er weer af).
  function spaarPerCat(jaar) {
    var per = {};
    spaarTx().forEach(function (t) {
      var r = per[t.cat] || (per[t.cat] = { cat: t.cat, tot: 0, jaar: 0, n: 0, laatste: '' });
      r.tot -= t.amount;
      if (jaar && t.year === jaar) r.jaar -= t.amount;
      if (t.amount < 0) r.n++;
      if (t.date > r.laatste) r.laatste = t.date;
    });
    return Object.keys(per).map(function (c) { return per[c]; })
      .sort(function (a, b) { return b.tot - a.tot; });
  }

  // ---------------------------------------------------------------- formatteren
  function eur(v, dec) {
    if (v === null || v === undefined || isNaN(v)) return '–';
    return new Intl.NumberFormat(locale(), {
      style: 'currency', currency: CUR,
      minimumFractionDigits: dec === 0 ? 0 : 2, maximumFractionDigits: dec === 0 ? 0 : 2
    }).format(v);
  }
  function eur0(v) { return eur(v, 0); }
  function dmy(is) {
    var p = is.split('-');
    return new Intl.DateTimeFormat(locale(), { day: '2-digit', month: '2-digit', year: 'numeric' })
      .format(new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])));
  }
  function maandLabel(m) { var p = m.split('-'); return MONTHS[+p[1] - 1] + ' ' + p[0]; }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); }
  function cssVar(n) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); }

  var flashT;
  function flash(msg, bad) {
    var el = document.getElementById('flash');
    el.textContent = msg;
    el.className = 'pill ' + (bad ? 'over' : 'ok');
    el.style.opacity = 1;
    clearTimeout(flashT);
    flashT = setTimeout(function () { el.style.opacity = 0; }, 2600);
  }

  // ---------------------------------------------------------------- afleidingen
  function months() {
    var s = {};
    budgetTx().forEach(function (t) { s[t.month] = 1; });
    return Object.keys(s).sort();
  }
  function years() {
    var s = {};
    budgetTx().forEach(function (t) { if (t.year >= 2025) s[t.year] = 1; });
    return Object.keys(s).map(Number).sort();
  }
  function catList() {
    var s = {};
    allTx().forEach(function (t) { if (t.group !== 'Interne overboeking') s[t.cat] = t.group; });
    return Object.keys(s).sort().map(function (c) { return { cat: c, group: s[c] }; });
  }

  // Categorieën gegroepeerd per hoofdgroep — zodat een lange platte lijst in
  // keuzelijsten wordt opgedeeld. Voorkomt dat je door tientallen categorieën
  // moet scrollen om er één te vinden.
  function catGroups() {
    var byGroup = {};
    catList().forEach(function (c) { (byGroup[c.group] = byGroup[c.group] || []).push(c); });
    var groups = Object.keys(byGroup).sort(function (a, b) { return TG(a).localeCompare(TG(b), locale()); });
    groups.forEach(function (g) {
      byGroup[g].sort(function (a, b) { return TC(a.cat).localeCompare(TC(b.cat), locale()); });
    });
    return { groups: groups, byGroup: byGroup };
  }

  function catOptionsHtml(selectedCat) {
    var G = catGroups();
    return G.groups.map(function (g) {
      return '<optgroup label="' + esc(TG(g)) + '">' + G.byGroup[g].map(function (c) {
        return '<option value="' + esc(c.cat) + '"' + (c.cat === selectedCat ? ' selected' : '') + '>' +
          esc(TC(c.cat)) + '</option>';
      }).join('') + '</optgroup>';
    }).join('');
  }
  function sumBy(fn, filter) {
    var m = {};
    budgetTx().forEach(function (t) {
      if (filter && !filter(t)) return;
      var k = fn(t);
      m[k] = (m[k] || 0) + t.amount;
    });
    return m;
  }

  // ---------------------------------------------------------------- SVG-grafieken
  function svgEl(tag, attrs) {
    var e = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  }
  var tip = null;
  function showTip(html, ev) {
    if (!tip) { tip = document.createElement('div'); tip.className = 'tip'; document.body.appendChild(tip); }
    tip.innerHTML = html;
    tip.classList.add('show');
    var x = ev.clientX + 14, y = ev.clientY + 14;
    var w = tip.offsetWidth, h = tip.offsetHeight;
    if (x + w > innerWidth - 8) x = ev.clientX - w - 14;
    if (y + h > innerHeight - 8) y = ev.clientY - h - 14;
    tip.style.left = x + 'px'; tip.style.top = y + 'px';
  }
  function hideTip() { if (tip) tip.classList.remove('show'); }

  function niceTicks(min, max, n) {
    var span = (max - min) || 1;
    var step = Math.pow(10, Math.floor(Math.log10(span / n)));
    [1, 2, 2.5, 5, 10].some(function (m) { if (span / (step * m) <= n) { step *= m; return true; } });
    var lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step, out = [];
    for (var v = lo; v <= hi + step / 2; v += step) out.push(Math.round(v * 1e6) / 1e6);
    return out;
  }

  function axisFrame(svg, W, H, pad, ticks, labels, opts) {
    opts = opts || {};
    var min = ticks[0], max = ticks[ticks.length - 1];
    if (!(max > min)) { max = min + 1; }          // vlakke of lege reeks: geen deling door nul
    var y = function (v) { return pad.t + (max - v) / (max - min) * (H - pad.t - pad.b); };
    ticks.forEach(function (v) {
      svg.appendChild(svgEl('line', { x1: pad.l, x2: W - pad.r, y1: y(v), y2: y(v),
        stroke: v === 0 ? cssVar('--axis') : cssVar('--grid'), 'stroke-width': 1 }));
      var tx = svgEl('text', { x: pad.l - 8, y: y(v) + 4, 'text-anchor': 'end',
        fill: cssVar('--muted'), 'font-size': 11 });
      tx.textContent = opts.fmt ? opts.fmt(v) : eur0(v);
      svg.appendChild(tx);
    });
    var step = (W - pad.l - pad.r) / labels.length;
    var elke = opts.elke || (labels.length > 14 ? 2 : 1);
    labels.forEach(function (lb, i) {
      if (i % elke) return;
      var t = svgEl('text', { x: pad.l + step * (i + .5), y: H - pad.b + 15, 'text-anchor': 'middle',
        fill: cssVar('--muted'), 'font-size': 11 });
      t.textContent = lb;
      svg.appendChild(t);
    });
    return { y: y, step: step, x0: pad.l };
  }

  function lineChart(host, labels, series, opts) {
    opts = opts || {};
    host.innerHTML = '';
    var W = host.clientWidth || 640, H = opts.height || 260, pad = { l: 62, r: 14, t: 12, b: 26 };
    var vals = [].concat.apply([], series.map(function (s) { return s.data; }))
      .filter(function (v) { return isFinite(v); });
    if (!vals.length) { host.innerHTML = '<p class="muted">' + T('empty') + '</p>'; return; }
    var ticks = niceTicks(Math.min(0, Math.min.apply(null, vals)), Math.max.apply(null, vals), 5);
    var svg = svgEl('svg', { width: '100%', height: H, viewBox: '0 0 ' + W + ' ' + H, role: 'img' });
    var fr = axisFrame(svg, W, H, pad, ticks, opts.labelFmt ? labels.map(opts.labelFmt) : labels, opts);
    series.forEach(function (s, si) {
      var col = cssVar(SERIES[si % 8]);
      var d = s.data.map(function (v, i) { return (i ? 'L' : 'M') + (fr.x0 + fr.step * (i + .5)) + ' ' + fr.y(v); }).join(' ');
      svg.appendChild(svgEl('path', { d: d, fill: 'none', stroke: col, 'stroke-width': 2,
        'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
      if (s.data.length <= 40) {
        s.data.forEach(function (v, i) {
          svg.appendChild(svgEl('circle', { cx: fr.x0 + fr.step * (i + .5), cy: fr.y(v), r: 3.5,
            fill: col, stroke: cssVar('--surface-1'), 'stroke-width': 2 }));
        });
      }
    });
    labels.forEach(function (lb, i) {
      var hit = svgEl('rect', { x: fr.x0 + fr.step * i, y: pad.t, width: fr.step, height: H - pad.t - pad.b,
        fill: 'transparent' });
      hit.addEventListener('mousemove', function (ev) {
        showTip('<b>' + esc(lb) + '</b>' + series.map(function (s, si) {
          return '<div class="row"><span><i style="display:inline-block;width:9px;height:9px;border-radius:2px;background:' +
            cssVar(SERIES[si % 8]) + ';margin-right:5px"></i>' + esc(s.name) + '</span><span>' + eur(s.data[i]) + '</span></div>';
        }).join(''), ev);
      });
      hit.addEventListener('mouseleave', hideTip);
      svg.appendChild(hit);
    });
    host.appendChild(svg);
  }

  function barChart(host, labels, data, opts) {
    opts = opts || {};
    host.innerHTML = '';
    var W = host.clientWidth || 640, H = opts.height || 240, pad = { l: 62, r: 14, t: 12, b: 26 };
    if (!data.filter(function (v) { return isFinite(v) && v !== 0; }).length) {
      host.innerHTML = '<p class="muted">' + T('empty') + '</p>'; return;
    }
    var ticks = niceTicks(Math.min(0, Math.min.apply(null, data)), Math.max(0, Math.max.apply(null, data)), 5);
    var svg = svgEl('svg', { width: '100%', height: H, viewBox: '0 0 ' + W + ' ' + H, role: 'img' });
    var fr = axisFrame(svg, W, H, pad, ticks, labels);
    var bw = Math.max(4, fr.step - 8);
    data.forEach(function (v, i) {
      var y0 = fr.y(0), y1 = fr.y(v);
      var col = opts.diverging ? (v >= 0 ? cssVar('--series-1') : cssVar('--series-8')) : cssVar(SERIES[0]);
      var r = svgEl('rect', { x: fr.x0 + fr.step * i + (fr.step - bw) / 2, y: Math.min(y0, y1),
        width: bw, height: Math.max(1, Math.abs(y1 - y0)), fill: col, rx: 4 });
      r.addEventListener('mousemove', function (ev) {
        showTip('<b>' + esc(labels[i]) + '</b><div class="row"><span>' + esc(opts.name || 'Waarde') +
          '</span><span>' + eur(v) + '</span></div>', ev);
      });
      r.addEventListener('mouseleave', hideTip);
      svg.appendChild(r);
    });
    host.appendChild(svg);
  }

  function hbarChart(host, items, opts) {
    opts = opts || {};
    host.innerHTML = '';
    var rowH = 26, W = host.clientWidth || 640, H = items.length * rowH + 16;
    var max = Math.max.apply(null, items.map(function (i) { return Math.abs(i.value); })) || 1;
    var labW = Math.min(210, Math.max(120, W * .32));
    var svg = svgEl('svg', { width: '100%', height: H, viewBox: '0 0 ' + W + ' ' + H, role: 'img' });
    items.forEach(function (it, i) {
      var y = 8 + i * rowH;
      var t = svgEl('text', { x: labW - 10, y: y + 14, 'text-anchor': 'end', fill: cssVar('--text-secondary'), 'font-size': 12 });
      t.textContent = it.label.length > 30 ? it.label.slice(0, 29) + '…' : it.label;
      svg.appendChild(t);
      var w = Math.abs(it.value) / max * (W - labW - 92);
      var r = svgEl('rect', { x: labW, y: y + 4, width: Math.max(2, w), height: rowH - 12,
        fill: cssVar(SERIES[0]), rx: 4 });
      r.addEventListener('mousemove', function (ev) {
        showTip('<b>' + esc(it.label) + '</b><div class="row"><span>' + esc(opts.name || 'Uitgaven') +
          '</span><span>' + eur(it.value) + '</span></div>' +
          (it.sub ? '<div class="row"><span>' + esc(it.sub) + '</span></div>' : ''), ev);
      });
      r.addEventListener('mouseleave', hideTip);
      svg.appendChild(r);
      var v = svgEl('text', { x: labW + Math.max(2, w) + 8, y: y + 15, fill: cssVar('--text-secondary'),
        'font-size': 11.5, 'font-variant-numeric': 'tabular-nums' });
      v.textContent = eur0(it.value);
      svg.appendChild(v);
    });
    host.appendChild(svg);
  }

  function stackChart(host, labels, series, opts) {
    opts = opts || {};
    host.innerHTML = '';
    var W = host.clientWidth || 640, H = opts.height || 280, pad = { l: 62, r: 14, t: 12, b: 26 };
    var totals = labels.map(function (_, i) {
      return series.reduce(function (a, s) { return a + (s.data[i] > 0 ? s.data[i] : 0); }, 0);
    });
    var ticks = niceTicks(0, Math.max.apply(null, totals), 5);
    var svg = svgEl('svg', { width: '100%', height: H, viewBox: '0 0 ' + W + ' ' + H, role: 'img' });
    var fr = axisFrame(svg, W, H, pad, ticks, labels);
    var bw = Math.max(5, fr.step - 8);
    labels.forEach(function (lb, i) {
      var acc = 0;
      series.forEach(function (s, si) {
        var v = s.data[i] > 0 ? s.data[i] : 0;
        if (!v) return;
        var y1 = fr.y(acc + v), y0 = fr.y(acc);
        var r = svgEl('rect', { x: fr.x0 + fr.step * i + (fr.step - bw) / 2, y: y1, width: bw,
          height: Math.max(1, y0 - y1 - 2), fill: cssVar(SERIES[si % 8]), rx: 2 });
        r.addEventListener('mousemove', function (ev) {
          showTip('<b>' + esc(lb) + '</b><div class="row"><span>' + esc(s.name) + '</span><span>' +
            eur(v) + '</span></div><div class="row"><span>totaal</span><span>' + eur(totals[i]) + '</span></div>', ev);
        });
        r.addEventListener('mouseleave', hideTip);
        svg.appendChild(r);
        acc += v;
      });
    });
    host.appendChild(svg);
  }

  function legend(host, names) {
    host.innerHTML = names.map(function (n, i) {
      return '<span><i style="background:' + cssVar(SERIES[i % 8]) + '"></i>' + esc(n) + '</span>';
    }).join('');
  }

  // ---------------------------------------------------------------- Dashboard
  function renderDashboard() {
    renderDashboardNu();
    renderDashboardPotjes();
    if (!months().length) {
      document.getElementById('tbl-maand').innerHTML =
        '<tbody><tr><td class="muted">' + esc(T('import_files_p')) + '</td></tr></tbody>';
      return;
    }
    renderDashboardKosten();
  }

  // Hoeveel per maand nodig is om een potje op tijd te halen. Kopie van de
  // gelijknamige functie in de pro-module: die draait in haar eigen closure
  // en is van hieruit niet aanspreekbaar, dus het dashboard rekent dit zelf na.
  function dashPotMaand(p) {
    var doel = +p.doel || 0, stand = +p.stand || 0;
    if (!p.datum) return Math.round((doel - stand) / 12);
    var mnd = Math.max(1, Math.round((new Date(p.datum) - new Date()) / 86400000 / 30.4));
    return Math.max(0, Math.round((doel - stand) / mnd));
  }

  // Compact potjes-overzicht op het dashboard: dezelfde drie kerncijfers
  // (samen per maand / al gespaard / nog te gaan) als op het tabblad Potjes,
  // plus hoeveel er per potje nog te gaan is. Alleen zichtbaar met een
  // geldige licentie én minstens één potje.
  function renderDashboardPotjes() {
    var card = document.getElementById('dash-potjes');
    if (!card) return;
    var lijst = S.potjes || [];
    if (!proActief() || !lijst.length) { card.classList.add('hide'); return; }
    card.classList.remove('hide');
    var pm = lijst.reduce(function (a, p) { return a + dashPotMaand(p); }, 0);
    var gespaard = lijst.reduce(function (a, p) { return a + (+p.stand || 0); }, 0);
    var doel = lijst.reduce(function (a, p) { return a + (+p.doel || 0); }, 0);
    document.getElementById('dash-potjes-kpis').innerHTML = [
      { label: T('j_permonth'), v: eur0(pm), sub: T('j_permonth_sub', { n: lijst.length }) },
      { label: T('j_saved'), v: eur0(gespaard), sub: T('j_of', { v: eur0(doel) }) },
      { label: T('j_gap'), v: eur0(Math.max(0, doel - gespaard)), sub: T('j_gap_sub') }
    ].map(function (k) {
      return '<div class="card kpi"><div class="label">' + esc(k.label) + '</div><div class="value">' +
        k.v + '</div><div class="sub">' + esc(k.sub) + '</div></div>';
    }).join('');
    document.getElementById('dash-potjes-body').innerHTML = lijst.map(function (p) {
      var doel = +p.doel || 0, stand = +p.stand || 0;
      var pct = doel > 0 ? Math.min(100, stand / doel * 100) : 0;
      var rest = Math.max(0, doel - stand);
      var rechts = (doel > 0 && rest <= 0)
        ? '<span class="pill ok">' + T('potje_gehaald') + '</span>'
        : '<span class="nowrap"><b>' + eur0(rest) + '</b> <small class="muted">' + T('potje_te_gaan') + '</small></span>';
      return '<div class="rowflex" style="justify-content:space-between; margin:6px 0">' +
        '<span style="min-width:130px">' + esc(p.naam) + '</span>' +
        '<span class="bar-track" style="flex:1; max-width:340px"><span class="bar-fill" style="display:block; width:' +
        pct.toFixed(0) + '%; background:var(--series-1)"></span></span>' +
        '<small class="muted nowrap">' + eur0(stand) + ' / ' + eur0(doel) + '</small>' +
        rechts + '</div>';
    }).join('');
  }

  // Jaarcijfers en jaargrafieken: sinds de herindeling niet meer op het dashboard,
  // maar onderaan het tabblad "Deze maand" onder het kopje "Verloop dit jaar".
  function renderVerloop() {
    var ms = months();
    if (!ms.length) {
      document.getElementById('kpis').innerHTML =
        '<div class="card"><div class="label">' + T('import_files') + '</div><div class="sub">' +
        esc(T('import_files_p')) + '</div></div>';
      ['ch1', 'ch2', 'ch4', 'lg1', 'lg4'].forEach(function (id) {
        var el = document.getElementById(id); if (el) el.innerHTML = '';
      });
      return;
    }
    var jaar = S.settings.jaar || years()[years().length - 1];
    var inkomsten = ms.map(function (m) {
      return budgetTx().reduce(function (a, t) { return a + (t.month === m && t.amount > 0 ? t.amount : 0); }, 0);
    });
    var uitgaven = ms.map(function (m) {
      return budgetTx().reduce(function (a, t) { return a - (t.month === m && t.amount < 0 ? t.amount : 0); }, 0);
    });
    var saldo = ms.map(function (_, i) { return inkomsten[i] - uitgaven[i]; });

    var jm = ms.filter(function (m) { return +m.slice(0, 4) === jaar; });
    var jIn = jm.reduce(function (a, m) { return a + inkomsten[ms.indexOf(m)]; }, 0);
    var jUit = jm.reduce(function (a, m) { return a + uitgaven[ms.indexOf(m)]; }, 0);
    var budgetTotaal = Object.keys(S.budget).reduce(function (a, k) {
      return a + (catSoort(k, catGroep(k)) === 'vast' ? (+S.budget[k] || 0) : 0); }, 0);

    var kpis = [
      { label: T('kpi_income') + ' ' + jaar, v: jIn, sub: T('kpi_months', { n: jm.length }) },
      { label: T('kpi_expenses') + ' ' + jaar, v: jUit, plain: true,
        sub: T('kpi_avg', { v: eur0(jUit / (jm.length || 1)) }) },
      { label: T('kpi_balance') + ' ' + jaar, v: jIn - jUit,
        sub: (jIn - jUit) >= 0 ? T('kpi_surplus') : T('kpi_deficit') },
      { label: T('kpi_budget'), v: budgetTotaal, plain: true,
        sub: T('kpi_budget_sub', { v: eur0(jUit / (jm.length || 1)) }) }
    ];
    var opnJaar = opnameTx().reduce(function (a, t) {
      return a + (t.year === jaar && t.amount < 0 ? -t.amount : 0); }, 0);
    if (opnJaar > 0) {
      var kasJaar = S.manual.reduce(function (a, t) {
        return a + (t.year === jaar && t.amount < 0 ? -t.amount : 0); }, 0);
      kpis.push({ label: T('m_cash_title'), v: opnJaar, plain: true,
        sub: T('m_cash_open') + ': ' + eur0(Math.max(0, opnJaar - kasJaar)) });
    }
    document.getElementById('kpis').innerHTML = kpis.map(function (k) {
      var cls = k.plain ? '' : (k.v >= 0 ? 'pos' : 'neg');
      return '<div class="card kpi"><div class="label">' + esc(k.label) + '</div><div class="value ' +
        cls + '">' + eur0(k.v) + '</div><div class="sub">' + esc(k.sub) + '</div></div>';
    }).join('');

    var labs = ms.map(maandLabel);
    legend(document.getElementById('lg1'), [T('kpi_income'), T('kpi_expenses')]);
    lineChart(document.getElementById('ch1'), labs, [
      { name: T('kpi_income'), data: inkomsten }, { name: T('kpi_expenses'), data: uitgaven }]);
    barChart(document.getElementById('ch2'), labs, saldo, { diverging: true, name: T('kpi_balance') });

    // per hoofdgroep gestapeld, top 7 + overig
    var gsum = {};
    budgetTx().forEach(function (t) {
      if (t.amount < 0 && t.group !== 'Inkomen') gsum[t.group] = (gsum[t.group] || 0) - t.amount;
    });
    var top = Object.keys(gsum).sort(function (a, b) { return gsum[b] - gsum[a]; }).slice(0, 7);
    var series = top.map(function (g) {
      return { name: TG(g), data: ms.map(function (m) {
        return budgetTx().reduce(function (a, t) {
          return a + (t.month === m && t.group === g && t.amount < 0 ? -t.amount : 0); }, 0); }) };
    });
    series.push({ name: T('other_groups'), data: ms.map(function (m) {
      return budgetTx().reduce(function (a, t) {
        return a + (t.month === m && top.indexOf(t.group) < 0 && t.group !== 'Inkomen' && t.amount < 0
          ? -t.amount : 0); }, 0); }) });
    legend(document.getElementById('lg4'), series.map(function (s) { return s.name; }));
    stackChart(document.getElementById('ch4'), labs, series);
  }

  // Bovenaan het dashboard: inkomsten, uitgaven en vrije ruimte van de lopende maand.
  // Dit is de vraag waar de meeste mensen als eerste een antwoord op willen: sta ik
  // er deze maand goed voor. De volledige uitleg staat op het tabblad "Deze maand".
  function renderDashboardNu() {
    var host = document.getElementById('kpis-nu');
    if (!host) return;
    if (!months().length) { host.innerHTML = ''; return; }
    var r = berekenMaand(huidigeMaand());
    document.getElementById('dash-nu-naam').textContent = maandLabel(r.m);
    var kpis = [
      { label: T('kpi_income'), v: r.basis, sub: T('m_income_exp_sub') },
      { label: T('kpi_expenses'), v: r.uitgegeven, plain: true, sub: T('m_day', { d: r.dagNu, n: r.dagenInMaand }) },
      { label: T('m_free_left'), v: r.vrijOver, sub: T('m_free_sub'), help: 'm_hint' }
    ];
    // Sparen staat er alleen bij als er ook echt gespaard is; anders vier kaarten
    // waarvan er één altijd nul is.
    if (r.opzij > 0) {
      kpis.push({ label: T('kpi_aside'), v: r.opzij, plain: true, sub: T('kpi_aside_sub'), help: 'kind_hint' });
    }
    host.innerHTML = kpis.map(function (k) {
      var cls = k.plain ? '' : (k.v >= 0 ? 'pos' : 'neg');
      var help = k.help ? ' data-help="' + esc(k.help) + '"' : '';
      return '<div class="card kpi hero"' + help + '><div class="label">' + esc(k.label) + '</div><div class="value ' +
        cls + '">' + eur0(k.v) + '</div><div class="sub">' + esc(k.sub) + '</div></div>';
    }).join('');
  }

  // Kosten van de komende 30 dagen: de herkende vaste lasten die naar verwachting
  // nog gaan afschrijven, in plaats van een tabel met jaartotalen per maand die
  // hetzelfde zegt als de grafieken hierboven maar dan minder overzichtelijk.
  function renderDashboardKosten() {
    var host = document.getElementById('tbl-maand');
    if (!host) return;
    var vandaag = new Date();
    var grens = new Date(vandaag.getTime() + 30 * 86400000);
    var list;
    try {
      list = detectRecurring().filter(function (r) {
        if (!r.actief) return false;
        var d = new Date(r.volgende);
        return d >= new Date(vandaag.getFullYear(), vandaag.getMonth(), vandaag.getDate()) && d <= grens;
      }).sort(function (a, b) { return a.volgende < b.volgende ? -1 : 1; });
    } catch (e) { list = []; }
    if (!list.length) {
      host.innerHTML = '<tbody><tr><td class="muted">' + T('dash_costs_none') + '</td></tr></tbody>';
      return;
    }
    var totaal = list.reduce(function (a, r) { return a + r.bedrag; }, 0);
    host.innerHTML = '<thead><tr><th>' + T('rec_payee') + '</th><th>' + T('th_category') + '</th><th>' +
      T('rec_next') + '</th><th class="num">' + T('rec_amount') + '</th></tr></thead><tbody>' +
      list.map(function (r) {
        return '<tr><td>' + esc(r.naam) + '</td><td><small>' + esc(TC(r.cat)) + '</small></td>' +
          '<td class="nowrap">' + dmy(r.volgende) + '</td><td class="num">' + eur0(r.bedrag) + '</td></tr>';
      }).join('') +
      '<tr style="font-weight:650;background:var(--plane)"><td colspan="3">' + T('total') + '</td>' +
      '<td class="num">' + eur0(totaal) + '</td></tr></tbody>';
  }

  // ---------------------------------------------------------------- Deze maand
  function huidigeMaand() {
    var d = new Date();
    var m = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
    var ms = months();
    // staat er nog niets in deze maand, dan de laatste maand met gegevens tonen
    return ms.indexOf(m) >= 0 || !ms.length ? m : ms[ms.length - 1];
  }

  // Mediaan in plaats van gemiddelde: één erfenis of bonus hoort een normale maand niet op te blazen.
  function histInkomen() {
    var ms = months().slice(-13, -1);          // laatste 12 volle maanden
    if (!ms.length) ms = months().slice(-12);
    if (!ms.length) return 0;
    var per = ms.map(function (m) {
      return budgetTx().reduce(function (a, t) {
        return a + (t.month === m && t.amount > 0 ? t.amount : 0);
      }, 0);
    });
    return mediaan(per);
  }

  // Kerncijfers voor één maand: verwacht/ontvangen inkomen, begroot, uitgegeven en
  // de vrije ruimte die overblijft. Wordt gebruikt door zowel het dashboard (bovenaan,
  // in het kort) als het tabblad "Deze maand" (helemaal uitgewerkt).
  function berekenMaand(m) {
    var nu = new Date();
    var jaar = +m.slice(0, 4), mnd = +m.slice(5, 7);
    var dagenInMaand = new Date(jaar, mnd, 0).getDate();
    var dagNu = (nu.getFullYear() === jaar && nu.getMonth() + 1 === mnd) ? nu.getDate() : dagenInMaand;

    var tx = budgetTx().filter(function (t) { return t.month === m; });
    var ontvangen = tx.reduce(function (a, t) { return a + (t.amount > 0 ? t.amount : 0); }, 0);
    var uitgegeven = tx.reduce(function (a, t) { return a - (t.amount < 0 ? t.amount : 0); }, 0);
    var verwacht = S.settings.inkomenOverride;
    if (verwacht === undefined || verwacht === null || verwacht === '') verwacht = Math.round(histInkomen());
    verwacht = +verwacht || 0;
    var basis = S.settings.maandBasis === 'act' ? ontvangen : verwacht;

    var perCat = {};
    tx.forEach(function (t) { if (t.amount < 0) perCat[t.cat] = (perCat[t.cat] || 0) - t.amount; });

    var opn = opnameTx().filter(function (t) { return t.month === m && t.amount < 0; })
      .reduce(function (a, t) { return a - t.amount; }, 0);
    var kasGeboekt = S.manual.filter(function (t) { return t.month === m && t.amount < 0; })
      .reduce(function (a, t) { return a - t.amount; }, 0);
    var opnOpen = Math.max(0, opn - kasGeboekt);

    // wat er deze maand naar sparen of beleggen ging: geen uitgave, wel geld dat weg is
    var opzij = spaarTx().filter(function (t) { return t.month === m && t.amount < 0; })
      .reduce(function (a, t) { return a - t.amount; }, 0);

    var cats = catList().filter(function (c) { return c.group !== 'Inkomen'; });
    var begroot = 0, binnenRest = 0, over = 0, vrijUit = 0;
    var vast = [], vrij = [];
    cats.forEach(function (c) {
      var soort = catSoort(c.cat, c.group);
      if (soort === 'opname' || soort === 'sparen') return;
      var u = perCat[c.cat] || 0;
      if (soort === 'vast') {
        var b = +S.budget[c.cat] || 0;
        if (!b && !u) return;
        begroot += b;
        binnenRest += Math.max(0, b - u);
        over += Math.max(0, u - b);
        vast.push({ cat: c.cat, groep: c.group, b: b, u: u });
      } else if (u > 0) {
        vrijUit += u;
        vrij.push({ cat: c.cat, groep: c.group, b: 0, u: u });
      }
    });
    var vrijeRuimte = basis - begroot;
    var vrijOver = vrijeRuimte - vrijUit - over;
    var nogTeBesteden = basis - uitgegeven;

    return { m: m, dagNu: dagNu, dagenInMaand: dagenInMaand, ontvangen: ontvangen, uitgegeven: uitgegeven,
      verwacht: verwacht, basis: basis, opn: opn, kasGeboekt: kasGeboekt, opnOpen: opnOpen, opzij: opzij,
      begroot: begroot, binnenRest: binnenRest, over: over, vrijUit: vrijUit,
      vrijeRuimte: vrijeRuimte, vrijOver: vrijOver, nogTeBesteden: nogTeBesteden, vast: vast, vrij: vrij };
  }

  function renderMaand() {
    var r = berekenMaand(huidigeMaand());
    var m = r.m, dagNu = r.dagNu, dagenInMaand = r.dagenInMaand, ontvangen = r.ontvangen,
      uitgegeven = r.uitgegeven, verwacht = r.verwacht, basis = r.basis, opn = r.opn,
      kasGeboekt = r.kasGeboekt, opnOpen = r.opnOpen, begroot = r.begroot, over = r.over,
      vrijUit = r.vrijUit, vrijeRuimte = r.vrijeRuimte, vrijOver = r.vrijOver,
      nogTeBesteden = r.nogTeBesteden, vast = r.vast, vrij = r.vrij, binnenRest = r.binnenRest;

    document.getElementById('m-kop').textContent = maandLabel(m);
    document.getElementById('m-dag').textContent = T('m_day', { d: dagNu, n: dagenInMaand });

    var kpis = [
      { l: T('m_income_exp'), v: verwacht, sub: T('m_income_exp_sub'), input: true },
      { l: T('m_income_act'), v: ontvangen, sub: maandLabel(m), plain: true },
      { l: T('m_budget'), v: begroot, sub: T('m_within') + ': ' + eur0(binnenRest), plain: true },
      { l: T('m_spent'), v: uitgegeven, sub: T('m_day', { d: dagNu, n: dagenInMaand }), plain: true },
      { l: T('m_left'), v: nogTeBesteden, sub: T('m_free') + ': ' + eur0(vrijeRuimte), big: true },
      { l: T('m_free_left'), v: vrijOver, sub: T('m_free_sub'), big: true }
    ];
    document.getElementById('m-kpis').innerHTML = kpis.map(function (k) {
      var cls = k.plain ? '' : (k.v >= 0 ? 'pos' : 'neg');
      var waarde = k.input
        ? '<input type="number" id="m-inkomen" value="' + Math.round(k.v) + '" step="50" ' +
          'style="width:130px;font-size:20px;font-weight:650;padding:2px 6px">'
        : '<span class="' + cls + '">' + eur0(k.v) + '</span>';
      return '<div class="card kpi"><div class="label">' + esc(k.l) + '</div><div class="value">' +
        waarde + '</div><div class="sub">' + esc(k.sub) + '</div></div>';
    }).join('');
    var inp = document.getElementById('m-inkomen');
    if (inp) inp.addEventListener('change', function () {
      S.settings.inkomenOverride = this.value === '' ? null : +this.value;
      save(); renderMaand();
    });

    document.getElementById('m-uitleg').innerHTML =
      '<span>' + T('m_income_exp') + ' <b>' + eur0(basis) + '</b></span>' +
      '<span class="muted">−</span><span>' + T('m_budget') + ' <b>' + eur0(begroot) + '</b></span>' +
      '<span class="muted">=</span><span>' + T('m_free') + ' <b>' + eur0(vrijeRuimte) + '</b></span>' +
      '<span class="muted">−</span><span>' + T('m_free_spent') + ' <b>' + eur0(vrijUit) + '</b></span>' +
      (over > 0 ? '<span class="pill over">' + T('m_over') + ' ' + eur0(over) + '</span>' : '') +
      '<span class="muted">=</span><span>' + T('m_free_left') + ' <b class="' +
      (vrijOver >= 0 ? 'pos' : 'neg') + '">' + eur0(vrijOver) + '</b></span>' +
      (opn > 0 ? '<span class="pill">' + T('m_cash_title') + ' ' + eur0(opn) +
        (opnOpen > 0 ? ' · ' + T('m_cash_open') + ' ' + eur0(opnOpen) : '') + '</span>' : '');

    vast.sort(function (a, b) { return (b.b ? b.u / b.b : 9) - (a.b ? a.u / a.b : 9); });
    vrij.sort(function (a, b) { return b.u - a.u; });
    function rij(r) {
      var rest = r.b - r.u;
      var pct = r.b ? Math.min(100, Math.round(r.u / r.b * 100)) : 100;
      var kleur = !r.b ? 'var(--muted)' : (rest < 0 ? 'var(--critical)' : 'var(--series-1)');
      return '<tr><td class="nowrap"><span class="muted" style="font-size:11.5px">' + esc(TG(r.groep)) +
        '</span><br>' + esc(TC(r.cat)) + '</td>' +
        '<td class="num">' + (r.b ? eur0(r.b) : '<span class="muted">–</span>') + '</td>' +
        '<td class="num">' + eur0(r.u) + '</td>' +
        '<td class="num ' + (rest < 0 ? 'neg' : '') + '">' + (r.b ? eur0(rest) : '<span class="muted">–</span>') + '</td>' +
        '<td style="width:180px"><div class="bar-track"><div class="bar-fill" style="width:' + pct +
        '%;background:' + kleur + '"></div></div></td></tr>';
    }
    function kop(t) {
      return '<tr><td colspan="5" style="background:var(--accent-soft);font-weight:650;color:var(--series-1)">' +
        esc(t) + '</td></tr>';
    }
    var host = document.getElementById('m-body');
    var body = '';
    if (vast.length) body += kop(T('m_fixed_title')) + vast.map(rij).join('');
    if (vrij.length) body += kop(T('m_free_title')) + vrij.map(rij).join('');
    if (opn > 0) {
      body += kop(T('m_cash_title')) +
        '<tr><td>' + T('m_cash_taken') + '</td><td class="num muted">–</td><td class="num">' + eur0(opn) +
        '</td><td class="num muted">–</td><td></td></tr>' +
        '<tr><td>' + T('m_cash_booked') + '</td><td class="num muted">–</td><td class="num">' + eur0(kasGeboekt) +
        '</td><td class="num muted">–</td><td></td></tr>' +
        '<tr><td style="font-weight:600">' + T('m_cash_open') + '</td><td class="num muted">–</td>' +
        '<td class="num" style="font-weight:600">' + eur0(opnOpen) + '</td><td class="num muted">–</td>' +
        '<td><small class="muted">' + T('m_cash_hint') + '</small></td></tr>';
    }
    host.innerHTML = '<thead><tr><th>' + T('th_category') + '</th><th class="num">' + T('m_cat_budget') +
      '</th><th class="num">' + T('m_cat_spent') + '</th><th class="num">' + T('m_cat_left') +
      '</th><th></th></tr></thead><tbody>' +
      (body || '<tr><td colspan="5" class="muted">' + T('m_none') + '</td></tr>') + '</tbody>';

    renderVerloop();
  }

  // ---------------------------------------------------------------- Budget
  function renderBudget() {
    var jaar = S.settings.jaar || years()[years().length - 1] || new Date().getFullYear();
    var cats = catList().filter(function (c) { return c.group !== 'Inkomen'; });
    var inks = catList().filter(function (c) { return c.group === 'Inkomen'; });
    var host = document.getElementById('budget-body');
    // Standaard zonder de twaalf maandkolommen: dat past zonder opzij te hoeven
    // scrollen. Wie de maand-voor-maand cijfers wil, zet de schakelaar aan.
    var alleMaanden = !!S.settings.budgetAlleMaanden;
    var kolommen = 6 + (alleMaanden ? 12 : 0);
    var mm = [];
    for (var i = 1; i <= 12; i++) mm.push(jaar + '-' + String(i).padStart(2, '0'));

    function rowsFor(list, sign) {
      return list.map(function (c) {
        var per = mm.map(function (m) {
          return budgetTx().reduce(function (a, t) {
            return a + (t.month === m && t.cat === c.cat ? t.amount : 0); }, 0) * sign;
        });
        var tot = per.reduce(function (a, b) { return a + b; }, 0);
        var hist = histAvg(c.cat) * sign;
        var b = S.budget[c.cat];
        var maandVerbruik = per[new Date().getMonth()];
        var pct = b ? Math.min(200, Math.round(maandVerbruik / b * 100)) : null;
        return { c: c, per: per, tot: tot, hist: hist, b: b, pct: pct };
      });
    }
    var uit = rowsFor(cats, -1).sort(function (a, b) { return b.tot - a.tot; });
    var ink = rowsFor(inks, 1).sort(function (a, b) { return b.tot - a.tot; });

    function block(title, rows, sign) {
      if (!rows.length) return '';
      var totB = rows.reduce(function (a, r) {
        return a + (sign > 0 || catSoort(r.c.cat, r.c.group) === 'vast' ? (+r.b || 0) : 0); }, 0);
      var totJ = rows.reduce(function (a, r) { return a + r.tot; }, 0);
      var totH = rows.reduce(function (a, r) { return a + r.hist; }, 0);
      return '<tr class="grp"><td colspan="' + kolommen + '" style="background:var(--accent-soft);font-weight:650;color:var(--series-1)">' +
        esc(title) + '</td></tr>' + rows.map(function (r) {
        var over = r.b && r.per.some(function (v) { return v > r.b * 1.0001; });
        var soort = sign < 0 ? catSoort(r.c.cat, r.c.group) : 'vast';
        var soortSel = sign < 0
          ? '<select class="soort" data-cat="' + esc(r.c.cat) + '" style="font-size:12px;padding:3px 5px">' +
            ['vast', 'vrij', 'opname', 'sparen'].map(function (k) {
              var lbl = { vast: 'kind_fixed', vrij: 'kind_free', opname: 'kind_cash', sparen: 'kind_save' }[k];
              return '<option value="' + k + '"' + (k === soort ? ' selected' : '') + '>' +
                T(lbl) + '</option>';
            }).join('') + '</select>'
          : '';
        return '<tr data-cat="' + esc(r.c.cat) + '"' + (soort === 'vast' ? '' : ' style="opacity:.7"') + '>' +
          '<td class="nowrap"><span class="muted" style="font-size:11.5px">' + esc(TG(r.c.group)) + '</span><br>' + esc(TC(r.c.cat)) + '</td>' +
          '<td data-help="kind_hint">' + soortSel + '</td>' +
          '<td class="num">' + (soort === 'vast'
            ? '<input type="number" step="5" class="bud" data-cat="' + esc(r.c.cat) + '" value="' +
              (r.b === undefined ? '' : r.b) + '" style="width:88px;text-align:right">'
            : '<span class="muted">&ndash;</span>') + '</td>' +
          '<td class="num muted">' + eur0(r.hist) + '</td>' +
          (alleMaanden ? r.per.map(function (v, i) {
            var cls = (r.b && v > r.b * 1.0001) ? ' style="color:var(--critical)"' : '';
            return '<td class="num"' + cls + '>' + (v ? eur0(v) : '<span class="muted">–</span>') + '</td>';
          }).join('') : '') +
          '<td class="num" style="font-weight:600">' + eur0(r.tot) + '</td>' +
          '<td>' + (r.b ? statusPill(r.tot, r.b * 12) : '<span class="muted">–</span>') + '</td></tr>';
      }).join('') +
      '<tr style="font-weight:650;background:var(--plane)"><td>' + esc(T('total_of', { x: title.toLowerCase() })) + '</td><td></td>' +
        '<td class="num">' + eur0(totB) + '</td><td class="num">' + eur0(totH) + '</td>' +
        (alleMaanden ? mm.map(function (_, i) {
          return '<td class="num">' + eur0(rows.reduce(function (a, r) { return a + r.per[i]; }, 0)) + '</td>';
        }).join('') : '') + '<td class="num">' + eur0(totJ) + '</td><td></td></tr>';
    }

    host.innerHTML = '<thead><tr><th>' + T('th_category') + '</th><th data-help="kind_hint">' + T('kind') +
      '</th><th class="num" data-help="help_budget_pm">' + T('th_budget_pm') +
      '</th><th class="num" data-help="help_hist_pm">' + T('th_hist_pm') + '</th>' +
      (alleMaanden ? MONTHS.map(function (m) { return '<th class="num">' + esc(m) + '</th>'; }).join('') : '') +
      '<th class="num">' + T('th_total') + '</th><th>' + T('th_status') + '</th></tr></thead><tbody>' +
      block(T('kpi_expenses'), uit, -1) + (ink.length ? block(T('kpi_income'), ink, 1) : '') + '</tbody>';
    var chk = document.getElementById('chk-alle-maanden');
    if (chk) chk.checked = alleMaanden;

    host.querySelectorAll('select.soort').forEach(function (sel) {
      sel.addEventListener('change', function () {
        S.catType[sel.dataset.cat] = sel.value;
        if (sel.value !== 'vast') delete S.budget[sel.dataset.cat];
        save(); renderBudget(); renderDashboard(); renderMaand();
      });
    });
    host.querySelectorAll('input.bud').forEach(function (inp) {
      inp.addEventListener('change', function () {
        var v = parseFloat(inp.value);
        if (isNaN(v)) delete S.budget[inp.dataset.cat]; else S.budget[inp.dataset.cat] = v;
        save(); renderBudget(); renderDashboard(); renderMaand();
      });
    });
    document.getElementById('bud-jaar').textContent = jaar;
  }

  function statusPill(werkelijk, begroot) {
    if (!begroot) return '<span class="muted">–</span>';
    var p = Math.round(werkelijk / begroot * 100);
    var over = werkelijk > begroot;
    return '<span class="pill ' + (over ? 'over' : 'ok') + '" title="' + p + '% van het jaarbudget">' +
      (over ? '▲ ' : '▼ ') + p + '%</span>';
  }

  function histAvg(cat) {
    var tx = budgetTx().filter(function (t) { return t.cat === cat; });
    if (!tx.length) return 0;
    var ms = {};
    budgetTx().forEach(function (t) { ms[t.month] = 1; });
    var keys = Object.keys(ms).sort().slice(-12);
    var s = tx.reduce(function (a, t) { return a + (keys.indexOf(t.month) >= 0 ? t.amount : 0); }, 0);
    return s / (keys.length || 1);
  }

  function vulBudgetUitHistorie() {
    catList().forEach(function (c) {
      if (c.group === 'Inkomen') return;
      if (catSoort(c.cat, c.group) !== 'vast') { delete S.budget[c.cat]; return; }
      var v = Math.round(-histAvg(c.cat) / 5) * 5;
      if (v >= 10) S.budget[c.cat] = v;
    });
    save(); renderBudget(); renderDashboard();
    flash(T('budget_filled'));
  }

  // ---------------------------------------------------------------- Vaste lasten
  var RITMES = [
    { key: 'int_weekly', dagen: 7, min: 5, max: 9, perJaar: 52 },
    { key: 'int_monthly', dagen: 30.4, min: 24, max: 38, perJaar: 12 },
    { key: 'int_2monthly', dagen: 61, min: 50, max: 72, perJaar: 6 },
    { key: 'int_quarterly', dagen: 91, min: 78, max: 104, perJaar: 4 },
    { key: 'int_halfyearly', dagen: 182, min: 160, max: 205, perJaar: 2 },
    { key: 'int_yearly', dagen: 365, min: 320, max: 400, perJaar: 1 }
  ];

  function mediaan(a) {
    var b = a.slice().sort(function (x, y) { return x - y; });
    var m = Math.floor(b.length / 2);
    return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2;
  }

  // metSparen: ook de vaste overboekingen naar spaar- en beleggingsrekeningen
  // meenemen. Die zijn geen uitgave, maar ze gaan wél van je rekening af — voor
  // een saldoprognose moeten ze dus mee.
  function detectRecurring(metSparen) {
    var groepen = {};
    (metSparen ? budgetTx().concat(spaarTx()) : budgetTx()).forEach(function (t) {
      if (t.amount >= 0) return;                  // alleen uitgaven
      var k = payeeKey(t.desc);
      if (k.length < 4) return;
      (groepen[k] = groepen[k] || []).push(t);
    });
    var uit = [];
    var nu = new Date();
    Object.keys(groepen).forEach(function (k) {
      var g = groepen[k];
      // dubbele boekingen op dezelfde dag samenvoegen
      var dagen = {};
      g.forEach(function (t) { dagen[t.date] = (dagen[t.date] || 0) + t.amount; });
      analyseer(k, g, dagen);
    });

    function analyseer(k, g, dag) {
      var datums = Object.keys(dag).sort();
      if (datums.length < 3) return;
      var gaps = [];
      for (var i = 1; i < datums.length; i++) {
        gaps.push((new Date(datums[i]) - new Date(datums[i - 1])) / 86400000);
      }
      var med = mediaan(gaps);
      var ritme = null;
      RITMES.forEach(function (r) { if (med >= r.min && med <= r.max) ritme = r; });
      if (!ritme) return;
      // regelmaat: minstens twee derde van de tussenpozen dicht bij de mediaan
      var goed = gaps.filter(function (d) { return Math.abs(d - med) <= Math.max(6, med * 0.35); }).length;
      if (goed / gaps.length < 0.66) return;
      var bedragen = datums.map(function (d) { return -dag[d]; });
      // een vaste last heeft een min of meer vast bedrag; boodschappen niet
      var medB = mediaan(bedragen);
      if (medB <= 0) return;
      var dichtbij = bedragen.filter(function (v) { return Math.abs(v - medB) <= Math.max(1, medB * 0.15); }).length;
      if (dichtbij / bedragen.length < 0.7) return;
      var laatste = datums[datums.length - 1];
      var volgende = new Date(new Date(laatste).getTime() + ritme.dagen * 86400000);
      var gem = bedragen.reduce(function (a, b) { return a + b; }, 0) / bedragen.length;
      var actief = (nu - new Date(laatste)) / 86400000 < ritme.dagen * 2.2;
      // prijsontwikkeling: mediaan van de eerste drie tegen de laatste drie
      var eerste = mediaan(bedragen.slice(0, 3)), nu_ = mediaan(bedragen.slice(-3));
      var laatsteTx = g.filter(function (t) { return t.date === laatste; })[0] || g[g.length - 1];
      uit.push({
        key: k, naam: payeeNaam(laatsteTx.desc), vol: laatsteTx.desc, cat: laatsteTx.cat,
        eigenaar: laatsteTx.owner || laatsteTx.account,
        ritme: ritme, n: datums.length, laatste: laatste,
        volgende: volgende.toISOString().slice(0, 10),
        bedrag: medB, gem: gem,
        perJaar: medB * ritme.perJaar, actief: actief,
        verschil: eerste ? (nu_ - eerste) / eerste : 0
      });
    }

    return uit.sort(function (a, b) { return b.perJaar - a.perJaar; });
  }

  function renderRecurring() {
    var list = detectRecurring();
    var actief = list.filter(function (r) { return r.actief; });
    var pm = actief.reduce(function (a, r) { return a + r.perJaar / 12; }, 0);
    document.getElementById('rec-kpis').innerHTML =
      '<div class="card kpi"><div class="label">' + T('kpi_fixed') + '</div><div class="value">' +
      eur0(pm) + '</div><div class="sub">' + T('kpi_fixed_sub', { n: actief.length }) + '</div></div>' +
      '<div class="card kpi"><div class="label">' + T('rec_per_year') + '</div><div class="value">' +
      eur0(pm * 12) + '</div><div class="sub">' + T('rec_active') + '</div></div>';

    var host = document.getElementById('rec-body');
    if (!list.length) { host.innerHTML = '<tbody><tr><td class="muted">' + T('rec_none') + '</td></tr></tbody>'; return; }
    host.innerHTML = '<thead><tr><th>' + T('rec_payee') + '</th><th>' + T('rec_owner') + '</th><th>' + T('th_category') + '</th><th>' +
      T('rec_interval') + '</th><th class="num">' + T('rec_amount') + '</th><th class="num">' + T('rec_avg') +
      '</th><th class="num">' + T('rec_count') + '</th><th>' + T('rec_last') + '</th><th>' + T('rec_next') +
      '</th><th class="num">' + T('rec_per_year') + '</th><th>' + T('rec_status') + '</th></tr></thead><tbody>' +
      list.map(function (r) {
        var pct = Math.round(r.verschil * 100);
        var badge = r.actief
          ? '<span class="pill ok">' + T('rec_active') + '</span>'
          : '<span class="pill">' + T('rec_stopped') + '</span>';
        if (r.actief && Math.abs(pct) >= 8) {
          badge += ' <span class="pill ' + (pct > 0 ? 'over' : 'ok') + '">' +
            T('rec_changed', { v: (pct > 0 ? '+' : '') + pct + '%' }) + '</span>';
        }
        return '<tr' + (r.actief ? '' : ' style="opacity:.55"') + '><td title="' + esc(r.vol) + '">' +
          esc(r.naam) + '</td>' +
          '<td><small>' + esc(r.eigenaar) + '</small></td>' +
          '<td><small>' + esc(TC(r.cat)) + '</small></td>' +
          '<td>' + T(r.ritme.key) + '</td>' +
          '<td class="num">' + eur(r.bedrag) + '</td>' +
          '<td class="num muted">' + eur(r.gem) + '</td>' +
          '<td class="num">' + r.n + '</td>' +
          '<td class="nowrap">' + dmy(r.laatste) + '</td>' +
          '<td class="nowrap">' + (r.actief ? dmy(r.volgende) : '<span class="muted">–</span>') + '</td>' +
          '<td class="num" style="font-weight:600">' + eur0(r.perJaar) + '</td>' +
          '<td class="nowrap">' + badge + '</td></tr>';
      }).join('') + '</tbody>';
  }

  // ---------------------------------------------------------------- volledigheidscontrole
  function renderCheck() {
    var per = {}, nieuwste = '0';
    allTx().forEach(function (t) { if (t.date > nieuwste) nieuwste = t.date; });
    allTx().forEach(function (t) {
      var a = per[t.account] = per[t.account] || { n: 0, ms: {}, min: '9', max: '0' };
      a.n++; a.ms[t.month] = 1;
      if (t.date < a.min) a.min = t.date;
      if (t.date > a.max) a.max = t.date;
    });
    var host = document.getElementById('check-body');
    var keys = Object.keys(per).sort();
    if (!keys.length) { host.innerHTML = ''; return; }
    host.innerHTML = '<thead><tr><th>' + T('check_account') + '</th><th class="num">' + T('check_rows') +
      '</th><th>' + T('check_from') + '</th><th>' + T('check_to') + '</th><th class="num">' + T('check_months') +
      '</th><th>' + T('check_gaps') + '</th></tr></thead><tbody>' +
      keys.map(function (k) {
        var a = per[k];
        var y1 = +a.min.slice(0, 4), m1 = +a.min.slice(5, 7), y2 = +a.max.slice(0, 4), m2 = +a.max.slice(5, 7);
        var gaten = [];
        for (var y = y1, m = m1; y < y2 || (y === y2 && m <= m2); m++) {
          if (m > 12) { m = 1; y++; }
          var key = y + '-' + String(m).padStart(2, '0');
          if (!a.ms[key]) gaten.push(maandLabel(key));
        }
        var achter = Math.round((new Date(nieuwste) - new Date(a.max)) / 86400000);
        if (achter > 31) gaten.push('… ' + dmy(a.max) + ' →');
        return '<tr><td>' + esc(k) + '</td><td class="num">' + a.n + '</td>' +
          '<td class="nowrap">' + dmy(a.min) + '</td><td class="nowrap">' + dmy(a.max) + '</td>' +
          '<td class="num">' + Object.keys(a.ms).length + '</td>' +
          '<td>' + (gaten.length
            ? '<span class="pill over">' + esc(gaten.join(', ')) + '</span>'
            : '<span class="pill ok">' + T('check_ok') + '</span>') + '</td></tr>';
      }).join('') + '</tbody>';
  }

  // ---------------------------------------------------------------- eigen regels beheren
  function renderRules() {
    var host = document.getElementById('rules-body');
    if (!S.userRules.length) {
      host.innerHTML = '<tbody><tr><td class="muted">' + T('rules_none') + '</td></tr></tbody>';
      return;
    }
    var alle = S.tx.concat(S.imported || [], S.manual);
    host.innerHTML = '<thead><tr><th>' + T('rules_pattern') + '</th><th>' + T('rules_cat') +
      '</th><th class="num">' + T('rules_hits') + '</th><th></th></tr></thead><tbody>' +
      S.userRules.map(function (r, i) {
        var n = alle.filter(function (t) { return ruleMatch(r.pat, t.desc); }).length;
        return '<tr><td><code>' + esc(r.pat) + '</code></td><td>' + esc(TC(r.cat)) + '</td>' +
          '<td class="num">' + n + '</td>' +
          '<td class="right"><button class="btn ghost danger rule-del" data-i="' + i + '">' + T('del') + '</button></td></tr>';
      }).join('') + '</tbody>';
    host.querySelectorAll('.rule-del').forEach(function (b) {
      b.addEventListener('click', function () {
        S.userRules.splice(+b.dataset.i, 1);
        save(); renderRules(); renderTx(); renderDashboard(); renderBudget(); renderRecurring();
      });
    });
  }

  function offerRule(desc, cat, group) {
    var pat = payeeKey(desc);
    var box = document.getElementById('rule-offer');
    if (!pat || pat.length < 4) { box.classList.add('hide'); return; }
    box.className = 'note mt';
    box.innerHTML = '<div class="rowflex"><span>' + esc(T('rule_offer', { p: '', c: TC(cat) }).replace('““', '')) + '</span>' +
      '<input type="text" id="rule-pat" value="' + esc(pat) + '" style="min-width:260px">' +
      '<button class="btn primary" id="rule-yes">' + T('rule_make') + '</button>' +
      '<button class="btn ghost" id="rule-no">' + T('rule_only') + '</button></div>';
    document.getElementById('rule-yes').addEventListener('click', function () {
      pat = document.getElementById('rule-pat').value.trim().toUpperCase();
      if (!pat) return;
      S.userRules.unshift({ pat: pat, cat: cat, group: group });
      var n = S.tx.concat(S.imported || [], S.manual)
        .filter(function (t) { return ruleMatch(pat, t.desc); }).length;
      save(); box.classList.add('hide');
      renderRules(); renderTx(); renderDashboard(); renderBudget(); renderRecurring();
      flash(T('rule_made', { n: n }));
    });
    document.getElementById('rule-no').addEventListener('click', function () { box.classList.add('hide'); });
  }

  // ---------------------------------------------------------------- Transacties
  var txFilter = { q: '', cat: '', jaar: '', rek: '' };
  function renderTx() {
    var list = allTx().filter(function (t) {
      if (txFilter.jaar && String(t.year) !== txFilter.jaar) return false;
      if (txFilter.cat && t.cat !== txFilter.cat) return false;
      if (txFilter.rek && t.account !== txFilter.rek) return false;
      if (txFilter.q) {
        var q = txFilter.q.toLowerCase();
        if ((t.desc + ' ' + t.cat + ' ' + t.account).toLowerCase().indexOf(q) < 0) return false;
      }
      return true;
    }).sort(function (a, b) { return a.date < b.date ? 1 : -1; });

    var som = list.reduce(function (a, t) { return a + t.amount; }, 0);
    document.getElementById('tx-count').textContent = T('tx_count', { n: list.length, v: eur(som) });
    var slice = list.slice(0, 600);
    document.getElementById('tx-body').innerHTML =
      '<thead><tr><th>' + T('th_date') + '</th><th>' + T('th_account') + '</th><th>' + T('th_desc') +
      '</th><th class="num">' + T('th_amount') + '</th><th>' + T('th_category') + '</th><th></th></tr></thead><tbody>' +
      slice.map(function (t) {
        var actie = t.splitPart
          ? '<button class="btn ghost split-open" data-id="' + esc(t.splitParent) + '">' + T('split_edit_btn') + '</button>'
          : '<button class="btn ghost split-open" data-id="' + esc(t.id) + '">' + T('split_btn') + '</button>';
        return '<tr data-txrow="' + esc(t.id) + '"><td class="nowrap">' + dmy(t.date) + '</td><td class="nowrap"><small>' + esc(t.account) + '</small></td>' +
          '<td>' + esc(t.desc.slice(0, 90)) + (t.zak ? ' <span class="pill">' + T('business') + '</span>' : '') + '</td>' +
          '<td class="num ' + (t.amount < 0 ? 'neg' : 'pos') + '">' + eur(t.amount) + '</td>' +
          '<td><select class="catsel" data-id="' + esc(t.id) + '"' + (t.splitPart ? ' disabled' : '') + '>' + catOptionsHtml(t.cat) + '</select></td>' +
          '<td class="right">' + actie + '</td></tr>';
      }).join('') + '</tbody>';
    if (list.length > 600) {
      document.getElementById('tx-count').textContent += T('tx_first', { n: 600 });
    }
    document.querySelectorAll('.catsel').forEach(function (sel) {
      sel.addEventListener('change', function () {
        var c = catList().filter(function (x) { return x.cat === sel.value; })[0];
        var grp = c ? c.group : 'Overig';
        S.overrides[sel.dataset.id] = { cat: sel.value, group: grp };
        save(); renderDashboard(); renderRecurring();
        var tx = S.tx.concat(S.imported || [], S.manual)
          .filter(function (t) { return t.id === sel.dataset.id; })[0];
        if (tx) offerRule(tx.desc, sel.value, grp);
      });
    });
    document.querySelectorAll('.split-open').forEach(function (b) {
      b.addEventListener('click', function () { openSplitEditor(b.dataset.id); });
    });

    // Grootste uitgavenposten, berekend over precies de rijen die de filters
    // hierboven overlaten. Zelfde uitsluitingen als budgetTx(): geen zakelijk,
    // geen interne overboekingen, geen contante opnames, geen inkomsten.
    var ch3 = document.getElementById('ch3');
    if (ch3) {
      var per = {};
      list.forEach(function (t) {
        if (t.amount >= 0 || t.group === 'Inkomen' || t.zak ||
            t.group === 'Interne overboeking' || catSoort(t.cat, t.group) === 'opname' ||
            catSoort(t.cat, t.group) === 'sparen') return;
        per[t.cat] = (per[t.cat] || 0) - t.amount;
      });
      var items = Object.keys(per).map(function (c) { return { label: TC(c), value: per[c] }; })
        .sort(function (a, b) { return b.value - a.value; }).slice(0, 14);
      if (items.length) hbarChart(ch3, items, { name: T('kpi_expenses') });
      else ch3.innerHTML = '';
    }
  }

  // ---------------------------------------------------------------- boeking splitsen
  // Eén boeking (bv. een boodschappenbon) verdelen over meerdere categorieën, zonder
  // dat er iets herkend hoeft te worden: de gebruiker vult zelf de bedragen in. Het
  // resultaat wordt in allTx() uitgeklapt naar losse deelboekingen; verder werkt alles
  // (dashboard, budget, prognose, analyse) hier vanzelf mee omdat die allemaal op
  // dezelfde allTx()/budgetTx() lijst rekenen.
  var splitState = {};

  function closeSplitEditor() {
    document.querySelectorAll('tr.split-editor').forEach(function (r) { r.remove(); });
  }

  function openSplitEditor(id) {
    var t = rawTx(id);
    if (!t) return;
    var already = document.querySelector('tr.split-editor[data-for="' + id + '"]');
    closeSplitEditor();
    if (already) return;                              // nogmaals klikken sluit hem weer
    // is deze boeking al gesplitst, dan bestaat de oorspronkelijke rij niet meer in de
    // tabel (die is vervangen door de deelboekingen) — pak dan de laatste deelrij, zodat
    // de editor na de hele groep verschijnt in plaats van nergens.
    var rijen = document.querySelectorAll('tr[data-txrow="' + id + '"], tr[data-txrow^="' + id + '#"]');
    var row = rijen.length ? rijen[rijen.length - 1] : null;
    if (!row) return;
    var bestaand = S.splits[id];
    splitState[id] = bestaand
      ? bestaand.map(function (l) { return Object.assign({}, l); })
      : [{ cat: t.cat, group: t.group, amount: t.amount, desc: '' },
         { cat: t.cat, group: t.group, amount: 0, desc: '' }];
    var tr = document.createElement('tr');
    tr.className = 'split-editor';
    tr.setAttribute('data-for', id);
    tr.innerHTML = '<td colspan="6"></td>';
    row.parentNode.insertBefore(tr, row.nextSibling);
    renderSplitEditor(t);
  }

  function renderSplitEditor(t) {
    var tr = document.querySelector('tr.split-editor[data-for="' + t.id + '"]');
    if (!tr) return;
    var lines = splitState[t.id];
    var som = lines.reduce(function (a, l) { return a + (+l.amount || 0); }, 0);
    var rest = Math.round((t.amount - som) * 100) / 100;
    var klopt = Math.abs(rest) < 0.005;
    tr.querySelector('td').innerHTML =
      '<div class="card mt">' +
        '<div class="rowflex" style="justify-content:space-between">' +
          '<strong>' + T('split_title') + '</strong>' +
          '<span class="muted">' + esc(t.desc.slice(0, 70)) + ' &middot; ' + dmy(t.date) + ' &middot; ' + eur(t.amount) + '</span>' +
        '</div>' +
        '<div id="split-lines">' +
          lines.map(function (l, i) {
            return '<div class="rowflex mt split-line">' +
              '<select class="split-cat" data-i="' + i + '">' + catOptionsHtml(l.cat) + '</select>' +
              '<input type="number" class="split-amt" data-i="' + i + '" step="0.01" value="' + l.amount + '" style="width:110px">' +
              '<input type="text" class="split-desc" data-i="' + i + '" placeholder="' + esc(T('split_desc_ph')) + '" value="' + esc(l.desc || '') + '" style="min-width:160px">' +
              (lines.length > 1 ? '<button class="btn ghost danger split-del-line" data-i="' + i + '">&times;</button>' : '') +
            '</div>';
          }).join('') +
        '</div>' +
        '<div class="rowflex mt">' +
          '<button class="btn" id="split-add">+ ' + T('split_add_line') + '</button>' +
          '<span class="muted' + (klopt ? '' : ' neg') + '" id="split-rest">' + T('split_remaining', { v: eur(rest) }) + '</span>' +
        '</div>' +
        '<div class="rowflex mt">' +
          '<button class="btn primary" id="split-save"' + (klopt ? '' : ' disabled') + '>' + T('split_save') + '</button>' +
          '<button class="btn ghost" id="split-cancel">' + T('split_cancel') + '</button>' +
          (S.splits[t.id] ? '<button class="btn ghost danger" id="split-remove">' + T('split_remove') + '</button>' : '') +
        '</div>' +
      '</div>';

    tr.querySelectorAll('.split-cat').forEach(function (sel) {
      sel.addEventListener('change', function () {
        var c = catList().filter(function (x) { return x.cat === sel.value; })[0];
        splitState[t.id][+sel.dataset.i].cat = sel.value;
        splitState[t.id][+sel.dataset.i].group = c ? c.group : 'Overig';
      });
    });
    tr.querySelectorAll('.split-desc').forEach(function (inp) {
      inp.addEventListener('change', function () { splitState[t.id][+inp.dataset.i].desc = inp.value; });
    });
    tr.querySelectorAll('.split-amt').forEach(function (inp) {
      inp.addEventListener('input', function () {
        splitState[t.id][+inp.dataset.i].amount = parseFloat(String(inp.value).replace(',', '.')) || 0;
        var s2 = splitState[t.id].reduce(function (a, l) { return a + (+l.amount || 0); }, 0);
        var r2 = Math.round((t.amount - s2) * 100) / 100;
        var ok2 = Math.abs(r2) < 0.005;
        var restEl = tr.querySelector('#split-rest');
        restEl.textContent = T('split_remaining', { v: eur(r2) });
        restEl.className = 'muted' + (ok2 ? '' : ' neg');
        tr.querySelector('#split-save').disabled = !ok2;
      });
    });
    var addBtn = tr.querySelector('#split-add');
    if (addBtn) addBtn.addEventListener('click', function () {
      splitState[t.id].push({ cat: t.cat, group: t.group, amount: 0, desc: '' });
      renderSplitEditor(t);
    });
    tr.querySelectorAll('.split-del-line').forEach(function (b) {
      b.addEventListener('click', function () {
        splitState[t.id].splice(+b.dataset.i, 1);
        renderSplitEditor(t);
      });
    });
    var saveBtn = tr.querySelector('#split-save');
    if (saveBtn) saveBtn.addEventListener('click', function () { splitOpslaan(t); });
    var cancelBtn = tr.querySelector('#split-cancel');
    if (cancelBtn) cancelBtn.addEventListener('click', function () { delete splitState[t.id]; closeSplitEditor(); });
    var removeBtn = tr.querySelector('#split-remove');
    if (removeBtn) removeBtn.addEventListener('click', function () { splitVerwijderen(t.id); });
  }

  function splitOpslaan(t) {
    var lines = splitState[t.id]
      .map(function (l) { return { cat: l.cat, group: l.group, amount: Math.round((+l.amount || 0) * 100) / 100, desc: (l.desc || '').trim() }; })
      .filter(function (l) { return l.amount !== 0; });
    if (!lines.length) { flash(T('split_need'), true); return; }
    S.splits[t.id] = lines;
    delete S.overrides[t.id];       // de splitsing vervangt een eventuele eerdere categorie-override
    delete splitState[t.id];
    save(); closeSplitEditor();
    renderTx(); renderDashboard(); renderBudget(); renderRecurring();
    flash(T('split_saved'));
  }

  function splitVerwijderen(id) {
    delete S.splits[id];
    delete splitState[id];
    save(); closeSplitEditor();
    renderTx(); renderDashboard(); renderBudget(); renderRecurring();
    flash(T('split_removed'));
  }

  function fillFilters() {
    var sel = document.getElementById('f-cat');
    var huidCat = sel.value;
    sel.innerHTML = '<option value="">' + T('all_cats') + '</option>' + catOptionsHtml(huidCat);
    sel.value = huidCat;
    var sj = document.getElementById('f-jaar');
    sj.innerHTML = '<option value="">' + T('all_years') + '</option>' +
      years().map(function (y) { return '<option>' + y + '</option>'; }).join('');
    var sr = document.getElementById('f-rek');
    var reks = {}; allTx().forEach(function (t) { reks[t.account] = 1; });
    sr.innerHTML = '<option value="">' + T('all_accounts') + '</option>' +
      Object.keys(reks).sort().map(function (r) { return '<option>' + esc(r) + '</option>'; }).join('');
    var bj = document.getElementById('sel-jaar');
    var ys = years();
    if (!ys.length) ys = [new Date().getFullYear()];
    bj.innerHTML = ys.map(function (y) { return '<option>' + y + '</option>'; }).join('');
    bj.value = S.settings.jaar || ys[ys.length - 1];
  }

  // ---------------------------------------------------------------- Kas
  function renderKas() {
    var host = document.getElementById('kas-body');
    host.innerHTML = '<thead><tr><th>' + T('th_date') + '</th><th>' + T('th_desc') + '</th><th class="num">' +
      T('th_amount') + '</th><th>' + T('th_category') + '</th><th></th></tr></thead><tbody>' +
      (S.manual.length ? S.manual.slice().sort(function (a, b) { return a.date < b.date ? 1 : -1; }).map(function (t) {
        return '<tr><td>' + dmy(t.date) + '</td><td>' + esc(t.desc) + '</td>' +
          '<td class="num ' + (t.amount < 0 ? 'neg' : 'pos') + '">' + eur(t.amount) + '</td>' +
          '<td>' + esc(TC(t.cat)) + '</td>' +
          '<td class="right"><button class="btn ghost danger del" data-id="' + esc(t.id) + '">' + T('del') + '</button></td></tr>';
      }).join('') : '<tr><td colspan="5" class="muted">' + T('cash_none') + '</td></tr>') + '</tbody>';
    host.querySelectorAll('.del').forEach(function (b) {
      b.addEventListener('click', function () {
        S.manual = S.manual.filter(function (x) { return x.id !== b.dataset.id; });
        save(); renderKas(); renderDashboard(); renderBudget();
      });
    });
    var sel = document.getElementById('kas-cat');
    var huidCat = sel.value;
    sel.innerHTML = catOptionsHtml(huidCat);
    if (huidCat) sel.value = huidCat;
    var dsel = document.getElementById('d-cat');
    if (dsel) {
      var huidD = dsel.value;
      dsel.innerHTML = catOptionsHtml(huidD);
      if (huidD) dsel.value = huidD;
    }
  }

  // Gedeeld door het Kas-tabblad ('kas-') en de Snel invoeren-kaart op het
  // dashboard ('d-'): zelfde velden, zelfde controle, zelfde opslag.
  function voegBoekingToe(p) {
    var d = document.getElementById(p + 'datum').value;
    var o = document.getElementById(p + 'oms').value.trim();
    var b = parseFloat(String(document.getElementById(p + 'bedrag').value).replace(',', '.'));
    var c = document.getElementById(p + 'cat').value;
    var soort = document.getElementById(p + 'soort').value;
    if (!d || isNaN(b)) { flash(T('cash_need'), true); return; }
    b = Math.abs(b) * (soort === 'uit' ? -1 : 1);
    var g = (catList().filter(function (x) { return x.cat === c; })[0] || {}).group || 'Overig';
    S.manual.push({ id: 'm' + Date.now() + Math.random().toString(36).slice(2, 6), date: d,
      month: d.slice(0, 7), year: +d.slice(0, 4), account: 'Kas', owner: '', bank: 'Kas',
      desc: o || T('cash_add_title'), amount: Math.round(b * 100) / 100, group: g, cat: c,
      zak: false, src: 'kas' });
    save();
    document.getElementById(p + 'oms').value = ''; document.getElementById(p + 'bedrag').value = '';
    renderKas(); renderDashboard(); renderBudget();
    flash(T('cash_added'));
  }

  function addKas() { voegBoekingToe('kas-'); }

  // ---------------------------------------------------------------- Import
  function categorize(desc) {
    var n = desc.toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    for (var i = 0; i < rulesData.rules.length; i++) {
      var r = rulesData.rules[i];
      for (var j = 0; j < r.pat.length; j++) {
        try { if (new RegExp(r.pat[j]).test(n)) return { group: r.groep, cat: r.cat }; }
        catch (e) { /* patroon niet geldig in deze browser: overslaan */ }
      }
    }
    return { group: 'Overig', cat: 'Nog te categoriseren' };
  }
  function isIntern(desc) {
    var n = desc.toUpperCase().replace(/\s/g, '');
    return rulesData.eigenRekeningen.concat(rulesData.internPatronen).some(function (p) {
      return n.indexOf(p.replace(/\s/g, '')) > -1;
    });
  }

  var pending = [];
  function stage(rows, bron) {
    var known = {};
    allTx().forEach(function (t) { known[txId(t)] = 1; });
    var add = [], dup = 0;
    rows.forEach(function (r) {
      if (!r.date || isNaN(r.amount)) return;
      var t = {
        id: 'i' + r.date + '-' + Math.abs(r.amount) + '-' + Math.random().toString(36).slice(2, 7),
        date: r.date, month: r.date.slice(0, 7), year: +r.date.slice(0, 4),
        account: r.account || bron, owner: r.owner || '', bank: r.bank || bron,
        desc: P.clean(r.desc), amount: Math.round(r.amount * 100) / 100, zak: false, src: 'import'
      };
      if (known[txId(t)]) { dup++; return; }
      var c = isIntern(t.desc) ? { group: 'Interne overboeking', cat: 'Interne overboeking' } : categorize(t.desc);
      t.group = c.group; t.cat = c.cat;
      add.push(t);
    });
    pending = add;
    var host = document.getElementById('preview');
    if (!add.length) {
      host.innerHTML = '<div class="note warn">' + T('found_none') +
        (dup ? T('found_none_dup', { n: dup }) : T('found_none_hint')) + '</div>';
      document.getElementById('btn-commit').classList.add('hide');
      return;
    }
    var som = add.reduce(function (a, t) { return a + t.amount; }, 0);
    host.innerHTML = '<div class="note ok"><b>' + T('found', { n: add.length }) + '</b>' +
      (dup ? T('found_dup', { n: dup }) : '') + ' · ' + eur(som) +
      ' · ' + dmy(add[add.length - 1].date) + ' – ' + dmy(add[0].date) + '</div>' +
      '<div class="scroll mt"><table><thead><tr><th>' + T('th_date') + '</th><th>' + T('th_desc') +
      '</th><th class="num">' + T('th_amount') + '</th><th>' + T('th_category') + '</th></tr></thead><tbody>' +
      add.slice(0, 120).map(function (t) {
        return '<tr><td class="nowrap">' + dmy(t.date) + '</td><td>' + esc(t.desc.slice(0, 80)) + '</td><td class="num ' +
          (t.amount < 0 ? 'neg' : 'pos') + '">' + eur(t.amount) + '</td><td><small>' + esc(TC(t.cat)) + '</small></td></tr>';
      }).join('') + '</tbody></table></div>';
    document.getElementById('btn-commit').classList.remove('hide');
  }

  function commit() {
    S.imported = (S.imported || []).concat(pending);
    pending = [];
    save(); fillFilters(); renderDashboard(); renderBudget(); renderTx();
    renderRecurring(); renderCheck(); renderRules();
    document.getElementById('preview').innerHTML = '<div class="note ok">' + T('committed') + '</div>';
    document.getElementById('btn-commit').classList.add('hide');
  }

  function readPdf(file) {
    var st = document.getElementById('preview');
    if (!window.pdfjsLib) {
      st.innerHTML = '<div class="note warn">Voor het lezen van pdf-bestanden is de bibliotheek pdf.js nodig. ' +
        'Die wordt bij het openen van de pagina van een cdn geladen; zonder internet werkt pdf-import niet. ' +
        'Csv, Excel en plakken werken wel offline.</div>';
      return;
    }
    st.innerHTML = '<div class="note">' + esc(T('reading', { f: file.name })) + '</div>';
    var fr = new FileReader();
    fr.onload = function () {
      pdfjsLib.getDocument({ data: new Uint8Array(fr.result) }).promise.then(function (pdf) {
        var pages = [];
        var chain = Promise.resolve();
        for (var i = 1; i <= pdf.numPages; i++) {
          (function (n) {
            chain = chain.then(function () {
              return pdf.getPage(n).then(function (pg) { return pg.getTextContent(); })
                .then(function (tc) { pages.push(P.pageToLines(tc.items)); });
            });
          })(i);
        }
        return chain.then(function () {
          var res = P.detectAndParse(pages, file.name);
          if (res.warning) st.innerHTML = '<div class="note warn">' + esc(res.warning) + '</div>';
          stage(res.rows, res.bank);
        });
      }).catch(function (e) {
        st.innerHTML = '<div class="note warn">' + esc(T('pdf_failed', { e: e.message })) + '</div>';
      });
    };
    fr.readAsArrayBuffer(file);
  }

  function readSheet(file) {
    if (!window.XLSX) {
      document.getElementById('preview').innerHTML =
        '<div class="note warn">Voor Excel-bestanden is de bibliotheek SheetJS nodig; die wordt van een cdn geladen. ' +
        'Sla het bestand op als csv om zonder internet te importeren.</div>';
      return;
    }
    var fr = new FileReader();
    fr.onload = function () {
      var wb = XLSX.read(new Uint8Array(fr.result), { type: 'array', cellDates: true });
      var aoa = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true });
      var amex = P.parseAmex(aoa);
      if (amex) { stage(amex, 'American Express'); return; }
      var r = P.fromTable(aoa, {});
      if (r.error) document.getElementById('preview').innerHTML = '<div class="note warn">' + esc(r.error) + '</div>';
      else stage(r.rows, file.name.replace(/\.[^.]+$/, ''));
    };
    fr.readAsArrayBuffer(file);
  }

  function readCsv(file) {
    var fr = new FileReader();
    fr.onload = function () {
      // Banken exporteren soms Windows-1252 in plaats van UTF-8. Eerst strikt
      // UTF-8 proberen; mislukt dat, dan Windows-1252 — zo raken é/ë/ü nooit
      // verminkt (en blijven automatische regels op namen gewoon werken).
      var txt;
      try { txt = new TextDecoder('utf-8', { fatal: true }).decode(fr.result); }
      catch (e) { txt = new TextDecoder('windows-1252').decode(fr.result); }
      var ing = P.parseIngCsv(txt);
      if (ing) { stage(ing, 'ING'); return; }
      var abn = P.parseAbnTxt(txt);
      if (abn) { stage(abn, 'ABN AMRO'); return; }
      var r = P.fromTable(P.splitCSV(txt), {});
      if (r.error) document.getElementById('preview').innerHTML = '<div class="note warn">' + esc(r.error) + '</div>';
      else stage(r.rows, file.name.replace(/\.[^.]+$/, ''));
    };
    fr.readAsArrayBuffer(file);
  }

  function readXml(file) {
    var fr = new FileReader();
    fr.onload = function () {
      var txt;
      try { txt = new TextDecoder('utf-8', { fatal: true }).decode(fr.result); }
      catch (e) { txt = new TextDecoder('windows-1252').decode(fr.result); }
      var rows = P.parseCamt(txt);
      if (rows) stage(rows, rows[0].bank || 'CAMT');
      else document.getElementById('preview').innerHTML = '<div class="note warn">' + esc(T('xml_failed')) + '</div>';
    };
    fr.readAsArrayBuffer(file);
  }

  function handleFiles(files) {
    Array.prototype.forEach.call(files, function (f) {
      var n = f.name.toLowerCase();
      if (n.endsWith('.pdf')) readPdf(f);
      else if (/\.(xlsx|xlsm|xls)$/.test(n)) readSheet(f);
      else if (/\.(csv|tsv|txt)$/.test(n)) readCsv(f);
      else if (n.endsWith('.xml')) readXml(f);
      else if (n.endsWith('.json')) importJson(f);
      else flash(T('unsupported', { f: f.name }), true);
    });
  }

  // ---------------------------------------------------------------- back-up
  function exportJson() {
    var blob = new Blob([JSON.stringify({
      versie: 1, gemaakt: new Date().toISOString(),
      budget: S.budget, overrides: S.overrides, manual: S.manual, userRules: S.userRules,
      catType: S.catType, potjes: S.potjes || [], investeringen: S.investeringen || [],
      imported: S.imported || [], settings: S.settings, splits: S.splits || {},
      leningen: S.leningen || []
    }, null, 1)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'huishoudboekje-backup-' + new Date().toISOString().slice(0, 10) + '.json';
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }

  function exportCsv() {
    var head = [T('th_date'), T('th_account'), 'Bank', 'Owner', T('th_desc'), T('th_amount'),
                'Group', T('th_category'), T('business')];
    var lines = [head.join(';')].concat(allTx().sort(function (a, b) { return a.date < b.date ? -1 : 1; })
      .map(function (t) {
        return [t.date, t.account, t.bank, t.owner, '"' + t.desc.replace(/"/g, '""') + '"',
          String(t.amount).replace('.', ','), TG(t.group), TC(t.cat), t.zak ? '1' : '0'].join(';');
      }));
    var blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'transacties.csv';
    a.click();
  }

  function importJson(file) {
    var fr = new FileReader();
    fr.onload = function () {
      try {
        var d = JSON.parse(fr.result);
        S.budget = d.budget || S.budget; S.overrides = d.overrides || {};
        S.splits = d.splits || {};
        S.manual = d.manual || []; S.imported = d.imported || [];
        S.userRules = d.userRules || [];
        S.catType = d.catType || {};
        S.potjes = d.potjes || [];
        S.investeringen = d.investeringen || S.investeringen || [];
        if (Object.prototype.hasOwnProperty.call(d, 'leningen')) S.leningen = d.leningen || [];
        S.settings = Object.assign(S.settings, d.settings || {});
        save(); fillFilters(); renderAll();
        flash(T('backup_loaded'));
      } catch (e) { flash(T('backup_failed'), true); }
    };
    fr.readAsText(file);
  }

  // ---------------------------------------------------------------- Leningen
  // Leningen vul je hier zelf in: naam, bedrag, rente per jaar en looptijd in
  // maanden. Ze staan in je eigen opslag, net als de rest — er gaat niets naar
  // buiten. Laat je de looptijd op nul, dan geldt de lening als aflossingsvrij:
  // er wordt dan alleen rente bijgeschreven vanaf de startdatum.
  function leningCijfers(l) {
    var hoofdsom = +l.hoofdsom || 0;
    var i = (+l.pct || 0) / 100 / 12;                    // rente per maand
    var n = Math.max(0, Math.round(+l.maanden || 0));    // looptijd in maanden
    var start = new Date((l.start || new Date().toISOString().slice(0, 10)) + 'T00:00:00');
    var maandenOm = Math.floor((new Date() - start) / 86400000 / 30.4375);
    var r = { n: n, termijn: 0, renteTotaal: 0, verstreken: Math.max(0, maandenOm), rest: hoofdsom, eind: null };
    if (!n) {                                            // aflossingsvrij
      var dagen = Math.max(0, (new Date() - start) / 86400000);
      r.renteTotaal = hoofdsom * ((+l.pct || 0) / 100) * dagen / 365 + (+l.renteCum || 0);
      r.rest = hoofdsom + r.renteTotaal;
      return r;
    }
    r.termijn = i ? (hoofdsom * i) / (1 - Math.pow(1 + i, -n)) : hoofdsom / n;
    r.renteTotaal = r.termijn * n - hoofdsom;
    var k = Math.min(r.verstreken, n);
    r.rest = i
      ? hoofdsom * Math.pow(1 + i, k) - r.termijn * (Math.pow(1 + i, k) - 1) / i
      : hoofdsom - r.termijn * k;
    if (r.rest < 0.005) r.rest = 0;
    var e = new Date(Date.UTC(start.getFullYear(), start.getMonth(), start.getDate()));
    e.setUTCMonth(e.getUTCMonth() + n);
    r.eind = e.toISOString().slice(0, 10);
    return r;
  }

  function renderLeningen() {
    var host = document.getElementById('len-body');
    if (!host) return;
    var L = S.leningen || [];
    var totaal = 0;
    host.innerHTML = L.length ? L.map(function (l) {
      var r = leningCijfers(l);
      totaal += r.rest;
      var rijen =
        '<tr><td>' + T('principal') + '</td><td class="num">' + eur(l.hoofdsom) + '</td></tr>' +
        '<tr><td>' + T('loan_rate') + '</td><td class="num">' + pctTekst(l.pct) + '</td></tr>';
      if (r.n) {
        rijen +=
          '<tr><td>' + T('loan_term') + '</td><td class="num">' + T('loan_months', { n: r.n }) + '</td></tr>' +
          '<tr><td>' + T('loan_monthly') + '</td><td class="num">' + eur(r.termijn) + '</td></tr>' +
          '<tr><td>' + T('loan_interest_total') + '</td><td class="num">' + eur(r.renteTotaal) + '</td></tr>' +
          '<tr><td>' + T('loan_paid') + '</td><td class="num">' +
            T('loan_of_months', { k: Math.min(r.verstreken, r.n), n: r.n }) + '</td></tr>' +
          '<tr><td>' + T('loan_end') + '</td><td class="num">' + dmy(r.eind) + '</td></tr>';
      } else {
        rijen +=
          '<tr><td>' + T('loan_term') + '</td><td class="num">' + T('loan_interest_only') + '</td></tr>' +
          '<tr><td>' + T('accrued') + '</td><td class="num">' + eur(r.renteTotaal) + '</td></tr>';
      }
      rijen += '<tr style="font-weight:650"><td>' + T('loan_outstanding') + '</td><td class="num">' + eur(r.rest) + '</td></tr>';
      return '<div class="card mt">' +
        '<div class="rowflex" style="justify-content:space-between;align-items:center">' +
        '<h2 style="margin:0">' + esc(l.naam) + '</h2>' +
        '<button class="btn ghost danger len-del" data-id="' + esc(l.id) + '">' + T('del') + '</button></div>' +
        (l.toelichting ? '<p>' + esc(l.toelichting) + '</p>' : '') +
        '<table class="mt"><tbody>' + rijen + '</tbody></table></div>';
    }).join('') : '<div class="note mt">' + T('loans_none') + '</div>';
    document.getElementById('len-totaal').textContent = eur(totaal);
    host.querySelectorAll('.len-del').forEach(function (b) {
      b.addEventListener('click', function () {
        S.leningen = (S.leningen || []).filter(function (x) { return x.id !== b.dataset.id; });
        save(); renderLeningen();
      });
    });
  }

  function pctTekst(p) {
    var v = +p || 0;
    try { return v.toLocaleString(locale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' %'; }
    catch (e) { return v.toFixed(2) + ' %'; }
  }

  function addLening() {
    var naam = String(document.getElementById('len-naam').value || '').trim();
    var bedrag = parseFloat(document.getElementById('len-bedrag').value) || 0;
    if (!naam || !bedrag) { flash(T('loan_need_name'), true); return; }
    S.leningen = S.leningen || [];
    S.leningen.push({
      id: 'l' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
      naam: naam,
      hoofdsom: bedrag,
      pct: parseFloat(document.getElementById('len-rente').value) || 0,
      maanden: Math.max(0, Math.round(parseFloat(document.getElementById('len-maanden').value) || 0)),
      start: document.getElementById('len-start').value || new Date().toISOString().slice(0, 10),
      renteCum: 0,
      toelichting: ''
    });
    document.getElementById('len-naam').value = '';
    document.getElementById('len-bedrag').value = '';
    save(); renderLeningen();
  }

  // ---------------------------------------------------------------- Investeringen
  // Bezit naast de betaalrekeningen: aandelen, fysiek goud of zilver, crypto, etc.
  // De app haalt nooit koersen op — dat zou een internetverbinding vergen, en dit
  // programma legt er bewust geen. Je vult zelf de huidige waarde in, net als bij
  // de leningen hierboven; zie het als een momentopname die je af en toe bijwerkt.
  var INVEST_TYPES = ['aandelen', 'goud', 'zilver', 'crypto', 'overig'];

  // Wat je opzij zet staat niet als uitgave in je cijfers, maar het is er wel.
  // Hier komt het terug, naast je beleggingen, zodat je je hele vermogen ziet.
  function renderInvestSparen() {
    var card = document.getElementById('inv-auto');
    if (!card) return;
    var jaar = +(S.settings.jaar || new Date().getFullYear());
    var rijen = spaarPerCat(jaar);
    if (!rijen.length) { card.classList.add('hide'); return 0; }
    card.classList.remove('hide');
    document.getElementById('inv-auto-body').innerHTML =
      '<thead><tr><th>' + T('th_category') + '</th><th class="num">' + T('inv_auto_total') +
      '</th><th class="num">' + T('inv_auto_year') + '</th><th class="num">' + T('inv_auto_count') +
      '</th><th>' + T('inv_auto_last') + '</th></tr></thead><tbody>' +
      rijen.map(function (r) {
        return '<tr><td>' + esc(TC(r.cat)) + '</td>' +
          '<td class="num" style="font-weight:600">' + eur0(r.tot) + '</td>' +
          '<td class="num">' + (r.jaar ? eur0(r.jaar) : '<span class="muted">–</span>') + '</td>' +
          '<td class="num">' + r.n + '</td>' +
          '<td class="nowrap">' + (r.laatste ? dmy(r.laatste) : '<span class="muted">–</span>') + '</td></tr>';
      }).join('') + '</tbody>';
    return rijen.reduce(function (a, r) { return a + r.tot; }, 0);
  }

  function renderInvesteringen() {
    var host = document.getElementById('inv-body');
    if (!host) return;
    var opzij = renderInvestSparen() || 0;
    var lijst = (S.investeringen || []).slice().sort(function (a, b) { return (b.waarde || 0) - (a.waarde || 0); });
    var totWaarde = lijst.reduce(function (a, i) { return a + (+i.waarde || 0); }, 0);
    var totInleg = lijst.reduce(function (a, i) { return a + (+i.inleg || 0); }, 0);
    var resultaat = totWaarde - totInleg;
    document.getElementById('inv-kpis').innerHTML = [
      { l: T('inv_total_value'), v: totWaarde, plain: true },
      { l: T('inv_total_cost'), v: totInleg, plain: true },
      { l: T('inv_result'), v: resultaat, sub: totInleg ? (Math.round(resultaat / totInleg * 1000) / 10) + '%' : '' }
    ].concat(opzij > 0 ? [{ l: T('inv_saved'), v: opzij, plain: true, sub: T('inv_saved_sub') }] : []).map(function (k) {
      var cls = k.plain ? '' : (k.v >= 0 ? 'pos' : 'neg');
      return '<div class="card kpi"><div class="label">' + esc(k.l) + '</div><div class="value ' + cls + '">' +
        eur0(k.v) + '</div><div class="sub">' + esc(k.sub || '') + '</div></div>';
    }).join('');

    if (!lijst.length) {
      host.innerHTML = '<tbody><tr><td class="muted">' + T('inv_none') + '</td></tr></tbody>';
      return;
    }
    host.innerHTML = '<thead><tr><th>' + T('inv_type') + '</th><th>' + T('inv_name') + '</th>' +
      '<th class="num">' + T('inv_qty') + '</th><th class="num">' + T('inv_cost') + '</th>' +
      '<th class="num">' + T('inv_value') + '</th><th class="num">' + T('inv_pl') + '</th>' +
      '<th>' + T('th_date') + '</th><th></th></tr></thead><tbody>' +
      lijst.map(function (i) {
        var pl = (+i.waarde || 0) - (+i.inleg || 0);
        return '<tr><td>' + T('inv_type_' + i.type) + '</td><td>' + esc(i.naam) +
          (i.notitie ? '<br><small class="muted">' + esc(i.notitie) + '</small>' : '') + '</td>' +
          '<td class="num">' + (i.aantal ? esc(i.aantal) : '<span class="muted">–</span>') + '</td>' +
          '<td class="num">' + (i.inleg ? eur0(i.inleg) : '<span class="muted">–</span>') + '</td>' +
          '<td class="num" style="font-weight:600">' + eur0(i.waarde) + '</td>' +
          '<td class="num ' + (pl >= 0 ? 'pos' : 'neg') + '">' + (i.inleg ? eur0(pl) : '<span class="muted">–</span>') + '</td>' +
          '<td class="nowrap">' + (i.datum ? dmy(i.datum) : '<span class="muted">–</span>') + '</td>' +
          '<td class="right"><button class="btn ghost danger inv-del" data-id="' + esc(i.id) + '">' + T('del') + '</button></td></tr>';
      }).join('') + '</tbody>';
    host.querySelectorAll('.inv-del').forEach(function (b) {
      b.addEventListener('click', function () {
        S.investeringen = (S.investeringen || []).filter(function (x) { return x.id !== b.dataset.id; });
        save(); renderInvesteringen();
      });
    });
  }

  function fillInvestTypeSelect() {
    var sel = document.getElementById('inv-type');
    if (!sel) return;
    sel.innerHTML = INVEST_TYPES.map(function (t) {
      return '<option value="' + t + '">' + T('inv_type_' + t) + '</option>';
    }).join('');
  }

  function addInvestering() {
    var naam = document.getElementById('inv-naam').value.trim();
    var waarde = parseFloat(String(document.getElementById('inv-waarde').value).replace(',', '.'));
    if (!naam || isNaN(waarde)) { flash(T('inv_need'), true); return; }
    S.investeringen = S.investeringen || [];
    S.investeringen.push({
      id: 'v' + Date.now() + Math.random().toString(36).slice(2, 6),
      type: document.getElementById('inv-type').value,
      naam: naam,
      aantal: document.getElementById('inv-aantal').value.trim(),
      inleg: parseFloat(String(document.getElementById('inv-inleg').value).replace(',', '.')) || 0,
      waarde: waarde,
      datum: document.getElementById('inv-datum').value || null,
      notitie: document.getElementById('inv-notitie').value.trim()
    });
    save();
    ['inv-naam', 'inv-aantal', 'inv-inleg', 'inv-waarde', 'inv-notitie'].forEach(function (id) {
      document.getElementById(id).value = '';
    });
    renderInvesteringen();
    flash(T('cash_added'));
  }

  // ---------------------------------------------------------------- init
  function applyI18n() {
    buildMonths();
    var ui = I18N.UI[LANG] || {};
    document.documentElement.lang = LANG;
    document.title = ui._title || 'Huishoudboekje';
    document.querySelectorAll('[data-i18n]').forEach(function (el) {
      el.textContent = T(el.getAttribute('data-i18n'));
    });
    document.querySelectorAll('[data-i18n-ph]').forEach(function (el) {
      el.placeholder = T(el.getAttribute('data-i18n-ph'));
    });
    document.getElementById('sel-lang').value = LANG;
    document.getElementById('sel-cur').value = CUR;
  }

  function fillLangPicker() {
    var sl = document.getElementById('sel-lang');
    sl.innerHTML = I18N.order.map(function (k) {
      var u = I18N.UI[k];
      return '<option value="' + k + '">' + u._flag + '  ' + u._name + '</option>';
    }).join('');
    var sc = document.getElementById('sel-cur');
    sc.innerHTML = I18N.CURRENCIES.map(function (c) { return '<option>' + c + '</option>'; }).join('');
  }

  // ---------------------------------------------------------------- kern voor de pro-module
  // De pro-module (los bestand, alleen in de betaalde uitgave) rekent hierop.
  // MONTHS wordt bij een taalwissel opnieuw gevuld, dus we geven het object door.
  var HBCore = {
    S: S, MONTHS: MONTHS,
    T: T, TC: TC, TG: TG,
    budgetTx: budgetTx, opnameTx: opnameTx, spaarTx: spaarTx, spaarPerCat: spaarPerCat,
    catSoort: catSoort, catGroep: catGroep,
    detectRecurring: detectRecurring, histInkomen: histInkomen, mediaan: mediaan,
    months: months, maandLabel: maandLabel, payeeKey: payeeKey,
    eur: eur, eur0: eur0, dmy: dmy, esc: esc, flash: flash, save: save,
    lineChart: lineChart, barChart: barChart, hbarChart: hbarChart
  };
  window.HBCore = HBCore;

  // Alles zit in dezelfde uitgave; er is geen licentie meer voor nodig. De controle
  // blijft staan zodat de app ook draait als pro.js een keer niet is meegebouwd.
  function proActief() {
    return !!window.HB_PRO;
  }

  function pro(fn) {
    var M = proActief() ? window.HB_PRO : null;
    if (M && typeof M[fn] === 'function') {
      try { M[fn](); } catch (e) { console.warn('pro ' + fn, e); }
      return true;
    }
    return false;
  }

  // tabbladen die bij de pro-module horen
  var PRO_VIEWS = ['prognose', 'potjes', 'analyse', 'belasting'];

  function proZichtbaar() {
    var aan = proActief();
    PRO_VIEWS.forEach(function (v) {
      var knop = document.querySelector('nav.tabs button[data-view="' + v + '"]');
      if (knop) knop.classList.toggle('hide', !aan);
    });
    var proLabel = document.getElementById('nav-pro-label');
    if (proLabel) proLabel.classList.toggle('hide', !aan);
    var audit = document.getElementById('audit-card');
    if (audit) audit.classList.toggle('hide', !aan);
    // bijwerken kan alleen als er tabellen zijn om bij te werken
    ['btn-update', 'lic-drop'].forEach(function (id) {
      var e = document.getElementById(id);
      if (e) e.classList.toggle('hide', !aan);
    });
    // De licentie wordt async gecontroleerd (HBLicentie.init()); als renderAll()
    // al draaide vóórdat die controle klaar was, sloeg pro() de pro-tabbladen
    // over omdat proActief() toen nog false was. Zodra de licentie alsnog geldig
    // blijkt, hier alsnog bijwerken — anders blijven tabbladen als Potjes leeg
    // tot de gebruiker er handmatig naartoe klikt.
    if (aan) {
      ['renderAudit', 'renderPrognose', 'renderPotjes', 'renderAnalyse', 'renderBelasting']
        .forEach(pro);
    }
    renderDashboardPotjes();
  }

  function renderAll() {
    applyI18n(); fillFilters();
    [renderDashboard, renderMaand, renderBudget, renderTx, renderKas, renderLeningen, renderInvesteringen,
     renderRecurring, renderRules, renderCheck].forEach(function (fn) {
      try { fn(); } catch (e) { console.warn('render mislukt', fn.name, e); }
    });
    ['renderAudit', 'renderPrognose', 'renderPotjes', 'renderAnalyse', 'renderBelasting']
      .forEach(pro);
    proZichtbaar();
    toonLicentie();
    toonNieuwer();
  }

  function show(view) {
    document.querySelectorAll('.view').forEach(function (v) { v.classList.toggle('active', v.id === 'view-' + view); });
    document.querySelectorAll('nav.tabs button').forEach(function (b) {
      b.setAttribute('aria-current', b.dataset.view === view ? 'true' : 'false');
    });
    if (view === 'dashboard') renderDashboard();
    if (view === 'budget') renderBudget();
    if (view === 'vaste') { renderRecurring(); pro('renderAudit'); }
    if (view === 'maand') renderMaand();
    if (view === 'transacties') renderTx();
    if (view === 'import') renderCheck();
    if (view === 'prognose') pro('renderPrognose');
    if (view === 'potjes') pro('renderPotjes');
    if (view === 'analyse') pro('renderAnalyse');
    if (view === 'belasting') pro('renderBelasting');
    location.hash = view;
  }

  function applyTheme() {
    var t = S.settings.theme;
    if (t === 'auto') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', t);
    document.getElementById('btn-theme').textContent =
      t === 'dark' ? '☀︎ ' + T('theme_light') : (t === 'light' ? '☾ ' + T('theme_dark') : '◐ ' + T('theme_auto'));
    if (document.getElementById('view-dashboard').classList.contains('active')) renderDashboard();
    if (document.getElementById('view-maand').classList.contains('active')) renderMaand();
    if (document.getElementById('view-transacties').classList.contains('active')) renderTx();
  }

  // ---------------------------------------------------------------- licentie en tabellen
  function licStatus(html, cls) {
    var e = document.getElementById('lic-status');
    if (e) e.innerHTML = '<span class="pill ' + (cls || '') + '">' + html + '</span>';
  }

  function toonLicentie() {
    if (!window.HBLicentie) return;
    licStatus(T('lic_free'), 'ok');
  }

  // Een aangekondigde nieuwere uitgave laten zien. De app werkt zichzelf niet bij —
  // hij vertelt alleen dát er iets nieuws is, en waar je het haalt.
  function toonNieuwer() {
    var L = window.HBLicentie;
    var box = document.getElementById('lic-nieuw');
    if (!box) return;
    if (!L || !L.nieuwer) { box.innerHTML = ''; box.className = ''; return; }
    var n = L.nieuwer;
    var wat = (n.wat && (n.wat[LANG] || n.wat.en || n.wat.nl)) || '';
    box.className = 'note ok mt';
    box.innerHTML = '<strong>' + T('upd_new', { v: esc(n.naam || n.uitgave), d: dmy(n.uitgave) }) +
      '</strong><div class="mt">' + esc(wat) + '</div>' +
      (n.url ? '<div class="mt"><a class="btn primary" href="' + esc(n.url) +
        '" target="_blank" rel="noopener">' + T('upd_get') + '</a></div>' : '') +
      '<div class="note mt">' + T('upd_how') + '</div>';
  }

  function pasTabellenToe(data, bron) {
    ['btn-url-open', 'lic-file-label'].forEach(function (id) {
      var e = document.getElementById(id);
      if (e) e.classList.remove('primary');
    });
    window.HB_FISCAAL = data;
    S.settings.fiscaal = data;
    save();
    pro('renderBelasting');
    toonNieuwer();
    flash(T('lic_updated', { d: dmy(data.peildatum || '') }));
  }

  function koppelLicentie() {
    var L = window.HBLicentie;
    if (!L) return;
    // Het adres staat los en wordt door een update nooit overschreven: wie een
    // eigen kopie bijhoudt wijst hem ergens anders heen, en leeg zet het uit.
    var url = document.getElementById('lic-url');
    if (url) {
      url.value = S.settings.updateUrl != null ? S.settings.updateUrl : (L.standaardUrl || '');
      url.addEventListener('change', function () {
        S.settings.updateUrl = this.value.trim(); save();
      });
    }
    var open_ = document.getElementById('btn-url-open');
    if (open_) open_.addEventListener('click', function () {
      var u = (url && url.value.trim()) || L.standaardUrl;
      if (u) window.open(u, '_blank', 'noopener');
    });

    var bij = document.getElementById('btn-update');
    if (bij) bij.addEventListener('click', function () {
      licStatus(T('lic_checking'));
      L.haalTabellen(url ? url.value : '').then(function (data) {
        pasTabellenToe(data); toonLicentie();
      }).catch(function (e) {
        var m = String(e.message);
        if (m === 'netwerk') {
          // Vanuit een dubbelgeklikt bestand mag de browser vaak niet naar buiten.
          // Dat is geen storing: wijs meteen de weg die het altijd doet.
          licStatus(T('lic_offline'), 'over');
          var b1 = document.getElementById('btn-url-open');
          var b2 = document.getElementById('lic-file-label');
          if (b1) b1.classList.add('primary');
          if (b2) b2.classList.add('primary');
          return;
        }
        toonLicentie();
        flash(T(m === 'geen-url' ? 'lic_no_url' : 'lic_fail'), true);
      });
    });

    function verwerkTabellenBestand(f) {
      if (!f) return;
      var fr = new FileReader();
      fr.onload = function () {
        L.leesTabellen(fr.result).then(function (data) {
          pasTabellenToe(data); toonLicentie();
        }).catch(function () {
          flash(T('lic_fail'), true);
        });
      };
      fr.readAsText(f);
    }

    var best = document.getElementById('lic-file');
    if (best) best.addEventListener('change', function () {
      verwerkTabellenBestand(this.files[0]); this.value = '';
    });

    // hetzelfde bestand mag je ook naar het vakje slepen, net als bij Import
    var licDrop = document.getElementById('lic-drop');
    if (licDrop) {
      ['dragenter', 'dragover'].forEach(function (ev) {
        licDrop.addEventListener(ev, function (e) { e.preventDefault(); licDrop.classList.add('over'); });
      });
      ['dragleave', 'drop'].forEach(function (ev) {
        licDrop.addEventListener(ev, function (e) { e.preventDefault(); licDrop.classList.remove('over'); });
      });
      licDrop.addEventListener('drop', function (e) { verwerkTabellenBestand(e.dataTransfer.files[0]); });
    }
  }

  function koppelPro() {
    document.getElementById('btn-pot-add').addEventListener('click', function () {
      window.HB_PRO.addPotje();
    });
    document.getElementById('p-saldo').value = S.settings.startSaldo || 0;
    document.getElementById('p-maanden').value = S.settings.progMaanden || 6;
    document.getElementById('p-grens').value = S.settings.progGrens != null ? S.settings.progGrens : 500;
    ['p-saldo', 'p-maanden', 'p-grens'].forEach(function (id) {
      document.getElementById(id).addEventListener('change', function () {
        if (id === 'p-saldo') S.settings.startSaldo = +this.value || 0;
        if (id === 'p-maanden') S.settings.progMaanden = +this.value;
        if (id === 'p-grens') S.settings.progGrens = +this.value || 0;
        save(); pro('renderPrognose');
      });
    });
    document.getElementById('btn-belasting').addEventListener('click', function () {
      pro('renderBelasting');
    });
    // landkeuze vullen; elk land heeft zijn eigen velden en tabellen
    var sl = document.getElementById('b-land');
    if (sl && window.HB_PRO.landen) {
      var lijst = window.HB_PRO.landen();
      sl.innerHTML = lijst.map(function (l) {
        return '<option value="' + l.code + '">' + esc(l.naam) + ' ' + l.jaar + '</option>';
      }).join('');
      sl.value = S.settings.fiscLand || (window.HB_FISCAAL || {}).standaardLand || 'NL';
      sl.addEventListener('change', function () {
        S.settings.fiscLand = this.value; save();
        pro('renderBelasting'); pro('renderAnalyse');
      });
    }
    ['b-kapitaal', 'b-aftrek', 'b-kerk', 'b-kerk-pct'].forEach(function (id) {
      var e = document.getElementById(id);
      if (!e) return;
      e.addEventListener('change', function () {
        S.settings.fisc = S.settings.fisc || {};
        S.settings.fisc[id] = e.type === 'checkbox' ? e.checked : e.value;
        save(); pro('renderBelasting');
      });
      var w = S.settings.fisc && S.settings.fisc[id];
      if (w != null) { if (e.type === 'checkbox') e.checked = !!w; else e.value = w; }
    });
    ['b-bruto1', 'b-inh1', 'b-bruto2', 'b-inh2', 'b-woz', 'b-rente',
     'b-spaar', 'b-beleg', 'b-schuld', 'b-werkelijk'].forEach(function (id) {
      var e = document.getElementById(id);
      e.addEventListener('change', function () {
        S.settings.fisc = S.settings.fisc || {};
        S.settings.fisc[id] = this.value;
        save(); pro('renderBelasting');
      });
      if (S.settings.fisc && S.settings.fisc[id] != null) e.value = S.settings.fisc[id];
    });
    var partner = document.getElementById('b-partner');
    if (S.settings.fisc && S.settings.fisc.partner) {
      partner.checked = true;
      document.getElementById('b-p2').classList.remove('hide');
    }
    partner.addEventListener('change', function () {
      S.settings.fisc = S.settings.fisc || {};
      S.settings.fisc.partner = this.checked; save();
      document.getElementById('b-p2').classList.toggle('hide', !this.checked);
      pro('renderBelasting');
    });
  }

  function init() {
    loadBase(); load();
    if (!S.settings.jaar) S.settings.jaar = years()[years().length - 1];
    if (!S.settings.lang) {
      var nav = (navigator.language || 'nl').slice(0, 2).toLowerCase();
      S.settings.lang = I18N.order.indexOf(nav) >= 0 ? nav : 'nl';
    }
    LANG = S.settings.lang; CUR = S.settings.cur || 'EUR';
    // eerder opgehaalde tabellen gaan voor op wat er is ingebakken
    if (S.settings.fiscaal && S.settings.fiscaal.peildatum) {
      var oud = (window.HB_FISCAAL || {}).peildatum || '';
      if (S.settings.fiscaal.peildatum > oud) window.HB_FISCAAL = S.settings.fiscaal;
    }
    fillLangPicker(); fillInvestTypeSelect(); applyTheme(); renderAll();

    document.querySelectorAll('nav.tabs button').forEach(function (b) {
      b.addEventListener('click', function () { show(b.dataset.view); });
    });
    show((location.hash || '#dashboard').slice(1));

    document.getElementById('sel-lang').addEventListener('change', function () {
      LANG = S.settings.lang = this.value; save(); renderAll(); applyTheme();
    });
    document.getElementById('sel-cur').addEventListener('change', function () {
      CUR = S.settings.cur = this.value; save(); renderAll();
    });
    document.getElementById('btn-theme').addEventListener('click', function () {
      S.settings.theme = S.settings.theme === 'auto' ? 'dark' : (S.settings.theme === 'dark' ? 'light' : 'auto');
      save(); applyTheme();
    });
    document.getElementById('sel-jaar').addEventListener('change', function () {
      S.settings.jaar = +this.value; save(); renderMaand(); renderBudget();
    });
    ['q', 'cat', 'jaar', 'rek'].forEach(function (k) {
      document.getElementById('f-' + k).addEventListener('input', function () {
        txFilter[k] = this.value; renderTx();
      });
    });
    document.getElementById('m-basis').value = S.settings.maandBasis || 'hist';
    document.getElementById('m-basis').addEventListener('change', function () {
      S.settings.maandBasis = this.value; save(); renderMaand();
    });
    document.getElementById('btn-kas-add').addEventListener('click', addKas);
    var bLenAdd = document.getElementById('btn-len-add');
    if (bLenAdd) bLenAdd.addEventListener('click', addLening);
    var lenStart = document.getElementById('len-start');
    if (lenStart && !lenStart.value) lenStart.value = new Date().toISOString().slice(0, 10);
    var bDashAdd = document.getElementById('btn-dash-add');
    if (bDashAdd) bDashAdd.addEventListener('click', function () { voegBoekingToe('d-'); });
    var chkAlle = document.getElementById('chk-alle-maanden');
    if (chkAlle) chkAlle.addEventListener('change', function () {
      S.settings.budgetAlleMaanden = this.checked; save(); renderBudget();
    });
    var btnInvAdd = document.getElementById('btn-inv-add');
    if (btnInvAdd) btnInvAdd.addEventListener('click', addInvestering);
    // Hulpballonnetje bij elk veld met data-help: dezelfde .tip die de grafieken
    // gebruiken, nu ook voor uitleg bij velden — zonder dat je naar "Over" hoeft.
    document.addEventListener('mousemove', function (ev) {
      var el = ev.target && ev.target.closest ? ev.target.closest('[data-help]') : null;
      if (el) showTip(esc(T(el.getAttribute('data-help'))), ev); else hideTip();
    });
    if (window.HB_PRO) koppelPro();
    koppelLicentie();
    if (window.HBLicentie) {
      window.HBLicentie.init().then(function () {
        toonLicentie(); proZichtbaar();
      });
    }
    document.getElementById('btn-budget-hist').addEventListener('click', vulBudgetUitHistorie);
    document.getElementById('btn-export').addEventListener('click', exportJson);
    var bBackupHeader = document.getElementById('btn-backup-header');
    if (bBackupHeader) bBackupHeader.addEventListener('click', exportJson);
    document.getElementById('btn-export-csv').addEventListener('click', exportCsv);
    document.getElementById('btn-commit').addEventListener('click', commit);
    document.getElementById('btn-wipe').addEventListener('click', function () {
      if (!confirm(T('wipe_confirm'))) return;
      localStorage.removeItem(STORE);
      S.budget = {}; S.overrides = {}; S.manual = []; S.imported = []; S.userRules = []; S.catType = {}; S.potjes = []; S.investeringen = [];
      renderAll(); flash(T('wiped'));
    });
    if (window.HB_DEMO && window.HB_DEMO.tx && window.HB_DEMO.tx.length) {
      document.getElementById('demo-wrap').classList.remove('hide');
      // ?demo=1 vult de app meteen met voorbeelddata, voor de rondleiding op de website.
      // Alleen als er nog niets staat: iemands eigen boekhouding overschrijven we nooit.
      if (/[?&]demo=1/.test(location.search) && !(S.imported || []).length && !(S.manual || []).length) {
        setTimeout(function () { document.getElementById('btn-demo').click(); }, 60);
      }
      document.getElementById('btn-demo').addEventListener('click', function () {
        var d = window.HB_DEMO;
        S.imported = (S.imported || []).concat(d.tx.map(function (a, i) {
          return { id: 'demo' + i, date: a[0], month: a[0].slice(0, 7), year: +a[0].slice(0, 4),
                   account: d.accounts[a[1]], owner: d.owners[a[2]], bank: d.banks[a[3]],
                   desc: a[4], amount: a[5], group: d.groups[a[6]], cat: d.categories[a[7]],
                   zak: false, src: 'demo' };
        }));
        save(); fillFilters(); vulBudgetUitHistorie(); renderAll();
        flash(T('demo_loaded'));
      });
    }
    document.getElementById('file').addEventListener('change', function () { handleFiles(this.files); this.value = ''; });
    document.getElementById('file-json').addEventListener('change', function () { importJson(this.files[0]); this.value = ''; });
    var drop = document.getElementById('drop');
    ['dragenter', 'dragover'].forEach(function (e) {
      drop.addEventListener(e, function (ev) { ev.preventDefault(); drop.classList.add('over'); });
    });
    ['dragleave', 'drop'].forEach(function (e) {
      drop.addEventListener(e, function (ev) { ev.preventDefault(); drop.classList.remove('over'); });
    });
    drop.addEventListener('drop', function (ev) { handleFiles(ev.dataTransfer.files); });
    document.getElementById('btn-paste').addEventListener('click', function () {
      var txt = document.getElementById('paste').value;
      if (!txt.trim()) { flash(T('paste_need'), true); return; }
      var ing = P.parseIngCsv(txt);
      if (ing) { stage(ing, 'ING'); return; }
      var r = P.fromTable(P.splitCSV(txt), {});
      if (r.error) document.getElementById('preview').innerHTML = '<div class="note warn">' + esc(r.error) + '</div>';
      else stage(r.rows, 'Geplakt');
    });
    document.getElementById('kas-datum').value = new Date().toISOString().slice(0, 10);
    var dDatum = document.getElementById('d-datum');
    if (dDatum) dDatum.value = new Date().toISOString().slice(0, 10);
    addEventListener('resize', function () {
      clearTimeout(window._rz);
      window._rz = setTimeout(function () {
        if (document.getElementById('view-dashboard').classList.contains('active')) renderDashboard();
        if (document.getElementById('view-maand').classList.contains('active')) renderMaand();
        if (document.getElementById('view-transacties').classList.contains('active')) renderTx();
      }, 200);
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
