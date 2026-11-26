(() => {
  'use strict';

  const auth = window.MediaHubAuth;
  window.MediaHubDashboardApi = Object.freeze({
    summary: () => auth.request('/dashboard/summary', {}, true),
  });
})();
