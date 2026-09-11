export const state = {};

export function reset(scenario = {}) {
  for (const key of Object.keys(state)) delete state[key];
  Object.assign(state, {
    scenario,
    events: [],
    launches: [],
    connections: [],
    cdpConnections: [],
    externalBrowser: { closed: false, contexts: [{ closed: false, pages: [{ closed: false }] }] },
    newContexts: [],
    pages: [],
    browserCloses: 0,
    contextCloses: 0
  });
}

reset();

function makePage(contextRecord, connection) {
  const record = { closed: false, closeCalls: 0, html: '', url: 'about:blank', clicks: 0 };
  state.pages.push(record);
  contextRecord.pages.push(record);
  let pendingStep;
  const listeners = new Map();
  const mainFrame = {};
  const childFrame = {};

  function emitResponse({ status = 200, url = record.url, navigation = true, main = true } = {}) {
    const response = {
      status: () => status,
      ok: () => status >= 200 && status < 300,
      statusText: () => ({ 200: 'OK', 401: 'Unauthorized', 403: 'Forbidden', 404: 'Not Found', 429: 'Too Many Requests', 500: 'Internal Server Error' })[status] || '',
      url: () => url,
      request: () => ({ isNavigationRequest: () => navigation }),
      frame: () => main ? mainFrame : childFrame
    };
    state.events.push({ event: 'response', status, url, navigation, main });
    for (const listener of listeners.get('response') || []) listener(response);
    return response;
  }

  async function click(kind, value, options) {
    state.events.push({ event: 'click', kind, value, options });
    await Promise.resolve();
    if (state.scenario.clickError) throw new Error(state.scenario.clickError);
    pendingStep = state.scenario.steps?.[record.clicks];
    record.clicks += 1;
  }

  const page = {
    on(event, listener) {
      if (!listeners.has(event)) listeners.set(event, []);
      listeners.get(event).push(listener);
      return page;
    },
    mainFrame() { return mainFrame; },
    async goto(url, options) {
      state.events.push({ event: 'goto', url, options });
      await Promise.resolve();
      if (state.scenario.gotoError) throw new Error(state.scenario.gotoError);
      record.html = state.scenario.html || '';
      record.url = state.scenario.finalUrl || url;
      const response = emitResponse({ status: state.scenario.status });
      state.events.push({ event: 'navigated' });
      return response;
    },
    getByText(value, options) {
      return { click: () => click('text', value, options) };
    },
    locator(value) {
      return { click: () => click('selector', value) };
    },
    async waitForLoadState(waitUntil) {
      state.events.push({ event: 'waitForLoadState', waitUntil });
      await Promise.resolve();
      if (state.scenario.waitError) throw new Error(state.scenario.waitError);
      if (pendingStep?.url) record.url = pendingStep.url;
      if (pendingStep?.status !== undefined || pendingStep?.url) emitResponse({ status: pendingStep.status });
      for (const response of pendingStep?.responses || []) emitResponse(response);
      if (pendingStep?.html !== undefined) record.html = pendingStep.html;
      pendingStep = undefined;
    },
    async content() {
      state.events.push({ event: 'content' });
      return record.html;
    },
    url() { return record.url; },
    async close() {
      if (connection && !connection.connected) throw new Error('CDP connection is already disconnected');
      record.closed = true;
      record.closeCalls += 1;
      state.events.push({ event: 'page.close' });
    }
  };
  return page;
}

function makeContext(attached, connection) {
  const contextRecord = attached ? state.externalBrowser.contexts[0] : { closed: false, pages: [] };
  return {
    async newPage() { return makePage(contextRecord, connection); },
    async close() {
      state.contextCloses += 1;
      contextRecord.closed = true;
      for (const page of contextRecord.pages) page.closed = true;
    }
  };
}

function makeBrowser(attached) {
  const connection = attached ? { connected: true, disconnects: 0 } : null;
  if (connection) state.cdpConnections.push(connection);
  const existingContext = makeContext(attached, connection);
  return {
    contexts() { return [existingContext]; },
    async newContext(options) {
      state.newContexts.push(options);
      return makeContext(false);
    },
    async close() {
      if (attached) {
        connection.connected = false;
        connection.disconnects += 1;
        state.events.push({ event: 'browser.disconnect' });
        return;
      }
      state.browserCloses += 1;
      for (const page of state.pages) page.closed = true;
    }
  };
}

export const chromium = {
  async launch(options) {
    state.launches.push(options);
    return makeBrowser(false);
  },
  async connectOverCDP(endpoint) {
    state.connections.push(endpoint);
    return makeBrowser(true);
  }
};
