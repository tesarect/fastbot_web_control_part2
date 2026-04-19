/**
 * Orchestrates all modules on connect / disconnect.
 * Called by connection.js via onRosConnected / onRosDisconnected.
 */

function onRosConnected(ros, rosbridgeUrl) {
  console.log('ROS connected — initialising modules');
  camera.init(ros, rosbridgeUrl);
  telemetry.init(ros);
  joystick.init(ros);
  navigation.init(ros);
  model3d.init(ros);
  console.log('ROS connected — initialisation modules COMPLETED');
}

function onRosDisconnected() {
  console.log('ROS disconnected — stopping modules');
  camera.stop();
  telemetry.stop();
  joystick.stop();
  navigation.stop();
  model3d.stop();
}