import * as THREE from "three";

export function latLngToVector3(
  lat: number,
  lng: number,
  radius = 1,
): THREE.Vector3 {
  const phi = (90 - lat) * (Math.PI / 180);
  const theta = (lng + 180) * (Math.PI / 180);
  const x = -(radius * Math.sin(phi) * Math.cos(theta));
  const y = radius * Math.cos(phi);
  const z = radius * Math.sin(phi) * Math.sin(theta);
  return new THREE.Vector3(x, y, z);
}

// Haversine distance in km between two lat/lng pairs
export function haversineKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * R * Math.asin(Math.sqrt(x));
}

// Project lat/lng to flat-map (equirectangular) coordinates inside a viewBox
// of width w and height h.
export function latLngToFlat(
  lat: number,
  lng: number,
  w: number,
  h: number,
): { x: number; y: number } {
  const x = ((lng + 180) / 360) * w;
  const y = ((90 - lat) / 180) * h;
  return { x, y };
}
