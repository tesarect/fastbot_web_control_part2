/**
 * Subscribes to /fastbot_1/odom (pose + fallback velocity) and
 * /fastbot_1/cmd_vel (commanded velocity), updating the telemetry panel.
 */
import ROSLIB from 'roslib';
import type { Odometry, Twist } from '@/ros/types';

const ODOM_TOPIC = '/fastbot_1/odom';
const CMDVEL_TOPIC = '/fastbot_1/cmd_vel';

let odomSub: ROSLIB.Topic | null = null;
let cmdvelSub: ROSLIB.Topic | null = null;

function setText(id: string, value: string): void {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

export function init(ros: ROSLIB.Ros): void {
  odomSub = new ROSLIB.Topic({
    ros,
    name: ODOM_TOPIC,
    messageType: 'nav_msgs/Odometry',
    throttle_rate: 100,
    queue_length: 1,
  });

  odomSub.subscribe((raw) => {
    const msg = raw as unknown as Odometry;
    const { x: posX, y: posY } = msg.pose.pose.position;
    const q = msg.pose.pose.orientation;
    const yaw = Math.atan2(
      2 * (q.w * q.z + q.x * q.y),
      1 - 2 * (q.y * q.y + q.z * q.z),
    );

    setText('pos-x', posX.toFixed(3));
    setText('pos-y', posY.toFixed(3));
    setText('pos-yaw', `${((yaw * 180) / Math.PI).toFixed(1)}°`);

    // Fallback: read twist from odom in case sim does publish it
    const linX = msg.twist.twist.linear.x;
    const angZ = msg.twist.twist.angular.z;
    if (Math.abs(linX) > 0.001 || Math.abs(angZ) > 0.001) {
      setText('speed-linear', `${linX.toFixed(3)} m/s`);
      setText('speed-angular', `${angZ.toFixed(3)} rad/s`);
    }
  });

  cmdvelSub = new ROSLIB.Topic({
    ros,
    name: CMDVEL_TOPIC,
    messageType: 'geometry_msgs/Twist',
    throttle_rate: 100,
    queue_length: 1,
  });

  cmdvelSub.subscribe((raw) => {
    const msg = raw as unknown as Twist;
    setText('speed-linear', `${msg.linear.x.toFixed(3)} m/s`);
    setText('speed-angular', `${msg.angular.z.toFixed(3)} rad/s`);
  });

  console.log('[Telemetry] subscribed to', ODOM_TOPIC, 'and', CMDVEL_TOPIC);
}

export function stop(): void {
  odomSub?.unsubscribe();
  cmdvelSub?.unsubscribe();
  odomSub = null;
  cmdvelSub = null;
  for (const id of ['speed-linear', 'speed-angular', 'pos-x', 'pos-y', 'pos-yaw']) {
    setText(id, '—');
  }
}
