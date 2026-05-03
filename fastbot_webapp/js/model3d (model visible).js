/**
 * model3d.js — stripped to match example code exactly.
 * Everything non-essential commented out for debugging.
 * Add back map/costmap/laser after model appears.
 */

const model3d = (() => {

  let viewer     = null;
  let tfClient   = null;
  let urdfClient = null;
  let poseSub    = null;
  let visPoller  = null;

//   const FIXED_FRAME = 'fastbot_1_odom';
  const URDF_FIXED_FRAME = 'fastbot_1_base_link';
  const MAP_FIXED_FRAME  = 'map';
  const URDF_PARAM  = '/fastbot_1_robot_state_publisher:robot_description';

  // ---------------------------------------------------------------------------
  // Loading overlay — shown until robot meshes become visible
  // ---------------------------------------------------------------------------
  function showLoadingOverlay(container) {
    const overlay = document.createElement('div');
    overlay.id = 'model3d-loading';
    overlay.style.cssText = [
      'position:absolute', 'inset:0',
      'display:flex', 'flex-direction:column',
      'align-items:center', 'justify-content:center',
      'background:rgba(13,15,20,0.85)',
      'color:#00e5ff', 'font-family:monospace',
      'font-size:12px', 'letter-spacing:2px',
      'z-index:10', 'pointer-events:none',
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
    return overlay;
  }

  function hideLoadingOverlay() {
    const el = document.getElementById('model3d-loading');
    if (el) el.remove();
  }

  function setLoadDetail(msg) {
    const el = document.getElementById('model3d-load-detail');
    if (el) el.textContent = msg;
  }

  // ---------------------------------------------------------------------------
  // Patch OccupancyGridClient — fixes trails bug
  // ---------------------------------------------------------------------------
  function patchOccupancyGridClient() {
    const proto = ROS3D && ROS3D.OccupancyGridClient && ROS3D.OccupancyGridClient.prototype;
    if (!proto || proto._patched) return;

    proto.processMessage = function(message) {
      if (this.sceneNode) {
        if (this.sceneNode.unsubscribeTf) {
          try { this.sceneNode.unsubscribeTf(); } catch(e) {}
        }
        this.rootObject.remove(this.sceneNode);
      }
      const grid = new ROS3D.OccupancyGrid({
        message, color: this.color, opacity: this.opacity,
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

  function buildMeshPath() {
    const pathname = location.pathname.endsWith('/')
      ? location.pathname
      : location.pathname.substring(0, location.pathname.lastIndexOf('/') + 1);
    return location.origin + pathname;
  }

  function zPose(z) {
    return new ROSLIB.Pose({
      position:    { x: 0, y: 0, z },
      orientation: { x: 0, y: 0, z: 0, w: 1 },
    });
  }

  // ---------------------------------------------------------------------------
  // Poll scene for named robot meshes becoming visible, then hide overlay
  // ---------------------------------------------------------------------------
  function startVisibilityPoller() {
    let checks = 0;
    let lastNamedCount = 0;
    let stableChecks = 0;
    const MIN_MESHES  = 5;   // expect at least 5 named meshes (lidar + chassis + wheels + camera parts)
    const STABLE_NEED = 3;   // count must be stable for 3 consecutive checks (6s) before hiding

    visPoller = setInterval(() => {
      if (!viewer) { clearInterval(visPoller); return; }
      checks++;

      let named = 0, visNamed = 0;
      viewer.scene.traverse((obj) => {
        if (obj.type !== 'Mesh') return;
        // Named meshes = real robot parts (TF axis arrows have UUID-only names)
        if (obj.name && obj.name.length > 2 && !obj.name.match(/^[0-9A-F]{8}$/i)) {
          named++;
          if (obj.visible) visNamed++;
        }
      });

      const elapsed = checks * 2;
      setLoadDetail(`Parsing meshes... ${elapsed}s (${visNamed}/${named})`);
      console.log(`[Model3D] ${elapsed}s — named meshes: ${named}, visible: ${visNamed}`);

      // Track stability — count must stop growing before we trust it is complete
      if (named === lastNamedCount && named > 0) {
        stableChecks++;
      } else {
        stableChecks = 0;
        lastNamedCount = named;
      }

      // Hide overlay only when: minimum count reached + count stable + all visible
      if (named >= MIN_MESHES && stableChecks >= STABLE_NEED && visNamed === named) {
        clearInterval(visPoller);
        visPoller = null;
        hideLoadingOverlay();
        console.log(`[Model3D] ${named} named meshes stable and visible — overlay hidden`);
        return;
      }

      // Also hide if count is stable but some are still invisible after 30s
      // (means those frames will never get a TF transform)
      if (named >= MIN_MESHES && stableChecks >= STABLE_NEED && elapsed >= 30) {
        clearInterval(visPoller);
        visPoller = null;
        hideLoadingOverlay();
        console.warn(`[Model3D] Hiding overlay after stable ${elapsed}s — ${visNamed}/${named} visible`);
        return;
      }

      if (checks > 90) {   // 180s hard timeout
        clearInterval(visPoller);
        visPoller = null;
        hideLoadingOverlay();
        console.warn('[Model3D] Hard timeout — hiding overlay');
      }
    }, 2000);
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
    console.log('[Model3D] URDF param:', URDF_PARAM);

    // Run patch BEFORE creating any OccupancyGridClient
    patchOccupancyGridClient();

    // Show loading overlay immediately
    const overlay = showLoadingOverlay(container);

    // ── Viewer ────────────────────────────────────────────────────────────────
    viewer = new ROS3D.Viewer({
      background: '#cccccc',
    //   background: '#111111',
      divID:      'model-container',
      width:      container.clientWidth  || 400,
      height:     container.clientHeight || 300,
      antialias:  true,
      fixedFrame: URDF_FIXED_FRAME,
    //   fixedFrame: FIXED_FRAME,
    });

    viewer.addObject(new ROS3D.Grid({
      color:     '#0181c4',
      cellSize:  0.5,
      num_cells: 20,
    }));

    // Expose for console debugging: _viewer.camera.position etc.
    window._viewer = viewer;

    // ── TF client ─────────────────────────────────────────────────────────────
    tfClient = new ROSLIB.TFClient({
      ros,
    //   fixedFrame:          FIXED_FRAME,
      fixedFrame:          URDF_FIXED_FRAME,
      angularThres:        0.01,
      transThres:          0.01,
      rate:                10.0,
      serverName:          '/tf2_web_republisher',
      repubServiceName:    '/republish_tfs',
      groovyCompatibility: true,
    });

    // tf2_web_republisher action not delivering transforms in this ROS2 setup.
    // Subscribe to /tf and /tf_static directly and feed into tfClient.
    // processTFArray accepts the same format as /tf messages.
    const tfSub = new ROSLIB.Topic({
      ros,
      name:        '/tf',
      messageType: 'tf2_msgs/TFMessage',
      queue_length: 100,
      throttle_rate: 0,
    });
    tfSub.subscribe((msg) => {
      if (tfClient && tfClient.processTFArray) {
        tfClient.processTFArray(msg);
      }
    });

    const tfStaticSub = new ROSLIB.Topic({
      ros,
      name:        '/tf_static',
      messageType: 'tf2_msgs/TFMessage',
      queue_length: 100,
      throttle_rate: 0,
    });
    tfStaticSub.subscribe((msg) => {
      if (tfClient && tfClient.processTFArray) {
        tfClient.processTFArray(msg);
      }
    });

    console.log('[Model3D] Direct /tf + /tf_static subscription active');

    // Expose tfClient for debugging
    window._tfClient = tfClient;

    // ── URDF ──────────────────────────────────────────────────────────────────
    setLoadDetail('Fetching URDF...');
    urdfClient = new ROS3D.UrdfClient({
      ros,
      param:      URDF_PARAM,
      tfClient,
      path:       meshPath,
      rootObject: viewer.scene,
    });

    // Force matrix world updates every frame to ensure TF transforms propagate
    // This fixes worldPos=(0,0,0) when SceneNode TF hasn't propagated yet
    const origDraw = viewer.draw.bind(viewer);
    viewer.draw = function() {
      if (viewer && viewer.scene) {
        viewer.scene.updateMatrixWorld(true);
      }
      origDraw();
    };

    // Start polling for mesh visibility
    setTimeout(() => {
      setLoadDetail('Parsing DAE meshes...');
      startVisibilityPoller();
    }, 2000);

    // ── Separate TF client for map frame ─────────────────────────────────────
    const mapTfClient = new ROSLIB.TFClient({
      ros,
      fixedFrame:          MAP_FIXED_FRAME,
      angularThres:        0.01,
      transThres:          0.01,
      rate:                10.0,
      serverName:          '/tf2_web_republisher',
      repubServiceName:    '/republish_tfs',
      groovyCompatibility: true,
    });
    // Feed /tf directly to map tfClient too
    const mapTfSub = new ROSLIB.Topic({
      ros,
      name:         '/tf',
      messageType:  'tf2_msgs/TFMessage',
      queue_length: 100,
    });
    mapTfSub.subscribe((msg) => {
      if (mapTfClient && mapTfClient.processTFArray) {
        mapTfClient.processTFArray(msg);
      }
    });
    const mapTfStaticSub = new ROSLIB.Topic({
      ros,
      name:         '/tf_static',
      messageType:  'tf2_msgs/TFMessage',
      queue_length: 100,
    });
    mapTfStaticSub.subscribe((msg) => {
      if (mapTfClient && mapTfClient.processTFArray) {
        mapTfClient.processTFArray(msg);
      }
    });

    // ── Occupancy map (uses map tfClient) ─────────────────────────────────────
    // Costmaps removed from 3D view — they cause flickering and z-fighting.
    // Costmaps are visible in the 2D map panel instead.
    try {
      new ROS3D.OccupancyGridClient({
        ros,
        tfClient:   mapTfClient,
        rootObject: viewer.scene,
        topic:      '/map',
        continuous: true,
        opacity:    1.0,
        offsetPose: zPose(-0.01),  // slightly below grid to avoid z-fighting
          });
      console.log('[Model3D] OccupancyGridClient attached to /map');
    } catch (e) {
      console.warn('[Model3D] Map unavailable:', e.message);
        }

    // ── Laser scan (uses URDF tfClient — lidar frame) ─────────────────────────
    try {
      new ROS3D.LaserScan({
        ros,
        tfClient,
        rootObject: viewer.scene,
        topic:      '/scan',
        material:   { color: 0xff2200, size: 0.05 },
      });
    } catch (e) { /* non-fatal */ }

    // ── AMCL pose (consumed by map2d.js for 2D marker) ────────────────────────
    poseSub = new ROSLIB.Topic({
      ros,
      name:          '/amcl_pose',
      messageType:   'geometry_msgs/PoseWithCovarianceStamped',
      throttle_rate: 300,
      queue_length:  1,
    });
    poseSub.subscribe((_msg) => {});

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
    if (visPoller) { clearInterval(visPoller); visPoller = null; }
    if (poseSub)   { poseSub.unsubscribe();    poseSub   = null; }
    if (tfClient)  { tfClient.dispose();       tfClient  = null; }
    urdfClient = null;
    if (viewer)    { viewer.stop();            viewer    = null; }

    const container = document.getElementById('model-container');
    if (container) container.innerHTML = '';
    const badge = document.getElementById('model-status');
    if (badge) { badge.textContent = 'LOADING'; badge.classList.remove('live'); }
  }

  return { init, stop };
})();