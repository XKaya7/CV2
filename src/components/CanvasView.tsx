import React, { useRef, useEffect, useState, useCallback } from 'react';
import type { Layer, Tool, BrushSettings, Viewport, SelectionData } from '../types';

interface CanvasViewProps {
  layers: Layer[];
  selectedLayerId: string | null;
  selectedLayerIds: string[];
  showBorders: boolean;
  tool: Tool;
  brushSettings: BrushSettings;
  viewport: Viewport;
  onViewportChange: (v: Viewport) => void;
  onLayerSelect: (id: string | null) => void;
  onLayerUpdate: (id: string, updates: Partial<Layer>) => void;
  onDrop: (files: FileList, worldX: number, worldY: number) => void;
  onBeforeStroke?: (layerId: string) => void;
  onAfterStroke?: (layerId: string) => void;
  onBoxSelect: (ids: string[]) => void;
  onBackgroundTap: () => void;
  onLayerRetap: () => void;
  onMagicWand?: (layerId: string, worldX: number, worldY: number) => void;
  magicWandThreshold?: number;
  // Selection tools
  selection: SelectionData | null;
  onSelectionChange: (sel: SelectionData | null) => void;
  // Pen tool
  penPoints?: [number, number][];
  onPenPointAdd?: (pt: [number, number]) => void;
}

interface DragState {
  active: boolean;
  mode: 'none' | 'pan' | 'move' | 'resize' | 'draw' | 'pinch' | 'pinchScale' | 'boxSelect' | 'longPressWait' | 'rectSelect' | 'lassoSelect' | 'penLongPress' | 'penDrag';
  startSX: number;
  startSY: number;
  startPanX: number;
  startPanY: number;
  startLayerX: number;
  startLayerY: number;
  startLayerSX: number;
  startLayerSY: number;
  resizeCorner: number;
  pinchStartDist: number;
  pinchStartZoom: number;
  pinchCenterX: number;
  pinchCenterY: number;
  pinchScaleLayerId: string;
  pinchScaleStartScale: number;
  pinchScaleLayerCX: number;
  pinchScaleLayerCY: number;
  pinchAnchorFracX: number;
  pinchAnchorFracY: number;
  drawLayerId: string;
  boxStartWX: number;
  boxStartWY: number;
  boxEndWX: number;
  boxEndWY: number;
  hasMoved: boolean;
  tappedLayerId: string;
  isRetap: boolean;
  // Selection tool state
  selLayerId: string;
  selStartLocalX: number;
  selStartLocalY: number;
  selEndLocalX: number;
  selEndLocalY: number;
  lassoPath: [number, number][];
  penDragIdx: number;
  penLongPressWX: number;
  penLongPressWY: number;
  // Rotation drag state
  rotateDrag: boolean;
  rotateStartAngle: number;
  rotateLayerStartRot: number;
}

