/* Fiscale tabellen per land.

   Dit bestand is bewust losgehouden van de code: een nieuw belastingjaar of een extra
   land is een datawijziging. Peildatum en bron staan erbij en worden in de app getoond.

   LET OP bij het uitbrengen: controleer de cijfers hieronder tegen de wettekst van het
   betreffende jaar. Vooral de Duitse coëfficiënten (zie de opmerking daar) horen te
   worden vervangen door de letterlijke waarden uit §32a EStG.
*/
(function (g) {
  g.HB_FISCAAL = {
    peildatum: '2026-08-11',
    standaardLand: 'NL',

    landen: {

      // ================================================================ NEDERLAND
      NL: {
        naam: 'Nederland',
        jaar: 2026,
        bron: 'Belastingdienst, Belastingplan 2026',
        // welke invoervelden dit land nodig heeft
        velden: ['bruto', 'ingehouden', 'partner', 'woning', 'box3'],

        schijven: [
          { tot: 38883, pct: 0.3575 },
          { tot: 78426, pct: 0.3756 },
          { tot: Infinity, pct: 0.4950 }
        ],
        ahk: { max: 3115, vanaf: 29736, tot: 78426 },
        ak: [
          { tot: 11965, basis: 0, pct: 0.08324, vanaf: 0 },
          { tot: 25845, basis: 996, pct: 0.31009, vanaf: 11965 },
          { tot: 45592, basis: 5300, pct: 0.01950, vanaf: 25845 },
          { tot: 132920, basis: 5685, pct: -0.06510, vanaf: 45592 },
          { tot: Infinity, basis: 0, pct: 0, vanaf: 0 }
        ],
        ewf: 0.0035,
        ewfGrens: 1350000,
        ewfHoog: 0.0235,
        aftrekMax: 0.3756,
        box3: {
          tarief: 0.36,
          heffingsvrij: 59357,
          spaargeld: 0.0128,
          overig: 0.0600,
          schulden: 0.0270,
          schuldDrempel: 3800
        },
        voorstel: {
          naam: 'Wet werkelijk rendement box 3',
          status: 'aangenomen Tweede Kamer 12-02-2026, in behandeling Eerste Kamer',
          ingang: 2028,
          tarief: 0.36,
          heffingsvrijResultaat: 1800
        }
      },

      // ================================================================ DUITSLAND
      DE: {
        naam: 'Deutschland',
        jaar: 2026,
        bron: '§32a EStG (Steuerfortentwicklungsgesetz)',
        velden: ['bruto', 'ingehouden', 'splitting', 'kerk', 'kapitaal'],

        /* Het Duitse tarief is geen schijventabel maar een formule met vijf zones.
           De zonegrenzen en de marginale tarieven (14% → 23,97% → 42% → 45%) liggen vast;
           de coëfficiënten hieronder zijn daaruit afgeleid en sluiten aan op de twee
           gepubliceerde constanten van zone 4 en 5 tot op ruim een euro na. Dat is ruim
           genoeg voor een schatting, maar vervang ze door de letterlijke waarden uit
           §32a voordat je dit uitlevert. */
        grundfreibetrag: 12348,
        zones: {
          z2Tot: 17799, z2a: 914.51, z2b: 1400,
          z3Tot: 69878, z3a: 173.10, z3b: 2397,
          z4Tot: 277826, z4pct: 0.42, z4c: 11135.63,
          z5pct: 0.45, z5c: 19470.41
        },
        // forfaitaire aftrekposten die vrijwel iedereen heeft
        arbeitnehmerPauschbetrag: 1230,
        sonderausgabenPauschbetrag: 36,

        soli: { pct: 0.055, vrij: 20350, vrijSplitting: 40700, milderung: 0.119 },
        kirchensteuer: { standaard: 0.09, laag: 0.08, lageLanden: ['Bayern', 'Baden-Württemberg'] },
        // inkomsten uit vermogen: apart tarief, met een vrijstelling per persoon
        abgeltung: { pct: 0.25, sparerPauschbetrag: 1000 }
      }
    },

    // CPI, jaarmutatie in procenten. NL: CBS. DE: Destatis.
    inflatie: {
      NL: { 2019: 2.6, 2020: 1.3, 2021: 2.7, 2022: 10.0, 2023: 3.8, 2024: 3.2, 2025: 3.3, 2026: 3.0 },
      DE: { 2019: 1.4, 2020: 0.5, 2021: 3.1, 2022: 6.9, 2023: 5.9, 2024: 2.2, 2025: 2.1, 2026: 2.0 }
    }
  };

  // Terugvalwaarde voor de analyse: het land van de gebruiker bepaalt de reeks.
  g.HB_FISCAAL.inflatieVoor = function (land) {
    var i = g.HB_FISCAAL.inflatie;
    return i[land] || i.NL;
  };
})(window);
