/**
 * Offline map: a simplified lower-48 US outline ([lng, lat], ~60 points) and an
 * equirectangular projection into a 464 × 260 SVG viewBox. No tiles, no network.
 */
export const US_OUTLINE: readonly [number, number][] = [
    [-124.7, 48.4], [-124.0, 46.3], [-124.1, 43.0], [-124.4, 40.4], [-123.8, 39.0], [-122.5, 37.5], [-121.9, 36.6], [-120.6, 34.6],
    [-118.5, 34.0], [-117.1, 32.5], [-114.7, 32.7], [-111.1, 31.3], [-108.2, 31.3], [-106.5, 31.8], [-104.5, 29.7], [-103.0, 29.0],
    [-101.4, 29.8], [-99.5, 27.5], [-97.4, 25.9], [-97.4, 27.8], [-95.0, 29.3], [-93.8, 29.7], [-91.0, 29.2], [-89.2, 29.3],
    [-89.6, 30.2], [-87.8, 30.4], [-85.3, 29.7], [-84.0, 30.1], [-82.7, 28.0], [-81.8, 26.1], [-80.8, 25.2], [-80.1, 25.8],
    [-80.6, 28.5], [-81.4, 30.7], [-80.9, 32.0], [-79.0, 33.5], [-77.0, 34.6], [-75.5, 35.3], [-76.0, 37.0], [-75.0, 38.5],
    [-74.0, 40.0], [-72.0, 41.0], [-70.0, 41.6], [-70.6, 42.6], [-70.0, 43.8], [-67.0, 44.8], [-67.8, 47.1], [-69.2, 47.4],
    [-71.0, 45.0], [-74.7, 45.0], [-76.5, 43.5], [-79.2, 43.3], [-83.0, 42.0], [-82.5, 45.3], [-84.6, 46.4], [-88.4, 48.3],
    [-89.6, 48.0], [-95.2, 49.0], [-123.0, 49.0],
];

export const MAP_W = 464;
export const MAP_H = 260;
const K = 10 * Math.cos((37.5 * Math.PI) / 180);

/** [lng, lat] → SVG [x, y], clamped into the viewBox (Alaska / Hawaii sit at the edge). */
export function project(lng: number, lat: number): [number, number] {
    const x = (lng + 125) * K;
    const y = (50 - lat) * 10;
    return [Math.round(Math.max(4, Math.min(MAP_W - 4, x)) * 10) / 10, Math.round(Math.max(4, Math.min(MAP_H - 4, y)) * 10) / 10];
}

export const US_OUTLINE_PATH = `M${US_OUTLINE.map(([lng, lat]) => project(lng, lat).join(',')).join('L')}Z`;
