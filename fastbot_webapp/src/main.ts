/**
 * Application entry. Wires DOM events to the connection lifecycle and
 * orchestrates module init/teardown when the ROS bridge connects.
 */
import * as THREE from 'three';
import ROSLIB from 'roslib';

import './styles/style.css';

import { connect, disconnect, onConnected, onDisconnected } from './ros/connection';
import { logger } from './ros/logger';
import { loadScriptsInOrder } from './utils/load-script';

import * as camera from './modules/camera';
import * as telemetry from './modules/telemetry';
import * as joystick from './modules/joystick';
import * as navigation from './modules/navigation';
import * as map2d from './modules/map2d';
import * as model3d from './modules/model3d';

// Vendored ros3djs and mesh loaders are UMD scripts that expect THREE and
// ROSLIB on `window`. Set them up before loading the vendor bundle.
window.THREE = THREE;
window.ROSLIB = ROSLIB;

const VENDOR_SCRIPTS = [
  '/vendor/ColladaLoader.js',
  '/vendor/ColladaLoader2.js',
  '/vendor/STLLoader.js',
  '/vendor/ros3d.min.js',
];

const vendorReady = loadScriptsInOrder(VENDOR_SCRIPTS).catch((err) => {
  console.error('[main] Failed to load vendored 3D libraries:', err);
});

onConnected(async (ros, _url) => {
  logger.log('ROS connected');
  console.log('[main] ROS connected — initialising modules');

  camera.init();
  telemetry.init(ros);
  joystick.init(ros);
  navigation.init(ros);
  map2d.init(ros);

  // 3D viewer needs the vendored ros3djs to be loaded first
  await vendorReady;
  model3d.init(ros);

  console.log('[main] All modules initialised');
});

onDisconnected(() => {
  logger.warn('ROS disconnected');
  camera.stop();
  telemetry.stop();
  joystick.stop();
  navigation.stop();
  map2d.stop();
  model3d.stop();
});

// ── DOM wiring ───────────────────────────────────────────────────────────────
const form = document.getElementById('connect-form') as HTMLFormElement | null;
form?.addEventListener('submit', (e) => {
  e.preventDefault();
  connect();
});

document.getElementById('disconnect-btn')?.addEventListener('click', () => disconnect());

document.getElementById('waypoint-btns')?.addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLElement>('.wp-btn');
  const wp = btn?.dataset.waypoint;
  if (wp) navigation.sendWaypoint(wp);
});

document.getElementById('cancel-goal-btn')?.addEventListener('click', () => navigation.cancelGoal());
