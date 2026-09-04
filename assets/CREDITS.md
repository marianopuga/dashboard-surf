# Chart artwork

Supplied by the project owner.

| File | Used for | Where |
|---|---|---|
| `treasure-map.webp` | source plate the galleon is cut from | not rendered directly |
| `ship-cutout.png` | the galleon, pre-cut from `treasure-map.webp` | coast chart |
| `sea-monster.webp` | lone sea monster, antique map detail | masthead marginalia |
| `sea-serpent.webp` | sea serpent | masthead marginalia |
| `ouroboros.webp` | serpent taking its tail | unused |
| `an-old-map-of-the-world-with-a-map-of-the-world-photo.jpg` | source for the page ground | not rendered directly |
| `map-backdrop.jpg` | the page ground | `body` background, once, at `cover` |
| `paper-fibre.png` | paper tooth | `body` background, tiled |

## Why the page ground is one big image plus procedural noise

The obvious move was to cut a seamless tile out of the reference photograph
and repeat it. That fails, and the reason is worth writing down: the
photograph is *of a map*. Every patch of it carries drawn coastline, a rhumb
line or lettering, so any tile cut from it repeats recognisable content — the
result reads as patterned wallpaper with an obvious grid, not as paper. A
stddev sweep did find the flattest region (around x=240,y=240, mean
rgb(176,139,78), the tone `--parchment` is taken from), but "flattest" there
still meant visible drawing.

So the photograph is used **once**, upscaled and softened to `map-backdrop.jpg`
and baked 62% toward `--parchment` so text laid over it stays readable. One
image at `cover` has no seam to find.

Paper *tooth* is a separate problem and does tile, because tooth is just fine
noise and noise wraps by construction. `paper-fibre.png` is 256px of seeded
Gaussian noise, generated rather than sampled, so it carries no content to
recognise.

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
