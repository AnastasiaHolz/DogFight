export type Surface = {
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
};

export function createCanvas(canvas: HTMLCanvasElement) {
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas 2D недоступний.");

  const ctx: CanvasRenderingContext2D = context;

  function resize(): Surface {
    const { clientWidth: width, clientHeight: height } = canvas;
    const dpr = window.devicePixelRatio || 1;
    const pixelsWide = Math.max(1, Math.round(width * dpr));
    const pixelsHigh = Math.max(1, Math.round(height * dpr));

    if (canvas.width !== pixelsWide) canvas.width = pixelsWide;
    if (canvas.height !== pixelsHigh) canvas.height = pixelsHigh;

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

export type CanvasSurface = ReturnType<typeof createCanvas>;
