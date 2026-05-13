/**
 * 3D scene with URDF model, occupancy grid, and laser scan via ros3djs.
 * ros3djs is loaded as a vendored UMD script (see src/main.ts) — accessed
 * through the global ROS3D, with three.js types from npm.
 */
import ROSLIB from 'roslib';
import type { TFMessage, TFTransform, Vector3, Quaternion } from '@/ros/types';
import { logger } from '@/ros/logger';

const URDF_FIXED_FRAME = 'fastbot_1_odom';
const MAP_FIXED_FRAME = 'map';
const URDF_PARAM = '/fastbot_1_robot_state_publisher:robot_description';

let viewer: ROS3DViewer | null = null;
let tfClient: ROSLIB.TFClient | null = null;
let mapTfClient: ROSLIB.TFClient | null = null;
let poseSub: ROSLIB.Topic | null = null;
let visPoller: number | null = null;

interface RawTransform {
  parentFrame: string;
  translation: Vector3;
  rotation: Quaternion;
}

interface FrameInfo {
  transform: { translation: Vector3; rotation: Quaternion };
  cbs?: Array<(t: FrameInfo['transform']) => void>;
}

interface PatchedTFClient extends ROSLIB.TFClient {
  frameInfos: Record<string, FrameInfo>;
}

const tfTree = {
  raw: {} as Record<string, RawTransform>,

  store(transform: TFTransform): void {
    const child = transform.child_frame_id.replace(/^\//, '');
    const parent = transform.header.frame_id.replace(/^\//, '');
    this.raw[child] = {
      parentFrame: parent,
      translation: transform.transform.translation,
      rotation: transform.transform.rotation,
    };
  },

  multiplyQ(a: Quaternion, b: Quaternion): Quaternion {
    return {
      x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
      y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
      z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
      w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
    };
  },

  rotateV(v: Vector3, q: Quaternion): Vector3 {
    const u = { x: q.x, y: q.y, z: q.z };
    const s = q.w;
    const dot = u.x * v.x + u.y * v.y + u.z * v.z;
    const cross = {
      x: u.y * v.z - u.z * v.y,
      y: u.z * v.x - u.x * v.z,
      z: u.x * v.y - u.y * v.x,
    };
    const sq = s * s - (u.x * u.x + u.y * u.y + u.z * u.z);
    return {
      x: 2 * dot * u.x + sq * v.x + 2 * s * cross.x,
      y: 2 * dot * u.y + sq * v.y + 2 * s * cross.y,
      z: 2 * dot * u.z + sq * v.z + 2 * s * cross.z,
    };
  },

  compute(fixedFrame: string, targetFrame: string): { translation: Vector3; rotation: Quaternion } | null {
    if (fixedFrame === targetFrame) {
      return { translation: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } };
    }

    const chain: RawTransform[] = [];
    let current = targetFrame;
    let limit = 10;

    while (current !== fixedFrame && limit-- > 0) {
      const t = this.raw[current];
      if (!t) return null;
      chain.push(t);
      current = t.parentFrame;
    }
    if (current !== fixedFrame) return null;

    chain.reverse();
    let tx = 0;
    let ty = 0;
    let tz = 0;
    let q: Quaternion = { x: 0, y: 0, z: 0, w: 1 };

    for (const t of chain) {
      const rotated = this.rotateV(t.translation, q);
      tx += rotated.x;
      ty += rotated.y;
      tz += rotated.z;
      q = this.multiplyQ(q, t.rotation);
    }

    return { translation: { x: tx, y: ty, z: tz }, rotation: q };
  },
};

interface RegisteredClient {
  client: PatchedTFClient;
  fixedFrame: string;
}

function setupDirectTF(ros: ROSLIB.Ros, clients: RegisteredClient[]): void {
  const processMsgs = (raw: unknown): void => {
    const msg = raw as TFMessage;
    msg.transforms.forEach((t) => tfTree.store(t));

    for (const { client, fixedFrame } of clients) {
      for (const frameId of Object.keys(client.frameInfos)) {
        const computed = tfTree.compute(fixedFrame, frameId);
        if (!computed) continue;
        const fi = client.frameInfos[frameId];
        fi.transform = computed;
        fi.cbs?.forEach((cb) => cb(fi.transform));
      }
    }
  };

  new ROSLIB.Topic({
    ros,
    name: '/tf',
    messageType: 'tf2_msgs/TFMessage',
    queue_length: 50,
    throttle_rate: 50,
  }).subscribe(processMsgs);

  new ROSLIB.Topic({
    ros,
    name: '/tf_static',
    messageType: 'tf2_msgs/TFMessage',
    queue_length: 10,
    throttle_rate: 0,
  }).subscribe(processMsgs);
}

function patchOccupancyGridClient(): void {
  const ROS3DAny = window.ROS3D as unknown as { OccupancyGridClient?: { prototype: any } };
  const proto = ROS3DAny.OccupancyGridClient?.prototype;
  if (!proto || proto._patched) return;

  proto.processMessage = function (message: { header: { frame_id: string } }) {
    if (this.sceneNode) {
      try {
        this.sceneNode.unsubscribeTf?.();
      } catch {
        /* ignore */
      }
      this.rootObject.remove(this.sceneNode);
    }
    const grid = new window.ROS3D.OccupancyGrid({
      message,
      color: this.color,
      opacity: this.opacity,
    });
    if (this.tfClient) {
      this.sceneNode = new window.ROS3D.SceneNode({
        frameID: message.header.frame_id,
        tfClient: this.tfClient,
        object: grid,
        pose: this.offsetPose,
      });
    } else {
      this.sceneNode = grid;
    }
    this.currentGrid = grid;
    this.rootObject.add(this.sceneNode);
    this.emit?.('change');
    if (!this.continuous) this.rosTopic.unsubscribe();
  };

  proto._patched = true;
  console.log('[Model3D] OccupancyGridClient patched');
}

function buildMeshPath(): string {
  const pathname = location.pathname.endsWith('/')
    ? location.pathname
    : location.pathname.substring(0, location.pathname.lastIndexOf('/') + 1);
  return location.origin + pathname;
}

function zPose(z: number): ROSLIB.Pose {
  return new ROSLIB.Pose({
    position: { x: 0, y: 0, z },
    orientation: { x: 0, y: 0, z: 0, w: 1 },
  });
}

function showLoadingOverlay(container: HTMLElement): void {
  const overlay = document.createElement('div');
  overlay.id = 'model3d-loading';
  overlay.style.cssText = [
    'position:absolute',
    'inset:0',
    'display:flex',
    'flex-direction:column',
    'align-items:center',
    'justify-content:center',
    'background:rgba(13,15,20,0.85)',
    'color:#00e5ff',
    'font-family:monospace',
    'font-size:12px',
    'letter-spacing:2px',
    'z-index:10',
    'pointer-events:none',
  ].join(';');
  overlay.innerHTML = `
    <div style="width:32px;height:32px;border:2px solid #00e5ff33;
      border-top-color:#00e5ff;border-radius:50%;
      animation:spin3d 1s linear infinite;margin-bottom:12px"></div>
    <span>LOADING 3D MODEL</span>
    <span id="model3d-load-detail" style="color:#4a90a4;font-size:10px;
      margin-top:6px">Fetching URDF...</span>
    <style>@keyframes spin3d{to{transform:rotate(360deg)}}</style>
  `;
  container.style.position = 'relative';
  container.appendChild(overlay);
}

function hideLoadingOverlay(): void {
  document.getElementById('model3d-loading')?.remove();
}

function setLoadDetail(msg: string): void {
  const el = document.getElementById('model3d-load-detail');
  if (el) el.textContent = msg;
}

function startVisibilityPoller(): void {
  let checks = 0;
  let lastCount = 0;
  let stableChecks = 0;
  const MIN_MESHES = 5;
  const STABLE_NEED = 3;

  visPoller = window.setInterval(() => {
    if (!viewer) {
      if (visPoller !== null) clearInterval(visPoller);
      return;
    }
    checks++;
    let named = 0;
    let vis = 0;
    viewer.scene.traverse((obj) => {
      if (obj.type !== 'Mesh') return;
      if (!obj.name || obj.name.length < 3 || /^[0-9A-F]{8}$/i.test(obj.name)) return;
      named++;
      if (obj.visible) vis++;
    });
    const elapsed = checks * 2;
    setLoadDetail(`Parsing meshes... ${elapsed}s (${vis}/${named})`);

    if (named === lastCount && named > 0) stableChecks++;
    else {
      stableChecks = 0;
      lastCount = named;
    }

    const liveSatisfied = named >= MIN_MESHES && stableChecks >= STABLE_NEED;
    if (liveSatisfied && (vis === named || elapsed >= 30)) {
      if (visPoller !== null) {
        clearInterval(visPoller);
        visPoller = null;
      }
      hideLoadingOverlay();
      const badge = document.getElementById('model-status');
      if (badge) {
        badge.textContent = 'LIVE';
        badge.classList.add('live');
      }
      console.log(`[Model3D] ${vis}/${named} meshes visible — overlay hidden`);
    }

    if (checks > 90) {
      if (visPoller !== null) {
        clearInterval(visPoller);
        visPoller = null;
      }
      hideLoadingOverlay();
    }
  }, 2000);
}

function makeTfClient(ros: ROSLIB.Ros, fixedFrame: string): PatchedTFClient {
  const opts = {
    ros,
    fixedFrame,
    angularThres: 0.01,
    transThres: 0.01,
    rate: 10.0,
    serverName: '/tf2_web_republisher',
    repubServiceName: '/republish_tfs',
    groovyCompatibility: true,
  };
  return new ROSLIB.TFClient(opts as unknown as ConstructorParameters<typeof ROSLIB.TFClient>[0]) as PatchedTFClient;
}

export function init(ros: ROSLIB.Ros): void {
  const container = document.getElementById('model-container');
  if (!container) return;

  const badge = document.getElementById('model-status');
  const meshPath = buildMeshPath();
  console.log('[Model3D] meshPath:', meshPath);

  patchOccupancyGridClient();
  showLoadingOverlay(container);

  viewer = new window.ROS3D.Viewer({
    background: '#111111',
    divID: 'model-container',
    width: container.clientWidth || 400,
    height: container.clientHeight || 300,
    antialias: true,
    fixedFrame: URDF_FIXED_FRAME,
  });

  viewer.addObject(new window.ROS3D.Grid({ color: '#0181c4', cellSize: 0.5, num_cells: 20 }));

  tfClient = makeTfClient(ros, URDF_FIXED_FRAME);
  mapTfClient = makeTfClient(ros, MAP_FIXED_FRAME);

  setupDirectTF(ros, [
    { client: tfClient as PatchedTFClient, fixedFrame: URDF_FIXED_FRAME },
    { client: mapTfClient as PatchedTFClient, fixedFrame: MAP_FIXED_FRAME },
  ]);
  console.log('[Model3D] Single /tf subscription active for all clients');

  setLoadDetail('Fetching URDF...');
  new window.ROS3D.UrdfClient({
    ros,
    param: URDF_PARAM,
    tfClient,
    path: meshPath,
    rootObject: viewer.scene,
  });

  const origDraw = viewer.draw.bind(viewer);
  viewer.draw = function () {
    viewer?.scene.updateMatrixWorld(true);
    origDraw();
  };

  setTimeout(() => {
    setLoadDetail('Parsing DAE meshes...');
    startVisibilityPoller();
  }, 2000);

  try {
    new window.ROS3D.OccupancyGridClient({
      ros,
      tfClient: mapTfClient,
      rootObject: viewer.scene,
      topic: '/map',
      continuous: true,
      opacity: 1.0,
      offsetPose: zPose(-0.05),
    });
    console.log('[Model3D] OccupancyGridClient attached to /map');
  } catch (e) {
    console.warn('[Model3D] Map unavailable:', (e as Error).message);
  }

  try {
    new window.ROS3D.LaserScan({
      ros,
      tfClient,
      rootObject: viewer.scene,
      topic: '/scan',
      material: { color: 0xff2200, size: 0.05 },
      throttle_rate: 200,
      queue_length: 1,
    });
  } catch {
    /* non-fatal */
  }

  poseSub = new ROSLIB.Topic({
    ros,
    name: '/amcl_pose',
    messageType: 'geometry_msgs/PoseWithCovarianceStamped',
    throttle_rate: 300,
    queue_length: 1,
  });
  poseSub.subscribe(() => {});

  if (badge) {
    badge.textContent = 'LOADING';
    badge.classList.remove('live');
  }
  logger.log('3D viewer initialised');

  window.addEventListener('resize', () => {
    if (viewer) viewer.resize(container.clientWidth, container.clientHeight);
  });
}

export function stop(): void {
  if (visPoller !== null) {
    clearInterval(visPoller);
    visPoller = null;
  }
  poseSub?.unsubscribe();
  poseSub = null;

  (tfClient as unknown as { dispose?: () => void } | null)?.dispose?.();
  (mapTfClient as unknown as { dispose?: () => void } | null)?.dispose?.();
  tfClient = null;
  mapTfClient = null;

  viewer?.stop();
  viewer = null;

  const container = document.getElementById('model-container');
  if (container) container.innerHTML = '';
  const badge = document.getElementById('model-status');
  if (badge) {
    badge.textContent = 'LOADING';
    badge.classList.remove('live');
  }
}
