/**
 * Handles ROS bridge connection / disconnection.
 * Exposes a global `ros` object used by all other modules.
 */

const rosConnection = (() => {

  let ros = null;

  function connect() {
    const url = document.getElementById('rosbridge-url').value.trim();
    if (!url) {
      setStatus('Please enter a rosbridge address.', 'error');
      return;
    }

    setStatus('Connecting...', 'loading');
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