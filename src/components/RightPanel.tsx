import React, { useState, useRef, useCallback, useEffect } from 'react';
import type { Layer, LayerFilters, BlendMode } from '../types';

const SNAP_SCALES = [
  0.05, 0.10, 0.15, 0.20, 0.25, 0.33, 0.40, 0.50,
  0.60, 0.67, 0.75, 0.80, 0.90, 1.0,
  1.25, 1.50, 1.75, 2.0, 2.5, 3.0, 4.0, 5.0
];

function findNearestSnapScale(current: number): number {
  let best = SNAP_SCALES[0];
  let bestDist = Math.abs(current - best);
  for (let i = 1; i < SNAP_SCALES.length; i++) {
    const dist = Math.abs(current - SNAP_SCALES[i]);
    if (dist < bestDist) {
      best = SNAP_SCALES[i];
      bestDist = dist;
    }
  }
  return best;
}

interface RightPanelProps {
  layers: Layer[];
  selectedLayer: Layer | null;
  selectedLayerId: string | null;
  selectedLayerIds: string[];
  onLayerSelect: (id: string | null) => void;
  onLayerUpdate: (id: string, updates: Partial<Layer>) => void;
  onLayerDuplicate: (id: string) => void;
  onLayerReorder: (id: string, dir: 'up' | 'down' | 'top' | 'bottom') => void;
  onFlipLayer: (id: string, axis: 'h' | 'v') => void;
  onUpdateFilters: (id: string, filters: Partial<LayerFilters>, preview?: boolean) => void;
  onExport: () => void;
  onExportSingle: (id: string) => void;
  onUndo: () => void;
  onRedo: () => void;
  undoCount: number;
  redoCount: number;
  panelWidth: number;
  collapsed: boolean;
  onReRenderText?: (id: string, updates: Partial<Layer>) => void;
  onReRenderShape?: (id: string, updates: Partial<Layer>) => void;
  onBoolean?: (op: 'union' | 'subtract' | 'intersect' | 'exclude') => void;
  onGroupSelected?: () => void;
  onUngroupSelected?: () => void;
  onExportGroup?: () => void;
  onClearAll?: () => void;
  onMultiUpdateFilters?: (filters: Partial<LayerFilters>, preview?: boolean) => void;
  onToggleWarpMesh?: (id: string) => void;
  onResetWarpMesh?: (id: string) => void;
}

// Smooth slider — local state for instant feedback
const SmoothSlider: React.FC<{
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  displayFn?: (v: number) => string;
}> = React.memo(({ label, value, min, max, step = 1, onChange, displayFn }) => {
  const [localVal, setLocalVal] = useState(value);
  const dragging = useRef(false);
  const raf = useRef(0);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!dragging.current) setLocalVal(value);
  }, [value]);

  const handleInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const v = Number(e.target.value);
    setLocalVal(v);
    dragging.current = true;
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(() => {
      onChangeRef.current(v);
    });
  }, []);

  const handleEnd = useCallback(() => {
    dragging.current = false;
  }, []);

  return (
    <div className="space-y-0.5">
      <div className="flex justify-between text-[11px]">
        <span className="text-gray-400">{label}</span>
        <span className="text-gray-500 tabular-nums">
          {displayFn ? displayFn(localVal) : `${localVal}`}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={localVal}
        onChange={handleInput}
        onMouseUp={handleEnd}
        onTouchEnd={handleEnd}
        onPointerUp={handleEnd}
        style={{ touchAction: 'none' }}
      />
    </div>
  );
});

// Debounced slider for expensive filter ops
const DebouncedSlider: React.FC<{
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  onChangeEnd?: (v: number) => void;
  displayFn?: (v: number) => string;
}> = React.memo(({ label, value, min, max, step = 1, onChange, onChangeEnd, displayFn }) => {
  const [localVal, setLocalVal] = useState(value);
  const dragging = useRef(false);
  const raf = useRef(0);
  const localRef = useRef(localVal);
  localRef.current = localVal;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onChangeEndRef = useRef(onChangeEnd);
  onChangeEndRef.current = onChangeEnd;

  useEffect(() => {
    if (!dragging.current) setLocalVal(value);
  }, [value]);

  const handleInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const v = Number(e.target.value);
    setLocalVal(v);
    dragging.current = true;
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(() => {
      onChangeRef.current(v);
    });
  }, []);

  const handleEnd = useCallback(() => {
    dragging.current = false;
    cancelAnimationFrame(raf.current);
    onChangeEndRef.current?.(localRef.current);
  }, []);

  return (
    <div className="space-y-0.5">
      <div className="flex justify-between text-[11px]">
        <span className="text-gray-400">{label}</span>
        <span className="text-gray-500 tabular-nums">
          {displayFn ? displayFn(localVal) : `${localVal}`}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={localVal}
        onChange={handleInput}
        onMouseUp={handleEnd}
        onTouchEnd={handleEnd}
        onPointerUp={handleEnd}
        style={{ touchAction: 'none' }}
      />
    </div>
  );
});

const ToggleSwitch: React.FC<{
  label: string;
  icon: string;
  checked: boolean;
  onToggle: () => void;
}> = ({ label, icon, checked, onToggle }) => (
  <div className="flex items-center justify-between">
    <span className="text-[12px] text-gray-300 font-medium">{icon} {label}</span>
    <button
      onClick={onToggle}
      className={`w-11 h-6 rounded-full transition-colors relative ${
        checked ? 'bg-[#4f7cff]' : 'bg-[#2a2d45]'
      }`}
    >
      <div
        className={`w-4.5 h-4.5 bg-white rounded-full absolute top-[3px] transition-transform ${
          checked ? 'translate-x-[22px]' : 'translate-x-[3px]'
        }`}
      />
    </button>
  </div>
);

