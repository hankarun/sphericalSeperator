// Viewport3D.tsx — Three.js 3D sphere viewport with camera placement gizmos
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { VirtualCamera } from './types';

interface Props {
  frameDataUrl: string | null;
  cameras: VirtualCamera[];
  selectedCameraId: string | null;
  onCameraSelect: (id: string) => void;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Convert yaw/pitch (degrees) to a unit 3D direction vector on the
 *  inside-out sphere (X is negated to match the flipped geometry). */
function dirFromAngles(yawDeg: number, pitchDeg: number): THREE.Vector3 {
  const yaw = THREE.MathUtils.degToRad(-yawDeg); // negate yaw to match reprojector convention
  const pitch = THREE.MathUtils.degToRad(pitchDeg);
  return new THREE.Vector3(
    -Math.sin(yaw) * Math.cos(pitch),
    Math.sin(pitch),
    Math.cos(yaw) * Math.cos(pitch),
  ).normalize();
}

/** Build a local orthonormal frame (forward, right, up) for a camera direction. */
function localFrame(forward: THREE.Vector3): { right: THREE.Vector3; up: THREE.Vector3 } {
  // Handle pole singularity
  const ref = Math.abs(forward.y) > 0.99
    ? new THREE.Vector3(0, 0, 1)
    : new THREE.Vector3(0, 1, 0);
  const right = new THREE.Vector3().crossVectors(forward, ref).normalize();
  const up = new THREE.Vector3().crossVectors(right, forward).normalize();
  return { right, up };
}

/** Slerp between two unit vectors, returning `steps+1` evenly spaced points. */
function slerpArc(a: THREE.Vector3, b: THREE.Vector3, steps: number): THREE.Vector3[] {
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    pts.push(new THREE.Vector3().copy(a).lerp(b, t).normalize());
  }
  return pts;
}

/**
 * Build a closed spherical polygon on the sphere surface (radius r) that
 * represents the FOV footprint of a pinhole camera.
 *
 * Strategy:
 *   1. Compute the 4 corner ray directions of the frustum (taking roll into account).
 *   2. For each edge (top, right, bottom, left) slerp between the two corner rays.
 *   3. Project all points onto the sphere at the given radius.
 */
function buildFovPolygon(
  cam: VirtualCamera,
  radius: number,
  edgeSteps = 32,
): THREE.Vector3[] {
  const forward = dirFromAngles(cam.yaw_deg, cam.pitch_deg);
  const { right, up } = localFrame(forward);

  // Apply roll rotation around the forward axis
  const rollRad = THREE.MathUtils.degToRad(cam.roll_deg);
  const rollQ = new THREE.Quaternion().setFromAxisAngle(forward, rollRad);
  const rightR = right.clone().applyQuaternion(rollQ);
  const upR = up.clone().applyQuaternion(rollQ);

  const hHalf = THREE.MathUtils.degToRad(cam.fov_h_deg / 2);
  // Assume square pixels → vertical FOV same as horizontal for now.
  // For a 16:9 output we'd scale: vHalf = atan(tan(hHalf) * h/w).
  // Keep symmetric so the overlay is always meaningful regardless of output res.
  const vHalf = hHalf;

  const tanH = Math.tan(hHalf);
  const tanV = Math.tan(vHalf);

  // 4 corner directions in camera space, then rotated to world
  const tl = forward.clone().add(rightR.clone().multiplyScalar(-tanH)).add(upR.clone().multiplyScalar( tanV)).normalize();
  const tr = forward.clone().add(rightR.clone().multiplyScalar( tanH)).add(upR.clone().multiplyScalar( tanV)).normalize();
  const br = forward.clone().add(rightR.clone().multiplyScalar( tanH)).add(upR.clone().multiplyScalar(-tanV)).normalize();
  const bl = forward.clone().add(rightR.clone().multiplyScalar(-tanH)).add(upR.clone().multiplyScalar(-tanV)).normalize();

  // Slerp along each edge: top, right, bottom (reversed), left (reversed)
  const pts: THREE.Vector3[] = [
    ...slerpArc(tl, tr, edgeSteps),
    ...slerpArc(tr, br, edgeSteps),
    ...slerpArc(br, bl, edgeSteps),
    ...slerpArc(bl, tl, edgeSteps),
  ].map(v => v.multiplyScalar(radius));

  return pts;
}

