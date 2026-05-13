/**
 * Sends Nav2 waypoint goals via /goal_pose. Cancels by publishing zero
 * velocity and a goal at the current pose. Detects goal-reached via odom
 * distance to the active waypoint.
 */
import ROSLIB from 'roslib';
import type { Odometry } from '@/ros/types';
import { logger } from '@/ros/logger';

interface Waypoint {
  x: number;
  y: number;
  yaw: number;
}

const WAYPOINTS: Record<string, Waypoint> = {
  living_room: { x: 1.089, y: -1.736, yaw: 0.0 },
  kitchen: { x: 1.147, y: 2.383, yaw: 0.0 },
  sofa: { x: -2.666, y: -1.197, yaw: 0.0 },
};

const GOAL_TOLERANCE_M = 0.2;
const STOP_VEL_INTERVAL_MS = 100;
const STOP_VEL_DURATION_MS = 2000;

let goalTopic: ROSLIB.Topic | null = null;
let cmdVelTopic: ROSLIB.Topic | null = null;
let odomSub: ROSLIB.Topic | null = null;
let stopInterval: number | null = null;

let currentX = 0;
let currentY = 0;
let currentQz = 0;
let currentQw = 1;

let activeGoal: Waypoint | null = null;
let goalReached = false;

function clearStopInterval(): void {
  if (stopInterval !== null) {
    clearInterval(stopInterval);
    stopInterval = null;
  }
}

function sendZeroVel(): void {
  cmdVelTopic?.publish(
    new ROSLIB.Message({
      linear: { x: 0, y: 0, z: 0 },
      angular: { x: 0, y: 0, z: 0 },
    }),
  );
}

function clearActiveButton(): void {
  document.querySelectorAll('.wp-btn').forEach((b) => b.classList.remove('active'));
}

export function init(ros: ROSLIB.Ros): void {
  goalTopic = new ROSLIB.Topic({
    ros,
    name: '/goal_pose',
    messageType: 'geometry_msgs/PoseStamped',
  });

  cmdVelTopic = new ROSLIB.Topic({
    ros,
    name: '/fastbot_1/cmd_vel',
    messageType: 'geometry_msgs/Twist',
  });

  odomSub = new ROSLIB.Topic({
    ros,
    name: '/fastbot_1/odom',
    messageType: 'nav_msgs/Odometry',
    throttle_rate: 500,
    queue_length: 1,
  });

  odomSub.subscribe((raw) => {
    const msg = raw as unknown as Odometry;
    currentX = msg.pose.pose.position.x;
    currentY = msg.pose.pose.position.y;
    currentQz = msg.pose.pose.orientation.z;
    currentQw = msg.pose.pose.orientation.w;

    if (activeGoal && !goalReached) {
      const dx = currentX - activeGoal.x;
      const dy = currentY - activeGoal.y;
      if (Math.sqrt(dx * dx + dy * dy) < GOAL_TOLERANCE_M) {
        goalReached = true;
        logger.log('✔ Goal reached');
        clearActiveButton();
      }
    }
  });

  console.log('[Navigation] Ready');
}

export function sendWaypoint(name: string): void {
  if (!goalTopic) return;
  const wp = WAYPOINTS[name];
  if (!wp) return;

  clearStopInterval();
  activeGoal = wp;
  goalReached = false;

  clearActiveButton();
  document.querySelector(`.wp-btn[data-waypoint="${name}"]`)?.classList.add('active');

  const qz = Math.sin(wp.yaw / 2);
  const qw = Math.cos(wp.yaw / 2);

  goalTopic.publish(
    new ROSLIB.Message({
      header: { frame_id: 'map', stamp: { sec: 0, nanosec: 0 } },
      pose: {
        position: { x: wp.x, y: wp.y, z: 0.0 },
        orientation: { x: 0.0, y: 0.0, z: qz, w: qw },
      },
    }),
  );

  logger.log(`→ Navigating to ${name.replace('_', ' ')}`);
}

export function cancelGoal(): void {
  clearStopInterval();
  activeGoal = null;
  goalReached = false;

  sendZeroVel();

  goalTopic?.publish(
    new ROSLIB.Message({
      header: { frame_id: 'odom', stamp: { sec: 0, nanosec: 0 } },
      pose: {
        position: { x: currentX, y: currentY, z: 0.0 },
        orientation: { x: 0.0, y: 0.0, z: currentQz, w: currentQw },
      },
    }),
  );

  stopInterval = window.setInterval(sendZeroVel, STOP_VEL_INTERVAL_MS);
  setTimeout(clearStopInterval, STOP_VEL_DURATION_MS);

  clearActiveButton();
  logger.warn('Navigation stopped');
}

export function stop(): void {
  clearStopInterval();
  goalTopic?.unadvertise();
  cmdVelTopic?.unadvertise();
  odomSub?.unsubscribe();
  goalTopic = null;
  cmdVelTopic = null;
  odomSub = null;

  activeGoal = null;
  goalReached = false;
  clearActiveButton();
}
