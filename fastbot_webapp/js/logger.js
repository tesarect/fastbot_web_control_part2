/**
 * Floating terminal-style log overlay on camera panel.
 * Shows last 5 messages with fade animation.
 */

const logger = (() => {

  const MAX_LOGS = 7;
  const logs = [];

  function log(msg, type = 'info') {
    const time = new Date().toLocaleTimeString('en', { hour12: false });
    logs.push({ msg, type, time });
    if (logs.length > MAX_LOGS) logs.shift();
    render();
    // Also log to console
    console.log(`[LOG] ${msg}`);
  }

  function warn(msg) { log(msg, 'warn'); }
  function error(msg) { log(msg, 'error'); }

  function render() {
    const list = document.getElementById('log-list');
    if (!list) return;
    list.innerHTML = '';
    logs.forEach((entry, i) => {
      const li = document.createElement('li');
      const isOld = i < logs.length - 1;
      li.className = [entry.type, isOld ? 'old' : ''].filter(Boolean).join(' ');
      li.textContent = `${entry.time}  ${entry.msg}`;
      list.appendChild(li);
    });
  }

  return { log, warn, error };
})();