'use strict';
// Logger minimo, sem dependencia. Niveis: error < warn < info < debug.
const config = require('./config');

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const threshold = LEVELS[config.logLevel] ?? LEVELS.info;

function ts() {
  return new Date().toISOString();
}
function line(level, args) {
  if (LEVELS[level] > threshold) return;
  const tag = level.toUpperCase().padEnd(5);
  const msg = args
    .map((a) => (typeof a === 'string' ? a : safe(a)))
    .join(' ');
  const out = `${ts()} ${tag} ${msg}`;
  if (level === 'error') process.stderr.write(out + '\n');
  else process.stdout.write(out + '\n');
}
function safe(o) {
  try {
    return JSON.stringify(o);
  } catch {
    return String(o);
  }
}

module.exports = {
  error: (...a) => line('error', a),
  warn: (...a) => line('warn', a),
  info: (...a) => line('info', a),
  debug: (...a) => line('debug', a),
};
