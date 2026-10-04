# Design files

Figma file (editable, auto-layout, colour variables for light and dark): https://www.figma.com/design/IXpm1JFOAhfVPGI8lyFmhS

- `figma-desktop.png` — export of the Figma desktop screen.

- `screen-desktop.png`, `screen-compare.png`, `screen-stress.png`, `screen-assumptions.png`, `screen-mobile.png` — renders of the tabs taken offline (the map shows a plain drawing when map tiles cannot load; online it shows the real street map).
- `figma-desktop.png` reflects the earlier single-page layout; the tabbed layout is the current design.
- `design-tokens.json` — colours (light + dark), fonts, type scale, radius, spacing.

## Bring it into Figma
1. In Figma, create a Design file and drag the three PNGs onto the canvas as reference frames (1440 wide desktop, 400 wide mobile).
2. Create colour variables from `design-tokens.json` with two modes, Light and Dark (or use the free "Tokens Studio" plugin to import the JSON).
3. Add text styles: Archivo ExtraBold (headings), Public Sans (body 15/22), IBM Plex Mono (numbers, 11px uppercase labels). All are free on Google Fonts.
4. Rebuild components on top of the reference: Panel, KPI tile, Rank row, Chip (go / warn / risk), Slider control, Upload drop-zone.
