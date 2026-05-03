/**
 * camera.js
 * Displays robot camera via MJPEG stream.
 *
 * Browsers (Chrome, Firefox, Safari) support MJPEG streams natively via
 * a plain <img> src — no MJPEGCANVAS library needed at all.
 * This completely sidesteps the port:8080 issue in MJPEGCANVAS.
 *
 * web_video_server (port 11315) is proxied by nginx so the stream is at:
 *   https://host/UUID/stream?topic=/fastbot_1/camera/image_raw
 */

const camera = (() => {

  const TOPIC = '/fastbot_1/camera/image_raw';
  let imgEl = null;

  function init(ros, rosbridgeUrl) {
    const container   = document.querySelector('#panel-camera .panel-body');
    const placeholder = document.getElementById('cam-placeholder');
    const badge       = document.getElementById('cam-status');

    badge.textContent = 'CONNECTING';

    // Build stream URL from page location
    // https://host/UUID/webpage/ → https://host/UUID/stream?topic=...
    const withoutScheme = location.href.replace(/^https?:\/\//, '');
    const parts   = withoutScheme.split('/').filter(Boolean);
    const baseUrl = 'https://' + parts[0] + '/' + parts[1];
    const streamUrl = baseUrl + '/stream?topic=' + TOPIC;

    console.log('[Camera] Stream URL:', streamUrl);

    // Create img element — browsers handle MJPEG streams natively
    imgEl = document.createElement('img');
    imgEl.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;';
    imgEl.alt = 'Camera feed';

    imgEl.onload = () => {
      if (placeholder) placeholder.style.display = 'none';
      badge.textContent = 'LIVE';
      badge.classList.add('live');
      console.log('[Camera] Stream connected');
    };

    imgEl.onerror = () => {
      badge.textContent = 'NO SIGNAL';
      badge.classList.remove('live');
      console.warn('[Camera] Stream error or not found:', streamUrl);
    };

    container.insertBefore(imgEl, container.firstChild);
    imgEl.src = streamUrl;
  }

  function stop() {
    if (imgEl) {
      imgEl.src = '';   // stop the stream
      imgEl.remove();
      imgEl = null;
    }

    const badge = document.getElementById('cam-status');
    if (badge) { badge.textContent = 'CONNECTING'; badge.classList.remove('live'); }

    const ph = document.getElementById('cam-placeholder');
    if (ph) ph.style.display = 'flex';
  }

  return { init, stop };
})();