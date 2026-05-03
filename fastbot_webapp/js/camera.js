/**
 * camera.js
 * Displays robot camera via MJPEG stream using MJPEGCANVAS.Viewer.

 */

const camera = (() => {

  const TOPIC = '/fastbot_1/camera/image_raw';

  function init(ros, rosbridgeUrl) {
    const container   = document.querySelector('#panel-camera .panel-body');
    const placeholder = document.getElementById('cam-placeholder');
    const badge       = document.getElementById('cam-status');

    badge.textContent = 'CONNECTING';

    // Derive host from the current page URL (not rosbridge URL)
    // https://host/UUID/webpage/  →  host/UUID
    const withoutScheme = location.href.replace(/^https?:\/\//, '');
    const parts = withoutScheme.split('/').filter(Boolean);
    // parts[0] = hostname, parts[1] = UUID, parts[2] = "webpage"
    const host = parts[0] + '/' + parts[1];

    console.log('[Camera] MJPEG host:', host);
    console.log('[Camera] Stream URL: https://' + host + '/stream?topic=' + TOPIC);

    // Create div for MJPEGCANVAS
    const divID    = 'mjpeg-camera';
    const mjpegDiv = document.createElement('div');
    mjpegDiv.id    = divID;
    mjpegDiv.style.cssText = 'width:100%;height:100%;';
    container.insertBefore(mjpegDiv, container.firstChild);

    new MJPEGCANVAS.Viewer({
      divID:  divID,
      host:   host,
      width:  container.clientWidth  || 640,
      height: container.clientHeight || 480,
      topic:  TOPIC,
      port:   0,
      ssl:    true,
    });

    if (placeholder) placeholder.style.display = 'none';
    badge.textContent = 'LIVE';
    badge.classList.add('live');

    console.log('[Camera] MJPEG viewer started');
  }

  function stop() {
    const mjpegDiv = document.getElementById('mjpeg-camera');
    if (mjpegDiv) mjpegDiv.innerHTML = '';

    const badge = document.getElementById('cam-status');
    if (badge) { badge.textContent = 'CONNECTING'; badge.classList.remove('live'); }

    const ph = document.getElementById('cam-placeholder');
    if (ph) ph.style.display = 'flex';
  }

  return { init, stop };
})();