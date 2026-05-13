/**
 * Camera feed — uses the browser's native MJPEG-over-HTTP support via <img>.
 * web_video_server serves multipart/x-mixed-replace which browsers stream as
 * an animated image — no JS player library needed.
 */
const TOPIC = '/fastbot_1/camera/image_raw';

let img: HTMLImageElement | null = null;

function deriveStreamHost(): string {
  const withoutScheme = location.href.replace(/^https?:\/\//, '');
  const parts = withoutScheme.split('/').filter(Boolean);
  return `${parts[0]}/${parts[1] ?? ''}`.replace(/\/$/, '');
}

export function init(): void {
  const placeholder = document.getElementById('cam-placeholder');
  const badge = document.getElementById('cam-status');
  img = document.getElementById('camera-feed') as HTMLImageElement | null;
  if (!img) return;

  if (badge) badge.textContent = 'CONNECTING';

  const host = deriveStreamHost();
  const scheme = location.protocol === 'https:' ? 'https' : 'http';
  const streamUrl = `${scheme}://${host}/stream?topic=${TOPIC}`;
  console.log('[Camera] stream:', streamUrl);

  img.onload = () => {
    if (placeholder) placeholder.style.display = 'none';
    if (badge) {
      badge.textContent = 'LIVE';
      badge.classList.add('live');
    }
  };
  img.onerror = () => {
    if (badge) {
      badge.textContent = 'NO SIGNAL';
      badge.classList.remove('live');
    }
  };
  img.src = streamUrl;
  img.classList.add('visible');
}

export function stop(): void {
  if (img) {
    img.removeAttribute('src');
    img.classList.remove('visible');
  }
  const badge = document.getElementById('cam-status');
  if (badge) {
    badge.textContent = 'CONNECTING';
    badge.classList.remove('live');
  }
  const placeholder = document.getElementById('cam-placeholder');
  if (placeholder) placeholder.style.display = 'flex';
}
