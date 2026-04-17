/**
 * Subscribes to the robot camera and displays it via web_video_server.
 * Topic: /fastbot_1/camera/image_raw
 */

const camera = (() => {

  const CAMERA_TOPIC = '/fastbot_1/camera/image_raw';
  let subscriber = null;

  function init(ros, rosbridgeUrl) {
    // Derive web_video_server URL from rosbridge URL
    // rosbridge:  wss://host/path/rosbridge/
    // video:      https://host/path/webpage/ (port 11315 on local)
    const videoUrl = buildVideoUrl(rosbridgeUrl);
    const imgEl    = document.getElementById('camera-feed');
    const placeholder = document.getElementById('cam-placeholder');
    const badge    = document.getElementById('cam-status');

    if (videoUrl) {
      const src = `${videoUrl}stream?topic=${CAMERA_TOPIC}&type=ros_compressed&width=640&height=480`;
      imgEl.src = src;
      imgEl.onload = () => {
        imgEl.classList.add('visible');
        placeholder.style.display = 'none';
        badge.textContent = 'LIVE';
        badge.classList.add('live');
      };
      imgEl.onerror = () => {
        badge.textContent = 'NO SIGNAL';
        placeholder.querySelector('p').textContent = 'Camera unavailable';
      };
    } else {
      // Fallback: subscribe via roslib and use compressed topic
      badge.textContent = 'ROSLIB';
      subscriber = new ROSLIB.Topic({
        ros,
        name: CAMERA_TOPIC,
        messageType: 'sensor_msgs/CompressedImage'
      });
      subscriber.subscribe((msg) => {
        imgEl.src = 'data:image/jpeg;base64,' + msg.data;
        imgEl.classList.add('visible');
        placeholder.style.display = 'none';
        badge.textContent = 'LIVE';
        badge.classList.add('live');
      });
    }
  }

  function buildVideoUrl(rosbridgeUrl) {
    try {
      // Replace wss/ws with https/http, replace /rosbridge/ with /webpage/
      let url = rosbridgeUrl
        .replace(/^wss:\/\//, 'https://')
        .replace(/^ws:\/\//, 'http://')
        .replace(/\/rosbridge\/?$/, '/webpage/');
      return url;
    } catch (e) {
      return null;
    }
  }

  function stop() {
    if (subscriber) {
      subscriber.unsubscribe();
      subscriber = null;
    }
    const imgEl = document.getElementById('camera-feed');
    imgEl.src = '';
    imgEl.classList.remove('visible');
    document.getElementById('cam-status').textContent = 'CONNECTING';
    document.getElementById('cam-status').classList.remove('live');
    document.getElementById('cam-placeholder').style.display = 'flex';
  }

  return { init, stop };
})();