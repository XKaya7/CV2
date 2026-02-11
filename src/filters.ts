import { LayerFilters } from './types';

// ============== HELPERS ==============
function cloneCanvas(src: HTMLCanvasElement): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = src.width; c.height = src.height;
  c.getContext('2d')!.drawImage(src, 0, 0);
  return c;
}

function imgToCanvas(img: HTMLImageElement, maxSize?: number): HTMLCanvasElement {
  let w = img.naturalWidth, h = img.naturalHeight;
  if (maxSize && (w > maxSize || h > maxSize)) {
    const r = Math.min(maxSize / w, maxSize / h);
    w = Math.round(w * r); h = Math.round(h * r);
  }
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  c.getContext('2d')!.drawImage(img, 0, 0, w, h);
  return c;
}

function getImageData(c: HTMLCanvasElement) {
  return c.getContext('2d')!.getImageData(0, 0, c.width, c.height);
}
function putImageData(c: HTMLCanvasElement, d: ImageData) {
  c.getContext('2d')!.putImageData(d, 0, 0);
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }
  return [h * 360, s, l];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  h = ((h % 360) + 360) % 360;
  h /= 360;
  if (s === 0) { const v = Math.round(l * 255); return [v, v, v]; }
  const hue2rgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1; if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [
    Math.round(hue2rgb(p, q, h + 1 / 3) * 255),
    Math.round(hue2rgb(p, q, h) * 255),
    Math.round(hue2rgb(p, q, h - 1 / 3) * 255),
  ];
}

// ============== BRIGHTNESS / CONTRAST ==============
function applyBrightnessContrast(c: HTMLCanvasElement, brightness: number, contrast: number) {
  const d = getImageData(c);
  const data = d.data;
  const b = brightness;
  const f = (259 * (contrast + 255)) / (255 * (259 - contrast));
  for (let i = 0; i < data.length; i += 4) {
    data[i] = Math.max(0, Math.min(255, f * (data[i] - 128) + 128 + b));
    data[i + 1] = Math.max(0, Math.min(255, f * (data[i + 1] - 128) + 128 + b));
    data[i + 2] = Math.max(0, Math.min(255, f * (data[i + 2] - 128) + 128 + b));
  }
  putImageData(c, d);
}

// ============== BLUR (Remade with types) ==============
// Type 1: Gaussian (CSS filter based, high quality)
// Type 2: Box blur (manual multi-pass for painterly look)
// Type 3: Motion blur (directional)
// Type 4: Radial blur (from center outward)
function applyNewBlur(c: HTMLCanvasElement, type: number, radius: number, angle: number) {
  if (radius <= 0 || type === 0) return;
  const w = c.width, h = c.height;
  const ctx = c.getContext('2d')!;

  switch (type) {
    case 1: { // Gaussian — manual separable kernel convolution
      const r = Math.ceil(radius * 2.5);
      const kernelSize = r * 2 + 1;
      const kernel = new Float32Array(kernelSize);
      const sigma = radius;
      let sum = 0;
      for (let i = 0; i < kernelSize; i++) {
        const x = i - r;
        kernel[i] = Math.exp(-(x * x) / (2 * sigma * sigma));
        sum += kernel[i];
      }
      for (let i = 0; i < kernelSize; i++) kernel[i] /= sum;

      const d = getImageData(c);
      const src = d.data;
      const tmp = new Uint8ClampedArray(src.length);

      // Horizontal pass
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          let rr = 0, gg = 0, bb = 0, aa = 0;
          for (let k = 0; k < kernelSize; k++) {
            const sx = Math.min(w - 1, Math.max(0, x + k - r));
            const si = (y * w + sx) * 4;
            const kv = kernel[k];
            rr += src[si] * kv;
            gg += src[si + 1] * kv;
            bb += src[si + 2] * kv;
            aa += src[si + 3] * kv;
          }
          const di = (y * w + x) * 4;
          tmp[di] = rr; tmp[di + 1] = gg; tmp[di + 2] = bb; tmp[di + 3] = aa;
        }
      }

      // Vertical pass
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          let rr = 0, gg = 0, bb = 0, aa = 0;
          for (let k = 0; k < kernelSize; k++) {
            const sy = Math.min(h - 1, Math.max(0, y + k - r));
            const si = (sy * w + x) * 4;
            const kv = kernel[k];
            rr += tmp[si] * kv;
            gg += tmp[si + 1] * kv;
            bb += tmp[si + 2] * kv;
            aa += tmp[si + 3] * kv;
          }
          const di = (y * w + x) * 4;
          src[di] = rr; src[di + 1] = gg; src[di + 2] = bb; src[di + 3] = aa;
        }
      }
      putImageData(c, d);
      break;
    }
    case 2: { // Box blur — manual horizontal + vertical passes
      const d = getImageData(c);
      const data = d.data;
      const copy = new Uint8ClampedArray(data);
      const r = Math.round(radius);
      // Horizontal pass
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          let sr = 0, sg = 0, sb = 0, cnt = 0;
          for (let dx = -r; dx <= r; dx++) {
            const sx = Math.max(0, Math.min(w - 1, x + dx));
            const si = (y * w + sx) * 4;
            sr += copy[si]; sg += copy[si + 1]; sb += copy[si + 2]; cnt++;
          }
          const di = (y * w + x) * 4;
          data[di] = sr / cnt; data[di + 1] = sg / cnt; data[di + 2] = sb / cnt;
        }
      }
      // Vertical pass
      const copy2 = new Uint8ClampedArray(data);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          let sr = 0, sg = 0, sb = 0, cnt = 0;
          for (let dy = -r; dy <= r; dy++) {
            const sy = Math.max(0, Math.min(h - 1, y + dy));
            const si = (sy * w + x) * 4;
            sr += copy2[si]; sg += copy2[si + 1]; sb += copy2[si + 2]; cnt++;
          }
          const di = (y * w + x) * 4;
          data[di] = sr / cnt; data[di + 1] = sg / cnt; data[di + 2] = sb / cnt;
        }
      }
      putImageData(c, d);
      break;
    }
    case 3: { // Motion blur — directional along angle
      const rad = (angle * Math.PI) / 180;
      const mdx = Math.cos(rad);
      const mdy = Math.sin(rad);
      const mSteps = Math.min(Math.round(radius * 2), 40);
      const stepScale = (radius * 2) / mSteps;
      const orig3 = cloneCanvas(c);
      ctx.clearRect(0, 0, w, h);
      for (let i = 0; i < mSteps; i++) {
        const t = (i / mSteps - 0.5) * radius * (stepScale / radius || 1);
        ctx.globalAlpha = 1 / mSteps;
        ctx.drawImage(orig3, t * mdx, t * mdy);
      }
      ctx.globalAlpha = 1;
      break;
    }
    case 4: { // Radial blur — zoom blur from center
      const rSteps = Math.min(Math.max(4, Math.round(radius * 1.5)), 30);
      const orig4 = cloneCanvas(c);
      ctx.clearRect(0, 0, w, h);
      for (let i = 0; i < rSteps; i++) {
        const sc = 1 + (i / rSteps - 0.5) * (radius / 100);
        const rsw = w * sc;
        const rsh = h * sc;
        ctx.globalAlpha = 1 / rSteps;
        ctx.drawImage(orig4, (w - rsw) / 2, (h - rsh) / 2, rsw, rsh);
      }
      ctx.globalAlpha = 1;
      break;
    }
  }
}

// ============== NOISE (Remade with types) ==============
// Type 1: Gaussian noise (normal distribution per channel)
// Type 2: Film grain (luminance-based, organic)
// Type 3: Color noise (independent random per channel)
// Type 4: Monochrome noise (same offset all channels)
function applyNewNoise(c: HTMLCanvasElement, type: number, amount: number, density: number) {
  if (amount <= 0 || type === 0) return;
  const d = getImageData(c);
  const data = d.data;
  const strength = amount * 2.55; // 0-100 → 0-255
  const densityF = density / 100; // 0-100 → 0-1

  // Box-Muller for Gaussian random
  const gaussRand = () => {
    const u1 = Math.random();
    const u2 = Math.random();
    return Math.sqrt(-2 * Math.log(u1 || 0.001)) * Math.cos(2 * Math.PI * u2);
  };

  switch (type) {
    case 1: { // Gaussian noise
      for (let i = 0; i < data.length; i += 4) {
        if (Math.random() > densityF) continue;
        const n = gaussRand() * strength * 0.4;
        data[i] = Math.max(0, Math.min(255, data[i] + n));
        data[i + 1] = Math.max(0, Math.min(255, data[i + 1] + n));
        data[i + 2] = Math.max(0, Math.min(255, data[i + 2] + n));
      }
      break;
    }
    case 2: { // Film grain — organic, luminance-dependent
      for (let i = 0; i < data.length; i += 4) {
        if (Math.random() > densityF) continue;
        const lum = (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114) / 255;
        // More grain in midtones, less in shadows/highlights
        const midtoneFactor = 1 - Math.abs(lum - 0.5) * 2;
        const grainStrength = strength * 0.5 * (0.3 + midtoneFactor * 0.7);
        const n = gaussRand() * grainStrength;
        data[i] = Math.max(0, Math.min(255, data[i] + n));
        data[i + 1] = Math.max(0, Math.min(255, data[i + 1] + n));
        data[i + 2] = Math.max(0, Math.min(255, data[i + 2] + n));
      }
      break;
    }
    case 3: { // Color noise — different random per channel
      for (let i = 0; i < data.length; i += 4) {
        if (Math.random() > densityF) continue;
        const nr = gaussRand() * strength * 0.5;
        const ng = gaussRand() * strength * 0.5;
        const nb = gaussRand() * strength * 0.5;
        data[i] = Math.max(0, Math.min(255, data[i] + nr));
        data[i + 1] = Math.max(0, Math.min(255, data[i + 1] + ng));
        data[i + 2] = Math.max(0, Math.min(255, data[i + 2] + nb));
      }
      break;
    }
    case 4: { // Monochrome noise — same offset all channels
      for (let i = 0; i < data.length; i += 4) {
        if (Math.random() > densityF) continue;
        const n = (Math.random() - 0.5) * strength;
        data[i] = Math.max(0, Math.min(255, data[i] + n));
        data[i + 1] = Math.max(0, Math.min(255, data[i + 1] + n));
        data[i + 2] = Math.max(0, Math.min(255, data[i + 2] + n));
      }
      break;
    }
  }
  putImageData(c, d);
}

