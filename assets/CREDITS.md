# Chart artwork

Supplied by the project owner. The compass rose and the galleon are cropped
out of `treasure-map.webp` at render time (see `CHROME.plateCrop` in
chrome.js) rather than being saved as separate files, so there is one source
of truth per image.

| File | Used for | Where |
|---|---|---|
| `treasure-map.webp` | compass rose + galleon, cropped from the plate | coast chart |
| `sea-monster.webp` | lone sea monster, antique map detail | page marginalia |
| `sea-serpent.webp` | sea serpent | page marginalia |
| `ouroboros.webp` | serpent taking its tail | page marginalia |

Each is composited through the `#ink-stamp` SVG filter, which pushes contrast,
forces the ink flat to the palette olive and sets alpha to (1 - luminance), so
the paper drops out and only the linework survives. A radial mask then softens
the plate edge so nothing reads as a pasted rectangle.

Crops are also chosen to exclude the screenshot UI overlays present in the
bottom-right of some of the source files.
