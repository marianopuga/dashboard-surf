# Chart artwork

Supplied by the project owner.

| File | Used for | Where |
|---|---|---|
| `treasure-map.webp` | source plate the galleon is cut from | not rendered directly |
| `ship-cutout.png` | the galleon, pre-cut from `treasure-map.webp` | coast chart |
| `sea-monster.webp` | lone sea monster, antique map detail | masthead marginalia |
| `sea-serpent.webp` | sea serpent | masthead marginalia |
| `ouroboros.webp` | serpent taking its tail | unused |
| `sea-unicorn.jpg` | sea unicorn, antique map detail | page marginalia, left |
| `sea-dragon.jpg` | sea dragon woodcut | page marginalia, right |
| `kraken.jpg` | kraken and galleons | page marginalia, lower left |
| `an-old-map-of-the-world-with-a-map-of-the-world-photo.jpg` | unused — see below | not rendered |
| `paper-fibre.png` | paper tooth | `body` background, tiled |

## Why the plates are levelled before use

All five marginalia go through one shared SVG filter (`#ink-stamp`), which
turns luminance into alpha: below L=0.267 a pixel is solid ink, above L=0.6 it
is gone, and in between it is partly transparent. That middle band is what
reads as fog.

The sources disagreed wildly about how much of themselves sat in it:

| plate | solid ink | partial (fog) |
|---|---|---|
| sea-serpent | 3.9% | 20.3% |
| sea-monster | 10.5% | 24.4% |
| sea-unicorn | 12.0% | 8.0% |
| sea-dragon | 6.2% | 9.3% |
| kraken | 15.3% | **34.4%** |

So the two line engravings came out crisp and the kraken came out as a smudge —
not because of anything in the CSS, but because a third of it is half-tone wash
and the filter cannot tell wash from paper.

Each plate is therefore levelled once, offline: auto-levelled to a common black
and white, then put through the midpoint/contrast pair that lands its histogram
on ~11% solid and ~9% partial. Afterwards the spread is 8.4–12.7% solid and
6.6–10.1% partial, and every plate can sit at the same opacity in CSS.

Originals are recoverable from git history if the curve ever needs redoing.

## Why the kraken is a crop

It arrived as a whole illustrated sheet — title, a destruction-data table,
callout labels and an inset map. The lettering does not survive reading (it is
pastiche, not real words), and a page of it in the margin would have invited
exactly that reading. Cropped to the creature and the galleons in its grip,
which is the only part that works as a chart marginal, and the crop is tight
enough that nothing but the creature is left.

## Why the page ground is drawn rather than photographed

The reference photograph was used as the page background for one iteration and
removed. It is worth writing down why, because the idea keeps looking good on
paper.

Tiling it fails first: the photograph is *of a map*, so every patch of it
carries drawn coastline, a rhumb line or lettering. Any tile cut from it
repeats recognisable content and reads as patterned wallpaper. A stddev sweep
did find its flattest region — around x=240,y=240, mean rgb(176,139,78), which
is where `--parchment` comes from — but "flattest" there still meant visible
drawing.

Using it once at `cover` fixes the repeat and still fails, for a worse reason:
it arrives carrying its own coastlines, its own graticule at its own angle and
its own lettering, none of which agree with the chart laid on top of it. Two
maps at two scales pointing two ways read as a collision, not as a surface.

What actually reads as "old map" is not any particular map. It is a handful of
marks — a graticule, rhumb lines fanning from bearing nodes — and the fact that
a hand ruled them and got them slightly wrong. So `CHROME.pageGround` draws
those, at this page's own scale, faint enough to sit under the content, with
every line pushed off true by an amount that peaks at its middle and falls to
zero at its ends, which is how a hand-ruled line actually fails.

The photograph is kept in `assets/` as the source the parchment tone was
sampled from.

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