// ============== POSTERIZE ==============
function applyPosterize(c: HTMLCanvasElement, levels: number) {
  const d = getImageData(c);
  const data = d.data;
  const step = 255 / (levels - 1);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = Math.round(Math.round(data[i] / step) * step);
    data[i + 1] = Math.round(Math.round(data[i + 1] / step) * step);
    data[i + 2] = Math.round(Math.round(data[i + 2] / step) * step);
  }
  putImageData(c, d);
}

// (Sepia removed)

// ============== INVERT ==============
function applyInvert(c: HTMLCanvasElement) {
  const d = getImageData(c);
  const data = d.data;
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 255 - data[i];
    data[i + 1] = 255 - data[i + 1];
    data[i + 2] = 255 - data[i + 2];
  }
  putImageData(c, d);
}

// ============== LINE ART (Sobel grayscale) ==============
function applyLineArt(c: HTMLCanvasElement, threshold: number, blend: number, colorBlend: number) {
  const orig = cloneCanvas(c);
  const origData = getImageData(orig);
  const d = getImageData(c);
  const w = c.width, h = c.height;
  const gray = new Float32Array(w * h);
  for (let i = 0; i < gray.length; i++) {
    gray[i] = d.data[i * 4] * 0.299 + d.data[i * 4 + 1] * 0.587 + d.data[i * 4 + 2] * 0.114;
  }
  const out = new Uint8ClampedArray(d.data.length);
  // Fill border pixels with white + full alpha
  for (let x = 0; x < w; x++) {
    const t = x * 4, b = ((h - 1) * w + x) * 4;
    out[t] = out[t + 1] = out[t + 2] = 255; out[t + 3] = 255;
    out[b] = out[b + 1] = out[b + 2] = 255; out[b + 3] = 255;
  }
  for (let y = 0; y < h; y++) {
    const l = (y * w) * 4, r = (y * w + w - 1) * 4;
    out[l] = out[l + 1] = out[l + 2] = 255; out[l + 3] = 255;
    out[r] = out[r + 1] = out[r + 2] = 255; out[r + 3] = 255;
  }
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const idx = y * w + x;
      const gx = -gray[idx - w - 1] + gray[idx - w + 1]
        - 2 * gray[idx - 1] + 2 * gray[idx + 1]
        - gray[idx + w - 1] + gray[idx + w + 1];
      const gy = -gray[idx - w - 1] - 2 * gray[idx - w] - gray[idx - w + 1]
        + gray[idx + w - 1] + 2 * gray[idx + w] + gray[idx + w + 1];
      const mag = Math.sqrt(gx * gx + gy * gy);
      const v = mag > threshold ? 0 : 255;
      const pi = idx * 4;
      out[pi] = v; out[pi + 1] = v; out[pi + 2] = v; out[pi + 3] = 255;
    }
  }
  // Apply original color overlay: tint line art with original image colors
  // Uses enhanced soft-multiply that lets color show through even on dark lines
  if (colorBlend > 0) {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const pi = (y * w + x) * 4;
        const lineV = out[pi]; // line art luminance (0=black line, 255=white bg)
        const oR = origData.data[pi];
        const oG = origData.data[pi + 1];
        const oB = origData.data[pi + 2];
        const lineFactor = lineV / 255; // 0 for lines, 1 for background
        // Soft multiply: allow 20% color through even on darkest lines
        const minColor = 0.20 * colorBlend;
        const factor = lineFactor * (1 - minColor) + minColor;
        // Enhanced: boost saturation of colored areas for vivid effect
        const avgOrig = (oR + oG + oB) / 3;
        const satBoost = 1 + colorBlend * 0.3;
        const cR = Math.min(255, (oR + (oR - avgOrig) * (satBoost - 1)) * factor);
        const cG = Math.min(255, (oG + (oG - avgOrig) * (satBoost - 1)) * factor);
        const cB = Math.min(255, (oB + (oB - avgOrig) * (satBoost - 1)) * factor);
        // Blend between pure B&W line art and colored line art
        out[pi] = Math.max(0, Math.min(255, Math.round(lineV * (1 - colorBlend) + cR * colorBlend)));
        out[pi + 1] = Math.max(0, Math.min(255, Math.round(lineV * (1 - colorBlend) + cG * colorBlend)));
        out[pi + 2] = Math.max(0, Math.min(255, Math.round(lineV * (1 - colorBlend) + cB * colorBlend)));
      }
    }
  }
  // Restore original alpha channel — transparent areas stay transparent
  for (let i = 0; i < out.length; i += 4) {
    out[i + 3] = origData.data[i + 3];
  }
  putImageData(c, new ImageData(out, w, h));
  // Original overlay: blend full original photo on top
  if (blend > 0) {
    const ctx = c.getContext('2d')!;
    ctx.globalAlpha = blend;
    ctx.drawImage(orig, 0, 0);
    ctx.globalAlpha = 1;
  }
}

// ============== FIND EDGES (Colored Sobel) ==============
function applyFindEdges(c: HTMLCanvasElement, strength: number, blend: number) {
  const orig = cloneCanvas(c);
  const d = getImageData(c);
  const w = c.width, h = c.height, data = d.data;
  const out = new Uint8ClampedArray(data.length);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const pi = (y * w + x) * 4;
      for (let ch = 0; ch < 3; ch++) {
        const tl = data[((y - 1) * w + x - 1) * 4 + ch];
        const tc = data[((y - 1) * w + x) * 4 + ch];
        const tr = data[((y - 1) * w + x + 1) * 4 + ch];
        const ml = data[(y * w + x - 1) * 4 + ch];
        const mr = data[(y * w + x + 1) * 4 + ch];
        const bl = data[((y + 1) * w + x - 1) * 4 + ch];
        const bc = data[((y + 1) * w + x) * 4 + ch];
        const br = data[((y + 1) * w + x + 1) * 4 + ch];
        const gx = -tl + tr - 2 * ml + 2 * mr - bl + br;
        const gy = -tl - 2 * tc - tr + bl + 2 * bc + br;
        out[pi + ch] = Math.min(255, Math.sqrt(gx * gx + gy * gy) * strength);
      }
      // Preserve original alpha — multiply edge alpha by source alpha
      out[pi + 3] = data[pi + 3];
    }
  }
  // Border pixels: also preserve original alpha
  for (let x = 0; x < w; x++) {
    const t = x * 4, b2 = ((h - 1) * w + x) * 4;
    out[t + 3] = data[t + 3];
    out[b2 + 3] = data[b2 + 3];
  }
  for (let y = 0; y < h; y++) {
    const l = (y * w) * 4, r = (y * w + w - 1) * 4;
    out[l + 3] = data[l + 3];
    out[r + 3] = data[r + 3];
  }
  putImageData(c, new ImageData(out, w, h));
  if (blend > 0) {
    const ctx = c.getContext('2d')!;
    ctx.globalAlpha = blend;
    ctx.drawImage(orig, 0, 0);
    ctx.globalAlpha = 1;
  }
}

// ============== LEVELS (Manga) ==============
function applyLevels(c: HTMLCanvasElement, black: number, white: number, gamma: number, mono: boolean) {
  const d = getImageData(c);
  const data = d.data;
  const range = Math.max(1, white - black);
  const lut = new Uint8Array(256);
  for (let i = 0; i < 256; i++) {
    let v = (i - black) / range;
    v = Math.max(0, Math.min(1, v));
    v = Math.pow(v, 1 / gamma);
    lut[i] = Math.round(v * 255);
  }
  for (let i = 0; i < data.length; i += 4) {
    if (mono) {
      const gray = Math.round(data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114);
      const v = lut[gray];
      data[i] = v; data[i + 1] = v; data[i + 2] = v;
    } else {
      data[i] = lut[data[i]];
      data[i + 1] = lut[data[i + 1]];
      data[i + 2] = lut[data[i + 2]];
    }
  }
  putImageData(c, d);
}

