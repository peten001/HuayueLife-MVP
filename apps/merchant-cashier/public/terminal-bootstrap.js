(function () {
  'use strict';

  // Auth restore can legitimately make two sequential requests, each with a
  // 15-second transport timeout. Leave enough room for the initial chunks too.
  var BOOT_TIMEOUT_MS = 40000;
  var debugEnabled = /(?:^|[?&])terminalDebug=1(?:&|$)/.test(window.location.search.slice(1));
  var state = {
    vueMounted: false,
    routerReady: false,
    currentRoute: window.location.pathname || '/',
    authInitStarted: false,
    authInitFinished: false,
    sessionState: 'UNKNOWN',
    loadingOverlayVisible: true,
    appRootChildrenCount: 0,
    documentReadyState: document.readyState,
    innerWidth: window.innerWidth || 0,
    innerHeight: window.innerHeight || 0,
    devicePixelRatio: window.devicePixelRatio || 1,
    userAgent: String(window.navigator.userAgent || '').slice(0, 180),
    javascriptError: 'NONE',
    unhandledPromiseRejection: 'NONE',
    lastSuccessfulStep: 'HTML_READY'
  };
  var debugPanel = null;
  var bootTimer = 0;

  function safeText(value) {
    var text = value && value.message ? value.message : String(value || 'Unknown error');
    return text
      .replace(/([?&](?:access_?token|token|authorization|cookie)=)[^&\s]+/gi, '$1[redacted]')
      .replace(/(authorization\s*:\s*bearer\s+)[^\s,;]+/gi, '$1[redacted]')
      .replace(/(["'](?:access_?token|token|authorization|cookie)["']\s*:\s*["'])[^"']+/gi, '$1[redacted]')
      .replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, '[redacted]')
      .replace(/(https?:\/\/[^\s?#]+)[^\s]*/gi, '$1')
      .slice(0, 180);
  }

  function yesNo(value) {
    return value ? 'YES' : 'NO';
  }

  function renderDebug() {
    if (!debugEnabled) return;
    if (!debugPanel) {
      debugPanel = document.createElement('pre');
      debugPanel.id = 'terminal-debug-panel';
      debugPanel.className = 'terminal-debug-panel';
      debugPanel.setAttribute('role', 'status');
      debugPanel.setAttribute('aria-live', 'polite');
      document.body.appendChild(debugPanel);
    }
    debugPanel.textContent = [
      'Terminal Debug',
      'Vue Mounted: ' + yesNo(state.vueMounted),
      'Router Ready: ' + yesNo(state.routerReady),
      'Current Route: ' + state.currentRoute,
      'Auth Init Started: ' + yesNo(state.authInitStarted),
      'Auth Init Finished: ' + yesNo(state.authInitFinished),
      'Session State: ' + state.sessionState,
      'Loading Overlay Visible: ' + yesNo(state.loadingOverlayVisible),
      'App Root Children Count: ' + state.appRootChildrenCount,
      'document.readyState: ' + state.documentReadyState,
      'window.innerWidth: ' + state.innerWidth,
      'window.innerHeight: ' + state.innerHeight,
      'devicePixelRatio: ' + state.devicePixelRatio,
      'User Agent: ' + state.userAgent,
      'JavaScript Error: ' + state.javascriptError,
      'Unhandled Promise Rejection: ' + state.unhandledPromiseRejection,
      'Last Successful Step: ' + state.lastSuccessfulStep
    ].join('\n');
  }

  function update(patch) {
    var key;
    if (!patch || typeof patch !== 'object') return;
    for (key in patch) {
      if (Object.prototype.hasOwnProperty.call(state, key)) state[key] = patch[key];
    }
    state.documentReadyState = document.readyState;
    state.innerWidth = window.innerWidth || 0;
    state.innerHeight = window.innerHeight || 0;
    state.devicePixelRatio = window.devicePixelRatio || 1;
    var root = document.getElementById('app');
    state.appRootChildrenCount = root ? root.children.length : 0;
    renderDebug();
  }

  function createBootElement() {
    var root = document.getElementById('app');
    if (!root) return null;
    root.textContent = '';

    var boot = document.createElement('main');
    boot.id = 'cashier-boot';
    boot.className = 'cashier-boot';
    boot.setAttribute('data-state', 'loading');
    boot.setAttribute('role', 'status');
    boot.setAttribute('aria-live', 'polite');
    boot.setAttribute('aria-busy', 'true');

    var center = document.createElement('div');
    center.className = 'cashier-boot__center';
    var card = document.createElement('section');
    card.className = 'cashier-boot__card';
    var spinner = document.createElement('span');
    spinner.className = 'cashier-boot__spinner';
    spinner.setAttribute('aria-hidden', 'true');
    var title = document.createElement('strong');
    title.className = 'cashier-boot__title';
    title.textContent = '正在打开 Web 收银台';
    var message = document.createElement('span');
    message.id = 'cashier-boot-message';
    message.className = 'cashier-boot__message';
    message.textContent = '正在初始化页面和登录状态…';
    var retry = document.createElement('button');
    retry.id = 'cashier-boot-retry';
    retry.className = 'cashier-boot__retry';
    retry.type = 'button';
    retry.hidden = true;
    retry.textContent = '重试';

    card.appendChild(spinner);
    card.appendChild(title);
    card.appendChild(message);
    card.appendChild(retry);
    center.appendChild(card);
    boot.appendChild(center);
    root.appendChild(boot);
    bindRetry(retry);
    return boot;
  }

  function getBootElement() {
    return document.getElementById('cashier-boot');
  }

  function bindRetry(button) {
    if (!button || button.getAttribute('data-retry-bound') === 'true') return;
    button.setAttribute('data-retry-bound', 'true');
    button.addEventListener('click', function () {
      window.location.reload();
    });
  }

  function complete() {
    if (bootTimer) window.clearTimeout(bootTimer);
    bootTimer = 0;
    update({ loadingOverlayVisible: false, lastSuccessfulStep: 'BOOT_COMPLETED' });
  }

  function fail(reason) {
    if (bootTimer) window.clearTimeout(bootTimer);
    bootTimer = 0;
    if (state.vueMounted) {
      update({ lastSuccessfulStep: String(reason || 'RUNTIME_ERROR').slice(0, 80) });
      return;
    }
    var boot = getBootElement() || createBootElement();
    if (!boot) return;
    boot.setAttribute('data-state', 'error');
    boot.setAttribute('aria-busy', 'false');
    var message = document.getElementById('cashier-boot-message');
    var retry = document.getElementById('cashier-boot-retry');
    if (message) message.textContent = '页面兼容初始化失败，请重试。';
    if (retry) {
      retry.hidden = false;
      bindRetry(retry);
    }
    update({
      loadingOverlayVisible: true,
      lastSuccessfulStep: String(reason || 'BOOT_FAILED').slice(0, 80)
    });
  }

  window.__cashierTerminalDebug = {
    enabled: debugEnabled,
    state: state,
    update: update
  };
  window.__cashierBoot = {
    complete: complete,
    fail: fail
  };

  bindRetry(document.getElementById('cashier-boot-retry'));

  window.addEventListener('error', function (event) {
    var resource = event && event.target;
    var resourceUrl = resource && (resource.src || resource.href);
    var error = resourceUrl ? 'RESOURCE_LOAD_ERROR ' + resourceUrl : event.message || event.error;
    update({ javascriptError: safeText(error), lastSuccessfulStep: 'JAVASCRIPT_ERROR' });
    if (getBootElement()) fail('JAVASCRIPT_ERROR');
  }, true);

  window.addEventListener('unhandledrejection', function (event) {
    update({
      unhandledPromiseRejection: safeText(event.reason),
      lastSuccessfulStep: 'UNHANDLED_PROMISE_REJECTION'
    });
    if (getBootElement()) fail('UNHANDLED_PROMISE_REJECTION');
  });

  document.addEventListener('readystatechange', function () {
    update({ documentReadyState: document.readyState });
  });
  window.addEventListener('resize', function () {
    update({
      innerWidth: window.innerWidth || 0,
      innerHeight: window.innerHeight || 0,
      devicePixelRatio: window.devicePixelRatio || 1
    });
  });

  bootTimer = window.setTimeout(function () {
    fail('BOOT_TIMEOUT');
  }, BOOT_TIMEOUT_MS);
  update({ lastSuccessfulStep: 'BOOTSTRAP_READY' });
}());
