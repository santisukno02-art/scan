type Point = { x: number; y: number };
export type NormalizedPage = { file: File; width: number; height: number; pageBoundsFound: boolean };

function solve(matrix: number[][], rhs: number[]) {
  const a = matrix.map((row, i) => [...row, rhs[i]]);
  for (let col = 0; col < 8; col += 1) {
    let pivot = col;
    for (let row = col + 1; row < 8; row += 1) if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row;
    if (Math.abs(a[pivot][col]) < 1e-9) return null;
    [a[col], a[pivot]] = [a[pivot], a[col]];
    const divisor = a[col][col];
    for (let k = col; k <= 8; k += 1) a[col][k] /= divisor;
    for (let row = 0; row < 8; row += 1) {
      if (row === col) continue;
      const factor = a[row][col];
      for (let k = col; k <= 8; k += 1) a[row][k] -= factor * a[col][k];
    }
  }
  return a.map(row => row[8]);
}

function fitLine(points: Point[], axis: 'x' | 'y') {
  // Fit the edge's dependent coordinate as a linear function of the other.
  const n = points.length;
  const independent = points.map(p => axis === 'x' ? p.y : p.x);
  const dependent = points.map(p => axis === 'x' ? p.x : p.y);
  const meanI = independent.reduce((s, v) => s + v, 0) / n;
  const meanD = dependent.reduce((s, v) => s + v, 0) / n;
  const slope = independent.reduce((s, v, i) => s + (v - meanI) * (dependent[i] - meanD), 0)
    / Math.max(1, independent.reduce((s, v) => s + (v - meanI) ** 2, 0));
  return { slope, intercept: meanD - slope * meanI };
}

function scanRunsForPage(image: ImageData): [Point, Point, Point, Point] | null {
  const { width, height, data } = image;
  const luma = (x: number, y: number) => {
    const i = (y * width + x) * 4;
    return data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
  };
  const threshold = 132;
  const horizontalLeft: Point[] = [], horizontalRight: Point[] = [];
  for (let y = Math.round(height * 0.08); y < height * 0.94; y += Math.max(2, Math.floor(height / 140))) {
    let best: { left: number; right: number } | null = null;
    let start = -1, lastBright = -1;
    for (let x = 0; x < width; x += 1) {
      if (luma(x, y) >= threshold) {
        if (start < 0) start = x;
        lastBright = x;
      } else if (start >= 0 && x - lastBright > 18) {
        if (!best || lastBright - start > best.right - best.left) best = { left: start, right: lastBright };
        start = -1;
      }
    }
    if (start >= 0 && (!best || lastBright - start > best.right - best.left)) best = { left: start, right: lastBright };
    if (best && best.right - best.left > width * 0.64) {
      horizontalLeft.push({ x: best.left, y }); horizontalRight.push({ x: best.right, y });
    }
  }
  const verticalTop: Point[] = [], verticalBottom: Point[] = [];
  for (let x = Math.round(width * 0.1); x < width * 0.9; x += Math.max(2, Math.floor(width / 100))) {
    let first = -1, last = -1;
    for (let y = 0; y < height; y += 1) {
      if (luma(x, y) >= threshold) { if (first < 0) first = y; last = y; }
    }
    if (first >= 0 && last - first > height * 0.64) {
      verticalTop.push({ x, y: first }); verticalBottom.push({ x, y: last });
    }
  }
  if (horizontalLeft.length < 8 || horizontalRight.length < 8 || verticalTop.length < 8 || verticalBottom.length < 8) return null;
  const leftLine = fitLine(horizontalLeft, 'x');
  const rightLine = fitLine(horizontalRight, 'x');
  const topLine = fitLine(verticalTop, 'y');
  const bottomLine = fitLine(verticalBottom, 'y');
  const intersection = (edgeX: typeof leftLine, edgeY: typeof topLine): Point => {
    const x = (edgeX.intercept + edgeX.slope * edgeY.intercept) / (1 - edgeX.slope * edgeY.slope);
    return { x, y: edgeY.intercept + edgeY.slope * x };
  };
  const quad: [Point, Point, Point, Point] = [
    intersection(leftLine, topLine), intersection(rightLine, topLine),
    intersection(rightLine, bottomLine), intersection(leftLine, bottomLine),
  ];
  const area = (quad[1].x - quad[0].x) * (quad[3].y - quad[0].y);
  return area > width * height * 0.18 ? quad : null;
}