// ============== HALFTONE ==============
function applyHalftone(c: HTMLCanvasElement, dotSize: number, angle: number, colorMode: number, colorBlend: number, blendMode: number = 0) {
  const w = c.width, h = c.height;
  const src = getImageData(c);
  const orig = colorBlend > 0 ? new Uint8ClampedArray(src.data) : null;
  const ctx = c.getContext('2d')!;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  const rad = (angle * Math.PI) / 180;
  const cos = Math.cos(rad), sin = Math.sin(rad);
  const step = dotSize;
  const maxR = step * 0.5;
  const diag = Math.sqrt(w * w + h * h);

  for (let gy = -diag; gy < diag; gy += step) {
    for (let gx = -diag; gx < diag; gx += step) {
      const cx = gx * cos - gy * sin + w / 2;
      const cy = gx * sin + gy * cos + h / 2;
      const px = Math.round(cx), py = Math.round(cy);
      if (px < 0 || px >= w || py < 0 || py >= h) continue;
      const idx = (py * w + px) * 4;
      const sr = src.data[idx], sg = src.data[idx + 1], sb = src.data[idx + 2];
      const gray = sr * 0.299 + sg * 0.587 + sb * 0.114;
      const darkness = 1 - gray / 255;
      const r = maxR * Math.sqrt(darkness);
      if (r > 0.3) {
        // Color mode: use source pixel color; BW mode: black dots
        if (colorMode === 1) {
          ctx.fillStyle = `rgb(${sr},${sg},${sb})`;
        } else {
          ctx.fillStyle = '#000000';
        }
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  // Apply blend mode (0=normal, 1=overlay, 2=multiply, 3=darken)
  if (blendMode > 0 && orig) {
    const result = getImageData(c);
    const rd = result.data;
    for (let i = 0; i < rd.length; i += 4) {
      const hr = rd[i], hg = rd[i + 1], hb = rd[i + 2];
      const or = orig[i], og = orig[i + 1], ob = orig[i + 2];
      let nr = hr, ng = hg, nb = hb;
      switch (blendMode) {
        case 1: { // Overlay
          nr = or < 128 ? (2 * or * hr / 255) : (255 - 2 * (255 - or) * (255 - hr) / 255);
          ng = og < 128 ? (2 * og * hg / 255) : (255 - 2 * (255 - og) * (255 - hg) / 255);
          nb = ob < 128 ? (2 * ob * hb / 255) : (255 - 2 * (255 - ob) * (255 - hb) / 255);
          break;
        }
        case 2: { // Multiply
          nr = hr * or / 255;
          ng = hg * og / 255;
          nb = hb * ob / 255;
          break;
        }
        case 3: { // Darken
          nr = Math.min(hr, or);
          ng = Math.min(hg, og);
          nb = Math.min(hb, ob);
          break;
        }
      }
      rd[i] = Math.round(nr);
      rd[i + 1] = Math.round(ng);
      rd[i + 2] = Math.round(nb);
    }
    putImageData(c, result);
  }
  // Original color overlay blend
  if (colorBlend > 0 && orig) {
    const result = getImageData(c);
    const rd = result.data;
    for (let i = 0; i < rd.length; i += 4) {
      rd[i]     = Math.round(rd[i]     * (1 - colorBlend) + orig[i]     * colorBlend);
      rd[i + 1] = Math.round(rd[i + 1] * (1 - colorBlend) + orig[i + 1] * colorBlend);
      rd[i + 2] = Math.round(rd[i + 2] * (1 - colorBlend) + orig[i + 2] * colorBlend);
    }
    putImageData(c, result);
  }
  // Restore original alpha — transparent areas stay transparent
  {
    const finalD = getImageData(c);
    const fd = finalD.data;
    for (let i = 0; i < fd.length; i += 4) {
      fd[i + 3] = src.data[i + 3];
    }
    putImageData(c, finalD);
  }
}

// ============== HUE / SATURATION / COLOR TEMP ==============
function applyHueSatTemp(c: HTMLCanvasElement, hueShift: number, satShift: number, tempShift: number) {
  const d = getImageData(c);
  const data = d.data;
  const sF = 1 + satShift / 100;
  for (let i = 0; i < data.length; i += 4) {
    let r = data[i], g = data[i + 1], b = data[i + 2];
    // Color temp shift (warm = +R-B, cool = -R+B)
    if (tempShift !== 0) {
      r = Math.max(0, Math.min(255, r + tempShift * 0.8));
      b = Math.max(0, Math.min(255, b - tempShift * 0.8));
    }
    // Hue + saturation via HSL
    const [h, s, l] = rgbToHsl(r, g, b);
    const newH = h + hueShift;
    const newS = Math.max(0, Math.min(1, s * sF));
    const [nr, ng, nb] = hslToRgb(newH, newS, l);
    data[i] = nr; data[i + 1] = ng; data[i + 2] = nb;
  }
  putImageData(c, d);
}

// ============== POSTERIZE STYLES ==============
function applyPosterizeStyle(c: HTMLCanvasElement, style: number, colorShift: number) {
  const d = getImageData(c);
  const data = d.data;
  for (let i = 0; i < data.length; i += 4) {
    let r = data[i], g = data[i + 1], b = data[i + 2];
    // Apply pre-shift hue for color variation
    if (colorShift !== 0) {
      const [ph, ps, pl] = rgbToHsl(r, g, b);
      const [pr, pg, pb] = hslToRgb(ph + colorShift, ps, pl);
      r = pr; g = pg; b = pb;
    }
    switch (style) {
      case 1: { // Neon
        r = Math.round(r / 64) * 85;
        g = Math.round(g / 64) * 85;
        b = Math.round(b / 64) * 85;
        // Boost saturation
        const [h, s, l] = rgbToHsl(r, g, b);
        const [nr, ng, nb] = hslToRgb(h, Math.min(1, s * 2.5), l);
        data[i] = nr; data[i + 1] = ng; data[i + 2] = nb;
        break;
      }
      case 2: { // Retro (warm limited palette)
        const gray = r * 0.299 + g * 0.587 + b * 0.114;
        const lv = Math.floor(gray / 64);
        const palettes = [
          [40, 30, 20], [120, 80, 40], [200, 160, 80], [240, 220, 180],
        ];
        const p = palettes[Math.min(lv, 3)];
        data[i] = p[0]; data[i + 1] = p[1]; data[i + 2] = p[2];
        break;
      }
      case 3: { // Pastel
        r = Math.round(r / 85) * 85;
        g = Math.round(g / 85) * 85;
        b = Math.round(b / 85) * 85;
        // Push toward pastels
        data[i] = Math.round(r * 0.5 + 128);
        data[i + 1] = Math.round(g * 0.5 + 128);
        data[i + 2] = Math.round(b * 0.5 + 128);
        break;
      }
      case 4: { // Duotone (two color)
        const gray = r * 0.299 + g * 0.587 + b * 0.114;
        const t = gray / 255;
        // Dark=deep blue, Light=gold
        data[i] = Math.round(20 * (1 - t) + 255 * t);
        data[i + 1] = Math.round(10 * (1 - t) + 200 * t);
        data[i + 2] = Math.round(80 * (1 - t) + 50 * t);
        break;
      }
    }
  }
  putImageData(c, d);
}

// ============== FROSTED GLASS ==============
function applyFrostedGlass(c: HTMLCanvasElement, amount: number) {
  const d = getImageData(c);
  const data = d.data;
  const w = c.width, h = c.height;
  const copy = new Uint8ClampedArray(data);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const ox = Math.round(x + (Math.random() - 0.5) * amount);
      const oy = Math.round(y + (Math.random() - 0.5) * amount);
      const sx = Math.max(0, Math.min(w - 1, ox));
      const sy = Math.max(0, Math.min(h - 1, oy));
      const di = (y * w + x) * 4;
      const si = (sy * w + sx) * 4;
      data[di] = copy[si];
      data[di + 1] = copy[si + 1];
      data[di + 2] = copy[si + 2];
    }
  }
  putImageData(c, d);
  // Add slight blur for frosted effect
  const ctx = c.getContext('2d')!;
  ctx.filter = `blur(${Math.max(1, amount * 0.3)}px)`;
  ctx.drawImage(c, 0, 0);
  ctx.filter = 'none';
}

// ============== STROKE (Optimized — edge map + distance field dilation) ==============
function applyStroke(c: HTMLCanvasElement, color: string, width: number, inner: boolean, outer: boolean) {
  const w = c.width, h = c.height;
  const ctx = c.getContext('2d')!;
  const d = getImageData(c);
  const data = d.data;
  const totalPx = w * h;

  // Parse color once
  const cr = parseInt(color.slice(1, 3), 16);
  const cg = parseInt(color.slice(3, 5), 16);
  const cb = parseInt(color.slice(5, 7), 16);

  // Build alpha mask
  const alpha = new Uint8Array(totalPx);
  let hasTransparency = false;
  for (let i = 0; i < totalPx; i++) {
    alpha[i] = data[i * 4 + 3] > 128 ? 1 : 0;
    if (!alpha[i] && (i % w) > 0 && (i % w) < w - 1 && Math.floor(i / w) > 0 && Math.floor(i / w) < h - 1) {
      hasTransparency = true;
    }
  }

  if (!hasTransparency) {
    if (outer) { ctx.strokeStyle = color; ctx.lineWidth = width * 2; ctx.strokeRect(-width, -width, w + width * 2, h + width * 2); }
    if (inner) { ctx.strokeStyle = color; ctx.lineWidth = width * 2; ctx.strokeRect(width, width, w - width * 2, h - width * 2); }
    return;
  }

  // Build edge maps via single pass
  const innerEdge = new Uint8Array(totalPx);
  const outerEdge = new Uint8Array(totalPx);
  for (let y = 1; y < h - 1; y++) {
    const row = y * w;
    for (let x = 1; x < w - 1; x++) {
      const idx = row + x;
      if (alpha[idx]) {
        if (!alpha[idx - 1] || !alpha[idx + 1] || !alpha[idx - w] || !alpha[idx + w]) {
          innerEdge[idx] = 1;
        }
      } else {
        if (alpha[idx - 1] || alpha[idx + 1] || alpha[idx - w] || alpha[idx + w]) {
          outerEdge[idx] = 1;
        }
      }
    }
  }

  // Distance field dilation: expand edge by `width` pixels iteratively
  const dilate = (edge: Uint8Array, mask: Uint8Array, matchVal: number) => {
    const result = new Uint8Array(edge);
    let frontier = new Uint16Array(totalPx * 2); // x,y pairs
    let fLen = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (result[y * w + x]) { frontier[fLen++] = x; frontier[fLen++] = y; }
    }
    for (let step = 1; step < width; step++) {
      const newFrontier = new Uint16Array(totalPx * 2);
      let nLen = 0;
      for (let i = 0; i < fLen; i += 2) {
        const fx = frontier[i], fy = frontier[i + 1];
        const neighbors = [[fx-1,fy],[fx+1,fy],[fx,fy-1],[fx,fy+1]];
        for (const [nx, ny] of neighbors) {
          if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
            const ni = ny * w + nx;
            if (!result[ni] && mask[ni] === matchVal) {
              result[ni] = 1;
              newFrontier[nLen++] = nx;
              newFrontier[nLen++] = ny;
            }
          }
        }
      }
      frontier = newFrontier;
      fLen = nLen;
      if (fLen === 0) break;
    }
    return result;
  };

  if (outer) {
    const dilated = width > 1 ? dilate(outerEdge, alpha, 0) : outerEdge;
    for (let i = 0; i < totalPx; i++) {
      if (dilated[i] && !alpha[i]) {
        const pi = i * 4;
        data[pi] = cr; data[pi + 1] = cg; data[pi + 2] = cb; data[pi + 3] = 255;
      }
    }
  }
  if (inner) {
    const dilated = width > 1 ? dilate(innerEdge, alpha, 1) : innerEdge;
    for (let i = 0; i < totalPx; i++) {
      if (dilated[i] && alpha[i]) {
        const pi = i * 4;
        data[pi] = cr; data[pi + 1] = cg; data[pi + 2] = cb;
      }
    }
  }
  putImageData(c, d);
}

