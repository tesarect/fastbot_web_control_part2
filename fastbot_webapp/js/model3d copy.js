/**
 * 3D viewer with robot URDF + position marker.
 * Patches mesh materials after load to fix Three.js r89 compatibility.
 */

const model3d = (() => {

  let viewer      = null;
  let tfClient    = null;
  let urdfClient  = null;
  let robotMarker = null;
  let poseSub     = null;

  const FIXED_FRAME = 'map';
  const URDF_PARAM  = '/fastbot_1_robot_state_publisher:robot_description';

  // Patch any broken materials in a scene object
  function fixMaterials(obj) {
    if (!obj) return;
    obj.traverse((child) => {
      if (child.isMesh) {
        // Replace with simple MeshBasicMaterial — always works in r89
        const oldColor = child.material && child.material.color
          ? child.material.color.clone()
          : new THREE.Color(0x888888);
        child.material = new THREE.MeshBasicMaterial({
          color: oldColor,
          side: THREE.DoubleSide
        });
        child.material.needsUpdate = true;
      }
    });
  }

  function init(ros) {
    const container = document.getElementById('model-container');
    if (!container) return;

    const badge = document.getElementById('model-status');

    const meshPath = location.origin +
      location.pathname.replace('index.html', '') +
      'meshes/';
    
    console.log('[Model3D] meshpath:', meshPath);

    viewer = new ROS3D.Viewer({
      divID:      'model-container',
      width:      container.clientWidth  || 400,
      height:     container.clientHeight || 300,
      antialias:  true,
      background: '#0d0f12',
      cameraPose: { x: 0.5, y: 0.5, z: 0.5 }
    });

    // Grid
    viewer.addObject(new ROS3D.Grid({
      color:     '#1a2030',
      cellSize:  0.25,
      num_cells: 20
    }));

    // TF client
    tfClient = new ROSLIB.TFClient({
      ros,
      fixedFrame:   FIXED_FRAME,
      angularThres: 0.01,
      transThres:   0.01,
      rate:         15.0,
      serverName:   '/tf2_web_republisher'
    });

    // URDF robot model
    urdfClient = new ROS3D.UrdfClient({
      ros,
      param:      URDF_PARAM,
      tfClient,
      path:       meshPath,
      rootObject: viewer.scene,
      loader:     ROS3D.COLLADA_LOADER_2
    });

    // Patch materials after Collada files finish loading
    // Poll scene every 500ms for new meshes and fix their materials
    let patchCount = 0;
    const patchInterval = setInterval(() => {
      fixMaterials(viewer.scene);
      patchCount++;
      if (patchCount > 10) clearInterval(patchInterval); // stop after 5s
    }, 500);

    // Cyan sphere to mark robot position
    const geo = new THREE.SphereGeometry(0.08, 16, 16);
    const mat = new THREE.MeshBasicMaterial({ color: 0x00e5ff });
    robotMarker = new THREE.Mesh(geo, mat);
    robotMarker.position.set(0, 0, 0.05);
    viewer.scene.add(robotMarker);

    // Track robot position
    poseSub = new ROSLIB.Topic({
      ros,
      name:          '/amcl_pose',
      messageType:   'geometry_msgs/PoseWithCovarianceStamped',
      throttle_rate: 300,
      queue_length:  1
    });

    poseSub.subscribe((msg) => {
      const p = msg.pose.pose.position;
      if (robotMarker) robotMarker.position.set(p.x, p.y, 0.05);
      const q   = msg.pose.pose.orientation;
      const yaw = Math.atan2(
        2*(q.w*q.z + q.x*q.y),
        1 - 2*(q.y*q.y + q.z*q.z)
      );
    //   logger.log(`Pos (${p.x.toFixed(2)}, ${p.y.toFixed(2)}) Yaw ${(yaw*180/Math.PI).toFixed(0)}°`);
    });

    badge.textContent = 'LIVE';
    badge.classList.add('live');
    logger.log('3D viewer initialised');
    console.log('[Model3D] Viewer ready, param:', URDF_PARAM);

    window.addEventListener('resize', () => {
      if (viewer) viewer.resize(container.clientWidth, container.clientHeight);
    });
  }

  function stop() {
    if (poseSub)    { poseSub.unsubscribe(); poseSub    = null; }
    if (tfClient)   { tfClient.dispose();    tfClient   = null; }
    if (urdfClient) {                        urdfClient = null; }
    if (viewer)     { viewer.stop();         viewer     = null; }
    robotMarker = null;
    const container = document.getElementById('model-container');
    if (container) container.innerHTML = '';
    const badge = document.getElementById('model-status');
    if (badge) { badge.textContent = 'LOADING'; badge.classList.remove('live'); }
  }

  return { init, stop };
})();