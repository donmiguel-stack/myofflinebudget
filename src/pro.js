/* Pro-module: prognose, potjes, analyse, doorlichting en belasting.

   Dit bestand zit alleen in de betaalde uitgave. De kern werkt er zonder,
   en verbergt de tabbladen die hier vandaan komen.

   Alles draait op de kern via HBCore; er is geen eigen opslag en geen netwerk.
*/
(function (g) {
  'use strict';
  var C = g.HBCore;
  if (!C) { console.warn('pro-module zonder kern geladen'); return; }
  var S = C.S, MONTHS = C.MONTHS;
  var T = C.T;
  var TC = C.TC;
  var budgetTx = C.budgetTx;
  var catSoort = C.catSoort;
  var catGroep = C.catGroep;
  var detectRecurring = C.detectRecurring;
  var histInkomen = C.histInkomen;
  var mediaan = C.mediaan;
  var months = C.months;
  var maandLabel = C.maandLabel;
  var payeeKey = C.payeeKey;
  var eur = C.eur;
  var eur0 = C.eur0;
  var dmy = C.dmy;
  var esc = C.esc;
  var flash = C.flash;
  var save = C.save;
  var lineChart = C.lineChart;
  var barChart = C.barChart;

  // ================================================================ PROGNOSE
  // Saldo per dag vooruit: herkende vaste lasten op hun eigen datum, inkomen op de dag
  // waarop het meestal binnenkomt, en de rest van het budget gelijkmatig over de maand.

  function medianDag(filter) {
    var d = budgetTx().filter(filter).map(function (t) { return +t.date.slice(8, 10); });
    return d.length ? Math.round(mediaan(d)) : 25;
  }

  function vrijPerMaand() {          // mediaan van de vrije uitgaven over 12 maanden
    var ms = months().slice(-13, -1);
    if (!ms.length) ms = months().slice(-12);
    if (!ms.length) return 0;
    var per = ms.map(function (m) {
      return budgetTx().reduce(function (a, t) {
        return a + (t.month === m && t.amount < 0 && catSoort(t.cat, t.group) === 'vrij' ? -t.amount : 0);
      }, 0);
    });
    return mediaan(per);
  }

  function prognose(maanden) {
    // met sparen erbij: een overboeking naar je spaarrekening is geen uitgave,
    // maar hij gaat wel van je saldo af en hoort dus in de prognose
    var rec = detectRecurring(true).filter(function (r) { return r.actief; });
    var vandaag = new Date(); vandaag.setHours(12, 0, 0, 0);
    var eind = new Date(vandaag.getTime()); eind.setMonth(eind.getMonth() + maanden);
    var events = [];

    rec.forEach(function (r) {
      var d = new Date(r.volgende);
      var veiligheid = 0;
      while (d <= eind && veiligheid++ < 400) {
        if (d >= vandaag) {
          events.push({ datum: d.toISOString().slice(0, 10), bedrag: -r.bedrag,
                        naam: r.naam, soort: 'vast' });
        }
        d = new Date(d.getTime() + r.ritme.dagen * 86400000);
      }
    });

    var recPm = rec.reduce(function (a, r) { return a + r.perJaar / 12; }, 0);
    var vastBudget = Object.keys(S.budget).reduce(function (a, k) {
      return a + (catSoort(k, catGroep(k)) === 'vast' ? (+S.budget[k] || 0) : 0);
    }, 0);
    // Een spaarcategorie krijgt geen budget — het is geen uitgave. Maar het geld gaat
    // wel elke maand van je rekening af, dus voor de saldoprognose telt het mee als
    // vaste post. Zonder deze regel wordt de prognose te optimistisch.
    vastBudget += rec.reduce(function (a, r) {
      return a + (catSoort(r.cat, catGroep(r.cat)) === 'sparen' ? r.perJaar / 12 : 0);
    }, 0);
    var restVast = Math.max(0, vastBudget - recPm);      // vaste lasten die geen ritme kregen
    var vrij = S.settings.progVrij != null ? +S.settings.progVrij : vrijPerMaand();
    var ink = S.settings.inkomenOverride != null ? +S.settings.inkomenOverride : histInkomen();
    var inkDag = medianDag(function (t) { return t.amount > 500; });

    // per maand het inkomen en de gelijkmatig verdeelde rest
    var d = new Date(vandaag.getTime());
    while (d <= eind) {
      var jaar = d.getFullYear(), mnd = d.getMonth();
      var dim = new Date(jaar, mnd + 1, 0).getDate();
      var dagLast = (restVast + vrij) / dim;
      events.push({ datum: d.toISOString().slice(0, 10), bedrag: -dagLast, naam: '', soort: 'spreiding' });
      if (d.getDate() === Math.min(inkDag, dim)) {
        events.push({ datum: d.toISOString().slice(0, 10), bedrag: ink, naam: T('p_income'), soort: 'inkomen' });
      }
      d = new Date(d.getTime() + 86400000);
    }

    events.sort(function (a, b) { return a.datum < b.datum ? -1 : 1; });
    var saldo = +S.settings.startSaldo || 0;
    var punten = [], laagste = { saldo: Infinity, datum: '' }, dag = {};
    events.forEach(function (e) { dag[e.datum] = (dag[e.datum] || 0) + e.bedrag; });
    Object.keys(dag).sort().forEach(function (k) {
      saldo += dag[k];
      punten.push({ datum: k, saldo: saldo });
      if (saldo < laagste.saldo) laagste = { saldo: saldo, datum: k };
    });
    return {
      punten: punten, laagste: laagste, eindsaldo: saldo,
      posten: events.filter(function (e) { return e.soort !== 'spreiding'; }),
      perMaand: { inkomen: ink, vast: recPm + restVast, vrij: vrij }
    };
  }

  function renderPrognose() {
    var mnd = +(S.settings.progMaanden || 6);
    var grens = +(S.settings.progGrens != null ? S.settings.progGrens : 500);
    var p = prognose(mnd);
    var host = document.getElementById('p-kpis');
    if (!p.punten.length) { host.innerHTML = '<p class="muted">' + T('empty') + '</p>'; return; }
    var over = p.perMaand.inkomen - p.perMaand.vast - p.perMaand.vrij;
    var krap = p.punten.filter(function (x) { return x.saldo < grens; });
    host.innerHTML =
      kpi(T('p_end'), eur0(p.eindsaldo), T('p_end_sub', { n: mnd })) +
      kpi(T('p_low'), eur0(p.laagste.saldo), p.laagste.datum ? dmy(p.laagste.datum) : '',
          p.laagste.saldo < grens ? 'neg' : '') +
      kpi(T('p_permonth'), eur0(over), T('p_permonth_sub'), over < 0 ? 'neg' : 'pos') +
      kpi(T('p_tight'), krap.length ? String(krap.length) : '0',
          krap.length ? T('p_tight_sub', { d: dmy(krap[0].datum) }) : T('p_tight_none'),
          krap.length ? 'neg' : '');

    var labels = p.punten.map(function (x) { return x.datum; });
    lineChart(document.getElementById('p-chart'), labels,
      [{ name: T('p_balance'), data: p.punten.map(function (x) { return x.saldo; }) }],
      { elke: Math.max(1, Math.round(labels.length / 8)), height: 280,
        labelFmt: function (s) { return dmy(s).slice(0, 5); } });

    var rijen = p.posten.filter(function (e) { return Math.abs(e.bedrag) >= 1; }).slice(0, 40);
    document.getElementById('p-body').innerHTML =
      '<thead><tr><th>' + T('th_date') + '</th><th>' + T('p_what') + '</th><th class="num">' +
      T('th_amount') + '</th></tr></thead><tbody>' +
      rijen.map(function (e) {
        return '<tr><td class="nowrap">' + dmy(e.datum) + '</td><td>' + esc(e.naam) +
          '</td><td class="num ' + (e.bedrag < 0 ? 'neg' : 'pos') + '">' + eur(e.bedrag) + '</td></tr>';
      }).join('') + '</tbody>';
  }

  function kpi(label, value, sub, cls) {
    return '<div class="card kpi"><div class="label">' + label + '</div><div class="value ' +
      (cls || '') + '">' + value + '</div>' + (sub ? '<div class="sub">' + sub + '</div>' : '') + '</div>';
  }

  // ================================================================ DOORLICHTING
  function auditRecurring() {
    var list = detectRecurring();
    var actief = list.filter(function (r) { return r.actief; });
    var uit = [];

    actief.forEach(function (r) {
      var pct = r.verschil * 100;
      if (pct >= 8) {
        uit.push({ type: 'increase', naam: r.naam, cat: r.cat, perJaar: r.perJaar,
                   extra: r.perJaar * (pct / (100 + pct)),
                   detail: T('a_increase_d', { v: '+' + Math.round(pct) + '%' }) });
      }
    });

    // meerdere lopende posten in dezelfde categorie: kandidaat voor dubbel
    var perCat = {};
    actief.forEach(function (r) { (perCat[r.cat] = perCat[r.cat] || []).push(r); });
    Object.keys(perCat).forEach(function (c) {
      var g = perCat[c].slice().sort(function (a, b) { return a.bedrag - b.bedrag; });
      if (g.length < 2) return;
      // twee losse posten in dezelfde categorie zijn nog geen dubbel; pas als het
      // bedrag én het ritme vrijwel gelijk zijn wordt het interessant
      var cluster = [];
      g.forEach(function (r) {
        var vorig = cluster[cluster.length - 1];
        if (vorig && vorig[0].ritme.key === r.ritme.key &&
            Math.abs(r.bedrag - vorig[0].bedrag) <= vorig[0].bedrag * 0.2) {
          vorig.push(r);
        } else { cluster.push([r]); }
      });
      cluster.filter(function (cl) { return cl.length >= 2; }).forEach(function (cl) {
        uit.push({ type: 'double', naam: TC(c), cat: c,
                   perJaar: cl.reduce(function (a, r) { return a + r.perJaar; }, 0),
                   extra: 0,
                   detail: cl.map(function (r) { return r.naam + ' (' + eur0(r.perJaar) + ')'; }).join(' · ') });
      });
    });

    list.filter(function (r) { return !r.actief; }).forEach(function (r) {
      var dagen = (new Date() - new Date(r.laatste)) / 86400000;
      if (dagen > 500) return;                       // te oud om nog interessant te zijn
      uit.push({ type: 'stopped', naam: r.naam, cat: r.cat, perJaar: r.perJaar, extra: 0,
                 detail: T('a_stopped_d', { d: dmy(r.laatste) }) });
    });

    var klein = actief.filter(function (r) { return r.bedrag < 15; });
    if (klein.length >= 3) {
      uit.push({ type: 'small', naam: T('a_small'), cat: '',
                 perJaar: klein.reduce(function (a, r) { return a + r.perJaar; }, 0), extra: 0,
                 detail: klein.map(function (r) { return r.naam; }).slice(0, 8).join(' · ') });
    }
    return uit;
  }

  function renderAudit() {
    var uit = auditRecurring();
    var host = document.getElementById('audit-body');
    if (!host) return;
    var teOnderzoeken = uit.reduce(function (a, x) {
      return a + (x.type === 'increase' ? x.extra : (x.type === 'double' || x.type === 'small' ? x.perJaar : 0));
    }, 0);
    document.getElementById('audit-sum').innerHTML = uit.length
      ? T('a_sum', { v: eur0(teOnderzoeken) }) : T('a_none');
    if (!uit.length) { host.innerHTML = ''; return; }
    var LAB = { increase: T('a_increase'), double: T('a_double'), stopped: T('a_stopped'), small: T('a_small_t') };
    var CLS = { increase: 'over', double: 'over', stopped: '', small: '' };
    host.innerHTML = '<thead><tr><th>' + T('a_finding') + '</th><th>' + T('rec_payee') +
      '</th><th>' + T('a_detail') + '</th><th class="num">' + T('rec_per_year') + '</th></tr></thead><tbody>' +
      uit.sort(function (a, b) { return b.perJaar - a.perJaar; }).map(function (x) {
        return '<tr><td class="nowrap"><span class="pill ' + CLS[x.type] + '">' + LAB[x.type] + '</span></td>' +
          '<td>' + esc(x.naam) + '</td><td><small class="muted">' + esc(x.detail) + '</small></td>' +
          '<td class="num" style="font-weight:600">' + eur0(x.perJaar) + '</td></tr>';
      }).join('') + '</tbody>';
  }

  // ================================================================ POTJES
  function potjeSuggesties() {
    var have = (S.potjes || []).map(function (p) { return p.naam.toUpperCase(); });
    return detectRecurring().filter(function (r) {
      return r.actief && r.ritme.perJaar <= 4 && r.perJaar >= 150 &&
             have.indexOf(r.naam.toUpperCase()) < 0;
    }).slice(0, 8).map(function (r) {
      return { naam: r.naam, doel: Math.round(r.bedrag), perJaar: r.perJaar,
               pm: Math.round(r.perJaar / 12), datum: r.volgende };
    });
  }

  function renderPotjes() {
    var lijst = S.potjes || [];
    var pm = lijst.reduce(function (a, p) { return a + potMaand(p); }, 0);
    var gespaard = lijst.reduce(function (a, p) { return a + (+p.stand || 0); }, 0);
    var doel = lijst.reduce(function (a, p) { return a + (+p.doel || 0); }, 0);
    document.getElementById('pot-kpis').innerHTML =
      kpi(T('j_permonth'), eur0(pm), T('j_permonth_sub', { n: lijst.length })) +
      kpi(T('j_saved'), eur0(gespaard), T('j_of', { v: eur0(doel) })) +
      kpi(T('j_gap'), eur0(Math.max(0, doel - gespaard)), T('j_gap_sub'));

    var host = document.getElementById('pot-body');
    host.innerHTML = '<thead><tr><th>' + T('j_name') + '</th><th class="num">' + T('j_target') +
      '</th><th>' + T('j_when') + '</th><th class="num">' + T('j_have') + '</th><th class="num">' +
      T('j_needed') + '</th><th></th></tr></thead><tbody>' +
      (lijst.length ? lijst.map(function (p, i) {
        var pct = p.doel ? Math.min(100, Math.round((+p.stand || 0) / p.doel * 100)) : 0;
        return '<tr><td>' + esc(p.naam) + '<div class="bar-track mt" style="max-width:200px"><div class="bar-fill" style="width:' + pct + '%;background:var(--series-1)"></div></div></td>' +
          '<td class="num">' + eur0(p.doel) + '</td>' +
          '<td class="nowrap">' + (p.datum ? dmy(p.datum) : '<span class="muted">–</span>') + '</td>' +
          '<td class="num"><input type="number" class="pot-stand" data-i="' + i + '" value="' +
          (+p.stand || 0) + '" step="10" style="width:100px"></td>' +
          '<td class="num" style="font-weight:600">' + eur0(potMaand(p)) + '</td>' +
          '<td class="right"><button class="btn ghost danger pot-del" data-i="' + i + '">' + T('del') +
          '</button></td></tr>';
      }).join('') : '<tr><td colspan="6" class="muted">' + T('j_none') + '</td></tr>') + '</tbody>';

    host.querySelectorAll('.pot-del').forEach(function (b) {
      b.addEventListener('click', function () {
        S.potjes.splice(+b.dataset.i, 1); save(); renderPotjes();
      });
    });
    host.querySelectorAll('.pot-stand').forEach(function (inp) {
      inp.addEventListener('change', function () {
        S.potjes[+inp.dataset.i].stand = +inp.value || 0; save(); renderPotjes();
      });
    });

    var sug = potjeSuggesties();
    document.getElementById('pot-sug').innerHTML = sug.length
      ? '<p>' + T('j_sug') + '</p>' + sug.map(function (s, i) {
          return '<button class="btn pot-add" data-i="' + i + '">+ ' + esc(s.naam) + ' · ' +
            eur0(s.pm) + T('j_pm') + '</button> ';
        }).join('')
      : '';
    document.getElementById('pot-sug').querySelectorAll('.pot-add').forEach(function (b) {
      b.addEventListener('click', function () {
        var s = sug[+b.dataset.i];
        S.potjes = (S.potjes || []).concat([{ naam: s.naam, doel: s.doel, datum: s.datum, stand: 0 }]);
        save(); renderPotjes();
      });
    });
  }

  function potMaand(p) {
    var doel = +p.doel || 0, stand = +p.stand || 0;
    if (!p.datum) return Math.round((doel - stand) / 12);
    var mnd = Math.max(1, Math.round((new Date(p.datum) - new Date()) / 86400000 / 30.4));
    return Math.max(0, Math.round((doel - stand) / mnd));
  }

  function addPotje() {
    var naam = document.getElementById('pot-naam').value.trim();
    var doel = +document.getElementById('pot-doel').value;
    var datum = document.getElementById('pot-datum').value;
    if (!naam || !doel) { flash(T('j_fill'), true); return; }
    S.potjes = (S.potjes || []).concat([{ naam: naam, doel: doel, datum: datum, stand: 0 }]);
    document.getElementById('pot-naam').value = '';
    document.getElementById('pot-doel').value = '';
    save(); renderPotjes(); flash(T('j_added'));
  }

  // ================================================================ ANALYSE
  function perCatPeriode(vanaf, tot) {
    var uit = {};
    budgetTx().forEach(function (t) {
      if (t.amount >= 0 || t.month < vanaf || t.month > tot) return;
      if (t.group === 'Inkomen' || catSoort(t.cat, t.group) === 'opname') return;
      uit[t.cat] = (uit[t.cat] || 0) - t.amount;
    });
    return uit;
  }

  function renderAnalyse() {
    var ms = months();
    // even lange vensters, anders vergelijk je tien maanden met twaalf
    var n = Math.min(12, Math.floor(ms.length / 2));
    var nu = ms.slice(-n), oud = ms.slice(-2 * n, -n);
    if (n < 6) {
      document.getElementById('an-kpis').innerHTML = '';
      document.getElementById('an-yoy').innerHTML =
        '<tbody><tr><td class="muted">' + T('an_short') + '</td></tr></tbody>';
      seizoenEnRest(ms);
      return;
    }
    var a = perCatPeriode(nu[0], nu[nu.length - 1]);
    var b = oud.length ? perCatPeriode(oud[0], oud[oud.length - 1]) : {};
    var F = window.HB_FISCAAL;
    var reeks = F && F.inflatieVoor ? F.inflatieVoor(S.settings.fiscLand || 'NL') : {};
    var infl = reeks[+nu[nu.length - 1].slice(0, 4)] || 0;

    var rijen = Object.keys(a).map(function (c) {
      var v = a[c], w = b[c] || 0;
      return { cat: c, nu: v, oud: w, delta: v - w, pct: w ? (v - w) / w * 100 : null };
    }).filter(function (r) { return r.nu >= 100 || r.oud >= 100; })
      .sort(function (x, y) { return Math.abs(y.delta) - Math.abs(x.delta); });

    var totNu = rijen.reduce(function (s, r) { return s + r.nu; }, 0);
    var totOud = rijen.reduce(function (s, r) { return s + r.oud; }, 0);
    document.getElementById('an-kpis').innerHTML =
      kpi(T('an_now'), eur0(totNu), maandLabel(nu[0]) + ' – ' + maandLabel(nu[n - 1])) +
      kpi(T('an_prev'), eur0(totOud), maandLabel(oud[0]) + ' – ' + maandLabel(oud[n - 1])) +
      kpi(T('an_diff'), (totNu - totOud >= 0 ? '+' : '') + eur0(totNu - totOud),
          totOud ? Math.round((totNu - totOud) / totOud * 1000) / 10 + '%' : '',
          totNu > totOud ? 'neg' : 'pos') +
      kpi(T('an_infl'), infl.toFixed(1) + '%', T('an_infl_sub'));

    document.getElementById('an-yoy').innerHTML =
      '<thead><tr><th>' + T('th_category') + '</th><th class="num">' + T('an_12m') +
      '</th><th class="num">' + T('an_12m_prev') + '</th><th class="num">' + T('an_diff') +
      '</th><th class="num">%</th><th class="num">' + T('an_real') + '</th></tr></thead><tbody>' +
      rijen.slice(0, 25).map(function (r) {
        var reeel = r.pct == null ? null : r.pct - infl;
        return '<tr><td>' + esc(TC(r.cat)) + '</td><td class="num">' + eur0(r.nu) +
          '</td><td class="num muted">' + eur0(r.oud) + '</td>' +
          '<td class="num ' + (r.delta > 0 ? 'neg' : 'pos') + '">' + (r.delta > 0 ? '+' : '') + eur0(r.delta) + '</td>' +
          '<td class="num">' + (r.pct == null ? '–' : (r.pct > 0 ? '+' : '') + Math.round(r.pct) + '%') + '</td>' +
          '<td class="num">' + (reeel == null ? '–' :
            '<span class="pill ' + (reeel > 2 ? 'over' : (reeel < -2 ? 'ok' : '')) + '">' +
            (reeel > 0 ? '+' : '') + Math.round(reeel) + '%</span>') + '</td></tr>';
      }).join('') + '</tbody>';

    seizoenEnRest(ms);
  }

  function seizoenEnRest(ms) {
    // seizoenspatroon: gemiddelde uitgaven per kalendermaand
    var perM = [], nM = [];
    for (var i = 0; i < 12; i++) { perM.push(0); nM.push(0); }
    ms.forEach(function (m) {
      var idx = +m.slice(5, 7) - 1;
      nM[idx]++;
      perM[idx] += budgetTx().reduce(function (s, t) {
        return s + (t.month === m && t.amount < 0 && catSoort(t.cat, t.group) !== 'opname' ? -t.amount : 0);
      }, 0);
    });
    var gem = perM.map(function (v, i) { return nM[i] ? v / nM[i] : 0; });
    barChart(document.getElementById('an-seizoen'), C.MONTHS.slice(), gem, { fmt: eur0 });

    // afwijkingen
    document.getElementById('an-afw').innerHTML = afwijkingenHtml();

    // wie betaalde wat
    var per = {};
    budgetTx().forEach(function (t) {
      var k = t.owner || t.account || '?';
      var p = per[k] = per[k] || { in: 0, uit: 0 };
      if (t.amount > 0) p.in += t.amount; else if (catSoort(t.cat, t.group) !== 'opname') p.uit -= t.amount;
    });
    var keys = Object.keys(per).sort(function (x, y) { return per[y].uit - per[x].uit; });
    document.getElementById('an-wie').innerHTML =
      '<thead><tr><th>' + T('an_who') + '</th><th class="num">' + T('income') + '</th><th class="num">' +
      T('expense') + '</th><th class="num">' + T('an_share') + '</th></tr></thead><tbody>' +
      keys.map(function (k) {
        var tot = keys.reduce(function (a, x) { return a + per[x].uit; }, 0);
        return '<tr><td>' + esc(k) + '</td><td class="num pos">' + eur0(per[k].in) +
          '</td><td class="num">' + eur0(per[k].uit) + '</td><td class="num">' +
          (tot ? Math.round(per[k].uit / tot * 100) : 0) + '%</td></tr>';
      }).join('') + '</tbody>';
  }

  function afwijkingen() {
    var tx = budgetTx().filter(function (t) { return t.amount < 0; });
    var uit = [];
    // 1. twee vrijwel gelijke bedragen bij dezelfde partij binnen drie dagen
    var perKey = {};
    tx.forEach(function (t) { (perKey[payeeKey(t.desc)] = perKey[payeeKey(t.desc)] || []).push(t); });
    Object.keys(perKey).forEach(function (k) {
      var g = perKey[k].slice().sort(function (a, b) { return a.date < b.date ? -1 : 1; });
      for (var i = 1; i < g.length; i++) {
        var dd = (new Date(g[i].date) - new Date(g[i - 1].date)) / 86400000;
        if (dd <= 3 && Math.abs(g[i].amount - g[i - 1].amount) < 0.02 && Math.abs(g[i].amount) >= 10) {
          uit.push({ type: 'dubbel', t: g[i], detail: dmy(g[i - 1].date) });
        }
      }
    });
    // 2. uitschieter binnen de categorie
    var perCat = {};
    tx.forEach(function (t) { (perCat[t.cat] = perCat[t.cat] || []).push(-t.amount); });
    tx.forEach(function (t) {
      var g = perCat[t.cat];
      if (g.length < 8) return;
      var med = mediaan(g);
      if (med > 0 && -t.amount > med * 4 && -t.amount >= 150) {
        uit.push({ type: 'piek', t: t, detail: T('an_median', { v: eur0(med) }) });
      }
    });
    // 3. pas begonnen vaste last
    detectRecurring().filter(function (r) { return r.actief; }).forEach(function (r) {
      var eerste = r.n * r.ritme.dagen;
      if (eerste <= 130 && r.perJaar >= 60) {
        uit.push({ type: 'nieuw', t: { date: r.laatste, desc: r.naam, amount: -r.bedrag, cat: r.cat },
                   detail: T('an_new_d', { v: eur0(r.perJaar) }) });
      }
    });
    return uit.sort(function (a, b) { return a.t.date < b.t.date ? 1 : -1; }).slice(0, 25);
  }

  function afwijkingenHtml() {
    var lijst = afwijkingen();
    if (!lijst.length) return '<tbody><tr><td class="muted">' + T('an_clean') + '</td></tr></tbody>';
    var LAB = { dubbel: T('an_double'), piek: T('an_spike'), nieuw: T('an_new') };
    return '<thead><tr><th>' + T('an_signal') + '</th><th>' + T('th_date') + '</th><th>' +
      T('th_description') + '</th><th class="num">' + T('th_amount') + '</th><th>' + T('a_detail') +
      '</th></tr></thead><tbody>' + lijst.map(function (x) {
        return '<tr><td class="nowrap"><span class="pill ' + (x.type === 'dubbel' ? 'over' : '') + '">' +
          LAB[x.type] + '</span></td><td class="nowrap">' + dmy(x.t.date) + '</td>' +
          '<td><small>' + esc(String(x.t.desc).slice(0, 60)) + '</small></td>' +
          '<td class="num">' + eur(x.t.amount) + '</td>' +
          '<td><small class="muted">' + esc(x.detail) + '</small></td></tr>';
      }).join('') + '</tbody>';
  }

  // ================================================================ BELASTING
  // Per land een eigen rekenkern. Wat ze delen: je vult bruto inkomen en de ingehouden
  // belasting in, en je krijgt te horen of je iets terugkrijgt of moet bijbetalen.

  function land() {
    var F = window.HB_FISCAAL;
    if (!F || !F.landen) return null;
    var code = S.settings.fiscLand || F.standaardLand || 'NL';
    return F.landen[code] ? code : Object.keys(F.landen)[0];
  }

  function fisc() {
    var F = window.HB_FISCAAL;
    if (!F || !F.landen) return null;
    var l = F.landen[land()];
    return l ? { F: F, L: l } : null;
  }

  function heeftVeld(naam) {
    var f = fisc();
    return !!f && f.L.velden.indexOf(naam) >= 0;
  }

  // ---------------------------------------------------------------- Nederland
  function box1Tarief(bel, tab) {
    var t = 0, vorig = 0;
    for (var i = 0; i < tab.length; i++) {
      var top = Math.min(bel, tab[i].tot);
      if (top > vorig) t += (top - vorig) * tab[i].pct;
      vorig = tab[i].tot;
      if (bel <= tab[i].tot) break;
    }
    return t;
  }

  function arbeidskorting(ai, tab) {
    for (var i = 0; i < tab.length; i++) {
      if (ai <= tab[i].tot) return Math.max(0, tab[i].basis + tab[i].pct * (ai - tab[i].vanaf));
    }
    return 0;
  }

  function algemeneKorting(vi, a) {
    if (vi <= a.vanaf) return a.max;
    if (vi >= a.tot) return 0;
    return a.max * (1 - (vi - a.vanaf) / (a.tot - a.vanaf));
  }

  function berekenNL(inp, j) {
    var ewf = 0;
    if (inp.woz) {
      ewf = Math.min(inp.woz, j.ewfGrens) * j.ewf +
            Math.max(0, inp.woz - j.ewfGrens) * j.ewfHoog;
    }
    var rente = (+inp.rente || 0) * (inp.deelRente == null ? 1 : inp.deelRente);
    var eigenWoning = ewf - rente;                       // negatief = aftrek
    var belastbaar = Math.max(0, (+inp.bruto || 0) + eigenWoning);
    var belasting = box1Tarief(belastbaar, j.schijven);
    // tariefsaanpassing: aftrek telt maximaal tegen het tarief van de tweede schijf
    if (eigenWoning < 0) {
      var zonder = box1Tarief(Math.max(0, +inp.bruto || 0), j.schijven);
      var voordeel = zonder - belasting;
      var maxVoordeel = -eigenWoning * j.aftrekMax;
      if (voordeel > maxVoordeel) belasting += voordeel - maxVoordeel;
    }
    var ak = arbeidskorting(+inp.bruto || 0, j.ak);
    var ahk = algemeneKorting(belastbaar, j.ahk);
    var box1 = Math.max(0, belasting - ak - ahk);

    var spaar = +inp.spaar || 0, beleg = +inp.beleg || 0, schuld = +inp.schuld || 0;
    var vrij = j.box3.heffingsvrij * (inp.partner ? 2 : 1);
    var schuldTel = Math.max(0, schuld - j.box3.schuldDrempel * (inp.partner ? 2 : 1));
    var grondslag = Math.max(0, spaar + beleg - schuldTel - vrij);
    var forfait = spaar * j.box3.spaargeld + beleg * j.box3.overig - schuldTel * j.box3.schulden;
    var bezit = spaar + beleg - schuldTel;
    var deel = bezit > 0 ? Math.min(1, grondslag / bezit) : 0;
    var box3Forfait = Math.max(0, forfait * deel * j.box3.tarief);
    var box3Werkelijk = null;
    if (inp.werkelijk !== '' && inp.werkelijk != null) {
      box3Werkelijk = Math.max(0, (+inp.werkelijk) * deel * j.box3.tarief);
    }
    var box3 = box3Werkelijk != null ? Math.min(box3Forfait, box3Werkelijk) : box3Forfait;

    return {
      belastbaar: belastbaar, brutoBelasting: belasting,
      regels: [
        ['b_taxable', belastbaar],
        ['b_ewf', ewf],
        ['b_interest', -rente],
        ['b_gross_tax', belasting],
        ['b_ahk', -ahk],
        ['b_ak', -ak],
        ['b_box1', box1],
        ['b_box3', box3]
      ],
      vermogen: {
        grondslag: grondslag, forfait: box3Forfait, werkelijk: box3Werkelijk, te_betalen: box3
      },
      totaal: box1 + box3
    };
  }

  // ---------------------------------------------------------------- Duitsland
  // §32a EStG: geen schijven maar een formule met vijf zones.
  function estTarief(zvE, j) {
    var Z = j.zones, x = Math.floor(Math.max(0, zvE));
    if (x <= j.grundfreibetrag) return 0;
    if (x <= Z.z2Tot) {
      var y = (x - j.grundfreibetrag) / 10000;
      return (Z.z2a * y + Z.z2b) * y;
    }
    if (x <= Z.z3Tot) {
      var z = (x - Z.z2Tot) / 10000;
      var basis = (Z.z2a * ((Z.z2Tot - j.grundfreibetrag) / 10000) + Z.z2b) *
                  ((Z.z2Tot - j.grundfreibetrag) / 10000);
      return (Z.z3a * z + Z.z3b) * z + basis;
    }
    if (x <= Z.z4Tot) return Z.z4pct * x - Z.z4c;
    return Z.z5pct * x - Z.z5c;
  }

  // Ehegattensplitting: belasting over de helft van het gezamenlijke inkomen, maal twee.
  function estMetSplitting(zvE, j, splitting) {
    return splitting ? 2 * estTarief(zvE / 2, j) : estTarief(zvE, j);
  }

  function soliOver(est, j, splitting) {
    var vrij = splitting ? j.soli.vrijSplitting : j.soli.vrij;
    if (est <= vrij) return 0;
    // milderingszone: de toeslag loopt geleidelijk op tot de volle 5,5%
    var vol = est * j.soli.pct;
    var mild = (est - vrij) * j.soli.milderung;
    return Math.min(vol, mild);
  }

  function berekenDE(inp, j) {
    var splitting = !!inp.splitting;
    var bruto = (+inp.bruto || 0) + (splitting ? (+inp.bruto2 || 0) : 0);
    var aftrek = j.arbeitnehmerPauschbetrag * (splitting ? 2 : 1) +
                 j.sonderausgabenPauschbetrag * (splitting ? 2 : 1) +
                 (+inp.aftrekExtra || 0);
    var zvE = Math.max(0, bruto - aftrek);

    var est = estMetSplitting(zvE, j, splitting);
    var soli = soliOver(est, j, splitting);

    // inkomsten uit vermogen worden apart belast (Abgeltungsteuer)
    var kap = Math.max(0, (+inp.kapitaal || 0) -
                          j.abgeltung.sparerPauschbetrag * (splitting ? 2 : 1));
    var kapBel = kap * j.abgeltung.pct;
    var kapSoli = kapBel * j.soli.pct;

    var kerkPct = inp.kerk ? (inp.kerkLaag ? j.kirchensteuer.laag : j.kirchensteuer.standaard) : 0;
    var kerk = (est + kapBel) * kerkPct;

    var regels = [
      ['b_de_gross', bruto],
      ['b_de_lump', -aftrek],
      ['b_de_zve', zvE],
      ['b_de_est', est]
    ];
    if (soli) regels.push(['b_de_soli', soli]);
    if (kapBel) regels.push(['b_de_kap', kapBel + kapSoli]);
    if (kerk) regels.push(['b_de_kirche', kerk]);

    return {
      belastbaar: zvE, brutoBelasting: est, splitting: splitting,
      regels: regels,
      // hoeveel splitting oplevert ten opzichte van los belasten
      splitVoordeel: splitting
        ? (estTarief(+inp.bruto - j.arbeitnehmerPauschbetrag - j.sonderausgabenPauschbetrag, j) +
           estTarief((+inp.bruto2 || 0) - j.arbeitnehmerPauschbetrag - j.sonderausgabenPauschbetrag, j)) - est
        : 0,
      totaal: est + soli + kapBel + kapSoli + kerk
    };
  }

  function berekenPersoon(inp) {
    var f = fisc(); if (!f) return null;
    return land() === 'DE' ? berekenDE(inp, f.L) : berekenNL(inp, f.L);
  }

  // wat de volgende duizend euro kost
  function marginaal(inp) {
    var a = berekenPersoon(inp);
    var b = berekenPersoon(Object.assign({}, inp, { bruto: (+inp.bruto || 0) + 1000 }));
    if (!a || !b) return 0;
    return (b.totaal - a.totaal) / 1000;
  }

  function belastingInput() {
    function v(id) { var e = document.getElementById(id); return e ? e.value : ''; }
    function n(id) { return +v(id) || 0; }
    var samen = document.getElementById('b-partner').checked;
    return {
      partner: samen, splitting: samen,
      p1: { bruto: n('b-bruto1'), ingehouden: n('b-inh1') },
      p2: { bruto: samen ? n('b-bruto2') : 0, ingehouden: samen ? n('b-inh2') : 0 },
      woz: n('b-woz'), rente: n('b-rente'),
      spaar: n('b-spaar'), beleg: n('b-beleg'), schuld: n('b-schuld'),
      werkelijk: v('b-werkelijk'),
      kapitaal: n('b-kapitaal'), aftrekExtra: n('b-aftrek'),
      kerk: document.getElementById('b-kerk') ? document.getElementById('b-kerk').checked : false,
      kerkLaag: v('b-kerk-pct') === 'laag'
    };
  }

  // per land andere velden; wat niet van toepassing is verdwijnt
  function toonVelden() {
    [['woning', 'b-blok-woning'], ['box3', 'b-blok-box3'],
     ['kerk', 'b-blok-kerk'], ['kapitaal', 'b-blok-kapitaal'],
     ['ingehouden', 'b-blok-inh']].forEach(function (p) {
      var e = document.getElementById(p[1]);
      if (e) e.classList.toggle('hide', !heeftVeld(p[0]));
    });
    var lab = document.getElementById('b-partner-label');
    if (lab) lab.textContent = heeftVeld('splitting') ? T('b_splitting') : T('b_partner');
  }

  function renderBelasting() {
    var f = fisc();
    var host = document.getElementById('b-uit');
    if (!host) return;
    if (!f) { host.innerHTML = '<p class="muted">' + T('b_nodata') + '</p>'; return; }
    toonVelden();
    var i = belastingInput();
    var isNL = land() === 'NL';

    var a, b = null, verschuldigd, beste = { deel: 1 };

    if (isNL) {
      // de hypotheekrente verdelen over de partners zodat het samen het minst kost
      var opties = i.partner ? [0, 0.25, 0.5, 0.75, 1] : [1];
      beste = { deel: 1, som: Infinity };
      opties.forEach(function (d) {
        var x = berekenPersoon({ bruto: i.p1.bruto, woz: i.woz, rente: i.rente, deelRente: d,
                                 spaar: i.spaar, beleg: i.beleg, schuld: i.schuld,
                                 partner: i.partner, werkelijk: i.werkelijk });
        var y = i.partner ? berekenPersoon({ bruto: i.p2.bruto, woz: 0, rente: i.rente,
                                             deelRente: 1 - d, spaar: 0, beleg: 0, schuld: 0,
                                             partner: i.partner, werkelijk: '' }) : null;
        var som = x.totaal + (y ? y.totaal : 0);
        if (som < beste.som) beste = { deel: d, som: som, a: x, b: y };
      });
      a = beste.a; b = beste.b; verschuldigd = beste.som;
    } else {
      // Duitsland rekent het huishouden in één keer door
      a = berekenPersoon({ bruto: i.p1.bruto, bruto2: i.p2.bruto, splitting: i.splitting,
                           kapitaal: i.kapitaal, aftrekExtra: i.aftrekExtra,
                           kerk: i.kerk, kerkLaag: i.kerkLaag });
      verschuldigd = a.totaal;
    }

    var ingehouden = i.p1.ingehouden + i.p2.ingehouden;
    var saldo = ingehouden - verschuldigd;
    var mrg = marginaal(isNL
      ? { bruto: i.p1.bruto, woz: i.woz, rente: i.rente, deelRente: beste.deel,
          spaar: i.spaar, beleg: i.beleg, schuld: i.schuld, partner: i.partner,
          werkelijk: i.werkelijk }
      : { bruto: i.p1.bruto, bruto2: i.p2.bruto, splitting: i.splitting,
          kapitaal: i.kapitaal, aftrekExtra: i.aftrekExtra, kerk: i.kerk, kerkLaag: i.kerkLaag });
    var bruto = i.p1.bruto + i.p2.bruto;

    document.getElementById('b-kpis').innerHTML =
      kpi(T('b_due'), eur0(verschuldigd), T('b_due_sub')) +
      kpi(saldo >= 0 ? T('b_refund') : T('b_owe'), eur0(Math.abs(saldo)),
          ingehouden ? T('b_vs', { v: eur0(ingehouden) }) : T('b_no_withheld'),
          saldo >= 0 ? 'pos' : 'neg') +
      kpi(T('b_avg'), bruto ? Math.round(verschuldigd / bruto * 1000) / 10 + '%' : '–', T('b_avg_sub')) +
      kpi(T('b_marginal'), Math.round(mrg * 1000) / 10 + '%', T('b_marginal_sub'));

    // opbouw: elke rekenkern levert zijn eigen regels aan
    var rijen = a.regels.map(function (r) { return [T(r[0]), r[1]]; });
    if (b) {
      b.regels.forEach(function (r, idx) { rijen[idx][1] += r[1]; });
    }
    host.innerHTML = '<table><tbody>' +
      rijen.filter(function (r) { return Math.abs(r[1]) > 0.5; }).map(function (r) {
        return '<tr><td>' + r[0] + '</td><td class="num">' + eur(r[1]) + '</td></tr>';
      }).join('') +
      '<tr><td style="font-weight:700">' + T('b_total') + '</td><td class="num" style="font-weight:700">' +
      eur(verschuldigd) + '</td></tr></tbody></table>';

    // rechterkolom: box 3 (NL) of het voordeel van splitting (DE)
    var extra = document.getElementById('b-box3');
    if (isNL) {
      var v = a.vermogen;
      if (!v || v.grondslag <= 0) {
        extra.innerHTML = '<p class="muted">' + T('b_box3_none') + '</p>';
      } else {
        extra.innerHTML = '<table><tbody>' +
          '<tr><td>' + T('b_box3_base') + '</td><td class="num">' + eur0(v.grondslag) + '</td></tr>' +
          '<tr><td>' + T('b_box3_flat') + '</td><td class="num">' + eur(v.forfait) + '</td></tr>' +
          (v.werkelijk != null
            ? '<tr><td>' + T('b_box3_real') + '</td><td class="num">' + eur(v.werkelijk) + '</td></tr>' : '') +
          '<tr><td style="font-weight:700">' + T('b_box3_pay') + '</td><td class="num" style="font-weight:700">' +
          eur(v.te_betalen) + '</td></tr></tbody></table>' +
          (v.werkelijk != null && v.werkelijk < v.forfait
            ? '<div class="note ok mt">' + T('b_box3_win', { v: eur0(v.forfait - v.werkelijk) }) + '</div>' : '');
      }
    } else {
      extra.innerHTML = a.splitting
        ? '<p>' + T('b_split_p') + '</p><p style="font-size:28px;font-weight:700">' +
          eur0(Math.max(0, a.splitVoordeel)) + '</p><div class="note mt">' + T('b_split_note') + '</div>'
        : '<p class="muted">' + T('b_split_off') + '</p>';
    }

    // scenario wetsvoorstel: alleen waar er een voorstel loopt
    var vk = document.getElementById('b-voorstel-kaart');
    var V = f.L.voorstel;
    if (!V) { if (vk) vk.classList.add('hide'); }
    else {
      if (vk) vk.classList.remove('hide');
      var werkelijk = +i.werkelijk || 0;
      var vrijR = V.heffingsvrijResultaat * (i.partner ? 2 : 1);
      var voorstelBel = Math.max(0, werkelijk - vrijR) * V.tarief;
      document.getElementById('b-voorstel').innerHTML =
        '<div class="note warn">' + T('b_prop_warn', { n: V.naam, s: V.status, j: V.ingang }) + '</div>' +
        '<table class="mt"><tbody>' +
        '<tr><td>' + T('b_prop_real') + '</td><td class="num">' + eur0(werkelijk) + '</td></tr>' +
        '<tr><td>' + T('b_prop_free') + '</td><td class="num">' + eur0(vrijR) + '</td></tr>' +
        '<tr><td style="font-weight:700">' + T('b_prop_tax') + '</td><td class="num" style="font-weight:700">' +
        eur(voorstelBel) + '</td></tr>' +
        '<tr><td class="muted">' + T('b_prop_now') + '</td><td class="num muted">' +
        eur((a.vermogen || {}).te_betalen || 0) + '</td></tr></tbody></table>';
    }

    document.getElementById('b-bron').textContent =
      T('b_source', { d: dmy(f.F.peildatum), b: f.L.bron }) + ' · ' + f.L.naam + ' ' + f.L.jaar;

    var res = document.getElementById('b-reserve');
    if (saldo < -100) {
      res.innerHTML = '<div class="note mt">' + T('b_reserve', { v: eur0(-saldo / 12) }) +
        ' <button class="btn" id="b-pot">' + T('b_reserve_btn') + '</button></div>';
      document.getElementById('b-pot').addEventListener('click', function () {
        S.potjes = (S.potjes || []).concat([{ naam: T('b_pot_name'), doel: Math.round(-saldo),
                                              datum: '', stand: 0 }]);
        save(); renderPotjes(); flash(T('j_added'));
      });
    } else { res.innerHTML = ''; }
  }

  g.HB_PRO = {
    toonVelden: toonVelden,
    landen: function () {
      var F = window.HB_FISCAAL;
      return F && F.landen ? Object.keys(F.landen).map(function (k) {
        return { code: k, naam: F.landen[k].naam, jaar: F.landen[k].jaar };
      }) : [];
    },
    renderPrognose: renderPrognose,
    renderPotjes: renderPotjes,
    renderAnalyse: renderAnalyse,
    renderAudit: renderAudit,
    renderBelasting: renderBelasting,
    addPotje: addPotje,
    prognose: prognose,
    auditRecurring: auditRecurring
  };
})(window);