function homography(quad: [Point, Point, Point, Point]) {
  const source = quad;
  const target: Point[] = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
  const m: number[][] = [], b: number[] = [];
  for (let i = 0; i < 4; i += 1) {
    const { x: u, y: v } = target[i], { x, y } = source[i];
    m.push([u, v, 1, 0, 0, 0, -u * x, -v * x]); b.push(x);
    m.push([0, 0, 0, u, v, 1, -u * y, -v * y]); b.push(y);
  }
  return solve(m, b);
}

export async function normalizeDocumentPage(file: File): Promise<NormalizedPage> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 900 / Math.max(bitmap.width, bitmap.height));
  const sample = document.createElement('canvas');
  sample.width = Math.max(1, Math.round(bitmap.width * scale));
  sample.height = Math.max(1, Math.round(bitmap.height * scale));
  const sampleContext = sample.getContext('2d', { willReadFrequently: true });
  if (!sampleContext) { bitmap.close(); throw new Error('ตรวจขอบกระดาษไม่สำเร็จ'); }
  sampleContext.drawImage(bitmap, 0, 0, sample.width, sample.height);
  const quadSmall = scanRunsForPage(sampleContext.getImageData(0, 0, sample.width, sample.height));
  sample.width = 0; sample.height = 0;
  const maxWidth = 1500;
  const width = Math.min(maxWidth, Math.round(bitmap.width * 0.94));
  // The supplied transfer note is printed on a portrait A4 sheet; setting the
  // output ratio removes the camera's perspective compression as well as skew.
  const height = Math.round(width * 297 / 210);
  const output = document.createElement('canvas'); output.width = width; output.height = height;
  const ctx = output.getContext('2d', { willReadFrequently: true });
  if (!ctx) { bitmap.close(); throw new Error('แก้รูปทรงกระดาษไม่สำเร็จ'); }
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, width, height);
  if (!quadSmall) {
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    const fallback = await new Promise<Blob>((resolve, reject) => output.toBlob(v => v ? resolve(v) : reject(new Error('เตรียมภาพ OCR ไม่สำเร็จ')), 'image/jpeg', 0.94));
    return { file: new File([fallback], file.name.replace(/\.[^.]+$/, '.jpg'), { type: 'image/jpeg' }), width, height, pageBoundsFound: false };
  }
  const factor = 1 / scale;
  const quad = quadSmall.map(p => ({ x: p.x * factor, y: p.y * factor })) as [Point, Point, Point, Point];
  const h = homography(quad);
  if (!h) { bitmap.close(); throw new Error('ปรับมุมกระดาษไม่สำเร็จ'); }
  const src = document.createElement('canvas'); src.width = bitmap.width; src.height = bitmap.height;
  const srcCtx = src.getContext('2d', { willReadFrequently: true });
  if (!srcCtx) { bitmap.close(); throw new Error('อ่านพิกเซลภาพไม่สำเร็จ'); }
  srcCtx.drawImage(bitmap, 0, 0); bitmap.close();
  const source = srcCtx.getImageData(0, 0, src.width, src.height);
  const warped = ctx.createImageData(width, height);
  const [a, b, c, d, e, f, g, k] = h;
  for (let y = 0; y < height; y += 1) {
    const v = y / (height - 1);
    for (let x = 0; x < width; x += 1) {
      const u = x / (width - 1), denominator = g * u + k * v + 1;
      const sx = (a * u + b * v + c) / denominator;
      const sy = (d * u + e * v + f) / denominator;
      const ix = Math.max(0, Math.min(source.width - 1, Math.round(sx)));
      const iy = Math.max(0, Math.min(source.height - 1, Math.round(sy)));
      const si = (iy * source.width + ix) * 4, di = (y * width + x) * 4;
      warped.data[di] = source.data[si]; warped.data[di + 1] = source.data[si + 1];
      warped.data[di + 2] = source.data[si + 2]; warped.data[di + 3] = 255;
    }
  }
  ctx.putImageData(warped, 0, 0);
  const blob = await new Promise<Blob>((resolve, reject) => output.toBlob(v => v ? resolve(v) : reject(new Error('เตรียมภาพ OCR ไม่สำเร็จ')), 'image/jpeg', 0.94));
  output.width = 0; output.height = 0; src.width = 0; src.height = 0;
  return { file: new File([blob], file.name.replace(/\.[^.]+$/, '.jpg'), { type: 'image/jpeg' }), width, height, pageBoundsFound: true };
}
