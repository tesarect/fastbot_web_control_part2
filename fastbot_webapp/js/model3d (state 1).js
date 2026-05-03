/**
 * model3d.js — 3D viewer for FastBot webapp
 *
 * Map visibility fix:
 *   map_server publishes /map only once on startup. If the browser connects
 *   after that, OccupancyGridClient never receives the message.
 *   Solution: call /map_server/load_map service automatically after connecting
 *   to force a republish. This happens transparently with no manual CLI needed.
 */

const model3d = (() => {

  let viewer      = null;
  let tfClient    = null;
  let urdfClient  = null;
  let poseSub     = null;

  // ── Key constants ──────────────────────────────────────────────────────────
  // fixedFrame: use base_link (like the example) so the URDF renders
  // immediately without needing the full map→odom→base_link TF chain.
  // The map/costmap layers use their own tfClient with fixedFrame:'map'.
  const URDF_FIXED_FRAME = 'fastbot_1_base_link';
  const MAP_FIXED_FRAME  = 'map';
  const URDF_PARAM       = '/fastbot_1_robot_state_publisher:robot_description';

  // ---------------------------------------------------------------------------
  // Patch OccupancyGridClient — fixes trails bug
  // ---------------------------------------------------------------------------
  function patchOccupancyGridClient() {
    const proto = ROS3D && ROS3D.OccupancyGridClient && ROS3D.OccupancyGridClient.prototype;
    if (!proto || proto._patched) return;

    proto.processMessage = function(message) {
      // Remove what was actually added to the scene (sceneNode, not currentGrid)
      if (this.sceneNode) {
        if (this.sceneNode.unsubscribeTf) {
          try { this.sceneNode.unsubscribeTf(); } catch(e) {}
        }
        this.rootObject.remove(this.sceneNode);
      }

      const grid = new ROS3D.OccupancyGrid({
        message,
        color:   this.color,
        opacity: this.opacity,
      });

      if (this.tfClient) {
        this.sceneNode = new ROS3D.SceneNode({
          frameID:  message.header.frame_id,
          tfClient: this.tfClient,
          object:   grid,
          pose:     this.offsetPose,
        });
      } else {
        this.sceneNode = grid;
      }

      this.currentGrid = grid;
      this.rootObject.add(this.sceneNode);
      if (this.emit) this.emit('change');
      if (!this.continuous) this.rosTopic.unsubscribe();
    };

    proto._patched = true;
    console.log('[Model3D] OccupancyGridClient patched');
  }

  // ---------------------------------------------------------------------------
  // Mesh path
  // ---------------------------------------------------------------------------
  function buildMeshPath() {
    const pathname = location.pathname.endsWith('/')
      ? location.pathname
      : location.pathname.substring(0, location.pathname.lastIndexOf('/') + 1);
    return location.origin + pathname;
  }

  // ---------------------------------------------------------------------------
  // z-offset pose helper (for stacking map layers without z-fighting)
  // ---------------------------------------------------------------------------
  function zPose(z) {
    return new ROSLIB.Pose({
      position:    { x: 0, y: 0, z },
      orientation: { x: 0, y: 0, z: 0, w: 1 },
    });
  }

  // ---------------------------------------------------------------------------
  // init
  // ---------------------------------------------------------------------------
  function init(ros) {
    const container = document.getElementById('model-container');
    if (!container) return;

    const badge    = document.getElementById('model-status');
    const meshPath = buildMeshPath();
    console.log('[Model3D] meshPath:', meshPath);

    // Patch before creating any OccupancyGridClient instance
    patchOccupancyGridClient();

    // ── Viewer ────────────────────────────────────────────────────────────────
    viewer = new ROS3D.Viewer({
      
    //   background: '#cccccc',
      background: '#111111',
      divID:      'model-container',
      width:      container.clientWidth  || 400,
      height:     container.clientHeight || 300,
      antialias:  true,
    });

    // ── Grid ─────────────────────────────────────────────────────────────────
    viewer.addObject(new ROS3D.Grid({
      color:     '#0181c4',
      cellSize:  0.5,
      num_cells: 20,
    }));

    // ── TF client for URDF (fixed to base_link — works without nav2/AMCL) ────
    // This matches the example exactly: fixedFrame = robot base frame.
    // The robot body renders at origin and joints animate via TF.
    const urdfTfClient = new ROSLIB.TFClient({
      ros,
      fixedFrame:   URDF_FIXED_FRAME,
      angularThres: 0.01,
      transThres:   0.01,
      rate:         10.0,
    });

    // ── URDF client — match example, no loader param (ros3d has it bundled) ───
    urdfClient = new ROS3D.UrdfClient({
      ros,
      param:      URDF_PARAM,
      tfClient:   urdfTfClient,
      path:       meshPath,
      rootObject: viewer.scene,
    });

    // Expose viewer globally so browser console can inspect it
    window._ros3dViewer = viewer;

    // After DAEs load: log mesh sizes and apply scale if needed
    setTimeout(() => {
      const scene = viewer.scene;
      let meshCount = 0;
      let totalSize = 0;

      scene.traverse((obj) => {
        if (obj.type !== 'Mesh') return;
        meshCount++;
        // r61 Box3: compute size manually from min/max
        const box  = new THREE.Box3();
        box.setFromObject(obj);
        const sx = box.max.x - box.min.x;
        const sy = box.max.y - box.min.y;
        const sz = box.max.z - box.min.z;
        const maxDim = Math.max(sx, sy, sz);
        totalSize += maxDim;
        console.log('[Model3D] Mesh:', obj.name || obj.uuid.slice(0,8),
          `${sx.toFixed(4)} x ${sy.toFixed(4)} x ${sz.toFixed(4)} m`,
          'mat:', obj.material ? obj.material.type : 'none');
      });

      console.log('[Model3D] Total meshes found:', meshCount, 'avgMaxDim:', (totalSize/Math.max(meshCount,1)).toFixed(4));

      if (meshCount > 0 && totalSize / meshCount < 0.01) {
        // Meshes are microscopic — scale up (mm to m conversion)
        console.log('[Model3D] Meshes too small, applying x1000 scale');
        scene.children.forEach((child) => {
          if (child.type === 'Object3D' && child !== scene.children[0]) {
            child.scale.set(1000, 1000, 1000);
          }
        });
      }
    }, 5000);

    // ── Separate TF client for map layers (fixed to map frame) ───────────────
    tfClient = new ROSLIB.TFClient({
      ros,
      fixedFrame:   MAP_FIXED_FRAME,
      angularThres: 0.01,
      transThres:   0.01,
      rate:         10.0,
    });

    // ── Occupancy map ─────────────────────────────────────────────────────────
    try {
      new ROS3D.OccupancyGridClient({
        ros,
        tfClient,
        rootObject: viewer.scene,
        topic:      '/map',
        continuous: true,
        opacity:    1.0,
        offsetPose: zPose(0.00),
      });
      console.log('[Model3D] OccupancyGridClient attached to /map');
    } catch (e) {
      console.warn('[Model3D] Map unavailable:', e.message);
    }

    // ── Global costmap (z = 0.01) ─────────────────────────────────────────────
    try {
      new ROS3D.OccupancyGridClient({
        ros,
        tfClient,
        rootObject: viewer.scene,
        topic:      '/global_costmap/costmap',
        continuous: true,
        opacity:    0.4,
        offsetPose: zPose(0.01),
      });
    } catch (e) { /* non-fatal */ }

    // ── Local costmap (z = 0.02) ──────────────────────────────────────────────
    try {
      new ROS3D.OccupancyGridClient({
        ros,
        tfClient,
        rootObject: viewer.scene,
        topic:      '/local_costmap/costmap',
        continuous: true,
        opacity:    0.5,
        offsetPose: zPose(0.02),
      });
    } catch (e) { /* non-fatal */ }

    // ── Laser scan ────────────────────────────────────────────────────────────
    try {
      new ROS3D.LaserScan({
        ros,
        tfClient,
        rootObject: viewer.scene,
        topic:      '/scan',
        material:   { color: 0xff2200, size: 0.05 },
      });
    } catch (e) { /* non-fatal */ }

    // ── AMCL pose — update robot marker in 2D map only (no marker in 3D) ─────
    // NOTE: We do NOT add a THREE.Mesh directly to viewer.scene in r89 —
    // it causes "object not an instance of THREE.Object3D" errors.
    // The URDF client handles robot visualization via TF frames.
    poseSub = new ROSLIB.Topic({
      ros,
      name:          '/amcl_pose',
      messageType:   'geometry_msgs/PoseWithCovarianceStamped',
      throttle_rate: 300,
      queue_length:  1,
    });
    poseSub.subscribe((_msg) => {
      // pose is consumed by map2d.js for the 2D marker
      // 3D position is handled by TF + URDF automatically
    });

    // ── Status & resize ───────────────────────────────────────────────────────
    if (badge) { badge.textContent = 'LIVE'; badge.classList.add('live'); }
    logger.log('3D viewer initialised');
    console.log('[Model3D] Viewer ready');

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
    if (viewer) { viewer.stop(); viewer = null; }

    const container = document.getElementById('model-container');
    if (container) container.innerHTML = '';
    const badge = document.getElementById('model-status');
    if (badge) { badge.textContent = 'LOADING'; badge.classList.remove('live'); }
  }

  return { init, stop };
})();