// ============== GAME FILTERS ==============
function applyGameFilter(c: HTMLCanvasElement, mode: number, intensity: number) {
  const w = c.width, h = c.height;
  const ctx = c.getContext('2d')!;
  switch (mode) {
    case 1: { // Pixel art (mosaic)
      const blockSize = Math.max(2, Math.round(6 * intensity));
      const d = getImageData(c);
      const data = d.data;
      for (let by = 0; by < h; by += blockSize) {
        for (let bx = 0; bx < w; bx += blockSize) {
          let tr = 0, tg = 0, tb = 0, cnt = 0;
          for (let dy = 0; dy < blockSize && by + dy < h; dy++) {
            for (let dx = 0; dx < blockSize && bx + dx < w; dx++) {
              const i = ((by + dy) * w + bx + dx) * 4;
              tr += data[i]; tg += data[i + 1]; tb += data[i + 2]; cnt++;
            }
          }
          const ar = Math.round(tr / cnt), ag = Math.round(tg / cnt), ab = Math.round(tb / cnt);
          for (let dy = 0; dy < blockSize && by + dy < h; dy++) {
            for (let dx = 0; dx < blockSize && bx + dx < w; dx++) {
              const i = ((by + dy) * w + bx + dx) * 4;
              data[i] = ar; data[i + 1] = ag; data[i + 2] = ab;
            }
          }
        }
      }
      putImageData(c, d);
      break;
    }
    case 2: { // CRT scanlines
      const d = getImageData(c);
      const data = d.data;
      const lineGap = Math.max(2, Math.round(3 * intensity));
      for (let y = 0; y < h; y++) {
        const darken = (y % lineGap === 0) ? 0.5 : 1;
        for (let x = 0; x < w; x++) {
          const i = (y * w + x) * 4;
          data[i] = Math.round(data[i] * darken);
          data[i + 1] = Math.round(data[i + 1] * darken);
          data[i + 2] = Math.round(data[i + 2] * darken);
        }
      }
      // Slight color channel shift
      const shift = Math.round(2 * intensity);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w - shift; x++) {
          const i = (y * w + x) * 4;
          const si = (y * w + x + shift) * 4;
          data[i] = Math.min(255, data[i] + data[si] * 0.1); // R channel slight bleed
        }
      }
      putImageData(c, d);
      // Vignette
      const grad = ctx.createRadialGradient(w / 2, h / 2, w * 0.3, w / 2, h / 2, w * 0.7);
      grad.addColorStop(0, 'rgba(0,0,0,0)');
      grad.addColorStop(1, `rgba(0,0,0,${0.3 * intensity})`);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);
      break;
    }
    case 3: { // Neon glow
      const d = getImageData(c);
      const data = d.data;
      // Boost saturation + brightness on bright areas
      for (let i = 0; i < data.length; i += 4) {
        const [hue, s, l] = rgbToHsl(data[i], data[i + 1], data[i + 2]);
        const newS = Math.min(1, s * (1 + intensity));
        const newL = l > 0.4 ? Math.min(1, l * (1 + 0.3 * intensity)) : l * (1 - 0.2 * intensity);
        const [r, g, b] = hslToRgb(hue, newS, newL);
        data[i] = r; data[i + 1] = g; data[i + 2] = b;
      }
      putImageData(c, d);
      // Bloom effect via overlay
      const bloom = cloneCanvas(c);
      const bCtx = bloom.getContext('2d')!;
      bCtx.filter = `blur(${8 * intensity}px) brightness(1.5)`;
      bCtx.drawImage(bloom, 0, 0);
      bCtx.filter = 'none';
      ctx.globalCompositeOperation = 'screen';
      ctx.globalAlpha = 0.4 * intensity;
      ctx.drawImage(bloom, 0, 0);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      break;
    }
    case 4: { // 8-bit color
      const d = getImageData(c);
      const data = d.data;
      // Reduce to 8-bit palette (3-3-2)
      for (let i = 0; i < data.length; i += 4) {
        data[i] = Math.round(data[i] / 36) * 36;       // R: 8 levels
        data[i + 1] = Math.round(data[i + 1] / 36) * 36; // G: 8 levels
        data[i + 2] = Math.round(data[i + 2] / 85) * 85; // B: 4 levels
      }
      putImageData(c, d);
      // Slight pixelation
      const bs = Math.max(2, Math.round(3 * intensity));
      const small = document.createElement('canvas');
      small.width = Math.ceil(w / bs);
      small.height = Math.ceil(h / bs);
      const sCtx = small.getContext('2d')!;
      sCtx.drawImage(c, 0, 0, small.width, small.height);
      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, w, h);
      ctx.drawImage(small, 0, 0, w, h);
      ctx.imageSmoothingEnabled = true;
      break;
    }
  }
}

