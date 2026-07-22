// apc-mcp WebView UI — JS bridge for audio plugin controls
(function() {
  'use strict';

  const gainSlider = document.getElementById('gain');
  const gainValue = document.getElementById('gain-value');
  const meterFill = document.getElementById('meter-fill');
  const statusEl = document.getElementById('status');

  // ─── C++ → JS: receive state updates ────────────────────────────
  window.updateState = function(data) {
    // data is an array of state objects from C++
    if (!Array.isArray(data) || data.length === 0) return;

    const state = data[0];
    if (state.type !== 'state') return;

    // Update gain slider without triggering feedback loop
    if (state.gain !== undefined) {
      const pct = Math.round(state.gain * 100);
      if (Number(gainSlider.value) !== pct) {
        gainSlider.value = pct;
        gainValue.textContent = pct + '%';
      }
    }

    if (state.pluginName) {
      statusEl.textContent = state.pluginName + ' — connected';
      statusEl.style.color = '';
    }
  };

  // ─── JS → C++: send user actions ────────────────────────────────
  function sendAction(action, data) {
    // Navigate to custom URL scheme — intercepted by C++ pageAboutToLoad
    const params = new URLSearchParams({ action: action, data: String(data) });
    window.location.href = 'apc://callback?' + params.toString();
  }

  gainSlider.addEventListener('input', function() {
    const pct = Number(this.value);
    gainValue.textContent = pct + '%';

    // Send gain value as 0.0–1.0 float
    sendAction('setGain', pct / 100);
  });

  // ─── Simulated meter bounce (placeholder — real meter needs audio level data) ─
  let meterAnim = 0;
  setInterval(function() {
    meterAnim = Math.max(0, meterAnim - 0.02 + Math.random() * 0.04);
    meterFill.style.width = Math.min(100, meterAnim * 100) + '%';
  }, 50);

  // Mark UI as ready
  statusEl.textContent = 'initialized';
})();
