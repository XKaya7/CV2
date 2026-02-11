export interface LayerFilters {
  lineArt: boolean;
  lineArtBlend: number;
  lineArtThreshold: number;
  lineArtColorBlend: number;
  findEdges: boolean;
  findEdgesBlend: number;
  findEdgesStrength: number;
  // Blur — remade with types
  blurType: number;           // 0=off, 1=gaussian, 2=box, 3=motion, 4=radial
  blurRadius: number;         // 0-200
  blurAngle: number;          // motion blur angle 0-360
  // Noise — remade with types
  noiseType: number;          // 0=off, 1=gaussian, 2=film grain, 3=color, 4=mono
  noiseAmount: number;        // 0-100
  noiseDensity: number;       // 0-100 (% of pixels affected)
  posterize: number;
  brightness: number;
  contrast: number;
  invert: boolean;
  // Manga / Levels
  levels: boolean;
  levelsBlack: number;
  levelsWhite: number;
  levelsGamma: number;
  levelsMono: boolean;
  // Halftone (manga dots)
  halftone: boolean;
  halftoneSize: number;
  halftoneAngle: number;
  halftoneColorMode: number; // 0=bw, 1=color dots
  halftoneColorBlend: number; // 0-1 original color overlay
  halftoneBlendMode: number; // 0=normal, 1=overlay, 2=multiply, 3=darken
  // Hue / Color tone
  hueShift: number;
  saturation: number;
  colorTempShift: number;
  // Advanced posterize art
  posterizeStyle: number;
  posterizeColorShift: number;
  // Frosted glass
  frostedGlass: boolean;
  frostedGlassAmount: number;
  // Stroke (inner/outer)
  strokeEnabled: boolean;
  strokeColor: string;
  strokeWidth: number;
  strokeInner: boolean;
  strokeOuter: boolean;
  // Game feel
  gameFilter: number;
  gameFilterIntensity: number;
  // Facet / Block filter
  facetFilter: number; // 0=off, 1=rect, 2=triangle, 3=voronoi, 4=diamond
  facetSize: number;
  // Oil Paint
  oilPaint: boolean;
  oilPaintRadius: number;
  oilPaintLevels: number;
  // Metal
  metalFilter: boolean;
  metalIntensity: number;
  // Palette Knife
  paletteKnife: boolean;
  paletteKnifeLength: number;
  paletteKnifeDirection: number;
  // Color Separation
  colorSepEnabled: boolean;
  colorSepR: number;   // 2-32
  colorSepG: number;   // 2-32
  colorSepB: number;   // 2-32
  colorSepMix: number; // 0-1
  // Texture / Brush filter
  textureFilter: number; // 0=off,1=canvas,2=watercolor,3=crayon,4=impasto,5=crosshatch,6=stipple
  textureIntensity: number; // 0.1–2.0
  // Gradient/Fade transparency
  gradientFade: boolean;
  gradientFadeDirection: number; // 0=left,1=right,2=top,3=bottom,4=center
  gradientFadeAmount: number; // 0-100
  // Color channel hue shifts (red-green, yellow-blue, pink-cyan)
  channelShiftRG: number; // -100 to 100 red-green axis
  channelShiftYB: number; // -100 to 100 yellow-blue axis
  channelShiftPC: number; // -100 to 100 pink-cyan axis
}

