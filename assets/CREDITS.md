# Chart artwork

Supplied by the project owner.

| File | Used for | Where |
|---|---|---|
| `treasure-map.webp` | source plate the galleon is cut from | not rendered directly |
| `ship-cutout.png` | the galleon, pre-cut from `treasure-map.webp` | coast chart |
| `sea-monster.webp` | lone sea monster, antique map detail | masthead marginalia |
| `sea-serpent.webp` | sea serpent | masthead marginalia |
| `ouroboros.webp` | serpent taking its tail | unused |

## Why the galleon is a baked cutout, not a live crop

The rose and an earlier ship crop were drawn as a live `CHROME.plateCrop` out
of `treasure-map.webp`, composited through an SVG luminance-to-alpha filter at
render time. That works when the unwanted background is *lighter* than the
subject — the filter can threshold it away. It fails when a background
element is drawn in the same ink weight as the subject: the treasure map's
decorative rhumb-line lattice crosses directly through the ship's rigging at
full ink darkness, so no luminance threshold can separate "line belongs to the
grid" from "line belongs to the sail". Any threshold hard enough to drop the
grid line also had to drop real hull/rigging ink, and any threshold gentle
enough to keep the rigging left the grid line visible.

`ship-cutout.png` is generated once, offline, with per-pixel judgement instead
of a single global rule (see the generation notes kept alongside this file in
the project's working history) — the stray grid line is manually excluded,
everything that is unambiguously the ship is kept, and the result is saved
with real alpha. It renders through the same `#ink-stamp-strong` filter as the
other chart plates (`.plate-ship`), which remaps its ink to the palette's
Raisin and gives it the same soft edge — the filter still does that part, it
just no longer has to *decide* what is background.

The rose is no longer drawn on the chart. The rhumb lines still radiate from
an unmarked node where it used to sit — ordinary on a real portolan chart.
