// Runtime configuration for the annotation demo.
// Override this file at deploy time; no Angular rebuild is required.
window.ANNOTATOR_CONFIG = {
  apiBase: 'http://127.0.0.1:5050',
  bearerToken: 'localtest'
};

// Backward-compatible alias for older demo shells that read this name.
window.__ANNOTATOR_CONFIG__ = window.ANNOTATOR_CONFIG;
