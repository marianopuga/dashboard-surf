// Northern Beaches spots, ordered south → north (Shelly Beach to Long Reef).
// lat/lng are anchored to the OSM `natural=beach` features of the same name, so each
// pin lands on the actual shoreline; app.js then snaps it to the nearest point on the
// coastline path in coast.js. (The earlier hand-estimated coordinates sat up to ~900 m
// inland, which put every pin in the middle of the suburbs.)
// facing_deg = compass direction the beach faces (outward, into the ocean).
// swell_window = [min,max] swell direction (deg) that can reach this spot reasonably well.
// good_size_m = [min,max] MHL Hs (significant wave height) that tends to be rideable here.
// min_period_s = swell period below which this spot barely works (reef/point breaks need more).
// tide_pref = "mid-high" for reef/rock spots that get too shallow/exposed at low tide.
//
// These numbers are a rough approximation from general local knowledge of how each
// beach is sheltered by the headlands around it — NOT measured data, and not a
// substitute for checking the spot yourself. Treat the ranking as a starting point.
const SPOTS = [
  {
    id: "shelly", name: "Shelly Beach", short: "Shelly", order: 1, kind: "beach",
    lat: -33.8005, lng: 151.2979, facing_deg: 45,
    swell_window: [20, 90], min_period_s: 0, good_size_m: [0.3, 1.5], tide_pref: null,
    note: "A very sheltered bay behind North Head. Needs NE swell to get in; with S/SE swell it's nearly flat. A good call in strong S/SW wind, since the headland blocks it.",
    surfline_url: "https://www.surfline.com/surf-report/shelly-beach-manly/584204204e65fad6a77092fd",
    windguru_id: "208682",
  },
  {
    id: "fairybower", name: "Fairy Bower", short: "Fairy Bower", order: 2, kind: "reef",
    lat: -33.7997, lng: 151.2952, facing_deg: 55,
    swell_window: [25, 100], min_period_s: 9, good_size_m: [0.5, 2], tide_pref: "mid-high",
    note: "A right-hand point next to Shelly, breaking over rock. Best with some tide (not dry) and NE-E swell with long period. No dedicated Surfline page.",
    surfline_url: null,
    windguru_id: "208682",
  },
  {
    id: "manly-south", name: "Manly (South Steyne)", short: "Manly S", order: 3, kind: "beach",
    lat: -33.7985, lng: 151.2887, facing_deg: 80,
    swell_window: [50, 140], min_period_s: 0, good_size_m: [0.5, 2.5], tide_pref: null,
    note: "Open beach, variable sandbank. Picks up almost any E-SE swell, somewhat sheltered from pure S by North Head.",
    surfline_url: "https://www.surfline.com/surf-report/manly-beach-south-steyne/584204204e65fad6a77093e3",
    windguru_id: "208682",
  },
  {
    id: "manly-north", name: "Manly (North Steyne)", short: "Manly N", order: 4, kind: "beach",
    lat: -33.793, lng: 151.2877, facing_deg: 80,
    swell_window: [50, 140], min_period_s: 0, good_size_m: [0.5, 2.5], tide_pref: null,
    note: "Same beach as South Steyne, northern end. Sandbanks tend to differ somewhat.",
    surfline_url: "https://www.surfline.com/surf-report/manly-beach-north-steyne/5d7ac1f48b90df000129e6ca",
    windguru_id: "208682",
  },
  {
    id: "queenscliff", name: "Queenscliff", short: "Queenscliff", order: 5, kind: "beach",
    lat: -33.7882, lng: 151.2872, facing_deg: 85,
    swell_window: [55, 145], min_period_s: 0, good_size_m: [0.5, 2.5], tide_pref: null,
    note: "Northern continuation of Manly, separated by a small lagoon. Open beachbreak similar to Manly.",
    surfline_url: "https://www.surfline.com/surf-report/queenscliff/584204204e65fad6a77093e1",
    windguru_id: "208682",
  },
  {
    id: "deadmans", name: "Deadman's", short: "Deadman's", order: 6, kind: "reef",
    lat: -33.7848, lng: 151.2889, facing_deg: 95,
    swell_window: [70, 150], min_period_s: 11, good_size_m: [1, 3], tide_pref: "mid-high",
    note: "Reef at the northern end of Queenscliff. Needs more size/period than the neighbouring beaches; very low tide leaves it exposed and dangerous.",
    surfline_url: "https://www.surfline.com/surf-report/deadmans/60f8644556831fd384ac4e6d",
    windguru_id: "208682",
  },
  {
    id: "freshwater", name: "Freshwater", short: "Freshwater", order: 7, kind: "beach",
    lat: -33.7821, lng: 151.2912, facing_deg: 90,
    swell_window: [60, 150], min_period_s: 0, good_size_m: [0.5, 2.5], tide_pref: null,
    note: "One of the most consistent beachbreaks in the area, fairly exposed to E-SE.",
    surfline_url: "https://www.surfline.com/surf-report/freshwater/584204204e65fad6a77093e0",
    windguru_id: "208683",
  },
  {
    id: "curlcurl-south", name: "Curl Curl South", short: "Curl Curl S", order: 8, kind: "beach",
    lat: -33.7724, lng: 151.2955, facing_deg: 95,
    swell_window: [65, 155], min_period_s: 0, good_size_m: [0.5, 2.5], tide_pref: null,
    note: "Southern end of Curl Curl, separated from the north by the lagoon. Surfline treats it as one spot with the north; in practice they break similarly.",
    surfline_url: "https://www.surfline.com/surf-report/curl-curl/5842041f4e65fad6a7708bfb",
    windguru_id: "208683",
  },
  {
    id: "curlcurl-north", name: "Curl Curl North", short: "Curl Curl N", order: 9, kind: "beach",
    lat: -33.7676, lng: 151.2979, facing_deg: 95,
    swell_window: [65, 155], min_period_s: 0, good_size_m: [0.5, 2.5], tide_pref: null,
    note: "Northern end of Curl Curl. Shares a Surfline spot with the south; conditions are very similar in practice.",
    surfline_url: "https://www.surfline.com/surf-report/curl-curl/5842041f4e65fad6a7708bfb",
    windguru_id: "208683",
  },
  {
    id: "deewhy", name: "Dee Why", short: "Dee Why", order: 10, kind: "beach",
    lat: -33.7522, lng: 151.2995, facing_deg: 100,
    swell_window: [70, 160], min_period_s: 0, good_size_m: [0.5, 2.5], tide_pref: null,
    note: "Open beach plus Dee Why Point (reef) at the northern end, which needs more SE swell.",
    surfline_url: "https://www.surfline.com/surf-report/dee-why-point/5842041f4e65fad6a7708bfa",
    windguru_id: "208683",
  },
  {
    id: "longreef", name: "Long Reef", short: "Long Reef", order: 11, kind: "reef",
    lat: -33.7443, lng: 151.3091, facing_deg: 120,
    swell_window: [90, 170], min_period_s: 10, good_size_m: [1, 3], tide_pref: "mid-high",
    note: "The most S/SE-exposed spot in the whole stretch: works with swells more southerly than anywhere else. Reef, take care at very low tide.",
    surfline_url: "https://www.surfline.com/surf-report/long-reef/584204204e65fad6a77093de",
    windguru_id: "208684",
  },
];
