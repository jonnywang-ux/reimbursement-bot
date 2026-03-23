/** Timestamped structured logger. All output is newline-delimited JSON. */

function ts() {
  return new Date().toISOString();
}

export function log(msg, ctx = {}) {
  console.log(JSON.stringify({ ts: ts(), level: 'info', msg, ...ctx }));
}

export function warn(msg, ctx = {}) {
  console.warn(JSON.stringify({ ts: ts(), level: 'warn', msg, ...ctx }));
}

export function error(msg, err, ctx = {}) {
  console.error(JSON.stringify({
    ts: ts(),
    level: 'error',
    msg,
    error: err?.message ?? String(err),
    stack: err?.stack,
    ...ctx,
  }));
}
