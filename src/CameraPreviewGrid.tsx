// CameraPreviewGrid.tsx — collapsible horizontal strip of camera thumbnails below the viewport
import { useState } from 'react';
import type { VirtualCamera } from './types';

interface Props {
  cameras: VirtualCamera[];
  previews: Record<string, string>;  // cameraId → base64 JPEG
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export default function CameraPreviewGrid({ cameras, previews, selectedId, onSelect }: Props) {
  const [collapsed, setCollapsed] = useState(false);

  if (cameras.length === 0) return null;

  return (
    <div className="preview-strip">
      {/* Toggle bar */}
      <div className="preview-strip-header" onClick={() => setCollapsed(v => !v)}>
        <span>Camera Previews ({cameras.length})</span>
        <span className="preview-strip-toggle">{collapsed ? '▲' : '▼'}</span>
      </div>

      {/* Thumbnail row */}
      {!collapsed && (
        <div className="preview-strip-row">
          {cameras.map(cam => {
            const thumb = previews[cam.id];
            const isSelected = cam.id === selectedId;
            return (
              <div
                key={cam.id}
                className={`preview-strip-item ${isSelected ? 'selected' : ''}`}
                style={{ borderColor: isSelected ? cam.color : undefined }}
                onClick={() => onSelect(cam.id)}
                title={cam.name}
              >
                {thumb ? (
                  <img
                    src={`data:image/jpeg;base64,${thumb}`}
                    alt={cam.name}
                    draggable={false}
                  />
                ) : (
                  <div className="preview-strip-placeholder">
                    <span>No preview</span>
                  </div>
                )}
                <div
                  className="preview-strip-label"
                  style={{ borderTop: `2px solid ${cam.color}` }}
                >
                  {cam.name}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
