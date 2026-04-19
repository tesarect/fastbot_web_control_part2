/**
 * model3d.js
 * Renders the FastBot 3D model using ros3djs.
 */

const model3d = (() => {

  let viewer     = null;
  let tfClient   = null;
  let urdfClient = null;

  const FIXED_FRAME = 'map';
  const URDF_PARAM  = '/fastbot_1_robot_state_publisher:robot_description';

  function init(ros) {
    const container = document.getElementById('model-container');
    if (!container) return;

    const badge = document.getElementById('model-status');

    const meshPath = location.origin +
      location.pathname.replace('index.html', '') +
      'meshes/';
    console.log('[Model3D] Mesh path:', meshPath);

    viewer = new ROS3D.Viewer({
      divID:        'model-container',
      width:        container.clientWidth  || 400,
      height:       container.clientHeight || 300,
      antialias:    true,
      background:   '#0d0f12',
      cameraPose:   { x: 0.3, y: 0.3, z: 0.5 },  // close to small robot
    });

    viewer.addObject(new ROS3D.Grid({
      color:     '#1a2030',
      cellSize:  0.25,
      num_cells: 10
    }));

    // Standard TFClient with tf2_web_republisher
    tfClient = new ROSLIB.TFClient({
      ros,
      fixedFrame:   FIXED_FRAME,
      angularThres: 0.01,
      transThres:   0.01,
      rate:         15.0,
      serverName:   '/tf2_web_republisher'
    });

    urdfClient = new ROS3D.UrdfClient({
      ros,
      param:      URDF_PARAM,
      tfClient,
      path:       meshPath,
      rootObject: viewer.scene,
      loader:     ROS3D.COLLADA_LOADER_2
    });

    badge.textContent = 'LIVE';
    badge.classList.add('live');
    console.log('[Model3D] UrdfClient created, param:', URDF_PARAM);

    // Auto-zoom: after meshes load, fit camera to scene
    setTimeout(() => {
      if (viewer && viewer.camera) {
        // Look at origin where robot starts
        viewer.camera.position.set(0.5, 0.5, 0.5);
        viewer.camera.lookAt(0, 0, 0);
        console.log('[Model3D] Camera repositioned');
      }
    }, 4000);  // wait for collada to finish loading

    window.addEventListener('resize', () => {
      if (viewer) viewer.resize(container.clientWidth, container.clientHeight);
    });
  }

  function stop() {
    if (tfClient)   { tfClient.dispose(); tfClient   = null; }
    if (urdfClient) {                     urdfClient = null; }
    if (viewer)     { viewer.stop();      viewer     = null; }
    const container = document.getElementById('model-container');
    if (container) container.innerHTML = '';
    const badge = document.getElementById('model-status');
    if (badge) { badge.textContent = 'LOADING'; badge.classList.remove('live'); }
  }

  return { init, stop };
})();