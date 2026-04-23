// ExportPanel.tsx — segment-aware export
import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open as dialogOpen } from '@tauri-apps/plugin-dialog';
import type { VirtualCamera, VideoMeta, Segment } from './types';

interface Props {
  videoPath: string | null;
  videoMeta: VideoMeta | null;
  cameras: VirtualCamera[];
  segments: Segment[];
}

export default function ExportPanel({ videoPath, videoMeta, cameras, segments }: Props) {
  const [outWidth, setOutWidth] = useState(1920);
  const [outHeight, setOutHeight] = useState(1080);
  const [outputDir, setOutputDir] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [frameStep, setFrameStep] = useState(1);

  const fps = videoMeta?.fps ?? 30;
  const frameToMs = (f: number) => Math.round((f / fps) * 1000);
  const msToFrame = (ms: number) => Math.round((ms * fps) / 1000);

  const pickOutputDir = async () => {
    const dir = await dialogOpen({ directory: true, multiple: false, title: 'Select output folder' });
    if (typeof dir === 'string') setOutputDir(dir);
  };

  // Count total files that will be exported
  const totalFiles = segments.reduce((acc, seg) => {
    const enabledCams = seg.enabledCameraIds.filter(cid => cameras.some(c => c.id === cid));
    const startFrame = msToFrame(seg.startMs);
    const endFrame = msToFrame(seg.endMs);
    const frameCount = Math.max(0, Math.floor((endFrame - startFrame) / Math.max(1, frameStep)) + 1);
    return acc + frameCount * enabledCams.length;
  }, 0);

  const doExport = async () => {
    if (!videoPath || !outputDir || segments.length === 0) return;
    setExporting(true);
    setResult(null);
    setError(null);
    setProgress(null);

    let totalWritten = 0;

    try {
      for (let i = 0; i < segments.length; i++) {
        const seg = segments[i];
        const enabledCams = cameras.filter(c => seg.enabledCameraIds.includes(c.id));
        if (enabledCams.length === 0) continue;

        setProgress(`Segment ${i + 1}/${segments.length}: "${seg.label}" (${enabledCams.length} cameras)…`);

        const camsPayload = enabledCams.map(({ id, color: _color, use_video_res, ...rest }) => ({
          ...rest,
          id,
          out_width: use_video_res && videoMeta ? videoMeta.width : rest.out_width,
          out_height: use_video_res && videoMeta ? videoMeta.height : rest.out_height,
        }));

        const segLabel = seg.label.replace(/[^a-zA-Z0-9_\-]/g, '_');

        const written: string[] = await invoke('export_fovs', {
          path: videoPath,
          startMs: seg.startMs,
          endMs: seg.endMs,
          frameStep: Math.max(1, frameStep),
          cameras: camsPayload,
          outWidth,
          outHeight,
          outputDir,
          filePrefix: segLabel,
        });

        totalWritten += written.length;
      }

      setResult(`Exported ${totalWritten} file${totalWritten !== 1 ? 's' : ''} to ${outputDir}`);
    } catch (e: any) {
      setError(String(e));
    } finally {
      setExporting(false);
      setProgress(null);
    }
  };

  const canExport = !!videoPath && !!outputDir && segments.length > 0 && !exporting;

  return (
    <div className="export-panel">
      <h2>Export</h2>

      {/* Global resolution */}
      <div className="export-row">
        <label>Resolution</label>
        <input type="number" value={outWidth} min={64} max={8192} step={1}
          onChange={e => setOutWidth(parseInt(e.target.value, 10))} />
        <span style={{ color: '#666', fontSize: 11 }}>×</span>
        <input type="number" value={outHeight} min={64} max={8192} step={1}
          onChange={e => setOutHeight(parseInt(e.target.value, 10))} />
      </div>

      <div className="export-row">
        <label>Every N frames</label>
        <input type="number" value={frameStep} min={1} max={1000} step={1}
          disabled={!videoMeta}
          onChange={e => setFrameStep(Math.max(1, parseInt(e.target.value, 10) || 1))} />
      </div>

      {/* Segment summary */}
      <div className="export-segment-summary">
        {segments.length === 0 ? (
          <span style={{ color: '#666', fontSize: 11 }}>No segments defined. Add segments on the timeline.</span>
        ) : (
          <>
            <span style={{ fontSize: 11, color: '#888', marginBottom: 4, display: 'block' }}>
              {segments.length} segment{segments.length !== 1 ? 's' : ''} → ~{totalFiles} files
            </span>
            {segments.map(seg => {
              const enabledCount = seg.enabledCameraIds.filter(cid => cameras.some(c => c.id === cid)).length;
              const startFrame = msToFrame(seg.startMs);
              const endFrame = msToFrame(seg.endMs);
              const frameCount = Math.max(0, Math.floor((endFrame - startFrame) / Math.max(1, frameStep)) + 1);
              return (
                <div key={seg.id} className="export-seg-item">
                  <span className="export-seg-label">{seg.label}</span>
                  <span style={{ color: '#888', fontSize: 10 }}>
                    {frameCount} frames × {enabledCount} cam = {frameCount * enabledCount} files
                  </span>
                </div>
              );
            })}
          </>
        )}
      </div>

      {/* Output folder */}
      <div className="export-row">
        <label>Output folder</label>
        <span className="path-display">{outputDir ?? '(none)'}</span>
        <button className="btn" onClick={pickOutputDir} style={{ flexShrink: 0 }}>Browse</button>
      </div>

      {progress && (
        <div style={{ fontSize: 11, color: '#60a5fa', marginTop: 4 }}>{progress}</div>
      )}

      <button
        className="btn success"
        style={{ width: '100%', marginTop: 4 }}
        disabled={!canExport}
        onClick={doExport}
      >
        {exporting ? 'Exporting…' : `Export ${segments.length} segment${segments.length !== 1 ? 's' : ''} as PNG`}
      </button>

      {result && <div className="export-result">{result}</div>}
      {error && <div className="export-error">{error}</div>}
    </div>
  );
}
