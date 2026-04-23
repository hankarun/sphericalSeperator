// CameraList.tsx — sidebar camera management panel
import type { VirtualCamera, VideoMeta } from './types';

interface Props {
  cameras: VirtualCamera[];
  selectedId: string | null;
  videoMeta: VideoMeta | null;
  onSelect: (id: string) => void;
  onUpdate: (id: string, patch: Partial<VirtualCamera>) => void;
  onDelete: (id: string) => void;
  onAdd: () => void;
}

function SliderRow({
  label, min, max, step, value, onChange,
}: {
  label: string; min: number; max: number; step: number;
  value: number; onChange: (v: number) => void;
}) {
  return (
    <div className="control-row">
      <label>{label}</label>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(parseFloat(e.target.value))} />
      <input type="number" min={min} max={max} step={step} value={value}
        onChange={e => onChange(parseFloat(e.target.value))} />
    </div>
  );
}

export default function CameraList({
  cameras, selectedId, videoMeta,
  onSelect, onUpdate, onDelete, onAdd,
}: Props) {
  return (
    <div className="sidebar-section" style={{
      flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', padding: 0,
    }}>
      {/* Header */}
      <div style={{
        padding: '10px 12px 6px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        borderBottom: '1px solid #2a2a2a', flexShrink: 0,
      }}>
        <h2 style={{ margin: 0 }}>Cameras ({cameras.length})</h2>
        <button className="btn primary" onClick={onAdd}
          style={{ padding: '3px 10px', fontSize: '11px' }}>
          + Add
        </button>
      </div>

      {/* Camera items */}
      <div className="camera-list">
        {cameras.length === 0 && (
          <div style={{ color: '#555', fontSize: '11px', textAlign: 'center', marginTop: 24 }}>
            Click on the sphere or press "+ Add" to place a camera
          </div>
        )}

        {cameras.map((cam) => {
          const isSelected = cam.id === selectedId;

          return (
            <div key={cam.id}
              className={`camera-item ${isSelected ? 'selected' : ''}`}>

              {/* ── Header row ── */}
              <div className="camera-header" onClick={() => onSelect(cam.id)}>
                <span className="camera-dot" style={{ background: cam.color }} />
                <input
                  className="camera-name-input"
                  value={cam.name}
                  onClick={e => e.stopPropagation()}
                  onChange={e => onUpdate(cam.id, { name: e.target.value })}
                />
                <span className="camera-fov-badge">{cam.fov_h_deg}°</span>
                <button className="camera-delete-btn"
                  onClick={e => { e.stopPropagation(); onDelete(cam.id); }}
                  title="Delete camera">×</button>
              </div>

              {/* ── Expanded controls (selected only) ── */}
              {isSelected && (
                <div className="camera-controls">
                  <SliderRow label="Yaw" min={-180} max={180} step={0.5}
                    value={cam.yaw_deg} onChange={v => onUpdate(cam.id, { yaw_deg: v })} />
                  <SliderRow label="Pitch" min={-90} max={90} step={0.5}
                    value={cam.pitch_deg} onChange={v => onUpdate(cam.id, { pitch_deg: v })} />
                  <SliderRow label="Roll" min={-180} max={180} step={0.5}
                    value={cam.roll_deg} onChange={v => onUpdate(cam.id, { roll_deg: v })} />
                  <SliderRow label="FOV (H)" min={10} max={180} step={1}
                    value={cam.fov_h_deg} onChange={v => onUpdate(cam.id, { fov_h_deg: v })} />

                  {/* Resolution section */}
                  <div className="control-row" style={{ marginTop: 4 }}>
                    <label style={{ fontSize: 10, color: '#777', width: 70 }}>Resolution</label>
                    <label className="checkbox-label">
                      <input
                        type="checkbox"
                        checked={cam.use_video_res}
                        onChange={e => onUpdate(cam.id, { use_video_res: e.target.checked })}
                      />
                      Use video res
                      {cam.use_video_res && videoMeta
                        ? <span style={{ color: '#888', marginLeft: 4 }}>
                            ({videoMeta.width}×{videoMeta.height})
                          </span>
                        : null}
                    </label>
                  </div>

                  {!cam.use_video_res && (
                    <div className="control-row">
                      <label style={{ fontSize: 10, color: '#777', width: 70 }}>W × H</label>
                      <input type="number" min={64} max={8192} step={1}
                        style={{ width: 56 }}
                        value={cam.out_width === 0 ? '' : cam.out_width}
                        placeholder="global"
                        onChange={e => onUpdate(cam.id, {
                          out_width: e.target.value === '' ? 0 : parseInt(e.target.value, 10),
                        })}
                      />
                      <span style={{ color: '#555', fontSize: 11, padding: '0 4px' }}>×</span>
                      <input type="number" min={64} max={8192} step={1}
                        style={{ width: 56 }}
                        value={cam.out_height === 0 ? '' : cam.out_height}
                        placeholder="global"
                        onChange={e => onUpdate(cam.id, {
                          out_height: e.target.value === '' ? 0 : parseInt(e.target.value, 10),
                        })}
                      />
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