// ============== FACET / BLOCK FILTER ==============
function applyFacet(c: HTMLCanvasElement, mode: number, size: number) {
  const w = c.width, h = c.height;
  const d = getImageData(c);
  const src = new Uint8ClampedArray(d.data);
  const out = d.data;
  const bs = Math.max(3, Math.round(size));

  const fillBlock = (pixels: number[][], x0: number, y0: number, x1: number, y1: number) => {
    // Get average color from source pixels in the block
    let tr = 0, tg = 0, tb = 0, cnt = 0;
    for (const [px, py] of pixels) {
      if (px >= 0 && px < w && py >= 0 && py < h) {
        const si = (py * w + px) * 4;
        tr += src[si]; tg += src[si + 1]; tb += src[si + 2]; cnt++;
      }
    }
    if (cnt === 0) return;
    const ar = Math.round(tr / cnt), ag = Math.round(tg / cnt), ab = Math.round(tb / cnt);
    for (const [px, py] of pixels) {
      if (px >= 0 && px < w && py >= 0 && py < h) {
        const di = (py * w + px) * 4;
        out[di] = ar; out[di + 1] = ag; out[di + 2] = ab;
      }
    }
    // Optional: edge darkening between blocks
    for (let xx = x0; xx <= x1 && xx < w; xx++) {
      if (y0 >= 0 && y0 < h) {
        const ei = (y0 * w + xx) * 4;
        out[ei] = Math.round(out[ei] * 0.85);
        out[ei + 1] = Math.round(out[ei + 1] * 0.85);
        out[ei + 2] = Math.round(out[ei + 2] * 0.85);
      }
    }
    for (let yy = y0; yy <= y1 && yy < h; yy++) {
      if (x0 >= 0 && x0 < w) {
        const ei = (yy * w + x0) * 4;
        out[ei] = Math.round(out[ei] * 0.85);
        out[ei + 1] = Math.round(out[ei + 1] * 0.85);
        out[ei + 2] = Math.round(out[ei + 2] * 0.85);
      }
    }
  };

  switch (mode) {
    case 1: { // Irregular rectangles
      for (let by = 0; by < h; by += bs) {
        for (let bx = 0; bx < w; bx += bs) {
          // Vary block size for irregular look
          const vw = Math.max(2, bs + Math.round((Math.random() - 0.5) * bs * 0.6));
          const vh = Math.max(2, bs + Math.round((Math.random() - 0.5) * bs * 0.6));
          const x1 = Math.min(w - 1, bx + vw);
          const y1 = Math.min(h - 1, by + vh);
          const pixels: number[][] = [];
          for (let yy = by; yy <= y1; yy++) {
            for (let xx = bx; xx <= x1; xx++) {
              pixels.push([xx, yy]);
            }
          }
          fillBlock(pixels, bx, by, x1, y1);
        }
      }
      break;
    }
    case 2: { // Triangle facets
      for (let by = 0; by < h; by += bs) {
        for (let bx = 0; bx < w; bx += bs) {
          const x1 = Math.min(w - 1, bx + bs);
          const y1 = Math.min(h - 1, by + bs);
          // Split each square into 2 triangles
          const triA: number[][] = [];
          const triB: number[][] = [];
          for (let yy = by; yy <= y1; yy++) {
            for (let xx = bx; xx <= x1; xx++) {
              const fx = (xx - bx) / Math.max(1, x1 - bx);
              const fy = (yy - by) / Math.max(1, y1 - by);
              if (fx + fy <= 1) {
                triA.push([xx, yy]);
              } else {
                triB.push([xx, yy]);
              }
            }
          }
          fillBlock(triA, bx, by, x1, y1);
          fillBlock(triB, bx, by, x1, y1);
        }
      }
      break;
    }
    case 3: { // Voronoi cells — optimized with grid spatial lookup
      const numSeeds = Math.max(20, Math.round((w * h) / (bs * bs * 2)));
      const seeds: { x: number; y: number; r: number; g: number; b: number }[] = [];
      for (let i = 0; i < numSeeds; i++) {
        const sx = Math.floor(Math.random() * w);
        const sy = Math.floor(Math.random() * h);
        const si = (sy * w + sx) * 4;
        seeds.push({ x: sx, y: sy, r: src[si], g: src[si + 1], b: src[si + 2] });
      }
      // Build spatial grid for fast nearest-neighbor
      const cellSz = Math.max(1, Math.floor(Math.sqrt((w * h) / numSeeds)));
      const gridW = Math.ceil(w / cellSz);
      const gridH = Math.ceil(h / cellSz);
      const grid: number[][] = new Array(gridW * gridH);
      for (let i = 0; i < grid.length; i++) grid[i] = [];
      for (let i = 0; i < seeds.length; i++) {
        const gx = Math.min(gridW - 1, Math.floor(seeds[i].x / cellSz));
        const gy = Math.min(gridH - 1, Math.floor(seeds[i].y / cellSz));
        grid[gy * gridW + gx].push(i);
      }
      for (let y = 0; y < h; y++) {
        const gy = Math.min(gridH - 1, Math.floor(y / cellSz));
        for (let x = 0; x < w; x++) {
          const gx = Math.min(gridW - 1, Math.floor(x / cellSz));
          let minDist = Infinity, bestIdx = 0;
          // Check 5x5 neighbor grid cells for robustness
          for (let dy = -2; dy <= 2; dy++) {
            const ny = gy + dy;
            if (ny < 0 || ny >= gridH) continue;
            for (let dx = -2; dx <= 2; dx++) {
              const nx = gx + dx;
              if (nx < 0 || nx >= gridW) continue;
              const cell = grid[ny * gridW + nx];
              for (let ci = 0; ci < cell.length; ci++) {
                const s = seeds[cell[ci]];
                const ddx = x - s.x, ddy = y - s.y;
                const dist = ddx * ddx + ddy * ddy;
                if (dist < minDist) { minDist = dist; bestIdx = cell[ci]; }
              }
            }
          }
          const best = seeds[bestIdx];
          const di = (y * w + x) * 4;
          out[di] = best.r; out[di + 1] = best.g; out[di + 2] = best.b;
        }
      }
      break;
    }
    case 4: { // Diamond / hexagonal
      const halfBS = Math.max(2, Math.round(bs / 2));
      for (let by = 0; by < h; by += bs) {
        for (let bx = 0; bx < w; bx += bs) {
          const cx = bx + halfBS, cy = by + halfBS;
          const diamond: number[][] = [];
          for (let yy = by; yy < Math.min(h, by + bs); yy++) {
            for (let xx = bx; xx < Math.min(w, bx + bs); xx++) {
              const dx = Math.abs(xx - cx), dy = Math.abs(yy - cy);
              if (dx + dy <= halfBS) {
                diamond.push([xx, yy]);
              }
            }
          }
          if (diamond.length > 0) fillBlock(diamond, bx, by, Math.min(w - 1, bx + bs), Math.min(h - 1, by + bs));
          // Fill remaining corners with neighbor average
          for (let yy = by; yy < Math.min(h, by + bs); yy++) {
            for (let xx = bx; xx < Math.min(w, bx + bs); xx++) {
              const dx = Math.abs(xx - cx), dy = Math.abs(yy - cy);
              if (dx + dy > halfBS) {
                const si = (yy * w + xx) * 4;
                // Slightly darken corner pixels for edge effect
                out[si] = Math.round(src[si] * 0.8);
                out[si + 1] = Math.round(src[si + 1] * 0.8);
                out[si + 2] = Math.round(src[si + 2] * 0.8);
              }
            }
          }
        }
      }
      break;
    }
  }
  putImageData(c, d);
}

// ============== OIL PAINT (Highly Optimized) ==============
function applyOilPaint(c: HTMLCanvasElement, radius: number, levels: number) {
  const d = getImageData(c);
  const w = c.width, h = c.height;
  const src = d.data;
  const out = new Uint8ClampedArray(src.length);
  const r = Math.min(5, Math.max(1, Math.round(radius))); // Cap at 5 for speed
  const step = r > 3 ? 2 : 1; // Skip pixels for large radius
  const totalPixels = w * h;

  // Fast grayscale pre-computation using bit shifts
  const grayMap = new Uint8Array(totalPixels);
  const levScale = (levels - 1) / 255;
  for (let i = 0; i < totalPixels; i++) {
    const si = i * 4;
    grayMap[i] = ((src[si] * 77 + src[si + 1] * 150 + src[si + 2] * 29) >> 8) * levScale | 0;
  }

  // Pre-allocate bins (reuse per pixel)
  const bins = new Uint16Array(levels);
  const binsR = new Uint32Array(levels);
  const binsG = new Uint32Array(levels);
  const binsB = new Uint32Array(levels);

  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r), y1 = Math.min(h - 1, y + r);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r), x1 = Math.min(w - 1, x + r);
      bins.fill(0); binsR.fill(0); binsG.fill(0); binsB.fill(0);

      for (let sy = y0; sy <= y1; sy += step) {
        const rowOff = sy * w;
        for (let sx = x0; sx <= x1; sx += step) {
          const idx = rowOff + sx;
          const bin = grayMap[idx];
          const si = idx * 4;
          bins[bin]++;
          binsR[bin] += src[si];
          binsG[bin] += src[si + 1];
          binsB[bin] += src[si + 2];
        }
      }

      let maxBin = 0, maxCount = bins[0];
      for (let b = 1; b < levels; b++) {
        if (bins[b] > maxCount) { maxCount = bins[b]; maxBin = b; }
      }

      const di = (y * w + x) * 4;
      if (maxCount > 0) {
        out[di] = binsR[maxBin] / maxCount;
        out[di + 1] = binsG[maxBin] / maxCount;
        out[di + 2] = binsB[maxBin] / maxCount;
      } else {
        out[di] = src[di]; out[di + 1] = src[di + 1]; out[di + 2] = src[di + 2];
      }
      out[di + 3] = src[di + 3];
    }
  }
  putImageData(c, new ImageData(out, w, h));
}

// ============== METAL FILTER ==============
function applyMetal(c: HTMLCanvasElement, intensity: number) {
  const w = c.width, h = c.height;
  const d = getImageData(c);
  const src = new Uint8ClampedArray(d.data);
  const out = d.data;

  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const pi = (y * w + x) * 4;
      // Edge enhancement (emboss-like)
      const tl = (y - 1) * w + (x - 1);
      const br = (y + 1) * w + (x + 1);
      for (let ch = 0; ch < 3; ch++) {
        const emboss = src[pi + ch] * 2 - src[tl * 4 + ch] * 0.5 - src[br * 4 + ch] * 0.5;
        const v = Math.max(0, Math.min(255, emboss));
        out[pi + ch] = v;
      }
    }
  }

  // Desaturate + metallic tint + contrast boost
  for (let i = 0; i < out.length; i += 4) {
    const r = out[i], g = out[i + 1], b = out[i + 2];
    const gray = r * 0.299 + g * 0.587 + b * 0.114;
    // Partial desaturation for metallic look
    const desat = 0.3 + 0.7 * (1 - intensity * 0.5);
    let mr = gray * (1 - desat) + r * desat;
    let mg = gray * (1 - desat) + g * desat;
    let mb = gray * (1 - desat) + b * desat;
    // Cool metallic tint (slight blue/silver shift)
    mr = mr * (1 - intensity * 0.15);
    mg = mg * (1 - intensity * 0.05);
    mb = mb * (1 + intensity * 0.12);
    // Contrast boost
    const contrast = 1 + intensity * 0.4;
    mr = (mr - 128) * contrast + 128;
    mg = (mg - 128) * contrast + 128;
    mb = (mb - 128) * contrast + 128;
    // Specular highlights
    if (gray > 200) {
      const spec = ((gray - 200) / 55) * intensity * 80;
      mr += spec; mg += spec; mb += spec * 1.1;
    }
    out[i] = Math.max(0, Math.min(255, mr));
    out[i + 1] = Math.max(0, Math.min(255, mg));
    out[i + 2] = Math.max(0, Math.min(255, mb));
  }
  putImageData(c, d);
}