export const defaultFilters: LayerFilters = {
  lineArt: false,
  lineArtBlend: 0.5,
  lineArtThreshold: 50,
  lineArtColorBlend: 0,
  findEdges: false,
  findEdgesBlend: 0.5,
  findEdgesStrength: 1,
  blurType: 0,
  blurRadius: 0,
  blurAngle: 0,
  noiseType: 0,
  noiseAmount: 0,
  noiseDensity: 100,
  posterize: 0,
  brightness: 0,
  contrast: 0,
  invert: false,
  levels: false,
  levelsBlack: 0,
  levelsWhite: 255,
  levelsGamma: 1.0,
  levelsMono: false,
  halftone: false,
  halftoneSize: 6,
  halftoneAngle: 45,
  halftoneColorMode: 0,
  halftoneColorBlend: 0,
  halftoneBlendMode: 0,
  hueShift: 0,
  saturation: 0,
  colorTempShift: 0,
  posterizeStyle: 0,
  posterizeColorShift: 0,
  frostedGlass: false,
  frostedGlassAmount: 8,
  strokeEnabled: false,
  strokeColor: '#000000',
  strokeWidth: 3,
  strokeInner: false,
  strokeOuter: true,
  gameFilter: 0,
  gameFilterIntensity: 1.0,
  facetFilter: 0,
  facetSize: 15,
  oilPaint: false,
  oilPaintRadius: 4,
  oilPaintLevels: 20,
  metalFilter: false,
  metalIntensity: 1.0,
  paletteKnife: false,
  paletteKnifeLength: 20,
  paletteKnifeDirection: 45,
  colorSepEnabled: false,
  colorSepR: 8,
  colorSepG: 8,
  colorSepB: 8,
  colorSepMix: 1.0,
  textureFilter: 0,
  textureIntensity: 1.0,
  gradientFade: false,
  gradientFadeDirection: 0,
  gradientFadeAmount: 50,
  channelShiftRG: 0,
  channelShiftYB: 0,
  channelShiftPC: 0,
};

export interface PaintedBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export type BlendMode = 'source-over' | 'multiply' | 'screen' | 'overlay' | 'darken' | 'lighten' | 'color-dodge' | 'color-burn' | 'hard-light' | 'soft-light' | 'difference' | 'exclusion' | 'hue' | 'saturation' | 'color' | 'luminosity';

export interface Layer {
  id: string;
  name: string;
  type: 'image' | 'drawing' | 'text' | 'shape';
  visible: boolean;
  locked: boolean;
  opacity: number;
  blendMode: BlendMode;
  x: number;
  y: number;
  width: number;
  height: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
  flipH: boolean;
  flipV: boolean;
  image?: HTMLImageElement;
  thumbUrl?: string;
  drawingCanvas?: HTMLCanvasElement;
  filteredCanvas?: HTMLCanvasElement;
  filters: LayerFilters;
  // Layer saturation (0-200, default 100)
  layerSaturation: number;
  // Global hue rotation (applied after all filters)
  globalHueRotate: number; // -180 to 180
  // Text layer fields
  text?: string;
  fontSize?: number;
  fontFamily?: string;
  textColor?: string;
  // Shape layer fields
  shapeType?: string; // 'circle'|'square'|'triangle'|'star'|'heart'|'diamond'|'arrow'|'hexagon'
  shapeColor?: string;
  shapeFill?: boolean;
  shapeStrokeWidth?: number;
  // Drawing layer specifics
  paintedBounds?: PaintedBounds;
  outlineCanvas?: HTMLCanvasElement;
  // Magic wand cutout support
  sourceCanvas?: HTMLCanvasElement;   // wand-edited source (with alpha holes)
  cropBounds?: { x: number; y: number; w: number; h: number }; // tight opaque bbox
  wandHistory?: HTMLCanvasElement[];  // undo stack for wand operations
  wandFuture?: HTMLCanvasElement[];   // redo stack for wand operations
  selectionHistory?: HTMLCanvasElement[];
  selectionFuture?: HTMLCanvasElement[];
  groupId?: string; // group identifier
  // Warp mesh grid
  warpMesh?: { rows: number; cols: number; points: { x: number; y: number }[] };
}

export type Tool = 'select' | 'brush' | 'pan' | 'eraser' | 'magicWand' | 'text' | 'shape' | 'rectSelect' | 'lassoSelect' | 'pen';

export interface SelectionData {
  layerId: string;
  type: 'rect' | 'lasso' | 'wand';
  // rect selection in layer-local pixel coords
  rect?: { x: number; y: number; w: number; h: number };
  // lasso points in layer-local pixel coords
  path?: [number, number][];
  // wand mask (same size as layer source)
  mask?: Uint8Array;
  maskW?: number;
  maskH?: number;
}

export interface BrushSettings {
  size: number;
  color: string;
  opacity: number;
}

export interface Viewport {
  panX: number;
  panY: number;
  zoom: number;
}
