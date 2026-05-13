/**
 * Minimal ROS message shapes for the topics the app uses.
 * Avoids depending on auto-generated types — we only consume a few fields.
 */

export interface Vector3 {
  x: number;
  y: number;
  z: number;
}

export interface Quaternion {
  x: number;
  y: number;
  z: number;
  w: number;
}

export interface Twist {
  linear: Vector3;
  angular: Vector3;
}

export interface Pose {
  position: Vector3;
  orientation: Quaternion;
}

export interface Header {
  frame_id: string;
  stamp: { sec: number; nanosec: number };
}

export interface Odometry {
  pose: { pose: Pose };
  twist: { twist: Twist };
}

export interface PoseWithCovarianceStamped {
  pose: { pose: Pose };
}

export interface OccupancyGrid {
  info: {
    width: number;
    height: number;
    resolution: number;
    origin: Pose;
  };
  data: Int8Array | number[];
}

export interface TFTransform {
  header: { frame_id: string };
  child_frame_id: string;
  transform: { translation: Vector3; rotation: Quaternion };
}

export interface TFMessage {
  transforms: TFTransform[];
}
