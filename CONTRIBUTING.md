# Meehelpen

Het handigst zijn parsers voor banken die er nog niet in zitten.

1. Open `src/parsers.js`. Elke bank is één functie die een lijst regels teruggeeft in de vorm
   `{date:'2026-08-05', amount:-42.15, desc:'...', account:'...', bank:'...'}`.
2. Voeg de herkenning toe in `detectAndParse` (voor pdf) of laat de generieke `fromTable` het werk doen (csv/xlsx).
3. Draai `python3 build.py` en test met een echt afschrift.

Deel **nooit** een afschrift met echte gegevens in een issue of pull request. Een geanonimiseerd
voorbeeld van twee of drie regels is genoeg om een opmaak te kunnen nabouwen.

Verder welkom: categorieregels voor winkels en diensten in `src/rules.json`, vertalingen,
en verbeteringen aan de toegankelijkheid.
