interface GridRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export function gridCellFromPointer(rect: GridRect, columns: number, rows: number, clientX: number, clientY: number) {
  const safeColumns = Math.max(1, Math.floor(columns));
  const safeRows = Math.max(1, Math.floor(rows));
  const relativeX = Math.max(0, Math.min(rect.width - Number.EPSILON, clientX - rect.left));
  const relativeY = Math.max(0, Math.min(rect.height - Number.EPSILON, clientY - rect.top));
  return {
    column: Math.min(safeColumns - 1, Math.floor(relativeX / (rect.width / safeColumns))),
    row: Math.min(safeRows - 1, Math.floor(relativeY / (rect.height / safeRows)))
  };
}
