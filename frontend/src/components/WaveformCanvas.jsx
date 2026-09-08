import { useEffect, useRef } from 'react';
import { riskColor } from '../utils/format';

export default function WaveformCanvas({ points = [], riskLevel = 'LOW', height = 120 }) {
  const canvasRef = useRef(null);
  const containerRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const dpr = window.devicePixelRatio || 1;
    const width = container.clientWidth;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);

    // grid
    ctx.strokeStyle = 'rgba(255,255,255,0.04)';
    ctx.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
      const y = (height / 4) * i;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }

    if (!points.length) {
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      ctx.font = '12px "IBM Plex Mono", monospace';
      ctx.fillText('NO SIGNAL', 12, height / 2);
      return;
    }

    const mid = height / 2;
    const maxAbs = Math.max(0.001, ...points.map((p) => Math.abs(p)));
    const scaleY = (mid - 8) / maxAbs;
    const stepX = width / points.length;

    const color = riskColor(riskLevel).replace('var(', '').replace(')', '');
    const resolved = getComputedStyle(document.documentElement).getPropertyValue(color).trim() || '#2BD97C';

    const grad = ctx.createLinearGradient(0, 0, width, 0);
    grad.addColorStop(0, resolved + 'AA');
    grad.addColorStop(1, resolved);

    ctx.beginPath();
    ctx.moveTo(0, mid);
    points.forEach((p, i) => {
      const x = i * stepX;
      const y = mid - p * scaleY;
      ctx.lineTo(x, y);
    });
    ctx.strokeStyle = grad;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // mirrored fill for a fuller waveform look
    ctx.beginPath();
    points.forEach((p, i) => {
      const x = i * stepX;
      const y = mid - Math.abs(p) * scaleY;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    for (let i = points.length - 1; i >= 0; i--) {
      const x = i * stepX;
      const y = mid + Math.abs(points[i]) * scaleY;
      ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fillStyle = resolved + '22';
    ctx.fill();

    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.beginPath();
    ctx.moveTo(0, mid);
    ctx.lineTo(width, mid);
    ctx.stroke();
  }, [points, riskLevel, height]);

  return (
    <div ref={containerRef} style={{ width: '100%' }}>
      <canvas ref={canvasRef} />
    </div>
  );
}
