/**
 * Offline US geocoding for the tracking map (no external geocoder, no network):
 *   1. city + state in a small table of major US cities  → city centroid;
 *   2. otherwise the state (from the address, else from the ZIP prefix) → state centroid.
 * Accuracy is "which part of the country", which is all a parcel route line needs.
 * `zipState` (3-digit ZIP prefix → state) also powers the address heuristics at checkout.
 */
export type LatLng = { lat: number; lng: number };

/** Approximate geographic centroids (lat, lng) of the states + DC. */
export const STATE_CENTROIDS: Readonly<Record<string, LatLng>> = {
    AL: { lat: 32.8, lng: -86.8 }, AK: { lat: 61.4, lng: -152.3 }, AZ: { lat: 34.2, lng: -111.7 }, AR: { lat: 34.9, lng: -92.4 },
    CA: { lat: 37.2, lng: -119.4 }, CO: { lat: 39.0, lng: -105.5 }, CT: { lat: 41.6, lng: -72.7 }, DE: { lat: 39.0, lng: -75.5 },
    DC: { lat: 38.9, lng: -77.0 }, FL: { lat: 28.6, lng: -82.4 }, GA: { lat: 32.7, lng: -83.4 }, HI: { lat: 20.8, lng: -156.3 },
    ID: { lat: 44.4, lng: -114.6 }, IL: { lat: 40.0, lng: -89.2 }, IN: { lat: 39.9, lng: -86.3 }, IA: { lat: 42.1, lng: -93.5 },
    KS: { lat: 38.5, lng: -98.4 }, KY: { lat: 37.5, lng: -85.3 }, LA: { lat: 31.1, lng: -92.0 }, ME: { lat: 45.4, lng: -69.2 },
    MD: { lat: 39.0, lng: -76.8 }, MA: { lat: 42.3, lng: -71.8 }, MI: { lat: 44.3, lng: -85.4 }, MN: { lat: 46.3, lng: -94.3 },
    MS: { lat: 32.7, lng: -89.7 }, MO: { lat: 38.4, lng: -92.5 }, MT: { lat: 47.0, lng: -109.6 }, NE: { lat: 41.5, lng: -99.8 },
    NV: { lat: 39.3, lng: -116.6 }, NH: { lat: 43.7, lng: -71.6 }, NJ: { lat: 40.2, lng: -74.7 }, NM: { lat: 34.4, lng: -106.1 },
    NY: { lat: 42.9, lng: -75.5 }, NC: { lat: 35.6, lng: -79.4 }, ND: { lat: 47.5, lng: -100.5 }, OH: { lat: 40.3, lng: -82.8 },
    OK: { lat: 35.6, lng: -97.5 }, OR: { lat: 43.9, lng: -120.6 }, PA: { lat: 40.9, lng: -77.8 }, RI: { lat: 41.7, lng: -71.5 },
    SC: { lat: 33.9, lng: -80.9 }, SD: { lat: 44.4, lng: -100.2 }, TN: { lat: 35.9, lng: -86.4 }, TX: { lat: 31.5, lng: -99.3 },
    UT: { lat: 39.3, lng: -111.7 }, VT: { lat: 44.1, lng: -72.7 }, VA: { lat: 37.5, lng: -78.9 }, WA: { lat: 47.4, lng: -120.5 },
    WV: { lat: 38.6, lng: -80.6 }, WI: { lat: 44.6, lng: -89.9 }, WY: { lat: 43.0, lng: -107.6 }, PR: { lat: 18.2, lng: -66.5 },
};

