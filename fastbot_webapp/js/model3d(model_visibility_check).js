/**
 * model3d.js — stripped to match example code exactly.
 * Everything non-essential commented out for debugging.
 * Add back map/costmap/laser after model appears.
 */

const model3d = (() => {

  let viewer     = null;
  let tfClient   = null;
  let urdfClient = null;

  // ── Match example exactly ──────────────────────────────────────────────────
  // Example uses:
  //   fixedFrame: 'fastbot_base_link'  (in TFClient)
  //   fixedFrame: 'fastbot_odom'       (in Viewer — but Viewer doesn't take fixedFrame)
  //   param: '/fastbot_robot_state_publisher:robot_description'
  //   loader: ROS3D.COLLADA_LOADER_2
  //   path: location.origin + location.pathname
  //
  // YOUR robot uses fastbot_1 namespace — check what param is actually set:
  //   ros2 param list | grep robot_description
  //   ros2 param get /fastbot_1_robot_state_publisher robot_description | head -3
  const URDF_PARAM  = '/fastbot_1_robot_state_publisher:robot_description';
  const FIXED_FRAME = 'fastbot_1_odom';   // must be a parent frame, not the robot's own base

  function init(ros) {
    const container = document.getElementById('model-container');
    if (!container) return;

    const badge    = document.getElementById('model-status');
    // Match example exactly: location.origin + location.pathname
    const meshPath = location.origin + location.pathname;
    console.log('[Model3D] meshPath:', meshPath);
    console.log('[Model3D] URDF param:', URDF_PARAM);
    console.log('[Model3D] Fixed frame:', FIXED_FRAME);

    // ── Viewer — match example ─────────────────────────────────────────────
    viewer = new ROS3D.Viewer({
    //   background: '#cccccc',
      background: '#111111',
      divID:      'model-container',
      width:      container.clientWidth  || 400,
      height:     container.clientHeight || 300,
      antialias:  true,
      fixedFrame: 'fastbot_1_odom',   // example passes this to Viewer too
    });

    // Expose for console debugging
    window._viewer = viewer;

    // ── Grid — match example ───────────────────────────────────────────────
    viewer.addObject(new ROS3D.Grid({
      color:     '#0181c4',
      cellSize:  0.5,
      num_cells: 20,
    }));

    // ── TF client — match example ──────────────────────────────────────────
    tfClient = new ROSLIB.TFClient({
      ros,
      angularThres:      0.01,
      transThres:        0.01,
      rate:              10.0,
      fixedFrame:        FIXED_FRAME,
      serverName:        '/tf2_web_republisher',
      repubServiceName:  '/republish_tfs',
    });

    // ── URDF — match example exactly, including COLLADA_LOADER_2 ──────────
    urdfClient = new ROS3D.UrdfClient({
      ros,
      param:      URDF_PARAM,
      tfClient,
      path:       meshPath,
      rootObject: viewer.scene,
      // loader: ROS3D.COLLADA_LOADER_2 — does NOT exist in this ros3d build, omit it
    });

    // ── Detect when all DAEs finish loading via scene child count ────────
    // ros3d adds a SceneNode per URDF link when DAE loads.
    // We poll until child count stabilises for 3 seconds.
    let lastChildCount = 0;
    let stableFor = 0;
    const loadPoller = setInterval(() => {
      if (!viewer) { clearInterval(loadPoller); return; }
      const count = viewer.scene.children.length;
      if (count === lastChildCount) {
        stableFor++;
        if (stableFor >= 3) {   // stable for 3 × 1s = all DAEs loaded
          clearInterval(loadPoller);
          console.log('[Model3D] Scene stable at', count, 'children — checking visibility');
          let meshCount = 0, visCount = 0;
      viewer.scene.traverse((obj) => {
        if (obj.type !== 'Mesh') return;
        meshCount++;
            if (obj.visible) visCount++;
            console.log('[Model3D] FINAL Mesh:', obj.name || obj.uuid.slice(0,8),
              'visible:', obj.visible);
          });
          console.log('[Model3D] FINAL:', meshCount, 'meshes,', visCount, 'visible');
        }
      } else {
        lastChildCount = count;
        stableFor = 0;
      }
    }, 1000);

    // ── Diagnostic: log meshes at 5s, 15s, 30s ──────────────────────────
    // DAEs load asynchronously — check multiple times to catch late loaders
    function checkMeshes(label) {
      let meshCount = 0, visCount = 0;
      viewer.scene.traverse((obj) => {
        if (obj.type !== 'Mesh') return;
        meshCount++;
        if (obj.visible) visCount++;
        console.log('[Model3D]', label, 'Mesh:', obj.name || obj.uuid.slice(0,8),
          'visible:', obj.visible,
          'mat:', obj.material ? obj.material.type : 'none',
          'parent:', obj.parent ? obj.parent.type : 'none');
      });
      console.log('[Model3D]', label, 'total:', meshCount, 'visible:', visCount);
    }
    setTimeout(() => checkMeshes('5s'),  5000);
    setTimeout(() => checkMeshes('15s'), 15000);
    setTimeout(() => checkMeshes('30s'), 30000);

    // Check TF is delivering transforms
    setTimeout(() => {
      console.log('[Model3D] TFClient frameInfo:', tfClient.frameInfos ? Object.keys(tfClient.frameInfos) : 'N/A');
    }, 5000);

    // ── Map layers commented out — add back after model works ─────────────
    // new ROS3D.OccupancyGridClient({ ... });
    // new ROS3D.LaserScan({ ... });

    if (badge) { badge.textContent = 'LIVE'; badge.classList.add('live'); }
    logger.log('3D viewer initialised');
    console.log('[Model3D] Viewer ready');

    window.addEventListener('resize', () => {
      if (viewer) viewer.resize(container.clientWidth, container.clientHeight);
    });
  }

  function stop() {
    if (tfClient) { tfClient.dispose(); tfClient = null; }
    urdfClient = null;
    if (viewer)  { viewer.stop();  viewer  = null; }
    window._viewer = null;

    const container = document.getElementById('model-container');
    if (container) container.innerHTML = '';
    const badge = document.getElementById('model-status');
    if (badge) { badge.textContent = 'LOADING'; badge.classList.remove('live'); }
  }

  return { init, stop };
})();