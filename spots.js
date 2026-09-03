// Northern Beaches spots, ordered south → north (Shelly Beach to Long Reef).
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
    id: "shelly", name: "Shelly Beach", order: 1, kind: "beach",
    lat: -33.8020, lng: 151.2882, facing_deg: 45,
    swell_window: [20, 90], min_period_s: 0, good_size_m: [0.3, 1.5], tide_pref: null,
    note: "Bahía muy resguardada detrás de North Head. Necesita swell de NE para entrar; con swell de S/SE queda casi plana. Buena opción con viento fuerte del S/SW, porque el headland la tapa.",
    surfline_url: "https://www.surfline.com/surf-report/shelly-beach-manly/584204204e65fad6a77092fd",
    windguru_id: "208682",
  },
  {
    id: "fairybower", name: "Fairy Bower", order: 2, kind: "reef",
    lat: -33.7987, lng: 151.2879, facing_deg: 55,
    swell_window: [25, 100], min_period_s: 9, good_size_m: [0.5, 2], tide_pref: "mid-high",
    note: "Punto de derecha al lado de Shelly, rompe sobre roca. Mejor con algo de marea (no seca) y swell de NE-E con periodo largo. No tiene página propia en Surfline.",
    surfline_url: null,
    windguru_id: "208682",
  },
  {
    id: "manly-south", name: "Manly (South Steyne)", order: 3, kind: "beach",
    lat: -33.7969, lng: 151.2882, facing_deg: 80,
    swell_window: [50, 140], min_period_s: 0, good_size_m: [0.5, 2.5], tide_pref: null,
    note: "Playón abierto, banco de arena variable. Recibe casi cualquier swell de E-SE, algo protegido de S puro por North Head.",
    surfline_url: "https://www.surfline.com/surf-report/manly-beach-south-steyne/584204204e65fad6a77093e3",
    windguru_id: "208682",
  },
  {
    id: "manly-north", name: "Manly (North Steyne)", order: 4, kind: "beach",
    lat: -33.7930, lng: 151.2870, facing_deg: 80,
    swell_window: [50, 140], min_period_s: 0, good_size_m: [0.5, 2.5], tide_pref: null,
    note: "Misma playa que South Steyne, extremo norte. Suele tener bancos algo distintos.",
    surfline_url: "https://www.surfline.com/surf-report/manly-beach-north-steyne/5d7ac1f48b90df000129e6ca",
    windguru_id: "208682",
  },
  {
    id: "queenscliff", name: "Queenscliff", order: 5, kind: "beach",
    lat: -33.7860, lng: 151.2840, facing_deg: 85,
    swell_window: [55, 145], min_period_s: 0, good_size_m: [0.5, 2.5], tide_pref: null,
    note: "Continuación norte de Manly, separada por una laguna chica. Beachbreak abierto similar a Manly.",
    surfline_url: "https://www.surfline.com/surf-report/queenscliff/584204204e65fad6a77093e1",
    windguru_id: "208682",
  },
  {
    id: "deadmans", name: "Deadman's", order: 6, kind: "reef",
    lat: -33.7830, lng: 151.2820, facing_deg: 95,
    swell_window: [70, 150], min_period_s: 11, good_size_m: [1, 3], tide_pref: "mid-high",
    note: "Reef en el extremo norte de Queenscliff. Necesita más tamaño/periodo que las playas vecinas; con marea muy baja queda expuesto y peligroso.",
    surfline_url: "https://www.surfline.com/surf-report/deadmans/60f8644556831fd384ac4e6d",
    windguru_id: "208682",
  },
  {
    id: "freshwater", name: "Freshwater", order: 7, kind: "beach",
    lat: -33.7780, lng: 151.2870, facing_deg: 90,
    swell_window: [60, 150], min_period_s: 0, good_size_m: [0.5, 2.5], tide_pref: null,
    note: "Uno de los beachbreaks más consistentes de la zona, bastante expuesto a E-SE.",
    surfline_url: "https://www.surfline.com/surf-report/freshwater/584204204e65fad6a77093e0",
    windguru_id: "208683",
  },
  {
    id: "curlcurl-south", name: "Curl Curl Sur", order: 8, kind: "beach",
    lat: -33.7700, lng: 151.2940, facing_deg: 95,
    swell_window: [65, 155], min_period_s: 0, good_size_m: [0.5, 2.5], tide_pref: null,
    note: "Extremo sur de Curl Curl, separado del norte por la laguna. Surfline lo trata como un solo spot con el norte; en la práctica rompen parecido.",
    surfline_url: "https://www.surfline.com/surf-report/curl-curl/5842041f4e65fad6a7708bfb",
    windguru_id: "208683",
  },
  {
    id: "curlcurl-north", name: "Curl Curl Norte", order: 9, kind: "beach",
    lat: -33.7650, lng: 151.2960, facing_deg: 95,
    swell_window: [65, 155], min_period_s: 0, good_size_m: [0.5, 2.5], tide_pref: null,
    note: "Extremo norte de Curl Curl. Comparte spot de Surfline con el sur; condiciones muy similares en la práctica.",
    surfline_url: "https://www.surfline.com/surf-report/curl-curl/5842041f4e65fad6a7708bfb",
    windguru_id: "208683",
  },
  {
    id: "deewhy", name: "Dee Why", order: 10, kind: "beach",
    lat: -33.7540, lng: 151.2990, facing_deg: 100,
    swell_window: [70, 160], min_period_s: 0, good_size_m: [0.5, 2.5], tide_pref: null,
    note: "Playón abierto + Dee Why Point (reef) en el extremo norte, que pide más swell de SE.",
    surfline_url: "https://www.surfline.com/surf-report/dee-why-point/5842041f4e65fad6a7708bfa",
    windguru_id: "208683",
  },
  {
    id: "longreef", name: "Long Reef", order: 11, kind: "reef",
    lat: -33.7440, lng: 151.3050, facing_deg: 120,
    swell_window: [90, 170], min_period_s: 10, good_size_m: [1, 3], tide_pref: "mid-high",
    note: "El más expuesto al S/SE de toda la franja: funciona con swells más al sur que el resto. Reef, cuidado en marea muy baja.",
    surfline_url: "https://www.surfline.com/surf-report/long-reef/584204204e65fad6a77093de",
    windguru_id: "208684",
  },
];