export const CanvasView: React.FC<CanvasViewProps> = ({
  layers, selectedLayerId, selectedLayerIds, showBorders, tool, brushSettings,
  viewport, onViewportChange, onLayerSelect, onLayerUpdate, onDrop,
  onBeforeStroke, onAfterStroke, onBoxSelect, onBackgroundTap, onLayerRetap,
  onMagicWand,
  selection, onSelectionChange,
  penPoints, onPenPointAdd,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [canvasSize, setCanvasSize] = useState({ w: 800, h: 600 });

  const layersRef = useRef(layers); layersRef.current = layers;
  const selectedRef = useRef(selectedLayerId); selectedRef.current = selectedLayerId;
  const selectedIdsRef = useRef(selectedLayerIds); selectedIdsRef.current = selectedLayerIds;
  const showBordersRef = useRef(showBorders); showBordersRef.current = showBorders;
  const viewportRef = useRef(viewport); viewportRef.current = viewport;
  const toolRef = useRef(tool); toolRef.current = tool;
  const brushRef = useRef(brushSettings); brushRef.current = brushSettings;
  const onBeforeStrokeRef = useRef(onBeforeStroke); onBeforeStrokeRef.current = onBeforeStroke;
  const onAfterStrokeRef = useRef(onAfterStroke); onAfterStrokeRef.current = onAfterStroke;
  const onBoxSelectRef = useRef(onBoxSelect); onBoxSelectRef.current = onBoxSelect;
  const onBackgroundTapRef = useRef(onBackgroundTap); onBackgroundTapRef.current = onBackgroundTap;
  const onLayerRetapRef = useRef(onLayerRetap); onLayerRetapRef.current = onLayerRetap;
  const onMagicWandRef = useRef(onMagicWand); onMagicWandRef.current = onMagicWand;
  const selectionRef = useRef(selection); selectionRef.current = selection;
  const onSelectionChangeRef = useRef(onSelectionChange); onSelectionChangeRef.current = onSelectionChange;
  const penPointsRef = useRef(penPoints); penPointsRef.current = penPoints;
  const onPenPointAddRef = useRef(onPenPointAdd); onPenPointAddRef.current = onPenPointAdd;

  const drag = useRef<DragState>({
    active: false, mode: 'none',
    startSX: 0, startSY: 0, startPanX: 0, startPanY: 0,
    startLayerX: 0, startLayerY: 0, startLayerSX: 1, startLayerSY: 1,
    resizeCorner: -1, pinchStartDist: 0, pinchStartZoom: 1,
    pinchCenterX: 0, pinchCenterY: 0,
    pinchScaleLayerId: '', pinchScaleStartScale: 1,
    pinchScaleLayerCX: 0, pinchScaleLayerCY: 0,
    pinchAnchorFracX: 0.5, pinchAnchorFracY: 0.5,
    drawLayerId: '',
    boxStartWX: 0, boxStartWY: 0, boxEndWX: 0, boxEndWY: 0,
    hasMoved: false, tappedLayerId: '', isRetap: false,
    selLayerId: '', selStartLocalX: 0, selStartLocalY: 0,
    selEndLocalX: 0, selEndLocalY: 0, lassoPath: [],
    penDragIdx: -1, penLongPressWX: 0, penLongPressWY: 0,
    rotateDrag: false, rotateStartAngle: 0, rotateLayerStartRot: 0,
  });

  const multiStartPositions = useRef(new Map<string, { x: number; y: number }>());
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const antOffset = useRef(0);

  const screenToWorld = useCallback((sx: number, sy: number, vp: Viewport) => ({
    x: (sx - vp.panX) / vp.zoom,
    y: (sy - vp.panY) / vp.zoom,
  }), []);

  const worldToLocal = useCallback((wx: number, wy: number, l: Layer): { lx: number; ly: number } => {
    const lw = l.width * l.scaleX, lh = l.height * l.scaleY;
    const cx = l.x + lw / 2, cy = l.y + lh / 2;
    const cos = Math.cos(-l.rotation), sin = Math.sin(-l.rotation);
    const dx = wx - cx, dy = wy - cy;
    return { lx: dx * cos - dy * sin + lw / 2, ly: dx * sin + dy * cos + lh / 2 };
  }, []);

  // Convert world coords to layer-local pixel coords (accounting for scale, rotation, and flip)
  const worldToLayerPixel = useCallback((wx: number, wy: number, l: Layer): { px: number; py: number } => {
    const lw = l.width * l.scaleX, lh = l.height * l.scaleY;
    const cx = l.x + lw / 2, cy = l.y + lh / 2;
    // Inverse rotate around layer center
    const cos = Math.cos(-l.rotation), sin = Math.sin(-l.rotation);
    const dx = wx - cx, dy = wy - cy;
    const rotatedX = dx * cos - dy * sin;
    const rotatedY = dx * sin + dy * cos;
    // Convert to local display coords (0 to lw/lh)
    let localLX = rotatedX + lw / 2;
    let localLY = rotatedY + lh / 2;
    // Account for flip
    if (l.flipH) localLX = lw - localLX;
    if (l.flipV) localLY = lh - localLY;
    // Convert from display size to pixel coords
    const px = localLX / l.scaleX;
    const py = localLY / l.scaleY;
    return { px, py };
  }, []);

  const hitTest = useCallback((wx: number, wy: number, ls: Layer[]): string | null => {
    for (let i = ls.length - 1; i >= 0; i--) {
      const l = ls[i];
      if (!l.visible || l.locked) continue;
      if (l.type === 'drawing') {
        if (l.paintedBounds) {
          const b = l.paintedBounds;
          // Convert world coords to layer-local coords accounting for scale
          const localX = (wx - l.x) / Math.abs(l.scaleX);
          const localY = (wy - l.y) / Math.abs(l.scaleY);
          if (localX >= b.minX && localX <= b.maxX && localY >= b.minY && localY <= b.maxY) return l.id;
        }
        continue;
      }
      // Use cropBounds if available (shapes, boolean, pen, pasted selections)
      const cb = l.cropBounds;
      if (cb) {
        const hx = l.x + cb.x * Math.abs(l.scaleX);
        const hy = l.y + cb.y * Math.abs(l.scaleY);
        const hw = cb.w * Math.abs(l.scaleX);
        const hh = cb.h * Math.abs(l.scaleY);
        if (l.rotation !== 0) {
          // For rotated layers, convert to local space first
          const { lx, ly } = worldToLocal(wx, wy, l);
          // Check if inside cropBounds in local space
          const cbLocalX = cb.x * Math.abs(l.scaleX);
          const cbLocalY = cb.y * Math.abs(l.scaleY);
          if (lx >= cbLocalX && lx <= cbLocalX + hw && ly >= cbLocalY && ly <= cbLocalY + hh) return l.id;
        } else {
          if (wx >= hx && wx <= hx + hw && wy >= hy && wy <= hy + hh) return l.id;
        }
        continue;
      }
      // Fallback to full layer bounds
      const lw = l.width * l.scaleX, lh = l.height * l.scaleY;
      if (l.rotation !== 0) {
        const { lx, ly } = worldToLocal(wx, wy, l);
        if (lx >= 0 && lx <= lw && ly >= 0 && ly <= lh) return l.id;
      } else {
        if (wx >= l.x && wx <= l.x + lw && wy >= l.y && wy <= l.y + lh) return l.id;
      }
    }
    return null;
  }, [worldToLocal]);

  const hitHandle = useCallback((wx: number, wy: number, l: Layer, zoom: number): number => {
    if (l.type === 'drawing') return -1;
    const hs = 18 / zoom;
    // Use cropBounds if available (for shapes, boolean, pasted selections)
    const cb = l.cropBounds;
    let hx: number, hy: number, hw: number, hh: number;
    if (cb) {
      hx = cb.x * Math.abs(l.scaleX);
      hy = cb.y * Math.abs(l.scaleY);
      hw = cb.w * Math.abs(l.scaleX);
      hh = cb.h * Math.abs(l.scaleY);
    } else {
      hx = 0; hy = 0;
      hw = l.width * Math.abs(l.scaleX);
      hh = l.height * Math.abs(l.scaleY);
    }
    const { lx, ly } = worldToLocal(wx, wy, l);
    const corners = [
      { x: hx, y: hy },           // top-left
      { x: hx + hw, y: hy },      // top-right
      { x: hx + hw, y: hy + hh }, // bottom-right
      { x: hx, y: hy + hh },      // bottom-left
    ];
    for (let i = 0; i < corners.length; i++) {
      if (Math.abs(lx - corners[i].x) < hs && Math.abs(ly - corners[i].y) < hs) return i;
    }
    return -1;
  }, [worldToLocal]);

  const boxIntersectsLayer = useCallback((bx1: number, by1: number, bx2: number, by2: number, layer: Layer): boolean => {
    if (!layer.visible || layer.locked) return false;
    const lx1 = layer.x, ly1 = layer.y;
    let lx2: number, ly2: number;
    if (layer.type === 'drawing' && layer.paintedBounds) {
      lx2 = layer.x + layer.paintedBounds.maxX; ly2 = layer.y + layer.paintedBounds.maxY;
    } else {
      lx2 = layer.x + layer.width * layer.scaleX; ly2 = layer.y + layer.height * layer.scaleY;
    }
    return !(bx1 > lx2 || bx2 < lx1 || by1 > ly2 || by2 < ly1);
  }, []);

  const clearLongPress = useCallback(() => {
    if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null; }
  }, []);

  // ---- RENDER LOOP ----
  useEffect(() => {
    let animId = 0;
    let lastTime = 0;
    const render = (time: number) => {
      const canvas = canvasRef.current;
      if (!canvas) { animId = requestAnimationFrame(render); return; }
      const ctx = canvas.getContext('2d');
      if (!ctx) { animId = requestAnimationFrame(render); return; }

      if (time - lastTime > 100) { antOffset.current = (antOffset.current + 1) % 20; lastTime = time; }

      const vp = viewportRef.current;
      const ls = layersRef.current;
      const selIds = selectedIdsRef.current;
      const selId = selectedRef.current;
      const borders = showBordersRef.current;

      ctx.fillStyle = '#151725';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      ctx.save();
      ctx.translate(vp.panX, vp.panY);
      ctx.scale(vp.zoom, vp.zoom);

      // Grid
      if (vp.zoom > 0.08) {
        const gridSize = vp.zoom > 0.4 ? 50 : 200;
        const startX = Math.floor((-vp.panX / vp.zoom) / gridSize) * gridSize;
        const startY = Math.floor((-vp.panY / vp.zoom) / gridSize) * gridSize;
        const endX = startX + (canvas.width / vp.zoom) + gridSize * 2;
        const endY = startY + (canvas.height / vp.zoom) + gridSize * 2;
        ctx.strokeStyle = 'rgba(255,255,255,0.025)';
        ctx.lineWidth = 1 / vp.zoom;
        ctx.beginPath();
        for (let x = startX; x <= endX; x += gridSize) { ctx.moveTo(x, startY); ctx.lineTo(x, endY); }
        for (let y = startY; y <= endY; y += gridSize) { ctx.moveTo(startX, y); ctx.lineTo(endX, y); }
        ctx.stroke();
      }

      // Origin
      ctx.strokeStyle = 'rgba(79,124,255,0.15)';
      ctx.lineWidth = 1 / vp.zoom;
      ctx.beginPath();
      ctx.moveTo(-30, 0); ctx.lineTo(30, 0);
      ctx.moveTo(0, -30); ctx.lineTo(0, 30);
      ctx.stroke();

      // Draw layers — saturation is now baked into filteredCanvas, no ctx.filter needed
      for (const layer of ls) {
        if (!layer.visible) continue;
        const source = layer.type === 'drawing' ? (layer.filteredCanvas || layer.drawingCanvas) : layer.filteredCanvas;
        if (!source) continue;
        ctx.save();
        ctx.globalAlpha = layer.opacity;
        if (layer.blendMode && layer.blendMode !== 'source-over') {
          ctx.globalCompositeOperation = layer.blendMode;
        }
        const cx = layer.x + (layer.width * layer.scaleX) / 2;
        const cy = layer.y + (layer.height * layer.scaleY) / 2;
        ctx.translate(cx, cy);
        ctx.rotate(layer.rotation);
        ctx.scale(layer.scaleX * (layer.flipH ? -1 : 1), layer.scaleY * (layer.flipV ? -1 : 1));
        ctx.translate(-layer.width / 2, -layer.height / 2);
        ctx.drawImage(source, 0, 0, layer.width, layer.height);
        ctx.restore();
      }

      // Selection rendering — hide borders while actively drawing (brush/eraser tool)
      const currentToolVal = toolRef.current;
      const hideBordersForDrawing = currentToolVal === 'brush' || currentToolVal === 'eraser';
      if (borders && !hideBordersForDrawing) {
        for (const layer of ls) {
          const isSelected = selIds.includes(layer.id) || layer.id === selId;
          if (!isSelected) continue;
          const isPrimary = layer.id === selId;

          if (layer.type === 'drawing') {
            // Only show drawing layer border when using Select tool
            if (currentToolVal !== 'select') continue;
            if (layer.paintedBounds) {
              const b = layer.paintedBounds;
              // Apply layer scale to painted bounds dimensions and positions
              const bw = (b.maxX - b.minX) * Math.abs(layer.scaleX);
              const bh = (b.maxY - b.minY) * Math.abs(layer.scaleY);
              // Apply rotation to drawing layer border
              const dCx = layer.x + (layer.width * layer.scaleX) / 2;
              const dCy = layer.y + (layer.height * layer.scaleY) / 2;
              ctx.save();
              ctx.translate(dCx, dCy);
              ctx.rotate(layer.rotation);
              ctx.translate(-dCx, -dCy);
              // Scale the position offset by layer scale
              const worldX = layer.x + b.minX * Math.abs(layer.scaleX);
              const worldY = layer.y + b.minY * Math.abs(layer.scaleY);
              if (layer.outlineCanvas && bw > 0 && bh > 0) {
                ctx.globalAlpha = isPrimary ? 0.85 : 0.5;
                ctx.imageSmoothingEnabled = false;
                ctx.drawImage(layer.outlineCanvas, worldX, worldY, bw, bh);
                ctx.globalAlpha = 1;
              }
              ctx.strokeStyle = isPrimary ? 'rgba(79, 124, 255, 0.5)' : 'rgba(79, 124, 255, 0.3)';
              ctx.lineWidth = 1.5 / vp.zoom;
              ctx.setLineDash([6 / vp.zoom, 4 / vp.zoom]);
              ctx.lineDashOffset = antOffset.current / vp.zoom;
              ctx.strokeRect(worldX, worldY, bw, bh);
              ctx.setLineDash([]); ctx.lineDashOffset = 0;
              ctx.restore();
            }
          } else {
            const cb = layer.cropBounds;
            let bx: number, by: number, bw: number, bh: number;
            if (cb) {
              bx = layer.x + cb.x * layer.scaleX; by = layer.y + cb.y * layer.scaleY;
              bw = cb.w * layer.scaleX; bh = cb.h * layer.scaleY;
            } else {
              bx = layer.x; by = layer.y;
              bw = layer.width * layer.scaleX; bh = layer.height * layer.scaleY;
            }
            const bcx = bx + bw / 2, bcy = by + bh / 2;
            ctx.save();
            ctx.translate(bcx, bcy);
            ctx.rotate(layer.rotation);
            ctx.strokeStyle = isPrimary ? '#4f7cff' : '#7c99ff';
            ctx.lineWidth = (isPrimary ? 2 : 1.5) / vp.zoom;
            ctx.setLineDash([6 / vp.zoom, 4 / vp.zoom]);
            ctx.lineDashOffset = antOffset.current / vp.zoom;
            ctx.strokeRect(-bw / 2, -bh / 2, bw, bh);
            ctx.setLineDash([]); ctx.lineDashOffset = 0;
            if (isPrimary) {
              const hSize = 10 / vp.zoom;
              const localHandles = [
                { x: -bw / 2, y: -bh / 2 }, { x: bw / 2, y: -bh / 2 },
                { x: bw / 2, y: bh / 2 }, { x: -bw / 2, y: bh / 2 },
              ];
              for (const hp of localHandles) {
                ctx.fillStyle = '#ffffff'; ctx.strokeStyle = '#4f7cff';
                ctx.lineWidth = 2 / vp.zoom;
                ctx.beginPath(); ctx.arc(hp.x, hp.y, hSize / 2, 0, Math.PI * 2);
                ctx.fill(); ctx.stroke();
              }
              // Rotation handle at top-right corner (offset diagonally)
              const rotHandleX = bw / 2 + 20 / vp.zoom;
              const rotHandleY = -bh / 2 - 20 / vp.zoom;
              const rotHandleR = 12 / vp.zoom;
              ctx.fillStyle = '#4f7cff';
              ctx.strokeStyle = '#ffffff';
              ctx.lineWidth = 2 / vp.zoom;
              ctx.beginPath();
              ctx.arc(rotHandleX, rotHandleY, rotHandleR, 0, Math.PI * 2);
              ctx.fill();
              ctx.stroke();
              // Draw rotation icon
              ctx.fillStyle = '#ffffff';
              ctx.font = `bold ${Math.round(14 / vp.zoom)}px Arial`;
              ctx.textAlign = 'center';
              ctx.textBaseline = 'middle';
              ctx.fillText('↻', rotHandleX, rotHandleY);
            }
            ctx.restore();
          }
        }
      }

      // Selection overlay (rect/lasso)
      const sel = selectionRef.current;
      if (sel) {
        const layer = ls.find(l => l.id === sel.layerId);
        if (layer) {
          ctx.save();
          const lCx = layer.x + (layer.width * layer.scaleX) / 2;
          const lCy = layer.y + (layer.height * layer.scaleY) / 2;
          ctx.translate(lCx, lCy);
          ctx.rotate(layer.rotation);
          // Apply flip for correct selection rendering
          ctx.scale(layer.scaleX * (layer.flipH ? -1 : 1), layer.scaleY * (layer.flipV ? -1 : 1));
          ctx.translate(-layer.width / 2, -layer.height / 2);

          if (sel.type === 'rect' && sel.rect) {
            const r = sel.rect;
            ctx.fillStyle = 'rgba(79, 124, 255, 0.15)';
            ctx.fillRect(r.x, r.y, r.w, r.h);
            ctx.strokeStyle = 'rgba(79, 124, 255, 0.8)';
            ctx.lineWidth = 2 / (vp.zoom * layer.scaleX);
            ctx.setLineDash([6 / (vp.zoom * layer.scaleX), 4 / (vp.zoom * layer.scaleX)]);
            ctx.lineDashOffset = antOffset.current / (vp.zoom * layer.scaleX);
            ctx.strokeRect(r.x, r.y, r.w, r.h);
            ctx.setLineDash([]); ctx.lineDashOffset = 0;
          } else if (sel.type === 'lasso' && sel.path && sel.path.length > 2) {
            ctx.beginPath();
            ctx.moveTo(sel.path[0][0], sel.path[0][1]);
            for (let i = 1; i < sel.path.length; i++) ctx.lineTo(sel.path[i][0], sel.path[i][1]);
            ctx.closePath();
            ctx.fillStyle = 'rgba(79, 124, 255, 0.15)';
            ctx.fill();
            ctx.strokeStyle = 'rgba(79, 124, 255, 0.8)';
            ctx.lineWidth = 2 / (vp.zoom * layer.scaleX);
            ctx.setLineDash([6 / (vp.zoom * layer.scaleX), 4 / (vp.zoom * layer.scaleX)]);
            ctx.lineDashOffset = antOffset.current / (vp.zoom * layer.scaleX);
            ctx.stroke();
            ctx.setLineDash([]); ctx.lineDashOffset = 0;
          } else if (sel.type === 'wand' && sel.mask && sel.maskW && sel.maskH) {
            // Render wand selection mask as overlay
            const mw = sel.maskW, mh = sel.maskH;
            const maskData = sel.mask;
            ctx.fillStyle = 'rgba(79, 124, 255, 0.2)';
            // Draw in blocks for performance
            const blockSz = Math.max(1, Math.floor(Math.min(mw, mh) / 200));
            for (let my = 0; my < mh; my += blockSz) {
              for (let mx = 0; mx < mw; mx += blockSz) {
                if (maskData[my * mw + mx]) {
                  ctx.fillRect(mx, my, blockSz, blockSz);
                }
              }
            }
          }
          ctx.restore();
        }
      }

      // Active rect/lasso selection being drawn
      const dd = drag.current;
      if (dd.mode === 'rectSelect') {
        const layer = ls.find(l => l.id === dd.selLayerId);
        if (layer) {
          ctx.save();
          const lCx = layer.x + (layer.width * layer.scaleX) / 2;
          const lCy = layer.y + (layer.height * layer.scaleY) / 2;
          ctx.translate(lCx, lCy);
          ctx.rotate(layer.rotation);
          // Apply flip for correct selection rendering
          ctx.scale(layer.scaleX * (layer.flipH ? -1 : 1), layer.scaleY * (layer.flipV ? -1 : 1));
          ctx.translate(-layer.width / 2, -layer.height / 2);
          const rx = Math.min(dd.selStartLocalX, dd.selEndLocalX);
          const ry = Math.min(dd.selStartLocalY, dd.selEndLocalY);
          const rw = Math.abs(dd.selEndLocalX - dd.selStartLocalX);
          const rh = Math.abs(dd.selEndLocalY - dd.selStartLocalY);
          ctx.fillStyle = 'rgba(79, 124, 255, 0.15)';
          ctx.fillRect(rx, ry, rw, rh);
          ctx.strokeStyle = 'rgba(79, 124, 255, 0.8)';
          ctx.lineWidth = 2 / (vp.zoom * layer.scaleX);
          ctx.setLineDash([6 / (vp.zoom * layer.scaleX), 4 / (vp.zoom * layer.scaleX)]);
          ctx.lineDashOffset = antOffset.current / (vp.zoom * layer.scaleX);
          ctx.strokeRect(rx, ry, rw, rh);
          ctx.setLineDash([]); ctx.lineDashOffset = 0;
          ctx.restore();
        }
      } else if (dd.mode === 'lassoSelect' && dd.lassoPath.length > 1) {
        const layer = ls.find(l => l.id === dd.selLayerId);
        if (layer) {
          ctx.save();
          const lCx = layer.x + (layer.width * layer.scaleX) / 2;
          const lCy = layer.y + (layer.height * layer.scaleY) / 2;
          ctx.translate(lCx, lCy);
          ctx.rotate(layer.rotation);
          // Apply flip for correct selection rendering
          ctx.scale(layer.scaleX * (layer.flipH ? -1 : 1), layer.scaleY * (layer.flipV ? -1 : 1));
          ctx.translate(-layer.width / 2, -layer.height / 2);
          ctx.beginPath();
          ctx.moveTo(dd.lassoPath[0][0], dd.lassoPath[0][1]);
          for (let i = 1; i < dd.lassoPath.length; i++) ctx.lineTo(dd.lassoPath[i][0], dd.lassoPath[i][1]);
          ctx.closePath();
          ctx.fillStyle = 'rgba(79, 124, 255, 0.15)';
          ctx.fill();
          ctx.strokeStyle = 'rgba(79, 124, 255, 0.8)';
          ctx.lineWidth = 2 / (vp.zoom * layer.scaleX);
          ctx.stroke();
          ctx.restore();
        }
      }

      // Box selection rectangle
      if (dd.mode === 'boxSelect') {
        const bx = Math.min(dd.boxStartWX, dd.boxEndWX);
        const by = Math.min(dd.boxStartWY, dd.boxEndWY);
        const bw = Math.abs(dd.boxEndWX - dd.boxStartWX);
        const bh = Math.abs(dd.boxEndWY - dd.boxStartWY);
        if (bw > 0 && bh > 0) {
          ctx.fillStyle = 'rgba(79, 124, 255, 0.08)';
          ctx.fillRect(bx, by, bw, bh);
          ctx.strokeStyle = 'rgba(79, 124, 255, 0.6)';
          ctx.lineWidth = 1.5 / vp.zoom;
          ctx.setLineDash([8 / vp.zoom, 4 / vp.zoom]);
          ctx.lineDashOffset = antOffset.current / vp.zoom;
          ctx.strokeRect(bx, by, bw, bh);
          ctx.setLineDash([]); ctx.lineDashOffset = 0;
        }
      }

      // Pen tool path preview — render in world space (already inside world transform)
      const penPts = penPointsRef.current;
      if (penPts && penPts.length > 0) {
        ctx.strokeStyle = '#4f7cff';
        ctx.lineWidth = 2 / vp.zoom;
        ctx.setLineDash([6 / vp.zoom, 4 / vp.zoom]);
        ctx.beginPath();
        ctx.moveTo(penPts[0][0], penPts[0][1]);
        for (let i = 1; i < penPts.length; i++) ctx.lineTo(penPts[i][0], penPts[i][1]);
        ctx.stroke();
        ctx.setLineDash([]);
        // Draw points with zoom-aware size
        const ptRadius = 6 / vp.zoom;
        for (let pi2 = 0; pi2 < penPts.length; pi2++) {
          const isBeingDragged = drag.current.mode === 'penDrag' && drag.current.penDragIdx === pi2;
          ctx.fillStyle = isBeingDragged ? '#ff6b6b' : '#ffffff';
          ctx.strokeStyle = '#4f7cff';
          ctx.lineWidth = 2 / vp.zoom;
          ctx.beginPath(); ctx.arc(penPts[pi2][0], penPts[pi2][1], ptRadius, 0, Math.PI * 2);
          ctx.fill(); ctx.stroke();
        }
      }

      ctx.restore();
      animId = requestAnimationFrame(render);
    };
    animId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(animId);
  }, []);

  // Resize observer
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect;
      const dpr = window.devicePixelRatio || 1;
      setCanvasSize({ w: Math.floor(width * dpr), h: Math.floor(height * dpr) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Wheel zoom
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const sx = (e.clientX - rect.left) * dpr;
      const sy = (e.clientY - rect.top) * dpr;
      const vp = viewportRef.current;
      const factor = e.deltaY > 0 ? 0.92 : 1.08;
      const newZoom = Math.max(0.02, Math.min(30, vp.zoom * factor));
      const wb = screenToWorld(sx, sy, vp);
      onViewportChange({ zoom: newZoom, panX: sx - wb.x * newZoom, panY: sy - wb.y * newZoom });
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, [onViewportChange, screenToWorld]);

  const getCanvasPos = useCallback((clientX: number, clientY: number) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    return { x: (clientX - rect.left) * dpr, y: (clientY - rect.top) * dpr };
  }, []);

  const getTouchDist = (t1: React.Touch, t2: React.Touch) => {
    const dx = t1.clientX - t2.clientX, dy = t1.clientY - t2.clientY;
    return Math.sqrt(dx * dx + dy * dy);
  };
  const getTouchCenter = (t1: React.Touch, t2: React.Touch) =>
    getCanvasPos((t1.clientX + t2.clientX) / 2, (t1.clientY + t2.clientY) / 2);

  // ---- POINTER DOWN ----
  const handlePointerDown = useCallback((sx: number, sy: number) => {
    const vp = viewportRef.current;
    const world = screenToWorld(sx, sy, vp);
    const d = drag.current;
    d.active = true; d.startSX = sx; d.startSY = sy; d.hasMoved = false; d.tappedLayerId = '';
    const currentTool = toolRef.current;

    if (currentTool === 'pan') {
      d.mode = 'pan'; d.startPanX = vp.panX; d.startPanY = vp.panY; return;
    }

    // Selection tools: rectSelect, lassoSelect
    if (currentTool === 'rectSelect' || currentTool === 'lassoSelect') {
      const hitId = hitTest(world.x, world.y, layersRef.current);
      // Use hit layer, or fall back to currently selected layer (allows starting from background)
      const targetId = hitId || selectedRef.current;
      const layer = targetId ? layersRef.current.find(l => l.id === targetId) : null;
      if (layer && layer.type !== 'drawing' && !layer.locked) {
        if (hitId) onLayerSelect(hitId);
        onSelectionChangeRef.current?.(null); // clear previous selection
        const { px, py } = worldToLayerPixel(world.x, world.y, layer);
        d.selLayerId = layer.id;
        d.selStartLocalX = px; d.selStartLocalY = py;
        d.selEndLocalX = px; d.selEndLocalY = py;
        if (currentTool === 'rectSelect') {
          d.mode = 'rectSelect';
        } else {
          d.mode = 'lassoSelect';
          d.lassoPath = [[px, py]];
        }
        return;
      }
      // No layer at all — pan
      d.mode = 'pan'; d.startPanX = vp.panX; d.startPanY = vp.panY;
      return;
    }

    if (currentTool === 'select') {
      const selLayer = layersRef.current.find(l => l.id === selectedRef.current);
      if (selLayer && showBordersRef.current && selLayer.type !== 'drawing') {
        // Use cropBounds if available for proper handle positioning
        const cb = selLayer.cropBounds;
        let bx: number, by: number, bw: number, bh: number;
        if (cb) {
          bx = selLayer.x + cb.x * selLayer.scaleX;
          by = selLayer.y + cb.y * selLayer.scaleY;
          bw = cb.w * selLayer.scaleX;
          bh = cb.h * selLayer.scaleY;
        } else {
          bx = selLayer.x; by = selLayer.y;
          bw = selLayer.width * selLayer.scaleX;
          bh = selLayer.height * selLayer.scaleY;
        }
        const layerCx = bx + bw / 2, layerCy = by + bh / 2;
        // Rotation handle is at top-right corner + offset
        const rotOffsetX = bw / 2 + 20 / vp.zoom;
        const rotOffsetY = -bh / 2 - 20 / vp.zoom;
        // Rotate offset by layer rotation to get world position
        const cos = Math.cos(selLayer.rotation), sin = Math.sin(selLayer.rotation);
        const rotHandleWX = layerCx + rotOffsetX * cos - rotOffsetY * sin;
        const rotHandleWY = layerCy + rotOffsetX * sin + rotOffsetY * cos;
        const rotDist = Math.sqrt((world.x - rotHandleWX) ** 2 + (world.y - rotHandleWY) ** 2);
        if (rotDist < 20 / vp.zoom) {
          d.mode = 'none'; d.rotateDrag = true;
          d.rotateStartAngle = Math.atan2(world.y - layerCy, world.x - layerCx);
          d.rotateLayerStartRot = selLayer.rotation;
          // Save initial rotations for multi-select
          multiStartPositions.current.clear();
          for (const lid of selectedIdsRef.current) {
            const la = layersRef.current.find(ll => ll.id === lid);
            if (la) multiStartPositions.current.set(lid, { x: la.x, y: la.y, rotation: la.rotation, scaleX: la.scaleX, scaleY: la.scaleY } as any);
          }
          return;
        }
        // Check resize corner handles
        const corner = hitHandle(world.x, world.y, selLayer, vp.zoom);
        if (corner >= 0) {
          d.mode = 'resize'; d.resizeCorner = corner;
          d.startLayerX = selLayer.x; d.startLayerY = selLayer.y;
          d.startLayerSX = selLayer.scaleX; d.startLayerSY = selLayer.scaleY;
          return;
        }
      }
      const hitId = hitTest(world.x, world.y, layersRef.current);
      if (hitId) {
        d.tappedLayerId = hitId;
        const isInMultiSelect = selectedIdsRef.current.includes(hitId);
        const isSameAsCurrent = hitId === selectedRef.current;
        if (isInMultiSelect) {
          d.isRetap = true; d.mode = 'move';
          const l = layersRef.current.find(la => la.id === hitId)!;
          d.startLayerX = l.x; d.startLayerY = l.y;
          multiStartPositions.current.clear();
          for (const lid of selectedIdsRef.current) {
            const la = layersRef.current.find(ll => ll.id === lid);
            if (la) multiStartPositions.current.set(lid, { x: la.x, y: la.y, rotation: la.rotation, scaleX: la.scaleX, scaleY: la.scaleY } as any);
          }
        } else if (isSameAsCurrent) {
          onLayerSelect(hitId); d.isRetap = true; d.mode = 'move';
          const l = layersRef.current.find(la => la.id === hitId)!;
          d.startLayerX = l.x; d.startLayerY = l.y;
          multiStartPositions.current.clear();
          multiStartPositions.current.set(hitId, { x: l.x, y: l.y, rotation: l.rotation, scaleX: l.scaleX, scaleY: l.scaleY } as any);
        } else {
          d.isRetap = false; onLayerSelect(hitId); d.mode = 'move';
          const l = layersRef.current.find(la => la.id === hitId)!;
          d.startLayerX = l.x; d.startLayerY = l.y;
          multiStartPositions.current.clear();
          multiStartPositions.current.set(hitId, { x: l.x, y: l.y, rotation: l.rotation, scaleX: l.scaleX, scaleY: l.scaleY } as any);
        }
      } else {
        d.mode = 'longPressWait';
        d.startPanX = vp.panX; d.startPanY = vp.panY;
        d.boxStartWX = world.x; d.boxStartWY = world.y;
        d.boxEndWX = world.x; d.boxEndWY = world.y;
        clearLongPress();
        longPressTimer.current = setTimeout(() => {
          longPressTimer.current = null;
          const dd2 = drag.current;
          if (dd2.mode === 'longPressWait' && !dd2.hasMoved) dd2.mode = 'boxSelect';
        }, 400);
      }
    } else if (currentTool === 'pen') {
      // Pen tool: long-press to create point, or drag existing point
      const pts = penPointsRef.current || [];
      const hitRadius = 12 / vp.zoom; // zoom-aware hit detection
      // Check if touching an existing point
      let hitPtIdx = -1;
      for (let i = 0; i < pts.length; i++) {
        const dx2 = world.x - pts[i][0], dy2 = world.y - pts[i][1];
        if (Math.sqrt(dx2 * dx2 + dy2 * dy2) < hitRadius) { hitPtIdx = i; break; }
      }
      if (hitPtIdx >= 0) {
        // Drag existing point
        d.mode = 'penDrag'; d.penDragIdx = hitPtIdx;
      } else {
        // Long-press to add new point
        d.mode = 'penLongPress';
        d.penLongPressWX = world.x; d.penLongPressWY = world.y;
        clearLongPress();
        longPressTimer.current = setTimeout(() => {
          longPressTimer.current = null;
          const dd2 = drag.current;
          if (dd2.mode === 'penLongPress') {
            // Add new point and switch to drag mode
            onPenPointAddRef.current?.([dd2.penLongPressWX, dd2.penLongPressWY]);
            dd2.mode = 'penDrag';
            dd2.penDragIdx = (penPointsRef.current?.length || 1) - 1;
          }
        }, 300);
      }
      return;
    } else if (currentTool === 'magicWand') {
      const hitId = hitTest(world.x, world.y, layersRef.current);
      if (hitId) {
        const layer = layersRef.current.find(l => l.id === hitId);
        if (layer && layer.type !== 'drawing' && !layer.locked) {
          onLayerSelect(hitId);
          onMagicWandRef.current?.(hitId, world.x, world.y);
        }
      }
      d.mode = 'none'; d.active = false; return;
    } else if (currentTool === 'brush' || currentTool === 'eraser') {
      const layer = layersRef.current.find(l => l.id === selectedRef.current && l.type === 'drawing');
      if (layer?.drawingCanvas) {
        d.drawLayerId = layer.id;
        onBeforeStrokeRef.current?.(layer.id);
        d.mode = 'draw';
        const dctx = layer.drawingCanvas.getContext('2d')!;
        const lx = world.x - layer.x, ly = world.y - layer.y;
        dctx.save();
        if (currentTool === 'eraser') dctx.globalCompositeOperation = 'destination-out';
        else { dctx.globalCompositeOperation = 'source-over'; dctx.strokeStyle = brushRef.current.color; }
        dctx.globalAlpha = brushRef.current.opacity;
        dctx.lineWidth = brushRef.current.size;
        dctx.lineCap = 'round'; dctx.lineJoin = 'round';
        dctx.beginPath(); dctx.moveTo(lx, ly); dctx.lineTo(lx + 0.1, ly + 0.1); dctx.stroke();
      } else {
        d.mode = 'pan'; d.startPanX = vp.panX; d.startPanY = vp.panY;
      }
    }
  }, [screenToWorld, hitTest, hitHandle, onLayerSelect, clearLongPress, worldToLayerPixel]);

  // ---- POINTER MOVE ----
  const handlePointerMove = useCallback((sx: number, sy: number) => {
    const d = drag.current;
    if (!d.active && !d.rotateDrag) return;
    const vp = viewportRef.current;
    const dx = sx - d.startSX, dy = sy - d.startSY;
    const moveDist = Math.sqrt(dx * dx + dy * dy);
    if (!d.hasMoved && moveDist > 8) d.hasMoved = true;

    // Handle rotation drag — supports multi-select
    if (d.rotateDrag) {
      const world = screenToWorld(sx, sy, vp);
      const selLayer = layersRef.current.find(l => l.id === selectedRef.current);
      if (selLayer) {
        // Use cropBounds for center calculation if available
        const cb = selLayer.cropBounds;
        let layerCx: number, layerCy: number;
        if (cb) {
          const bx = selLayer.x + cb.x * selLayer.scaleX;
          const by = selLayer.y + cb.y * selLayer.scaleY;
          const bw = cb.w * selLayer.scaleX;
          const bh = cb.h * selLayer.scaleY;
          layerCx = bx + bw / 2;
          layerCy = by + bh / 2;
        } else {
          const lw = selLayer.width * selLayer.scaleX, lh = selLayer.height * selLayer.scaleY;
          layerCx = selLayer.x + lw / 2;
          layerCy = selLayer.y + lh / 2;
        }
        const currentAngle = Math.atan2(world.y - layerCy, world.x - layerCx);
        const deltaAngle = currentAngle - d.rotateStartAngle;
        const newRotation = d.rotateLayerStartRot + deltaAngle;
        // Apply rotation to primary layer
        onLayerUpdate(selLayer.id, { rotation: newRotation });
        // If multi-selected, apply same delta to all selected layers
        const selIds = selectedIdsRef.current;
        if (selIds.length > 1) {
          for (const lid of selIds) {
            if (lid !== selLayer.id) {
              const startPos = multiStartPositions.current.get(lid);
              if (startPos && 'rotation' in (startPos as any)) {
                onLayerUpdate(lid, { rotation: (startPos as any).rotation + deltaAngle });
              }
            }
          }
        }
      }
      return;
    }

    if (d.mode === 'penLongPress') {
      if (d.hasMoved) {
        clearLongPress();
        d.mode = 'pan'; d.startPanX = vp.panX; d.startPanY = vp.panY;
        d.startSX = sx; d.startSY = sy;
      } else {
        const world = screenToWorld(sx, sy, vp);
        d.penLongPressWX = world.x; d.penLongPressWY = world.y;
      }
      return;
    }
    if (d.mode === 'penDrag') {
      const world = screenToWorld(sx, sy, vp);
      const pts = penPointsRef.current;
      if (pts && d.penDragIdx >= 0 && d.penDragIdx < pts.length) {
        pts[d.penDragIdx] = [world.x, world.y];
      }
      return;
    }
    if (d.mode === 'longPressWait') {
      if (d.hasMoved) {
        clearLongPress(); d.mode = 'pan';
        d.startPanX = vp.panX; d.startPanY = vp.panY;
        d.startSX = sx; d.startSY = sy;
      }
      return;
    }
    if (d.mode === 'boxSelect') {
      const world = screenToWorld(sx, sy, vp);
      d.boxEndWX = world.x; d.boxEndWY = world.y; return;
    }
    if (d.mode === 'rectSelect') {
      const world = screenToWorld(sx, sy, vp);
      const layer = layersRef.current.find(l => l.id === d.selLayerId);
      if (layer) {
        const { px, py } = worldToLayerPixel(world.x, world.y, layer);
        // No clamping — allow selection to extend beyond image bounds
        d.selEndLocalX = px;
        d.selEndLocalY = py;
      }
      return;
    }
    if (d.mode === 'lassoSelect') {
      const world = screenToWorld(sx, sy, vp);
      const layer = layersRef.current.find(l => l.id === d.selLayerId);
      if (layer) {
        const { px, py } = worldToLayerPixel(world.x, world.y, layer);
        // No clamping — allow lasso to extend beyond image bounds
        const last = d.lassoPath[d.lassoPath.length - 1];
        const dist = Math.sqrt((px - last[0]) ** 2 + (py - last[1]) ** 2);
        if (dist > 2) d.lassoPath.push([px, py]);
      }
      return;
    }
    if (d.mode === 'pan') {
      onViewportChange({ ...vp, panX: d.startPanX + dx, panY: d.startPanY + dy });
    } else if (d.mode === 'move') {
      const wdx = dx / vp.zoom, wdy = dy / vp.zoom;
      for (const [lid, pos] of multiStartPositions.current) {
        const layer = layersRef.current.find(l => l.id === lid);
        // For scaled layers, adjust movement by scale factor so it follows touch accurately
        if (layer && (Math.abs(layer.scaleX) !== 1 || Math.abs(layer.scaleY) !== 1)) {
          const adjustedDx = wdx;
          const adjustedDy = wdy;
          onLayerUpdate(lid, { x: pos.x + adjustedDx, y: pos.y + adjustedDy });
        } else {
          onLayerUpdate(lid, { x: pos.x + wdx, y: pos.y + wdy });
        }
      }
    } else if (d.mode === 'resize' && selectedRef.current) {
      const layer = layersRef.current.find(l => l.id === selectedRef.current);
      if (!layer) return;
      const wdx = dx / vp.zoom, wdy = dy / vp.zoom;
      const corner = d.resizeCorner;
      // Use cropBounds width/height for resize calculation if available
      const cb = layer.cropBounds;
      const refW = cb ? cb.w : layer.width;
      const refH = cb ? cb.h : layer.height;
      let nsx = d.startLayerSX, nsy = d.startLayerSY;
      let nx = d.startLayerX, ny = d.startLayerY;
      if (corner === 2) { nsx = Math.max(0.02, d.startLayerSX + wdx / refW); nsy = Math.max(0.02, d.startLayerSY + wdy / refH); }
      else if (corner === 0) { nsx = Math.max(0.02, d.startLayerSX - wdx / refW); nsy = Math.max(0.02, d.startLayerSY - wdy / refH); nx = d.startLayerX + wdx; ny = d.startLayerY + wdy; }
      else if (corner === 1) { nsx = Math.max(0.02, d.startLayerSX + wdx / refW); nsy = Math.max(0.02, d.startLayerSY - wdy / refH); ny = d.startLayerY + wdy; }
      else if (corner === 3) { nsx = Math.max(0.02, d.startLayerSX - wdx / refW); nsy = Math.max(0.02, d.startLayerSY + wdy / refH); nx = d.startLayerX + wdx; }
      onLayerUpdate(selectedRef.current, { scaleX: nsx, scaleY: nsy, x: nx, y: ny });
    } else if (d.mode === 'draw') {
      const layer = layersRef.current.find(l => l.id === selectedRef.current && l.type === 'drawing');
      if (layer?.drawingCanvas) {
        const world = screenToWorld(sx, sy, vp);
        const lx = world.x - layer.x, ly = world.y - layer.y;
        const dctx = layer.drawingCanvas.getContext('2d')!;
        dctx.lineTo(lx, ly); dctx.stroke(); dctx.beginPath(); dctx.moveTo(lx, ly);
      }
    }
  }, [onViewportChange, onLayerUpdate, screenToWorld, clearLongPress, worldToLayerPixel]);

  // ---- POINTER UP ----
  const handlePointerUp = useCallback(() => {
    const d = drag.current;
    clearLongPress();

    // End rotation drag
    if (d.rotateDrag) {
      d.rotateDrag = false;
      return;
    }

    if (d.mode === 'boxSelect') {
      const bx1 = Math.min(d.boxStartWX, d.boxEndWX), by1 = Math.min(d.boxStartWY, d.boxEndWY);
      const bx2 = Math.max(d.boxStartWX, d.boxEndWX), by2 = Math.max(d.boxStartWY, d.boxEndWY);
      if ((bx2 - bx1) > 5 && (by2 - by1) > 5) {
        const intersecting = layersRef.current.filter(l => boxIntersectsLayer(bx1, by1, bx2, by2, l)).map(l => l.id);
        onBoxSelectRef.current(intersecting);
      }
    } else if (d.mode === 'rectSelect') {
      // Finalize rect selection
      const rx = Math.min(d.selStartLocalX, d.selEndLocalX);
      const ry = Math.min(d.selStartLocalY, d.selEndLocalY);
      const rw = Math.abs(d.selEndLocalX - d.selStartLocalX);
      const rh = Math.abs(d.selEndLocalY - d.selStartLocalY);
      if (rw > 2 && rh > 2) {
        onSelectionChangeRef.current?.({
          layerId: d.selLayerId, type: 'rect',
          rect: { x: Math.round(rx), y: Math.round(ry), w: Math.round(rw), h: Math.round(rh) },
        });
      }
    } else if (d.mode === 'lassoSelect') {
      if (d.lassoPath.length > 3) {
        onSelectionChangeRef.current?.({
          layerId: d.selLayerId, type: 'lasso',
          path: [...d.lassoPath],
        });
      }
    } else if (d.mode === 'longPressWait' && !d.hasMoved) {
      onBackgroundTapRef.current();
    } else if (d.mode === 'move' && !d.hasMoved && d.tappedLayerId) {
      if (d.isRetap) onLayerRetapRef.current();
    } else if (d.mode === 'draw') {
      const layer = layersRef.current.find(l => l.id === selectedRef.current && l.type === 'drawing');
      if (layer?.drawingCanvas) layer.drawingCanvas.getContext('2d')!.restore();
      if (d.drawLayerId) { onAfterStrokeRef.current?.(d.drawLayerId); d.drawLayerId = ''; }
    }

    if (d.mode === 'penLongPress') {
      clearLongPress();
      // Short tap on pen — add point immediately
      onPenPointAddRef.current?.([d.penLongPressWX, d.penLongPressWY]);
    }

    d.active = false; d.mode = 'none'; d.tappedLayerId = ''; d.lassoPath = []; d.penDragIdx = -1;
  }, [clearLongPress, boxIntersectsLayer]);

  // ========== MOUSE EVENTS ==========
  const onMouseDown = (e: React.MouseEvent) => {
    if (e.button === 1) {
      const pos = getCanvasPos(e.clientX, e.clientY);
      const d = drag.current;
      d.active = true; d.mode = 'pan'; d.startSX = pos.x; d.startSY = pos.y;
      d.startPanX = viewportRef.current.panX; d.startPanY = viewportRef.current.panY;
      d.hasMoved = false; d.tappedLayerId = ''; return;
    }
    const pos = getCanvasPos(e.clientX, e.clientY);
    handlePointerDown(pos.x, pos.y);
  };
  const onMouseMove = (e: React.MouseEvent) => { const pos = getCanvasPos(e.clientX, e.clientY); handlePointerMove(pos.x, pos.y); };
  const onMouseUp = () => handlePointerUp();

  // ========== TOUCH EVENTS ==========
  const onTouchStart = (e: React.TouchEvent) => {
    e.preventDefault();
    const touches = e.touches;
    if (touches.length === 2) {
      handlePointerUp(); clearLongPress();
      const d = drag.current;
      d.active = true; d.hasMoved = false; d.tappedLayerId = '';
      d.pinchStartDist = getTouchDist(touches[0], touches[1]);
      const currentTool = toolRef.current;
      const selId = selectedRef.current;
      const selLayer = selId ? layersRef.current.find(l => l.id === selId) : null;

      // Allow pinch scale for all layer types including drawing
      if (currentTool === 'select' && selLayer && !selLayer.locked && selLayer.visible) {
        const center = getTouchCenter(touches[0], touches[1]);
        const vp = viewportRef.current;
        const worldCenter = screenToWorld(center.x, center.y, vp);
        const fracX = (worldCenter.x - selLayer.x) / (selLayer.width * selLayer.scaleX);
        const fracY = (worldCenter.y - selLayer.y) / (selLayer.height * selLayer.scaleY);
        if (fracX >= 0 && fracX <= 1 && fracY >= 0 && fracY <= 1) {
          d.mode = 'pinchScale'; d.pinchScaleLayerId = selLayer.id;
          d.pinchScaleStartScale = (selLayer.scaleX + selLayer.scaleY) / 2;
          d.startLayerSX = selLayer.scaleX; d.startLayerSY = selLayer.scaleY;
          d.pinchAnchorFracX = fracX; d.pinchAnchorFracY = fracY;
          d.pinchScaleLayerCX = worldCenter.x; d.pinchScaleLayerCY = worldCenter.y;
          // Save initial scales for multi-select
          multiStartPositions.current.clear();
          for (const lid of selectedIdsRef.current) {
            const la = layersRef.current.find(ll => ll.id === lid);
            if (la) multiStartPositions.current.set(lid, { x: la.x, y: la.y, rotation: la.rotation, scaleX: la.scaleX, scaleY: la.scaleY } as any);
          }
        } else {
          d.mode = 'pinch'; d.pinchStartZoom = vp.zoom;
          const ct = getTouchCenter(touches[0], touches[1]);
          d.pinchCenterX = ct.x; d.pinchCenterY = ct.y;
          d.startPanX = vp.panX; d.startPanY = vp.panY;
        }
      } else {
        d.mode = 'pinch'; d.pinchStartZoom = viewportRef.current.zoom;
        const center = getTouchCenter(touches[0], touches[1]);
        d.pinchCenterX = center.x; d.pinchCenterY = center.y;
        d.startPanX = viewportRef.current.panX; d.startPanY = viewportRef.current.panY;
      }
      return;
    }
    if (touches.length === 1) {
      const pos = getCanvasPos(touches[0].clientX, touches[0].clientY);
      handlePointerDown(pos.x, pos.y);
    }
  };

  const onTouchMove = (e: React.TouchEvent) => {
    e.preventDefault();
    const touches = e.touches;
    if (touches.length === 2) {
      const d = drag.current;
      if (d.mode === 'pinchScale') {
        const newDist = getTouchDist(touches[0], touches[1]);
        const ratio = newDist / d.pinchStartDist;
        const newScale = Math.max(0.02, d.pinchScaleStartScale * ratio);
        const scaleRatio = newScale / d.pinchScaleStartScale;
        const nsx = d.startLayerSX * scaleRatio, nsy = d.startLayerSY * scaleRatio;
        const layer = layersRef.current.find(l => l.id === d.pinchScaleLayerId);
        if (layer) {
          const newX = d.pinchScaleLayerCX - d.pinchAnchorFracX * layer.width * nsx;
          const newY = d.pinchScaleLayerCY - d.pinchAnchorFracY * layer.height * nsy;
          onLayerUpdate(d.pinchScaleLayerId, { scaleX: nsx, scaleY: nsy, x: newX, y: newY });
          // Multi-select: apply same scale ratio to all selected layers
          const selIds = selectedIdsRef.current;
          if (selIds.length > 1) {
            for (const lid of selIds) {
              if (lid !== d.pinchScaleLayerId) {
                const startPos = multiStartPositions.current.get(lid);
                if (startPos && 'scaleX' in (startPos as any)) {
                  const sp = startPos as any;
                  onLayerUpdate(lid, { 
                    scaleX: sp.scaleX * scaleRatio, 
                    scaleY: sp.scaleY * scaleRatio 
                  });
                }
              }
            }
          }
        }
        return;
      }
      if (d.mode === 'pinch') {
        const newDist = getTouchDist(touches[0], touches[1]);
        const scale = newDist / d.pinchStartDist;
        const newZoom = Math.max(0.02, Math.min(30, d.pinchStartZoom * scale));
        const newCenter = getTouchCenter(touches[0], touches[1]);
        const panDx = newCenter.x - d.pinchCenterX, panDy = newCenter.y - d.pinchCenterY;
        const wb = screenToWorld(d.pinchCenterX, d.pinchCenterY, { panX: d.startPanX, panY: d.startPanY, zoom: d.pinchStartZoom });
        onViewportChange({ zoom: newZoom, panX: d.pinchCenterX - wb.x * newZoom + panDx, panY: d.pinchCenterY - wb.y * newZoom + panDy });
        return;
      }
    }
    if (touches.length === 1 && drag.current.mode !== 'pinch' && drag.current.mode !== 'pinchScale') {
      const pos = getCanvasPos(touches[0].clientX, touches[0].clientY);
      handlePointerMove(pos.x, pos.y);
    }
  };

  const onTouchEnd = (e: React.TouchEvent) => {
    e.preventDefault();
    if (e.touches.length === 0) handlePointerUp();
    else if (e.touches.length === 1 && (drag.current.mode === 'pinch' || drag.current.mode === 'pinchScale')) {
      handlePointerUp();
      const pos = getCanvasPos(e.touches[0].clientX, e.touches[0].clientY);
      const d = drag.current;
      d.active = true; d.mode = 'pan'; d.hasMoved = false; d.tappedLayerId = '';
      d.startSX = pos.x; d.startSY = pos.y;
      d.startPanX = viewportRef.current.panX; d.startPanY = viewportRef.current.panY;
    }
  };

  // ========== DRAG AND DROP ==========
  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; };
  const handleDropFiles = (e: React.DragEvent) => {
    e.preventDefault();
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      const pos = getCanvasPos(e.clientX, e.clientY);
      const vp = viewportRef.current;
      const world = screenToWorld(pos.x, pos.y, vp);
      onDrop(files, world.x, world.y);
    }
  };

  const dpr = typeof window !== 'undefined' ? (window.devicePixelRatio || 1) : 1;

  return (
    <div ref={containerRef} className="flex-1 relative overflow-hidden" style={{ touchAction: 'none' }}
      onDragOver={handleDragOver} onDrop={handleDropFiles}>
      <canvas ref={canvasRef} width={canvasSize.w} height={canvasSize.h}
        style={{ width: canvasSize.w / dpr, height: canvasSize.h / dpr, touchAction: 'none' }}
        className="absolute inset-0"
        onMouseDown={onMouseDown} onMouseMove={onMouseMove} onMouseUp={onMouseUp} onMouseLeave={onMouseUp}
        onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd} onTouchCancel={onTouchEnd}
        onContextMenu={e => e.preventDefault()} />
      {layers.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="text-center space-y-3 opacity-40 px-6">
            <div className="text-5xl">🎨</div>
            <p className="text-sm text-gray-400">Drop images here or tap Import</p>
            <p className="text-xs text-gray-500">Long-press background to box-select · Tap 🖌 to draw</p>
          </div>
        </div>
      )}
    </div>
  );
};
