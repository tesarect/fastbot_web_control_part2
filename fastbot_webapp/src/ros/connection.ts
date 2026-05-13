/**
 * ROS bridge connection lifecycle.
 * Owns the single Ros instance and notifies subscribers on connect/disconnect.
 */
import ROSLIB from 'roslib';

export type ConnectionListener = (ros: ROSLIB.Ros, url: string) => void;
export type DisconnectListener = () => void;

const onConnectListeners = new Set<ConnectionListener>();
const onDisconnectListeners = new Set<DisconnectListener>();

let ros: ROSLIB.Ros | null = null;
let dashboardActive = false;

/** Translate whatever the user pasted (URL, host:port, full https URL with session) into a wss:// rosbridge URL. */
export function toRosbridgeUrl(raw: string): string {
  const input = raw.trim();

  if (input.startsWith('wss://') || input.startsWith('ws://')) return input;
  if (!input.startsWith('http')) return `ws://${input}`;

  try {
    const url = new URL(input);
    const parts = url.pathname.split('/').filter(Boolean);
    const session = parts[0] ?? '';
    const scheme = url.protocol === 'https:' ? 'wss' : 'ws';
    const base = `${scheme}://${url.host}`;
    return session ? `${base}/${session}/rosbridge/` : `${base}/rosbridge/`;
  } catch {
    return input;
  }
}

export function onConnected(fn: ConnectionListener): void {
  onConnectListeners.add(fn);
}

export function onDisconnected(fn: DisconnectListener): void {
  onDisconnectListeners.add(fn);
}

function setStatus(msg: string, type: '' | 'success' | 'error' | 'loading' = ''): void {
  const el = document.getElementById('connection-status');
  if (!el) return;
  el.textContent = msg;
  el.className = `status-msg ${type}`.trim();
}

function showDashboard(url: string): void {
  const screen = document.getElementById('connection-screen');
  const dashboard = document.getElementById('dashboard');
  const connectedUrl = document.getElementById('connected-url');
  if (!screen || !dashboard) return;

  setTimeout(() => {
    screen.classList.add('fade-out');
    setTimeout(() => {
      screen.style.display = 'none';
      if (connectedUrl) connectedUrl.textContent = url;
      dashboard.classList.remove('hidden');
      dashboardActive = true;
      if (ros) onConnectListeners.forEach((fn) => fn(ros!, url));
    }, 400);
  }, 600);
}

function hideDashboard(): void {
  const screen = document.getElementById('connection-screen');
  const dashboard = document.getElementById('dashboard');
  if (!screen || !dashboard) return;
  screen.style.display = 'flex';
  screen.style.opacity = '1';
  screen.classList.remove('fade-out');
  dashboard.classList.add('hidden');
  const connectBtn = document.getElementById('connect-btn') as HTMLButtonElement | null;
  if (connectBtn) connectBtn.disabled = false;
  setStatus('Disconnected.', 'error');
}

function handleDisconnect(): void {
  if (!dashboardActive) return;
  dashboardActive = false;
  onDisconnectListeners.forEach((fn) => fn());
  hideDashboard();
}

export function connect(): void {
  const input = document.getElementById('rosbridge-url') as HTMLInputElement | null;
  const button = document.getElementById('connect-btn') as HTMLButtonElement | null;
  const raw = input?.value.trim() ?? '';
  if (!raw) {
    setStatus('Please enter a rosbridge address.', 'error');
    return;
  }

  const url = toRosbridgeUrl(raw);
  if (url !== raw) {
    console.log('[Connection] Converted URL:', raw, '→', url);
    setStatus(`Connecting to ${url}`, 'loading');
  } else {
    setStatus('Connecting...', 'loading');
  }
  if (button) button.disabled = true;

  ros = new ROSLIB.Ros({ url });
  (window as unknown as { ros: ROSLIB.Ros | null }).ros = ros;

  ros.on('connection', () => {
    setStatus('Connected!', 'success');
    showDashboard(url);
  });

  ros.on('error', (err: unknown) => {
    setStatus('Connection failed. Check the address.', 'error');
    if (button) button.disabled = false;
    console.error('[Connection] error:', err);
  });

  ros.on('close', () => handleDisconnect());
}

export function disconnect(): void {
  if (ros) ros.close();
  handleDisconnect();
}
