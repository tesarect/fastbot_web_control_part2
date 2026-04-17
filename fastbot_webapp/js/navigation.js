/**
 * Sends Nav2 waypoint goals via /navigate_to_pose action.
 * Waypoint coordinates based on the CP21 environment map.
 */

const navigation = (() => {

  // ── Waypoint definitions (x, y, yaw in map frame) ──
  // Adjust these values to match your actual map coordinates
  const WAYPOINTS = {
    living_room: { x: -1.5, y:  0.5, yaw: 0.0 },
    kitchen:     { x:  1.8, y: -0.5, yaw: -1.57 },
    sofa:        { x: -0.5, y:  1.5, yaw: 1.57  }
  };

  let actionClient = null;
  let currentGoal  = null;
  let activeBtn    = null;

  function init(ros) {
    actionClient = new ROSLIB.ActionClient({
      ros,
      serverName:  '/navigate_to_pose',
      actionName:  'nav2_msgs/action/NavigateToPose',
      omitFeedback: false,
      omitStatus:   false,
      omitResult:   false
    });
  }

  function sendWaypoint(name) {
    if (!actionClient) return;

    const wp = WAYPOINTS[name];
    if (!wp) { console.warn('Unknown waypoint:', name); return; }

    // Cancel any existing goal
    cancelGoal();

    // Highlight active button
    document.querySelectorAll('.wp-btn').forEach(b => b.classList.remove('active'));
    activeBtn = document.querySelector(`.wp-btn[onclick*="${name}"]`);
    if (activeBtn) activeBtn.classList.add('active');

    // Convert yaw to quaternion (rotation around Z)
    const qz = Math.sin(wp.yaw / 2);
    const qw = Math.cos(wp.yaw / 2);

    const goal = new ROSLIB.Goal({
      actionClient,
      goalMessage: {
        pose: {
          header: {
            stamp:    { sec: 0, nanosec: 0 },
            frame_id: 'map'
          },
          pose: {
            position:    { x: wp.x, y: wp.y, z: 0.0 },
            orientation: { x: 0.0,  y: 0.0,  z: qz, w: qw }
          }
        },
        behavior_tree: ''
      }
    });

    goal.on('result', (result) => {
      console.log('Navigation result:', result);
      if (activeBtn) activeBtn.classList.remove('active');
      activeBtn = null;
    });

    goal.on('feedback', (fb) => {
      // Optional: show distance remaining
      // console.log('Distance remaining:', fb.distance_remaining);
    });

    goal.send();
    currentGoal = goal;
    console.log(`Navigating to: ${name}`, wp);
  }

  function cancelGoal() {
    if (currentGoal) {
      currentGoal.cancel();
      currentGoal = null;
    }
    document.querySelectorAll('.wp-btn').forEach(b => b.classList.remove('active'));
    activeBtn = null;
  }

  function stop() {
    cancelGoal();
    actionClient = null;
  }

  return { init, sendWaypoint, cancelGoal, stop };
})();