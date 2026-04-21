/**
 * map2d.js — 2D occupancy grid map rendered on a plain HTML5 canvas.
 * No EaselJS, no ros2d.js dependency — works with just roslib.min.js.
 *
 * Subscribes to:
 *   /map          (nav_msgs/OccupancyGrid) — draws the static map
 *   /amcl_pose    (geometry_msgs/PoseWithCovarianceStamped) — robot position
 *   /scan         (sensor_msgs/LaserScan) — laser points overlay (optional)
 */

const map2d = (() => {

  let canvas      = null;
  let ctx         = null;
  let mapSub      = null;
  let poseSub     = null;

  // Map metadata
  let mapMeta     = null;   // { width, height, resolution, origin }
  let mapImageData = null;  // cached ImageData of the drawn map

  // Robot pose in map frame
  let robotX = null, robotY = null, robotYaw = null;

  // ── Drawing helpers ─────────────────────────────────────────────────────────

  function worldToCanvas(wx, wy) {
    if (!mapMeta || !canvas) return null;
    // Map origin is bottom-left in ROS, canvas origin is top-left
    const px = (wx - mapMeta.origin.x) / mapMeta.resolution;
    const py = mapMeta.height - (wy - mapMeta.origin.y) / mapMeta.resolution;
    // Scale to canvas size
    const sx = canvas.width  / mapMeta.width;
    const sy = canvas.height / mapMeta.height;
    return { x: px * sx, y: py * sy };
  }

  function drawMap() {
    if (!ctx || !mapImageData || !canvas) return;

    // Clear and draw cached map image
    ctx.putImageData(mapImageData, 0, 0);

    // Draw robot if position known
    if (robotX !== null) {
      const pos = worldToCanvas(robotX, robotY);
      if (pos) {
        const r = Math.max(5, canvas.width * 0.015); // ~1.5% of canvas width

        // Robot body circle
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, r, 0, Math.PI * 2);
        ctx.fillStyle = '#00e5ff';
        ctx.fill();
        ctx.strokeStyle = '#003a44';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Heading arrow
        if (robotYaw !== null) {
          const len = r * 2;
          // ROS yaw: 0 = +X axis. Canvas: x right, y down — so negate yaw
          const dx =  Math.cos(robotYaw) * len;
          const dy = -Math.sin(robotYaw) * len;
          ctx.beginPath();
          ctx.moveTo(pos.x, pos.y);
          ctx.lineTo(pos.x + dx, pos.y + dy);
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 2;
          ctx.stroke();

          // Arrow head
          const headLen = r * 0.8;
          const angle = Math.atan2(dy, dx);
          ctx.beginPath();
          ctx.moveTo(pos.x + dx, pos.y + dy);
          ctx.lineTo(
            pos.x + dx - headLen * Math.cos(angle - Math.PI / 6),
            pos.y + dy - headLen * Math.sin(angle - Math.PI / 6)
          );
          ctx.lineTo(
            pos.x + dx - headLen * Math.cos(angle + Math.PI / 6),
            pos.y + dy - headLen * Math.sin(angle + Math.PI / 6)
          );
          ctx.closePath();
          ctx.fillStyle = '#ffffff';
          ctx.fill();
        }
      }
    }
  }

  function buildMapImage(msg) {
    // Create an offscreen canvas at map resolution, then scale to display canvas
    const w = msg.info.width;
    const h = msg.info.height;

    if (w === 0 || h === 0) return;

    // Resize display canvas to match map aspect ratio
    const container = document.getElementById('map-container');
    if (!container) return;
    const cw = container.clientWidth  || 400;
    const ch = container.clientHeight || 300;

    // Keep aspect ratio
    const mapAspect = w / h;
    const canAspect  = cw / ch;
    if (mapAspect > canAspect) {
      canvas.width  = cw;
      canvas.height = Math.round(cw / mapAspect);
    } else {
      canvas.height = ch;
      canvas.width  = Math.round(ch * mapAspect);
    }

    // Build pixel data from occupancy values
    const imgData = ctx.createImageData(canvas.width, canvas.height);
    const scaleX  = w / canvas.width;
    const scaleY  = h / canvas.height;

    for (let cy = 0; cy < canvas.height; cy++) {
      for (let cx = 0; cx < canvas.width; cx++) {
        // Map canvas pixel → map cell (ROS map is row-major, y=0 at bottom)
        const mx = Math.floor(cx * scaleX);
        const my = Math.floor((canvas.height - 1 - cy) * scaleY);
        const idx = my * w + mx;
        const val = msg.data[idx];

        const pIdx = (cy * canvas.width + cx) * 4;

        if (val === -1) {
          // Unknown — dark grey
          imgData.data[pIdx]     = 30;
          imgData.data[pIdx + 1] = 35;
          imgData.data[pIdx + 2] = 45;
          imgData.data[pIdx + 3] = 255;
        } else if (val === 0) {
          // Free — light (match dashboard background vibe)
          imgData.data[pIdx]     = 200;
          imgData.data[pIdx + 1] = 210;
          imgData.data[pIdx + 2] = 220;
          imgData.data[pIdx + 3] = 255;
        } else {
          // Occupied — dark (walls)
          const darkness = Math.round((1 - val / 100) * 40);
          imgData.data[pIdx]     = darkness;
          imgData.data[pIdx + 1] = darkness;
          imgData.data[pIdx + 2] = darkness + 5;
          imgData.data[pIdx + 3] = 255;
        }
      }
    }

    mapImageData = imgData;

    // Store metadata for coordinate transform
    mapMeta = {
      width:      w,
      height:     h,
      resolution: msg.info.resolution,
      origin: {
        x: msg.info.origin.position.x,
        y: msg.info.origin.position.y,
      },
    };

    console.log(`[Map2D] Map built: ${w}×${h} cells, res=${msg.info.resolution}m/cell`);
    drawMap();

    const badge = document.getElementById('map-status');
    if (badge) { badge.textContent = 'LIVE'; badge.classList.add('live'); }
  }

  // ── init ────────────────────────────────────────────────────────────────────

  function init(ros) {
    const container = document.getElementById('map-container');
    if (!container) return;

    // Create canvas inside container
    canvas = document.createElement('canvas');
    // canvas.style.cssText = 'position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);max-width:100%;max-height:100%;';
    // canvas.style.cssText = 'position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);max-width:100%;max-height:100%;image-rendering:pixelated;';
    canvas.style.cssText = 'position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);max-width:100%;max-height:100%;image-rendering:auto;';
    container.appendChild(canvas);
    ctx = canvas.getContext('2d');

    // Subscribe to /map
    mapSub = new ROSLIB.Topic({
      ros,
    //   name:        '/global_costmap/costmap',
      name:        '/map',
      messageType: 'nav_msgs/OccupancyGrid',
      throttle_rate: 0,
      queue_length:  1,
    });
    mapSub.subscribe((msg) => buildMapImage(msg));

    // Subscribe to /amcl_pose for robot position
    poseSub = new ROSLIB.Topic({
      ros,
      name:          '/amcl_pose',
      messageType:   'geometry_msgs/PoseWithCovarianceStamped',
      throttle_rate: 200,
      queue_length:  1,
    });
    poseSub.subscribe((msg) => {
      robotX = msg.pose.pose.position.x;
      robotY = msg.pose.pose.position.y;
      const q = msg.pose.pose.orientation;
      robotYaw = Math.atan2(
        2 * (q.w * q.z + q.x * q.y),
        1 - 2 * (q.y * q.y + q.z * q.z)
      );
      drawMap();
    });

    // Resize handler
    window.addEventListener('resize', () => {
      if (mapMeta && mapImageData) buildMapImage({ info: mapMeta, data: null });
    });

    console.log('[Map2D] Initialised (pure canvas, no EaselJS)');
  }

  // ── stop ────────────────────────────────────────────────────────────────────

  function stop() {
    if (mapSub)   { mapSub.unsubscribe();   mapSub   = null; }
    if (poseSub)  { poseSub.unsubscribe();  poseSub  = null; }
    canvas      = null;
    ctx         = null;
    mapMeta     = null;
    mapImageData = null;
    robotX = robotY = robotYaw = null;

    const container = document.getElementById('map-container');
    if (container) container.innerHTML = '';

    const badge = document.getElementById('map-status');
    if (badge) { badge.textContent = 'LOADING'; badge.classList.remove('live'); }
  }

  return { init, stop };
})();