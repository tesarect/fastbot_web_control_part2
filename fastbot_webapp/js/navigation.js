/**
 * navigation.js
 * Sends Nav2 waypoint goals via /goal_pose topic.
 * Cancels via repeated zero velocity + new goal at current position.
 * Adds goal-reached detection using odometry distance.
 */

const navigation = (() => {

  // Waypoints from actual robot amcl_pose readings
  const WAYPOINTS = {
    living_room: { x:  1.089, y: -1.736, yaw: 0.0 },
    kitchen:     { x:  1.147, y:  2.383, yaw: 0.0 },
    sofa:        { x: -2.666, y: -1.197, yaw: 0.0 }
  };

  let ros_ref     = null;
  let goalTopic   = null;
  let cmdVelTopic = null;
  let stopInterval = null;
  let activeBtn   = null;

  // Track current robot position from odom
  let currentX = 0, currentY = 0, currentQz = 0, currentQw = 1;

  // Goal tracking
  let activeGoal = null;
  let goalReached = false;

  function init(ros) {
    ros_ref = ros;

    goalTopic = new ROSLIB.Topic({
      ros,
      name:        '/goal_pose',
      messageType: 'geometry_msgs/PoseStamped'
    });

    cmdVelTopic = new ROSLIB.Topic({
      ros,
      name:        '/fastbot_1/cmd_vel',
      messageType: 'geometry_msgs/Twist'
    });

    // Track robot position for cancel
    const odomSub = new ROSLIB.Topic({
      ros,
      name:        '/fastbot_1/odom',
      messageType: 'nav_msgs/Odometry',
      throttle_rate: 500,
      queue_length: 1
    });
    odomSub.subscribe((msg) => {
      currentX  = msg.pose.pose.position.x;
      currentY  = msg.pose.pose.position.y;
      currentQz = msg.pose.pose.orientation.z;
      currentQw = msg.pose.pose.orientation.w;

      // GOAL REACHED CHECK
      if (activeGoal && !goalReached) {
        const dx = currentX - activeGoal.x;
        const dy = currentY - activeGoal.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < 0.2) { // 20 cm tolerance
          goalReached = true;

          logger.log('✔ Goal reached');
          console.log('[Navigation] Goal reached');

          document.querySelectorAll('.wp-btn').forEach(b => b.classList.remove('active'));
          activeBtn = null;
        }
      }
    });

    console.log('[Navigation] Ready');
  }

  function sendWaypoint(name) {
    if (!goalTopic) return;

    // Stop any existing cancel
    clearStopInterval();

    const wp = WAYPOINTS[name];
    if (!wp) return;

    // Set active goal
    activeGoal = wp;
    goalReached = false;

    // Highlight active button
    document.querySelectorAll('.wp-btn').forEach(b => b.classList.remove('active'));
    activeBtn = document.querySelector(`.wp-btn[onclick*="${name}"]`);
    if (activeBtn) activeBtn.classList.add('active');

    // Convert yaw to quaternion
    const qz = Math.sin(wp.yaw / 2);
    const qw = Math.cos(wp.yaw / 2);

    goalTopic.publish(new ROSLIB.Message({
      header: { frame_id: 'map', stamp: { sec: 0, nanosec: 0 } },
      pose: {
        position:    { x: wp.x, y: wp.y, z: 0.0 },
        orientation: { x: 0.0, y: 0.0, z: qz, w: qw }
      }
    }));

    logger.log(`→ Navigating to ${name.replace('_',' ')}`);
    console.log(`[Navigation] Sent goal to: ${name}`, wp);
  }

  function cancelGoal() {
    clearStopInterval();

    // Reset goal tracking
    activeGoal = null;
    goalReached = false;

    // Step 1 — send zero velocity immediately
    sendZeroVel();

    // Step 2 — send goal AT current robot position to cancel navigation
    // Nav2 will reach the goal instantly (robot is already there) and stop
    if (goalTopic) {
      goalTopic.publish(new ROSLIB.Message({
        header: { frame_id: 'odom', stamp: { sec: 0, nanosec: 0 } },
        pose: {
          position:    { x: currentX, y: currentY, z: 0.0 },
          orientation: { x: 0.0, y: 0.0, z: currentQz, w: currentQw }
        }
      }));
    }

    // Step 3 — keep sending zero vel for 2 seconds to ensure stop
    stopInterval = setInterval(sendZeroVel, 100);
    setTimeout(clearStopInterval, 2000);

    document.querySelectorAll('.wp-btn').forEach(b => b.classList.remove('active'));
    activeBtn = null;
    logger.warn('Navigation stopped');
    console.log('[Navigation] Stop sent');
  }

  function sendZeroVel() {
    if (!cmdVelTopic) return;
    cmdVelTopic.publish(new ROSLIB.Message({
      linear:  { x: 0, y: 0, z: 0 },
      angular: { x: 0, y: 0, z: 0 }
    }));
  }

  function clearStopInterval() {
    if (stopInterval) { clearInterval(stopInterval); stopInterval = null; }
  }

  function stop() {
    clearStopInterval();
    if (goalTopic)   { goalTopic.unadvertise();   goalTopic   = null; }
    if (cmdVelTopic) { cmdVelTopic.unadvertise(); cmdVelTopic = null; }

    activeGoal = null;
    goalReached = false;

    document.querySelectorAll('.wp-btn').forEach(b => b.classList.remove('active'));
    activeBtn = null;
  }

  return { init, sendWaypoint, cancelGoal, stop };
})();