// Path command codes used in recorded paths (same values as pdf.js DrawOPS).
export const M = 0; // moveTo x y
export const L = 1; // lineTo x y
export const C = 2; // bezierCurveTo c1x c1y c2x c2y x y
export const Q = 3; // quadraticCurveTo cx cy x y
export const Z = 4; // closePath