/** Build the 4 frustum ray lines from the gizmo origin to the sphere surface. */
function buildFrustumRays(
  cam: VirtualCamera,
  origin: THREE.Vector3,
  sphereRadius: number,
): THREE.Vector3[][] {
  const forward = dirFromAngles(cam.yaw_deg, cam.pitch_deg);
  const { right, up } = localFrame(forward);

  const rollRad = THREE.MathUtils.degToRad(cam.roll_deg);
  const rollQ = new THREE.Quaternion().setFromAxisAngle(forward, rollRad);
  const rightR = right.clone().applyQuaternion(rollQ);
  const upR = up.clone().applyQuaternion(rollQ);

  const tanH = Math.tan(THREE.MathUtils.degToRad(cam.fov_h_deg / 2));
  const tanV = tanH;

  const corners = [
    forward.clone().add(rightR.clone().multiplyScalar(-tanH)).add(upR.clone().multiplyScalar( tanV)).normalize(),
    forward.clone().add(rightR.clone().multiplyScalar( tanH)).add(upR.clone().multiplyScalar( tanV)).normalize(),
    forward.clone().add(rightR.clone().multiplyScalar( tanH)).add(upR.clone().multiplyScalar(-tanV)).normalize(),
    forward.clone().add(rightR.clone().multiplyScalar(-tanH)).add(upR.clone().multiplyScalar(-tanV)).normalize(),
  ];

  return corners.map(c => [origin.clone(), c.multiplyScalar(sphereRadius)]);
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function Viewport3D({
  frameDataUrl,
  cameras,
  selectedCameraId,
  onCameraSelect,
}: Props) {
  const mountRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const sphereRef = useRef<THREE.Mesh | null>(null);
  const textureRef = useRef<THREE.Texture | null>(null);
  const gizmoGroupRef = useRef<THREE.Group | null>(null);
  const frameRef = useRef<number>(0);

  const onCameraSelectRef = useRef(onCameraSelect);
  useEffect(() => { onCameraSelectRef.current = onCameraSelect; }, [onCameraSelect]);

  // ── Initial Three.js setup (runs once) ──────────────────────────────────
  useEffect(() => {
    const mount = mountRef.current!;
    const w = mount.clientWidth || 800;
    const h = mount.clientHeight || 600;

    const scene = new THREE.Scene();
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(90, w / h, 0.01, 1000);
    camera.position.set(0, 0, 0.001);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(w, h);
    mount.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableZoom = false;
    controls.enablePan = false;
    controls.rotateSpeed = -0.4;
    controls.target.set(0, 0, 1);
    controlsRef.current = controls;

    // Inside-out sphere
    const geo = new THREE.SphereGeometry(10, 64, 32);
    geo.scale(-1, 1, 1);
    const mat = new THREE.MeshBasicMaterial({ color: 0x222222 });
    const sphere = new THREE.Mesh(geo, mat);
    scene.add(sphere);
    sphereRef.current = sphere;

    // Gizmo group
    const gizmoGroup = new THREE.Group();
    scene.add(gizmoGroup);
    gizmoGroupRef.current = gizmoGroup;

    // Click handler — select camera by clicking its gizmo cone
    const onClick = (e: MouseEvent) => {
      if (e.button !== 0) return;
      if ((controls as any)._moved) return;

      const rect = renderer.domElement.getBoundingClientRect();
      const mx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const my = -((e.clientY - rect.top) / rect.height) * 2 + 1;

      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(new THREE.Vector2(mx, my), camera);

      const hits = raycaster.intersectObjects(gizmoGroup.children, true);
      if (hits.length > 0) {
        let obj: THREE.Object3D | null = hits[0].object;
        while (obj && !obj.userData.cameraId) obj = obj.parent;
        if (obj?.userData.cameraId) {
          onCameraSelectRef.current(obj.userData.cameraId);
        }
      }
    };

    renderer.domElement.addEventListener('click', onClick);
    renderer.domElement.addEventListener('mousedown', () => { (controls as any)._moved = false; });
    renderer.domElement.addEventListener('mousemove', (e) => { if (e.buttons) (controls as any)._moved = true; });

    const animate = () => {
      frameRef.current = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    const ro = new ResizeObserver(() => {
      const w2 = mount.clientWidth;
      const h2 = mount.clientHeight;
      camera.aspect = w2 / h2;
      camera.updateProjectionMatrix();
      renderer.setSize(w2, h2);
    });
    ro.observe(mount);

    return () => {
      cancelAnimationFrame(frameRef.current);
      ro.disconnect();
      renderer.domElement.removeEventListener('click', onClick);
      renderer.dispose();
      mount.removeChild(renderer.domElement);
    };
  }, []);

  // ── Update sphere texture ────────────────────────────────────────────────
  useEffect(() => {
    if (!sphereRef.current || !frameDataUrl) return;
    const mat = sphereRef.current.material as THREE.MeshBasicMaterial;

    if (!textureRef.current) {
      // First frame — create texture once
      const tex = new THREE.Texture();
      tex.colorSpace = THREE.SRGBColorSpace;
      textureRef.current = tex;
      mat.map = tex;
      mat.color.set(0xffffff);
      mat.needsUpdate = true;
    }

    const img = new Image();
    img.onload = () => {
      const tex = textureRef.current!;
      tex.image = img;
      tex.needsUpdate = true;
    };
    img.src = frameDataUrl;
  }, [frameDataUrl]);

  // ── Rebuild camera gizmos + FOV arcs ────────────────────────────────────
  useEffect(() => {
    const group = gizmoGroupRef.current;
    if (!group) return;

    // Clear previous gizmos
    group.children.slice().forEach(c => group.remove(c));

    cameras.forEach((cam) => {
      const isSelected = cam.id === selectedCameraId;
      const color = new THREE.Color(cam.color);
      const alpha = isSelected ? 1.0 : 0.55;

      const forward = dirFromAngles(cam.yaw_deg, cam.pitch_deg);
      const gizmoPos = forward.clone().multiplyScalar(9.3); // gizmo origin

      const g = new THREE.Group();
      g.userData.cameraId = cam.id;

      // ── Cone marker ───────────────────────────────────────────────────
      const coneGeo = new THREE.ConeGeometry(isSelected ? 0.25 : 0.18, 0.55, 8);
      const coneMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: alpha });
      const cone = new THREE.Mesh(coneGeo, coneMat);
      // Orient so cone tip points toward center (along -forward)
      const q = new THREE.Quaternion().setFromUnitVectors(
        new THREE.Vector3(0, 1, 0),
        forward.clone().negate(),
      );
      cone.quaternion.copy(q);
      cone.position.copy(gizmoPos);
      g.add(cone);

      // ── FOV boundary polygon on sphere surface ────────────────────────
      const polyPts = buildFovPolygon(cam, 9.92, isSelected ? 48 : 24);
      const polyVerts = new Float32Array(polyPts.flatMap(v => [v.x, v.y, v.z]));
      const polyGeo = new THREE.BufferGeometry();
      polyGeo.setAttribute('position', new THREE.BufferAttribute(polyVerts, 3));
      const polyMat = new THREE.LineBasicMaterial({
        color,
        transparent: true,
        opacity: isSelected ? 0.95 : 0.45,
        linewidth: 1,
      });
      const polyLine = new THREE.LineLoop(polyGeo, polyMat);
      g.add(polyLine);

      // ── 4 frustum rays from gizmo to sphere surface ───────────────────
      const rays = buildFrustumRays(cam, gizmoPos, 9.92);
      const rayVerts = new Float32Array(rays.flatMap(([a, b]) => [a.x, a.y, a.z, b.x, b.y, b.z]));
      const rayGeo = new THREE.BufferGeometry();
      rayGeo.setAttribute('position', new THREE.BufferAttribute(rayVerts, 3));
      const rayMat = new THREE.LineBasicMaterial({
        color,
        transparent: true,
        opacity: isSelected ? 0.7 : 0.3,
      });
      const rayLines = new THREE.LineSegments(rayGeo, rayMat);
      g.add(rayLines);

      // ── Camera name label (canvas sprite) ────────────────────────────
      const canvas = document.createElement('canvas');
      canvas.width = 256;
      canvas.height = 64;
      const ctx = canvas.getContext('2d')!;
      ctx.clearRect(0, 0, 256, 64);
      ctx.font = 'bold 28px sans-serif';
      ctx.fillStyle = cam.color;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      // Shadow for readability
      ctx.shadowColor = 'rgba(0,0,0,0.8)';
      ctx.shadowBlur = 6;
      ctx.fillText(cam.name, 128, 32);
      const spriteTex = new THREE.CanvasTexture(canvas);
      const spriteMat = new THREE.SpriteMaterial({
        map: spriteTex,
        transparent: true,
        opacity: isSelected ? 1.0 : 0.75,
        depthTest: false,
      });
      const sprite = new THREE.Sprite(spriteMat);
      sprite.scale.set(1.6, 0.4, 1);
      sprite.position.copy(gizmoPos.clone().multiplyScalar(1.08)); // slightly further out
      g.add(sprite);

      group.add(g);
    });
  }, [cameras, selectedCameraId]);

  return (
    <div className="viewport-container" ref={mountRef}>
      <div className="viewport-hint">
        Drag to orbit &nbsp;·&nbsp; Click gizmo to select camera
      </div>
    </div>
  );
}
