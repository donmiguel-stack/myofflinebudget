/* Fiscale tabellen — Nederland.
   Dit bestand is bewust los gehouden: een nieuw belastingjaar is een datawijziging,
   geen codewijziging. Peildatum en bron staan erbij en worden in de app getoond.

   Bronnen:
   - Belastingdienst, tarieven en heffingskortingen (voorlopige aanslag 2026)
   - Belastingdienst, tabel arbeidskorting 2026
   - Belastingplan 2026 (hypotheekrenteaftrek begrensd op 37,56%)
   - Wetsvoorstel Wet werkelijk rendement box 3 (aangenomen Tweede Kamer 12-02-2026,
     in behandeling Eerste Kamer, beoogde ingang 01-01-2028)
*/
(function (g) {
  g.HB_FISCAAL = {
    land: 'NL',
    peildatum: '2026-08-11',
    bron: 'Belastingdienst, Belastingplan 2026',
    jaren: {
      2026: {
        status: 'geldend',
        // box 1, niet-AOW
        schijven: [
          { tot: 38883, pct: 0.3575 },
          { tot: 78426, pct: 0.3756 },
          { tot: Infinity, pct: 0.4950 }
        ],
        // algemene heffingskorting: maximum, afbouw lineair naar nul
        ahk: { max: 3115, vanaf: 29736, tot: 78426 },
        // arbeidskorting: opbouw per schijf (basis + pct over het meerdere)
        ak: [
          { tot: 11965, basis: 0, pct: 0.08324, vanaf: 0 },
          { tot: 25845, basis: 996, pct: 0.31009, vanaf: 11965 },
          { tot: 45592, basis: 5300, pct: 0.01950, vanaf: 25845 },
          { tot: 132920, basis: 5685, pct: -0.06510, vanaf: 45592 },
          { tot: Infinity, basis: 0, pct: 0, vanaf: 0 }
        ],
        // eigen woning
        ewf: 0.0035,            // eigenwoningforfait, hoofdcategorie
        ewfGrens: 1350000,      // daarboven 2,35% over het meerdere
        ewfHoog: 0.0235,
        aftrekMax: 0.3756,      // tariefsaanpassing aftrekposten
        // box 3, forfaitair stelsel
        box3: {
          tarief: 0.36,
          heffingsvrij: 59357,   // per persoon
          spaargeld: 0.0128,
          overig: 0.0600,
          schulden: 0.0270,
          schuldDrempel: 3800    // per persoon
        }
      }
    },
    // Wetsvoorstel: uitdrukkelijk geen geldend recht.
    voorstel: {
      naam: 'Wet werkelijk rendement box 3',
      status: 'aangenomen Tweede Kamer 12-02-2026, in behandeling Eerste Kamer',
      ingang: 2028,
      tarief: 0.36,
      heffingsvrijResultaat: 1800,   // per persoon per jaar
      verliesdrempel: 500,
      vastgoedForfait: 0.0335        // over de WOZ-waarde bij eigen gebruik
    },
    // CPI, jaarmutatie in procenten (CBS). Voor de reële vergelijking per categorie.
    inflatie: {
      2019: 2.6, 2020: 1.3, 2021: 2.7, 2022: 10.0, 2023: 3.8,
      2024: 3.2, 2025: 3.3, 2026: 3.0
    }
  };
})(window);