/** 3-digit ZIP prefix ranges → state (USPS SCF allocation, inclusive). */
const ZIP3_RANGES: readonly [number, number, string][] = [
    [5, 5, 'NY'], [6, 9, 'PR'], [10, 27, 'MA'], [28, 29, 'RI'], [30, 38, 'NH'], [39, 49, 'ME'], [50, 54, 'VT'], [55, 55, 'MA'], [56, 59, 'VT'],
    [60, 69, 'CT'], [70, 89, 'NJ'], [100, 149, 'NY'], [150, 196, 'PA'], [197, 199, 'DE'], [200, 200, 'DC'], [201, 201, 'VA'], [202, 205, 'DC'],
    [206, 219, 'MD'], [220, 246, 'VA'], [247, 268, 'WV'], [270, 289, 'NC'], [290, 299, 'SC'], [300, 319, 'GA'], [320, 339, 'FL'], [341, 342, 'FL'],
    [344, 344, 'FL'], [346, 347, 'FL'], [349, 349, 'FL'], [350, 369, 'AL'], [370, 385, 'TN'], [386, 397, 'MS'], [398, 399, 'GA'], [400, 427, 'KY'],
    [430, 459, 'OH'], [460, 479, 'IN'], [480, 499, 'MI'], [500, 528, 'IA'], [530, 549, 'WI'], [550, 567, 'MN'], [569, 569, 'DC'], [570, 577, 'SD'],
    [580, 588, 'ND'], [590, 599, 'MT'], [600, 629, 'IL'], [630, 658, 'MO'], [660, 679, 'KS'], [680, 693, 'NE'], [700, 714, 'LA'], [716, 729, 'AR'],
    [730, 732, 'OK'], [733, 733, 'TX'], [734, 749, 'OK'], [750, 799, 'TX'], [800, 816, 'CO'], [820, 831, 'WY'], [832, 838, 'ID'], [840, 847, 'UT'], [850, 865, 'AZ'], [870, 884, 'NM'],
    [885, 885, 'TX'], [889, 898, 'NV'], [900, 961, 'CA'], [967, 968, 'HI'], [970, 979, 'OR'], [980, 994, 'WA'], [995, 999, 'AK'],
];

/** State for a US ZIP (5 or 9 digit), or null when the prefix is unallocated / military. */
export function zipState(zip: string): string | null {
    const m = /^(\d{3})\d{2}(-\d{4})?$/.exec(zip.trim());
    if (!m) return null;
    const p = Number(m[1]);
    for (const [lo, hi, st] of ZIP3_RANGES) if (p >= lo && p <= hi) return st;
    return null;
}

