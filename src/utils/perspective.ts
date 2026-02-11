// Perspective transformation utilities

export interface Point {
  x: number;
  y: number;
}

/**
 * Compute the 3x3 perspective transform matrix that maps
 * srcPoints to dstPoints (both arrays of 4 points).
 * Returns a flat 9-element array [a,b,c,d,e,f,g,h,1].
 */
export function computePerspectiveTransform(
  src: Point[],
  dst: Point[]
): number[] {
  // We solve for the 8 unknowns of the perspective matrix:
  // | a b c |   | x |   | x' * w |
  // | d e f | * | y | = | y' * w |
  // | g h 1 |   | 1 |   | w      |
  //
  // This gives us:
  // x' = (a*x + b*y + c) / (g*x + h*y + 1)
  // y' = (d*x + e*y + f) / (g*x + h*y + 1)
  //
  // Rearranging:
  // a*x + b*y + c - g*x*x' - h*y*x' = x'
  // d*x + e*y + f - g*x*y' - h*y*y' = y'

  const A: number[][] = [];
  const B: number[] = [];

  for (let i = 0; i < 4; i++) {
    const sx = src[i].x;
    const sy = src[i].y;
    const dx = dst[i].x;
    const dy = dst[i].y;

    A.push([sx, sy, 1, 0, 0, 0, -sx * dx, -sy * dx]);
    B.push(dx);
    A.push([0, 0, 0, sx, sy, 1, -sx * dy, -sy * dy]);
    B.push(dy);
  }

  const result = solveLinearSystem(A, B);
  if (!result) return [1, 0, 0, 0, 1, 0, 0, 0, 1];
  return [...result, 1];
}

/**
 * Solve Ax = B using Gaussian elimination with partial pivoting.
 */
function solveLinearSystem(
  A: number[][],
  B: number[]
): number[] | null {
  const n = B.length;
  // Augmented matrix
  const M = A.map((row, i) => [...row, B[i]]);

  for (let col = 0; col < n; col++) {
    // Find pivot
    let maxVal = Math.abs(M[col][col]);
    let maxRow = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(M[row][col]) > maxVal) {
        maxVal = Math.abs(M[row][col]);
        maxRow = row;
      }
    }
    if (maxVal < 1e-10) return null;

    // Swap rows
    [M[col], M[maxRow]] = [M[maxRow], M[col]];

    // Eliminate
    for (let row = col + 1; row < n; row++) {
      const factor = M[row][col] / M[col][col];
      for (let j = col; j <= n; j++) {
        M[row][j] -= factor * M[col][j];
      }
    }
  }

  // Back substitution
  const x = new Array(n).fill(0);
  for (let row = n - 1; row >= 0; row--) {
    x[row] = M[row][n];
    for (let col = row + 1; col < n; col++) {
      x[row] -= M[row][col] * x[col];
    }
    x[row] /= M[row][row];
  }

  return x;
}

/**
 * Compute the inverse of a 3x3 matrix given as flat 9-element array.
 */
export function invert3x3(m: number[]): number[] | null {
  const [a, b, c, d, e, f, g, h, i] = m;
  const det =
    a * (e * i - f * h) -
    b * (d * i - f * g) +
    c * (d * h - e * g);
  if (Math.abs(det) < 1e-10) return null;
  const invDet = 1 / det;
  return [
    (e * i - f * h) * invDet,
    (c * h - b * i) * invDet,
    (b * f - c * e) * invDet,
    (f * g - d * i) * invDet,
    (a * i - c * g) * invDet,
    (c * d - a * f) * invDet,
    (d * h - e * g) * invDet,
    (b * g - a * h) * invDet,
    (a * e - b * d) * invDet,
  ];
}

/**
 * Apply a 3x3 perspective matrix to a point.
 */
export function transformPoint(m: number[], x: number, y: number): Point {
  const w = m[6] * x + m[7] * y + m[8];
  return {
    x: (m[0] * x + m[1] * y + m[2]) / w,
    y: (m[3] * x + m[4] * y + m[5]) / w,
  };
}

/**
 * Apply perspective transform to image data using inverse mapping
 * for high-quality output with bilinear interpolation.
 */
export function applyPerspectiveTransform(
  srcCanvas: HTMLCanvasElement,
  dstCanvas: HTMLCanvasElement,
  srcCorners: Point[],
  dstCorners: Point[]
): void {
  const srcCtx = srcCanvas.getContext("2d")!;
  const dstCtx = dstCanvas.getContext("2d")!;

  const sw = srcCanvas.width;
  const sh = srcCanvas.height;
  const dw = dstCanvas.width;
  const dh = dstCanvas.height;

  const srcData = srcCtx.getImageData(0, 0, sw, sh);
  const dstData = dstCtx.createImageData(dw, dh);

  // Compute the transform from dst coords back to src coords
  const matrix = computePerspectiveTransform(dstCorners, srcCorners);

  const srcPixels = srcData.data;
  const dstPixels = dstData.data;

  for (let y = 0; y < dh; y++) {
    for (let x = 0; x < dw; x++) {
      const srcPt = transformPoint(matrix, x, y);
      const sx = srcPt.x;
      const sy = srcPt.y;

      if (sx >= 0 && sx < sw - 1 && sy >= 0 && sy < sh - 1) {
        // Bilinear interpolation
        const x0 = Math.floor(sx);
        const y0 = Math.floor(sy);
        const x1 = x0 + 1;
        const y1 = y0 + 1;
        const fx = sx - x0;
        const fy = sy - y0;

        const idx00 = (y0 * sw + x0) * 4;
        const idx10 = (y0 * sw + x1) * 4;
        const idx01 = (y1 * sw + x0) * 4;
        const idx11 = (y1 * sw + x1) * 4;

        const dstIdx = (y * dw + x) * 4;
        for (let c = 0; c < 4; c++) {
          dstPixels[dstIdx + c] =
            srcPixels[idx00 + c] * (1 - fx) * (1 - fy) +
            srcPixels[idx10 + c] * fx * (1 - fy) +
            srcPixels[idx01 + c] * (1 - fx) * fy +
            srcPixels[idx11 + c] * fx * fy;
        }
      }
    }
  }

  dstCtx.putImageData(dstData, 0, 0);
}