export const RightPanel: React.FC<RightPanelProps> = ({
  layers,
  selectedLayer,
  selectedLayerId,
  selectedLayerIds,
  onLayerSelect,
  onLayerUpdate,
  onLayerDuplicate,
  onLayerReorder,
  onFlipLayer,
  onUpdateFilters,
  onExport,
  onExportSingle,
  onUndo,
  onRedo,
  undoCount,
  redoCount,
  panelWidth,
  collapsed,
  onReRenderText,
  onReRenderShape,
  onBoolean,
  onGroupSelected: _onGroupSelected,
  onUngroupSelected: _onUngroupSelected,
  onExportGroup: _onExportGroup,
  onClearAll,
  onMultiUpdateFilters,
  onToggleWarpMesh,
  onResetWarpMesh,
}) => {
  // Suppress unused warnings - these are handled in left toolbar
  void _onGroupSelected; void _onUngroupSelected; void _onExportGroup;
  const [activeTab, setActiveTab] = useState<'layers' | 'filters'>('layers');
  const [layersExpanded, setLayersExpanded] = useState(true);
  const [layerListHeight, setLayerListHeight] = useState(220);
  const layerListRef = useRef<HTMLDivElement>(null);
  const layerDragActive = useRef(false);
  const layerDrag = useRef({ active: false, startY: 0, startH: 0 });

  // Sync height to DOM — only when not actively dragging
  useEffect(() => {
    if (layerListRef.current && !layerDragActive.current) {
      layerListRef.current.style.maxHeight = layerListHeight + 'px';
    }
  }, [layerListHeight, layersExpanded]);

  if (collapsed) return null;

  const snapTarget = selectedLayer
    ? findNearestSnapScale((selectedLayer.scaleX + selectedLayer.scaleY) / 2)
    : 1;
  const snapPct = Math.round(snapTarget * 100);
  const currentAvgPct = selectedLayer
    ? Math.round(((selectedLayer.scaleX + selectedLayer.scaleY) / 2) * 100)
    : 100;
  const isAlreadySnapped = snapPct === currentAvgPct;
  const multiCount = selectedLayerIds.length;

  // Layer list height drag handler — pure DOM, zero React re-renders during drag
  const handleLayerDragStart = (e: React.TouchEvent | React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const clientY = 'touches' in e ? e.touches[0].clientY : (e as React.MouseEvent).clientY;
    const startH = layerListRef.current?.offsetHeight ?? layerListHeight;
    layerDrag.current = { active: true, startY: clientY, startH };
    layerDragActive.current = true;

    let latestCY = clientY;
    let rafPending = false;

    const doUpdate = () => {
      rafPending = false;
      if (!layerDragActive.current) return;
      const dy = latestCY - layerDrag.current.startY;
      const newH = Math.max(60, Math.min(500, layerDrag.current.startH + dy));
      if (layerListRef.current) {
        layerListRef.current.style.maxHeight = newH + 'px';
      }
    };

    const onMove = (ev: TouchEvent | MouseEvent) => {
      ev.preventDefault();
      ev.stopPropagation();
      if ('touches' in ev) {
        latestCY = (ev as TouchEvent).touches[0].clientY;
      } else {
        latestCY = (ev as MouseEvent).clientY;
      }
      if (!rafPending) {
        rafPending = true;
        requestAnimationFrame(doUpdate);
      }
    };

    const onEnd = (ev: TouchEvent | MouseEvent) => {
      ev.preventDefault();
      ev.stopPropagation();
      layerDrag.current.active = false;
      layerDragActive.current = false;
      // Sync React state once at end
      if (layerListRef.current) {
        setLayerListHeight(layerListRef.current.offsetHeight);
      }
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('touchend', onEnd);
      document.removeEventListener('touchcancel', onEnd);
      document.removeEventListener('mouseup', onEnd);
    };

    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('mousemove', onMove);
    document.addEventListener('touchend', onEnd, { passive: false });
    document.addEventListener('touchcancel', onEnd, { passive: false });
    document.addEventListener('mouseup', onEnd);
  };

  return (
    <div
      className="bg-[#1a1c2e] border-l border-[#2a2d45] flex flex-col shrink-0 overflow-hidden"
      style={{ width: panelWidth, maxWidth: '85vw' }}
      onTouchStart={e => e.stopPropagation()}
      onTouchMove={e => e.stopPropagation()}
      onTouchEnd={e => e.stopPropagation()}
    >
      {/* Tabs */}
      <div className="flex items-center border-b border-[#2a2d45] shrink-0">
        <button
          onClick={() => setActiveTab('layers')}
          className={`flex-1 py-3 text-xs font-medium transition-colors ${
            activeTab === 'layers'
              ? 'text-[#4f7cff] border-b-2 border-[#4f7cff]'
              : 'text-gray-400 active:text-gray-200'
          }`}
        >
          Layers {multiCount > 1 ? `(${multiCount})` : ''}
        </button>
        <button
          onClick={() => setActiveTab('filters')}
          className={`flex-1 py-3 text-xs font-medium transition-colors ${
            activeTab === 'filters'
              ? 'text-[#4f7cff] border-b-2 border-[#4f7cff]'
              : 'text-gray-400 active:text-gray-200'
          }`}
        >
          Filters
        </button>
      </div>

      <div className="flex-1 overflow-y-auto overscroll-contain">
        {activeTab === 'layers' && (
          <div className="p-2 space-y-1">
            {/* Multi-select badge */}
            {multiCount > 1 && (
              <div className="bg-[#4f7cff]/15 border border-[#4f7cff]/30 rounded-lg px-3 py-2 mb-2">
                <div className="text-[12px] text-[#4f7cff] font-medium">
                  ✦ {multiCount} layers selected
                </div>
                <div className="text-[10px] text-gray-400 mt-0.5">
                  Drag to move all · Use 🗑 in toolbar to delete
                </div>
              </div>
            )}

            {/* Collapsible Layers Header */}
            <button
              onClick={() => setLayersExpanded(v => !v)}
              className="w-full flex items-center justify-between px-2 py-2 text-[12px] font-medium text-gray-300 active:bg-[#252840] rounded-lg transition-colors"
            >
              <span className="flex items-center gap-1.5">
                <span className="text-sm">{layersExpanded ? '▼' : '▶'}</span>
                Layers ({layers.length})
              </span>
            </button>

            {/* Layer list with drag-resizable height */}
            {layersExpanded && (
              <>
                <div
                  ref={layerListRef}
                  className="overflow-y-auto overscroll-contain space-y-1 pr-0.5"
                  style={{ minHeight: 60 }}
                >
                  {[...layers].reverse().map(layer => {
                    const isSel = selectedLayerIds.includes(layer.id);
                    const isPrimary = selectedLayerId === layer.id;
                    return (
                      <div
                        key={layer.id}
                        onClick={() => onLayerSelect(layer.id)}
                        className={`flex items-center gap-2 p-2.5 rounded-lg cursor-pointer transition-all active:scale-[0.98] ${
                          isPrimary
                            ? 'bg-[#4f7cff]/20 ring-1 ring-[#4f7cff]/40'
                            : isSel
                            ? 'bg-[#4f7cff]/10 ring-1 ring-[#4f7cff]/20'
                            : 'active:bg-[#252840]'
                        }`}
                      >
                        <button
                          onClick={e => { e.stopPropagation(); onLayerUpdate(layer.id, { visible: !layer.visible }); }}
                          className={`text-sm w-7 h-7 flex items-center justify-center rounded transition-colors ${
                            layer.visible ? 'text-[#4f7cff]' : 'text-gray-600'
                          }`}
                        >
                          {layer.visible ? '👁' : '−'}
                        </button>

                        <div className="w-9 h-9 rounded bg-[#252840] flex-shrink-0 overflow-hidden border border-[#2a2d45]">
                          {(layer.type === 'image' || layer.type === 'text' || layer.type === 'shape') && layer.thumbUrl ? (
                            <img src={layer.thumbUrl} alt="" className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-[10px] text-gray-500">✏️</div>
                          )}
                        </div>

                        <div className="flex-1 min-w-0">
                          <div className="text-[12px] text-gray-300 truncate flex items-center gap-1">
                            {layer.groupId && <span className="text-[9px] bg-purple-900/40 text-purple-300 px-1 rounded">📦</span>}
                            {layer.name}
                          </div>
                          <div className="text-[10px] text-gray-500">
                            {layer.type === 'image' ? 'Image' : layer.type === 'text' ? 'Text' : layer.type === 'shape' ? 'Shape' : 'Drawing'} · {Math.round(layer.opacity * 100)}%
                          </div>
                        </div>

                        <button
                          onClick={e => { e.stopPropagation(); onLayerUpdate(layer.id, { locked: !layer.locked }); }}
                          className={`text-[11px] w-7 h-7 flex items-center justify-center transition-colors ${layer.locked ? 'text-yellow-500' : 'text-gray-600'}`}
                        >
                          {layer.locked ? '🔒' : '🔓'}
                        </button>
                      </div>
                    );
                  })}

                  {layers.length === 0 && (
                    <div className="text-center text-gray-500 text-xs py-6">No layers yet</div>
                  )}
                </div>

                {/* Drag handle to resize layer list */}
                <div
                  className="flex justify-center py-1 cursor-row-resize select-none active:bg-[#252840] rounded transition-colors"
                  onTouchStart={handleLayerDragStart}
                  onMouseDown={handleLayerDragStart}
                  style={{ touchAction: 'none' }}
                >
                  <div className="flex gap-1">
                    <div className="w-6 h-1 rounded-full bg-[#3a3d55]" />
                    <div className="w-6 h-1 rounded-full bg-[#3a3d55]" />
                  </div>
                </div>
              </>
            )}

            {/* Selected layer controls */}
            {selectedLayer && (
              <div className="mt-2 pt-2 border-t border-[#2a2d45] space-y-3 px-1">

                {/* Undo/Redo for drawing layers */}
                {selectedLayer.type === 'drawing' && (
                  <div className="flex gap-2">
                    <button
                      onClick={onUndo}
                      disabled={undoCount === 0}
                      className={`flex-1 py-2.5 text-[12px] rounded-lg transition-colors active:scale-95 flex items-center justify-center gap-1.5 ${
                        undoCount > 0
                          ? 'bg-[#252840] text-gray-300 active:bg-[#4f7cff]'
                          : 'bg-[#1e2035] text-gray-600 cursor-not-allowed'
                      }`}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M3 7v6h6" />
                        <path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13" />
                      </svg>
                      {undoCount > 0 ? `(${undoCount})` : ''}
                    </button>
                    <button
                      onClick={onRedo}
                      disabled={redoCount === 0}
                      className={`flex-1 py-2.5 text-[12px] rounded-lg transition-colors active:scale-95 flex items-center justify-center gap-1.5 ${
                        redoCount > 0
                          ? 'bg-[#252840] text-gray-300 active:bg-[#4f7cff]'
                          : 'bg-[#1e2035] text-gray-600 cursor-not-allowed'
                      }`}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21 7v6h-6" />
                        <path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3L21 13" />
                      </svg>
                      {redoCount > 0 ? `(${redoCount})` : ''}
                    </button>
                  </div>
                )}

                {/* Opacity slider — applies to all selected layers when multi-selected */}
                <SmoothSlider
                  label={multiCount > 1 ? `Opacity (${multiCount} layers)` : "Opacity"}
                  value={Math.round(selectedLayer.opacity * 100)}
                  min={0}
                  max={100}
                  onChange={v => {
                    // Apply to all selected layers
                    if (selectedLayerIds.length > 1) {
                      for (const lid of selectedLayerIds) {
                        onLayerUpdate(lid, { opacity: v / 100 });
                      }
                    } else {
                      onLayerUpdate(selectedLayer.id, { opacity: v / 100 });
                    }
                  }}
                  displayFn={v => `${v}%`}
                />

                {/* Saturation slider — applies to all selected layers when multi-selected */}
                <SmoothSlider
                  label={multiCount > 1 ? `🎨 Saturation (${multiCount})` : "🎨 Saturation"}
                  value={selectedLayer.layerSaturation ?? 100}
                  min={0}
                  max={200}
                  onChange={v => {
                    if (selectedLayerIds.length > 1) {
                      for (const lid of selectedLayerIds) {
                        onLayerUpdate(lid, { layerSaturation: v });
                      }
                    } else {
                      onLayerUpdate(selectedLayer.id, { layerSaturation: v });
                    }
                  }}
                  displayFn={v => v === 100 ? '100% (Normal)' : `${v}%`}
                />

                {/* Text layer editing */}
                {selectedLayer.type === 'text' && (
                  <div className="bg-[#252840] rounded-xl p-3 space-y-2">
                    <span className="text-[12px] text-gray-300 font-medium">✏️ Text Properties</span>
                    <div>
                      <div className="text-[11px] text-gray-400 mb-1">Content</div>
                      <textarea
                        value={selectedLayer.text || ''}
                        onChange={e => onReRenderText?.(selectedLayer.id, { text: e.target.value })}
                        className="w-full bg-[#1a1c2e] border border-[#2a2d45] rounded-lg px-2 py-2 text-[12px] text-gray-200 focus:outline-none focus:border-[#4f7cff] resize-none h-14"
                      />
                    </div>
                    <div>
                      <div className="flex justify-between text-[11px] mb-0.5">
                        <span className="text-gray-400">Font Size</span>
                        <span className="text-gray-500">{selectedLayer.fontSize || 64}px</span>
                      </div>
                      <input type="range" min="12" max="200" value={selectedLayer.fontSize || 64}
                        onChange={e => onReRenderText?.(selectedLayer.id, { fontSize: +e.target.value })}
                        style={{ touchAction: 'none' }} />
                    </div>
                    <div>
                      <div className="text-[11px] text-gray-400 mb-1">Font</div>
                      <select value={selectedLayer.fontFamily || 'Arial'}
                        onChange={e => onReRenderText?.(selectedLayer.id, { fontFamily: e.target.value })}
                        className="w-full bg-[#1a1c2e] border border-[#2a2d45] rounded-lg px-2 py-2 text-[12px] text-gray-300 focus:outline-none focus:border-[#4f7cff]">
                        {['Arial', 'Georgia', 'Courier New', 'Verdana', 'Impact', 'Comic Sans MS', 'Times New Roman', 'Trebuchet MS'].map(f =>
                          <option key={f} value={f}>{f}</option>
                        )}
                      </select>
                    </div>
                    <div>
                      <div className="text-[11px] text-gray-400 mb-1">Color</div>
                      <input type="color" value={selectedLayer.textColor || '#ffffff'}
                        onChange={e => onReRenderText?.(selectedLayer.id, { textColor: e.target.value })}
                        className="w-full h-8 rounded-lg cursor-pointer border border-[#2a2d45] bg-transparent" />
                    </div>
                  </div>
                )}

                {/* Shape layer editing */}
                {selectedLayer.type === 'shape' && (
                  <div className="bg-[#252840] rounded-xl p-3 space-y-2">
                    <span className="text-[12px] text-gray-300 font-medium">⬟ Shape Properties</span>
                    <div className="grid grid-cols-4 gap-1.5">
                      {[
                        { id: 'circle', icon: '●' }, { id: 'square', icon: '■' },
                        { id: 'triangle', icon: '▲' }, { id: 'star', icon: '★' },
                        { id: 'heart', icon: '♥' }, { id: 'diamond', icon: '◆' },
                        { id: 'arrow', icon: '⬆' }, { id: 'hexagon', icon: '⬡' },
                      ].map(s => (
                        <button key={s.id}
                          onClick={() => onReRenderShape?.(selectedLayer.id, { shapeType: s.id })}
                          className={`py-2 text-lg rounded-lg transition-all active:scale-95 ${
                            selectedLayer.shapeType === s.id ? 'bg-[#4f7cff] text-white' : 'bg-[#1a1c2e] text-gray-400'
                          }`}>{s.icon}</button>
                      ))}
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => onReRenderShape?.(selectedLayer.id, { shapeFill: true })}
                        className={`flex-1 py-2 text-[11px] rounded-lg ${selectedLayer.shapeFill !== false ? 'bg-[#4f7cff] text-white' : 'bg-[#1a1c2e] text-gray-400'}`}>Fill</button>
                      <button onClick={() => onReRenderShape?.(selectedLayer.id, { shapeFill: false })}
                        className={`flex-1 py-2 text-[11px] rounded-lg ${selectedLayer.shapeFill === false ? 'bg-[#4f7cff] text-white' : 'bg-[#1a1c2e] text-gray-400'}`}>Stroke</button>
                    </div>
                    <div>
                      <div className="text-[11px] text-gray-400 mb-1">Color</div>
                      <input type="color" value={selectedLayer.shapeColor || '#4f7cff'}
                        onChange={e => onReRenderShape?.(selectedLayer.id, { shapeColor: e.target.value })}
                        className="w-full h-8 rounded-lg cursor-pointer border border-[#2a2d45] bg-transparent" />
                    </div>
                  </div>
                )}

                {/* Boolean Operations — multi-select only */}
                {onBoolean && selectedLayerIds.length >= 2 && (
                  <div className="bg-[#252840] rounded-xl p-3 space-y-2">
                    <span className="text-[12px] text-gray-300 font-medium">🔲 Boolean Operations</span>
                    <div className="grid grid-cols-4 gap-1.5">
                      <button onClick={() => onBoolean('union')} className="py-2.5 text-[10px] rounded-lg bg-[#1a1c2e] text-gray-300 active:bg-[#4f7cff] active:text-white transition-all active:scale-95">∪ Union</button>
                      <button onClick={() => onBoolean('subtract')} className="py-2.5 text-[10px] rounded-lg bg-[#1a1c2e] text-gray-300 active:bg-[#4f7cff] active:text-white transition-all active:scale-95">− Sub</button>
                      <button onClick={() => onBoolean('intersect')} className="py-2.5 text-[10px] rounded-lg bg-[#1a1c2e] text-gray-300 active:bg-[#4f7cff] active:text-white transition-all active:scale-95">∩ Inter</button>
                      <button onClick={() => onBoolean('exclude')} className="py-2.5 text-[10px] rounded-lg bg-[#1a1c2e] text-gray-300 active:bg-[#4f7cff] active:text-white transition-all active:scale-95">⊕ Excl</button>
                    </div>
                  </div>
                )}

                {/* Blend Mode */}
                <div className="space-y-1">
                  <div className="text-[11px] text-gray-400">Blend Mode</div>
                  <select
                    value={selectedLayer.blendMode || 'source-over'}
                    onChange={e => onLayerUpdate(selectedLayer.id, { blendMode: e.target.value as BlendMode })}
                    className="w-full bg-[#252840] border border-[#2a2d45] rounded-lg px-2 py-2 text-[12px] text-gray-300 focus:outline-none focus:border-[#4f7cff] appearance-none cursor-pointer"
                  >
                    <option value="source-over">Normal</option>
                    <option value="multiply">Multiply</option>
                    <option value="screen">Screen</option>
                    <option value="overlay">Overlay</option>
                    <option value="darken">Darken</option>
                    <option value="lighten">Lighten</option>
                    <option value="color-dodge">Color Dodge</option>
                    <option value="color-burn">Color Burn</option>
                    <option value="hard-light">Hard Light</option>
                    <option value="soft-light">Soft Light</option>
                    <option value="difference">Difference</option>
                    <option value="exclusion">Exclusion</option>
                    <option value="hue">Hue</option>
                    <option value="saturation">Saturation</option>
                    <option value="color">Color</option>
                    <option value="luminosity">Luminosity</option>
                  </select>
                </div>

                {/* Global Hue Rotation — applies to all selected layers when multi-selected */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-gray-400">🎨 Hue Rotation {multiCount > 1 ? `(${multiCount})` : ''}</span>
                    {selectedLayer.globalHueRotate !== 0 && (
                      <button
                        onClick={() => {
                          if (selectedLayerIds.length > 1) {
                            for (const lid of selectedLayerIds) {
                              onLayerUpdate(lid, { globalHueRotate: 0 });
                            }
                          } else {
                            onLayerUpdate(selectedLayer.id, { globalHueRotate: 0 });
                          }
                        }}
                        className="text-[10px] px-1.5 py-0.5 rounded text-gray-400 active:text-white active:bg-[#4f7cff] transition-colors"
                      >
                        ↺ 0°
                      </button>
                    )}
                  </div>
                  <SmoothSlider
                    label=""
                    value={selectedLayer.globalHueRotate}
                    min={-180}
                    max={180}
                    onChange={v => {
                      if (selectedLayerIds.length > 1) {
                        for (const lid of selectedLayerIds) {
                          onLayerUpdate(lid, { globalHueRotate: v });
                        }
                      } else {
                        onLayerUpdate(selectedLayer.id, { globalHueRotate: v });
                      }
                    }}
                    displayFn={v => v === 0 ? '0°' : `${v > 0 ? '+' : ''}${v}°`}
                  />
                </div>

                {/* Rotation — applies to all selected layers when multi-selected */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-gray-400">Rotation {multiCount > 1 ? `(${multiCount})` : ''}</span>
                    <button
                      onClick={() => {
                        if (selectedLayerIds.length > 1) {
                          for (const lid of selectedLayerIds) {
                            onLayerUpdate(lid, { rotation: 0 });
                          }
                        } else {
                          onLayerUpdate(selectedLayer.id, { rotation: 0 });
                        }
                      }}
                      className={`text-[10px] px-1.5 py-0.5 rounded transition-colors ${
                        selectedLayer.rotation === 0 ? 'text-gray-600' : 'text-gray-400 active:text-white active:bg-[#4f7cff]'
                      }`}
                    >
                      ↺ 0°
                    </button>
                  </div>
                  <SmoothSlider
                    label=""
                    value={Math.round((selectedLayer.rotation * 180) / Math.PI)}
                    min={-180}
                    max={180}
                    onChange={v => {
                      if (selectedLayerIds.length > 1) {
                        for (const lid of selectedLayerIds) {
                          onLayerUpdate(lid, { rotation: (v * Math.PI) / 180 });
                        }
                      } else {
                        onLayerUpdate(selectedLayer.id, { rotation: (v * Math.PI) / 180 });
                      }
                    }}
                    displayFn={v => `${v}°`}
                  />
                  <div className="flex gap-1.5">
                    {[0, 90, 180, -90].map(deg => (
                      <button
                        key={deg}
                        onClick={() => {
                          if (selectedLayerIds.length > 1) {
                            for (const lid of selectedLayerIds) {
                              onLayerUpdate(lid, { rotation: (deg * Math.PI) / 180 });
                            }
                          } else {
                            onLayerUpdate(selectedLayer.id, { rotation: (deg * Math.PI) / 180 });
                          }
                        }}
                        className={`flex-1 py-1.5 text-[10px] rounded-lg transition-all active:scale-95 ${
                          Math.round((selectedLayer.rotation * 180) / Math.PI) === deg
                            ? 'bg-[#4f7cff]/20 text-[#4f7cff] ring-1 ring-[#4f7cff]/40'
                            : 'bg-[#1a1c2e] text-gray-500 active:bg-[#252840]'
                        }`}
                      >
                        {deg}°
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] text-gray-500 block mb-0.5">X</label>
                    <input
                      type="number"
                      value={Math.round(selectedLayer.x)}
                      onChange={e => onLayerUpdate(selectedLayer.id, { x: Number(e.target.value) })}
                      className="w-full bg-[#252840] border border-[#2a2d45] rounded-lg px-2 py-2 text-[12px] text-gray-300 focus:outline-none focus:border-[#4f7cff]"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-gray-500 block mb-0.5">Y</label>
                    <input
                      type="number"
                      value={Math.round(selectedLayer.y)}
                      onChange={e => onLayerUpdate(selectedLayer.id, { y: Number(e.target.value) })}
                      className="w-full bg-[#252840] border border-[#2a2d45] rounded-lg px-2 py-2 text-[12px] text-gray-300 focus:outline-none focus:border-[#4f7cff]"
                    />
                  </div>
                </div>

                {/* Size info with snap button */}
                {selectedLayer.type === 'image' && (
                  <div className="bg-[#252840] rounded-xl p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[12px] text-gray-300 font-medium">📐 Size</span>
                      <button
                        onClick={() => {
                          const cx = selectedLayer.x + (selectedLayer.width * selectedLayer.scaleX) / 2;
                          const cy = selectedLayer.y + (selectedLayer.height * selectedLayer.scaleY) / 2;
                          onLayerUpdate(selectedLayer.id, {
                            scaleX: snapTarget,
                            scaleY: snapTarget,
                            x: cx - selectedLayer.width * snapTarget / 2,
                            y: cy - selectedLayer.height * snapTarget / 2,
                          });
                        }}
                        className={`flex items-center gap-1 px-2 py-1.5 text-[11px] rounded-lg transition-colors active:scale-95 ${
                          isAlreadySnapped
                            ? 'bg-[#1a1c2e]/50 text-gray-600 cursor-default'
                            : 'bg-[#1a1c2e] active:bg-[#4f7cff] text-gray-400 active:text-white'
                        }`}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M3 12a9 9 0 1 1 9 9" />
                          <polyline points="3 7 3 12 8 12" />
                        </svg>
                        →{snapPct}%
                      </button>
                    </div>
                    <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
                      <div className="flex justify-between">
                        <span className="text-gray-500">Original</span>
                        <span className="text-gray-400 tabular-nums">{selectedLayer.width}×{selectedLayer.height}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-500">Current</span>
                        <span className="text-gray-300 tabular-nums">
                          {Math.round(selectedLayer.width * selectedLayer.scaleX)}×{Math.round(selectedLayer.height * selectedLayer.scaleY)}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-500">Scale X</span>
                        <span className={`tabular-nums ${Math.abs(selectedLayer.scaleX - 1) < 0.005 ? 'text-green-400' : 'text-[#4f7cff]'}`}>
                          {Math.round(selectedLayer.scaleX * 100)}%
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-500">Scale Y</span>
                        <span className={`tabular-nums ${Math.abs(selectedLayer.scaleY - 1) < 0.005 ? 'text-green-400' : 'text-[#4f7cff]'}`}>
                          {Math.round(selectedLayer.scaleY * 100)}%
                        </span>
                      </div>
                    </div>
                  </div>
                )}

                <div className="flex gap-2">
                  <button
                    onClick={() => onFlipLayer(selectedLayer.id, 'h')}
                    className={`flex-1 py-2.5 text-[12px] rounded-lg transition-colors active:scale-95 ${
                      selectedLayer.flipH ? 'bg-[#4f7cff] text-white' : 'bg-[#252840] text-gray-400 active:bg-[#2a2d45]'
                    }`}
                  >
                    ↔ Flip H
                  </button>
                  <button
                    onClick={() => onFlipLayer(selectedLayer.id, 'v')}
                    className={`flex-1 py-2.5 text-[12px] rounded-lg transition-colors active:scale-95 ${
                      selectedLayer.flipV ? 'bg-[#4f7cff] text-white' : 'bg-[#252840] text-gray-400 active:bg-[#2a2d45]'
                    }`}
                  >
                    ↕ Flip V
                  </button>
                </div>

                {/* Warp Mesh */}
                {onToggleWarpMesh && onResetWarpMesh && (selectedLayer.type === 'image' || selectedLayer.type === 'shape') && (
                  <div className="bg-[#252840] rounded-xl p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[12px] text-gray-300 font-medium">🔲 Warp Mesh</span>
                      {selectedLayer.warpMesh && (
                        <button
                          onClick={() => onResetWarpMesh(selectedLayer.id)}
                          className="text-[10px] px-2 py-1 rounded-lg bg-[#1a1c2e] text-gray-400 active:bg-red-700/50 active:text-white transition-colors active:scale-95"
                        >
                          ↺ Reset
                        </button>
                      )}
                    </div>
                    <button
                      onClick={() => onToggleWarpMesh(selectedLayer.id)}
                      className={`w-full py-2.5 text-[11px] rounded-lg transition-all active:scale-95 ${
                        selectedLayer.warpMesh 
                          ? 'bg-[#4f7cff] text-white'
                          : 'bg-[#1a1c2e] text-gray-400 active:bg-[#4f7cff] active:text-white'
                      }`}
                    >
                      {selectedLayer.warpMesh ? '✓ Warp Grid Active — Tap points to bend' : 'Enable Warp Grid'}
                    </button>
                    {selectedLayer.warpMesh && (
                      <div className="text-[10px] text-gray-500">
                        Drag the blue grid points on the image to distort. Blue box and move/scale/rotate follow the warped content.
                      </div>
                    )}
                  </div>
                )}

                <div className="flex gap-2">
                  <button
                    onClick={() => onLayerReorder(selectedLayer.id, 'up')}
                    className="flex-1 py-2.5 bg-[#252840] active:bg-[#2a2d45] text-gray-400 text-[12px] rounded-lg transition-colors active:scale-95"
                  >
                    ▲ Up
                  </button>
                  <button
                    onClick={() => onLayerReorder(selectedLayer.id, 'down')}
                    className="flex-1 py-2.5 bg-[#252840] active:bg-[#2a2d45] text-gray-400 text-[12px] rounded-lg transition-colors active:scale-95"
                  >
                    ▼ Down
                  </button>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => onLayerReorder(selectedLayer.id, 'top')}
                    className="flex-1 py-2 bg-[#252840] active:bg-[#4f7cff] text-gray-400 active:text-white text-[11px] rounded-lg transition-colors active:scale-95"
                  >
                    ⬆⬆ Top
                  </button>
                  <button
                    onClick={() => onLayerReorder(selectedLayer.id, 'bottom')}
                    className="flex-1 py-2 bg-[#252840] active:bg-[#4f7cff] text-gray-400 active:text-white text-[11px] rounded-lg transition-colors active:scale-95"
                  >
                    ⬇⬇ Bottom
                  </button>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => onLayerDuplicate(selectedLayer.id)}
                    className="flex-1 py-2.5 bg-[#252840] active:bg-[#2a2d45] text-gray-400 text-[12px] rounded-lg transition-colors active:scale-95"
                  >
                    ❏ Duplicate
                  </button>
                </div>
              </div>
            )}

            {/* Export buttons */}
            {layers.length > 0 && (
              <div className="mt-3 pt-3 border-t border-[#2a2d45] px-1 space-y-2">
                {selectedLayer && (
                  <button
                    onClick={() => onExportSingle(selectedLayer.id)}
                    className="w-full py-3 bg-[#252840] active:bg-[#4f7cff] text-gray-300 active:text-white text-[12px] font-medium rounded-xl transition-all active:scale-[0.98] flex items-center justify-center gap-2 border border-[#2a2d45]"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="3" width="18" height="18" rx="2" />
                      <path d="M12 8v8" />
                      <path d="M8 12l4 4 4-4" />
                    </svg>
                    Export Selected
                  </button>
                )}
                <button
                  onClick={onExport}
                  className="w-full py-3 bg-gradient-to-r from-[#4f7cff] to-[#a78bfa] active:opacity-80 text-white text-[12px] font-medium rounded-xl transition-all active:scale-[0.98] flex items-center justify-center gap-2"
                >
                  📤 Export All (PNG)
                </button>
                {onClearAll && (
                  <button
                    onClick={onClearAll}
                    className="w-full py-2.5 bg-red-900/40 active:bg-red-700/50 text-red-400 text-[12px] font-medium rounded-xl transition-all active:scale-[0.98] flex items-center justify-center gap-2 border border-red-900/50 mt-2"
                  >
                    🗑 Clear All (Undoable)
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {activeTab === 'filters' && (() => {
          // Helper function to apply filters - handles multi-select
          const applyFilter = (updates: Partial<LayerFilters>, preview?: boolean) => {
            if (selectedLayerIds.length > 1 && onMultiUpdateFilters) {
              onMultiUpdateFilters(updates, preview);
            } else if (selectedLayer) {
              onUpdateFilters(selectedLayer.id, updates, preview);
            }
          };
          // Use applyFilter for Reset All button - will apply to all selected layers
          void applyFilter; // Used below in Reset All Filters button
          return (
          <div className="p-3 space-y-3">
            {selectedLayer && (selectedLayer.type === 'image' || selectedLayer.type === 'text' || selectedLayer.type === 'shape' || selectedLayer.type === 'drawing') ? (
              <>
                <div className="text-[11px] text-gray-400 font-medium mb-2">
                  Filters: <span className="text-gray-300">{multiCount > 1 ? `${multiCount} layers` : selectedLayer.name}</span>
                </div>
                {multiCount > 1 && (
                  <div className="bg-[#4f7cff]/15 border border-[#4f7cff]/30 rounded-lg px-3 py-2 mb-2">
                    <div className="text-[11px] text-[#4f7cff]">✦ Filter changes apply to all {multiCount} selected layers</div>
                  </div>
                )}

                {/* Line Art */}
                <div className="bg-[#252840] rounded-xl p-3 space-y-2">
                  <ToggleSwitch
                    label="Line Art"
                    icon="✏️"
                    checked={selectedLayer.filters.lineArt}
                    onToggle={() => onUpdateFilters(selectedLayer.id, { lineArt: !selectedLayer.filters.lineArt })}
                  />
                  {selectedLayer.filters.lineArt && (
                    <>
                      <DebouncedSlider
                        label="Threshold"
                        value={selectedLayer.filters.lineArtThreshold}
                        min={5} max={200}
                        onChange={v => onUpdateFilters(selectedLayer.id, { lineArtThreshold: v }, true)}
                        onChangeEnd={v => onUpdateFilters(selectedLayer.id, { lineArtThreshold: v })}
                      />
                      <div className="pt-1 border-t border-[#1a1c2e]">
                        <div className="text-[10px] text-gray-500 mb-1">🎨 Original Color Overlay</div>
                        <DebouncedSlider
                          label="Color Intensity"
                          value={Math.round(selectedLayer.filters.lineArtColorBlend * 100)}
                          min={0} max={100}
                          onChange={v => onUpdateFilters(selectedLayer.id, { lineArtColorBlend: v / 100 }, true)}
                          onChangeEnd={v => onUpdateFilters(selectedLayer.id, { lineArtColorBlend: v / 100 })}
                          displayFn={v => v === 0 ? 'B&W' : `${v}%`}
                        />
                      </div>
                      <div className="pt-1 border-t border-[#1a1c2e]">
                        <div className="text-[10px] text-gray-500 mb-1">📷 Original Photo Blend</div>
                        <DebouncedSlider
                          label="Blend Amount"
                          value={Math.round(selectedLayer.filters.lineArtBlend * 100)}
                          min={0} max={100}
                          onChange={v => onUpdateFilters(selectedLayer.id, { lineArtBlend: v / 100 }, true)}
                          onChangeEnd={v => onUpdateFilters(selectedLayer.id, { lineArtBlend: v / 100 })}
                          displayFn={v => v === 0 ? 'Off' : `${v}%`}
                        />
                      </div>
                    </>
                  )}
                </div>

                {/* Find Edges */}
                <div className="bg-[#252840] rounded-xl p-3 space-y-2">
                  <ToggleSwitch
                    label="Find Edges"
                    icon="🔍"
                    checked={selectedLayer.filters.findEdges}
                    onToggle={() => onUpdateFilters(selectedLayer.id, { findEdges: !selectedLayer.filters.findEdges })}
                  />
                  {selectedLayer.filters.findEdges && (
                    <>
                      <DebouncedSlider
                        label="Strength"
                        value={Math.round(selectedLayer.filters.findEdgesStrength * 100)}
                        min={10} max={500}
                        onChange={v => onUpdateFilters(selectedLayer.id, { findEdgesStrength: v / 100 }, true)}
                        onChangeEnd={v => onUpdateFilters(selectedLayer.id, { findEdgesStrength: v / 100 })}
                        displayFn={v => `${(v / 100).toFixed(1)}x`}
                      />
                      <DebouncedSlider
                        label="Original Overlay"
                        value={Math.round(selectedLayer.filters.findEdgesBlend * 100)}
                        min={0} max={100}
                        onChange={v => onUpdateFilters(selectedLayer.id, { findEdgesBlend: v / 100 }, true)}
                        onChangeEnd={v => onUpdateFilters(selectedLayer.id, { findEdgesBlend: v / 100 })}
                        displayFn={v => `${v}%`}
                      />
                    </>
                  )}
                </div>

                {/* Manga / Levels */}
                <div className="bg-[#252840] rounded-xl p-3 space-y-2">
                  <ToggleSwitch
                    label="Manga (Levels)"
                    icon="📖"
                    checked={selectedLayer.filters.levels}
                    onToggle={() => onUpdateFilters(selectedLayer.id, { levels: !selectedLayer.filters.levels })}
                  />
                  {selectedLayer.filters.levels && (
                    <>
                      <DebouncedSlider
                        label="Black Point"
                        value={selectedLayer.filters.levelsBlack}
                        min={0} max={200}
                        onChange={v => onUpdateFilters(selectedLayer.id, { levelsBlack: v }, true)}
                        onChangeEnd={v => onUpdateFilters(selectedLayer.id, { levelsBlack: v })}
                      />
                      <DebouncedSlider
                        label="White Point"
                        value={selectedLayer.filters.levelsWhite}
                        min={50} max={255}
                        onChange={v => onUpdateFilters(selectedLayer.id, { levelsWhite: v }, true)}
                        onChangeEnd={v => onUpdateFilters(selectedLayer.id, { levelsWhite: v })}
                      />
                      <DebouncedSlider
                        label="Gamma"
                        value={Math.round(selectedLayer.filters.levelsGamma * 100)}
                        min={10} max={500}
                        onChange={v => onUpdateFilters(selectedLayer.id, { levelsGamma: v / 100 }, true)}
                        onChangeEnd={v => onUpdateFilters(selectedLayer.id, { levelsGamma: v / 100 })}
                        displayFn={v => `${(v / 100).toFixed(2)}`}
                      />
                      <ToggleSwitch
                        label="Monochrome"
                        icon="🔲"
                        checked={selectedLayer.filters.levelsMono}
                        onToggle={() => onUpdateFilters(selectedLayer.id, { levelsMono: !selectedLayer.filters.levelsMono })}
                      />
                    </>
                  )}
                </div>

                {/* Halftone (Manga Dots) */}
                <div className="bg-[#252840] rounded-xl p-3 space-y-2">
                  <ToggleSwitch
                    label="Halftone Dots"
                    icon="⬤"
                    checked={selectedLayer.filters.halftone}
                    onToggle={() => onUpdateFilters(selectedLayer.id, { halftone: !selectedLayer.filters.halftone })}
                  />
                  {selectedLayer.filters.halftone && (
                    <>
                      {/* Color mode: BW vs Color dots */}
                      <div className="flex gap-2">
                        <button
                          onClick={() => onUpdateFilters(selectedLayer.id, { halftoneColorMode: 0 })}
                          className={`flex-1 py-2 text-[11px] rounded-lg transition-all active:scale-95 ${
                            selectedLayer.filters.halftoneColorMode === 0 ? 'bg-[#4f7cff] text-white' : 'bg-[#1a1c2e] text-gray-400'
                          }`}
                        >
                          ⚫ B&W
                        </button>
                        <button
                          onClick={() => onUpdateFilters(selectedLayer.id, { halftoneColorMode: 1 })}
                          className={`flex-1 py-2 text-[11px] rounded-lg transition-all active:scale-95 ${
                            selectedLayer.filters.halftoneColorMode === 1 ? 'bg-[#4f7cff] text-white' : 'bg-[#1a1c2e] text-gray-400'
                          }`}
                        >
                          🌈 Color
                        </button>
                      </div>
                      <DebouncedSlider
                        label="Dot Size"
                        value={selectedLayer.filters.halftoneSize}
                        min={2} max={20}
                        onChange={v => onUpdateFilters(selectedLayer.id, { halftoneSize: v }, true)}
                        onChangeEnd={v => onUpdateFilters(selectedLayer.id, { halftoneSize: v })}
                        displayFn={v => `${v}px`}
                      />
                      <DebouncedSlider
                        label="Angle"
                        value={selectedLayer.filters.halftoneAngle}
                        min={0} max={90}
                        onChange={v => onUpdateFilters(selectedLayer.id, { halftoneAngle: v }, true)}
                        onChangeEnd={v => onUpdateFilters(selectedLayer.id, { halftoneAngle: v })}
                        displayFn={v => `${v}°`}
                      />
                      {/* Blend mode (overlay/multiply/darken) */}
                      <div className="pt-1 border-t border-[#1a1c2e]">
                        <div className="text-[10px] text-gray-500 mb-1">Blend Mode</div>
                        <div className="grid grid-cols-4 gap-1">
                          {[
                            { v: 0, label: 'Normal' },
                            { v: 1, label: 'Overlay' },
                            { v: 2, label: 'Multiply' },
                            { v: 3, label: 'Darken' },
                          ].map(m => (
                            <button
                              key={m.v}
                              onClick={() => onUpdateFilters(selectedLayer.id, { halftoneBlendMode: m.v })}
                              className={`py-1.5 text-[9px] rounded-lg transition-all active:scale-95 ${
                                selectedLayer.filters.halftoneBlendMode === m.v
                                  ? 'ring-1 ring-[#4f7cff] bg-[#4f7cff]/20 text-white'
                                  : 'bg-[#1a1c2e] text-gray-400'
                              }`}
                            >
                              {m.label}
                            </button>
                          ))}
                        </div>
                      </div>
                      {/* Original color overlay */}
                      <div className="pt-1 border-t border-[#1a1c2e]">
                        <DebouncedSlider
                          label="Original Color Overlay"
                          value={Math.round(selectedLayer.filters.halftoneColorBlend * 100)}
                          min={0} max={100}
                          onChange={v => onUpdateFilters(selectedLayer.id, { halftoneColorBlend: v / 100 }, true)}
                          onChangeEnd={v => onUpdateFilters(selectedLayer.id, { halftoneColorBlend: v / 100 })}
                          displayFn={v => v === 0 ? 'Off' : `${v}%`}
                        />
                      </div>
                    </>
                  )}
                </div>

                {/* Brightness & Contrast */}
                <div className="bg-[#252840] rounded-xl p-3 space-y-2">
                  <span className="text-[12px] text-gray-300 font-medium">🔆 Brightness / Contrast</span>
                  <DebouncedSlider
                    label="Brightness"
                    value={selectedLayer.filters.brightness}
                    min={-100} max={100}
                    onChange={v => onUpdateFilters(selectedLayer.id, { brightness: v }, true)}
                    onChangeEnd={v => onUpdateFilters(selectedLayer.id, { brightness: v })}
                  />
                  <DebouncedSlider
                    label="Contrast"
                    value={selectedLayer.filters.contrast}
                    min={-100} max={100}
                    onChange={v => onUpdateFilters(selectedLayer.id, { contrast: v }, true)}
                    onChangeEnd={v => onUpdateFilters(selectedLayer.id, { contrast: v })}
                  />
                </div>

                {/* Blur (Remade) */}
                <div className="bg-[#252840] rounded-xl p-3 space-y-2">
                  <span className="text-[12px] text-gray-300 font-medium">💫 Blur</span>
                  <div className="grid grid-cols-5 gap-1.5">
                    {[
                      { v: 0, label: 'Off' },
                      { v: 1, label: 'Gauss' },
                      { v: 2, label: 'Box' },
                      { v: 3, label: 'Motion' },
                      { v: 4, label: 'Radial' },
                    ].map(s => (
                      <button
                        key={s.v}
                        onClick={() => onUpdateFilters(selectedLayer.id, { blurType: s.v })}
                        className={`py-2 text-[10px] rounded-lg transition-all active:scale-95 ${
                          selectedLayer.filters.blurType === s.v
                            ? 'ring-2 ring-[#4f7cff] bg-[#4f7cff]/20 text-white'
                            : 'bg-[#1a1c2e] text-gray-400 active:ring-1 active:ring-gray-500'
                        }`}
                      >
                        {s.label}
                      </button>
                    ))}
                  </div>
                  {selectedLayer.filters.blurType > 0 && (
                    <>
                      <DebouncedSlider
                        label="Radius"
                        value={selectedLayer.filters.blurRadius}
                        min={0} max={200} step={0.5}
                        onChange={v => onUpdateFilters(selectedLayer.id, { blurRadius: v }, true)}
                        onChangeEnd={v => onUpdateFilters(selectedLayer.id, { blurRadius: v })}
                        displayFn={v => `${v}px`}
                      />
                      {selectedLayer.filters.blurType === 3 && (
                        <DebouncedSlider
                          label="Angle"
                          value={selectedLayer.filters.blurAngle}
                          min={0} max={360}
                          onChange={v => onUpdateFilters(selectedLayer.id, { blurAngle: v }, true)}
                          onChangeEnd={v => onUpdateFilters(selectedLayer.id, { blurAngle: v })}
                          displayFn={v => `${v}°`}
                        />
                      )}
                    </>
                  )}
                </div>

                {/* Noise (Remade) */}
                <div className="bg-[#252840] rounded-xl p-3 space-y-2">
                  <span className="text-[12px] text-gray-300 font-medium">📺 Noise</span>
                  <div className="grid grid-cols-5 gap-1.5">
                    {[
                      { v: 0, label: 'Off' },
                      { v: 1, label: 'Gauss' },
                      { v: 2, label: 'Film' },
                      { v: 3, label: 'Color' },
                      { v: 4, label: 'Mono' },
                    ].map(s => (
                      <button
                        key={s.v}
                        onClick={() => onUpdateFilters(selectedLayer.id, { noiseType: s.v })}
                        className={`py-2 text-[10px] rounded-lg transition-all active:scale-95 ${
                          selectedLayer.filters.noiseType === s.v
                            ? 'ring-2 ring-[#4f7cff] bg-[#4f7cff]/20 text-white'
                            : 'bg-[#1a1c2e] text-gray-400 active:ring-1 active:ring-gray-500'
                        }`}
                      >
                        {s.label}
                      </button>
                    ))}
                  </div>
                  {selectedLayer.filters.noiseType > 0 && (
                    <>
                      <DebouncedSlider
                        label="Amount"
                        value={selectedLayer.filters.noiseAmount}
                        min={0} max={100}
                        onChange={v => onUpdateFilters(selectedLayer.id, { noiseAmount: v }, true)}
                        onChangeEnd={v => onUpdateFilters(selectedLayer.id, { noiseAmount: v })}
                        displayFn={v => `${v}%`}
                      />
                      <DebouncedSlider
                        label="Density"
                        value={selectedLayer.filters.noiseDensity}
                        min={1} max={100}
                        onChange={v => onUpdateFilters(selectedLayer.id, { noiseDensity: v }, true)}
                        onChangeEnd={v => onUpdateFilters(selectedLayer.id, { noiseDensity: v })}
                        displayFn={v => `${v}%`}
                      />
                    </>
                  )}
                </div>

                {/* Posterize */}
                <div className="bg-[#252840] rounded-xl p-3 space-y-2">
                  <span className="text-[12px] text-gray-300 font-medium">🎨 Posterize</span>
                  <DebouncedSlider
                    label="Levels"
                    value={selectedLayer.filters.posterize}
                    min={0} max={32}
                    onChange={v => onUpdateFilters(selectedLayer.id, { posterize: v }, true)}
                    onChangeEnd={v => onUpdateFilters(selectedLayer.id, { posterize: v })}
                    displayFn={v => v < 2 ? 'Off' : `${v}`}
                  />
                </div>


                {/* Color Separation */}
                <div className="bg-[#252840] rounded-xl p-3 space-y-2">
                  <ToggleSwitch
                    label="Color Separation"
                    icon="🌈"
                    checked={selectedLayer.filters.colorSepEnabled}
                    onToggle={() => onUpdateFilters(selectedLayer.id, { colorSepEnabled: !selectedLayer.filters.colorSepEnabled })}
                  />
                  {selectedLayer.filters.colorSepEnabled && (
                    <>
                      <DebouncedSlider
                        label="R Levels"
                        value={selectedLayer.filters.colorSepR}
                        min={2} max={32}
                        onChange={v => onUpdateFilters(selectedLayer.id, { colorSepR: v }, true)}
                        onChangeEnd={v => onUpdateFilters(selectedLayer.id, { colorSepR: v })}
                        displayFn={v => `${v}`}
                      />
                      <DebouncedSlider
                        label="G Levels"
                        value={selectedLayer.filters.colorSepG}
                        min={2} max={32}
                        onChange={v => onUpdateFilters(selectedLayer.id, { colorSepG: v }, true)}
                        onChangeEnd={v => onUpdateFilters(selectedLayer.id, { colorSepG: v })}
                        displayFn={v => `${v}`}
                      />
                      <DebouncedSlider
                        label="B Levels"
                        value={selectedLayer.filters.colorSepB}
                        min={2} max={32}
                        onChange={v => onUpdateFilters(selectedLayer.id, { colorSepB: v }, true)}
                        onChangeEnd={v => onUpdateFilters(selectedLayer.id, { colorSepB: v })}
                        displayFn={v => `${v}`}
                      />
                      <DebouncedSlider
                        label="Mix"
                        value={Math.round(selectedLayer.filters.colorSepMix * 100)}
                        min={0} max={100}
                        onChange={v => onUpdateFilters(selectedLayer.id, { colorSepMix: v / 100 }, true)}
                        onChangeEnd={v => onUpdateFilters(selectedLayer.id, { colorSepMix: v / 100 })}
                        displayFn={v => `${v}%`}
                      />
                    </>
                  )}
                </div>

                {/* Hue / Saturation / Color Temp */}
                <div className="bg-[#252840] rounded-xl p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[12px] text-gray-300 font-medium">🌈 Color Tone</span>
                    {(selectedLayer.filters.hueShift !== 0 || selectedLayer.filters.saturation !== 0 || selectedLayer.filters.colorTempShift !== 0) && (
                      <button
                        onClick={() => onUpdateFilters(selectedLayer.id, { hueShift: 0, saturation: 0, colorTempShift: 0 })}
                        className="text-[10px] px-2 py-1 rounded-lg bg-[#1a1c2e] text-gray-400 active:bg-[#4f7cff] active:text-white transition-colors active:scale-95"
                      >
                        ↺ Reset
                      </button>
                    )}
                  </div>
                  <DebouncedSlider
                    label="Hue Shift"
                    value={selectedLayer.filters.hueShift}
                    min={-180} max={180}
                    onChange={v => onUpdateFilters(selectedLayer.id, { hueShift: v }, true)}
                    onChangeEnd={v => onUpdateFilters(selectedLayer.id, { hueShift: v })}
                    displayFn={v => `${v}°`}
                  />
                  <DebouncedSlider
                    label="Saturation"
                    value={selectedLayer.filters.saturation}
                    min={-100} max={100}
                    onChange={v => onUpdateFilters(selectedLayer.id, { saturation: v }, true)}
                    onChangeEnd={v => onUpdateFilters(selectedLayer.id, { saturation: v })}
                    displayFn={v => `${v > 0 ? '+' : ''}${v}`}
                  />
                  <DebouncedSlider
                    label="Warm / Cool"
                    value={selectedLayer.filters.colorTempShift}
                    min={-100} max={100}
                    onChange={v => onUpdateFilters(selectedLayer.id, { colorTempShift: v }, true)}
                    onChangeEnd={v => onUpdateFilters(selectedLayer.id, { colorTempShift: v })}
                    displayFn={v => v > 0 ? `🔥+${v}` : v < 0 ? `❄️${v}` : '0'}
                  />
                </div>

                {/* Posterize Art Styles */}
                <div className="bg-[#252840] rounded-xl p-3 space-y-2">
                  <span className="text-[12px] text-gray-300 font-medium">🎭 Art Posterize</span>
                  <div className="grid grid-cols-5 gap-1.5">
                    {[
                      { v: 0, label: 'Off', color: 'bg-[#1a1c2e]' },
                      { v: 1, label: 'Neon', color: 'bg-fuchsia-900/50' },
                      { v: 2, label: 'Retro', color: 'bg-amber-900/50' },
                      { v: 3, label: 'Pastel', color: 'bg-pink-900/50' },
                      { v: 4, label: 'Duo', color: 'bg-blue-900/50' },
                    ].map(s => (
                      <button
                        key={s.v}
                        onClick={() => onUpdateFilters(selectedLayer.id, { posterizeStyle: s.v })}
                        className={`py-2 text-[10px] rounded-lg transition-all active:scale-95 ${
                          selectedLayer.filters.posterizeStyle === s.v
                            ? 'ring-2 ring-[#4f7cff] text-white ' + s.color
                            : 'text-gray-400 ' + s.color + ' active:ring-1 active:ring-gray-500'
                        }`}
                      >
                        {s.label}
                      </button>
                    ))}
                  </div>
                  {selectedLayer.filters.posterizeStyle > 0 && (
                    <DebouncedSlider
                      label="Color Shift"
                      value={selectedLayer.filters.posterizeColorShift}
                      min={-180} max={180}
                      onChange={v => onUpdateFilters(selectedLayer.id, { posterizeColorShift: v }, true)}
                      onChangeEnd={v => onUpdateFilters(selectedLayer.id, { posterizeColorShift: v })}
                      displayFn={v => v === 0 ? 'None' : `${v > 0 ? '+' : ''}${v}°`}
                    />
                  )}
                </div>

                {/* Facet / Block */}
                <div className="bg-[#252840] rounded-xl p-3 space-y-2">
                  <span className="text-[12px] text-gray-300 font-medium">🔷 Facet / Block</span>
                  <div className="grid grid-cols-5 gap-1.5">
                    {[
                      { v: 0, label: 'Off' },
                      { v: 1, label: 'Rect' },
                      { v: 2, label: 'Tri' },
                      { v: 3, label: 'Voronoi' },
                      { v: 4, label: '◆' },
                    ].map(s => (
                      <button
                        key={s.v}
                        onClick={() => onUpdateFilters(selectedLayer.id, { facetFilter: s.v })}
                        className={`py-2 text-[10px] rounded-lg transition-all active:scale-95 ${
                          selectedLayer.filters.facetFilter === s.v
                            ? 'ring-2 ring-[#4f7cff] bg-[#4f7cff]/20 text-white'
                            : 'bg-[#1a1c2e] text-gray-400 active:ring-1 active:ring-gray-500'
                        }`}
                      >
                        {s.label}
                      </button>
                    ))}
                  </div>
                  {selectedLayer.filters.facetFilter > 0 && (
                    <DebouncedSlider
                                            label="Block Size"
                        value={selectedLayer.filters.facetSize}
                        min={3} max={200}
                      onChange={v => onUpdateFilters(selectedLayer.id, { facetSize: v }, true)}
                      onChangeEnd={v => onUpdateFilters(selectedLayer.id, { facetSize: v })}
                      displayFn={v => `${v}px`}
                    />
                  )}
                </div>

                {/* Frosted Glass */}
                <div className="bg-[#252840] rounded-xl p-3 space-y-2">
                  <ToggleSwitch
                    label="Frosted Glass"
                    icon="🧊"
                    checked={selectedLayer.filters.frostedGlass}
                    onToggle={() => onUpdateFilters(selectedLayer.id, { frostedGlass: !selectedLayer.filters.frostedGlass })}
                  />
                  {selectedLayer.filters.frostedGlass && (
                    <DebouncedSlider
                      label="Amount"
                      value={selectedLayer.filters.frostedGlassAmount}
                      min={1} max={100}
                      onChange={v => onUpdateFilters(selectedLayer.id, { frostedGlassAmount: v }, true)}
                      onChangeEnd={v => onUpdateFilters(selectedLayer.id, { frostedGlassAmount: v })}
                      displayFn={v => `${v}px`}
                    />
                  )}
                </div>

                {/* Stroke (Inner / Outer) */}
                <div className="bg-[#252840] rounded-xl p-3 space-y-2">
                  <ToggleSwitch
                    label="Stroke"
                    icon="🔲"
                    checked={selectedLayer.filters.strokeEnabled}
                    onToggle={() => onUpdateFilters(selectedLayer.id, { strokeEnabled: !selectedLayer.filters.strokeEnabled })}
                  />
                  {selectedLayer.filters.strokeEnabled && (
                    <>
                      <div className="flex gap-2">
                        <button
                          onClick={() => onUpdateFilters(selectedLayer.id, { strokeOuter: !selectedLayer.filters.strokeOuter })}
                          className={`flex-1 py-2 text-[11px] rounded-lg transition-all active:scale-95 ${
                            selectedLayer.filters.strokeOuter ? 'bg-[#4f7cff] text-white' : 'bg-[#1a1c2e] text-gray-400'
                          }`}
                        >
                          Outer
                        </button>
                        <button
                          onClick={() => onUpdateFilters(selectedLayer.id, { strokeInner: !selectedLayer.filters.strokeInner })}
                          className={`flex-1 py-2 text-[11px] rounded-lg transition-all active:scale-95 ${
                            selectedLayer.filters.strokeInner ? 'bg-[#4f7cff] text-white' : 'bg-[#1a1c2e] text-gray-400'
                          }`}
                        >
                          Inner
                        </button>
                      </div>
                      <DebouncedSlider
                        label="Width"
                        value={selectedLayer.filters.strokeWidth}
                        min={1} max={20}
                        onChange={v => onUpdateFilters(selectedLayer.id, { strokeWidth: v }, true)}
                        onChangeEnd={v => onUpdateFilters(selectedLayer.id, { strokeWidth: v })}
                        displayFn={v => `${v}px`}
                      />
                      <div>
                        <div className="text-[11px] text-gray-400 mb-1">Color</div>
                        <input
                          type="color"
                          value={selectedLayer.filters.strokeColor}
                          onChange={e => onUpdateFilters(selectedLayer.id, { strokeColor: e.target.value })}
                          className="w-full h-8 rounded-lg cursor-pointer border border-[#2a2d45] bg-transparent"
                        />
                      </div>
                    </>
                  )}
                </div>

                {/* Game Filter */}
                <div className="bg-[#252840] rounded-xl p-3 space-y-2">
                  <span className="text-[12px] text-gray-300 font-medium">🎮 Game Feel</span>
                  <div className="grid grid-cols-5 gap-1.5">
                    {[
                      { v: 0, label: 'Off' },
                      { v: 1, label: 'Pixel' },
                      { v: 2, label: 'CRT' },
                      { v: 3, label: 'Neon' },
                      { v: 4, label: '8-Bit' },
                    ].map(s => (
                      <button
                        key={s.v}
                        onClick={() => onUpdateFilters(selectedLayer.id, { gameFilter: s.v })}
                        className={`py-2 text-[10px] rounded-lg transition-all active:scale-95 ${
                          selectedLayer.filters.gameFilter === s.v
                            ? 'ring-2 ring-[#4f7cff] bg-[#4f7cff]/20 text-white'
                            : 'bg-[#1a1c2e] text-gray-400 active:ring-1 active:ring-gray-500'
                        }`}
                      >
                        {s.label}
                      </button>
                    ))}
                  </div>
                  {selectedLayer.filters.gameFilter > 0 && (
                    <DebouncedSlider
                      label="Intensity"
                      value={Math.round(selectedLayer.filters.gameFilterIntensity * 100)}
                      min={10} max={200}
                      onChange={v => onUpdateFilters(selectedLayer.id, { gameFilterIntensity: v / 100 }, true)}
                      onChangeEnd={v => onUpdateFilters(selectedLayer.id, { gameFilterIntensity: v / 100 })}
                      displayFn={v => `${(v / 100).toFixed(1)}x`}
                    />
                  )}
                </div>

                {/* Oil Paint */}
                <div className="bg-[#252840] rounded-xl p-3 space-y-2">
                  <ToggleSwitch
                    label="Oil Paint"
                    icon="🖌️"
                    checked={selectedLayer.filters.oilPaint}
                    onToggle={() => onUpdateFilters(selectedLayer.id, { oilPaint: !selectedLayer.filters.oilPaint })}
                  />
                  {selectedLayer.filters.oilPaint && (
                    <>
                      <DebouncedSlider
                        label="Radius"
                        value={selectedLayer.filters.oilPaintRadius}
                        min={1} max={8}
                        onChange={v => onUpdateFilters(selectedLayer.id, { oilPaintRadius: v }, true)}
                        onChangeEnd={v => onUpdateFilters(selectedLayer.id, { oilPaintRadius: v })}
                        displayFn={v => `${v}px`}
                      />
                      <DebouncedSlider
                        label="Detail Levels"
                        value={selectedLayer.filters.oilPaintLevels}
                        min={4} max={40}
                        onChange={v => onUpdateFilters(selectedLayer.id, { oilPaintLevels: v }, true)}
                        onChangeEnd={v => onUpdateFilters(selectedLayer.id, { oilPaintLevels: v })}
                        displayFn={v => `${v}`}
                      />
                    </>
                  )}
                </div>

                {/* Metal */}
                <div className="bg-[#252840] rounded-xl p-3 space-y-2">
                  <ToggleSwitch
                    label="Metal"
                    icon="⚙️"
                    checked={selectedLayer.filters.metalFilter}
                    onToggle={() => onUpdateFilters(selectedLayer.id, { metalFilter: !selectedLayer.filters.metalFilter })}
                  />
                  {selectedLayer.filters.metalFilter && (
                    <DebouncedSlider
                      label="Intensity"
                      value={Math.round(selectedLayer.filters.metalIntensity * 100)}
                      min={10} max={200}
                      onChange={v => onUpdateFilters(selectedLayer.id, { metalIntensity: v / 100 }, true)}
                      onChangeEnd={v => onUpdateFilters(selectedLayer.id, { metalIntensity: v / 100 })}
                      displayFn={v => `${(v / 100).toFixed(1)}x`}
                    />
                  )}
                </div>

                {/* Palette Knife */}
                <div className="bg-[#252840] rounded-xl p-3 space-y-2">
                  <ToggleSwitch
                    label="Palette Knife"
                    icon="🔪"
                    checked={selectedLayer.filters.paletteKnife}
                    onToggle={() => onUpdateFilters(selectedLayer.id, { paletteKnife: !selectedLayer.filters.paletteKnife })}
                  />
                  {selectedLayer.filters.paletteKnife && (
                    <>
                      <DebouncedSlider
                        label="Stroke Length"
                        value={selectedLayer.filters.paletteKnifeLength}
                        min={5} max={80}
                        onChange={v => onUpdateFilters(selectedLayer.id, { paletteKnifeLength: v }, true)}
                        onChangeEnd={v => onUpdateFilters(selectedLayer.id, { paletteKnifeLength: v })}
                        displayFn={v => `${v}px`}
                      />
                      <DebouncedSlider
                        label="Direction"
                        value={selectedLayer.filters.paletteKnifeDirection}
                        min={0} max={360}
                        onChange={v => onUpdateFilters(selectedLayer.id, { paletteKnifeDirection: v }, true)}
                        onChangeEnd={v => onUpdateFilters(selectedLayer.id, { paletteKnifeDirection: v })}
                        displayFn={v => `${v}°`}
                      />
                    </>
                  )}
                </div>

                {/* Texture / Brush Filter */}
                <div className="bg-[#252840] rounded-xl p-3 space-y-2">
                  <span className="text-[12px] text-gray-300 font-medium">🖌️ Texture / Brush</span>
                  <div className="grid grid-cols-4 gap-1.5">
                    {[
                      { v: 0, label: 'Off' },
                      { v: 1, label: 'Canvas' },
                      { v: 2, label: 'Water' },
                      { v: 3, label: 'Crayon' },
                    ].map(s => (
                      <button
                        key={s.v}
                        onClick={() => onUpdateFilters(selectedLayer.id, { textureFilter: s.v })}
                        className={`py-2 text-[10px] rounded-lg transition-all active:scale-95 ${
                          selectedLayer.filters.textureFilter === s.v
                            ? 'ring-2 ring-[#4f7cff] bg-[#4f7cff]/20 text-white'
                            : 'bg-[#1a1c2e] text-gray-400 active:ring-1 active:ring-gray-500'
                        }`}
                      >
                        {s.label}
                      </button>
                    ))}
                  </div>
                  <div className="grid grid-cols-3 gap-1.5">
                    {[
                      { v: 4, label: 'Impasto' },
                      { v: 5, label: 'Hatch' },
                      { v: 6, label: 'Stipple' },
                    ].map(s => (
                      <button
                        key={s.v}
                        onClick={() => onUpdateFilters(selectedLayer.id, { textureFilter: s.v })}
                        className={`py-2 text-[10px] rounded-lg transition-all active:scale-95 ${
                          selectedLayer.filters.textureFilter === s.v
                            ? 'ring-2 ring-[#4f7cff] bg-[#4f7cff]/20 text-white'
                            : 'bg-[#1a1c2e] text-gray-400 active:ring-1 active:ring-gray-500'
                        }`}
                      >
                        {s.label}
                      </button>
                    ))}
                  </div>
                  {selectedLayer.filters.textureFilter > 0 && (
                    <DebouncedSlider
                      label="Intensity"
                      value={Math.round(selectedLayer.filters.textureIntensity * 100)}
                      min={10} max={200}
                      onChange={v => onUpdateFilters(selectedLayer.id, { textureIntensity: v / 100 }, true)}
                      onChangeEnd={v => onUpdateFilters(selectedLayer.id, { textureIntensity: v / 100 })}
                      displayFn={v => `${(v / 100).toFixed(1)}x`}
                    />
                  )}
                </div>

                {/* Gradient Fade Transparency */}
                <div className="bg-[#252840] rounded-xl p-3 space-y-2">
                  <ToggleSwitch
                    label="Gradient Fade"
                    icon="🌫️"
                    checked={selectedLayer.filters.gradientFade}
                    onToggle={() => onUpdateFilters(selectedLayer.id, { gradientFade: !selectedLayer.filters.gradientFade })}
                  />
                  {selectedLayer.filters.gradientFade && (
                    <>
                      <div className="grid grid-cols-5 gap-1">
                        {[
                          { v: 0, label: '→' },
                          { v: 1, label: '←' },
                          { v: 2, label: '↓' },
                          { v: 3, label: '↑' },
                          { v: 4, label: '◎' },
                        ].map(d => (
                          <button
                            key={d.v}
                            onClick={() => onUpdateFilters(selectedLayer.id, { gradientFadeDirection: d.v })}
                            className={`py-2 text-[14px] rounded-lg transition-all active:scale-95 ${
                              selectedLayer.filters.gradientFadeDirection === d.v
                                ? 'ring-2 ring-[#4f7cff] bg-[#4f7cff]/20 text-white'
                                : 'bg-[#1a1c2e] text-gray-400'
                            }`}
                          >
                            {d.label}
                          </button>
                        ))}
                      </div>
                      <DebouncedSlider
                        label="Fade Amount"
                        value={selectedLayer.filters.gradientFadeAmount}
                        min={0} max={100}
                        onChange={v => onUpdateFilters(selectedLayer.id, { gradientFadeAmount: v }, true)}
                        onChangeEnd={v => onUpdateFilters(selectedLayer.id, { gradientFadeAmount: v })}
                        displayFn={v => `${v}%`}
                      />
                    </>
                  )}
                </div>

                {/* Channel Color Shifts */}
                <div className="bg-[#252840] rounded-xl p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[12px] text-gray-300 font-medium">🎨 Color Channel Shift</span>
                    {(selectedLayer.filters.channelShiftRG !== 0 || selectedLayer.filters.channelShiftYB !== 0 || selectedLayer.filters.channelShiftPC !== 0) && (
                      <button
                        onClick={() => onUpdateFilters(selectedLayer.id, { channelShiftRG: 0, channelShiftYB: 0, channelShiftPC: 0 })}
                        className="text-[10px] px-2 py-1 rounded-lg bg-[#1a1c2e] text-gray-400 active:bg-[#4f7cff] active:text-white transition-colors active:scale-95"
                      >
                        ↺ Reset
                      </button>
                    )}
                  </div>
                  <DebouncedSlider
                    label="🔴↔🟢 Red-Green"
                    value={selectedLayer.filters.channelShiftRG}
                    min={-100} max={100}
                    onChange={v => onUpdateFilters(selectedLayer.id, { channelShiftRG: v }, true)}
                    onChangeEnd={v => onUpdateFilters(selectedLayer.id, { channelShiftRG: v })}
                    displayFn={v => v === 0 ? '0' : `${v > 0 ? '+' : ''}${v}`}
                  />
                  <DebouncedSlider
                    label="🟡↔🔵 Yellow-Blue"
                    value={selectedLayer.filters.channelShiftYB}
                    min={-100} max={100}
                    onChange={v => onUpdateFilters(selectedLayer.id, { channelShiftYB: v }, true)}
                    onChangeEnd={v => onUpdateFilters(selectedLayer.id, { channelShiftYB: v })}
                    displayFn={v => v === 0 ? '0' : `${v > 0 ? '+' : ''}${v}`}
                  />
                  <DebouncedSlider
                    label="🩷↔🩵 Pink-Cyan"
                    value={selectedLayer.filters.channelShiftPC}
                    min={-100} max={100}
                    onChange={v => onUpdateFilters(selectedLayer.id, { channelShiftPC: v }, true)}
                    onChangeEnd={v => onUpdateFilters(selectedLayer.id, { channelShiftPC: v })}
                    displayFn={v => v === 0 ? '0' : `${v > 0 ? '+' : ''}${v}`}
                  />
                </div>

                {/* Invert */}
                <div className="bg-[#252840] rounded-xl p-3">
                  <ToggleSwitch
                    label="Invert"
                    icon="🔄"
                    checked={selectedLayer.filters.invert}
                    onToggle={() => onUpdateFilters(selectedLayer.id, { invert: !selectedLayer.filters.invert })}
                  />
                </div>

                <button
                  onClick={() => {
                    applyFilter({
                      lineArt: false, lineArtBlend: 0.5, lineArtThreshold: 50, lineArtColorBlend: 0,
                      findEdges: false, findEdgesBlend: 0.5, findEdgesStrength: 1,
                      blurType: 0, blurRadius: 0, blurAngle: 0,
                      noiseType: 0, noiseAmount: 0, noiseDensity: 100,
                      posterize: 0, brightness: 0, contrast: 0,
                      invert: false,
                      levels: false, levelsBlack: 0, levelsWhite: 255, levelsGamma: 1.0, levelsMono: false,
                      halftone: false, halftoneSize: 6, halftoneAngle: 45, halftoneColorMode: 0, halftoneColorBlend: 0, halftoneBlendMode: 0,
                      hueShift: 0, saturation: 0, colorTempShift: 0,
                      posterizeStyle: 0, posterizeColorShift: 0,
                      frostedGlass: false, frostedGlassAmount: 8,
                      strokeEnabled: false, strokeColor: '#000000', strokeWidth: 3, strokeInner: false, strokeOuter: true,
                      gameFilter: 0, gameFilterIntensity: 1.0,
                      facetFilter: 0, facetSize: 15,
                      oilPaint: false, oilPaintRadius: 4, oilPaintLevels: 20,
                      metalFilter: false, metalIntensity: 1.0,
                      paletteKnife: false, paletteKnifeLength: 20, paletteKnifeDirection: 45,
                      colorSepEnabled: false, colorSepR: 8, colorSepG: 8, colorSepB: 8, colorSepMix: 1.0,
                      textureFilter: 0, textureIntensity: 1.0,
                      gradientFade: false, gradientFadeDirection: 0, gradientFadeAmount: 50,
                      channelShiftRG: 0, channelShiftYB: 0, channelShiftPC: 0,
                    });
                  }}
                  className="w-full py-2.5 bg-[#252840] active:bg-[#2a2d45] text-gray-400 text-[12px] rounded-xl transition-colors active:scale-[0.98]"
                >
                  Reset All Filters{multiCount > 1 ? ` (${multiCount})` : ''}
                </button>
              </>
            ) : (
              <div className="text-center text-gray-500 text-xs py-12">
                Select an image layer
              </div>
            )}
          </div>
          );
        })()}
      </div>
    </div>
  );
};
