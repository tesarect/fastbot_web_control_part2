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
  let robotMarker = null;
  let poseSub     = null;

  const FIXED_FRAME = 'map';
  const URDF_PARAM  = '/fastbot_1_robot_state_publisher:robot_description';
  const MAP_YAML    = '/home/user/ros2_ws/src/fastbot_slam/maps/fastbot_map.yaml';

  // ---------------------------------------------------------------------------
  // Patch OccupancyGridClient — fixes the "trails" bug where old grids are
  // never removed because processMessage adds sceneNode but tries to remove
  // currentGrid (different objects).
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
  // Force map_server to republish /map by calling its load_map service.
  // Called automatically after the 3D viewer is set up.
  // ---------------------------------------------------------------------------
  function requestMapRepublish(ros) {
    const client = new ROSLIB.Service({
      ros,
      name:        '/map_server/load_map',
      serviceType: 'nav2_msgs/LoadMap',
    });

    const request = new ROSLIB.ServiceRequest({
      map_url: MAP_YAML,
    });

    client.callService(request,
      (result) => {
        console.log('[Model3D] map_server/load_map succeeded, result code:', result.result);
      },
      (err) => {
        // Non-fatal — map may have already been received, or service unavailable
        console.warn('[Model3D] map_server/load_map failed:', err);
      }
    );
  }

  // ---------------------------------------------------------------------------
  // Mesh path: webapp root → resolves package://fastbot_description/... correctly
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
      divID:      'model-container',
      width:      container.clientWidth  || 400,
      height:     container.clientHeight || 300,
      antialias:  true,
      background: '#111111',
    });

    // ── Grid ─────────────────────────────────────────────────────────────────
    viewer.addObject(new ROS3D.Grid({
      color:     '#0181c4',
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
    });

    // ── Occupancy map (z = 0.00) ──────────────────────────────────────────────
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

    // ── URDF robot model ──────────────────────────────────────────────────────
    urdfClient = new ROS3D.UrdfClient({
      ros,
      param:      URDF_PARAM,
      tfClient,
      path:       meshPath,
      rootObject: viewer.scene,
    });

    // ── Position marker ───────────────────────────────────────────────────────
    const geo = new THREE.SphereGeometry(0.05, 12, 12);
    const mat = new THREE.MeshBasicMaterial({ color: 0x00e5ff });
    robotMarker = new THREE.Mesh(geo, mat);
    robotMarker.position.set(0, 0, 0.05);
    viewer.scene.add(robotMarker);

    // ── AMCL pose ─────────────────────────────────────────────────────────────
    poseSub = new ROSLIB.Topic({
      ros,
      name:          '/amcl_pose',
      messageType:   'geometry_msgs/PoseWithCovarianceStamped',
      throttle_rate: 300,
      queue_length:  1,
    });
    poseSub.subscribe((msg) => {
      const p = msg.pose.pose.position;
      if (robotMarker) robotMarker.position.set(p.x, p.y, 0.05);
    });

    // ── Auto-trigger map republish after a short delay ────────────────────────
    // Delay gives TFClient and OccupancyGridClient time to subscribe first,
    // so they're ready to receive the map message when it arrives.
    setTimeout(() => requestMapRepublish(ros), 1500);

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
    robotMarker = null;

    const container = document.getElementById('model-container');
    if (container) container.innerHTML = '';
    const badge = document.getElementById('model-status');
    if (badge) { badge.textContent = 'LOADING'; badge.classList.remove('live'); }
  }

  return { init, stop };
})();