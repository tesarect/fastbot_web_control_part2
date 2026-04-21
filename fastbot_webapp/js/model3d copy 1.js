/**
 * 3D viewer with robot URDF + occupancy map + position marker.
 *
 * Key fixes vs previous version:
 *  1. SCALE: OnShape-exported DAE files are in millimetres. The URDF has no
 *     <scale> tag, so Three.js loads them at 1:1 — making the robot ~200x too
 *     small (a 200 mm robot becomes 0.001 m on screen = invisible sliver).
 *     We scale the scene root after the URDF node is added.
 *  2. CAMERA: Switched to a gentle top-down-ish angle that shows both the flat
 *     map and the standing robot simultaneously.
 *  3. MAP Z: OccupancyGrid renders at Z=0 which z-fights the grid. Nudged to
 *     Z=-0.002 so it sits cleanly below the robot.
 *  4. LIGHTING: Added ambient + directional lights so MeshPhongMaterial is
 *     actually lit (without lights Phong renders black).
 *  5. SCALE DETECTION: Logs bounding-box size after first mesh loads so you
 *     can verify/tune MESH_SCALE without guessing.
 */

const model3d = (() => {

  let viewer      = null;
  let tfClient    = null;
  let urdfClient  = null;
  let mapClient   = null;
  let robotMarker = null;
  let poseSub     = null;

  const FIXED_FRAME = 'map';
  const URDF_PARAM  = '/fastbot_1_robot_state_publisher:robot_description';
  const MAP_TOPIC   = '/map';

  // ── Scale factor ─────────────────────────────────────────────────────────────
  // OnShape exports DAE in millimetres → divide by 1000 to get metres.
  // If the robot still looks wrong, check the console log:
  //   "[Model3D] Scene bounding box after scale: X × Y × Z m"
  // A typical small robot is ~0.2 m wide. Tune this constant accordingly:
  //   still too small → increase  (try 0.01 for cm-scale exports)
  //   too large       → decrease
  const MESH_SCALE = 0.1;

  // ---------------------------------------------------------------------------
  // Lighting — must be added or MeshPhongMaterial renders solid black
  // ---------------------------------------------------------------------------
  function addLights(scene) {
    const ambient = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambient);

    const sun = new THREE.DirectionalLight(0xffffff, 0.8);
    sun.position.set(5, 5, 10);
    scene.add(sun);

    const fill = new THREE.DirectionalLight(0x8899bb, 0.3);
    fill.position.set(-5, -3, 4);
    scene.add(fill);
  }

  // ---------------------------------------------------------------------------
  // Material patcher — replaces materials with MeshPhongMaterial (r89 safe)
  // ---------------------------------------------------------------------------
  function fixMaterials(root) {
    if (!root) return;
    root.traverse((child) => {
      if (!child.isMesh) return;
      const old = child.material;
      // Skip already-patched materials (we tag them)
      if (old && old._patched) return;

      // Prefer the original diffuse color; fall back to a neutral grey
      let color = 0x999999;
      if (old && old.color) color = old.color.getHex();





      

      const mat = new THREE.MeshPhongMaterial({
        color,
        side:      THREE.DoubleSide,
        shininess: 60,
        specular:  new THREE.Color(0x333333),
      });
      mat._patched    = true;
      mat.needsUpdate = true;
      child.material  = mat;
    });
  }

  // ---------------------------------------------------------------------------
  // Scale every child of `scene` that wasn't in `knownBefore`
  // ---------------------------------------------------------------------------
  function scaleNewChildren(scene, knownBefore, scale) {
    scene.children.forEach((child) => {
      if (knownBefore.has(child)) return;
      child.scale.set(scale, scale, scale);
      console.log('[Model3D] Scaled new scene child:', child.name || child.uuid,
        'by', scale);
    });
  }

  // ---------------------------------------------------------------------------
  // Mesh path — maps package://fastbot_description/... to ./meshes/fastbot_description/...
  // ---------------------------------------------------------------------------
  function buildMeshPath() {
    let base = location.href.split('?')[0].split('#')[0];
    if (/\/[^/]+\.[^/]+$/.test(base)) {
      base = base.replace(/\/[^/]+$/, '/');
    } else if (!base.endsWith('/')) {
      base += '/';
    }
    return base + 'meshes/';
  }

  // ---------------------------------------------------------------------------
  // init — called once ROS is connected
  // ---------------------------------------------------------------------------
  function init(ros) {
    const container = document.getElementById('model-container');
    if (!container) return;

    const badge    = document.getElementById('model-status');
    const meshPath = buildMeshPath();
    console.log('[Model3D] meshPath:', meshPath);
    console.log('[Model3D] MESH_SCALE:', MESH_SCALE,
      '— tune if robot is too large or too small');

    // ── Viewer ────────────────────────────────────────────────────────────────
    viewer = new ROS3D.Viewer({
      divID:      'model-container',
      width:      container.clientWidth  || 400,
      height:     container.clientHeight || 300,
      antialias:  true,
      background: '#0d0f12',
      // Back-right elevated angle; orbit controls let user rotate freely
      cameraPose: { x: 3, y: 3, z: 4 },
    });

    // ── Lights ────────────────────────────────────────────────────────────────
    addLights(viewer.scene);

    // ── Grid ─────────────────────────────────────────────────────────────────
    viewer.addObject(new ROS3D.Grid({
      color:     '#1a2030',
      cellSize:  0.5,
      num_cells: 20,
    }));

    // ── TF client ─────────────────────────────────────────────────────────────
    tfClient = new ROSLIB.TFClient({
      ros,
      fixedFrame:   FIXED_FRAME,
      angularThres: 0.01,
      transThres:   0.01,
      rate:         15.0,
      serverName:   '/tf2_web_republisher',
    });

    // ── Occupancy-grid map ────────────────────────────────────────────────────
    try {
      mapClient = new ROS3D.OccupancyGridClient({
        ros,
        rootObject: viewer.scene,
        continuous: true,
        tfClient,
        topic:      MAP_TOPIC,
        color:      { r: 200, g: 220, b: 255 }, // pale-blue tint for free space
        opacity:    0.85,
      });

      // Nudge map below Z=0 so it doesn't z-fight the grid
      const nudgeMap = () => {
        viewer.scene.traverse((obj) => {
          // OccupancyGrid nodes don't have a fixed name; match by type
          if (obj.isObject3D && obj.name === '') return; // skip unnamed helpers
          if (obj.material && obj.material.map) {       // textured quad = the map
            obj.position.z = Math.min(obj.position.z, -0.002);
          }
        });
      };
      setTimeout(nudgeMap, 1500);
      setTimeout(nudgeMap, 4000);

      console.log('[Model3D] OccupancyGridClient created for', MAP_TOPIC);
    } catch (e) {
      console.warn('[Model3D] OccupancyGridClient unavailable:', e.message);
    }

    // ── URDF robot model ─────────────────────────────────────────────────────
    // Snapshot children present BEFORE the robot is added
    const childrenBefore = new Set(viewer.scene.children);

    urdfClient = new ROS3D.UrdfClient({
      ros,
      param:      URDF_PARAM,
      tfClient,
      path:       meshPath,
      rootObject: viewer.scene,
      loader:     ROS3D.COLLADA_LOADER_2,
    });

    // Poll: scale robot links as they appear, patch materials throughout
    let ticks  = 0;
    let scaled = false;
    const patchInterval = setInterval(() => {
      if (!viewer) { clearInterval(patchInterval); return; }

      // Scale new scene children once they appear
      if (!scaled && viewer.scene.children.length > childrenBefore.size) {
        scaleNewChildren(viewer.scene, childrenBefore, MESH_SCALE);
        scaled = true;

        // Log bounding box so scale can be verified / tuned
        const box  = new THREE.Box3().setFromObject(viewer.scene);
        const size = box.getSize(new THREE.Vector3());
        console.log(
          `[Model3D] Scene bbox after ×${MESH_SCALE} scale:`,
          `${size.x.toFixed(3)} × ${size.y.toFixed(3)} × ${size.z.toFixed(3)} m`,
          '— robot body should be roughly 0.15–0.30 m wide'
        );
      }

      fixMaterials(viewer.scene);
      ticks++;
      if (ticks >= 30) { // 15 s total
        clearInterval(patchInterval);
        console.log('[Model3D] Patch/scale interval finished');
      }
    }, 500);

    // ── Position marker (cyan sphere) ────────────────────────────────────────
    const geo = new THREE.SphereGeometry(0.06, 12, 12);
    const mat = new THREE.MeshBasicMaterial({ color: 0x00e5ff });
    robotMarker = new THREE.Mesh(geo, mat);
    robotMarker.position.set(0, 0, 0.06);
    viewer.scene.add(robotMarker);

    // ── AMCL pose subscription ────────────────────────────────────────────────
    poseSub = new ROSLIB.Topic({
      ros,
      name:          '/amcl_pose',
      messageType:   'geometry_msgs/PoseWithCovarianceStamped',
      throttle_rate: 300,
      queue_length:  1,
    });

    poseSub.subscribe((msg) => {
      const p = msg.pose.pose.position;
      if (robotMarker) robotMarker.position.set(p.x, p.y, 0.06);
      const q   = msg.pose.pose.orientation;
      const yaw = Math.atan2(
        2 * (q.w * q.z + q.x * q.y),
        1 - 2 * (q.y * q.y + q.z * q.z)
      );
      // Uncomment if you want pose in the logger:
      // logger.log(`Pos (${p.x.toFixed(2)}, ${p.y.toFixed(2)}) Yaw ${(yaw * 180 / Math.PI).toFixed(0)}°`);
    });

    // ── Status badge ──────────────────────────────────────────────────────────
    if (badge) {
      badge.textContent = 'LIVE';
      badge.classList.add('live');
    }
    logger.log('3D viewer initialised');
    console.log('[Model3D] Viewer ready, param:', URDF_PARAM);

    // ── Resize handler ────────────────────────────────────────────────────────
    window.addEventListener('resize', () => {
      if (viewer) viewer.resize(container.clientWidth, container.clientHeight);
    });
  }

  // ---------------------------------------------------------------------------
  // stop
  // ---------------------------------------------------------------------------
  function stop() {
    if (poseSub)  { poseSub.unsubscribe(); poseSub  = null; }
    if (tfClient) { tfClient.dispose();    tfClient = null; }
    urdfClient = null;
    mapClient  = null;
    if (viewer) { viewer.stop(); viewer = null; }
    robotMarker = null;

    const container = document.getElementById('model-container');
    if (container) container.innerHTML = '';
    const badge = document.getElementById('model-status');
    if (badge) { badge.textContent = 'LOADING'; badge.classList.remove('live'); }
  }

  return { init, stop };
})();