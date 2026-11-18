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
      const pct = Math.max(0, Math.min(100, Math.round(state.gain * 100)));
      if (Number(gainSlider.value) !== pct) {
        gainSlider.value = pct;
        gainValue.textContent = pct + '%';
      }
    }

    // The meter shows the measured output level sent by C++ — never the slider
    // position. A meter driven by the knob would tell you nothing about audio.
    if (state.level !== undefined) {
      const levelPct = Math.max(0, Math.min(100, Math.round(state.level * 100)));
      meterFill.style.width = levelPct + '%';
    }

    if (state.pluginName) {
      statusEl.textContent = state.pluginName + ' — connected';
      statusEl.style.color = '';
    }
  };

  // ─── JS → C++: send user actions ────────────────────────────────
  function sendAction(action, data) {
    // Navigate to custom URL scheme — intercepted by C++ pageAboutToLoad.
    // encodeURIComponent encodes spaces as %20, matching JUCE's URL::removeEscapeChars.
    window.location.href = 'apc://callback?action=' + encodeURIComponent(action)
      + '&data=' + encodeURIComponent(String(data));
  }

  gainSlider.addEventListener('input', function() {
    const pct = Number(this.value);
    gainValue.textContent = pct + '%';

    // Send gain value as 0.0–1.0 float. The meter is NOT touched here: it is
    // driven only by the measured level C++ pushes in state updates.
    sendAction('setGain', pct / 100);
  });

  // Mark UI as ready and request initial state from C++
  statusEl.textContent = 'initialized';
  sendAction('ready', 1);
})();
