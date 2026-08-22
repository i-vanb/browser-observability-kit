export class CDP {
  constructor(url, onHandlerError = null) {
    this.url = url;
    this.onHandlerError = onHandlerError;
    this.nextId = 1;
    this.pending = new Map();
    this.handlers = new Map();
    this.socket = null;
  }

  async connect() {
    this.socket = new WebSocket(this.url);
    await new Promise((resolve, reject) => {
      this.socket.addEventListener('open', resolve, { once: true });
      this.socket.addEventListener('error', reject, { once: true });
    });
    this.socket.addEventListener('message', (event) => this.#onMessage(event));
    this.socket.addEventListener('close', () => {
      for (const waiter of this.pending.values()) waiter.reject(new Error('CDP connection closed'));
      this.pending.clear();
    });
  }

  #onMessage(event) {
    const message = JSON.parse(String(event.data));
    if (message.id) {
      const waiter = this.pending.get(message.id);
      if (!waiter) return;
      this.pending.delete(message.id);
      if (message.error) waiter.reject(new Error(`${message.error.message}${message.error.data ? `: ${message.error.data}` : ''}`));
      else waiter.resolve(message.result);
      return;
    }
    for (const handler of this.handlers.get(message.method) ?? []) {
      try {
        const result = handler(message.params ?? {});
        if (result?.catch) result.catch((error) => this.onHandlerError?.(message.method, error));
      } catch (error) {
        this.onHandlerError?.(message.method, error);
      }
    }
  }

  on(method, handler) {
    const handlers = this.handlers.get(method) ?? [];
    handlers.push(handler);
    this.handlers.set(method, handlers);
    return () => this.handlers.set(method, handlers.filter((candidate) => candidate !== handler));
  }

  send(method, params = {}) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error(`CDP is not open for ${method}`));
    }
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    try { this.socket?.close(); } catch {}
  }
}

export async function evaluate(cdp, expression, { awaitPromise = true, userGesture = false } = {}) {
  const result = await cdp.send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true, userGesture });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  }
  return result.result.value;
}

export async function serializeRemoteObject(cdp, remote) {
  if (Object.prototype.hasOwnProperty.call(remote, 'value')) return remote.value;
  if (!remote.objectId) return remote.description ?? remote.type;
  try {
    const result = await cdp.send('Runtime.callFunctionOn', {
      objectId: remote.objectId,
      returnByValue: true,
      functionDeclaration: `function() {
        const seen = new WeakSet();
        const walk = (value, depth) => {
          if (value === null || typeof value !== 'object') {
            if (typeof value === 'function') return '[Function ' + (value.name || 'anonymous') + ']';
            return value;
          }
          if (seen.has(value)) return '[Circular]';
          if (depth > 4) return Object.prototype.toString.call(value);
          seen.add(value);
          if (Array.isArray(value)) return value.slice(0, 50).map((item) => walk(item, depth + 1));
          const output = {};
          for (const key of Object.keys(value).slice(0, 80)) {
            try { output[key] = walk(value[key], depth + 1); }
            catch (error) { output[key] = '[Unserializable: ' + error.message + ']'; }
          }
          return output;
        };
        return walk(this, 0);
      }`
    });
    return result.result.value ?? result.result.description;
  } catch {
    return remote.description ?? remote.type;
  }
}
