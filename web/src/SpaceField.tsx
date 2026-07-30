import { useEffect, useRef, type RefObject } from "react";

// A living deep-space console floor: multi-layer parallax starfield + two
// slow-breathing nebula blobs, painted straight to a single Canvas 2D behind a
// TRANSPARENT ReactFlow. It gives the flat xyflow board real depth:
//   • depth   — 3 star layers with different parallax factors offset by the live
//               xyflow viewport, so panning slides near stars faster than far.
//   • alive   — nebula blobs drift on a slow time-sine + per-star twinkle.
//   • cheap   — ~180 stars, one <canvas>, one RAF loop, DPR capped at 2.
// prefers-reduced-motion → draws ONE static frame and starts no loop.

export type VP = { x: number; y: number; zoom: number };

const LAYERS = [
  { n: 90, depth: 0.15, r: 0.6, a: 0.3 },
  { n: 60, depth: 0.35, r: 0.9, a: 0.55 },
  { n: 30, depth: 0.7, r: 1.4, a: 0.85 },
];
type Star = { x: number; y: number; r: number; a: number; tw: number };

export default function SpaceField({
  viewportRef,
}: {
  viewportRef: RefObject<VP>;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    let w = 0,
      h = 0,
      stars: Star[][] = [];

    const seed = () => {
      stars = LAYERS.map((L) =>
        Array.from({ length: L.n }, () => ({
          x: Math.random(),
          y: Math.random(),
          r: L.r * (0.6 + Math.random() * 0.8),
          a: L.a * (0.5 + Math.random() * 0.5),
          tw: Math.random() * Math.PI * 2,
        })),
      );
    };
    const resize = () => {
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = Math.max(1, w * dpr);
      canvas.height = Math.max(1, h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    seed();
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const nebula = (x: number, y: number, R: number, c: string) => {
      const g = ctx.createRadialGradient(x, y, 0, x, y, R);
      g.addColorStop(0, c);
      g.addColorStop(1, c.replace(/[\d.]+\)$/, "0)"));
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    };

    let raf = 0;
    const t0 = performance.now();
    const draw = (now: number) => {
      const t = reduce ? 0 : (now - t0) / 1000;
      const vp = viewportRef.current;
      const vx = vp?.x ?? 0,
        vy = vp?.y ?? 0,
        zoom = vp?.zoom ?? 1;
      ctx.clearRect(0, 0, w, h);
      const R = Math.max(w, h);
      nebula(
        w * (0.5 + 0.06 * Math.sin(t * 0.05)),
        h * (0.42 + 0.05 * Math.cos(t * 0.04)),
        R * 0.6,
        "rgba(56,116,190,0.14)",
      );
      nebula(
        w * (0.85 + 0.05 * Math.cos(t * 0.03)),
        h * (0.9 + 0.04 * Math.sin(t * 0.05)),
        R * 0.5,
        "rgba(120,90,200,0.10)",
      );
      ctx.fillStyle = "#bcd8ff";
      for (let li = 0; li < LAYERS.length; li++) {
        const L = LAYERS[li];
        const scale = 0.85 + zoom * 0.15 * L.depth;
        for (const s of stars[li]) {
          const x = (((s.x * w + vx * L.depth) % w) + w) % w;
          const y = (((s.y * h + vy * L.depth) % h) + h) % h;
          ctx.globalAlpha =
            s.a * (reduce ? 1 : 0.65 + 0.35 * Math.sin(t * 1.5 + s.tw));
          ctx.beginPath();
          ctx.arc(x, y, s.r * scale, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
      if (!reduce) raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw); // reduced-motion: draws exactly one frame

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [viewportRef]);

  return (
    <canvas
      ref={ref}
      aria-hidden
      className="pointer-events-none absolute inset-0 h-full w-full"
      style={{ zIndex: 0 }}
    />
  );
}
