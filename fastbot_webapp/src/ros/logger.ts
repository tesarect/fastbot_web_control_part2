/**
 * Floating terminal-style log overlay on the camera panel.
 * Shows the last N messages with fade animation.
 */

type LogType = 'info' | 'warn' | 'error';

interface LogEntry {
  msg: string;
  type: LogType;
  time: string;
}

const MAX_LOGS = 7;
const entries: LogEntry[] = [];

function render(): void {
  const list = document.getElementById('log-list');
  if (!list) return;
  list.innerHTML = '';
  entries.forEach((entry, i) => {
    const li = document.createElement('li');
    const isOld = i < entries.length - 1;
    li.className = [entry.type, isOld ? 'old' : ''].filter(Boolean).join(' ');
    li.textContent = `${entry.time}  ${entry.msg}`;
    list.appendChild(li);
  });
}

function push(msg: string, type: LogType): void {
  const time = new Date().toLocaleTimeString('en', { hour12: false });
  entries.push({ msg, type, time });
  if (entries.length > MAX_LOGS) entries.shift();
  render();
  console.log(`[LOG] ${msg}`);
}

export const logger = {
  log: (msg: string) => push(msg, 'info'),
  warn: (msg: string) => push(msg, 'warn'),
  error: (msg: string) => push(msg, 'error'),
};
