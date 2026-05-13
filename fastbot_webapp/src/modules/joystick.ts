/**
 * Virtual joystick (canvas) + WASD keyboard control. Publishes to /fastbot_1/cmd_vel.
 */
import ROSLIB from 'roslib';

const CMD_VEL_TOPIC = '/fastbot_1/cmd_vel';
const MAX_LINEAR = 0.3;
const MAX_ANGULAR = 1.0;
const PUBLISH_HZ = 5;
const JOY_RADIUS = 60;
const HANDLE_R = 22;

interface Point {
  x: number;
  y: number;
}

let publisher: ROSLIB.Topic | null = null;
let interval: number | null = null;
let canvas: HTMLCanvasElement | null = null;
let ctx: CanvasRenderingContext2D | null = null;

let cmdLinear = 0;
let cmdAngular = 0;
let joyActive = false;
let joyOrigin: Point = { x: 0, y: 0 };
let joyHandle: Point = { x: 0, y: 0 };

const keys: Record<'w' | 'a' | 's' | 'd', boolean> = { w: false, a: false, s: false, d: false };

function isMovementKey(k: string): k is keyof typeof keys {
  return k === 'w' || k === 'a' || k === 's' || k === 'd';
}

function drawJoystick(): void {
  if (!ctx || !canvas) return;
  const { width: w, height: h } = canvas;
  ctx.clearRect(0, 0, w, h);

  ctx.beginPath();
  ctx.arc(joyOrigin.x, joyOrigin.y, JOY_RADIUS, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(0,229,255,0.25)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.strokeStyle = 'rgba(0,229,255,0.12)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(joyOrigin.x - JOY_RADIUS, joyOrigin.y);
  ctx.lineTo(joyOrigin.x + JOY_RADIUS, joyOrigin.y);
  ctx.moveTo(joyOrigin.x, joyOrigin.y - JOY_RADIUS);
  ctx.lineTo(joyOrigin.x, joyOrigin.y + JOY_RADIUS);
  ctx.stroke();

  const grad = ctx.createRadialGradient(
    joyHandle.x,
    joyHandle.y,
    0,
    joyHandle.x,
    joyHandle.y,
    HANDLE_R,
  );
  grad.addColorStop(0, 'rgba(0,229,255,0.9)');
  grad.addColorStop(1, 'rgba(0,229,255,0)');
  ctx.beginPath();
  ctx.arc(joyHandle.x, joyHandle.y, HANDLE_R * 1.4, 0, Math.PI * 2);
  ctx.fillStyle = grad;
  ctx.fill();

  ctx.beginPath();
  ctx.arc(joyHandle.x, joyHandle.y, HANDLE_R, 0, Math.PI * 2);
  ctx.fillStyle = joyActive ? 'rgba(0,229,255,0.95)' : 'rgba(0,229,255,0.6)';
  ctx.fill();
}

function getPos(e: MouseEvent | TouchEvent): Point {
  if (!canvas) return { x: 0, y: 0 };
  const rect = canvas.getBoundingClientRect();
  const src = 'touches' in e ? e.touches[0] : e;
  return { x: src.clientX - rect.left, y: src.clientY - rect.top };
}

function updateHandle(pos: Point): void {
  const dx = pos.x - joyOrigin.x;
  const dy = pos.y - joyOrigin.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const clamped = Math.min(dist, JOY_RADIUS);
  const angle = Math.atan2(dy, dx);

  joyHandle = {
    x: joyOrigin.x + Math.cos(angle) * clamped,
    y: joyOrigin.y + Math.sin(angle) * clamped,
  };

  cmdLinear = -(dy / JOY_RADIUS) * MAX_LINEAR;
  cmdAngular = -(dx / JOY_RADIUS) * MAX_ANGULAR;

  drawJoystick();
}

function onStart(e: MouseEvent | TouchEvent): void {
  joyActive = true;
  updateHandle(getPos(e));
}

function onMove(e: MouseEvent | TouchEvent): void {
  if (!joyActive) return;
  updateHandle(getPos(e));
}

function onEnd(): void {
  if (!joyActive) return;
  joyActive = false;
  joyHandle = { ...joyOrigin };
  cmdLinear = 0;
  cmdAngular = 0;
  drawJoystick();
}

function updateFromKeys(): void {
  if (joyActive) return;
  let lin = 0;
  let ang = 0;
  if (keys.w) lin = MAX_LINEAR;
  if (keys.s) lin = -MAX_LINEAR;
  if (keys.a) ang = MAX_ANGULAR;
  if (keys.d) ang = -MAX_ANGULAR;
  cmdLinear = lin;
  cmdAngular = ang;
}

function publishVelocity(): void {
  if (!publisher) return;
  publisher.publish(
    new ROSLIB.Message({
      linear: { x: cmdLinear, y: 0, z: 0 },
      angular: { x: 0, y: 0, z: cmdAngular },
    }),
  );
}

export function init(ros: ROSLIB.Ros): void {
  publisher = new ROSLIB.Topic({
    ros,
    name: CMD_VEL_TOPIC,
    messageType: 'geometry_msgs/Twist',
  });

  canvas = document.getElementById('joystick-canvas') as HTMLCanvasElement | null;
  if (!canvas) return;
  ctx = canvas.getContext('2d');
  if (!ctx) return;

  joyOrigin = { x: canvas.width / 2, y: canvas.height / 2 };
  joyHandle = { ...joyOrigin };

  drawJoystick();

  canvas.addEventListener('mousedown', onStart);
  canvas.addEventListener('touchstart', onStart, { passive: true });
  window.addEventListener('mousemove', onMove);
  window.addEventListener('touchmove', onMove, { passive: true });
  window.addEventListener('mouseup', onEnd);
  window.addEventListener('touchend', onEnd);

  window.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if (isMovementKey(k)) {
      keys[k] = true;
      updateFromKeys();
    }
  });
  window.addEventListener('keyup', (e) => {
    const k = e.key.toLowerCase();
    if (isMovementKey(k)) {
      keys[k] = false;
      updateFromKeys();
    }
  });

  interval = window.setInterval(publishVelocity, 1000 / PUBLISH_HZ);
}

export function stop(): void {
  if (interval !== null) {
    clearInterval(interval);
    interval = null;
  }
  if (publisher) {
    publisher.publish(
      new ROSLIB.Message({
        linear: { x: 0, y: 0, z: 0 },
        angular: { x: 0, y: 0, z: 0 },
      }),
    );
    publisher = null;
  }
  cmdLinear = 0;
  cmdAngular = 0;
}
