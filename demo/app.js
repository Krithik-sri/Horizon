/**
 * Navigation and state management for the Horizon demo.
 */

(function() {
  'use strict';

  // Screen switching
  function showScreen(screenId) {
    const screens = document.querySelectorAll('.screen');
    screens.forEach(screen => screen.classList.remove('active'));

    const target = document.getElementById(screenId);
    if (target) {
      target.classList.add('active');
    }
  }

  // Departure state management — two independent state regions
  function setStartState(state) {
    const departure = document.getElementById('screen-departure');
    if (departure) {
      departure.setAttribute('data-start-state', state);
    }
  }

  function setJoinState(state) {
    const departure = document.getElementById('screen-departure');
    if (departure) {
      departure.setAttribute('data-join-state', state);
    }
  }

  // Initialize DOM from window.DATA
  function initFromData() {
    if (!window.DATA) return;

    // Departure screen
    const rideCodeInputs = document.querySelectorAll('.ride-code-input');
    rideCodeInputs.forEach(input => input.value = window.DATA.RIDE_CODE);

    const rideCodeDisplays = document.querySelectorAll('.ride-code-display');
    rideCodeDisplays.forEach(display => display.textContent = window.DATA.RIDE_CODE);

    const nameInput = document.querySelector('.rider-name-input');
    if (nameInput) nameInput.value = window.DATA.RIDER_NAME;

    const locationStatus = document.querySelector('.location-status');
    if (locationStatus) locationStatus.textContent = window.DATA.LOCATION_STATUS;

    const voiceToggle = document.querySelector('.voice-toggle');
    if (voiceToggle) voiceToggle.checked = window.DATA.VOICE_ENABLED;

    // Motion screen
    const speedDisplay = document.querySelector('.speed-display');
    if (speedDisplay) speedDisplay.textContent = window.DATA.MOTION.speed;

    const maneuverText = document.querySelector('.maneuver-text');
    if (maneuverText) maneuverText.textContent = window.DATA.MOTION.maneuver;

    const streetText = document.querySelector('.street-text');
    if (streetText) streetText.textContent = window.DATA.MOTION.street;

    const readoutText = document.querySelector('.readout-text');
    if (readoutText) readoutText.textContent = window.DATA.MOTION.readout;

    // Rider dots (Motion map) — fills from CONVOY_RIDERS (binary per ADR-009)
    const riderDots = document.querySelectorAll('.rider-dot');
    if (riderDots.length && window.DATA.CONVOY_RIDERS) {
      riderDots.forEach(function(dot, i) {
        if (window.DATA.CONVOY_RIDERS[i]) dot.style.fill = window.DATA.CONVOY_RIDERS[i].color;
      });
    }

    // Planner screen
    const originLine = document.querySelector('.origin-line');
    if (originLine && window.DATA.ROUTE_WAYPOINTS && window.DATA.ROUTE_WAYPOINTS[0]) {
      originLine.textContent = window.DATA.ROUTE_WAYPOINTS[0].label;
    }

    const stopLabel = document.querySelector('.stop-label');
    if (stopLabel && window.DATA.ROUTE_WAYPOINTS && window.DATA.ROUTE_WAYPOINTS[1]) {
      stopLabel.textContent = '1. ' + window.DATA.ROUTE_WAYPOINTS[1].label;
    }

    const routeOptionSpans = document.querySelectorAll('.route-option span');
    if (routeOptionSpans.length && window.DATA.ROUTE_SUMMARIES) {
      window.DATA.ROUTE_SUMMARIES.forEach(function(summary, i) {
        if (routeOptionSpans[i]) {
          routeOptionSpans[i].textContent = summary.text;
          routeOptionSpans[i].style.color = summary.selected ? 'var(--amber-core)' : 'var(--ink-primary)';
        }
      });
    }

    // Return List screen
    const ridesContainer = document.querySelector('.rides-list');
    if (ridesContainer && window.DATA.RIDES) {
      ridesContainer.innerHTML = window.DATA.RIDES.map(ride => `
        <div class="ride-row" data-ride-id="${ride.id}" data-navigate="screen-return-detail" style="border-bottom: 1px solid var(--surface-hairline); padding: var(--space-3) 0; min-height: 44px; cursor: pointer;">
          <p class="type-reflective-body" style="color: var(--ink-primary);">${ride.title}</p>
          <p class="type-departure-label" style="color: var(--ink-secondary); margin-top: var(--space-1);">${ride.dateShort} · ${ride.distance} · ${ride.movingTime}</p>
        </div>
      `).join('');
    }

    // Return Detail screen (default to first ride)
    if (window.DATA.RIDES && window.DATA.RIDES.length > 0) {
      const ride = window.DATA.RIDES[0];
      const detailTitle = document.querySelector('.ride-detail-title');
      if (detailTitle) detailTitle.textContent = ride.title;

      const factsContainer = document.querySelector('.ride-facts');
      if (factsContainer) {
        factsContainer.innerHTML = `
          <div style="margin-top: var(--space-3);">
            <p class="type-departure-label" style="color: var(--ink-secondary);">Date</p>
            <p class="type-reflective-body" style="color: var(--ink-primary);">${ride.date}</p>
          </div>
          <div style="margin-top: var(--space-3);">
            <p class="type-departure-label" style="color: var(--ink-secondary);">Distance</p>
            <p class="type-reflective-body" style="color: var(--ink-primary);">${ride.distance}</p>
          </div>
          <div style="margin-top: var(--space-3);">
            <p class="type-departure-label" style="color: var(--ink-secondary);">Moving time</p>
            <p class="type-reflective-body" style="color: var(--ink-primary);">${ride.movingTime}</p>
          </div>
          <div style="margin-top: var(--space-3);">
            <p class="type-departure-label" style="color: var(--ink-secondary);">Elapsed time</p>
            <p class="type-reflective-body" style="color: var(--ink-primary);">${ride.elapsedTime}</p>
          </div>
          <div style="margin-top: var(--space-3);">
            <p class="type-departure-label" style="color: var(--ink-secondary);">Average speed</p>
            <p class="type-reflective-body" style="color: var(--ink-primary);">${ride.avgSpeed}</p>
          </div>
          <div style="margin-top: var(--space-3);">
            <p class="type-departure-label" style="color: var(--ink-secondary);">Max speed</p>
            <p class="type-reflective-body" style="color: var(--ink-primary);">${ride.maxSpeed}</p>
          </div>
          ${ride.with ? `<div style="margin-top: var(--space-3);">
            <p class="type-departure-label" style="color: var(--ink-secondary);">With</p>
            <p class="type-reflective-body" style="color: var(--ink-primary);">${ride.with}</p>
          </div>` : ''}
        `;
      }

      const journalText = document.querySelector('.journal-text');
      if (journalText) journalText.textContent = ride.journal;
    }
  }

  // Event delegation for navigation
  document.addEventListener('click', function(e) {
    const target = e.target.closest('[data-navigate]');
    if (target) {
      e.preventDefault();
      const screenId = target.getAttribute('data-navigate');
      showScreen(screenId);
    }
  });

  // Route option selection
  document.addEventListener('click', function(e) {
    const option = e.target.closest('.route-option');
    if (option) {
      const options = document.querySelectorAll('.route-option');
      options.forEach(opt => {
        opt.querySelector('span').style.color = 'var(--ink-primary)';
      });
      option.querySelector('span').style.color = 'var(--amber-core)';
    }
  });

  // Expose functions globally (for inline onclick handlers if needed)
  window.showScreen = showScreen;
  window.setStartState = setStartState;
  window.setJoinState = setJoinState;

  // Initialize on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initFromData);
  } else {
    initFromData();
  }

})();
