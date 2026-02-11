import React, { useState, useRef, useCallback, useEffect } from 'react';
import { type Point, applyPerspectiveTransform } from '../utils/perspective';

const CORNER_RADIUS = 8;
const CORNER_COLORS = ['#ef4444', '#3b82f6', '#22c55e', '#f59e0b'];
const CORNER_LABELS = ['左上', '右上', '右下', '左下'];

interface Props {
	onClose?: () => void;
	selectedLayer?: any;
	onApply?: (transformedCanvas: HTMLCanvasElement, offset?: { offsetX: number; offsetY: number }) => void;
}

const PerspectiveTool: React.FC<Props> = ({ onClose, selectedLayer, onApply }) => {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const srcCanvasRef = useRef<HTMLCanvasElement | null>(null);

	const [imageLoaded, setImageLoaded] = useState(false);
	const [imgSize, setImgSize] = useState({ w: 400, h: 300 });
	const [corners, setCorners] = useState<Point[]>([
		{ x: 0, y: 0 },
		{ x: 400, y: 0 },
		{ x: 400, y: 300 },
		{ x: 0, y: 300 },
	]);
	const [dragging, setDragging] = useState<number | null>(null);
	const [initialCorners, setInitialCorners] = useState<Point[]>([
		{ x: 0, y: 0 },
		{ x: 400, y: 0 },
		{ x: 400, y: 300 },
		{ x: 0, y: 300 },
	]);
	const [zoom, setZoom] = useState(1);
	const [cornersHistory, setCornersHistory] = useState<Point[][]>([]);
	const [cornersFuture, setCornersFuture] = useState<Point[][]>([]);

	const TOP_PADDING = 200;
	const SIDE_PADDING = 80;
	const BOTTOM_PADDING = 80;
	const displayW = imgSize.w + SIDE_PADDING * 2;
	const displayH = imgSize.h + TOP_PADDING + BOTTOM_PADDING;

	// Load layer image on mount
	useEffect(() => {
		if (!selectedLayer) {
			setImageLoaded(false);
			return;
		}

		let srcCanvas: HTMLCanvasElement | null = null;

		if (selectedLayer.type === 'drawing' && selectedLayer.drawingCanvas) {
			srcCanvas = selectedLayer.drawingCanvas;
		} else if (selectedLayer.filteredCanvas) {
			srcCanvas = selectedLayer.filteredCanvas;
		} else if (selectedLayer.image) {
			const img = selectedLayer.image;
			const canvas = document.createElement('canvas');
			canvas.width = selectedLayer.width || img.width;
			canvas.height = selectedLayer.height || img.height;
			const ctx = canvas.getContext('2d')!;
			ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
			srcCanvas = canvas;
		}

		if (srcCanvas) {
			srcCanvasRef.current = srcCanvas;
			const w = srcCanvas.width;
			const h = srcCanvas.height;
			setImgSize({ w, h });
			const initialCornerState = [
				{ x: 0, y: 0 },
				{ x: w, y: 0 },
				{ x: w, y: h },
				{ x: 0, y: h },
			];
			setInitialCorners(initialCornerState);
			setCorners(initialCornerState);
			setImageLoaded(true);
		}
	}, [selectedLayer]);

	// Render preview
	const render = useCallback(() => {
		const canvas = canvasRef.current;
		const srcCanvas = srcCanvasRef.current;
		if (!canvas || !srcCanvas) return;

		const ctx = canvas.getContext('2d')!;
		canvas.width = displayW;
		canvas.height = displayH;

		// Clear background
		ctx.fillStyle = '#1e1e2e';
		ctx.fillRect(0, 0, displayW, displayH);

		// Draw checkerboard pattern
		const checkSize = 16;
		for (let y = 0; y < displayH; y += checkSize) {
			for (let x = 0; x < displayW; x += checkSize) {
				if ((Math.floor(x / checkSize) + Math.floor(y / checkSize)) % 2 === 0) {
					ctx.fillStyle = '#2a2a3e';
					ctx.fillRect(x, y, checkSize, checkSize);
				}
			}
		}

		// Create destination canvas with transformed corners
		const destCanvas = document.createElement('canvas');
		destCanvas.width = displayW;
		destCanvas.height = displayH;

		const srcCorners: Point[] = [
			{ x: 0, y: 0 },
			{ x: imgSize.w, y: 0 },
			{ x: imgSize.w, y: imgSize.h },
			{ x: 0, y: imgSize.h },
		];

		const dstCorners: Point[] = corners.map(p => ({
			x: p.x + SIDE_PADDING,
			y: p.y + TOP_PADDING,
		}));

		applyPerspectiveTransform(srcCanvas, destCanvas, srcCorners, dstCorners);

		ctx.drawImage(destCanvas, 0, 0);

		// Draw corner controls
		for (let i = 0; i < corners.length; i++) {
			const p = corners[i];
			const x = p.x + SIDE_PADDING;
			const y = p.y + TOP_PADDING;

			// Corner circle
			ctx.fillStyle = CORNER_COLORS[i];
			ctx.beginPath();
			ctx.arc(x, y, CORNER_RADIUS, 0, Math.PI * 2);
			ctx.fill();

			// Corner label
			ctx.fillStyle = '#fff';
			ctx.font = 'bold 12px sans-serif';
			ctx.textAlign = 'center';
			ctx.textBaseline = 'middle';
			ctx.fillText(CORNER_LABELS[i], x, y);
		}
	}, [corners, imgSize.w, imgSize.h, TOP_PADDING, SIDE_PADDING]);

	// Mouse/touch event handlers
	const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
		const canvas = canvasRef.current;
		if (!canvas) return;
		const rect = canvas.getBoundingClientRect();
		const x = (e.clientX - rect.left) * (canvas.width / rect.width);
		const y = (e.clientY - rect.top) * (canvas.height / rect.height);

		for (let i = 0; i < corners.length; i++) {
			const p = corners[i];
			const dx = x - (p.x + SIDE_PADDING);
			const dy = y - (p.y + TOP_PADDING);
			if (dx * dx + dy * dy <= CORNER_RADIUS * CORNER_RADIUS * 4) {
				// Save current state to history before starting to drag
				setCornersHistory(prev => [...prev, corners]);
				setCornersFuture([]);
				setDragging(i);
				return;
			}
		}
	};

	const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
		if (dragging === null) return;

		const canvas = canvasRef.current;
		if (!canvas) return;
		const rect = canvas.getBoundingClientRect();
		const x = (e.clientX - rect.left) * (canvas.width / rect.width);
		const y = (e.clientY - rect.top) * (canvas.height / rect.height);

		const newCorners = [...corners];
		newCorners[dragging] = {
			x: Math.max(-SIDE_PADDING, Math.min(imgSize.w + SIDE_PADDING, x - SIDE_PADDING)),
			y: Math.max(-TOP_PADDING, Math.min(imgSize.h + BOTTOM_PADDING, y - TOP_PADDING)),
		};
		setCorners(newCorners);
	};

	const handleMouseUp = () => {
		setDragging(null);
	};

	const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
		e.preventDefault();
		const delta = e.deltaY > 0 ? -0.2 : 0.2;
		const newZoom = Math.max(0.2, Math.min(3, zoom + delta));
		setZoom(newZoom);
	};

	const handleZoomIn = () => {
		setZoom(z => Math.min(3, z + 0.2));
	};

	const handleZoomOut = () => {
		setZoom(z => Math.max(0.2, z - 0.2));
	};

	const handleZoomReset = () => {
		setZoom(1);
	};

	const handleUndo = () => {
		if (cornersHistory.length === 0) return;
		const newHistory = [...cornersHistory];
		const previousCorners = newHistory.pop()!;
		setCornersHistory(newHistory);
		setCornersFuture(prev => [...prev, corners]);
		setCorners(previousCorners);
	};

	const handleRedo = () => {
		if (cornersFuture.length === 0) return;
		const newFuture = [...cornersFuture];
		const nextCorners = newFuture.pop()!;
		setCornersFuture(newFuture);
		setCornersHistory(prev => [...prev, corners]);
		setCorners(nextCorners);
	};

	// Re-render on state change
	useEffect(() => {
		render();
	}, [render]);

	const handleReset = () => {
		setCornersHistory(prev => [...prev, corners]);
		setCornersFuture([]);
		setCorners([...initialCorners]);
	};

	const handleApply = () => {
		if (!srcCanvasRef.current) return;

		const destCanvas = document.createElement('canvas');
		destCanvas.width = displayW;
		destCanvas.height = displayH;

		const srcCorners: Point[] = [
			{ x: 0, y: 0 },
			{ x: imgSize.w, y: 0 },
			{ x: imgSize.w, y: imgSize.h },
			{ x: 0, y: imgSize.h },
		];

		const dstCorners: Point[] = corners.map(p => ({
			x: p.x + SIDE_PADDING,
			y: p.y + TOP_PADDING,
		}));

		applyPerspectiveTransform(srcCanvasRef.current, destCanvas, srcCorners, dstCorners);

		// Create a drawable canvas from the transformed result
		const resultCanvas = document.createElement('canvas');
		resultCanvas.width = imgSize.w;
		resultCanvas.height = imgSize.h;
		const rctx = resultCanvas.getContext('2d')!;

		// Find bounds of transformed content
		let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
		const bounds: Point[] = dstCorners;
		for (const p of bounds) {
			minX = Math.min(minX, p.x);
			minY = Math.min(minY, p.y);
			maxX = Math.max(maxX, p.x);
			maxY = Math.max(maxY, p.y);
		}

		// Calculate center point displacement
		const originalCenter = { x: imgSize.w / 2, y: imgSize.h / 2 };
		const boundsCenterX = (minX + maxX) / 2;
		const boundsCenterY = (minY + maxY) / 2;
		const offsetX = boundsCenterX - originalCenter.x;
		const offsetY = boundsCenterY - originalCenter.y;

		if (minX < maxX && minY < maxY) {
			const w = maxX - minX;
			const h = maxY - minY;
			rctx.drawImage(destCanvas, minX, minY, w, h, 0, 0, imgSize.w, imgSize.h);
		}

		onApply?.(resultCanvas, { offsetX, offsetY });
		onClose?.();
	};

	if (!imageLoaded) {
		return (
			<div
				style={{
					position: 'fixed',
					top: 0,
					left: 0,
					right: 0,
					bottom: 0,
					display: 'flex',
					alignItems: 'center',
					justifyContent: 'center',
					background: 'rgba(0,0,0,0.5)',
					zIndex: 1000,
				}}
			>
				<div style={{ background: '#fff', padding: 24, borderRadius: 8, textAlign: 'center' }}>
					<p>请先选择一个图层</p>
					<button onClick={onClose}>关闭</button>
				</div>
			</div>
		);
	}

	return (
		<div
			style={{
				position: 'fixed',
				top: 0,
				left: 0,
				right: 0,
				bottom: 0,
				display: 'flex',
				alignItems: 'center',
				justifyContent: 'center',
				background: 'rgba(0,0,0,0.5)',
				zIndex: 1000,
			}}
			onClick={(e) => {
				if (e.target === e.currentTarget) onClose?.();
			}}
		>
			<div
				style={{
					background: '#1e1e2e',
					borderRadius: 8,
					overflow: 'hidden',
					display: 'flex',
					flexDirection: 'column',
					maxWidth: '90vw',
					maxHeight: '90vh',
				}}
			>
				<div style={{ padding: 16, borderBottom: '1px solid #333' }}>
					<h3 style={{ margin: 0, color: '#fff' }}>网格透视拉伸工具</h3>
					<p style={{ margin: '4px 0 0 0', fontSize: 12, color: '#999' }}>拖动四个角点进行透视变换</p>
				</div>

			{/* Zoom Control Bar */}
			<div style={{
				padding: '8px 16px',
				borderBottom: '1px solid #333',
				display: 'flex',
				gap: 8,
				alignItems: 'center',
				background: '#1a1c2e',
			}}>
				<button
					onClick={handleZoomOut}
					style={{
						padding: '4px 8px',
						background: '#444',
						color: '#fff',
						border: 'none',
						borderRadius: 4,
						cursor: 'pointer',
						fontSize: 12,
					}}
				>
					−
				</button>
				<button
					onClick={handleZoomReset}
					style={{
						padding: '4px 8px',
						background: '#444',
						color: '#fff',
						border: 'none',
						borderRadius: 4,
						cursor: 'pointer',
						fontSize: 12,
						minWidth: 50,
					}}
				>
					{Math.round(zoom * 100)}%
				</button>
				<button
					onClick={handleZoomIn}
					style={{
						padding: '4px 8px',
						background: '#444',
						color: '#fff',
						border: 'none',
						borderRadius: 4,
						cursor: 'pointer',
						fontSize: 12,
					}}
				>
					+
				</button>
				<div style={{ width: 1, height: 20, background: '#444', margin: '0 4px' }} />
				<button
					onClick={handleUndo}
					disabled={cornersHistory.length === 0}
					style={{
						padding: '4px 8px',
						background: cornersHistory.length === 0 ? '#333' : '#444',
						color: '#fff',
						border: 'none',
						borderRadius: 4,
						cursor: cornersHistory.length === 0 ? 'not-allowed' : 'pointer',
						fontSize: 12,
						opacity: cornersHistory.length === 0 ? 0.5 : 1,
					}}
				>
					↶
				</button>
				<button
					onClick={handleRedo}
					disabled={cornersFuture.length === 0}
					style={{
						padding: '4px 8px',
						background: cornersFuture.length === 0 ? '#333' : '#444',
						color: '#fff',
						border: 'none',
						borderRadius: 4,
						cursor: cornersFuture.length === 0 ? 'not-allowed' : 'pointer',
						fontSize: 12,
						opacity: cornersFuture.length === 0 ? 0.5 : 1,
					}}
				>
					↷
				</button>
				<span style={{ fontSize: 12, color: '#999', marginLeft: 'auto' }}>
					滚轮缩放
				</span>
			</div>

			<div
				style={{
					flex: 1,
					overflow: 'auto',
					background: '#0a0a0f',
					display: 'flex',
					alignItems: 'center',
					justifyContent: 'center',
					padding: 16,
					minHeight: 700,
				}}
				>
					<canvas
						ref={canvasRef}
						onMouseDown={handleMouseDown}
						onMouseMove={handleMouseMove}
						onMouseUp={handleMouseUp}
						onMouseLeave={handleMouseUp}
						onWheel={handleWheel}
						style={{
							cursor: dragging !== null ? 'grabbing' : 'grab',
							maxWidth: '100%',
							display: 'block',
							transform: `scale(${zoom})`,
							transformOrigin: 'center center',
							transition: 'transform 0.05s ease-out',
						}}
					/>
				</div>

				<div
					style={{
					padding: 8,
					borderTop: '1px solid #333',
					display: 'flex',
					gap: 6,
						justifyContent: 'flex-end',
					}}
				>
					<button
						onClick={handleReset}
						style={{
							padding: '6px 12px',
							background: '#444',
							color: '#fff',
							border: 'none',
							borderRadius: 4,
							cursor: 'pointer',
							fontSize: 12,
						}}
					>
						重置
					</button>
					<button
						onClick={handleApply}
						style={{
							padding: '6px 12px',
							background: '#3b82f6',
							color: '#fff',
							border: 'none',
							borderRadius: 4,
							cursor: 'pointer',
							fontSize: 12,
						}}
					>
						应用
					</button>
					<button
						onClick={onClose}
						style={{
							padding: '6px 12px',
							background: '#666',
							color: '#fff',
							border: 'none',
							borderRadius: 4,
							cursor: 'pointer',
							fontSize: 12,
						}}
					>
						关闭
					</button>
				</div>
			</div>
		</div>
	);
};

export default PerspectiveTool;
