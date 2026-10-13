const errorCodes = new Set([
  'auth/unauthorized-domain', 'auth/popup-blocked', 'auth/popup-closed-by-user',
  'auth/cancelled-popup-request', 'auth/network-request-failed',
  'auth/operation-not-allowed', 'PERMISSION_DENIED', 'permission-denied'
]);
const errorNames = new Set(['NotAllowedError', 'InvalidStateError', 'AbortError', 'NetworkError']);

export function diagnosticError(error) {
  if (errorCodes.has(error?.code)) return error.code;
  if (errorNames.has(error?.name)) return error.name;
  return 'Operation failed';
}

export function createDiagnostics(document) {
  const state = {};
  const events = [];
  const output = document.getElementById('diagnosticsOutput');
  const fields = ['Site', 'Auth domain', 'Signed in', 'Secure context', 'Push supported',
    'Notification permission', 'Service worker', 'Push backend', 'Subscription'];
  function refresh() {
    output.textContent = fields.map(field => `${field}: ${state[field] ?? 'Checking'}`).join('\n')
      + '\n\nRecent events (this tab only):\n' + (events.join('\n') || 'None');
  }
  return {
    update(values) {
      for (const field of fields) if (Object.hasOwn(values, field)) state[field] = values[field];
      refresh();
    },
    record(event, error) {
      events.push(`${new Date().toLocaleTimeString([], { hour12: false })} ${event}${error ? `: ${diagnosticError(error)}` : ''}`);
      if (events.length > 20) events.shift();
      refresh();
    },
    clear() { events.length = 0; refresh(); },
    text() { return output.textContent; }
  };
}
