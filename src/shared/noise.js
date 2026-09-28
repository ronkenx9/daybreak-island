// 2D simplex noise + fbm helpers (seeded, deterministic).
const F2 = 0.5 * (Math.sqrt(3) - 1), G2 = (3 - Math.sqrt(3)) / 6;
const grad = [[1, 1], [-1, 1], [1, -1], [-1, -1], [1, 0], [-1, 0], [0, 1], [0, -1]];

export function makeNoise(seed = 1) {
  const p = new Uint8Array(512);
  const perm = new Uint8Array(256).map((_, i) => i);
  let s = seed >>> 0;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = 255; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [perm[i], perm[j]] = [perm[j], perm[i]]; }
  for (let i = 0; i < 512; i++) p[i] = perm[i & 255];

  function noise(x, y) {
    const sk = (x + y) * F2;
    const i = Math.floor(x + sk), j = Math.floor(y + sk);
    const t = (i + j) * G2;
    const x0 = x - (i - t), y0 = y - (j - t);
    const i1 = x0 > y0 ? 1 : 0, j1 = 1 - i1;
    const x1 = x0 - i1 + G2, y1 = y0 - j1 + G2, x2 = x0 - 1 + 2 * G2, y2 = y0 - 1 + 2 * G2;
    const ii = i & 255, jj = j & 255;
    let n = 0;
    for (const [dx, dy, gi] of [[x0, y0, p[ii + p[jj]]], [x1, y1, p[ii + i1 + p[jj + j1]]], [x2, y2, p[ii + 1 + p[jj + 1]]]]) {
      let tt = 0.5 - dx * dx - dy * dy;
      if (tt > 0) { tt *= tt; const g = grad[gi & 7]; n += tt * tt * (g[0] * dx + g[1] * dy); }
    }
    return 70 * n; // -1..1
  }
  const fbm = (x, y, oct = 5, lac = 2, gain = 0.5) => {
    let a = 1, f = 1, sum = 0, norm = 0;
    for (let o = 0; o < oct; o++) { sum += a * noise(x * f, y * f); norm += a; a *= gain; f *= lac; }
    return sum / norm;
  };
  const ridged = (x, y, oct = 5) => {
    let a = 1, f = 1, sum = 0, norm = 0, prev = 1;
    for (let o = 0; o < oct; o++) {
      let n = 1 - Math.abs(noise(x * f, y * f));
      n *= n; sum += n * a * prev; prev = n; norm += a; a *= 0.5; f *= 2.05;
    }
    return sum / norm; // 0..1
  };
  return { noise, fbm, ridged };
}
