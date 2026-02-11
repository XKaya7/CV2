import { useState, useCallback, useRef, useEffect } from 'react';
import { Layer, Tool, BrushSettings, Viewport, LayerFilters, defaultFilters, SelectionData } from './types';
import { processLayerFilters, processFiltersFromCanvas } from './filters';
import { CanvasView } from './components/CanvasView';
import { RightPanel } from './components/RightPanel';
import PerspectiveTool from './perspective/PerspectiveTool';

let layerCounter = 0;

// ========== SESSION PERSISTENCE REMOVED FOR STABILITY ==========
// localStorage session save/load has been removed to prevent black screen issues
// and multi-tab conflicts. Users should export their work to save it.

function cloneCanvas(c: HTMLCanvasElement): HTMLCanvasElement {
  const copy = document.createElement('canvas');
  copy.width = c.width;
  copy.height = c.height;
  const srcCtx = c.getContext('2d')!;
  const dstCtx = copy.getContext('2d')!;
  const imgData = srcCtx.getImageData(0, 0, c.width, c.height);
  dstCtx.putImageData(imgData, 0, 0);
  return copy;
}

function computeDrawingOutline(drawingCanvas: HTMLCanvasElement): {
  paintedBounds?: { minX: number; minY: number; maxX: number; maxY: number };
  outlineCanvas?: HTMLCanvasElement;
} {
  const ctx = drawingCanvas.getContext('2d')!;
  const w = drawingCanvas.width;
  const h = drawingCanvas.height;
  const imgData = ctx.getImageData(0, 0, w, h);
  const data = imgData.data;
  let minX = w, minY = h, maxX = 0, maxY = 0;
  let hasPaint = false;
  for (let y = 0; y < h; y++) {
    const rowOffset = y * w;
    for (let x = 0; x < w; x++) {
      if (data[(rowOffset + x) * 4 + 3] > 0) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        hasPaint = true;
      }
    }
  }
  if (!hasPaint) return { paintedBounds: undefined, outlineCanvas: undefined };
  maxX++; maxY++;
  const bounds = { minX, minY, maxX, maxY };
  const bw = maxX - minX;
  const bh = maxY - minY;
  const maxDim = 300;
  const scale = Math.min(1, maxDim / Math.max(bw, bh));
  const sw = Math.max(1, Math.ceil(bw * scale));
  const sh = Math.max(1, Math.ceil(bh * scale));
  const temp = document.createElement('canvas');
  temp.width = sw; temp.height = sh;
  const tctx = temp.getContext('2d')!;
  tctx.drawImage(drawingCanvas, minX, minY, bw, bh, 0, 0, sw, sh);
  const sData = tctx.getImageData(0, 0, sw, sh);
  const outline = document.createElement('canvas');
  outline.width = sw; outline.height = sh;
  const octx = outline.getContext('2d')!;
  const oData = octx.createImageData(sw, sh);
  const neighbors = [[-1, 0], [1, 0], [0, -1], [0, 1]];
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      const alpha = sData.data[(y * sw + x) * 4 + 3];
      if (alpha > 10) {
        let isEdge = false;
        for (let n = 0; n < 4; n++) {
          const nx = x + neighbors[n][0];
          const ny = y + neighbors[n][1];
          if (nx < 0 || nx >= sw || ny < 0 || ny >= sh) { isEdge = true; break; }
          if (sData.data[(ny * sw + nx) * 4 + 3] <= 10) { isEdge = true; break; }
        }
        if (isEdge) {
          const i = (y * sw + x) * 4;
          oData.data[i] = 79; oData.data[i + 1] = 124;
          oData.data[i + 2] = 255; oData.data[i + 3] = 200;
        }
      }
    }
  }
  octx.putImageData(oData, 0, 0);
  return { paintedBounds: bounds, outlineCanvas: outline };
}

function computeCropBounds(canvas: HTMLCanvasElement): { x: number; y: number; w: number; h: number } | undefined {
  const ctx = canvas.getContext('2d')!;
  const w = canvas.width, h = canvas.height;
  const data = ctx.getImageData(0, 0, w, h).data;
  let minX = w, minY = h, maxX = 0, maxY = 0;
  let found = false;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] > 10) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        found = true;
      }
    }
  }
  if (!found) return undefined;
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

// ========== TEXT/SHAPE RENDERING TO CANVAS ==========
function renderTextToCanvas(text: string, fontSize: number, fontFamily: string, color: string): HTMLCanvasElement {
  const measure = document.createElement('canvas');
  const mctx = measure.getContext('2d')!;
  mctx.font = `bold ${fontSize}px ${fontFamily}`;
  const lines = text.split('\n');
  let maxW = 0;
  for (const line of lines) {
    const m = mctx.measureText(line);
    if (m.width > maxW) maxW = m.width;
  }
  const lineHeight = fontSize * 1.3;
  const padding = Math.max(10, fontSize * 0.3);
  const w = Math.ceil(maxW) + padding * 2;
  const h = Math.ceil(lineHeight * lines.length) + padding * 2;
  const c = document.createElement('canvas');
  c.width = Math.max(1, w);
  c.height = Math.max(1, h);
  const ctx = c.getContext('2d')!;
  ctx.font = `bold ${fontSize}px ${fontFamily}`;
  ctx.fillStyle = color;
  ctx.textBaseline = 'top';
  for (let i = 0; i < lines.length; i++) {
    ctx.fillText(lines[i], padding, padding + i * lineHeight);
  }
  return c;
}

function renderShapeToCanvas(shapeType: string, size: number, color: string, fill: boolean, strokeW: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = size; c.height = size;
  const ctx = c.getContext('2d')!;
  const cx = size / 2, cy = size / 2, r = size * 0.42;
  ctx.lineWidth = strokeW;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;

  const drawPath = (points: [number, number][]) => {
    ctx.beginPath();
    ctx.moveTo(points[0][0], points[0][1]);
    for (let i = 1; i < points.length; i++) ctx.lineTo(points[i][0], points[i][1]);
    ctx.closePath();
    if (fill) ctx.fill(); else ctx.stroke();
  };

  switch (shapeType) {
    case 'circle':
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      if (fill) ctx.fill(); else ctx.stroke();
      break;
    case 'square':
      if (fill) ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
      else ctx.strokeRect(cx - r, cy - r, r * 2, r * 2);
      break;
    case 'triangle':
      drawPath([
        [cx, cy - r],
        [cx + r * Math.cos(Math.PI / 6), cy + r * Math.sin(Math.PI / 6)],
        [cx - r * Math.cos(Math.PI / 6), cy + r * Math.sin(Math.PI / 6)],
      ]);
      break;
    case 'star': {
      const pts: [number, number][] = [];
      for (let i = 0; i < 10; i++) {
        const a = (Math.PI / 2) * -1 + (i * Math.PI) / 5;
        const rad = i % 2 === 0 ? r : r * 0.45;
        pts.push([cx + Math.cos(a) * rad, cy + Math.sin(a) * rad]);
      }
      drawPath(pts);
      break;
    }
    case 'heart': {
      ctx.beginPath();
      const s = r * 0.9;
      ctx.moveTo(cx, cy + s * 0.7);
      ctx.bezierCurveTo(cx - s * 1.5, cy - s * 0.3, cx - s * 0.5, cy - s * 1.2, cx, cy - s * 0.5);
      ctx.bezierCurveTo(cx + s * 0.5, cy - s * 1.2, cx + s * 1.5, cy - s * 0.3, cx, cy + s * 0.7);
      ctx.closePath();
      if (fill) ctx.fill(); else ctx.stroke();
      break;
    }
    case 'diamond':
      drawPath([[cx, cy - r], [cx + r * 0.65, cy], [cx, cy + r], [cx - r * 0.65, cy]]);
      break;
    case 'arrow': {
      const aw = r * 0.35;
      drawPath([
        [cx, cy - r],
        [cx + r * 0.7, cy],
        [cx + aw, cy],
        [cx + aw, cy + r],
        [cx - aw, cy + r],
        [cx - aw, cy],
        [cx - r * 0.7, cy],
      ]);
      break;
    }
    case 'hexagon': {
      const pts: [number, number][] = [];
      for (let i = 0; i < 6; i++) {
        const a = (Math.PI / 3) * i - Math.PI / 2;
        pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
      }
      drawPath(pts);
      break;
    }
    case 'arch':
      ctx.beginPath();
      ctx.arc(cx, cy + r * 0.2, r * 0.85, Math.PI, 0);
      ctx.lineTo(cx + r * 0.85, cy + r);
      ctx.lineTo(cx - r * 0.85, cy + r);
      ctx.closePath();
      if (fill) ctx.fill(); else ctx.stroke();
      break;
    case 'curve':
      ctx.beginPath();
      ctx.moveTo(cx - r, cy);
      ctx.quadraticCurveTo(cx - r * 0.3, cy - r * 0.8, cx, cy);
      ctx.quadraticCurveTo(cx + r * 0.3, cy + r * 0.8, cx + r, cy);
      if (fill) {
        ctx.lineTo(cx + r, cy + r * 0.2);
        ctx.quadraticCurveTo(cx + r * 0.3, cy + r, cx, cy + r * 0.2);
        ctx.quadraticCurveTo(cx - r * 0.3, cy - r * 0.6, cx - r, cy + r * 0.2);
        ctx.closePath();
        ctx.fill();
      }
      ctx.stroke();
      break;
  }
  return c;
}

// Helper to create thumbnail
function createThumb(source: HTMLCanvasElement): string {
  const tc = document.createElement('canvas');
  tc.width = 48; tc.height = 48;
  const tctx = tc.getContext('2d')!;
  const aspect = source.width / source.height;
  let tw = 48, th = 48;
  if (aspect > 1) th = 48 / aspect; else tw = 48 * aspect;
  tctx.drawImage(source, (48 - tw) / 2, (48 - th) / 2, tw, th);
  return tc.toDataURL();
}

