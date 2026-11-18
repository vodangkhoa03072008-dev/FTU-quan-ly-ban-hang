const R = 6371e3;
const toRad = (deg: number) => (deg * Math.PI) / 180;

export function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Khung chữ nhật bao quanh bán kính — lọc sơ bộ bằng index trước khi tính Haversine. */
export function boundingBox(lat: number, lng: number, radiusMeters: number) {
  const dLat = (radiusMeters / R) * (180 / Math.PI);
  const dLng = dLat / Math.max(Math.cos(toRad(lat)), 0.01);
  return { minLat: lat - dLat, maxLat: lat + dLat, minLng: lng - dLng, maxLng: lng + dLng };
}

/** Làm tròn khoảng cách lên bậc 50 m (chống Trilateration). */
export const fuzzDistance = (meters: number) => Math.max(50, Math.ceil(meters / 50) * 50);

/** Làm tròn tọa độ 3 chữ số thập phân (~110 m): không lộ vị trí chính xác. */
export const coarse = (v: number) => Math.round(v * 1000) / 1000;
