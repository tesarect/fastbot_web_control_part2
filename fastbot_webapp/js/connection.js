/**
 * Handles ROS bridge connection / disconnection.
 * Exposes a global `ros` object used by all other modules.
 */

const rosConnection = (() => {

  let ros = null;

  // ---------------------------------------------------------------------------
  // Derive a rosbridge WSS URL from whatever the user pasted
  // ---------------------------------------------------------------------------
  function toRosbridgeUrl(raw) {
    const input = raw.trim();

    // Already a websocket address — use as-is
    if (input.startsWith('wss://') || input.startsWith('ws://')) {
      return input;
    }

    // Plain IP / hostname with port (e.g. 192.168.1.10:9090 or localhost:9090)
    // These are direct rosbridge connections, just prepend ws://
    if (!input.startsWith('http')) {
      return 'ws://' + input;
    }

    // HTTPS/HTTP URL — extract origin + first path segment (the UUID/session id)
    // e.g. https://host/UUID/anything  →  wss://host/UUID/rosbridge/
    try {
      const url   = new URL(input);
      const parts = url.pathname.split('/').filter(Boolean); // remove empty segments
      // parts[0] is the UUID/session segment
      const session = parts.length > 0 ? parts[0] : '';
      const scheme  = url.protocol === 'https:' ? 'wss' : 'ws';
      const base    = `${scheme}://${url.host}`;
      return session
        ? `${base}/${session}/rosbridge/`
        : `${base}/rosbridge/`;
    } catch (e) {
      // URL parsing failed — return input unchanged and let ROSLIB report the error
      return input;
    }
  }

  // ---------------------------------------------------------------------------
  // connect
  // ---------------------------------------------------------------------------
  function connect() {
    const raw = document.getElementById('rosbridge-url').value.trim();
    if (!raw) {
      setStatus('Please enter a rosbridge address.', 'error');
      return;
    }

    const url = toRosbridgeUrl(raw);

    // If we converted the URL, show the user what we're actually connecting to
    if (url !== raw) {
      console.log('[Connection] Converted URL:', raw, '→', url);
      setStatus(`Connecting to ${url}`, 'loading');
    } else {
    setStatus('Connecting...', 'loading');
    }

    document.getElementById('connect-btn').disabled = true;

    ros = new ROSLIB.Ros({ url });

    ros.on('connection', () => {
      setStatus('Connected!', 'success');
      window.ros = ros;

      // Fade out connection screen and show dashboard
      setTimeout(() => {
        const screen = document.getElementById('connection-screen');
        screen.classList.add('fade-out');
        setTimeout(() => {
          screen.style.display = 'none';
          document.getElementById('connected-url').textContent = url;
          document.getElementById('dashboard').classList.remove('hidden');
          // Initialise all modules
          if (typeof onRosConnected === 'function') onRosConnected(ros, url);
        }, 400);
      }, 600);
    });

    ros.on('error', (err) => {
      setStatus('Connection failed. Check the address.', 'error');
      document.getElementById('connect-btn').disabled = false;
      console.error('ROS connection error:', err);
    });

    ros.on('close', () => {
      if (document.getElementById('dashboard').classList.contains('hidden')) return;
      handleDisconnect();
    });
  }

  function disconnect() {
    if (ros) {
      ros.close();
    }
    handleDisconnect();
  }

  function handleDisconnect() {
    window.ros = null;
    // Stop all modules
    if (typeof onRosDisconnected === 'function') onRosDisconnected();

    // Show connection screen again
    const screen = document.getElementById('connection-screen');
    screen.style.display = 'flex';
    screen.style.opacity = '1';
    screen.classList.remove('fade-out');
    document.getElementById('dashboard').classList.add('hidden');
    document.getElementById('connect-btn').disabled = false;
    setStatus('Disconnected.', 'error');
  }

  function setStatus(msg, type) {
    const el = document.getElementById('connection-status');
    el.textContent = msg;
    el.className = 'status-msg ' + (type || '');
  }

  return { connect, disconnect };
})();