export function App() {
  const [layers, setLayers] = useState<Layer[]>([]);
  const [selectedLayerId, setSelectedLayerId] = useState<string | null>(null);
  const [selectedLayerIds, setSelectedLayerIds] = useState<string[]>([]);
  const [showBorders, setShowBorders] = useState(true);
  const [tool, setTool] = useState<Tool>('select');
  const [brushSettings, setBrushSettings] = useState<BrushSettings>({ size: 8, color: '#ffffff', opacity: 1 });
  const [viewport, setViewport] = useState<Viewport>({ panX: 0, panY: 0, zoom: 1 });
  const [panelCollapsed, setPanelCollapsed] = useState(false);
  const [panelWidth, setPanelWidth] = useState(280);
  const [showBrushPanel, setShowBrushPanel] = useState(false);
  const [undoCount, setUndoCount] = useState(0);
  const [redoCount, setRedoCount] = useState(0);
  const [copiedLayers, setCopiedLayers] = useState<Layer[]>([]);
  const [magicWandThreshold, setMagicWandThreshold] = useState(30);
  const [showMagicWandPanel, setShowMagicWandPanel] = useState(false);
  // Text tool state
  const [showTextPanel, setShowTextPanel] = useState(false);
  const [textInput, setTextInput] = useState('Hello');
  const [textFontSize, setTextFontSize] = useState(64);
  const [textFontFamily, setTextFontFamily] = useState('Arial');
  const [textColor, setTextColor] = useState('#ffffff');
  // Shape tool state
  const [showShapePanel, setShowShapePanel] = useState(false);
  const [shapeType, setShapeType] = useState('circle');
  const [shapeColor, setShapeColor] = useState('#4f7cff');
  const [shapeFill, setShapeFill] = useState(true);
  const [shapeSize, setShapeSize] = useState(200);
  const [shapeStrokeW, setShapeStrokeW] = useState(4);
  // Pen tool state
  const [showPenPanel, setShowPenPanel] = useState(false);
  const [penPoints, setPenPoints] = useState<[number, number][]>([]);
  const [penColor, setPenColor] = useState('#ffffff');
  const [penWidth, setPenWidth] = useState(3);
  const [penFill, setPenFill] = useState(false);
  // Pen undo/redo
  const [penHistory, setPenHistory] = useState<[number, number][][]>([]);
  const [penFuture, setPenFuture] = useState<[number, number][][]>([]);
  // Selection state
  const [selection, setSelection] = useState<SelectionData | null>(null);
  // Clipboard for pasted selection
  const [clipboardCanvas, setClipboardCanvas] = useState<HTMLCanvasElement | null>(null);
  const [clipboardMeta, setClipboardMeta] = useState<{
    clipX: number; clipY: number; clipW: number; clipH: number;
    sourceX: number; sourceY: number;
    sourceScaleX: number; sourceScaleY: number;
    sourceRotation?: number;
  } | null>(null);
  // Grid perspective tool state
  const [showPerspective, setShowPerspective] = useState(false);
  
  // Archive feature removed for stability

  const fileInputRef = useRef<HTMLInputElement>(null);
  const layersRef = useRef(layers);
  layersRef.current = layers;
  const selectedLayerIdRef = useRef(selectedLayerId);
  selectedLayerIdRef.current = selectedLayerId;
  const selectedLayerIdsRef = useRef(selectedLayerIds);
  selectedLayerIdsRef.current = selectedLayerIds;

  const undoStacks = useRef(new Map<string, HTMLCanvasElement[]>());
  const redoStacks = useRef(new Map<string, HTMLCanvasElement[]>());
  const MAX_UNDO = 15;

  const layerHistory = useRef<{ past: Layer[][]; future: Layer[][] }>({ past: [], future: [] });
  const MAX_LAYER_HISTORY = 15;

  const saveLayerSnapshot = useCallback(() => {
    const snapshot = layersRef.current.map(l => {
      const copy = { ...l };
      if (l.filteredCanvas) copy.filteredCanvas = cloneCanvas(l.filteredCanvas);
      if (l.drawingCanvas) copy.drawingCanvas = cloneCanvas(l.drawingCanvas);
      return copy;
    });
    layerHistory.current.past.push(snapshot);
    if (layerHistory.current.past.length > MAX_LAYER_HISTORY) layerHistory.current.past.shift();
    layerHistory.current.future = [];
  }, []);

  const undoLayerAction = useCallback(() => {
    const h = layerHistory.current;
    if (h.past.length === 0) return;
    const currentSnapshot = layersRef.current.map(l => {
      const copy = { ...l };
      if (l.filteredCanvas) copy.filteredCanvas = cloneCanvas(l.filteredCanvas);
      if (l.drawingCanvas) copy.drawingCanvas = cloneCanvas(l.drawingCanvas);
      return copy;
    });
    h.future.push(currentSnapshot);
    const prev = h.past.pop()!;
    setLayers(prev);
    if (prev.length > 0) setSelectedLayerId(prev[prev.length - 1].id);
  }, []);

  const redoLayerAction = useCallback(() => {
    const h = layerHistory.current;
    if (h.future.length === 0) return;
    const currentSnapshot = layersRef.current.map(l => {
      const copy = { ...l };
      if (l.filteredCanvas) copy.filteredCanvas = cloneCanvas(l.filteredCanvas);
      if (l.drawingCanvas) copy.drawingCanvas = cloneCanvas(l.drawingCanvas);
      return copy;
    });
    h.past.push(currentSnapshot);
    const next = h.future.pop()!;
    setLayers(next);
  }, []);

  const panelDrag = useRef({ active: false, startX: 0, startWidth: 0 });

  // Set initial viewport on mount (session persistence removed for stability)
  useEffect(() => {
    setViewport({ panX: window.innerWidth / 2, panY: window.innerHeight / 2, zoom: 1 });
  }, []);

  const updateUndoRedoCounts = useCallback((layerId: string | null) => {
    if (!layerId) { setUndoCount(0); setRedoCount(0); return; }
    setUndoCount(undoStacks.current.get(layerId)?.length || 0);
    setRedoCount(redoStacks.current.get(layerId)?.length || 0);
  }, []);

  useEffect(() => { updateUndoRedoCounts(selectedLayerId); }, [selectedLayerId, updateUndoRedoCounts]);

  const handleLayerSelect = useCallback((id: string | null) => {
    setSelectedLayerId(id);
    setSelectedLayerIds(id ? [id] : []);
    setShowBorders(true);
    if (id) setPanelCollapsed(false);
  }, []);

  const handleBoxSelect = useCallback((ids: string[]) => {
    setSelectedLayerIds(ids);
    setShowBorders(true);
    if (ids.length > 0) {
      setSelectedLayerId(ids[ids.length - 1]);
      setPanelCollapsed(false);
    }
  }, []);

  const handleBackgroundTap = useCallback(() => {
    setShowBorders(false);
    setSelectedLayerIds([]);
  }, []);

  const handleLayerRetap = useCallback(() => {
    setShowBorders(true);
  }, []);

  const importImageFile = useCallback((file: File, worldX?: number, worldY?: number) => {
    if (!file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const id = `layer-${++layerCounter}`;
        const maxDim = 600;
        const scale = Math.min(maxDim / img.naturalWidth, maxDim / img.naturalHeight, 1);
        const displayW = img.naturalWidth * scale;
        const displayH = img.naturalHeight * scale;
        const fc = document.createElement('canvas');
        fc.width = img.naturalWidth; fc.height = img.naturalHeight;
        fc.getContext('2d')!.drawImage(img, 0, 0);
        const tc = document.createElement('canvas');
        tc.width = 48; tc.height = 48;
        const tctx = tc.getContext('2d')!;
        const aspect = img.naturalWidth / img.naturalHeight;
        let tw = 48, th = 48;
        if (aspect > 1) th = 48 / aspect; else tw = 48 * aspect;
        tctx.drawImage(img, (48 - tw) / 2, (48 - th) / 2, tw, th);
        const cx = worldX ?? 0;
        const cy = worldY ?? 0;
        const newLayer: Layer = {
          id, name: file.name.replace(/\.[^.]+$/, '').substring(0, 20),
          type: 'image', visible: true, locked: false, opacity: 1, blendMode: 'source-over',
          x: cx - displayW / 2, y: cy - displayH / 2,
          width: img.naturalWidth, height: img.naturalHeight,
          scaleX: scale, scaleY: scale, rotation: 0, flipH: false, flipV: false,
          image: img, thumbUrl: tc.toDataURL(), filteredCanvas: fc,
          filters: { ...defaultFilters }, layerSaturation: 100, globalHueRotate: 0,
        };
        setLayers(prev => [...prev, newLayer]);
        handleLayerSelect(id);
        setTool('select');
      };
      img.src = e.target?.result as string;
    };
    reader.readAsDataURL(file);
  }, [handleLayerSelect]);

  const importMultipleWithLayout = useCallback((files: File[], centerX = 0, centerY = 0) => {
    const imageFiles = files.filter(f => f.type.startsWith('image/'));
    if (imageFiles.length === 0) return;
    if (imageFiles.length === 1) { importImageFile(imageFiles[0], centerX, centerY); return; }
    const promises = imageFiles.map(file =>
      new Promise<{ file: File; img: HTMLImageElement }>((resolve) => {
        const reader = new FileReader();
        reader.onload = (ev) => {
          const img = new Image();
          img.onload = () => resolve({ file, img });
          img.src = ev.target?.result as string;
        };
        reader.readAsDataURL(file);
      })
    );
    Promise.all(promises).then(results => {
      const newLayers: Layer[] = [];
      const count = results.length;
      const cols = Math.ceil(Math.sqrt(count));
      const rows = Math.ceil(count / cols);
      const cellSize = 400; const gap = 30;
      const totalW = cols * (cellSize + gap) - gap;
      const totalH = rows * (cellSize + gap) - gap;
      results.forEach(({ file, img }, i) => {
        const row = Math.floor(i / cols);
        const col = i % cols;
        const id = `layer-${++layerCounter}`;
        const scale = Math.min(cellSize / img.naturalWidth, cellSize / img.naturalHeight, 1);
        const displayW = img.naturalWidth * scale;
        const displayH = img.naturalHeight * scale;
        const cellX = centerX - totalW / 2 + col * (cellSize + gap);
        const cellY = centerY - totalH / 2 + row * (cellSize + gap);
        const imgX = cellX + (cellSize - displayW) / 2;
        const imgY = cellY + (cellSize - displayH) / 2;
        const fc = document.createElement('canvas');
        fc.width = img.naturalWidth; fc.height = img.naturalHeight;
        fc.getContext('2d')!.drawImage(img, 0, 0);
        const tc = document.createElement('canvas');
        tc.width = 48; tc.height = 48;
        const tctx = tc.getContext('2d')!;
        const aspect = img.naturalWidth / img.naturalHeight;
        let tw = 48, th = 48;
        if (aspect > 1) th = 48 / aspect; else tw = 48 * aspect;
        tctx.drawImage(img, (48 - tw) / 2, (48 - th) / 2, tw, th);
        newLayers.push({
          id, name: file.name.replace(/\.[^.]+$/, '').substring(0, 20),
          type: 'image', visible: true, locked: false, opacity: 1, blendMode: 'source-over',
          x: imgX, y: imgY, width: img.naturalWidth, height: img.naturalHeight,
          scaleX: scale, scaleY: scale, rotation: 0, flipH: false, flipV: false,
          image: img, thumbUrl: tc.toDataURL(), filteredCanvas: fc,
          filters: { ...defaultFilters }, layerSaturation: 100, globalHueRotate: 0,
        });
      });
      setLayers(prev => [...prev, ...newLayers]);
      if (newLayers.length > 0) {
        const allIds = newLayers.map(l => l.id);
        setSelectedLayerId(allIds[allIds.length - 1]);
        setSelectedLayerIds(allIds);
        setShowBorders(true);
        setTool('select');
        setPanelCollapsed(false);
      }
    });
  }, [importImageFile]);

  const handleImportClick = () => fileInputRef.current?.click();

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) importMultipleWithLayout(Array.from(files));
    e.target.value = '';
  };

  const handleDrop = useCallback((files: FileList, worldX: number, worldY: number) => {
    importMultipleWithLayout(Array.from(files), worldX, worldY);
  }, [importMultipleWithLayout]);

  const addDrawingLayer = useCallback(() => {
    const id = `layer-${++layerCounter}`;
    const dc = document.createElement('canvas');
    dc.width = 4000; dc.height = 4000;
    const newLayer: Layer = {
      id, name: `Drawing ${layerCounter}`, type: 'drawing',
      visible: true, locked: false, opacity: 1, blendMode: 'source-over',
      x: -2000, y: -2000, width: 4000, height: 4000,
      scaleX: 1, scaleY: 1, rotation: 0, flipH: false, flipV: false,
      drawingCanvas: dc, filters: { ...defaultFilters },
      layerSaturation: 100, globalHueRotate: 0,
    };
    setLayers(prev => [...prev, newLayer]);
    handleLayerSelect(id);
    return id;
  }, [handleLayerSelect]);

  // ========== ADD TEXT LAYER ==========
  const addTextLayer = useCallback(() => {
    const id = `layer-${++layerCounter}`;
    const rendered = renderTextToCanvas(textInput, textFontSize, textFontFamily, textColor);
    const fc = cloneCanvas(rendered);
    const thumb = createThumb(rendered);
    const vp = viewport;
    const worldCX = (window.innerWidth / 2 - vp.panX) / vp.zoom;
    const worldCY = (window.innerHeight / 2 - vp.panY) / vp.zoom;
    const newLayer: Layer = {
      id, name: `Text: ${textInput.substring(0, 12)}`, type: 'text',
      visible: true, locked: false, opacity: 1, blendMode: 'source-over',
      x: worldCX - rendered.width / 2, y: worldCY - rendered.height / 2,
      width: rendered.width, height: rendered.height,
      scaleX: 1, scaleY: 1, rotation: 0, flipH: false, flipV: false,
      filteredCanvas: fc, thumbUrl: thumb,
      filters: { ...defaultFilters }, layerSaturation: 100, globalHueRotate: 0,
      text: textInput, fontSize: textFontSize, fontFamily: textFontFamily, textColor: textColor,
    };
    setLayers(prev => [...prev, newLayer]);
    handleLayerSelect(id);
    setTool('select');
  }, [textInput, textFontSize, textFontFamily, textColor, viewport, handleLayerSelect]);

  // ========== ADD SHAPE LAYER ==========
  const addShapeLayer = useCallback(() => {
    const id = `layer-${++layerCounter}`;
    const rendered = renderShapeToCanvas(shapeType, shapeSize, shapeColor, shapeFill, shapeStrokeW);
    const fc = cloneCanvas(rendered);
    const thumb = createThumb(rendered);
    const vp = viewport;
    const worldCX = (window.innerWidth / 2 - vp.panX) / vp.zoom;
    const worldCY = (window.innerHeight / 2 - vp.panY) / vp.zoom;
    // Compute cropBounds for tight blue border around actual shape opacity
    const shapeCropBounds = computeCropBounds(rendered);
    const newLayer: Layer = {
      id, name: `Shape: ${shapeType}`, type: 'shape',
      visible: true, locked: false, opacity: 1, blendMode: 'source-over',
      x: worldCX - rendered.width / 2, y: worldCY - rendered.height / 2,
      width: rendered.width, height: rendered.height,
      scaleX: 1, scaleY: 1, rotation: 0, flipH: false, flipV: false,
      filteredCanvas: fc, thumbUrl: thumb,
      filters: { ...defaultFilters }, layerSaturation: 100, globalHueRotate: 0,
      shapeType, shapeColor, shapeFill, shapeStrokeWidth: shapeStrokeW,
      cropBounds: shapeCropBounds,
    };
    setLayers(prev => [...prev, newLayer]);
    handleLayerSelect(id);
    setTool('select');
  }, [shapeType, shapeSize, shapeColor, shapeFill, shapeStrokeW, viewport, handleLayerSelect]);

  // ========== RE-RENDER TEXT/SHAPE (when editing properties) ==========
  const reRenderTextLayer = useCallback((id: string, updates: Partial<Layer>) => {
    setLayers(prev => prev.map(l => {
      if (l.id !== id || l.type !== 'text') return l;
      const merged = { ...l, ...updates };
      const t = merged.text || 'Text';
      const fs = merged.fontSize || 64;
      const ff = merged.fontFamily || 'Arial';
      const tc = merged.textColor || '#ffffff';
      const rendered = renderTextToCanvas(t, fs, ff, tc);
      const fc = processLayerFilters(
        null as unknown as HTMLImageElement, merged.filters, undefined, merged.globalHueRotate,
        rendered
      );
      return {
        ...merged,
        width: rendered.width, height: rendered.height,
        filteredCanvas: fc, thumbUrl: createThumb(rendered),
        name: `Text: ${t.substring(0, 12)}`,
      };
    }));
  }, []);

  const reRenderShapeLayer = useCallback((id: string, updates: Partial<Layer>) => {
    setLayers(prev => prev.map(l => {
      if (l.id !== id || l.type !== 'shape') return l;
      const merged = { ...l, ...updates };
      const st = merged.shapeType || 'circle';
      const sc = merged.shapeColor || '#4f7cff';
      const sf = merged.shapeFill !== undefined ? merged.shapeFill : true;
      const sw = merged.shapeStrokeWidth || 4;
      const size = Math.max(merged.width, merged.height);
      const rendered = renderShapeToCanvas(st, size, sc, sf, sw);
      const fc = processLayerFilters(
        null as unknown as HTMLImageElement, merged.filters, undefined, merged.globalHueRotate,
        rendered
      );
      // Recompute cropBounds for updated shape
      const newCropBounds = computeCropBounds(rendered);
      return {
        ...merged,
        filteredCanvas: fc, thumbUrl: createThumb(rendered),
        name: `Shape: ${st}`,
        cropBounds: newCropBounds,
      };
    }));
  }, []);

  const updateLayer = useCallback((id: string, updates: Partial<Layer>) => {
    setLayers(prev => prev.map(l => {
      if (l.id !== id) return l;
      const updated = { ...l, ...updates };
      // Reprocess filters when saturation or globalHueRotate changes
      const needsReprocess = 'globalHueRotate' in updates || 'layerSaturation' in updates;
      if (needsReprocess && (updated.type === 'image' || updated.type === 'text' || updated.type === 'shape')) {
        const sat = updated.layerSaturation;
        if (updated.sourceCanvas) {
          updated.filteredCanvas = processFiltersFromCanvas(updated.sourceCanvas, updated.filters, undefined, updated.globalHueRotate, sat);
        } else if (updated.type === 'text') {
          const rendered = renderTextToCanvas(updated.text || 'Text', updated.fontSize || 64, updated.fontFamily || 'Arial', updated.textColor || '#ffffff');
          updated.filteredCanvas = processLayerFilters(null as unknown as HTMLImageElement, updated.filters, undefined, updated.globalHueRotate, rendered, sat);
        } else if (updated.type === 'shape') {
          const rendered = renderShapeToCanvas(updated.shapeType || 'circle', Math.max(updated.width, updated.height), updated.shapeColor || '#4f7cff', updated.shapeFill !== false, updated.shapeStrokeWidth || 4);
          updated.filteredCanvas = processLayerFilters(null as unknown as HTMLImageElement, updated.filters, undefined, updated.globalHueRotate, rendered, sat);
        } else if (updated.image) {
          updated.filteredCanvas = processLayerFilters(updated.image, updated.filters, undefined, updated.globalHueRotate, undefined, sat);
        }
      }
      return updated;
    }));
  }, []);

  const handleDelete = useCallback(() => {
    if (selection) {
      handleDeleteSelection();
      return;
    }
    saveLayerSnapshot();
    const idsToDelete = selectedLayerIdsRef.current;
    if (idsToDelete.length === 0 && selectedLayerIdRef.current) {
      const id = selectedLayerIdRef.current;
      setLayers(prev => prev.filter(l => l.id !== id));
      setSelectedLayerId(null); setSelectedLayerIds([]); setShowBorders(false);
      undoStacks.current.delete(id); redoStacks.current.delete(id);
    } else if (idsToDelete.length > 0) {
      const idSet = new Set(idsToDelete);
      setLayers(prev => prev.filter(l => !idSet.has(l.id)));
      setSelectedLayerId(null); setSelectedLayerIds([]); setShowBorders(false);
      for (const id of idsToDelete) { undoStacks.current.delete(id); redoStacks.current.delete(id); }
    }
  }, [saveLayerSnapshot]);

  const duplicateLayer = useCallback((id: string) => {
    setLayers(prev => {
      const layer = prev.find(l => l.id === id);
      if (!layer) return prev;
      const newId = `layer-${++layerCounter}`;
      const copy: Layer = { ...layer, id: newId, name: `${layer.name} copy`, x: layer.x + 30, y: layer.y + 30 };
      if (layer.filteredCanvas) copy.filteredCanvas = cloneCanvas(layer.filteredCanvas);
      if (layer.drawingCanvas) copy.drawingCanvas = cloneCanvas(layer.drawingCanvas);
      handleLayerSelect(newId);
      return [...prev, copy];
    });
  }, [handleLayerSelect]);

  const moveLayerOrder = useCallback((id: string, dir: 'up' | 'down' | 'top' | 'bottom') => {
    setLayers(prev => {
      const idx = prev.findIndex(l => l.id === id);
      if (idx === -1) return prev;
      const arr = [...prev];
      if (dir === 'top') {
        // Move to end (top of render order)
        const [layer] = arr.splice(idx, 1);
        arr.push(layer);
      } else if (dir === 'bottom') {
        // Move to beginning (bottom of render order)
        const [layer] = arr.splice(idx, 1);
        arr.unshift(layer);
      } else {
        const newIdx = dir === 'up' ? idx + 1 : idx - 1;
        if (newIdx < 0 || newIdx >= prev.length) return prev;
        [arr[idx], arr[newIdx]] = [arr[newIdx], arr[idx]];
      }
      return arr;
    });
  }, []);

  // Multi-select filter application
  const updateMultiLayerFilters = useCallback((filterUpdates: Partial<LayerFilters>, preview = false) => {
    const ids = selectedLayerIdsRef.current;
    if (ids.length < 2) return;
    setLayers(prev => prev.map(l => {
      if (!ids.includes(l.id)) return l;
      const newFilters = { ...l.filters, ...filterUpdates };
      const updated = { ...l, filters: newFilters };
      const sat = l.layerSaturation;
      if (l.type === 'image') {
        if (l.sourceCanvas) {
          updated.filteredCanvas = processFiltersFromCanvas(l.sourceCanvas, newFilters, preview ? 400 : undefined, l.globalHueRotate, sat);
        } else if (l.image) {
          updated.filteredCanvas = processLayerFilters(l.image, newFilters, preview ? 400 : undefined, l.globalHueRotate, undefined, sat);
        }
      } else if (l.type === 'text') {
        const rendered = renderTextToCanvas(l.text || 'Text', l.fontSize || 64, l.fontFamily || 'Arial', l.textColor || '#ffffff');
        updated.filteredCanvas = processLayerFilters(null as unknown as HTMLImageElement, newFilters, preview ? 400 : undefined, l.globalHueRotate, rendered, sat);
      } else if (l.type === 'shape') {
        const rendered = renderShapeToCanvas(l.shapeType || 'circle', Math.max(l.width, l.height), l.shapeColor || '#4f7cff', l.shapeFill !== false, l.shapeStrokeWidth || 4);
        updated.filteredCanvas = processLayerFilters(null as unknown as HTMLImageElement, newFilters, preview ? 400 : undefined, l.globalHueRotate, rendered, sat);
      } else if (l.type === 'drawing' && l.drawingCanvas) {
        updated.filteredCanvas = processFiltersFromCanvas(l.drawingCanvas, newFilters, preview ? 400 : undefined, l.globalHueRotate, sat);
      }
      return updated;
    }));
  }, []);

  const updateLayerFilters = useCallback((id: string, filterUpdates: Partial<LayerFilters>, preview = false) => {
    setLayers(prev => prev.map(l => {
      if (l.id !== id) return l;
      const newFilters = { ...l.filters, ...filterUpdates };
      const updated = { ...l, filters: newFilters };
      const sat = l.layerSaturation;
      if (l.type === 'image') {
        if (l.sourceCanvas) {
          updated.filteredCanvas = processFiltersFromCanvas(l.sourceCanvas, newFilters, preview ? 400 : undefined, l.globalHueRotate, sat);
        } else if (l.image) {
          updated.filteredCanvas = processLayerFilters(l.image, newFilters, preview ? 400 : undefined, l.globalHueRotate, undefined, sat);
        }
      } else if (l.type === 'text') {
        const rendered = renderTextToCanvas(l.text || 'Text', l.fontSize || 64, l.fontFamily || 'Arial', l.textColor || '#ffffff');
        updated.filteredCanvas = processLayerFilters(null as unknown as HTMLImageElement, newFilters, preview ? 400 : undefined, l.globalHueRotate, rendered, sat);
      } else if (l.type === 'shape') {
        const rendered = renderShapeToCanvas(l.shapeType || 'circle', Math.max(l.width, l.height), l.shapeColor || '#4f7cff', l.shapeFill !== false, l.shapeStrokeWidth || 4);
        updated.filteredCanvas = processLayerFilters(null as unknown as HTMLImageElement, newFilters, preview ? 400 : undefined, l.globalHueRotate, rendered, sat);
      } else if (l.type === 'drawing' && l.drawingCanvas) {
        // Filters for drawing layers — process from drawing canvas
        updated.filteredCanvas = processFiltersFromCanvas(l.drawingCanvas, newFilters, preview ? 400 : undefined, l.globalHueRotate, sat);
      }
      return updated;
    }));
  }, []);

  const flipLayer = useCallback((id: string, axis: 'h' | 'v') => {
    setLayers(prev => prev.map(l => {
      if (l.id !== id) return l;
      return axis === 'h' ? { ...l, flipH: !l.flipH } : { ...l, flipV: !l.flipV };
    }));
  }, []);

  const resetView = useCallback(() => {
    setViewport({ panX: window.innerWidth / 2, panY: window.innerHeight / 2, zoom: 1 });
  }, []);

  // ========== COPY / PASTE ==========
  const handleCopyLayers = useCallback(() => {
    const ids = selectedLayerIdsRef.current;
    const currentLayers = layersRef.current;
    if (ids.length > 0) setCopiedLayers(currentLayers.filter(l => ids.includes(l.id)));
    else if (selectedLayerIdRef.current) {
      const l = currentLayers.find(la => la.id === selectedLayerIdRef.current);
      if (l) setCopiedLayers([l]);
    }
  }, []);

  const handlePasteLayers = useCallback(() => {
    if (copiedLayers.length === 0) return;
    saveLayerSnapshot();
    const newLayers: Layer[] = copiedLayers.map(l => {
      const newId = `layer-${++layerCounter}`;
      const copy: Layer = { ...l, id: newId, name: `${l.name} (Copy)`, x: l.x + 30, y: l.y + 30 };
      if (l.filteredCanvas) copy.filteredCanvas = cloneCanvas(l.filteredCanvas);
      if (l.drawingCanvas) copy.drawingCanvas = cloneCanvas(l.drawingCanvas);
      return copy;
    });
    setLayers(prev => [...prev, ...newLayers]);
    const newIds = newLayers.map(l => l.id);
    setSelectedLayerId(newIds[newIds.length - 1]);
    setSelectedLayerIds(newIds);
    setShowBorders(true);
  }, [copiedLayers, saveLayerSnapshot]);

  const handleToggleLock = useCallback(() => {
    const ids = selectedLayerIdsRef.current;
    const currentLayers = layersRef.current;
    const targetIds = ids.length > 0 ? ids : (selectedLayerIdRef.current ? [selectedLayerIdRef.current] : []);
    if (targetIds.length === 0) return;
    const anyLocked = currentLayers.some(l => targetIds.includes(l.id) && l.locked);
    const newLocked = !anyLocked;
    setLayers(prev => prev.map(l => targetIds.includes(l.id) ? { ...l, locked: newLocked } : l));
  }, []);

  // ========== UNDO/REDO ==========
  const handleBeforeStroke = useCallback((layerId: string) => {
    const layer = layersRef.current.find(l => l.id === layerId);
    if (!layer?.drawingCanvas) return;
    const snapshot = cloneCanvas(layer.drawingCanvas);
    const stack = undoStacks.current.get(layerId) || [];
    stack.push(snapshot);
    if (stack.length > MAX_UNDO) stack.shift();
    undoStacks.current.set(layerId, stack);
    redoStacks.current.set(layerId, []);
    updateUndoRedoCounts(layerId);
  }, [updateUndoRedoCounts]);

  const handleAfterStroke = useCallback((layerId: string) => {
    const layer = layersRef.current.find(l => l.id === layerId);
    if (!layer?.drawingCanvas) return;
    const result = computeDrawingOutline(layer.drawingCanvas);
    updateLayer(layerId, { paintedBounds: result.paintedBounds, outlineCanvas: result.outlineCanvas });
    updateUndoRedoCounts(layerId);
  }, [updateLayer, updateUndoRedoCounts]);

  const handleUndo = useCallback(() => {
    const layerId = selectedLayerIdRef.current;
    if (layerId) {
      const layer = layersRef.current.find(l => l.id === layerId);

      // 1. Unified wand/selection undo (single stack)
      if (layer && layer.wandHistory && layer.wandHistory.length > 0) {
        const currentSource = layer.sourceCanvas ? cloneCanvas(layer.sourceCanvas) : (() => {
          const c = document.createElement('canvas');
          c.width = layer.width; c.height = layer.height;
          if (layer.image) c.getContext('2d')!.drawImage(layer.image, 0, 0);
          return c;
        })();
        const wandRedo = layer.wandFuture ? [...layer.wandFuture] : [];
        wandRedo.push(currentSource);
        const wandUndoCopy = [...layer.wandHistory];
        const prevSource = wandUndoCopy.pop()!;
        const hasUndoLeft = wandUndoCopy.length > 0;
        const bounds = hasUndoLeft ? computeCropBounds(prevSource) : undefined;
        const filtered = hasUndoLeft
          ? processFiltersFromCanvas(prevSource, layer.filters, undefined, layer.globalHueRotate, layer.layerSaturation)
          : (layer.image ? processLayerFilters(layer.image, layer.filters, undefined, layer.globalHueRotate, undefined, layer.layerSaturation) : processFiltersFromCanvas(prevSource, layer.filters, undefined, layer.globalHueRotate, layer.layerSaturation));
        setLayers(prev => prev.map(l => l.id === layerId ? {
          ...l,
          sourceCanvas: hasUndoLeft ? prevSource : undefined,
          filteredCanvas: filtered,
          cropBounds: bounds,
          opacity: l.opacity,
          wandHistory: wandUndoCopy, wandFuture: wandRedo,
        } : l));
        return;
      }

      // 3. Drawing undo
      const uStack = undoStacks.current.get(layerId);
      if (uStack && uStack.length > 0 && layer?.drawingCanvas) {
        const currentSnapshot = cloneCanvas(layer.drawingCanvas);
        const rStack = redoStacks.current.get(layerId) || [];
        rStack.push(currentSnapshot);
        redoStacks.current.set(layerId, rStack);
        const prev = uStack.pop()!;
        const ctx = layer.drawingCanvas.getContext('2d')!;
        ctx.clearRect(0, 0, layer.drawingCanvas.width, layer.drawingCanvas.height);
        ctx.drawImage(prev, 0, 0);
        const result = computeDrawingOutline(layer.drawingCanvas);
        updateLayer(layerId, { paintedBounds: result.paintedBounds, outlineCanvas: result.outlineCanvas });
        updateUndoRedoCounts(layerId);
        setLayers(prev => [...prev]);
        return;
      }
    }
    // 4. Layer-level undo
    undoLayerAction();
  }, [updateLayer, updateUndoRedoCounts, undoLayerAction]);

  const handleRedo = useCallback(() => {
    const layerId = selectedLayerIdRef.current;
    if (layerId) {
      const layer = layersRef.current.find(l => l.id === layerId);

      // 1. Wand redo (reverse order of undo priority)
      if (layer && layer.wandFuture && layer.wandFuture.length > 0) {
        const currentSource = layer.sourceCanvas ? cloneCanvas(layer.sourceCanvas) : (() => {
          const c = document.createElement('canvas');
          c.width = layer.width; c.height = layer.height;
          if (layer.image) c.getContext('2d')!.drawImage(layer.image, 0, 0);
          return c;
        })();
        const wandUndo = layer.wandHistory ? [...layer.wandHistory] : [];
        wandUndo.push(currentSource);
        const wandFutureCopy = [...layer.wandFuture];
        const nextSource = wandFutureCopy.pop()!;
        const bounds = computeCropBounds(nextSource);
        const filtered = processFiltersFromCanvas(nextSource, layer.filters, undefined, layer.globalHueRotate, layer.layerSaturation);
        setLayers(prev => prev.map(l => l.id === layerId ? {
          ...l, sourceCanvas: nextSource, filteredCanvas: filtered,
          cropBounds: bounds, opacity: l.opacity,
          wandHistory: wandUndo, wandFuture: wandFutureCopy,
        } : l));
        return;
      }

      // 2. Drawing redo
      const rStack = redoStacks.current.get(layerId);
      if (rStack && rStack.length > 0 && layer?.drawingCanvas) {
        const currentSnapshot = cloneCanvas(layer.drawingCanvas);
        const uStack = undoStacks.current.get(layerId) || [];
        uStack.push(currentSnapshot);
        undoStacks.current.set(layerId, uStack);
        const next = rStack.pop()!;
        const ctx = layer.drawingCanvas.getContext('2d')!;
        ctx.clearRect(0, 0, layer.drawingCanvas.width, layer.drawingCanvas.height);
        ctx.drawImage(next, 0, 0);
        const result = computeDrawingOutline(layer.drawingCanvas);
        updateLayer(layerId, { paintedBounds: result.paintedBounds, outlineCanvas: result.outlineCanvas });
        updateUndoRedoCounts(layerId);
        setLayers(prev => [...prev]);
        return;
      }
    }
    // 4. Layer-level redo
    redoLayerAction();
  }, [updateLayer, updateUndoRedoCounts, redoLayerAction]);

  // ========== TOOL SELECTION ==========
  const handleToolSelect = useCallback((toolId: Tool) => {
    setTool(toolId);
    setShowBrushPanel(false); setShowMagicWandPanel(false);
    setShowTextPanel(false); setShowShapePanel(false); setShowPenPanel(false);
    if (toolId !== 'rectSelect' && toolId !== 'lassoSelect' && toolId !== 'magicWand') {
      setSelection(null); // Clear selection when switching away from selection tools
    }
    if (toolId === 'brush' || toolId === 'eraser') {
      setShowBrushPanel(true);
      const currentLayers = layersRef.current;
      const currentSelId = selectedLayerIdRef.current;
      const sel = currentLayers.find(l => l.id === currentSelId);
      if (sel?.type === 'drawing') return;
      const drawingLayer = [...currentLayers].reverse().find(l => l.type === 'drawing');
      if (drawingLayer) handleLayerSelect(drawingLayer.id);
      else addDrawingLayer();
    } else if (toolId === 'magicWand') {
      setShowMagicWandPanel(true);
    } else if (toolId === 'text') {
      setShowTextPanel(true);
    } else if (toolId === 'shape') {
      setShowShapePanel(true);
    } else if (toolId === 'pen') {
      setShowPenPanel(true);
    }
  }, [addDrawingLayer, handleLayerSelect]);

  // ========== EXPORT ==========
  const handleExport = useCallback(() => {
    const visibleLayers = layers.filter(l => l.visible);
    if (visibleLayers.length === 0) return;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const l of visibleLayers) {
      const lw = l.width * l.scaleX; const lh = l.height * l.scaleY;
      minX = Math.min(minX, l.x); minY = Math.min(minY, l.y);
      maxX = Math.max(maxX, l.x + lw); maxY = Math.max(maxY, l.y + lh);
    }
    const exportW = Math.ceil(maxX - minX); const exportH = Math.ceil(maxY - minY);
    if (exportW <= 0 || exportH <= 0) return;
    const canvas = document.createElement('canvas');
    canvas.width = exportW; canvas.height = exportH;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#151725'; ctx.fillRect(0, 0, exportW, exportH);
    for (const layer of visibleLayers) {
      const source = layer.type === 'drawing' ? layer.drawingCanvas : layer.filteredCanvas;
      if (!source) continue;
      ctx.save();
      ctx.globalAlpha = layer.opacity;
      if (layer.layerSaturation !== 100) ctx.filter = `saturate(${layer.layerSaturation}%)`;
      const cx = (layer.x - minX) + (layer.width * layer.scaleX) / 2;
      const cy = (layer.y - minY) + (layer.height * layer.scaleY) / 2;
      ctx.translate(cx, cy); ctx.rotate(layer.rotation);
      ctx.scale(layer.scaleX * (layer.flipH ? -1 : 1), layer.scaleY * (layer.flipV ? -1 : 1));
      ctx.translate(-layer.width / 2, -layer.height / 2);
      ctx.drawImage(source, 0, 0, layer.width, layer.height);
      ctx.restore();
    }
    canvas.toBlob(blob => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url;
      a.download = `freecanvas-export-${Date.now()}.png`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 'image/png');
  }, [layers]);

  const handleExportSingle = useCallback((id: string) => {
    const layer = layers.find(l => l.id === id);
    if (!layer) return;
    const source = layer.type === 'drawing' ? layer.drawingCanvas : layer.filteredCanvas;
    if (!source) return;
    const exportW = Math.round(layer.width * layer.scaleX);
    const exportH = Math.round(layer.height * layer.scaleY);
    if (exportW <= 0 || exportH <= 0) return;
    const canvas = document.createElement('canvas');
    canvas.width = exportW; canvas.height = exportH;
    const ctx = canvas.getContext('2d')!;
    ctx.save(); ctx.globalAlpha = layer.opacity;
    ctx.translate(exportW / 2, exportH / 2);
    ctx.scale(layer.flipH ? -1 : 1, layer.flipV ? -1 : 1);
    ctx.translate(-exportW / 2, -exportH / 2);
    ctx.drawImage(source, 0, 0, layer.width, layer.height, 0, 0, exportW, exportH);
    ctx.restore();
    canvas.toBlob(blob => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url;
      a.download = `${layer.name}-${Date.now()}.png`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 'image/png');
  }, [layers]);

  // ========== PERSPECTIVE TRANSFORM ==========
  const handleApplyPerspective = useCallback((transformedCanvas: HTMLCanvasElement, offset?: { offsetX: number; offsetY: number }) => {
    if (!selectedLayerId) return;
    const layer = layersRef.current.find(l => l.id === selectedLayerId);
    if (!layer) return;

    // Update the layer with the transformed canvas
    if (layer.type === 'drawing' && layer.drawingCanvas) {
      // For drawing layers, set the transformed result to filteredCanvas
      const fc = cloneCanvas(transformedCanvas);
      updateLayer(selectedLayerId, { filteredCanvas: fc });
    } else if (layer.type === 'image' || layer.type === 'text' || layer.type === 'shape') {
      // For image/text/shape layers, update sourceCanvas and filteredCanvas
      const sourceCanvas = cloneCanvas(transformedCanvas);
      const filtered = processFiltersFromCanvas(sourceCanvas, layer.filters, undefined, layer.globalHueRotate, layer.layerSaturation);
      const bounds = computeCropBounds(sourceCanvas);
      
      // Adjust layer position based on center point displacement from perspective transform
      let updates: Partial<Layer> = {
        sourceCanvas,
        filteredCanvas: filtered,
        cropBounds: bounds,
      };
      
      if (offset && (offset.offsetX !== 0 || offset.offsetY !== 0)) {
        // Rotate offset by layer's rotation to account for the layer's current rotation
        const cos = Math.cos(layer.rotation);
        const sin = Math.sin(layer.rotation);
        const rotatedOffsetX = offset.offsetX * cos - offset.offsetY * sin;
        const rotatedOffsetY = offset.offsetX * sin + offset.offsetY * cos;
        
        // Scale offset by layer's scale
        const scaledOffsetX = rotatedOffsetX * layer.scaleX;
        const scaledOffsetY = rotatedOffsetY * layer.scaleY;
        
        updates.x = layer.x + scaledOffsetX;
        updates.y = layer.y + scaledOffsetY;
      }
      
      updateLayer(selectedLayerId, updates);
    }

    setShowPerspective(false);
  }, [selectedLayerId, updateLayer]);

  // ========== MAGIC WAND ==========
  const handleMagicWand = useCallback((layerId: string, worldX: number, worldY: number) => {
    const layer = layersRef.current.find(l => l.id === layerId);
    if (!layer || layer.type !== 'image' || !layer.image) return;
    const existingSource = layer.sourceCanvas;
    const src = existingSource || (() => {
      const c = document.createElement('canvas');
      c.width = layer.width; c.height = layer.height;
      c.getContext('2d')!.drawImage(layer.image!, 0, 0);
      return c;
    })();
    const wandUndo = layer.wandHistory ? [...layer.wandHistory] : [];
    wandUndo.push(cloneCanvas(src));
    if (wandUndo.length > 15) wandUndo.shift();
    const ctx = src.getContext('2d')!;
    const w = src.width, h = src.height;
    const imgData = ctx.getImageData(0, 0, w, h);
    const data = imgData.data;

    // Convert world coords to layer-local pixel coords (accounting for rotation and flip)
    const lw = layer.width * layer.scaleX, lh = layer.height * layer.scaleY;
    const cx = layer.x + lw / 2, cy = layer.y + lh / 2;
    // Inverse rotate around layer center
    const cos = Math.cos(-layer.rotation), sin = Math.sin(-layer.rotation);
    const dx = worldX - cx, dy = worldY - cy;
    const rotatedX = dx * cos - dy * sin;
    const rotatedY = dx * sin + dy * cos;
    // Now convert to local coords (0 to width/height) accounting for flip
    let localLX = rotatedX + lw / 2;
    let localLY = rotatedY + lh / 2;
    // Account for flip
    if (layer.flipH) localLX = lw - localLX;
    if (layer.flipV) localLY = lh - localLY;
    // Convert from display size to pixel coords
    const localX = Math.round(localLX / layer.scaleX);
    const localY = Math.round(localLY / layer.scaleY);
    if (localX < 0 || localX >= w || localY < 0 || localY >= h) return;
    if (data[(localY * w + localX) * 4 + 3] === 0) return;
    const seedIdx = (localY * w + localX) * 4;
    const seedR = data[seedIdx], seedG = data[seedIdx + 1], seedB = data[seedIdx + 2];
    const threshold = magicWandThreshold;
    const visited = new Uint8Array(w * h);
    const queue: number[] = [localX, localY];
    visited[localY * w + localX] = 1;
    while (queue.length > 0) {
      const py = queue.pop()!; const px = queue.pop()!;
      const pi = (py * w + px) * 4;
      data[pi + 3] = 0;
      const neighbors = [[px-1,py],[px+1,py],[px,py-1],[px,py+1]];
      for (const [nx, ny] of neighbors) {
        if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
        const ni = ny * w + nx;
        if (visited[ni]) continue;
        visited[ni] = 1;
        const npi = ni * 4;
        if (data[npi + 3] === 0) continue;
        const dr = Math.abs(data[npi] - seedR);
        const dg = Math.abs(data[npi + 1] - seedG);
        const db = Math.abs(data[npi + 2] - seedB);
        if ((dr + dg + db) / 3 <= threshold) queue.push(nx, ny);
      }
    }
    ctx.putImageData(imgData, 0, 0);
    const bounds = computeCropBounds(src);
    const filtered = processFiltersFromCanvas(src, layer.filters, undefined, layer.globalHueRotate, layer.layerSaturation);
    setLayers(prev => prev.map(l => l.id === layerId ? {
      ...l, sourceCanvas: src, filteredCanvas: filtered,
      cropBounds: bounds, opacity: l.opacity, wandHistory: wandUndo, wandFuture: [],
    } : l));
  }, [magicWandThreshold]);

  // ========== DELETE SELECTION ==========
  const handleDeleteSelection = useCallback(() => {
    if (!selection) return;
    const layer = layersRef.current.find(l => l.id === selection.layerId);
    if (!layer || (layer.type !== 'image' && layer.type !== 'text' && layer.type !== 'shape')) return;

    const existingSource = layer.sourceCanvas;
    const src = existingSource ? cloneCanvas(existingSource) : (() => {
      const c = document.createElement('canvas');
      c.width = layer.width; c.height = layer.height;
      if (layer.image) c.getContext('2d')!.drawImage(layer.image, 0, 0);
      else if (layer.filteredCanvas) c.getContext('2d')!.drawImage(layer.filteredCanvas, 0, 0, layer.width, layer.height);
      return c;
    })();

    // Save to UNIFIED wand history (same stack as magic wand for single-step undo)
    const wandUndo = layer.wandHistory ? [...layer.wandHistory] : [];
    wandUndo.push(cloneCanvas(src));
    if (wandUndo.length > 15) wandUndo.shift();

    const ctx = src.getContext('2d')!;
    const w = src.width, h = src.height;

    // Save clipboard for paste
    const clipSrc = cloneCanvas(src);
    const clipCtx = clipSrc.getContext('2d')!;

    if (selection.type === 'rect' && selection.rect) {
      const r = selection.rect;
      // Clamp to image bounds for clipboard extraction
      const cx0 = Math.max(0, r.x), cy0 = Math.max(0, r.y);
      const cx1 = Math.min(w, r.x + r.w), cy1 = Math.min(h, r.y + r.h);
      const cw = cx1 - cx0, ch = cy1 - cy0;
      if (cw > 0 && ch > 0) {
        const clipData = clipCtx.getImageData(cx0, cy0, cw, ch);
        const clip = document.createElement('canvas');
        clip.width = cw; clip.height = ch;
        clip.getContext('2d')!.putImageData(clipData, 0, 0);
        setClipboardCanvas(clip);
        setClipboardMeta({
          clipX: cx0, clipY: cy0, clipW: cw, clipH: ch,
          sourceX: layer.x, sourceY: layer.y,
          sourceScaleX: layer.scaleX, sourceScaleY: layer.scaleY,
          sourceRotation: layer.rotation, // Save source rotation
        });
      }
      // Clear from source
      ctx.clearRect(r.x, r.y, r.w, r.h);
    } else if (selection.type === 'lasso' && selection.path && selection.path.length > 2) {
      // Save lasso area to clipboard — compute tight bounds
      let lMinX = w, lMinY = h, lMaxX = 0, lMaxY = 0;
      for (const [px, py] of selection.path) {
        if (px < lMinX) lMinX = px; if (px > lMaxX) lMaxX = px;
        if (py < lMinY) lMinY = py; if (py > lMaxY) lMaxY = py;
      }
      lMinX = Math.max(0, Math.floor(lMinX)); lMinY = Math.max(0, Math.floor(lMinY));
      lMaxX = Math.min(w, Math.ceil(lMaxX)); lMaxY = Math.min(h, Math.ceil(lMaxY));
      const clipW2 = lMaxX - lMinX, clipH2 = lMaxY - lMinY;
      const clip = document.createElement('canvas');
      clip.width = clipW2 > 0 ? clipW2 : 1; clip.height = clipH2 > 0 ? clipH2 : 1;
      const cCtx = clip.getContext('2d')!;
      cCtx.translate(-lMinX, -lMinY);
      cCtx.beginPath();
      cCtx.moveTo(selection.path[0][0], selection.path[0][1]);
      for (let i = 1; i < selection.path.length; i++) cCtx.lineTo(selection.path[i][0], selection.path[i][1]);
      cCtx.closePath();
      cCtx.clip();
      cCtx.drawImage(src, 0, 0);
      setClipboardCanvas(clip);
      setClipboardMeta({
        clipX: lMinX, clipY: lMinY, clipW: clipW2, clipH: clipH2,
        sourceX: layer.x, sourceY: layer.y,
        sourceScaleX: layer.scaleX, sourceScaleY: layer.scaleY,
        sourceRotation: layer.rotation, // Save source rotation
      });
      // Clear from source
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(selection.path[0][0], selection.path[0][1]);
      for (let i = 1; i < selection.path.length; i++) ctx.lineTo(selection.path[i][0], selection.path[i][1]);
      ctx.closePath();
      ctx.clip();
      ctx.clearRect(0, 0, w, h);
      ctx.restore();
    } else if (selection.type === 'wand' && selection.mask) {
      const imgData = ctx.getImageData(0, 0, w, h);
      const data = imgData.data;
      const mask = selection.mask;
      for (let i = 0; i < mask.length; i++) {
        if (mask[i]) {
          const pi = i * 4;
          if (pi + 3 < data.length) data[pi + 3] = 0;
        }
      }
      ctx.putImageData(imgData, 0, 0);
    }

    const bounds = computeCropBounds(src);
    const filtered = processFiltersFromCanvas(src, layer.filters, undefined, layer.globalHueRotate, layer.layerSaturation);
    setLayers(prev => prev.map(l => l.id === selection.layerId ? {
      ...l, sourceCanvas: src, filteredCanvas: filtered,
      cropBounds: bounds, opacity: l.opacity,
      wandHistory: wandUndo, wandFuture: [],
    } : l));
    setSelection(null);
  }, [selection]);

  // ========== PASTE SELECTION ==========
  const handlePasteSelection = useCallback(() => {
    if (!clipboardCanvas) return;
    saveLayerSnapshot();
    const id = `layer-${++layerCounter}`;
    const cw = clipboardCanvas.width, ch = clipboardCanvas.height;
    const fc = cloneCanvas(clipboardCanvas);
    const tc = document.createElement('canvas');
    tc.width = 48; tc.height = 48;
    const tctx = tc.getContext('2d')!;
    const aspect = cw / ch;
    let tw = 48, th = 48;
    if (aspect > 1) th = 48 / aspect; else tw = 48 * aspect;
    tctx.drawImage(clipboardCanvas, (48 - tw) / 2, (48 - th) / 2, tw, th);

    // Calculate paste position: at original cut location if metadata available
    let pasteX: number, pasteY: number, pasteSX: number, pasteSY: number, pasteRot: number;
    if (clipboardMeta) {
      // For rotated sources, we need to compute the world position accounting for rotation
      const rot = clipboardMeta.sourceRotation || 0;
      const offsetX = clipboardMeta.clipX * clipboardMeta.sourceScaleX;
      const offsetY = clipboardMeta.clipY * clipboardMeta.sourceScaleY;
      // Apply rotation to the offset
      const cos = Math.cos(rot), sin = Math.sin(rot);
      const rotOffsetX = offsetX * cos - offsetY * sin;
      const rotOffsetY = offsetX * sin + offsetY * cos;
      pasteX = clipboardMeta.sourceX + rotOffsetX;
      pasteY = clipboardMeta.sourceY + rotOffsetY;
      pasteSX = clipboardMeta.sourceScaleX;
      pasteSY = clipboardMeta.sourceScaleY;
      pasteRot = rot;
    } else {
      // Fallback to viewport center
      const vp = viewport;
      pasteX = (window.innerWidth / 2 - vp.panX) / vp.zoom - cw / 2;
      pasteY = (window.innerHeight / 2 - vp.panY) / vp.zoom - ch / 2;
      pasteSX = 1;
      pasteSY = 1;
      pasteRot = 0;
    }

    const img = new Image();
    img.src = clipboardCanvas.toDataURL();
    // Compute tight crop bounds for proper blue border display
    const pasteCropBounds = computeCropBounds(clipboardCanvas);
    // Also create sourceCanvas so wand/selection ops work on pasted layer
    const sourceCanvas = cloneCanvas(clipboardCanvas);
    const newLayer: Layer = {
      id, name: 'Pasted Selection', type: 'image',
      visible: true, locked: false, opacity: 1, blendMode: 'source-over',
      x: pasteX, y: pasteY,
      width: cw, height: ch, scaleX: pasteSX, scaleY: pasteSY,
      rotation: pasteRot, flipH: false, flipV: false,
      image: img, thumbUrl: tc.toDataURL(), filteredCanvas: fc,
      sourceCanvas: sourceCanvas, // For wand/selection ops
      filters: { ...defaultFilters }, layerSaturation: 100, globalHueRotate: 0,
      wandHistory: [], wandFuture: [],
      selectionHistory: [], selectionFuture: [],
      cropBounds: pasteCropBounds,
    };
    setLayers(prev => [...prev, newLayer]);
    handleLayerSelect(id);
    setTool('select');
  }, [clipboardCanvas, clipboardMeta, viewport, handleLayerSelect, saveLayerSnapshot]);

  // ========== PEN TOOL — Add path as shape layer ==========
  const handleAddPenLayer = useCallback(() => {
    if (penPoints.length < 2) return;
    const pts = penPoints;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [px, py] of pts) {
      if (px < minX) minX = px; if (py < minY) minY = py;
      if (px > maxX) maxX = px; if (py > maxY) maxY = py;
    }
    const pad = penWidth + 4;
    minX -= pad; minY -= pad; maxX += pad; maxY += pad;
    const w = Math.max(1, Math.ceil(maxX - minX));
    const h = Math.max(1, Math.ceil(maxY - minY));
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d')!;
    // Clear canvas to ensure transparency
    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = penColor; ctx.fillStyle = penColor;
    ctx.lineWidth = penWidth; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(pts[0][0] - minX, pts[0][1] - minY);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0] - minX, pts[i][1] - minY);
    if (penFill) { ctx.closePath(); ctx.fill(); }
    ctx.stroke();
    const id = `layer-${++layerCounter}`;
    // Clone the pen canvas as the source for filter processing
    const sourceCanvas = cloneCanvas(c);
    // Process through filter pipeline with sourceCanvas
    const fc = processFiltersFromCanvas(sourceCanvas, { ...defaultFilters }, undefined, 0, 100);
    const thumb = createThumb(c);
    // Create an Image from canvas for proper layer handling
    const img = new Image();
    img.src = c.toDataURL();
    // Compute cropBounds for proper blue border display
    const penCropBounds = computeCropBounds(c);
    const newLayer: Layer = {
      id, name: `Pen Path`, type: 'image', // Use 'image' type so it gets proper filter support
      visible: true, locked: false, opacity: 1, blendMode: 'source-over',
      x: minX, y: minY, width: w, height: h,
      scaleX: 1, scaleY: 1, rotation: 0, flipH: false, flipV: false,
      image: img, sourceCanvas: sourceCanvas, filteredCanvas: fc, thumbUrl: thumb,
      filters: { ...defaultFilters }, layerSaturation: 100, globalHueRotate: 0,
      cropBounds: penCropBounds,
      wandHistory: [], wandFuture: [],
      selectionHistory: [], selectionFuture: [],
    };
    setLayers(prev => [...prev, newLayer]);
    handleLayerSelect(id);
    setPenPoints([]);
    setPenHistory([]);
    setPenFuture([]);
    setTool('select');
  }, [penPoints, penColor, penWidth, penFill, handleLayerSelect]);

  // ========== BOOLEAN OPERATIONS ==========
  const handleBoolean = useCallback((op: 'union' | 'subtract' | 'intersect' | 'exclude') => {
    const ids = selectedLayerIdsRef.current;
    if (ids.length < 2) return;
    const sorted = layersRef.current.filter(l => ids.includes(l.id) && l.visible);
    if (sorted.length < 2) return;
    saveLayerSnapshot();
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const l of sorted) {
      minX = Math.min(minX, l.x); minY = Math.min(minY, l.y);
      maxX = Math.max(maxX, l.x + l.width * l.scaleX);
      maxY = Math.max(maxY, l.y + l.height * l.scaleY);
    }
    const w = Math.ceil(maxX - minX); const h = Math.ceil(maxY - minY);
    if (w <= 0 || h <= 0) return;
    const result = document.createElement('canvas');
    result.width = w; result.height = h;
    const ctx = result.getContext('2d')!;
    const drawLayer = (l: Layer) => {
      const src = l.type === 'drawing' ? l.drawingCanvas : l.filteredCanvas;
      if (!src) return;
      ctx.save();
      ctx.globalAlpha = l.opacity;
      const cx = (l.x - minX) + (l.width * l.scaleX) / 2;
      const cy = (l.y - minY) + (l.height * l.scaleY) / 2;
      ctx.translate(cx, cy); ctx.rotate(l.rotation);
      ctx.scale(l.scaleX * (l.flipH ? -1 : 1), l.scaleY * (l.flipV ? -1 : 1));
      ctx.translate(-l.width / 2, -l.height / 2);
      ctx.drawImage(src, 0, 0, l.width, l.height);
      ctx.restore();
    };
    if (op === 'union') {
      for (const l of sorted) drawLayer(l);
    } else {
      // Draw bottom layer first
      drawLayer(sorted[0]);
      for (let i = 1; i < sorted.length; i++) {
        if (op === 'subtract') ctx.globalCompositeOperation = 'destination-out';
        else if (op === 'intersect') ctx.globalCompositeOperation = 'destination-in';
        else if (op === 'exclude') ctx.globalCompositeOperation = 'xor';
        drawLayer(sorted[i]);
        ctx.globalCompositeOperation = 'source-over';
      }
    }
    const id = `layer-${++layerCounter}`;
    const fc = cloneCanvas(result);
    const thumb = createThumb(result);
    const img = new Image(); img.src = result.toDataURL();
    // Compute tight bounds around opaque pixels
    const boolCropBounds = computeCropBounds(result);
    // Create sourceCanvas for wand/selection ops on boolean result
    const boolSourceCanvas = cloneCanvas(result);
    const newLayer: Layer = {
      id, name: `Bool(${op})`, type: 'image',
      visible: true, locked: false, opacity: 1, blendMode: 'source-over',
      x: minX, y: minY, width: w, height: h,
      scaleX: 1, scaleY: 1, rotation: 0, flipH: false, flipV: false,
      image: img, filteredCanvas: fc, thumbUrl: thumb,
      sourceCanvas: boolSourceCanvas,
      filters: { ...defaultFilters }, layerSaturation: 100, globalHueRotate: 0,
      cropBounds: boolCropBounds,
      wandHistory: [], wandFuture: [],
      selectionHistory: [], selectionFuture: [],
    };
    setLayers(prev => [...prev, newLayer]);
    handleLayerSelect(id);
  }, [saveLayerSnapshot, handleLayerSelect]);

  // ========== WARP MESH ==========
  const handleToggleWarpMesh = useCallback((id: string) => {
    setLayers(prev => prev.map(l => {
      if (l.id !== id) return l;
      if (l.warpMesh) {
        // Remove warp mesh
        return { ...l, warpMesh: undefined };
      } else {
        // Create default 4x4 grid
        const rows = 4, cols = 4;
        const w = l.width, h = l.height;
        const points: { x: number; y: number }[] = [];
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            points.push({ x: (c / (cols - 1)) * w, y: (r / (rows - 1)) * h });
          }
        }
        return { ...l, warpMesh: { rows, cols, points } };
      }
    }));
  }, []);

  const handleResetWarpMesh = useCallback((id: string) => {
    setLayers(prev => prev.map(l => {
      if (l.id !== id || !l.warpMesh) return l;
      // Reset to default grid positions
      const { rows, cols } = l.warpMesh;
      const w = l.width, h = l.height;
      const points: { x: number; y: number }[] = [];
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          points.push({ x: (c / (cols - 1)) * w, y: (r / (rows - 1)) * h });
        }
      }
      return { ...l, warpMesh: { rows, cols, points } };
    }));
  }, []);

  // ========== GROUP / UNGROUP ==========
  const handleGroupSelected = useCallback(() => {
    const ids = selectedLayerIdsRef.current;
    if (ids.length < 2) return;
    const gid = `g-${Date.now()}`;
    setLayers(prev => prev.map(l => ids.includes(l.id) ? { ...l, groupId: gid } : l));
  }, []);

  const handleUngroupSelected = useCallback(() => {
    const ids = selectedLayerIdsRef.current;
    setLayers(prev => prev.map(l => ids.includes(l.id) ? { ...l, groupId: undefined } : l));
  }, []);

  // Archive management removed for stability

  // ========== CLEAR ALL (with undo) ==========
  const handleClearAll = useCallback(() => {
    if (layers.length === 0) return;
    saveLayerSnapshot();
    setLayers([]);
    setSelectedLayerId(null);
    setSelectedLayerIds([]);
    setShowBorders(false);
    setSelection(null);
    setClipboardCanvas(null);
    setClipboardMeta(null);
  }, [layers.length, saveLayerSnapshot]);

  // ========== REFRESH TOOLS (reset tool state without clearing layers) ==========
  const handleRefreshTools = useCallback(() => {
    // Reset all tool states to default
    setTool('select');
    setShowBrushPanel(false);
    setShowMagicWandPanel(false);
    setShowTextPanel(false);
    setShowShapePanel(false);
    setShowPenPanel(false);
    setSelection(null);
    setPenPoints([]);
    setPenHistory([]);
    setPenFuture([]);
    setBrushSettings({ size: 8, color: '#ffffff', opacity: 1 });
    setMagicWandThreshold(30);
    // Keep layers and viewport intact
  }, []);

  const handleExportGroup = useCallback(() => {
    const sel = layersRef.current.find(l => l.id === selectedLayerIdRef.current);
    if (!sel?.groupId) return;
    const group = layersRef.current.filter(l => l.groupId === sel.groupId && l.visible);
    if (group.length === 0) return;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const l of group) {
      minX = Math.min(minX, l.x); minY = Math.min(minY, l.y);
      maxX = Math.max(maxX, l.x + l.width * l.scaleX);
      maxY = Math.max(maxY, l.y + l.height * l.scaleY);
    }
    const ew = Math.ceil(maxX - minX); const eh = Math.ceil(maxY - minY);
    if (ew <= 0 || eh <= 0) return;
    const canvas = document.createElement('canvas');
    canvas.width = ew; canvas.height = eh;
    const ctx = canvas.getContext('2d')!;
    for (const l of group) {
      const src = l.type === 'drawing' ? l.drawingCanvas : l.filteredCanvas;
      if (!src) continue;
      ctx.save(); ctx.globalAlpha = l.opacity;
      const cx = (l.x - minX) + (l.width * l.scaleX) / 2;
      const cy = (l.y - minY) + (l.height * l.scaleY) / 2;
      ctx.translate(cx, cy); ctx.rotate(l.rotation);
      ctx.scale(l.scaleX * (l.flipH ? -1 : 1), l.scaleY * (l.flipV ? -1 : 1));
      ctx.translate(-l.width / 2, -l.height / 2);
      ctx.drawImage(src, 0, 0, l.width, l.height);
      ctx.restore();
    }
    canvas.toBlob(blob => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url;
      a.download = `group-export-${Date.now()}.png`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 'image/png');
  }, []);

  // ========== PANEL DRAG ==========
  const handlePanelDragStart = useCallback((e: React.TouchEvent | React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation();
    const clientX = 'touches' in e ? e.touches[0].clientX : (e as React.MouseEvent).clientX;
    const startWidth = panelCollapsed ? 0 : panelWidth;
    panelDrag.current = { active: true, startX: clientX, startWidth };
    const handleDragMove = (ev: TouchEvent | MouseEvent) => {
      ev.preventDefault();
      const cx = 'touches' in ev ? (ev as TouchEvent).touches[0].clientX : (ev as MouseEvent).clientX;
      const dx = panelDrag.current.startX - cx;
      const newWidth = Math.max(0, Math.min(400, panelDrag.current.startWidth + dx));
      if (newWidth < 80) { setPanelCollapsed(true); setPanelWidth(0); }
      else { setPanelCollapsed(false); setPanelWidth(newWidth); }
    };
    const handleDragEnd = () => {
      panelDrag.current.active = false;
      document.removeEventListener('touchmove', handleDragMove);
      document.removeEventListener('mousemove', handleDragMove);
      document.removeEventListener('touchend', handleDragEnd);
      document.removeEventListener('mouseup', handleDragEnd);
    };
    document.addEventListener('touchmove', handleDragMove, { passive: false });
    document.addEventListener('mousemove', handleDragMove);
    document.addEventListener('touchend', handleDragEnd);
    document.addEventListener('mouseup', handleDragEnd);
  }, [panelWidth, panelCollapsed]);

  const togglePanel = useCallback(() => {
    if (panelCollapsed) { setPanelCollapsed(false); setPanelWidth(280); }
    else { setPanelCollapsed(true); setPanelWidth(0); }
  }, [panelCollapsed]);

  const selectedLayer = layers.find(l => l.id === selectedLayerId) || null;
  const isDrawingTool = tool === 'brush' || tool === 'eraser';
  const isDrawingLayer = selectedLayer?.type === 'drawing';
  const hasLayerUndo = layerHistory.current.past.length > 0;
  const hasLayerRedo = layerHistory.current.future.length > 0;
  const hasWandUndo = selectedLayer?.wandHistory ? selectedLayer.wandHistory.length > 0 : false;
  const hasWandRedo = selectedLayer?.wandFuture ? selectedLayer.wandFuture.length > 0 : false;
  const canUndo = hasWandUndo || (isDrawingLayer && undoCount > 0) || hasLayerUndo;
  const canRedo = hasWandRedo || (isDrawingLayer && redoCount > 0) || hasLayerRedo;
  const hasSelection = selectedLayerIds.length > 0 || selectedLayerId !== null;
  const hasCopied = copiedLayers.length > 0;
  const anySelectedLocked = layers.some(l => (selectedLayerIds.includes(l.id) || l.id === selectedLayerId) && l.locked);

  const tools: { id: Tool; icon: string; label: string }[] = [
    { id: 'select', icon: '↖', label: 'Select' },
    { id: 'pan', icon: '✋', label: 'Pan' },
    { id: 'rectSelect', icon: '⬜', label: 'Rect Sel' },
    { id: 'lassoSelect', icon: '✏', label: 'Lasso' },
    { id: 'magicWand', icon: '🪄', label: 'Wand' },
    { id: 'brush', icon: '🖌', label: 'Brush' },
    { id: 'eraser', icon: '⌫', label: 'Eraser' },
    { id: 'text', icon: 'T', label: 'Text' },
    { id: 'shape', icon: '⬟', label: 'Shape' },
    { id: 'pen', icon: '✒', label: 'Pen' },
  ];

  const FONTS = ['Arial', 'Georgia', 'Courier New', 'Verdana', 'Impact', 'Comic Sans MS', 'Times New Roman', 'Trebuchet MS'];
  const SHAPES: { id: string; icon: string }[] = [
    { id: 'circle', icon: '●' }, { id: 'square', icon: '■' },
    { id: 'triangle', icon: '▲' }, { id: 'star', icon: '★' },
    { id: 'heart', icon: '♥' }, { id: 'diamond', icon: '◆' },
    { id: 'arrow', icon: '⬆' }, { id: 'hexagon', icon: '⬡' },
    { id: 'arch', icon: '⌒' }, { id: 'curve', icon: '〜' },
  ];

  return (
    <div className="h-screen w-screen flex flex-col bg-[#151725] text-gray-200 overflow-hidden select-none" style={{ touchAction: 'none' }}>
      {/* Grid Perspective Tool Button - Top Left */}
      <button
        onClick={() => setShowPerspective(true)}
        style={{
          position: 'fixed',
          left: 12,
          top: 12,
          zIndex: 999,
          background: '#4f46e5',
          color: 'white',
          borderRadius: 8,
          padding: '8px 12px',
          border: 'none',
          cursor: 'pointer',
          fontSize: '14px',
          fontWeight: 500,
        }}
      >
        网格透视
      </button>

      {/* Grid Perspective Modal */}
      {showPerspective && (
        <PerspectiveTool
          selectedLayer={selectedLayer}
          onApply={handleApplyPerspective}
          onClose={() => setShowPerspective(false)}
        />
      )}

      {/* Top Bar */}
      <div className="h-12 bg-[#1a1c2e] border-b border-[#2a2d45] flex items-center px-2 gap-1.5 shrink-0 z-20">
        <div className="font-bold text-sm tracking-wide flex items-center gap-1.5">
          <span className="text-[#4f7cff] text-lg">∞</span>
          <span className="bg-gradient-to-r from-[#4f7cff] to-[#a78bfa] bg-clip-text text-transparent hidden sm:inline">FreeCanvas</span>
        </div>
        <div className="w-px h-6 bg-[#2a2d45]" />
        <button onClick={handleImportClick} className="px-3 py-2 bg-[#4f7cff] active:bg-[#3d6ae8] rounded-lg text-[12px] font-medium transition-all active:scale-95">📥 Import</button>
        <button onClick={handleExport} className="px-3 py-2 bg-[#252840] active:bg-[#2f3358] rounded-lg text-[12px] text-gray-300 transition-colors active:scale-95">📤 Export</button>
        <div className="w-px h-6 bg-[#2a2d45]" />
        <button onClick={handleUndo} disabled={!canUndo} className={`w-9 h-9 flex items-center justify-center rounded-lg transition-all active:scale-90 ${canUndo ? 'text-gray-300 active:bg-[#4f7cff]' : 'text-gray-600 cursor-not-allowed'}`}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7v6h6" /><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13" /></svg>
        </button>
        <button onClick={handleRedo} disabled={!canRedo} className={`w-9 h-9 flex items-center justify-center rounded-lg transition-all active:scale-90 ${canRedo ? 'text-gray-300 active:bg-[#4f7cff]' : 'text-gray-600 cursor-not-allowed'}`}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 7v6h-6" /><path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3L21 13" /></svg>
        </button>
        <div className="flex-1" />
        <button onClick={resetView} className="px-2 py-1.5 bg-[#252840] active:bg-[#2f3358] rounded-lg text-[11px] text-gray-400 transition-colors active:scale-95">⟳</button>
        <div className="text-[11px] text-gray-500 tabular-nums w-10 text-right">{Math.round(viewport.zoom * 100)}%</div>
        <div className="w-px h-6 bg-[#2a2d45]" />
        <button onClick={togglePanel} className="px-2 py-1.5 bg-[#252840] active:bg-[#2f3358] rounded-lg text-[11px] text-gray-400 transition-colors active:scale-95">{panelCollapsed ? '☰' : '✕'}</button>
        <button onClick={handleRefreshTools} className="px-2 py-1.5 bg-[#252840] active:bg-[#2f3358] rounded-lg text-[11px] text-gray-400 transition-colors active:scale-95" title="Refresh Tools">
          🔄
        </button>
      </div>

      {/* Main Area */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* Left Toolbar */}
        <div className="w-14 bg-[#1a1c2e] border-r border-[#2a2d45] flex flex-col items-center py-2 shrink-0 z-10 gap-1">
          {tools.map(t => (
            <button key={t.id} onClick={() => handleToolSelect(t.id)}
              className={`w-11 h-11 flex items-center justify-center rounded-xl text-lg transition-all active:scale-90 ${
                tool === t.id ? 'bg-[#4f7cff] text-white shadow-lg shadow-[#4f7cff]/30' : 'text-gray-400 active:bg-[#252840]'
              }`} title={t.label}>
              {t.id === 'text' ? <span className="font-bold text-[18px]">T</span> : t.icon}
            </button>
          ))}
          <div className="w-8 h-px bg-[#2a2d45] my-1" />
          {hasSelection && (
            <button onClick={handleCopyLayers} className="w-11 h-11 flex items-center justify-center rounded-xl text-lg transition-all active:scale-90 text-gray-400 active:bg-[#252840]" title="Copy">📋</button>
          )}
          {hasCopied && (
            <button onClick={handlePasteLayers} className="w-11 h-11 flex items-center justify-center rounded-xl text-lg transition-all active:scale-90 text-gray-400 active:bg-[#252840]" title={`Paste (${copiedLayers.length})`}>📄</button>
          )}
          {hasSelection && (
            <button onClick={handleToggleLock} className={`w-11 h-11 flex items-center justify-center rounded-xl text-lg transition-all active:scale-90 ${anySelectedLocked ? 'text-yellow-500' : 'text-gray-400 active:bg-[#252840]'}`} title={anySelectedLocked ? 'Unlock' : 'Lock'}>
              {anySelectedLocked ? '🔒' : '🔓'}
            </button>
          )}
          {hasSelection && (
            <button onClick={handleDelete} className="w-11 h-11 flex items-center justify-center rounded-xl text-lg transition-all active:scale-90 text-red-400 active:bg-red-900/40" title="Delete">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                <line x1="10" y1="11" x2="10" y2="17" /><line x1="14" y1="11" x2="14" y2="17" />
              </svg>
            </button>
          )}
          {/* Delete selection */}
          {selection && (
            <button onClick={handleDeleteSelection} className="w-11 h-11 flex flex-col items-center justify-center rounded-xl text-[10px] transition-all active:scale-90 text-orange-400 active:bg-orange-900/40" title="Delete Selection">
              <span className="text-lg">✂</span>
              <span className="text-[8px]">Cut</span>
            </button>
          )}
          {/* Clear selection */}
          {selection && (
            <button onClick={() => setSelection(null)} className="w-11 h-11 flex items-center justify-center rounded-xl text-sm transition-all active:scale-90 text-gray-400 active:bg-[#252840]" title="Clear Selection">
              ✕
            </button>
          )}
          {/* Paste selection */}
          {clipboardCanvas && (
            <button onClick={handlePasteSelection} className="w-11 h-11 flex flex-col items-center justify-center rounded-xl text-[10px] transition-all active:scale-90 text-green-400 active:bg-green-900/40" title="Paste Selection">
              <span className="text-lg">📋</span>
              <span className="text-[8px]">Paste</span>
            </button>
          )}
          {/* Group / Ungroup */}
          {selectedLayerIds.length > 1 && (
            <button onClick={handleGroupSelected} className="w-11 h-11 flex items-center justify-center rounded-xl text-sm transition-all active:scale-90 text-green-400 active:bg-green-900/40" title="Group">⊞</button>
          )}
          {selectedLayer?.groupId && (
            <button onClick={handleUngroupSelected} className="w-11 h-11 flex items-center justify-center rounded-xl text-sm transition-all active:scale-90 text-gray-400 active:bg-[#252840]" title="Ungroup">⊟</button>
          )}
          {selectedLayer?.groupId && (
            <button onClick={handleExportGroup} className="w-11 h-11 flex flex-col items-center justify-center rounded-xl text-[10px] transition-all active:scale-90 text-purple-400 active:bg-purple-900/40" title="Export Group">
              <span className="text-sm">📦</span>
              <span className="text-[7px]">Export</span>
            </button>
          )}
          {selectedLayerIds.length > 1 && (
            <div className="text-[9px] text-[#4f7cff] font-medium leading-tight text-center px-1">{selectedLayerIds.length}</div>
          )}
          <div className="flex-1" />
          {isDrawingTool && (
            <button onClick={() => setShowBrushPanel(v => !v)} className="w-11 h-11 flex items-center justify-center rounded-xl active:bg-[#252840]">
              <div className="rounded-full border border-gray-500" style={{
                width: Math.min(36, Math.max(4, brushSettings.size * 0.5)),
                height: Math.min(36, Math.max(4, brushSettings.size * 0.5)),
                backgroundColor: tool === 'brush' ? brushSettings.color : 'transparent',
                opacity: brushSettings.opacity,
              }} />
            </button>
          )}
        </div>

        {/* Brush settings floating panel */}
        {showBrushPanel && isDrawingTool && (
          <div className="absolute left-16 top-2 z-30 bg-[#1a1c2e] border border-[#2a2d45] rounded-xl p-3 shadow-2xl shadow-black/50 w-52"
            onTouchStart={e => e.stopPropagation()} onTouchMove={e => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-2">
              <span className="text-[12px] text-gray-300 font-medium">{tool === 'brush' ? '🖌 Brush' : '⌫ Eraser'} Settings</span>
              <button onClick={() => setShowBrushPanel(false)} className="text-gray-500 active:text-gray-200 text-sm w-6 h-6 flex items-center justify-center">✕</button>
            </div>
            <div className="space-y-3">
              <div>
                <div className="flex justify-between text-[11px] mb-0.5"><span className="text-gray-400">Size</span><span className="text-gray-500">{brushSettings.size}px</span></div>
                <input type="range" min="1" max="200" value={brushSettings.size} onChange={e => setBrushSettings(s => ({ ...s, size: +e.target.value }))} style={{ touchAction: 'none' }} />
              </div>
              {tool === 'brush' && (
                <div><div className="text-[11px] text-gray-400 mb-1">Color</div>
                  <input type="color" value={brushSettings.color} onChange={e => setBrushSettings(s => ({ ...s, color: e.target.value }))} className="w-full h-10 rounded-lg cursor-pointer border border-[#2a2d45] bg-transparent" />
                </div>
              )}
              <div>
                <div className="flex justify-between text-[11px] mb-0.5"><span className="text-gray-400">Opacity</span><span className="text-gray-500">{Math.round(brushSettings.opacity * 100)}%</span></div>
                <input type="range" min="0.05" max="1" step="0.05" value={brushSettings.opacity} onChange={e => setBrushSettings(s => ({ ...s, opacity: +e.target.value }))} style={{ touchAction: 'none' }} />
              </div>
            </div>
          </div>
        )}

        {/* Magic Wand floating panel */}
        {showMagicWandPanel && tool === 'magicWand' && (
          <div className="absolute left-16 top-2 z-30 bg-[#1a1c2e] border border-[#2a2d45] rounded-xl p-3 shadow-2xl shadow-black/50 w-52"
            onTouchStart={e => e.stopPropagation()} onTouchMove={e => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-2">
              <span className="text-[12px] text-gray-300 font-medium">🪄 Magic Wand</span>
              <button onClick={() => setShowMagicWandPanel(false)} className="text-gray-500 active:text-gray-200 text-sm w-6 h-6 flex items-center justify-center">✕</button>
            </div>
            <div className="space-y-3">
              <div>
                <div className="flex justify-between text-[11px] mb-0.5"><span className="text-gray-400">Threshold</span><span className="text-gray-500">{magicWandThreshold}</span></div>
                <input type="range" min="1" max="100" value={magicWandThreshold} onChange={e => setMagicWandThreshold(+e.target.value)} style={{ touchAction: 'none' }} />
              </div>
              <div className="text-[10px] text-gray-500">Tap on image to remove area</div>
            </div>
          </div>
        )}

        {/* Text Tool floating panel */}
        {showTextPanel && tool === 'text' && (
          <div className="absolute left-16 top-2 z-30 bg-[#1a1c2e] border border-[#2a2d45] rounded-xl p-3 shadow-2xl shadow-black/50 w-60"
            onTouchStart={e => e.stopPropagation()} onTouchMove={e => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-2">
              <span className="text-[12px] text-gray-300 font-medium">✏️ Add Text</span>
              <button onClick={() => setShowTextPanel(false)} className="text-gray-500 active:text-gray-200 text-sm w-6 h-6 flex items-center justify-center">✕</button>
            </div>
            <div className="space-y-2.5">
              <textarea value={textInput} onChange={e => setTextInput(e.target.value)} placeholder="Enter text..."
                className="w-full bg-[#252840] border border-[#2a2d45] rounded-lg px-2 py-2 text-[13px] text-gray-200 focus:outline-none focus:border-[#4f7cff] resize-none h-16" />
              <div>
                <div className="flex justify-between text-[11px] mb-0.5"><span className="text-gray-400">Font Size</span><span className="text-gray-500">{textFontSize}px</span></div>
                <input type="range" min="12" max="200" value={textFontSize} onChange={e => setTextFontSize(+e.target.value)} style={{ touchAction: 'none' }} />
              </div>
              <select value={textFontFamily} onChange={e => setTextFontFamily(e.target.value)}
                className="w-full bg-[#252840] border border-[#2a2d45] rounded-lg px-2 py-2 text-[12px] text-gray-300 focus:outline-none focus:border-[#4f7cff]">
                {FONTS.map(f => <option key={f} value={f} style={{ fontFamily: f }}>{f}</option>)}
              </select>
              <div><div className="text-[11px] text-gray-400 mb-1">Color</div>
                <input type="color" value={textColor} onChange={e => setTextColor(e.target.value)} className="w-full h-8 rounded-lg cursor-pointer border border-[#2a2d45] bg-transparent" />
              </div>
              <button onClick={addTextLayer} className="w-full py-2.5 bg-[#4f7cff] active:bg-[#3d6ae8] text-white text-[12px] font-medium rounded-lg transition-all active:scale-95">
                ➕ Add Text Layer
              </button>
            </div>
          </div>
        )}

        {/* Shape Tool floating panel */}
        {showShapePanel && tool === 'shape' && (
          <div className="absolute left-16 top-2 z-30 bg-[#1a1c2e] border border-[#2a2d45] rounded-xl p-3 shadow-2xl shadow-black/50 w-60"
            onTouchStart={e => e.stopPropagation()} onTouchMove={e => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-2">
              <span className="text-[12px] text-gray-300 font-medium">⬟ Add Shape</span>
              <button onClick={() => setShowShapePanel(false)} className="text-gray-500 active:text-gray-200 text-sm w-6 h-6 flex items-center justify-center">✕</button>
            </div>
            <div className="space-y-2.5">
              <div className="grid grid-cols-4 gap-1.5">
                {SHAPES.map(s => (
                  <button key={s.id} onClick={() => setShapeType(s.id)}
                    className={`py-2.5 text-xl rounded-lg transition-all active:scale-95 ${
                      shapeType === s.id ? 'bg-[#4f7cff] text-white ring-2 ring-[#4f7cff]' : 'bg-[#252840] text-gray-400'
                    }`}>
                    {s.icon}
                  </button>
                ))}
              </div>
              <div className="flex gap-2">
                <button onClick={() => setShapeFill(true)} className={`flex-1 py-2 text-[11px] rounded-lg ${shapeFill ? 'bg-[#4f7cff] text-white' : 'bg-[#252840] text-gray-400'}`}>Fill</button>
                <button onClick={() => setShapeFill(false)} className={`flex-1 py-2 text-[11px] rounded-lg ${!shapeFill ? 'bg-[#4f7cff] text-white' : 'bg-[#252840] text-gray-400'}`}>Stroke</button>
              </div>
              {!shapeFill && (
                <div>
                  <div className="flex justify-between text-[11px] mb-0.5"><span className="text-gray-400">Stroke Width</span><span className="text-gray-500">{shapeStrokeW}px</span></div>
                  <input type="range" min="1" max="20" value={shapeStrokeW} onChange={e => setShapeStrokeW(+e.target.value)} style={{ touchAction: 'none' }} />
                </div>
              )}
              <div>
                <div className="flex justify-between text-[11px] mb-0.5"><span className="text-gray-400">Size</span><span className="text-gray-500">{shapeSize}px</span></div>
                <input type="range" min="50" max="500" value={shapeSize} onChange={e => setShapeSize(+e.target.value)} style={{ touchAction: 'none' }} />
              </div>
              <div><div className="text-[11px] text-gray-400 mb-1">Color</div>
                <input type="color" value={shapeColor} onChange={e => setShapeColor(e.target.value)} className="w-full h-8 rounded-lg cursor-pointer border border-[#2a2d45] bg-transparent" />
              </div>
              <button onClick={addShapeLayer} className="w-full py-2.5 bg-[#4f7cff] active:bg-[#3d6ae8] text-white text-[12px] font-medium rounded-lg transition-all active:scale-95">
                ➕ Add Shape Layer
              </button>
            </div>
          </div>
        )}

        {/* Pen Tool floating panel */}
        {showPenPanel && tool === 'pen' && (
          <div className="absolute left-16 top-2 z-30 bg-[#1a1c2e] border border-[#2a2d45] rounded-xl p-3 shadow-2xl shadow-black/50 w-52"
            onTouchStart={e => e.stopPropagation()} onTouchMove={e => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-2">
              <span className="text-[12px] text-gray-300 font-medium">✒ Pen Tool</span>
              <button onClick={() => setShowPenPanel(false)} className="text-gray-500 active:text-gray-200 text-sm w-6 h-6 flex items-center justify-center">✕</button>
            </div>
            <div className="space-y-2.5">
              <div>
                <div className="flex justify-between text-[11px] mb-0.5"><span className="text-gray-400">Width</span><span className="text-gray-500">{penWidth}px</span></div>
                <input type="range" min="1" max="20" value={penWidth} onChange={e => setPenWidth(+e.target.value)} style={{ touchAction: 'none' }} />
              </div>
              <div><div className="text-[11px] text-gray-400 mb-1">Color</div>
                <input type="color" value={penColor} onChange={e => setPenColor(e.target.value)} className="w-full h-8 rounded-lg cursor-pointer border border-[#2a2d45] bg-transparent" />
              </div>
              <div className="flex gap-2">
                <button onClick={() => setPenFill(f => !f)} className={`flex-1 py-2 text-[11px] rounded-lg ${penFill ? 'bg-[#4f7cff] text-white' : 'bg-[#252840] text-gray-400'}`}>
                  Fill Path
                </button>
              </div>
              <div className="text-[10px] text-gray-500">{penPoints.length} points · Tap canvas to add</div>
              <div className="flex gap-1 mb-1">
                <button onClick={() => {
                  if (penHistory.length > 0) {
                    setPenFuture(f => [...f, penPoints]);
                    const prev = penHistory[penHistory.length - 1];
                    setPenHistory(h => h.slice(0, -1));
                    setPenPoints(prev);
                  }
                }} disabled={penHistory.length === 0}
                  className={`flex-1 py-1.5 text-[11px] rounded-lg ${penHistory.length > 0 ? 'bg-[#252840] text-gray-300 active:bg-[#4f7cff]' : 'bg-[#1a1c2e] text-gray-600 cursor-not-allowed'}`}>
                  ↩ {penHistory.length}
                </button>
                <button onClick={() => {
                  if (penFuture.length > 0) {
                    setPenHistory(h => [...h, penPoints]);
                    const next = penFuture[penFuture.length - 1];
                    setPenFuture(f => f.slice(0, -1));
                    setPenPoints(next);
                  }
                }} disabled={penFuture.length === 0}
                  className={`flex-1 py-1.5 text-[11px] rounded-lg ${penFuture.length > 0 ? 'bg-[#252840] text-gray-300 active:bg-[#4f7cff]' : 'bg-[#1a1c2e] text-gray-600 cursor-not-allowed'}`}>
                  ↪ {penFuture.length}
                </button>
              </div>
              <div className="flex gap-2">
                <button onClick={handleAddPenLayer} disabled={penPoints.length < 2}
                  className={`flex-1 py-2.5 text-[12px] font-medium rounded-lg transition-all active:scale-95 ${penPoints.length >= 2 ? 'bg-[#4f7cff] text-white' : 'bg-[#252840] text-gray-600 cursor-not-allowed'}`}>
                  ✓ Add Layer
                </button>
                <button onClick={() => setPenPoints([])} className="flex-1 py-2.5 bg-[#252840] active:bg-[#2a2d45] text-gray-400 text-[12px] rounded-lg transition-colors active:scale-95">
                  Clear
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Canvas */}
        <CanvasView
          layers={layers} selectedLayerId={selectedLayerId} selectedLayerIds={selectedLayerIds}
          showBorders={showBorders} tool={tool} brushSettings={brushSettings}
          viewport={viewport} onViewportChange={setViewport} onLayerSelect={handleLayerSelect}
          onLayerUpdate={updateLayer} onDrop={handleDrop} onBeforeStroke={handleBeforeStroke}
          onAfterStroke={handleAfterStroke} onBoxSelect={handleBoxSelect}
          onBackgroundTap={handleBackgroundTap} onLayerRetap={handleLayerRetap}
          onMagicWand={handleMagicWand} magicWandThreshold={magicWandThreshold}
          selection={selection} onSelectionChange={setSelection}
          penPoints={penPoints} onPenPointAdd={(pt: [number, number]) => {
            // Save pen history for undo
            setPenHistory(h => { const nh = [...h, penPoints]; if (nh.length > 15) nh.shift(); return nh; });
            setPenFuture([]);
            setPenPoints(p => [...p, pt]);
          }}
        />

        {/* Panel drag handle */}
        <div className="w-4 bg-[#1a1c2e]/80 cursor-col-resize flex items-center justify-center shrink-0 z-10 border-l border-[#2a2d45] active:bg-[#252840] transition-colors"
          onTouchStart={handlePanelDragStart} onMouseDown={handlePanelDragStart} style={{ touchAction: 'none' }}>
          <div className="flex flex-col gap-1.5">
            {[0,1,2,3,4].map(i => <div key={i} className="w-1 h-1 rounded-full bg-[#3a3d55]" />)}
          </div>
        </div>

        {/* Right Panel */}
        <RightPanel
          layers={layers} selectedLayer={selectedLayer} selectedLayerId={selectedLayerId}
          selectedLayerIds={selectedLayerIds} onLayerSelect={handleLayerSelect}
          onLayerUpdate={updateLayer} onLayerDuplicate={duplicateLayer}
          onLayerReorder={moveLayerOrder} onFlipLayer={flipLayer}
          onUpdateFilters={updateLayerFilters} onExport={handleExport}
          onExportSingle={handleExportSingle} onUndo={handleUndo} onRedo={handleRedo}
          undoCount={undoCount} redoCount={redoCount} panelWidth={panelWidth}
          collapsed={panelCollapsed}
          onReRenderText={reRenderTextLayer} onReRenderShape={reRenderShapeLayer}
          onBoolean={handleBoolean}
          onGroupSelected={handleGroupSelected} onUngroupSelected={handleUngroupSelected}
          onExportGroup={handleExportGroup}
          onClearAll={handleClearAll}
          onMultiUpdateFilters={updateMultiLayerFilters}
          onToggleWarpMesh={handleToggleWarpMesh}
          onResetWarpMesh={handleResetWarpMesh}
        />
      </div>

      <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={handleFileChange} />
    </div>
  );
}