// ============== PALETTE KNIFE (Highly Optimized) ==============
function applyPaletteKnife(c: HTMLCanvasElement, strokeLen: number, direction: number) {
  const w = c.width, h = c.height;
  const d = getImageData(c);
  const src = d.data;
  const out = new Uint8ClampedArray(src.length);
  const rad = (direction * Math.PI) / 180;
  const ddx = Math.cos(rad);
  const ddy = Math.sin(rad);
  const len = Math.min(20, Math.max(2, Math.round(strokeLen))); // Cap for speed
  const step = len > 10 ? 2 : 1; // Skip samples for long strokes
  const numBins = 6; // Reduced bins for speed

  // Pre-compute sample offsets
  const samples: [number, number][] = [];
  for (let t = -len; t <= len; t += step) {
    samples.push([Math.round(t * ddx), Math.round(t * ddy)]);
  }
  const sampleCount = samples.length;

  // Pre-allocate bins
  const bins = new Uint16Array(numBins);
  const binsR = new Uint32Array(numBins);
  const binsG = new Uint32Array(numBins);
  const binsB = new Uint32Array(numBins);
  const binScale = numBins / 766;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      bins.fill(0); binsR.fill(0); binsG.fill(0); binsB.fill(0);

      for (let i = 0; i < sampleCount; i++) {
        const sx = Math.max(0, Math.min(w - 1, x + samples[i][0]));
        const sy = Math.max(0, Math.min(h - 1, y + samples[i][1]));
        const si = (sy * w + sx) * 4;
        const bin = Math.min(numBins - 1, ((src[si] + src[si + 1] + src[si + 2]) * binScale) | 0);
        bins[bin]++;
        binsR[bin] += src[si];
        binsG[bin] += src[si + 1];
        binsB[bin] += src[si + 2];
      }

      let maxBin = 0, maxCount = bins[0];
      for (let b = 1; b < numBins; b++) {
        if (bins[b] > maxCount) { maxCount = bins[b]; maxBin = b; }
      }
      const di = (y * w + x) * 4;
      if (maxCount > 0) {
        out[di] = binsR[maxBin] / maxCount;
        out[di + 1] = binsG[maxBin] / maxCount;
        out[di + 2] = binsB[maxBin] / maxCount;
      } else {
        out[di] = src[di]; out[di + 1] = src[di + 1]; out[di + 2] = src[di + 2];
      }
      out[di + 3] = src[di + 3];
    }
  }
  putImageData(c, new ImageData(out, w, h));
}

// ============== TEXTURE / BRUSH FILTERS ==============
function applyTextureFilter(c: HTMLCanvasElement, mode: number, intensity: number) {
  if (mode === 0) return;
  const w = c.width, h = c.height;
  const d = getImageData(c);
  const src = new Uint8ClampedArray(d.data);
  const out = d.data;

  switch (mode) {
    case 1: { // Canvas texture — woven fabric pattern
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = (y * w + x) * 4;
          // Woven pattern: alternating horizontal/vertical threads
          const tx = Math.sin(x * 0.8) * 0.5 + 0.5;
          const ty = Math.sin(y * 0.8) * 0.5 + 0.5;
          const pattern = (tx * ty) * 0.3 + 0.7; // 0.7–1.0 range
          const lum = (src[i] + src[i + 1] + src[i + 2]) / 765; // 0–1
          // More texture visible on lighter areas
          const texFactor = 1 - (1 - pattern) * intensity * (0.3 + lum * 0.7);
          out[i] = Math.max(0, Math.min(255, src[i] * texFactor));
          out[i + 1] = Math.max(0, Math.min(255, src[i + 1] * texFactor));
          out[i + 2] = Math.max(0, Math.min(255, src[i + 2] * texFactor));
          out[i + 3] = src[i + 3]; // preserve alpha
        }
      }
      break;
    }
    case 2: { // Watercolor — color bleeding + edge darkening
      // Slight pixel displacement for bleeding effect
      const disp = Math.round(3 * intensity);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = (y * w + x) * 4;
          const ox = Math.max(0, Math.min(w - 1, x + Math.round((Math.random() - 0.5) * disp)));
          const oy = Math.max(0, Math.min(h - 1, y + Math.round((Math.random() - 0.5) * disp)));
          const si = (oy * w + ox) * 4;
          out[i] = src[si];
          out[i + 1] = src[si + 1];
          out[i + 2] = src[si + 2];
          out[i + 3] = src[i + 3];
        }
      }
      // Edge darkening via Sobel
      const copy = new Uint8ClampedArray(out);
      for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
          const i = (y * w + x) * 4;
          const gray = (copy[i] * 0.299 + copy[i + 1] * 0.587 + copy[i + 2] * 0.114);
          const grayL = (copy[(y * w + x - 1) * 4] * 0.299 + copy[(y * w + x - 1) * 4 + 1] * 0.587 + copy[(y * w + x - 1) * 4 + 2] * 0.114);
          const grayR = (copy[(y * w + x + 1) * 4] * 0.299 + copy[(y * w + x + 1) * 4 + 1] * 0.587 + copy[(y * w + x + 1) * 4 + 2] * 0.114);
          const grayU = (copy[((y - 1) * w + x) * 4] * 0.299 + copy[((y - 1) * w + x) * 4 + 1] * 0.587 + copy[((y - 1) * w + x) * 4 + 2] * 0.114);
          const grayD = (copy[((y + 1) * w + x) * 4] * 0.299 + copy[((y + 1) * w + x) * 4 + 1] * 0.587 + copy[((y + 1) * w + x) * 4 + 2] * 0.114);
          const edgeH = Math.abs(grayR - grayL);
          const edgeV = Math.abs(grayD - grayU);
          const edge = Math.min(1, (edgeH + edgeV) / 200 * intensity);
          const darken = 1 - edge * 0.5;
          out[i] = Math.max(0, out[i] * darken);
          out[i + 1] = Math.max(0, out[i + 1] * darken);
          out[i + 2] = Math.max(0, out[i + 2] * darken);
          // Random lightness variation for paper absorption
          const variation = (Math.random() - 0.5) * 10 * intensity;
          out[i] = Math.max(0, Math.min(255, out[i] + variation));
          out[i + 1] = Math.max(0, Math.min(255, out[i + 1] + variation));
          out[i + 2] = Math.max(0, Math.min(255, out[i + 2] + variation));
          void gray; // used for context
        }
      }
      break;
    }
    case 3: { // Crayon — diagonal hatching with gaps
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = (y * w + x) * 4;
          // Diagonal hatch pattern
          const hatch = Math.sin((x + y) * 0.4) * 0.5 + 0.5;
          // Random gaps where paper shows through
          const gap = Math.random() < 0.15 * intensity ? 0.6 : 1.0;
          const factor = (0.7 + hatch * 0.3) * gap;
          // Slight color variation
          const colorVar = (Math.random() - 0.5) * 15 * intensity;
          out[i] = Math.max(0, Math.min(255, src[i] * factor + colorVar));
          out[i + 1] = Math.max(0, Math.min(255, src[i + 1] * factor + colorVar));
          out[i + 2] = Math.max(0, Math.min(255, src[i + 2] * factor + colorVar));
          out[i + 3] = src[i + 3];
        }
      }
      break;
    }
    case 4: { // Impasto — thick paint with emboss/relief
      for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
          const i = (y * w + x) * 4;
          for (let ch = 0; ch < 3; ch++) {
            const tl = src[((y - 1) * w + (x - 1)) * 4 + ch];
            const br = src[((y + 1) * w + (x + 1)) * 4 + ch];
            // Directional emboss — light from top-left
            const emboss = src[i + ch] + (src[i + ch] - tl) * 0.5 * intensity - (br - src[i + ch]) * 0.3 * intensity;
            out[i + ch] = Math.max(0, Math.min(255, emboss));
          }
          out[i + 3] = src[i + 3];
        }
      }
      // Border pixels
      for (let x = 0; x < w; x++) {
        const t = x * 4, b2 = ((h - 1) * w + x) * 4;
        out[t] = src[t]; out[t + 1] = src[t + 1]; out[t + 2] = src[t + 2]; out[t + 3] = src[t + 3];
        out[b2] = src[b2]; out[b2 + 1] = src[b2 + 1]; out[b2 + 2] = src[b2 + 2]; out[b2 + 3] = src[b2 + 3];
      }
      for (let y = 0; y < h; y++) {
        const l = (y * w) * 4, r = (y * w + w - 1) * 4;
        out[l] = src[l]; out[l + 1] = src[l + 1]; out[l + 2] = src[l + 2]; out[l + 3] = src[l + 3];
        out[r] = src[r]; out[r + 1] = src[r + 1]; out[r + 2] = src[r + 2]; out[r + 3] = src[r + 3];
      }
      break;
    }
    case 5: { // Crosshatch — pen & ink style
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = (y * w + x) * 4;
          const gray = src[i] * 0.299 + src[i + 1] * 0.587 + src[i + 2] * 0.114;
          const darkness = 1 - gray / 255; // 0=light, 1=dark
          let ink = 0;
          // Layer 1: horizontal lines (darkness > 0.2)
          if (darkness > 0.2 * (2 - intensity)) {
            const line1 = ((y % 4) < 1) ? 1 : 0;
            ink += line1;
          }
          // Layer 2: vertical lines (darkness > 0.4)
          if (darkness > 0.4 * (2 - intensity)) {
            const line2 = ((x % 4) < 1) ? 1 : 0;
            ink += line2;
          }
          // Layer 3: diagonal (\) lines (darkness > 0.6)
          if (darkness > 0.6 * (2 - intensity)) {
            const line3 = (((x + y) % 5) < 1) ? 1 : 0;
            ink += line3;
          }
          // Layer 4: diagonal (/) lines (darkness > 0.8)
          if (darkness > 0.8 * (2 - intensity)) {
            const line4 = (((x - y + 500) % 5) < 1) ? 1 : 0;
            ink += line4;
          }
          const v = ink > 0 ? 0 : 255;
          out[i] = v; out[i + 1] = v; out[i + 2] = v;
          out[i + 3] = src[i + 3];
        }
      }
      break;
    }
    case 6: { // Stipple — pointillism dots
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = (y * w + x) * 4;
          const gray = src[i] * 0.299 + src[i + 1] * 0.587 + src[i + 2] * 0.114;
          const darkness = 1 - gray / 255;
          // Probability of a dot proportional to darkness
          const dotProb = darkness * intensity * 0.8;
          if (Math.random() < dotProb) {
            out[i] = 0; out[i + 1] = 0; out[i + 2] = 0;
          } else {
            out[i] = 255; out[i + 1] = 255; out[i + 2] = 255;
          }
          out[i + 3] = src[i + 3];
        }
      }
      break;
    }
  }
  putImageData(c, d);
}

