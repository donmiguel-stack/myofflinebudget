/* Testset voor de importparsers. Draaien met:  node tests/parsers.test.js
   Geen afhankelijkheden. De CAMT-parser (DOMParser, alleen in de browser) wordt
   apart getest via de end-to-end-browsertest; alle overige parsers hier. */
'use strict';
const fs = require('fs');
const path = require('path');

global.window = {};
const bron = fs.readFileSync(path.join(__dirname, '..', 'src', 'parsers.js'), 'utf8');
eval(bron.replace('})(window);', '})(global.window);'));
const P = global.window.HBParsers;

let geslaagd = 0, gefaald = 0;
function test(naam, conditie, detail) {
  if (conditie) { geslaagd++; }
  else { gefaald++; console.log('FAIL:', naam, detail === undefined ? '' : JSON.stringify(detail)); }
}
function lees(naam) { return fs.readFileSync(path.join(__dirname, 'samples', naam), 'utf8'); }

// ---------------------------------------------------------------- nl(): getalformaten
[['1.234,56', 1234.56], ['1,234.56', 1234.56], ['12,50', 12.5], ['-12,50', -12.5],
 ['1.234.567,89', 1234567.89], ['1,234,567.89', 1234567.89], ['1,234,567', 1234567],
 ['€ 49,00', 49], ['100', 100], ['0,05', 0.05], ['12.5', 12.5], ['2500.00', 2500],
 ['-1,234.56', -1234.56], ['49,95-', -49.95]].forEach(function (c) {
  test('nl(' + c[0] + ')', Math.abs(P.nl(c[0]) - c[1]) < 1e-9, P.nl(c[0]));
});

// ---------------------------------------------------------------- datums
test('iso-datum', P.dateFromAny('2026-03-01') === '2026-03-01');
test('jjjjmmdd', P.dateFromAny('20260301') === '2026-03-01');
test('dmy', P.dateFromAny('01-03-2026') === '2026-03-01');
test('mdy expliciet', P.dateFromAny('03/01/2026', 'mdy') === '2026-03-01');
test('dag>12 wint', P.dateFromAny('13/03/2026', 'mdy') === '2026-03-13');

// ---------------------------------------------------------------- ING CSV
const ing = P.parseIngCsv(lees('ing.csv'));
test('ING: 1 rij', ing && ing.length === 1);
test('ING: bedrag/datum', ing && ing[0].amount === -23.45 && ing[0].date === '2026-03-01');

// ---------------------------------------------------------------- ABN AMRO TXT
const abn = P.parseAbnTxt(lees('abn-amro.txt'));
test('ABN: 2 rijen', abn && abn.length === 2, abn);
test('ABN: bedragen', abn && abn[0].amount === -50 && abn[1].amount === 2500);
test('ABN: datums', abn && abn[0].date === '2026-03-01' && abn[1].date === '2026-03-02');
test('ABN: omschrijving', abn && /ALBERT HEIJN/.test(abn[0].desc));
test('ABN: bank', abn && abn[0].bank === 'ABN AMRO');
test('ABN: weigert gewone CSV', P.parseAbnTxt(lees('ing.csv')) === null);
test('ABN: weigert lege invoer', P.parseAbnTxt('') === null);

// ---------------------------------------------------------------- debet/credit-paar
const trio = P.fromTable(P.splitCSV(lees('triodos-debetcredit.csv')), {});
test('deb/cred: geen fout', !trio.error, trio.error);
test('deb/cred: 2 rijen', trio.rows.length === 2, trio.rows);
test('deb/cred: debet negatief', trio.rows[0].amount === -23.45);
test('deb/cred: credit positief', trio.rows[1].amount === 2500);
test('deb/cred: bedragen niet in omschrijving', !/23,45|2500/.test(trio.rows[0].desc + trio.rows[1].desc));

// ---------------------------------------------------------------- generiek: EN-formaat
const en = P.fromTable(P.splitCSV(lees('en-format.csv')), {});
test('EN: bedragen goed', en.rows.length === 2 && en.rows[0].amount === -1234.56 && en.rows[1].amount === 2500);
test('EN: mdy-datums', en.rows[0].date === '2026-03-15' && en.rows[1].date === '2026-03-02', en.rows.map(function (r) { return r.date; }));

// ---------------------------------------------------------------- Rabobank PDF (synthetisch)
function woord(s, x, x1) { return { s: s, x: x, x1: x1 || x + s.length * 5 }; }
function regel(text, words, parts) {
  return { y: 0, text: text,
           words: words || text.trim().split(/\s+/).map(function (w, i) { return woord(w, 40 + i * 60); }),
           parts: parts || [] };
}
const vd = regel('Verwerkingsdatum: 01-03-2026');

// standaardlayout: kopwoorden Af (x1=440) en Bij (x1=520)
const kop = regel('Datum Omschrijving Af Bij', null,
  [{ s: 'Af', x: 420, x1: 440 }, { s: 'Bij', x: 505, x1: 520 }]);
const txAf = regel('01-03 ba Albert Heijn BETAALAUTOMAAT', [
  woord('01-03', 40), woord('ba', 75), woord('Albert', 100), woord('Heijn', 140),
  woord('BETAALAUTOMAAT', 200), woord('23,45', 415, 440)]);
let rb = P.parseRabo([[regel('IBAN NL12 RABO 0123 4567 89'), kop, txAf, vd]], 2026);
test('Rabo: IBAN uit afschrift', rb[0].account === 'NL12RABO0123456789', rb[0].account);
test('Rabo: Af-kant negatief', rb[0].amount === -23.45, rb[0].amount);
test('Rabo: verwerkingsdatum', rb[0].date === '2026-03-01');

// verschoven layout (zou met vaste 380/490 fout gaan): Af x1=300, Bij x1=360
const kop2 = regel('Datum Omschrijving Af Bij', null,
  [{ s: 'Af', x: 285, x1: 300 }, { s: 'Bij', x: 345, x1: 360 }]);
const txAf2 = regel('02-03 ba Jumbo', [
  woord('02-03', 40), woord('ba', 75), woord('Jumbo', 100), woord('17,12', 275, 298)]);
const txBij2 = regel('03-03 cb Salaris', [
  woord('03-03', 40), woord('cb', 75), woord('Salaris', 100), woord('2.500,00', 330, 358)]);
rb = P.parseRabo([[kop2, txAf2, regel('Verwerkingsdatum: 02-03-2026'),
                   txBij2, regel('Verwerkingsdatum: 03-03-2026')]], 2026);
test('Rabo verschoven: Af negatief', rb[0].amount === -17.12, rb.map(r => r.amount));
test('Rabo verschoven: Bij positief', rb[1].amount === 2500, rb.map(r => r.amount));
test('Rabo verschoven: terugval-account', rb[0].account === 'Rabobank');

// zonder kopwoorden: oude vaste posities blijven gelden
const txOud = regel('04-03 ba Kruidvat', [
  woord('04-03', 40), woord('ba', 75), woord('Kruidvat', 100), woord('9,99', 420, 445)]);
rb = P.parseRabo([[txOud, regel('Verwerkingsdatum: 04-03-2026')]], 2026);
test('Rabo terugval: oud gedrag intact', rb[0].amount === -9.99, rb[0].amount);

// ---------------------------------------------------------------- klaar
console.log(geslaagd + ' geslaagd, ' + gefaald + ' gefaald');
process.exit(gefaald ? 1 : 0);
