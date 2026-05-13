/**
 * 2D occupancy grid renderer on a plain HTML5 canvas.
 *
 * Subscribes to:
 *   /map        (nav_msgs/OccupancyGrid) — static map background
 *   /amcl_pose  (geometry_msgs/PoseWithCovarianceStamped) — robot pose marker
 */
import ROSLIB from 'roslib';
import type { OccupancyGrid, PoseWithCovarianceStamped } from '@/ros/types';

interface MapMeta {
  width: number;
  height: number;
  resolution: number;
  origin: { x: number; y: number };
}

let canvas: HTMLCanvasElement | null = null;
let ctx: CanvasRenderingContext2D | null = null;
let mapSub: ROSLIB.Topic | null = null;
let poseSub: ROSLIB.Topic | null = null;
let mapMeta: MapMeta | null = null;
let mapImageData: ImageData | null = null;
let robotX: number | null = null;
let robotY: number | null = null;
let robotYaw: number | null = null;

function worldToCanvas(wx: number, wy: number): { x: number; y: number } | null {
  if (!mapMeta || !canvas) return null;
  const px = (wx - mapMeta.origin.x) / mapMeta.resolution;
  const py = mapMeta.height - (wy - mapMeta.origin.y) / mapMeta.resolution;
  const sx = canvas.width / mapMeta.width;
  const sy = canvas.height / mapMeta.height;
  return { x: px * sx, y: py * sy };
}

function drawMap(): void {
  if (!ctx || !mapImageData || !canvas) return;
  ctx.putImageData(mapImageData, 0, 0);

  if (robotX === null || robotY === null) return;
  const pos = worldToCanvas(robotX, robotY);
  if (!pos) return;

  const r = Math.max(5, canvas.width * 0.015);

  ctx.beginPath();
  ctx.arc(pos.x, pos.y, r, 0, Math.PI * 2);
  ctx.fillStyle = '#00e5ff';
  ctx.fill();
  ctx.strokeStyle = '#003a44';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  if (robotYaw === null) return;
  const len = r * 2;
  const dx = Math.cos(robotYaw) * len;
  const dy = -Math.sin(robotYaw) * len;
  ctx.beginPath();
  ctx.moveTo(pos.x, pos.y);
  ctx.lineTo(pos.x + dx, pos.y + dy);
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 2;
  ctx.stroke();

  const headLen = r * 0.8;
  const angle = Math.atan2(dy, dx);
  ctx.beginPath();
  ctx.moveTo(pos.x + dx, pos.y + dy);
  ctx.lineTo(
    pos.x + dx - headLen * Math.cos(angle - Math.PI / 6),
    pos.y + dy - headLen * Math.sin(angle - Math.PI / 6),
  );
  ctx.lineTo(
    pos.x + dx - headLen * Math.cos(angle + Math.PI / 6),
    pos.y + dy - headLen * Math.sin(angle + Math.PI / 6),
  );
  ctx.closePath();
  ctx.fillStyle = '#ffffff';
  ctx.fill();
}

function buildMapImage(msg: OccupancyGrid): void {
  if (!canvas || !ctx) return;
  const w = msg.info.width;
  const h = msg.info.height;
  if (w === 0 || h === 0) return;

  const container = document.getElementById('map-container');
  if (!container) return;
  const cw = container.clientWidth || 400;
  const ch = container.clientHeight || 300;

  const mapAspect = w / h;
  const canAspect = cw / ch;
  if (mapAspect > canAspect) {
    canvas.width = cw;
    canvas.height = Math.round(cw / mapAspect);
  } else {
    canvas.height = ch;
    canvas.width = Math.round(ch * mapAspect);
  }

  const imgData = ctx.createImageData(canvas.width, canvas.height);
  const scaleX = w / canvas.width;
  const scaleY = h / canvas.height;
  const data = msg.data as ArrayLike<number>;

  for (let cy = 0; cy < canvas.height; cy++) {
    for (let cx = 0; cx < canvas.width; cx++) {
      const mx = Math.floor(cx * scaleX);
      const my = Math.floor((canvas.height - 1 - cy) * scaleY);
      const val = data[my * w + mx];
      const pIdx = (cy * canvas.width + cx) * 4;

      if (val === -1) {
        imgData.data[pIdx] = 30;
        imgData.data[pIdx + 1] = 35;
        imgData.data[pIdx + 2] = 45;
      } else if (val === 0) {
        imgData.data[pIdx] = 200;
        imgData.data[pIdx + 1] = 210;
        imgData.data[pIdx + 2] = 220;
      } else {
        const darkness = Math.round((1 - val / 100) * 40);
        imgData.data[pIdx] = darkness;
        imgData.data[pIdx + 1] = darkness;
        imgData.data[pIdx + 2] = darkness + 5;
      }
      imgData.data[pIdx + 3] = 255;
    }
  }

  mapImageData = imgData;
  mapMeta = {
    width: w,
    height: h,
    resolution: msg.info.resolution,
    origin: { x: msg.info.origin.position.x, y: msg.info.origin.position.y },
  };

  console.log(`[Map2D] ${w}×${h} cells, res=${msg.info.resolution}m/cell`);
  drawMap();

  const badge = document.getElementById('map-status');
  if (badge) {
    badge.textContent = 'LIVE';
    badge.classList.add('live');
  }
}

export function init(ros: ROSLIB.Ros): void {
  const container = document.getElementById('map-container');
  if (!container) return;

  canvas = document.createElement('canvas');
  canvas.style.cssText =
    'position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);max-width:100%;max-height:100%;image-rendering:auto;';
  container.appendChild(canvas);
  ctx = canvas.getContext('2d');
  if (!ctx) return;

  mapSub = new ROSLIB.Topic({
    ros,
    name: '/map',
    messageType: 'nav_msgs/OccupancyGrid',
    throttle_rate: 0,
    queue_length: 1,
  });
  mapSub.subscribe((raw) => buildMapImage(raw as unknown as OccupancyGrid));

  poseSub = new ROSLIB.Topic({
    ros,
    name: '/amcl_pose',
    messageType: 'geometry_msgs/PoseWithCovarianceStamped',
    throttle_rate: 200,
    queue_length: 1,
  });
  poseSub.subscribe((raw) => {
    const msg = raw as unknown as PoseWithCovarianceStamped;
    robotX = msg.pose.pose.position.x;
    robotY = msg.pose.pose.position.y;
    const q = msg.pose.pose.orientation;
    robotYaw = Math.atan2(2 * (q.w * q.z + q.x * q.y), 1 - 2 * (q.y * q.y + q.z * q.z));
    drawMap();
  });

  window.addEventListener('resize', () => {
    if (mapMeta && mapImageData && canvas && ctx) drawMap();
  });

  console.log('[Map2D] initialised');
}

export function stop(): void {
  mapSub?.unsubscribe();
  poseSub?.unsubscribe();
  mapSub = null;
  poseSub = null;
  mapMeta = null;
  mapImageData = null;
  robotX = null;
  robotY = null;
  robotYaw = null;

  const container = document.getElementById('map-container');
  if (container) container.innerHTML = '';
  canvas = null;
  ctx = null;

  const badge = document.getElementById('map-status');
  if (badge) {
    badge.textContent = 'LOADING';
    badge.classList.remove('live');
  }
}
