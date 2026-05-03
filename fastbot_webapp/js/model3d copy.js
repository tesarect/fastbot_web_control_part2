/** model3d.js — 3D viewer: URDF robot + occupancy map + laser */

const model3d = (() => {

  let viewer        = null;
  let tfClient      = null;
  let mapTfClient   = null;
  let urdfClient    = null;
  let poseSub       = null;
  let visPoller     = null;

  const URDF_FIXED_FRAME = 'fastbot_1_odom';
  const MAP_FIXED_FRAME  = 'map';
  const URDF_PARAM       = '/fastbot_1_robot_state_publisher:robot_description';

  // ---------------------------------------------------------------------------
  // TF Tree — stores raw parent→child transforms from /tf and /tf_static,
  // then computes fixed_frame→any_frame by walking the tree upward.
  // This replaces tf2_web_republisher's server-side chaining.
  // ---------------------------------------------------------------------------
  const tfTree = {
    // raw[child] = { parentFrame, translation:{x,y,z}, rotation:{x,y,z,w} }
    raw: {},

    store(transform) {
      let child = transform.child_frame_id;
      if (child.startsWith('/')) child = child.slice(1);
      let parent = transform.header.frame_id;
      if (parent.startsWith('/')) parent = parent.slice(1);
      this.raw[child] = {
        parentFrame:  parent,
        translation:  transform.transform.translation,
        rotation:     transform.transform.rotation,
      };
    },

    // Multiply two quaternions
    multiplyQ(a, b) {
      return {
        x:  a.w*b.x + a.x*b.w + a.y*b.z - a.z*b.y,
        y:  a.w*b.y - a.x*b.z + a.y*b.w + a.z*b.x,
        z:  a.w*b.z + a.x*b.y - a.y*b.x + a.z*b.w,
        w:  a.w*b.w - a.x*b.x - a.y*b.y - a.z*b.z,
      };
    },

    // Rotate vector v by quaternion q
    rotateV(v, q) {
      const u = { x: q.x, y: q.y, z: q.z };
      const s = q.w;
      const dot = u.x*v.x + u.y*v.y + u.z*v.z;
      const cross = {
        x: u.y*v.z - u.z*v.y,
        y: u.z*v.x - u.x*v.z,
        z: u.x*v.y - u.y*v.x,
      };
      return {
        x: 2*dot*u.x + (s*s - (u.x*u.x+u.y*u.y+u.z*u.z))*v.x + 2*s*cross.x,
        y: 2*dot*u.y + (s*s - (u.x*u.x+u.y*u.y+u.z*u.z))*v.y + 2*s*cross.y,
        z: 2*dot*u.z + (s*s - (u.x*u.x+u.y*u.y+u.z*u.z))*v.z + 2*s*cross.z,
      };
    },

    // Compute transform from fixedFrame to targetFrame
    // Returns {translation, rotation} or null if chain broken
    compute(fixedFrame, targetFrame) {
      if (fixedFrame === targetFrame) {
        return { translation: {x:0,y:0,z:0}, rotation: {x:0,y:0,z:0,w:1} };
      }

      // Walk from targetFrame up to fixedFrame collecting the chain
      const chain = [];
      let current = targetFrame;
      let limit = 10;

      while (current !== fixedFrame && limit-- > 0) {
        const t = this.raw[current];
        if (!t) return null;  // chain broken
        chain.push(t);
        current = t.parentFrame;
      }

      if (current !== fixedFrame) return null;

      // Compose chain in reverse (fixedFrame→target)
      // chain[0] = parent→targetFrame, chain[last] = fixedFrame→something
      // We walk from fixed to target: reverse the chain
      chain.reverse();

      let tx = 0, ty = 0, tz = 0;
      let rx = 0, ry = 0, rz = 0, rw = 1;

      for (const t of chain) {
        // Apply current accumulated rotation to this translation
        const rotated = this.rotateV(t.translation, {x:rx, y:ry, z:rz, w:rw});
        tx += rotated.x;
        ty += rotated.y;
        tz += rotated.z;
        // Compose rotations
        const q = this.multiplyQ({x:rx,y:ry,z:rz,w:rw}, t.rotation);
        rx = q.x; ry = q.y; rz = q.z; rw = q.w;
      }

      return {
        translation: { x: tx, y: ty, z: tz },
        rotation:    { x: rx, y: ry, z: rz, w: rw },
      };
    },
  };

  // ---------------------------------------------------------------------------
  // Subscribe to /tf and /tf_static, store in tree, update tfClient frameInfos
  // ---------------------------------------------------------------------------
  // Single shared /tf subscription feeds all TF clients
  // Avoids duplicate subscriptions that lag the simulation
  function setupDirectTF(ros, clients) {
    function processMsgs(msg) {
      msg.transforms.forEach(t => tfTree.store(t));

      // Update all registered clients
      clients.forEach(({ client, fixedFrame }) => {
        Object.keys(client.frameInfos).forEach(frameId => {
          const computed = tfTree.compute(fixedFrame, frameId);
          if (!computed) return;
          const fi = client.frameInfos[frameId];
          fi.transform = {
            translation: computed.translation,
            rotation:    computed.rotation,
          };
          if (fi.cbs) fi.cbs.forEach(cb => cb(fi.transform));
        });
      });
    }

    // ONE subscription to /tf for all clients
    const tfSub = new ROSLIB.Topic({
      ros, name: '/tf', messageType: 'tf2_msgs/TFMessage',
      queue_length: 50, throttle_rate: 50,  // 20Hz max, reduce CPU
    });
    tfSub.subscribe(processMsgs);

    // ONE subscription to /tf_static for all clients
    const tfStaticSub = new ROSLIB.Topic({
      ros, name: '/tf_static', messageType: 'tf2_msgs/TFMessage',
      queue_length: 10, throttle_rate: 0,
    });
    tfStaticSub.subscribe(processMsgs);

    return { tfSub, tfStaticSub };
  }

  // ---------------------------------------------------------------------------
  // Patch OccupancyGridClient
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
  // Loading overlay
  // ---------------------------------------------------------------------------
  function showLoadingOverlay(container) {
    const overlay = document.createElement('div');
    overlay.id = 'model3d-loading';
    overlay.style.cssText = [
      'position:absolute','inset:0','display:flex','flex-direction:column',
      'align-items:center','justify-content:center',
      'background:rgba(13,15,20,0.85)','color:#00e5ff',
      'font-family:monospace','font-size:12px','letter-spacing:2px',
      'z-index:10','pointer-events:none',
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

  function startVisibilityPoller() {
    let checks = 0, lastCount = 0, stableChecks = 0;
    const MIN_MESHES = 5, STABLE_NEED = 3;
    visPoller = setInterval(() => {
      if (!viewer) { clearInterval(visPoller); return; }
      checks++;
      let named = 0, vis = 0;
      viewer.scene.traverse((obj) => {
        if (obj.type !== 'Mesh') return;
        if (!obj.name || obj.name.length < 3 || obj.name.match(/^[0-9A-F]{8}$/i)) return;
        named++;
        if (obj.visible) vis++;
      });
      const elapsed = checks * 2;
      setLoadDetail(`Parsing meshes... ${elapsed}s (${vis}/${named})`);
      if (named === lastCount && named > 0) stableChecks++;
      else { stableChecks = 0; lastCount = named; }
      if (named >= MIN_MESHES && stableChecks >= STABLE_NEED && vis === named) {
        clearInterval(visPoller); visPoller = null;
        hideLoadingOverlay();
        const b1 = document.getElementById("model-status");
        if (b1) { b1.textContent = "LIVE"; b1.classList.add("live"); }
        console.log(`[Model3D] ${named} meshes visible — overlay hidden`);
      }
      if (named >= MIN_MESHES && stableChecks >= STABLE_NEED && elapsed >= 30) {
        clearInterval(visPoller); visPoller = null;
        hideLoadingOverlay();
        const b2 = document.getElementById("model-status");
        if (b2) { b2.textContent = "LIVE"; b2.classList.add("live"); }
        console.warn(`[Model3D] Timeout — ${vis}/${named} visible`);
      }
      if (checks > 90) {
        clearInterval(visPoller); visPoller = null;
        hideLoadingOverlay();
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

    patchOccupancyGridClient();
    showLoadingOverlay(container);

    // ── Viewer ────────────────────────────────────────────────────────────────
    viewer = new ROS3D.Viewer({
      background: '#111111',
      divID:      'model-container',
      width:      container.clientWidth  || 400,
      height:     container.clientHeight || 300,
      antialias:  true,
      fixedFrame: URDF_FIXED_FRAME,
    });
    window._viewer = viewer;

    viewer.addObject(new ROS3D.Grid({
      color:     '#0181c4',
      cellSize:  0.5,
      num_cells: 20,
    }));

    // ── TF client for URDF (odom fixed frame) ─────────────────────────────────
    tfClient = new ROSLIB.TFClient({
      ros,
      fixedFrame:          URDF_FIXED_FRAME,
      angularThres:        0.01,
      transThres:          0.01,
      rate:                10.0,
      serverName:          '/tf2_web_republisher',
      repubServiceName:    '/republish_tfs',
      groovyCompatibility: true,
    });
    window._tfClient = tfClient;

    // ── TF client for map ─────────────────────────────────────────────────────
    mapTfClient = new ROSLIB.TFClient({
      ros,
      fixedFrame:          MAP_FIXED_FRAME,
      angularThres:        0.01,
      transThres:          0.01,
      rate:                10.0,
      serverName:          '/tf2_web_republisher',
      repubServiceName:    '/republish_tfs',
      groovyCompatibility: true,
    });

    // Single shared /tf + /tf_static subscription for ALL clients — avoids duplicates
    setupDirectTF(ros, [
      { client: tfClient,    fixedFrame: URDF_FIXED_FRAME },
      { client: mapTfClient, fixedFrame: MAP_FIXED_FRAME  },
    ]);
    console.log('[Model3D] Single /tf subscription active for all clients');

    // ── URDF ──────────────────────────────────────────────────────────────────
    setLoadDetail('Fetching URDF...');
    urdfClient = new ROS3D.UrdfClient({
      ros,
      param:      URDF_PARAM,
      tfClient,
      path:       meshPath,
      rootObject: viewer.scene,
    });

    // Force matrix updates every frame
    const origDraw = viewer.draw.bind(viewer);
    viewer.draw = function() {
      if (viewer && viewer.scene) viewer.scene.updateMatrixWorld(true);
      origDraw();
    };

    setTimeout(() => {
      setLoadDetail('Parsing DAE meshes...');
      startVisibilityPoller();
    }, 2000);

    // ── Occupancy map (map frame) ─────────────────────────────────────────────
    try {
      new ROS3D.OccupancyGridClient({
        ros,
        tfClient:   mapTfClient,
        rootObject: viewer.scene,
        topic:      '/map',
        continuous: true,
        opacity:    1.0,
        offsetPose: zPose(-0.05),  // lower map so robot sits on top
      });
      console.log('[Model3D] OccupancyGridClient attached to /map');
    } catch (e) {
      console.warn('[Model3D] Map unavailable:', e.message);
    }

    // ── Laser scan ────────────────────────────────────────────────────────────
    try {
      new ROS3D.LaserScan({
        ros, tfClient,
        rootObject:    viewer.scene,
        topic:         '/scan',
        material:      { color: 0xff2200, size: 0.05 },
        throttle_rate: 200,  // 5Hz max — scan is large, reduce rosbridge load
        queue_length:  1,
      });
    } catch (e) { /* non-fatal */ }

    // ── AMCL pose ─────────────────────────────────────────────────────────────
    poseSub = new ROSLIB.Topic({
      ros,
      name:          '/amcl_pose',
      messageType:   'geometry_msgs/PoseWithCovarianceStamped',
      throttle_rate: 300,
      queue_length:  1,
    });
    poseSub.subscribe((_msg) => {});

    if (badge) { badge.textContent = 'LOADING'; badge.classList.remove('live'); }
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
    if (visPoller)  { clearInterval(visPoller); visPoller  = null; }
    if (poseSub)    { poseSub.unsubscribe();    poseSub    = null; }
    if (tfClient)   { tfClient.dispose();       tfClient   = null; }
    if (mapTfClient){ mapTfClient.dispose();    mapTfClient= null; }
    urdfClient = null;
    if (viewer) { viewer.stop(); viewer = null; }
    window._viewer = null;
    window._tfClient = null;

    const container = document.getElementById('model-container');
    if (container) container.innerHTML = '';
    const badge = document.getElementById('model-status');
    if (badge) { badge.textContent = 'LOADING'; badge.classList.remove('live'); }
  }

  return { init, stop };
})();