// ============== LAYER SATURATION (pixel-level, reliable) ==============
function applyLayerSaturation(c: HTMLCanvasElement, saturation: number) {
  if (saturation === 100) return;
  const d = getImageData(c);
  const data = d.data;
  const factor = saturation / 100;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const gray = 0.299 * r + 0.587 * g + 0.114 * b;
    data[i] = Math.max(0, Math.min(255, gray + (r - gray) * factor));
    data[i + 1] = Math.max(0, Math.min(255, gray + (g - gray) * factor));
    data[i + 2] = Math.max(0, Math.min(255, gray + (b - gray) * factor));
  }
  putImageData(c, d);
}

// ============== GRADIENT FADE TRANSPARENCY ==============
function applyGradientFade(c: HTMLCanvasElement, direction: number, amount: number) {
  const w = c.width, h = c.height;
  const d = getImageData(c);
  const data = d.data;
  const strength = amount / 100; // 0-1

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      let t = 0; // gradient position 0-1
      switch (direction) {
        case 0: t = x / w; break; // left to right (fade right)
        case 1: t = 1 - x / w; break; // right to left (fade left)
        case 2: t = y / h; break; // top to bottom (fade bottom)
        case 3: t = 1 - y / h; break; // bottom to top (fade top)
        case 4: { // center outward (radial fade)
          const dx = (x / w - 0.5) * 2;
          const dy = (y / h - 0.5) * 2;
          t = Math.sqrt(dx * dx + dy * dy) / 1.414;
          break;
        }
      }
      // Apply fade: t=0 is full opacity, t=1 is transparent
      const fade = 1 - t * strength;
      data[i + 3] = Math.round(data[i + 3] * Math.max(0, fade));
    }
  }
  putImageData(c, d);
}

// ============== CHANNEL COLOR SHIFTS (Red-Green, Yellow-Blue, Pink-Cyan) ==============
function applyChannelShifts(c: HTMLCanvasElement, rg: number, yb: number, pc: number) {
  if (rg === 0 && yb === 0 && pc === 0) return;
  const d = getImageData(c);
  const data = d.data;

  for (let i = 0; i < data.length; i += 4) {
    let r = data[i], g = data[i + 1], b = data[i + 2];

    // Red-Green axis: positive = more red/less green, negative = more green/less red
    if (rg !== 0) {
      const shift = rg * 1.27; // -100 to 100 → -127 to 127
      r = Math.max(0, Math.min(255, r + shift));
      g = Math.max(0, Math.min(255, g - shift));
    }

    // Yellow-Blue axis: positive = more yellow (R+G)/less blue, negative = more blue/less yellow
    if (yb !== 0) {
      const shift = yb * 1.27;
      r = Math.max(0, Math.min(255, r + shift * 0.5));
      g = Math.max(0, Math.min(255, g + shift * 0.5));
      b = Math.max(0, Math.min(255, b - shift));
    }

    // Pink-Cyan axis: positive = more pink (R+B)/less cyan, negative = more cyan/less pink
    if (pc !== 0) {
      const shift = pc * 1.27;
      r = Math.max(0, Math.min(255, r + shift * 0.5));
      g = Math.max(0, Math.min(255, g - shift));
      b = Math.max(0, Math.min(255, b + shift * 0.5));
    }

    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
  }
  putImageData(c, d);
}

// ============== WARP MESH DISTORTION ==============
export function applyWarpMesh(
  c: HTMLCanvasElement,
  mesh: { rows: number; cols: number; points: { x: number; y: number }[] }
): HTMLCanvasElement {
  const w = c.width, h = c.height;
  const out = document.createElement('canvas');
  out.width = w; out.height = h;
  const ctx = out.getContext('2d')!;
  const srcData = c.getContext('2d')!.getImageData(0, 0, w, h);
  const dstData = ctx.createImageData(w, h);
  const src = srcData.data, dst = dstData.data;
  
  const { rows, cols, points } = mesh;
  const cellW = w / (cols - 1);
  const cellH = h / (rows - 1);
  
  // Get mesh point at grid position
  const getPoint = (r: number, c: number) => {
    const idx = r * cols + c;
    return points[idx] || { x: c * cellW, y: r * cellH };
  };
  
  // Bilinear interpolation within a cell
  const bilinear = (x: number, y: number, p00: {x:number,y:number}, p10: {x:number,y:number}, p01: {x:number,y:number}, p11: {x:number,y:number}) => {
    const tx = x, ty = y;
    const x0 = p00.x * (1 - tx) + p10.x * tx;
    const x1 = p01.x * (1 - tx) + p11.x * tx;
    const y0 = p00.y * (1 - ty) + p10.y * ty;
    const y1 = p01.y * (1 - ty) + p11.y * ty;
    return {
      x: x0 * (1 - ty) + x1 * ty,
      y: y0 * (1 - ty) + y1 * ty
    };
  };
  
  // For each destination pixel, find source via inverse warp
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      // Find which mesh cell this pixel is in
      const gx = dx / cellW;
      const gy = dy / cellH;
      const ci = Math.min(cols - 2, Math.floor(gx));
      const ri = Math.min(rows - 2, Math.floor(gy));
      const fx = gx - ci;
      const fy = gy - ri;
      
      // Get the 4 corners of the mesh cell
      const p00 = getPoint(ri, ci);
      const p10 = getPoint(ri, ci + 1);
      const p01 = getPoint(ri + 1, ci);
      const p11 = getPoint(ri + 1, ci + 1);
      
      // Source position via bilinear interpolation
      const srcPos = bilinear(fx, fy, p00, p10, p01, p11);
      const sx = Math.round(srcPos.x);
      const sy = Math.round(srcPos.y);
      
      const di = (dy * w + dx) * 4;
      if (sx >= 0 && sx < w && sy >= 0 && sy < h) {
        const si = (sy * w + sx) * 4;
        dst[di] = src[si];
        dst[di + 1] = src[si + 1];
        dst[di + 2] = src[si + 2];
        dst[di + 3] = src[si + 3];
      } else {
        dst[di + 3] = 0; // transparent outside
      }
    }
  }
  
  ctx.putImageData(dstData, 0, 0);
  return out;
}

// ============== GLOBAL HUE ROTATION ==============
function applyGlobalHueRotate(c: HTMLCanvasElement, degrees: number) {
  if (degrees === 0) return;
  const d = getImageData(c);
  const data = d.data;
  for (let i = 0; i < data.length; i += 4) {
    const [h, s, l] = rgbToHsl(data[i], data[i + 1], data[i + 2]);
    const [r, g, b] = hslToRgb(h + degrees, s, l);
    data[i] = r; data[i + 1] = g; data[i + 2] = b;
  }
  putImageData(c, d);
}

// ============== COLOR SEPARATION ==============
function applyColorSeparation(c: HTMLCanvasElement, levR: number, levG: number, levB: number, mix: number) {
  if (mix <= 0) return;
  const d = getImageData(c);
  const data = d.data;
  const stepR = 255 / (levR - 1);
  const stepG = 255 / (levG - 1);
  const stepB = 255 / (levB - 1);
  const m = mix;
  const m1 = 1 - m;
  for (let i = 0; i < data.length; i += 4) {
    const sr = Math.round(Math.round(data[i] / stepR) * stepR);
    const sg = Math.round(Math.round(data[i + 1] / stepG) * stepG);
    const sb = Math.round(Math.round(data[i + 2] / stepB) * stepB);
    data[i] = Math.round(data[i] * m1 + sr * m);
    data[i + 1] = Math.round(data[i + 1] * m1 + sg * m);
    data[i + 2] = Math.round(data[i + 2] * m1 + sb * m);
  }
  putImageData(c, d);
}

