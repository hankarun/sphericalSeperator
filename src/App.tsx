// App.tsx — main application shell
import { useState, useCallback, useRef, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open as dialogOpen } from '@tauri-apps/plugin-dialog';
import './App.css';
import Viewport3D from './Viewport3D';
import CameraList from './CameraList';
import Timeline from './Timeline';
import ExportPanel from './ExportPanel';
import CameraPreviewGrid from './CameraPreviewGrid';
import type { VirtualCamera, VideoMeta, Segment } from './types';
import { defaultCamera, createPreset6Cameras, defaultSegment } from './types';

let cameraIdCounter = 0;
let segmentIdCounter = 0;
function newCamId() { return `cam-${++cameraIdCounter}`; }
function newSegId() { return `seg-${++segmentIdCounter}`; }

function App() {
  const [videoPath, setVideoPath] = useState<string | null>(null);
  const [videoMeta, setVideoMeta] = useState<VideoMeta | null>(null);
  const [timestampMs, setTimestampMs] = useState(0);
  const [frameDataUrl, setFrameDataUrl] = useState<string | null>(null);
  const [frameLoading, setFrameLoading] = useState(false);
  const [cameras, setCameras] = useState<VirtualCamera[]>([]);
  const [selectedCameraId, setSelectedCameraId] = useState<string | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  const [cameraPreviews, setCameraPreviews] = useState<Record<string, string>>({});
  const [segments, setSegments] = useState<Segment[]>([]);
  const [selectedSegmentId, setSelectedSegmentId] = useState<string | null>(null);
  const frameDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previewDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const timestampMsRef = useRef(0);

  // Refresh all camera previews (debounced)
  const refreshPreviews = useCallback((path: string, ms: number, cams: VirtualCamera[]) => {
    if (cams.length === 0) return;
    if (previewDebounceRef.current) clearTimeout(previewDebounceRef.current);
    previewDebounceRef.current = setTimeout(async () => {
      try {
        const result = await invoke<Record<string, string>>('get_all_camera_previews', {
          path,
          timestampMs: ms,
          cameras: cams,
          previewWidth: 240,
          previewHeight: 135,
        });
        setCameraPreviews(result);
      } catch (e) {
        console.error('get_all_camera_previews failed:', e);
      }
    }, 400);
  }, []);

  // Load a frame at the given timestamp (debounced 150ms — for scrubbing)
  const loadFrame = useCallback((path: string, ms: number) => {
    if (frameDebounceRef.current) clearTimeout(frameDebounceRef.current);
    frameDebounceRef.current = setTimeout(async () => {
      setFrameLoading(true);
      try {
        const b64: string = await invoke('get_frame', { path, timestampMs: ms });
        setFrameDataUrl(`data:image/jpeg;base64,${b64}`);
      } catch (e) {
        console.error('get_frame failed:', e);
      } finally {
        setFrameLoading(false);
      }
    }, 150);
  }, []);

  // Re-fetch previews whenever cameras or timestamp change (if video is loaded)
  useEffect(() => {
    if (videoPath && cameras.length > 0) {
      refreshPreviews(videoPath, timestampMs, cameras);
    }
  }, [cameras, timestampMs, videoPath, refreshPreviews]);

  // Open video file
  const openVideo = async () => {
    setOpenError(null);
    try {
      const selected = await dialogOpen({
        multiple: false,
        filters: [{ name: 'Video', extensions: ['mp4', 'mov', 'mkv', 'avi', 'webm', 'ts'] }],
        title: 'Open 360 Video',
      });
      if (!selected || typeof selected !== 'string') return;
      const meta: VideoMeta = await invoke('open_video', { path: selected });
      setVideoPath(selected);
      setVideoMeta(meta);
      setTimestampMs(0);
      timestampMsRef.current = 0;
      // Create a default full-length segment with all current cameras enabled
      const defId = newSegId();
      const defSeg = defaultSegment(defId, 0, 0, meta.duration_ms);
      setCameras(prev => {
        defSeg.enabledCameraIds = prev.map(c => c.id);
        return prev;
      });
      setSegments([defSeg]);
      setSelectedSegmentId(defId);
      loadFrame(selected, 0);
    } catch (e: any) {
      setOpenError(String(e));
    }
  };

  // Scrub timeline
  const handleTimestampChange = (ms: number) => {
    timestampMsRef.current = ms;
    setTimestampMs(ms);
    if (videoPath) loadFrame(videoPath, ms);
  };

  // Add camera
  const handleCameraAddDefault = () => {
    const id = newCamId();
    const idx = cameraIdCounter - 1;
    const cam = defaultCamera(id, idx);
    setCameras(prev => [...prev, cam]);
    setSelectedCameraId(id);
    // Add this camera to all existing segments by default
    setSegments(prev => prev.map(seg => ({
      ...seg,
      enabledCameraIds: [...seg.enabledCameraIds, id],
    })));
  };

  // Add 6-camera preset
  const handleAddPreset6 = () => {
    const startIdx = cameraIdCounter;
    cameraIdCounter += 6;
    const presetCams = createPreset6Cameras(startIdx);
    setCameras(prev => [...prev, ...presetCams]);
    setSelectedCameraId(presetCams[0].id);
    const newIds = presetCams.map(c => c.id);
    setSegments(prev => prev.map(seg => ({
      ...seg,
      enabledCameraIds: [...seg.enabledCameraIds, ...newIds],
    })));
  };

  const handleCameraUpdate = (id: string, patch: Partial<VirtualCamera>) => {
    setCameras(prev => prev.map(c => c.id === id ? { ...c, ...patch } : c));
  };

  const handleCameraDelete = (id: string) => {
    setCameras(prev => prev.filter(c => c.id !== id));
    setSelectedCameraId(prev => prev === id ? null : prev);
    setCameraPreviews(prev => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    // Remove from all segments
    setSegments(prev => prev.map(seg => ({
      ...seg,
      enabledCameraIds: seg.enabledCameraIds.filter(cid => cid !== id),
    })));
  };

  // Segment handlers
  const handleSegmentAdd = (startMs: number, endMs: number) => {
    const id = newSegId();
    const idx = segmentIdCounter - 1;
    const allCamIds = cameras.map(c => c.id);
    const seg = defaultSegment(id, idx, startMs, endMs);
    seg.enabledCameraIds = allCamIds; // enable all cameras by default
    setSegments(prev => [...prev, seg]);
    setSelectedSegmentId(id);
  };

  const handleSegmentDelete = (id: string) => {
    setSegments(prev => prev.filter(s => s.id !== id));
    setSelectedSegmentId(prev => prev === id ? null : prev);
  };

  const handleSegmentUpdate = (id: string, patch: Partial<Segment>) => {
    setSegments(prev => prev.map(s => s.id === id ? { ...s, ...patch } : s));
  };

  const fileName = videoPath ? videoPath.split(/[/\\]/).pop() : null;

  // Cameras visible in the viewport: filtered to only those enabled in the
  // active segment(s) at the current playhead position. Falls back to all
  // cameras when the playhead is outside every segment.
  const activeSegments = segments.filter(
    s => timestampMs >= s.startMs && timestampMs <= s.endMs
  );
  const viewportCameras = activeSegments.length === 0
    ? cameras
    : cameras.filter(c => activeSegments.some(s => s.enabledCameraIds.includes(c.id)));

  return (
    <div className="app">
      {/* Top toolbar */}
      <div className="toolbar">
        <h1>Spherical Separator</h1>
        <button className="btn primary" onClick={openVideo}>
          Open 360 Video
        </button>
        <button className="btn" onClick={handleAddPreset6} title="Add 6 equatorial cameras with 80° FOV">
          + 6-Cam Preset
        </button>
        {fileName && (
          <span style={{ fontSize: 11, color: '#888', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 300 }}>
            {fileName}
          </span>
        )}
        {videoMeta && (
          <span style={{ fontSize: 11, color: '#666' }}>
            {videoMeta.width}×{videoMeta.height} &nbsp; {videoMeta.fps.toFixed(2)} fps
          </span>
        )}
        {frameLoading && (
          <span style={{ fontSize: 11, color: '#666' }}>⟳</span>
        )}
        {openError && (
          <span style={{ fontSize: 11, color: '#f87171' }}>{openError}</span>
        )}
      </div>

      {/* Main content */}
      <div className="main-content">
        {/* Left: viewport + preview strip stacked vertically */}
        <div className="viewport-and-previews">
          <Viewport3D
            frameDataUrl={frameDataUrl}
            cameras={viewportCameras}
            selectedCameraId={selectedCameraId}
            onCameraSelect={setSelectedCameraId}
          />
          <CameraPreviewGrid
            cameras={viewportCameras}
            previews={cameraPreviews}
            selectedId={selectedCameraId}
            onSelect={setSelectedCameraId}
          />
        </div>

        {/* Right sidebar */}
        <div className="sidebar">
          <CameraList
            cameras={cameras}
            selectedId={selectedCameraId}
            videoMeta={videoMeta}
            onSelect={setSelectedCameraId}
            onUpdate={handleCameraUpdate}
            onDelete={handleCameraDelete}
            onAdd={handleCameraAddDefault}
          />
          <ExportPanel
            videoPath={videoPath}
            videoMeta={videoMeta}
            cameras={cameras}
            segments={segments}
          />
        </div>
      </div>

      {/* Timeline at bottom */}
      <Timeline
        meta={videoMeta}
        timestampMs={timestampMs}
        onChange={handleTimestampChange}
        segments={segments}
        selectedSegmentId={selectedSegmentId}
        cameras={cameras}
        onSegmentSelect={setSelectedSegmentId}
        onSegmentAdd={handleSegmentAdd}
        onSegmentDelete={handleSegmentDelete}
        onSegmentUpdate={handleSegmentUpdate}
      />
    </div>
  );
}

export default App;