/** Major US cities (lower-case "city|ST" → centroid). */
const CITIES: Readonly<Record<string, LatLng>> = {
    'new york|NY': { lat: 40.71, lng: -74.01 }, 'brooklyn|NY': { lat: 40.65, lng: -73.95 }, 'buffalo|NY': { lat: 42.89, lng: -78.88 }, 'rochester|NY': { lat: 43.16, lng: -77.61 },
    'los angeles|CA': { lat: 34.05, lng: -118.24 }, 'san francisco|CA': { lat: 37.77, lng: -122.42 }, 'san diego|CA': { lat: 32.72, lng: -117.16 }, 'san jose|CA': { lat: 37.34, lng: -121.89 },
    'oakland|CA': { lat: 37.8, lng: -122.27 }, 'sacramento|CA': { lat: 38.58, lng: -121.49 }, 'fresno|CA': { lat: 36.74, lng: -119.79 }, 'chicago|IL': { lat: 41.88, lng: -87.63 },
    'houston|TX': { lat: 29.76, lng: -95.37 }, 'dallas|TX': { lat: 32.78, lng: -96.8 }, 'austin|TX': { lat: 30.27, lng: -97.74 }, 'san antonio|TX': { lat: 29.42, lng: -98.49 },
    'el paso|TX': { lat: 31.76, lng: -106.49 }, 'fort worth|TX': { lat: 32.76, lng: -97.33 }, 'phoenix|AZ': { lat: 33.45, lng: -112.07 }, 'tucson|AZ': { lat: 32.22, lng: -110.97 },
    'philadelphia|PA': { lat: 39.95, lng: -75.17 }, 'pittsburgh|PA': { lat: 40.44, lng: -79.99 }, 'jacksonville|FL': { lat: 30.33, lng: -81.66 }, 'miami|FL': { lat: 25.76, lng: -80.19 },
    'tampa|FL': { lat: 27.95, lng: -82.46 }, 'orlando|FL': { lat: 28.54, lng: -81.38 }, 'columbus|OH': { lat: 39.96, lng: -83.0 }, 'cleveland|OH': { lat: 41.5, lng: -81.69 },
    'cincinnati|OH': { lat: 39.1, lng: -84.51 }, 'indianapolis|IN': { lat: 39.77, lng: -86.16 }, 'charlotte|NC': { lat: 35.23, lng: -80.84 }, 'raleigh|NC': { lat: 35.78, lng: -78.64 },
    'seattle|WA': { lat: 47.61, lng: -122.33 }, 'spokane|WA': { lat: 47.66, lng: -117.43 }, 'denver|CO': { lat: 39.74, lng: -104.99 }, 'boston|MA': { lat: 42.36, lng: -71.06 },
    'washington|DC': { lat: 38.91, lng: -77.04 }, 'nashville|TN': { lat: 36.16, lng: -86.78 }, 'memphis|TN': { lat: 35.15, lng: -90.05 }, 'detroit|MI': { lat: 42.33, lng: -83.05 },
    'grand rapids|MI': { lat: 42.96, lng: -85.67 }, 'portland|OR': { lat: 45.52, lng: -122.68 }, 'portland|ME': { lat: 43.66, lng: -70.26 }, 'las vegas|NV': { lat: 36.17, lng: -115.14 },
    'reno|NV': { lat: 39.53, lng: -119.81 }, 'louisville|KY': { lat: 38.25, lng: -85.76 }, 'baltimore|MD': { lat: 39.29, lng: -76.61 }, 'milwaukee|WI': { lat: 43.04, lng: -87.91 },
    'madison|WI': { lat: 43.07, lng: -89.4 }, 'albuquerque|NM': { lat: 35.08, lng: -106.65 }, 'kansas city|MO': { lat: 39.1, lng: -94.58 }, 'st. louis|MO': { lat: 38.63, lng: -90.2 },
    'saint louis|MO': { lat: 38.63, lng: -90.2 }, 'omaha|NE': { lat: 41.26, lng: -95.93 }, 'minneapolis|MN': { lat: 44.98, lng: -93.27 }, 'saint paul|MN': { lat: 44.95, lng: -93.09 },
    'atlanta|GA': { lat: 33.75, lng: -84.39 }, 'new orleans|LA': { lat: 29.95, lng: -90.07 }, 'oklahoma city|OK': { lat: 35.47, lng: -97.52 }, 'tulsa|OK': { lat: 36.15, lng: -95.99 },
    'salt lake city|UT': { lat: 40.76, lng: -111.89 }, 'boise|ID': { lat: 43.62, lng: -116.2 }, 'honolulu|HI': { lat: 21.31, lng: -157.86 }, 'anchorage|AK': { lat: 61.22, lng: -149.9 },
    'richmond|VA': { lat: 37.54, lng: -77.44 }, 'virginia beach|VA': { lat: 36.85, lng: -75.98 }, 'providence|RI': { lat: 41.82, lng: -71.41 }, 'hartford|CT': { lat: 41.76, lng: -72.67 },
    'newark|NJ': { lat: 40.74, lng: -74.17 }, 'jersey city|NJ': { lat: 40.73, lng: -74.08 }, 'wilmington|DE': { lat: 39.74, lng: -75.55 }, 'birmingham|AL': { lat: 33.52, lng: -86.8 },
    'little rock|AR': { lat: 34.75, lng: -92.29 }, 'jackson|MS': { lat: 32.3, lng: -90.18 }, 'des moines|IA': { lat: 41.59, lng: -93.62 }, 'sioux falls|SD': { lat: 43.54, lng: -96.73 },
    'fargo|ND': { lat: 46.88, lng: -96.79 }, 'billings|MT': { lat: 45.78, lng: -108.5 }, 'cheyenne|WY': { lat: 41.14, lng: -104.82 }, 'charleston|SC': { lat: 32.78, lng: -79.93 },
    'columbia|SC': { lat: 34.0, lng: -81.03 }, 'charleston|WV': { lat: 38.35, lng: -81.63 }, 'burlington|VT': { lat: 44.48, lng: -73.21 }, 'manchester|NH': { lat: 42.99, lng: -71.46 },
    'wichita|KS': { lat: 37.69, lng: -97.34 }, 'lawrence|KS': { lat: 38.97, lng: -95.24 },
};

export type GeocodeResult = LatLng & { precision: 'city' | 'state'; state: string };

/** Offline geocode of a US city/state/ZIP; null only when nothing is recognisable. */
export function geocodeUs(input: { city?: string | null; region?: string | null; postalCode?: string | null }): GeocodeResult | null {
    const region = input.region?.trim().toUpperCase() || null;
    const state = region && STATE_CENTROIDS[region] ? region : input.postalCode ? zipState(input.postalCode) : null;
    if (state && input.city) {
        const hit = CITIES[`${input.city.trim().toLowerCase()}|${state}`];
        if (hit) return { ...hit, precision: 'city', state };
    }
    if (state && STATE_CENTROIDS[state]) return { ...STATE_CENTROIDS[state], precision: 'state', state };
    return null;
}
