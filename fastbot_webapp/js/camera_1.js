/**
 * Subscribes to the robot camera and displays it via web_video_server.
 * Topic: /fastbot_1/camera/image_raw
 */

const camera = (() => {

  const RAW_TOPIC = '/fastbot_1/camera/image_raw';
  let subscriber = null;
  let canvas = null;
  let ctx = null;

  function init(ros, rosbridgeUrl) {
    const imgEl       = document.getElementById('camera-feed');
    const placeholder = document.getElementById('cam-placeholder');
    const badge       = document.getElementById('cam-status');

    badge.textContent = 'CONNECTING';

    // Create hidden canvas to convert raw image data to displayable image
    canvas = document.createElement('canvas');
    ctx    = canvas.getContext('2d');

    subscriber = new ROSLIB.Topic({
      ros,
      name:          RAW_TOPIC,
      messageType:   'sensor_msgs/Image',
      throttle_rate: 200,   // 5fps max — raw images are large
      queue_length:  1
    });

    let receivedFrame = false;

    subscriber.subscribe((msg) => {
      try {
        // Set canvas size to image dimensions
        canvas.width  = msg.width;
        canvas.height = msg.height;

        // Decode base64 image data
        const binStr  = atob(msg.data);
        const len     = binStr.length;
        const bytes   = new Uint8Array(len);
        for (let i = 0; i < len; i++) bytes[i] = binStr.charCodeAt(i);

        // Create ImageData from raw bytes (assuming RGB8 encoding)
        const imgData = ctx.createImageData(msg.width, msg.height);
        const encoding = msg.encoding || 'rgb8';

        if (encoding === 'rgb8') {
          for (let i = 0, j = 0; i < bytes.length; i += 3, j += 4) {
            imgData.data[j]     = bytes[i];       // R
            imgData.data[j + 1] = bytes[i + 1];   // G
            imgData.data[j + 2] = bytes[i + 2];   // B
            imgData.data[j + 3] = 255;             // A
          }
        } else if (encoding === 'bgr8') {
          for (let i = 0, j = 0; i < bytes.length; i += 3, j += 4) {
            imgData.data[j]     = bytes[i + 2];   // R (swap B and R)
            imgData.data[j + 1] = bytes[i + 1];   // G
            imgData.data[j + 2] = bytes[i];       // B
            imgData.data[j + 3] = 255;
          }
        }

        ctx.putImageData(imgData, 0, 0);
        imgEl.src = canvas.toDataURL('image/jpeg', 0.8);

        if (!receivedFrame) {
          receivedFrame = true;
        imgEl.classList.add('visible');
        if (placeholder) placeholder.style.display = 'none';
        badge.textContent = 'LIVE';
        badge.classList.add('live');
          console.log('[Camera] Receiving raw frames, encoding:', encoding,
                      'size:', msg.width, 'x', msg.height);
        }
      } catch (e) {
        console.error('[Camera] Error processing frame:', e);
      }
    });

    // Timeout warning if no frames
    setTimeout(() => {
      if (!receivedFrame) {
        badge.textContent = 'NO SIGNAL';
        console.warn('[Camera] No frames received after 5s from', RAW_TOPIC);
      }
    }, 5000);

    console.log('[Camera] Subscribed to', RAW_TOPIC);
  }

  function stop() {
    if (subscriber) { subscriber.unsubscribe(); subscriber = null; }
    canvas = null; ctx = null;
    const imgEl = document.getElementById('camera-feed');
    if (imgEl) { imgEl.src = ''; imgEl.classList.remove('visible'); }
    const badge = document.getElementById('cam-status');
    if (badge) { badge.textContent = 'CONNECTING'; badge.classList.remove('live'); }
    const ph = document.getElementById('cam-placeholder');
    if (ph) ph.style.display = 'flex';
  }

  return { init, stop };
})();