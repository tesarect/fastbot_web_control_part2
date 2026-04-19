/**
 * Renders the FastBot 3D model in the browser using ros3djs.
 * Shows the robot URDF with live TF transforms.
 *
 * Requires:
 *  - three.js
 *  - ros3djs
 *  - tf2_web_republisher running on the robot
 * Prerequisites:
 *   cp -r ~/ros2_ws/src/fastbot_description/onshape/new_assets/* \
 *          ~/webpage_ws/fastbot_webapp/meshes/
 *
 * URDF uses: package://fastbot_description/onshape/new_assets/xxx.dae
 * ros3djs resolves: path + /fastbot_description/onshape/new_assets/xxx.dae
 * So path must point one level above fastbot_description/
 * We serve meshes/ as fastbot_description/onshape/new_assets/ via a symlink trick
 * OR we override the package path directly.
 */

const model3d = (() => {

  let viewer   = null;
  let tfClient = null;
  let urdfClient = null;

  const FIXED_FRAME = 'fastbot_1_base_link';  // use base_link as fixed — always exists

  function init(ros) {
    const container = document.getElementById('model-container');
    if (!container) return;

    const badge = document.getElementById('model-status');

    // Create the 3D viewer
    // Base URL of this webapp e.g. https://host/uuid/webpage/
    const baseUrl = window.location.href.replace(/\/[^\/]*$/, '/');

    // ros3djs resolves package:// URIs as:
    //   path + packageName + '/' + rest_of_path
    // URDF has: package://fastbot_description/onshape/new_assets/fastbotchassis.dae
    // We need path such that:
    //   path + 'fastbot_description/onshape/new_assets/fastbotchassis.dae' → valid URL
    // So create this folder structure in webapp:
    //   meshes/fastbot_description/onshape/new_assets/
    const meshPath = baseUrl + 'meshes/';

    console.log('[Model3D] Base URL:', baseUrl);
    console.log('[Model3D] Mesh path:', meshPath);

    // Viewer
    viewer = new ROS3D.Viewer({
      divID:      'model-container',
      width:      container.clientWidth  || 400,
      height:     container.clientHeight || 300,
      antialias:  true,
      background: '#0d0f12',
      cameraPose: { x: 0.5, y: 0.5, z: 0.5 },  // close to small robot
      near:       0.001,                           // see small objects
      far:        1000
    });

    // Add a grid for reference
    viewer.addObject(new ROS3D.Grid({
      color:     '#1a2030',
      cellSize:  0.5,
      num_cells: 10
    }));

    // TF client — listens to transforms via tf2_web_republisher
    tfClient = new ROSLIB.TFClient({
      ros,
      angularThres: 0.01,
      transThres:   0.01,
      rate:         10.0,
      fixedFrame:   FIXED_FRAME
    });

    console.log('[Model3D] Viewer initialised');

    // Fetch URDF directly via HTTP (avoids rosbridge message size limit)
    const urdfUrl = baseUrl + 'robot_description.urdf';
    console.log('[Model3D] Fetching URDF from:', urdfUrl);

    fetch(urdfUrl)
      .then(r => r.text())
      .then(urdfString => {
        console.log('[Model3D] URDF loaded, length:', urdfString.length);

        // Parse and load URDF manually
        const urdfModel = new ROSLIB.UrdfModel({ string: urdfString });

        const urdfObject = new ROS3D.Urdf({
          urdfModel,
          tfClient,
          path:       meshPath,
          rootObject: viewer.scene,
          loader:     ROS3D.COLLADA_LOADER_2
        });

        viewer.scene.add(urdfObject);
        badge.textContent = 'LIVE';
        badge.classList.add('live');
        console.log('[Model3D] URDF rendered successfully');
      })
      .catch(err => {
        console.error('[Model3D] Failed to load URDF:', err);
        // Fallback: try via roslib param
    urdfClient = new ROS3D.UrdfClient({
      ros,
      tfClient,
      path:       meshPath,
      rootObject: viewer.scene,
      loader:     ROS3D.COLLADA_LOADER_2,
      param:      'robot_description'
    });
        badge.textContent = 'LIVE (fallback)';
    badge.classList.add('live');
      });

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
    if (badge) {
      badge.textContent = 'LOADING';
      badge.classList.remove('live');
    }
  }

  return { init, stop };
})();