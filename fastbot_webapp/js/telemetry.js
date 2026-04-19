/**
 * Subscribes to /fastbot_1/odom and displays speed + pose. 
 * Shows speed from /cmd_vel_smoothed (actual commanded velocity)
 * and pose from /fastbot_1/odom.
 */

const telemetry = (() => {

  const ODOM_TOPIC = '/fastbot_1/odom';
  const CMDVEL_TOPIC  = '/fastbot_1/cmd_vel';  // actual velocity after smoother

  let odomSub   = null;
  let cmdvelSub = null;

  function init(ros) {

    // ── Pose from odom ──
    odomSub = new ROSLIB.Topic({
      ros,
      name: ODOM_TOPIC,
      messageType: 'nav_msgs/Odometry',
      throttle_rate: 100,
      queue_length: 1
    });

    odomSub.subscribe((msg) => {
      const posX = msg.pose.pose.position.x;
      const posY = msg.pose.pose.position.y;

      const q = msg.pose.pose.orientation;
      const yaw = Math.atan2(
        2.0 * (q.w * q.z + q.x * q.y),
        1.0 - 2.0 * (q.y * q.y + q.z * q.z)
      );

      document.getElementById('pos-x').textContent   = posX.toFixed(3);
      document.getElementById('pos-y').textContent   = posY.toFixed(3);
      document.getElementById('pos-yaw').textContent = (yaw * 180 / Math.PI).toFixed(1) + '°';

      // Fallback: also read twist from odom in case sim does publish it
      const linX = msg.twist.twist.linear.x;
      const angZ = msg.twist.twist.angular.z;
      if (Math.abs(linX) > 0.001 || Math.abs(angZ) > 0.001) {
        document.getElementById('speed-linear').textContent  = linX.toFixed(3) + ' m/s';
        document.getElementById('speed-angular').textContent = angZ.toFixed(3) + ' rad/s';
      }
    });

    // ── Speed from cmd_vel_smoothed ──
    cmdvelSub = new ROSLIB.Topic({
      ros,
      name: CMDVEL_TOPIC,
      messageType: 'geometry_msgs/Twist',
      throttle_rate: 100,
      queue_length: 1
    });

    cmdvelSub.subscribe((msg) => {
      const linX = msg.linear.x;
      const angZ = msg.angular.z;
      document.getElementById('speed-linear').textContent  = linX.toFixed(3) + ' m/s';
      document.getElementById('speed-angular').textContent = angZ.toFixed(3) + ' rad/s';
      // console.log('[DEBUG] CMD_VEL:', linX, angZ);
    });

    console.log('Telemetry subscribed to', ODOM_TOPIC, 'and', CMDVEL_TOPIC);
  }

  function stop() {
    if (odomSub)   { odomSub.unsubscribe();   odomSub   = null; }
    if (cmdvelSub) { cmdvelSub.unsubscribe();  cmdvelSub = null; }
    ['speed-linear','speed-angular','pos-x','pos-y','pos-yaw'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.textContent = '—';
    });
  }

  return { init, stop };
})();