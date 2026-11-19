export function createCanvas(canvas) {
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D недоступний.");

  function resize() {
    const { clientWidth: width, clientHeight: height } = canvas;
    const dpr = window.devicePixelRatio || 1;
    const pixelsWide = Math.max(1, Math.round(width * dpr));
    const pixelsHigh = Math.max(1, Math.round(height * dpr));

    if (canvas.width !== pixelsWide) canvas.width = pixelsWide;
    if (canvas.height !== pixelsHigh) canvas.height = pixelsHigh;

    // Малюємо у CSS-пікселях, а буфер зображення має більше фізичних пікселів.
    // setTransform замінює масштаб, а не множить його при кожному кадрі.
    ctx.setTransform(
      pixelsWide / (width || 1),
      0,
      0,
      pixelsHigh / (height || 1),
      0,
      0,
    );
    return { ctx, width, height };
  }

  return { resize };
}
