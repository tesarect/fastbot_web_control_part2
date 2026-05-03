/**
 * Virtual joystick (canvas-based) + WASD keyboard control.
 * Publishes to /fastbot_1/cmd_vel
 */

const joystick = (() => {

  const CMD_VEL_TOPIC = '/fastbot_1/cmd_vel';
  const MAX_LINEAR  = 0.3;   // m/s
  const MAX_ANGULAR = 1.0;   // rad/s
//   const PUBLISH_HZ  = 10;    // publish rate
  const PUBLISH_HZ  = 5;    // publish rate

  let publisher  = null;
  let interval   = null;
  let canvas, ctx;

  // Current velocity command
  let cmdLinear  = 0;
  let cmdAngular = 0;

  // Joystick state
  let joyActive  = false;
  let joyOrigin  = { x: 0, y: 0 };
  let joyHandle  = { x: 0, y: 0 };
  const JOY_RADIUS = 60;
  const HANDLE_R   = 22;

  // Keyboard state
  const keys = { w: false, a: false, s: false, d: false };

  function init(ros) {
    publisher = new ROSLIB.Topic({
      ros,
      name: CMD_VEL_TOPIC,
      messageType: 'geometry_msgs/Twist'
    });

    canvas = document.getElementById('joystick-canvas');
    ctx    = canvas.getContext('2d');

    joyOrigin = { x: canvas.width / 2, y: canvas.height / 2 };
    joyHandle = { ...joyOrigin };

    drawJoystick();
    bindJoystick();
    bindKeyboard();

    // Publish loop
    interval = setInterval(publishVelocity, 1000 / PUBLISH_HZ);
  }

  /* ── DRAWING ── */
  function drawJoystick() {
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    // Outer ring
    ctx.beginPath();
    ctx.arc(joyOrigin.x, joyOrigin.y, JOY_RADIUS, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(0,229,255,0.25)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Cross hairs
    ctx.strokeStyle = 'rgba(0,229,255,0.12)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(joyOrigin.x - JOY_RADIUS, joyOrigin.y);
    ctx.lineTo(joyOrigin.x + JOY_RADIUS, joyOrigin.y);
    ctx.moveTo(joyOrigin.x, joyOrigin.y - JOY_RADIUS);
    ctx.lineTo(joyOrigin.x, joyOrigin.y + JOY_RADIUS);
    ctx.stroke();

    // Handle glow
    const grad = ctx.createRadialGradient(
      joyHandle.x, joyHandle.y, 0,
      joyHandle.x, joyHandle.y, HANDLE_R
    );
    grad.addColorStop(0, 'rgba(0,229,255,0.9)');
    grad.addColorStop(1, 'rgba(0,229,255,0)');
    ctx.beginPath();
    ctx.arc(joyHandle.x, joyHandle.y, HANDLE_R * 1.4, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();

    // Handle
    ctx.beginPath();
    ctx.arc(joyHandle.x, joyHandle.y, HANDLE_R, 0, Math.PI * 2);
    ctx.fillStyle = joyActive ? 'rgba(0,229,255,0.95)' : 'rgba(0,229,255,0.6)';
    ctx.fill();
  }

  /* ── JOYSTICK EVENTS ── */
  function bindJoystick() {
    canvas.addEventListener('mousedown',  onStart);
    canvas.addEventListener('touchstart', onStart, { passive: true });
    window.addEventListener('mousemove',  onMove);
    window.addEventListener('touchmove',  onMove, { passive: true });
    window.addEventListener('mouseup',    onEnd);
    window.addEventListener('touchend',   onEnd);
  }

  function getPos(e) {
    const rect = canvas.getBoundingClientRect();
    const src  = e.touches ? e.touches[0] : e;
    return {
      x: src.clientX - rect.left,
      y: src.clientY - rect.top
    };
  }

  function onStart(e) {
    joyActive = true;
    updateHandle(getPos(e));
  }

  function onMove(e) {
    if (!joyActive) return;
    updateHandle(getPos(e));
  }

  function onEnd() {
    if (!joyActive) return;
    joyActive  = false;
    joyHandle  = { ...joyOrigin };
    cmdLinear  = 0;
    cmdAngular = 0;
    drawJoystick();
  }

  function updateHandle(pos) {
    const dx = pos.x - joyOrigin.x;
    const dy = pos.y - joyOrigin.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const clamped = Math.min(dist, JOY_RADIUS);
    const angle   = Math.atan2(dy, dx);

    joyHandle = {
      x: joyOrigin.x + Math.cos(angle) * clamped,
      y: joyOrigin.y + Math.sin(angle) * clamped
    };

    // Map joystick axes to robot axes
    // Up/down → linear,  Left/right → angular (inverted X)
    const norm = clamped / JOY_RADIUS;
    cmdLinear  =  -Math.sin(angle) * norm * MAX_LINEAR;
    cmdAngular = -(Math.cos(angle) * norm * MAX_ANGULAR) * (dx < 0 ? -1 : 1);
    // Simpler direct mapping:
    cmdLinear  = -(dy / JOY_RADIUS) * MAX_LINEAR;
    cmdAngular = -(dx / JOY_RADIUS) * MAX_ANGULAR;

    drawJoystick();
  }

  /* ── KEYBOARD ── */
  function bindKeyboard() {
    window.addEventListener('keydown', (e) => {
      const k = e.key.toLowerCase();
      if (k in keys) { keys[k] = true; updateFromKeys(); }
    });
    window.addEventListener('keyup', (e) => {
      const k = e.key.toLowerCase();
      if (k in keys) { keys[k] = false; updateFromKeys(); }
    });
  }

  function updateFromKeys() {
    if (joyActive) return; // joystick takes priority
    let lin = 0, ang = 0;
    if (keys.w) lin  =  MAX_LINEAR;
    if (keys.s) lin  = -MAX_LINEAR;
    if (keys.a) ang  =  MAX_ANGULAR;
    if (keys.d) ang  = -MAX_ANGULAR;
    cmdLinear  = lin;
    cmdAngular = ang;
  }

  /* ── PUBLISH ── */
  function publishVelocity() {
    if (!publisher) return;
    const twist = new ROSLIB.Message({
      linear:  { x: cmdLinear,  y: 0, z: 0 },
      angular: { x: 0, y: 0, z: cmdAngular }
    });
    publisher.publish(twist);
  }

  function stop() {
    clearInterval(interval);
    interval = null;

    // Send zero velocity
    if (publisher) {
      const zero = new ROSLIB.Message({
        linear:  { x: 0, y: 0, z: 0 },
        angular: { x: 0, y: 0, z: 0 }
      });
      publisher.publish(zero);
      publisher = null;
    }
    cmdLinear = cmdAngular = 0;
  }

  return { init, stop };
})();