# Changelog

Alle nennenswerten Änderungen an diesem Projekt werden in dieser Datei dokumentiert.

## [2.0.0] - 2026-03-07

### Added
- Freie Tankstellensuche per Ort, Adresse oder PLZ
- Standortsuche per Browser-Geolocation
- Filter nach Radius und Kraftstoffart
- Sortierung der Ergebnisse nach Preis, Entfernung und Name
- Favoritenverwaltung mit Speicherung im Browser (`localStorage`)
- Hervorhebung des günstigsten Ergebnisses
- Leere Zustände und klare Rückmeldungen bei fehlenden Treffern
- Responsive UI für Desktop und Mobile
- Light-/Dark-Mode mit persistenter Speicherung
- Klare Dokumentationshinweise zur lokalen Nutzung mit eigenem API-Key

### Changed
- Projekt von einer festen 5-Tankstellen-Ansicht zu einer flexibleren Such- und Vergleichsoberfläche weiterentwickelt
- Frontend vollständig auf Such- und Favoriten-Workflow umgestellt
- UI und visuelle Hierarchie umfassend modernisiert
- Suchbereich, Ergebnislisten und Kartenlayout deutlich überarbeitet
- Komponenten, Abstände, Kontraste und States konsistenter und hochwertiger abgestimmt
- Mobile Darstellung und allgemeine UX deutlich verbessert
- README und Dokumentation an den aktuellen Produktstand angepasst

### Technical
- Serverseitiger API-Proxy für Tankerkönig-Abfragen beibehalten
- API-Key-Schutz durch rein serverseitige Verarbeitung
- Read-Proxy-Fallback für robustere Datenverarbeitung integriert
- Frameworkfreie Umsetzung mit HTML, CSS, Vanilla JavaScript und PHP

## [1.0.0] - 2026-03-06

### Added
- Erste öffentliche Version von Spritblick
- Vergleichsansicht für 5 ausgewählte Super-E5-Tankstellen
- Dynamische Kartenansicht mit Preis- und Statusdarstellung
- Dark-/Light-Theme mit Speicherung im Browser
- Dokumentationsdateien: `README.md`, `CHANGELOG.md`, `LICENSE`

### Technical
- Serverseitiger Preisabruf mit Read-Proxy, Direktabruf und Cache-Fallback