// ============== MAIN PIPELINE ==============
export function applyFilters(
  img: HTMLImageElement,
  filters: LayerFilters,
  maxSize?: number
): HTMLCanvasElement {
  const c = imgToCanvas(img, maxSize);

  // Brightness/Contrast
  if (filters.brightness !== 0 || filters.contrast !== 0) {
    applyBrightnessContrast(c, filters.brightness, filters.contrast);
  }
  // Hue / Saturation / Color temp
  if (filters.hueShift !== 0 || filters.saturation !== 0 || filters.colorTempShift !== 0) {
    applyHueSatTemp(c, filters.hueShift, filters.saturation, filters.colorTempShift);
  }
  // Blur (new types)
  if (filters.blurType > 0 && filters.blurRadius > 0) {
    applyNewBlur(c, filters.blurType, filters.blurRadius, filters.blurAngle);
  }
  // Frosted glass
  if (filters.frostedGlass && filters.frostedGlassAmount > 0) {
    applyFrostedGlass(c, filters.frostedGlassAmount);
  }
  // Noise (new types)
  if (filters.noiseType > 0 && filters.noiseAmount > 0) {
    applyNewNoise(c, filters.noiseType, filters.noiseAmount, filters.noiseDensity);
  }
  // Posterize
  if (filters.posterize > 0) applyPosterize(c, filters.posterize);
  // Posterize styles
  if (filters.posterizeStyle > 0) applyPosterizeStyle(c, filters.posterizeStyle, filters.posterizeColorShift);
  // Line art
  if (filters.lineArt) applyLineArt(c, filters.lineArtThreshold, filters.lineArtBlend, filters.lineArtColorBlend);
  // Find edges
  if (filters.findEdges) applyFindEdges(c, filters.findEdgesStrength, filters.findEdgesBlend);
  // Invert
  if (filters.invert) applyInvert(c);
  // Levels (Manga)
  if (filters.levels) {
    applyLevels(c, filters.levelsBlack, filters.levelsWhite, filters.levelsGamma, filters.levelsMono);
  }
  // Halftone (after levels for manga combo)
  if (filters.halftone) {
    applyHalftone(c, filters.halftoneSize, filters.halftoneAngle, filters.halftoneColorMode, filters.halftoneColorBlend, filters.halftoneBlendMode);
  }
  // Stroke
  if (filters.strokeEnabled) {
    applyStroke(c, filters.strokeColor, filters.strokeWidth, filters.strokeInner, filters.strokeOuter);
  }
  // Facet filter
  if (filters.facetFilter > 0) {
    applyFacet(c, filters.facetFilter, filters.facetSize);
  }
  // Oil paint
  if (filters.oilPaint) {
    applyOilPaint(c, filters.oilPaintRadius, filters.oilPaintLevels);
  }
  // Metal
  if (filters.metalFilter) {
    applyMetal(c, filters.metalIntensity);
  }
  // Palette Knife
  if (filters.paletteKnife) {
    applyPaletteKnife(c, filters.paletteKnifeLength, filters.paletteKnifeDirection);
  }
  // Texture / Brush filter
  if (filters.textureFilter > 0) {
    applyTextureFilter(c, filters.textureFilter, filters.textureIntensity);
  }
  // Color Separation
  if (filters.colorSepEnabled && filters.colorSepMix > 0) {
    applyColorSeparation(c, filters.colorSepR, filters.colorSepG, filters.colorSepB, filters.colorSepMix);
  }
  // Game filters (applied last)
  if (filters.gameFilter > 0) {
    applyGameFilter(c, filters.gameFilter, filters.gameFilterIntensity);
  }
  // Channel color shifts (red-green, yellow-blue, pink-cyan)
  if (filters.channelShiftRG !== 0 || filters.channelShiftYB !== 0 || filters.channelShiftPC !== 0) {
    applyChannelShifts(c, filters.channelShiftRG, filters.channelShiftYB, filters.channelShiftPC);
  }
  // Gradient fade transparency
  if (filters.gradientFade && filters.gradientFadeAmount > 0) {
    applyGradientFade(c, filters.gradientFadeDirection, filters.gradientFadeAmount);
  }

  return c;
}

// Convenience wrapper used by App.tsx
// 5th arg: optional sourceCanvas for text/shape layers (no HTMLImageElement)
export function processLayerFilters(
  img: HTMLImageElement | null,
  filters: LayerFilters,
  maxSize?: number,
  globalHueRotate?: number,
  sourceCanvas?: HTMLCanvasElement,
  layerSaturation?: number
): HTMLCanvasElement {
  let c: HTMLCanvasElement;
  if (sourceCanvas) {
    c = processFiltersFromCanvas(sourceCanvas, filters, maxSize, globalHueRotate, layerSaturation);
    return c;
  }
  c = applyFilters(img!, filters, maxSize);
  if (globalHueRotate && globalHueRotate !== 0) {
    applyGlobalHueRotate(c, globalHueRotate);
  }
  if (layerSaturation !== undefined && layerSaturation !== 100) {
    applyLayerSaturation(c, layerSaturation);
  }
  return c;
}

// Process filters from a canvas source (for post-wand cutout images)
export function processFiltersFromCanvas(
  srcCanvas: HTMLCanvasElement,
  filters: LayerFilters,
  maxSize?: number,
  globalHueRotate?: number,
  layerSaturation?: number
): HTMLCanvasElement {
  let w = srcCanvas.width, h = srcCanvas.height;
  if (maxSize && (w > maxSize || h > maxSize)) {
    const r = Math.min(maxSize / w, maxSize / h);
    w = Math.round(w * r); h = Math.round(h * r);
  }
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  c.getContext('2d')!.drawImage(srcCanvas, 0, 0, w, h);

  // Same pipeline as applyFilters
  if (filters.brightness !== 0 || filters.contrast !== 0) applyBrightnessContrast(c, filters.brightness, filters.contrast);
  if (filters.hueShift !== 0 || filters.saturation !== 0 || filters.colorTempShift !== 0) applyHueSatTemp(c, filters.hueShift, filters.saturation, filters.colorTempShift);
  if (filters.blurType > 0 && filters.blurRadius > 0) applyNewBlur(c, filters.blurType, filters.blurRadius, filters.blurAngle);
  if (filters.frostedGlass && filters.frostedGlassAmount > 0) applyFrostedGlass(c, filters.frostedGlassAmount);
  if (filters.noiseType > 0 && filters.noiseAmount > 0) applyNewNoise(c, filters.noiseType, filters.noiseAmount, filters.noiseDensity);
  if (filters.posterize > 0) applyPosterize(c, filters.posterize);
  if (filters.posterizeStyle > 0) applyPosterizeStyle(c, filters.posterizeStyle, filters.posterizeColorShift);
  if (filters.lineArt) applyLineArt(c, filters.lineArtThreshold, filters.lineArtBlend, filters.lineArtColorBlend);
  if (filters.findEdges) applyFindEdges(c, filters.findEdgesStrength, filters.findEdgesBlend);
  if (filters.invert) applyInvert(c);
  if (filters.levels) applyLevels(c, filters.levelsBlack, filters.levelsWhite, filters.levelsGamma, filters.levelsMono);
  if (filters.halftone) applyHalftone(c, filters.halftoneSize, filters.halftoneAngle, filters.halftoneColorMode, filters.halftoneColorBlend, filters.halftoneBlendMode);
  if (filters.strokeEnabled) applyStroke(c, filters.strokeColor, filters.strokeWidth, filters.strokeInner, filters.strokeOuter);
  if (filters.facetFilter > 0) applyFacet(c, filters.facetFilter, filters.facetSize);
  if (filters.oilPaint) applyOilPaint(c, filters.oilPaintRadius, filters.oilPaintLevels);
  if (filters.metalFilter) applyMetal(c, filters.metalIntensity);
  if (filters.paletteKnife) applyPaletteKnife(c, filters.paletteKnifeLength, filters.paletteKnifeDirection);
  if (filters.textureFilter > 0) applyTextureFilter(c, filters.textureFilter, filters.textureIntensity);
  if (filters.colorSepEnabled && filters.colorSepMix > 0) applyColorSeparation(c, filters.colorSepR, filters.colorSepG, filters.colorSepB, filters.colorSepMix);
  if (filters.gameFilter > 0) applyGameFilter(c, filters.gameFilter, filters.gameFilterIntensity);
  // Channel color shifts
  if (filters.channelShiftRG !== 0 || filters.channelShiftYB !== 0 || filters.channelShiftPC !== 0) {
    applyChannelShifts(c, filters.channelShiftRG, filters.channelShiftYB, filters.channelShiftPC);
  }
  // Gradient fade transparency
  if (filters.gradientFade && filters.gradientFadeAmount > 0) {
    applyGradientFade(c, filters.gradientFadeDirection, filters.gradientFadeAmount);
  }

  if (globalHueRotate && globalHueRotate !== 0) applyGlobalHueRotate(c, globalHueRotate);
  if (layerSaturation !== undefined && layerSaturation !== 100) applyLayerSaturation(c, layerSaturation);
  return c;
}
