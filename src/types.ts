// types.ts — shared types between components
export interface Segment {
  id: string;
  label: string;
  startMs: number;
  endMs: number;
  enabledCameraIds: string[]; // cameras active in this segment
}

export function defaultSegment(id: string, index: number, startMs: number, endMs: number): Segment {
  return {
    id,
    label: `Segment ${index + 1}`,
    startMs,
    endMs,
    enabledCameraIds: [], // caller should populate with all camera ids
  };
}

export interface VideoMeta {
  duration_ms: number;
  width: number;
  height: number;
  fps: number;
}

export interface VirtualCamera {
  id: string;           // frontend-only UUID
  name: string;
  yaw_deg: number;      // azimuth: 0=forward, positive=right
  pitch_deg: number;    // elevation: 0=horizon, positive=up
  roll_deg: number;
  fov_h_deg: number;    // horizontal FOV in degrees
  out_width: number;    // 0 = use global setting
  out_height: number;   // 0 = use global setting
  color: string;        // hex color for gizmo
  use_video_res: boolean; // when true, out_width/out_height are overridden by video native res at export time
}

export function defaultCamera(id: string, index: number): VirtualCamera {
  const colors = [
    '#ff4444', '#44ff44', '#4488ff', '#ffff44',
    '#ff44ff', '#44ffff', '#ff8844', '#88ff44',
  ];
  return {
    id,
    name: `Camera ${index + 1}`,
    yaw_deg: 0,
    pitch_deg: 0,
    roll_deg: 0,
    fov_h_deg: 90,
    out_width: 0,
    out_height: 0,
    color: colors[index % colors.length],
    use_video_res: false,
  };
}

/**
 * Create 6 equatorial cameras with 10° overlap.
 *
 * Full 360° / 6 cameras = 60° per camera.
 * With 10° overlap on each side → FOV = 80°.
 * Yaw angles are spaced 60° apart starting at 0°.
 */
export function createPreset6Cameras(startIndex: number): VirtualCamera[] {
  const colors = ['#ff4444', '#44dd44', '#4488ff', '#ffcc00', '#ff44ff', '#44ffff'];
  const names = [
    'Front',
    'Front-Right',
    'Back-Right',
    'Back',
    'Back-Left',
    'Front-Left',
  ];
  return names.map((label, i) => ({
    id: `preset-${startIndex + i}-${Date.now()}-${i}`,
    name: `Cam ${label}`,
    yaw_deg: i * 60,
    pitch_deg: 0,
    roll_deg: 0,
    fov_h_deg: 80,   // 60° coverage + 10° overlap on each side
    out_width: 0,
    out_height: 0,
    color: colors[i],
    use_video_res: false,
  }));
}
