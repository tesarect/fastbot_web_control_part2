/**
 * Ambient declarations for vendored UMD scripts loaded via <script> tags
 * (see public/vendor/). These libraries don't ship clean ES module builds,
 * so we attach them to `window` and reference them as globals from TS.
 */
import type * as THREE_NS from 'three';
import type ROSLIB_NS from 'roslib';

declare global {
  interface Window {
    THREE: typeof THREE_NS;
    ROSLIB: typeof ROSLIB_NS;
    ROS3D: typeof ROS3D;
  }

  const ROS3D: ROS3DStatic;

  interface ROS3DStatic {
    Viewer: new (opts: ROS3DViewerOptions) => ROS3DViewer;
    Grid: new (opts?: { color?: string; cellSize?: number; num_cells?: number }) => unknown;
    UrdfClient: new (opts: ROS3DUrdfClientOptions) => unknown;
    OccupancyGridClient: new (opts: ROS3DOccupancyGridClientOptions) => unknown;
    OccupancyGrid: new (opts: { message: unknown; color?: unknown; opacity?: number }) => unknown;
    LaserScan: new (opts: ROS3DLaserScanOptions) => unknown;
    SceneNode: new (opts: ROS3DSceneNodeOptions) => unknown;
  }

  interface ROS3DViewerOptions {
    background?: string;
    divID: string;
    width: number;
    height: number;
    antialias?: boolean;
    fixedFrame?: string;
  }

  interface ROS3DViewer {
    scene: THREE_NS.Scene;
    addObject(obj: unknown): void;
    draw(): void;
    stop(): void;
    resize(width: number, height: number): void;
  }

  interface ROS3DUrdfClientOptions {
    ros: ROSLIB_NS.Ros;
    param: string;
    tfClient: ROSLIB_NS.TFClient;
    path: string;
    rootObject: THREE_NS.Object3D;
  }

  interface ROS3DOccupancyGridClientOptions {
    ros: ROSLIB_NS.Ros;
    tfClient: ROSLIB_NS.TFClient;
    rootObject: THREE_NS.Object3D;
    topic: string;
    continuous?: boolean;
    opacity?: number;
    offsetPose?: ROSLIB_NS.Pose;
  }

  interface ROS3DLaserScanOptions {
    ros: ROSLIB_NS.Ros;
    tfClient: ROSLIB_NS.TFClient;
    rootObject: THREE_NS.Object3D;
    topic: string;
    material?: { color?: number; size?: number };
    throttle_rate?: number;
    queue_length?: number;
  }

  interface ROS3DSceneNodeOptions {
    frameID: string;
    tfClient: ROSLIB_NS.TFClient;
    object: unknown;
    pose?: ROSLIB_NS.Pose;
  }
}

export {};
