/**
 * Renders the FastBot 3D model in the browser using ros3djs.
 * Shows the robot URDF with live TF transforms.
 *
 * Requires:
 *  - three.js
 *  - ros3djs
 *  - tf2_web_republisher running on the robot
 */

const model3d = (() => {

  let viewer   = null;
  let tfClient = null;
  let urdfClient = null;

  // Adjust this to where your robot URDF meshes are served from.
  // The web_video_server or a static file server can serve them.
  // In The Construct, meshes are typically served from the webpage directory.
  const URDF_PACKAGE_PATH = '../';   // root of webpage_ws
  const ROBOT_DESCRIPTION_TOPIC = '/fastbot_1_robot_description';
  const FIXED_FRAME = 'fastbot_1_odom';

  function init(ros) {
    const container = document.getElementById('model-container');
    if (!container) return;

    const badge = document.getElementById('model-status');

    // Create the 3D viewer
    viewer = new ROS3D.Viewer({
      divID:           'model-container',
      width:           container.clientWidth  || 400,
      height:          container.clientHeight || 300,
      antialias:       true,
      background:      '#0d0f12',
      cameraPose:      { x: 0.5, y: 0.5, z: 0.8 },
      cameraZoomSpeed: 0.5
    });

    // Add a grid for reference
    viewer.addObject(new ROS3D.Grid({
      color:    '#1a2030',
      cellSize: 0.5,
      num_cells: 10
    }));

    // TF client — listens to transforms via tf2_web_republisher
    tfClient = new ROSLIB.TFClient({
      ros,
      angularThres:  0.01,
      transThres:    0.01,
      rate:          10.0,
      fixedFrame:    FIXED_FRAME
    });

    // URDF client — loads robot description and renders mesh
    urdfClient = new ROS3D.UrdfClient({
      ros,
      tfClient,
      path:            URDF_PACKAGE_PATH,
      rootObject:      viewer.scene,
      loader:          ROS3D.COLLADA_LOADER,
      param:           'robot_description'
    });

    badge.textContent = 'LIVE';
    badge.classList.add('live');

    console.log('3D model viewer initialised');

    // Handle resize
    window.addEventListener('resize', () => onResize(container));
  }

  function onResize(container) {
    if (!viewer) return;
    viewer.resize(container.clientWidth, container.clientHeight);
  }

  function stop() {
    if (tfClient)   { tfClient.dispose();  tfClient   = null; }
    if (urdfClient) {                       urdfClient = null; }
    if (viewer)     { viewer.stop();        viewer     = null; }

    const container = document.getElementById('model-container');
    if (container) container.innerHTML = '';

    const badge = document.getElementById('model-status');
    if (badge) {
      badge.textContent = 'LOADING';
      badge.classList.remove('live');
    }
  }

  return { init, stop };
})();