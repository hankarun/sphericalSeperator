// Timeline.tsx — two-row timeline: top = frame scrubber, bottom = segment bar
import { useRef, useCallback } from 'react';
import type { VideoMeta, Segment, VirtualCamera } from './types';

interface Props {
  meta: VideoMeta | null;
  timestampMs: number;
  onChange: (ms: number) => void;
  segments: Segment[];
  selectedSegmentId: string | null;
  cameras: VirtualCamera[];
  onSegmentSelect: (id: string | null) => void;
  onSegmentAdd: (startMs: number, endMs: number) => void;
  onSegmentDelete: (id: string) => void;
  onSegmentUpdate: (id: string, patch: Partial<Segment>) => void;
}

function formatMs(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  const frames = Math.floor((ms % 1000) / (1000 / 30));
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(frames).padStart(2, '0')}`;
}

const SEGMENT_COLORS = [
  '#3b82f6', '#10b981', '#f59e0b', '#ef4444',
  '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16',
];

const SNAP_PX = 8;

export default function Timeline({
  meta,
  timestampMs,
  onChange,
  segments,
  selectedSegmentId,
  cameras,
  onSegmentSelect,
  onSegmentAdd,
  onSegmentDelete,
  onSegmentUpdate,
}: Props) {
  const duration = meta?.duration_ms ?? 0;
  const scrubBarRef = useRef<HTMLDivElement>(null);
  const segBarRef = useRef<HTMLDivElement>(null);

  const segDragRef = useRef<{
    type: 'move' | 'left' | 'right';
    segId: string;
    startX: number;
    origStart: number;
    origEnd: number;
    barWidth: number;
  } | null>(null);

  const msToFrac = (ms: number) => duration > 0 ? ms / duration : 0;

  const clientXtoMs = (clientX: number, ref: React.RefObject<HTMLDivElement | null>) => {
    const bar = ref.current;
    if (!bar) return 0;
    const rect = bar.getBoundingClientRect();
    const frac = (clientX - rect.left) / rect.width;
    return Math.round(Math.max(0, Math.min(1, frac)) * duration);
  };

  // ── Scrub bar mouse handling ─────────────────────────────────────────────
  const onScrubMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (!meta || e.button !== 0) return;
      e.preventDefault();
      const ms = clientXtoMs(e.clientX, scrubBarRef);
      onChange(ms);

      const onMouseMove = (ev: MouseEvent) => onChange(clientXtoMs(ev.clientX, scrubBarRef));
      const onMouseUp = () => {
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
      };
      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
    },
    [meta, onChange]
  );

  // ── Segment drag ─────────────────────────────────────────────────────────
  const startSegDrag = useCallback(
    (e: React.MouseEvent, segId: string, type: 'move' | 'left' | 'right') => {
      e.stopPropagation();
      e.preventDefault();
      const bar = segBarRef.current;
      if (!bar) return;
      const seg = segments.find(s => s.id === segId);
      if (!seg) return;
      const rect = bar.getBoundingClientRect();
      segDragRef.current = {
        type, segId,
        startX: e.clientX,
        origStart: seg.startMs,
        origEnd: seg.endMs,
        barWidth: rect.width,
      };
      onSegmentSelect(segId);

      const snapThresholdMs = (SNAP_PX / rect.width) * duration;

      const snap = (val: number) => {
        const otherEdges = segments
          .filter(s => s.id !== segId)
          .flatMap(s => [s.startMs, s.endMs]);
        const targets = [0, duration, ...otherEdges];
        let best = val;
        let bestDist = snapThresholdMs;
        for (const t of targets) {
          const dist = Math.abs(val - t);
          if (dist < bestDist) { bestDist = dist; best = t; }
        }
        return best;
      };

      const onMouseMove = (ev: MouseEvent) => {
        const d = segDragRef.current;
        if (!d) return;
        const dx = ev.clientX - d.startX;
        const dms = Math.round((dx / d.barWidth) * duration);
        const minLen = Math.max(500, Math.round(duration * 0.005));

        if (d.type === 'left') {
          const raw = Math.max(0, Math.min(d.origStart + dms, d.origEnd - minLen));
          onSegmentUpdate(d.segId, { startMs: snap(raw) });
        } else if (d.type === 'right') {
          const raw = Math.min(duration, Math.max(d.origEnd + dms, d.origStart + minLen));
          onSegmentUpdate(d.segId, { endMs: snap(raw) });
        } else {
          const len = d.origEnd - d.origStart;
          const rawStart = Math.max(0, Math.min(d.origStart + dms, duration - len));
          const rawEnd = rawStart + len;
          const snappedStart = snap(rawStart);
          const snappedEnd = snap(rawEnd);
          const distStart = Math.abs(snappedStart - rawStart);
          const distEnd = Math.abs(snappedEnd - rawEnd);
          const finalStart = distStart <= distEnd ? snappedStart : snappedEnd - len;
          const clamped = Math.max(0, Math.min(finalStart, duration - len));
          onSegmentUpdate(d.segId, { startMs: clamped, endMs: clamped + len });
        }
      };

      const onMouseUp = () => {
        segDragRef.current = null;
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
      };
      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
    },
    [segments, duration, onSegmentSelect, onSegmentUpdate]
  );

  // ── Segment bar background click/dblclick ────────────────────────────────
  const onSegBarMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (!meta || e.button !== 0) return;
      if ((e.target as HTMLElement).closest('.seg-block')) return;
      // click on empty area → deselect + scrub
      onSegmentSelect(null);
      onChange(clientXtoMs(e.clientX, segBarRef));
    },
    [meta, onChange, onSegmentSelect]
  );

  const onSegBarDblClick = useCallback(
    (e: React.MouseEvent) => {
      if (!meta) return;
      if ((e.target as HTMLElement).closest('.seg-block')) return;
      const clickMs = clientXtoMs(e.clientX, segBarRef);
      const halfLen = Math.max(500, Math.round(duration * 0.05));
      const newStart = Math.max(0, clickMs - halfLen);
      const newEnd = Math.min(duration, clickMs + halfLen);
      onSegmentAdd(newStart, newEnd);
    },
    [meta, duration, onSegmentAdd]
  );

  const selectedSeg = segments.find(s => s.id === selectedSegmentId) ?? null;

  return (
    <div className="timeline">
      {/* ── Row 1: frame scrubber ── */}
      <div className="tl-row">
        <span className="tl-time">{formatMs(timestampMs)}</span>
        <div
          ref={scrubBarRef}
          className="scrub-bar"
          onMouseDown={onScrubMouseDown}
        >
          {/* playhead */}
          {meta && (
            <div
              className="scrub-playhead"
              style={{ left: `${msToFrac(timestampMs) * 100}%` }}
            />
          )}
          {!meta && <span className="tl-bar-hint">Open a video to begin</span>}
        </div>
        <span className="tl-time tl-time-right">{formatMs(duration)}</span>
      </div>

      {/* ── Row 2: segment bar ── */}
      <div className="tl-row" style={{ marginTop: 4 }}>
        <span className="tl-time" style={{ visibility: 'hidden' }}>{formatMs(0)}</span>
        <div
          ref={segBarRef}
          className="seg-bar"
          onMouseDown={onSegBarMouseDown}
          onDoubleClick={onSegBarDblClick}
        >
          {segments.map((seg, i) => {
            const left = msToFrac(seg.startMs) * 100;
            const width = msToFrac(seg.endMs - seg.startMs) * 100;
            const color = SEGMENT_COLORS[i % SEGMENT_COLORS.length];
            const isSelected = seg.id === selectedSegmentId;
            return (
              <div
                key={seg.id}
                className={`seg-block${isSelected ? ' selected' : ''}`}
                style={{
                  left: `${left}%`,
                  width: `${width}%`,
                  background: color,
                  opacity: isSelected ? 1 : 0.75,
                  borderColor: isSelected ? '#fff' : 'transparent',
                }}
                onMouseDown={e => startSegDrag(e, seg.id, 'move')}
              >
                <div className="seg-handle seg-handle-left" onMouseDown={e => startSegDrag(e, seg.id, 'left')} />
                <span className="seg-label">{seg.label}</span>
                <span className="seg-cam-badge">
                  {seg.enabledCameraIds.filter(cid => cameras.some(c => c.id === cid)).length}/{cameras.length}
                </span>
                <div className="seg-handle seg-handle-right" onMouseDown={e => startSegDrag(e, seg.id, 'right')} />
              </div>
            );
          })}

          {/* playhead marker on segment bar */}
          {meta && (
            <div
              className="seg-playhead"
              style={{ left: `${msToFrac(timestampMs) * 100}%` }}
            />
          )}

          {segments.length === 0 && meta && (
            <span className="tl-bar-hint">Double-click to add a segment</span>
          )}
        </div>
        <span className="tl-time tl-time-right" style={{ visibility: 'hidden' }}>{formatMs(0)}</span>
      </div>

      {/* ── Segment editor ── */}
      {selectedSeg && (
        <div className="segment-editor">
          <div className="seg-editor-header">
            <input
              className="seg-name-input"
              value={selectedSeg.label}
              onChange={e => onSegmentUpdate(selectedSeg.id, { label: e.target.value })}
              placeholder="Segment name"
            />
            <button
              className="btn danger"
              style={{ flexShrink: 0, padding: '3px 10px', fontSize: 11 }}
              onClick={() => onSegmentDelete(selectedSeg.id)}
              title="Delete this segment"
            >
              Delete
            </button>
          </div>

          <div className="seg-time-row">
            <label>Start</label>
            <input
              type="number"
              min={0}
              max={duration}
              value={Math.round(selectedSeg.startMs)}
              onChange={e => {
                const v = Math.max(0, Math.min(parseInt(e.target.value, 10) || 0, selectedSeg.endMs - 1));
                onSegmentUpdate(selectedSeg.id, { startMs: v });
              }}
            />
            <span className="tl-unit">ms</span>
            <span className="tl-fmt">{formatMs(selectedSeg.startMs)}</span>
            <label style={{ marginLeft: 12 }}>End</label>
            <input
              type="number"
              min={0}
              max={duration}
              value={Math.round(selectedSeg.endMs)}
              onChange={e => {
                const v = Math.max(selectedSeg.startMs + 1, Math.min(parseInt(e.target.value, 10) || 0, duration));
                onSegmentUpdate(selectedSeg.id, { endMs: v });
              }}
            />
            <span className="tl-unit">ms</span>
            <span className="tl-fmt">{formatMs(selectedSeg.endMs)}</span>
          </div>

          <div className="seg-cameras">
            <span className="seg-cameras-label">Cameras in this segment:</span>
            <div className="seg-camera-list">
              {cameras.length === 0 && <span style={{ fontSize: 11, color: '#555' }}>No cameras defined</span>}
              {cameras.map(cam => {
                const enabled = selectedSeg.enabledCameraIds.includes(cam.id);
                return (
                  <label key={cam.id} className="seg-camera-toggle">
                    <input
                      type="checkbox"
                      checked={enabled}
                      onChange={() => {
                        const next = enabled
                          ? selectedSeg.enabledCameraIds.filter(id => id !== cam.id)
                          : [...selectedSeg.enabledCameraIds, cam.id];
                        onSegmentUpdate(selectedSeg.id, { enabledCameraIds: next });
                      }}
                    />
                    <span className="cam-color-dot" style={{ background: cam.color }} />
                    <span>{cam.name}</span>
                  </label>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
