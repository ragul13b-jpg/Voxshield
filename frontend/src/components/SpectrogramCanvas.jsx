import { useEffect, useRef } from 'react';

// Maps a dB value (roughly -80..0) to an RGB color along a cyan -> violet -> amber ramp
function dbToColor(db) {
  const t = Math.min(1, Math.max(0, (db + 80) / 80));
  // three-stop gradient: deep navy -> cyan -> amber-white
  const stops = [
    [10, 14, 25],
    [23, 90, 130],
    [61, 214, 245],
    [245, 200, 120],
  ];
  const segments = stops.length - 1;
  const scaled = t * segments;
  const idx = Math.min(segments - 1, Math.floor(scaled));
  const localT = scaled - idx;
  const [r0, g0, b0] = stops[idx];
  const [r1, g1, b1] = stops[idx + 1];
  const r = Math.round(r0 + (r1 - r0) * localT);
  const g = Math.round(g0 + (g1 - g0) * localT);
  const b = Math.round(b0 + (b1 - b0) * localT);
  return `rgb(${r},${g},${b})`;
}

export default function SpectrogramCanvas({ db = [], height = 160 }) {
  const canvasRef = useRef(null);
  const containerRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const width = container.clientWidth;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);

    if (!db.length || !db[0]?.length) {
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      ctx.font = '12px "IBM Plex Mono", monospace';
      ctx.fillText('NO SIGNAL', 12, height / 2);
      return;
    }

    const nFreq = db.length;
    const nTime = db[0].length;
    const cellW = width / nTime;
    const cellH = height / nFreq;

    for (let f = 0; f < nFreq; f++) {
      const row = db[f];
      const y = height - (f + 1) * cellH; // low freq at bottom
      for (let t = 0; t < nTime; t++) {
        ctx.fillStyle = dbToColor(row[t]);
        ctx.fillRect(t * cellW, y, cellW + 0.6, cellH + 0.6);
      }
    }
  }, [db, height]);

  return (
    <div ref={containerRef} style={{ width: '100%' }}>
      <canvas ref={canvasRef} />
    </div>
  );
}
