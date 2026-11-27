(() => {
  'use strict';
  async function getReport(filters) {
    const params = new URLSearchParams(filters);
    return window.MediaHubAuth.request(`/reports/?${params}`, {}, true);
  }

  window.MediaHubReportsApi = Object.freeze({ getReport });
})();
