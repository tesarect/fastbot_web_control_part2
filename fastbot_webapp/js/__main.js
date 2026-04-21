/**
 * main.js
 * Orchestrates all modules on connect / disconnect.
 */

function onRosConnected(ros, rosbridgeUrl) {
  logger.log('ROS connected ✓');
  camera.init(ros, rosbridgeUrl);
  telemetry.init(ros);
  joystick.init(ros);
  navigation.init(ros);
  model3d.init(ros);
  logger.log('All modules initialised');
}

function onRosDisconnected() {
  logger.warn('ROS disconnected');
  camera.stop();
  telemetry.stop();
  joystick.stop();
  navigation.stop();
  model3d.stop();
}