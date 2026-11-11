# Mock UI Demo — Implementation Playbook

Step-by-step instructions for building the mock UI demo. Execute in order. Each step provides exact file paths, CSS custom property names, and mock data values so you never invent anything.

---

## Step 0: Create Directory Structure

```bash
cd C:\Data\projects\Horizon
mkdir demo
```

**Files to create:**
- `demo/index.html`
- `demo/styles.css`
- `demo/data.js`
- `demo/app.js`
- `demo/README.md`

---

## Step 1: Scaffold + Phone Frame + CSS Tokens

### 1.1 Create `demo/README.md`

```markdown
# Horizon Mock UI Demo

Open `index.html` in a browser to view the demo.

No build step, no dependencies. All values transcribed from `mobile/src/design/tokens.ts`.

Mock-only: no backend, no network at runtime (except Google Fonts, graceful fallback to system fonts).
```

### 1.2 Create `demo/index.html` (basic shell)

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Horizon — Mock UI Demo</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Newsreader:wght@400&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="styles.css">
</head>
<body>
  <div class="phone-frame">
    <div class="screen-container">
      <!-- Screen: Departure -->
      <div id="screen-departure" class="screen active" data-start-state="idle" data-join-state="idle" style="overflow-y: auto">
        <!-- Content added in Step 5 -->
      </div>

      <!-- Screen: Motion -->
      <div id="screen-motion" class="screen">
        <!-- Content added in Task 6 -->
      </div>

      <!-- Screen: Planner -->
      <div id="screen-planner" class="screen">
        <!-- Content added in Task 8 -->
      </div>

      <!-- Screen: Return List -->
      <div id="screen-return-list" class="screen">
        <!-- Content added in Task 9 -->
      </div>

      <!-- Screen: Return Detail -->
      <div id="screen-return-detail" class="screen">
        <!-- Content added in Task 10 -->
      </div>
    </div>
  </div>

  <script src="data.js"></script>
  <script src="app.js"></script>
</body>
</html>
```

### 1.3 Create `demo/styles.css` (tokens + frame)

```css
/* ==========================================================================
   Design Tokens — transcribed from mobile/src/design/tokens.ts
   ========================================================================== */

:root {
  /* Colors - surfaces */
  --surface-void: #000000;
  --surface-base: #0A0A0B;
  --surface-raised: #141416;
  --surface-overlay: #1C1C1F;
  --surface-hairline: #2A2A2E;

  /* Colors - ink */
  --ink-primary: #F5F4F2;
  --ink-secondary: #A3A29E;
  --ink-tertiary: #6B6A67;
  --ink-disabled: #3F3F42;

  /* Colors - amber */
  --amber-core: #E8A33D;
  --amber-dim: #8A6224;
  --amber-wash: rgba(232, 163, 61, 0.10);

  /* Colors - signal */
  --signal-caution: #E8A33D;
  --signal-critical: #D4544A;
  --signal-good: #6E9E7C;

  /* Spacing */
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 24px;
  --space-6: 32px;
  --space-7: 48px;
  --space-8: 64px;
  --space-9: 96px;

  /* Radius */
  --radius-input: 4px;
  --radius-card: 10px;
  --radius-sheet: 18px;
  --radius-full: 9999px;

  /* Typography - font stacks */
  --font-operational: 'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif;
  --font-reflective: 'Newsreader', 'Source Serif 4', Georgia, serif;
}

/* ==========================================================================
   Base
   ========================================================================== */

* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

body {
  font-family: var(--font-operational);
  background: var(--surface-base);
  color: var(--ink-primary);
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
}

/* ==========================================================================
   Phone Frame
   ========================================================================== */

.phone-frame {
  width: 375px;
  height: 812px;
  border: 1px solid var(--surface-hairline);
  position: relative;
  overflow: hidden;
}

.screen-container {
  width: 100%;
  height: 100%;
  position: relative;
}

/* Responsive: fill screen on mobile viewports */
@media (max-width: 400px) {
  .phone-frame {
    width: 100%;
    height: 100vh;
    border: none;
  }
}

/* ==========================================================================
   Screen Switching
   ========================================================================== */

.screen {
  display: none;
  width: 100%;
  height: 100%;
  position: absolute;
  top: 0;
  left: 0;
}

.screen.active {
  display: block;
}

/* ==========================================================================
   Typography Utility Classes
   ========================================================================== */

/* Motion scale */
.type-motion-primary {
  font-family: var(--font-operational);
  font-size: 64px;
  line-height: 64px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.type-motion-secondary {
  font-family: var(--font-operational);
  font-size: 32px;
  line-height: 36px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.type-motion-label {
  font-family: var(--font-operational);
  font-size: 15px;
  line-height: 20px;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 1.2px;
}

/* Departure scale */
.type-departure-display {
  font-family: var(--font-operational);
  font-size: 40px;
  line-height: 44px;
  font-weight: 600;
}

.type-departure-title {
  font-family: var(--font-operational);
  font-size: 28px;
  line-height: 34px;
  font-weight: 600;
}

.type-departure-body {
  font-family: var(--font-operational);
  font-size: 17px;
  line-height: 24px;
  font-weight: 400;
}

.type-departure-label {
  font-family: var(--font-operational);
  font-size: 13px;
  line-height: 18px;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.78px;
}

/* Reflective scale (Return only) */
.type-reflective-title {
  font-family: var(--font-reflective);
  font-size: 32px;
  line-height: 40px;
  font-weight: 400;
}

.type-reflective-body {
  font-family: var(--font-reflective);
  font-size: 19px;
  line-height: 30px;
  font-weight: 400;
}

.type-reflective-caption {
  font-family: var(--font-operational);
  font-size: 14px;
  line-height: 20px;
  font-weight: 400;
}

/* Tabular nums utility */
.tabular-nums {
  font-variant-numeric: tabular-nums;
}

/* ==========================================================================
   Common Elements
   ========================================================================== */

/* Buttons */
.btn-primary {
  background: var(--amber-core);
  color: var(--surface-void);
  border: none;
  border-radius: var(--radius-card);
  padding: var(--space-4);
  min-height: 44px;
  font-family: var(--font-operational);
  font-size: 17px;
  font-weight: 400;
  cursor: pointer;
  width: 100%;
}

.btn-primary:disabled {
  background: var(--ink-disabled);
  color: var(--ink-secondary);
  cursor: not-allowed;
}

/* Inputs */
.input-field {
  background: transparent;
  border: none;
  border-bottom: 1px solid var(--surface-hairline);
  color: var(--ink-primary);
  font-family: var(--font-operational);
  font-size: 17px;
  line-height: 24px;
  padding: var(--space-2) 0;
  width: 100%;
  min-height: 44px;
}

.input-field::placeholder {
  color: var(--ink-tertiary);
}

/* Back links (mock-only) */
.back-link {
  font-family: var(--font-operational);
  font-size: 13px;
  line-height: 18px;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.78px;
  color: var(--ink-secondary);
  text-decoration: none;
  cursor: pointer;
  min-height: 44px;
  display: inline-flex;
  align-items: center;
}

.back-link:hover {
  color: var(--ink-primary);
}

/* Spoken directions toggle (real app: platform Switch, app/index.tsx —
   amber track when on, ink.disabled when off, ink.primary thumb;
   radius and duration from tokens) */
.switch-track {
  position: absolute;
  cursor: pointer;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: var(--amber-core);
  border-radius: var(--radius-full);
  transition: 220ms; /* motion.duration.base — the Departure animation cap */
}

.switch-thumb {
  position: absolute;
  width: 20px;
  height: 20px;
  top: 4px;
  left: 4px;
  border-radius: var(--radius-full);
  background-color: var(--ink-primary);
  transition: 220ms;
}

input:checked + .switch-track .switch-thumb {
  left: 26px;
}

input:not(:checked) + .switch-track {
  background-color: var(--ink-disabled);
}
```

### 1.4 Verification

Open `demo/index.html` in a browser:
- See a 375×812px phone frame centered on a dark background
- Resize browser to < 400px wide → frame disappears, content fills screen
- Inspect CSS variables in dev tools → all match `tokens.ts`

---

## Step 2: Typography System + Font Loading

Already done in Step 1.3 (Google Fonts link in `index.html`, typography classes in `styles.css`).

### Verification

Open browser, inspect any text:
- Font family: Inter (or system sans fallback)
- Font size, weight, line-height match token
- Letter-spacing on `.type-departure-label`: 0.78px
- Tabular-nums on numeric elements: digits don't shift width

---

## Step 3: Mock Data Module

### 3.1 Create `demo/data.js`

```javascript
/**
 * Mock data for the Horizon demo.
 * All values are static. No network calls.
 */

window.DATA = {
  // Departure
  RIDE_CODE: "H3K7M2",
  RIDER_NAME: "Alex",
  LOCATION_STATUS: "Location ready.",
  VOICE_ENABLED: true,

  // Motion
  MOTION: {
    speed: 62,
    maneuver: "420 m · Turn right onto NH 44",
    street: "NH 44",
    readout: "28 min · 14.2 km"
  },

  // Convoy (Motion screen) — binary state per ADR-009, never a ranking
  CONVOY_RIDERS: [
    { name: "Sam", position: "ahead", color: "var(--ink-primary)" },
    { name: "Alex", position: "you", color: "var(--amber-core)" },
    { name: "Rio", position: "behind", color: "var(--ink-primary)" }
  ],

  // Planner
  ROUTE_WAYPOINTS: [
    { label: "Your location", lat: 12.9716, lng: 77.5946 },
    { label: "MG Road, Bangalore", lat: 12.9784, lng: 77.6408 }
  ],

  ROUTE_SUMMARIES: [
    { text: "32 min · 18 km · via NH 44", selected: true },
    { text: "36 min · 20 km · via Outer Ring Road", selected: false },
    { text: "34 min · 17 km · via MG Road", selected: false }
  ],

  // Return List
  RIDES: [
    {
      id: "ride-1",
      title: "Bangalore to Mysore",
      date: "12 October 2026",
      dateShort: "12 Oct",
      distance: "142 km",
      movingTime: "2h 18m",
      elapsedTime: "2h 31m",
      avgSpeed: "62 km/h",
      maxSpeed: "98 km/h",
      with: "Sam, Rio",
      journal: "Left Bangalore around 7am. The highway was quiet - just us and the truckers. The climb past Savandurga was the best part, everything opened up. Stopped at the viewpoint near Mysore for chai. Good ride."
    },
    {
      id: "ride-2",
      title: "Nandi Hills Loop",
      date: "05 October 2026",
      dateShort: "05 Oct",
      distance: "68 km",
      movingTime: "1h 42m",
      elapsedTime: "1h 55m",
      avgSpeed: "40 km/h",
      maxSpeed: "68 km/h",
      with: "",
      journal: ""
    },
    {
      id: "ride-3",
      title: "City Evening Ride",
      date: "28 September 2026",
      dateShort: "28 Sep",
      distance: "24 km",
      movingTime: "52m",
      elapsedTime: "1h 02m",
      avgSpeed: "28 km/h",
      maxSpeed: "45 km/h",
      with: "",
      journal: ""
    }
  ]
};
```

### 3.2 Verification

Open browser console, inspect `window.DATA`:
- All mock values present
- No network requests in dev tools

---

## Step 4: Navigation State Machine

### 4.1 Create `demo/app.js`

```javascript
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
```

### 4.2 Verification

Open browser, see Departure screen (active by default).

---

## Step 5: Departure Screen

### 5.1 Add Departure HTML to `index.html`

Replace the `#screen-departure` placeholder with (persistent layout mirroring real `app/index.tsx` — title, status, name, toggle, both section titles, and Past rides all remain on screen; only the Start and Join flow regions swap):

```html
<!-- Screen: Departure (persistent layout + two independent state regions) -->
<div id="screen-departure" class="screen active" data-start-state="idle" data-join-state="idle" style="background: var(--surface-base); padding: var(--space-5); overflow-y: auto;">
  <!-- Persistent chrome (always visible) -->
  <h1 class="type-departure-display" style="color: var(--ink-primary);">Horizon</h1>
  <p class="type-departure-body location-status" style="color: var(--signal-good); margin-top: var(--space-4);">Location ready.</p>

  <label class="type-departure-label" style="color: var(--ink-secondary); margin-top: var(--space-6); display: block;">Your name</label>
  <input type="text" class="input-field rider-name-input" placeholder="Name" style="margin-top: var(--space-2);">

  <div style="display: flex; justify-content: space-between; align-items: center; margin-top: var(--space-6); min-height: 44px;">
    <span class="type-departure-body" style="color: var(--ink-primary);">Spoken directions</span>
    <label style="position: relative; display: inline-block; width: 50px; height: 28px;">
      <input type="checkbox" class="voice-toggle" checked style="opacity: 0; width: 0; height: 0;">
      <span class="switch-track"><span class="switch-thumb"></span></span>
    </label>
  </div>

  <!-- Start flow region title (persistent) -->
  <h2 class="type-departure-title" style="color: var(--ink-primary); margin-top: var(--space-7);">Start a ride</h2>

  <!-- Start flow: idle -->
  <div class="start-idle">
    <button class="btn-primary" style="margin-top: var(--space-4);" onclick="setStartState('confirm')">Start a ride</button>
  </div>

  <!-- Start flow: confirm -->
  <div class="start-confirm">
    <p class="type-departure-display tabular-nums ride-code-display" style="color: var(--ink-primary); margin-top: var(--space-4); text-align: center; letter-spacing: 8px;">H3K7M2</p>
    <button class="btn-primary" style="margin-top: var(--space-4);" data-navigate="screen-planner">Plan the route</button>
    <button class="btn-primary" style="margin-top: var(--space-4);" data-navigate="screen-motion">Start Riding</button>
  </div>

  <!-- Join flow region title (persistent) -->
  <h2 class="type-departure-title" style="color: var(--ink-primary); margin-top: var(--space-7);">Join a ride</h2>

  <!-- Join flow: idle -->
  <div class="join-idle">
    <input type="text" class="input-field ride-code-input" style="margin-top: var(--space-4); text-align: center; font-size: 40px; line-height: 44px; letter-spacing: 8px; font-variant-numeric: tabular-nums; text-transform: uppercase;" placeholder="CODE" maxlength="6">
    <button class="btn-primary" style="margin-top: var(--space-4);" onclick="setJoinState('connected')">Join</button>
  </div>

  <!-- Join flow: connected -->
  <div class="join-connected">
    <p class="type-departure-display tabular-nums ride-code-display" style="color: var(--ink-primary); margin-top: var(--space-4); text-align: center; letter-spacing: 8px;">H3K7M2</p>
    <button class="btn-primary" style="margin-top: var(--space-4);" data-navigate="screen-planner">Plan the route</button>
    <button class="btn-primary" style="margin-top: var(--space-4);" data-navigate="screen-motion">Join Ride</button>
  </div>

  <!-- Past rides link (real app UI, mock wires it to screen switching instead of router.push('/return')) -->
  <a href="#" class="back-link" style="margin-top: var(--space-7);" data-navigate="screen-return-list">Past rides</a>
</div>
```

### 5.2 Add Departure State CSS to `styles.css`

```css
/* Departure — two independent state regions, persistent layout */
.start-idle,
.start-confirm,
.join-idle,
.join-connected {
  display: none;
}

#screen-departure[data-start-state="idle"] .start-idle { display: block; }
#screen-departure[data-start-state="confirm"] .start-confirm { display: block; }

#screen-departure[data-join-state="idle"] .join-idle { display: block; }
#screen-departure[data-join-state="connected"] .join-connected { display: block; }
```

### 5.3 Verification

Open browser:
- See Departure screen with "Horizon" title, name input (pre-filled from data.js), toggle, location status, both section titles visible, Past rides link
- Click "Start a ride" → Start flow region swaps to show ride code, Plan/Start Riding buttons; Join flow region UNCHANGED (still shows input + Join)
- Click "Plan the route" → Planner screen (once built)
- Click "Start Riding" → Motion screen (once built)
- Reset Departure, click "Join" → Join flow region swaps to show code, Plan/Join Ride buttons; Start flow region UNCHANGED
- Click "Past rides" → Return List (once built)
- Scroll content → screen scrolls smoothly (overflow-y: auto)

---

## Step 6: Motion Screen Structure + Map + Convoy

### 6.1 Add Motion HTML to `index.html`

Replace the `#screen-motion` placeholder with:

```html
<!-- Screen: Motion -->
<div id="screen-motion" class="screen" style="background: var(--surface-void);">
  <!-- Map placeholder (SVG) -->
  <svg class="motion-map" viewBox="0 0 375 812" preserveAspectRatio="xMidYMid slice" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; z-index: 0;">
    <rect width="375" height="812" fill="var(--surface-raised)"/>
    <!-- Route line (stroke-width 4, matches RouteLine.tsx's line-width) -->
    <path d="M 50 700 Q 150 500 200 400 T 320 100" stroke="var(--amber-core)" stroke-width="4" fill="none"/>
    <!-- Destination ring at the route's end point (DestinationMarker reuse: 20px, hollow, ink.primary) -->
    <circle cx="320" cy="100" r="10" stroke="var(--ink-primary)" stroke-width="2" fill="none"/>
    <!-- Rider dots (16px diameter, r=8, binary state per ADR-009: own dot amber, others ink.primary) -->
    <circle class="rider-dot" cx="255" cy="275" r="8" fill="var(--ink-primary)"/> <!-- Sam (ahead, nearing the destination) -->
    <circle class="rider-dot" cx="200" cy="400" r="8" fill="var(--amber-core)"/> <!-- Alex (you) -->
    <circle class="rider-dot" cx="100" cy="600" r="8" fill="var(--ink-primary)"/> <!-- Rio (behind) -->
  </svg>

  <!-- Horizon Line bands -->
  <div class="horizon-ahead" style="position: relative; z-index: 1; height: 34%; padding: var(--space-6);">
    <!-- AheadCue added in Step 7 -->
  </div>

  <div class="horizon-now" style="position: relative; z-index: 1; height: 24%; padding: var(--space-6); display: flex; align-items: center;">
    <!-- SpeedReadout added in Step 7 -->
  </div>

  <div class="horizon-held" style="position: relative; z-index: 1; height: 42%; padding: var(--space-6); display: flex; align-items: flex-start;">
    <!-- EndRide pill added in Step 7 -->
  </div>

  <!-- Push-to-talk band (invisible, pointer-events: none so EndRide wins the touch) -->
  <div class="ptt-band" style="position: absolute; bottom: 0; left: 0; right: 0; height: 42%; z-index: 2; pointer-events: none;">
    <!-- Optional 2px amber hairline at bottom when talking -->
  </div>
</div>
```

### 6.2 Verification

Navigate to Motion screen:
- See dark void background, map placeholder with amber route line, 3 rider dots (Sam/Rio ink.primary, Alex amber.core)
- Verify dot size is 16px diameter (r=8)
- Horizon Line bands visible (empty for now)
- PTT band exists but doesn't intercept clicks on the Held band area (pointer-events: none)

---

## Step 7: Motion Screen Content (AheadCue, SpeedReadout, EndRide)

### 7.1 Add Motion Content HTML

Update the Horizon bands in `index.html`:

```html
<!-- Ahead band -->
<div class="horizon-ahead" style="position: relative; z-index: 1; height: 34%; padding: var(--space-6);">
  <!-- AheadCue card: width: fit-content (band is NOT flex, so align-self is no-op) -->
  <div style="background: var(--surface-void); border-radius: var(--radius-card); padding: var(--space-4); width: fit-content;">
    <div style="display: flex; align-items: center; gap: var(--space-3);">
      <!-- Maneuver glyph (right-turn dart) -->
      <svg width="28" height="28" viewBox="0 0 24 24">
        <path d="M12 4 L20 20 L12 15.5 L4 20 Z" fill="var(--amber-core)" transform="rotate(90 12 12)"/>
      </svg>
      <div>
        <p class="type-motion-secondary maneuver-text" style="color: var(--ink-primary);">420 m · Turn right onto NH 44</p>
        <p class="type-motion-label street-text" style="color: var(--ink-secondary);">NH 44</p>
        <p class="type-motion-label readout-text" style="color: var(--ink-secondary);">28 min · 14.2 km</p>
      </div>
    </div>
  </div>
</div>

<!-- Now band -->
<div class="horizon-now" style="position: relative; z-index: 1; height: 24%; padding: var(--space-6); display: flex; align-items: center;">
  <!-- SpeedReadout card: NO align-self — band's default justify-content: flex-start left-aligns, align-items: center vertically centers -->
  <div style="background: var(--surface-void); border-radius: var(--radius-card); padding: var(--space-4); text-align: center;">
    <p class="type-motion-primary speed-display" style="color: var(--ink-primary);">62</p>
    <p class="type-motion-label" style="color: var(--ink-primary);">km/h</p>
  </div>
</div>

<!-- Held band -->
<div class="horizon-held" style="position: relative; z-index: 1; height: 42%; padding: var(--space-6); display: flex; align-items: flex-start; justify-content: flex-end;">
  <!-- mock-only: EndRide pill shown visible (real app gates on 5s stationary + 800ms long-press) -->
  <button data-navigate="screen-return-detail" style="background: var(--surface-overlay); border-radius: var(--radius-full); padding: var(--space-4); border: none; min-height: 56px; cursor: pointer;">
    <span class="type-motion-label" style="color: var(--ink-primary);">Hold to end ride</span>
  </button>
</div>
```

### 7.2 Verification

Navigate to Motion screen:
- Ahead band: ONE AheadCue card with `width: fit-content` (shrink-to-fit, not full-width)
- Now band: SpeedReadout card vertically centered (not pinned to top), "62" (largest element, 64px), "KM/H" label
- Held band: EndRide pill visible
- Click EndRide pill → navigates to Return Detail (PTT band's `pointer-events: none` allows the click to reach the pill)
- All text uses `--ink-primary` or `--ink-secondary` (never `--ink-tertiary`)
- Verify data binding: edit `window.DATA.MOTION` in console, reload → Motion screen reflects new values

---

## Step 8: Planner Screen

### 8.1 Add Planner HTML to `index.html`

Replace the `#screen-planner` placeholder with:

```html
<!-- Screen: Planner -->
<div id="screen-planner" class="screen" style="background: var(--surface-base);">
  <!-- Map area (top ~45%) -->
  <div style="height: 45%; background: var(--surface-raised); position: relative;">
    <svg viewBox="0 0 375 365" preserveAspectRatio="xMidYMid slice" style="width: 100%; height: 100%;">
      <rect width="375" height="365" fill="var(--surface-raised)"/>
      <path d="M 50 300 Q 150 200 200 150 T 320 50" stroke="var(--amber-core)" stroke-width="4" fill="none"/>
      <circle cx="50" cy="300" r="4" fill="var(--ink-primary)"/>
      <circle cx="320" cy="50" r="4" fill="var(--ink-primary)"/>
    </svg>
  </div>

  <!-- Bottom sheet (max 55%) -->
  <div style="max-height: 55%; background: var(--surface-raised); border-top-left-radius: var(--radius-sheet); border-top-right-radius: var(--radius-sheet); padding: var(--space-5); overflow-y: auto;">
    <!-- mock-only: Back link (real app uses system back) -->
    <a href="#" class="back-link" data-navigate="screen-departure">Back</a>

    <h2 class="type-departure-title" style="color: var(--ink-primary); margin-top: var(--space-3);">Plan your route</h2>
    <p class="type-departure-body origin-line" style="color: var(--ink-secondary); margin-top: var(--space-3);">Your location</p>

    <!-- Stops list -->
    <div style="margin-top: var(--space-2);">
      <div style="display: flex; align-items: center; gap: var(--space-2);">
        <span class="type-departure-body stop-label" style="color: var(--ink-primary); flex: 1;">1. MG Road, Bangalore</span>
        <button disabled style="background: none; border: none; color: var(--ink-disabled); font-size: 17px; min-width: 44px; min-height: 44px;">↑</button>
        <button disabled style="background: none; border: none; color: var(--ink-disabled); font-size: 17px; min-width: 44px; min-height: 44px;">↓</button>
        <button style="background: none; border: none; color: var(--signal-critical); font-size: 17px; min-width: 44px; min-height: 44px;">×</button>
      </div>
    </div>

    <!-- Destination search input -->
    <input type="text" class="input-field" placeholder="Search for a destination" style="margin-top: var(--space-2);">

    <!-- Route summary lines -->
    <div style="margin-top: var(--space-4);">
      <button class="route-option" style="background: none; border: none; text-align: left; width: 100%; min-height: 44px; cursor: pointer;">
        <span class="type-departure-body" style="color: var(--amber-core);">32 min · 18 km · via NH 44</span>
      </button>
      <button class="route-option" style="background: none; border: none; text-align: left; width: 100%; min-height: 44px; cursor: pointer;">
        <span class="type-departure-body" style="color: var(--ink-primary);">36 min · 20 km · via Outer Ring Road</span>
      </button>
      <button class="route-option" style="background: none; border: none; text-align: left; width: 100%; min-height: 44px; cursor: pointer;">
        <span class="type-departure-body" style="color: var(--ink-primary);">34 min · 17 km · via MG Road</span>
      </button>
    </div>

    <!-- mock-only: "Set destination" navigates to Departure (real app uses router.back()) -->
    <button class="btn-primary" style="margin-top: var(--space-4);" data-navigate="screen-departure">Set destination</button>
  </div>
</div>
```

### 8.2 Add Route Option Selection JS to `app.js`

```javascript
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
```

### 8.3 Verification

Navigate to Planner screen:
- See Back link, map with route + waypoints, bottom sheet
- Click Back → Departure
- Click a route alternative → selected line changes to amber
- Click "Set destination" → Departure

---

## Step 9: Return List Screen

### 9.1 Add Return List HTML to `index.html`

Replace the `#screen-return-list` placeholder with:

```html
<!-- Screen: Return List -->
<div id="screen-return-list" class="screen" style="background: var(--surface-base); padding: var(--space-5); overflow-y: auto;">
  <!-- mock-only: Back link (real app uses system back) -->
  <a href="#" class="back-link" data-navigate="screen-departure">Back</a>

  <h1 class="type-reflective-title" style="color: var(--ink-primary); margin-top: var(--space-3);">Rides</h1>

  <p class="type-departure-label" style="color: var(--ink-tertiary); margin-top: var(--space-5);">2026</p>

  <!-- Ride rows (populated by initFromData from window.DATA.RIDES) -->
  <div class="rides-list">
    <!-- Rows injected by app.js initFromData() -->
  </div>
</div>
```

### 9.2 Verification

Navigate to Return List screen:
- See "Rides" title in serif, year divider
- Verify data binding: 3 ride rows appear (Bangalore to Mysore, Nandi Hills Loop, City Evening Ride)
- Click a ride row → Return Detail (once built)
- Click Back → Departure
- Verify data binding: edit `window.DATA.RIDES` in console, reload → ride list reflects changes

---

## Step 10: Return Detail Screen

### 10.1 Add Return Detail HTML to `index.html`

Replace the `#screen-return-detail` placeholder with:

```html
<!-- Screen: Return Detail -->
<div id="screen-return-detail" class="screen" style="background: var(--surface-base); padding: var(--space-5); overflow-y: auto;">
  <!-- mock-only: Back link (real app uses system back) -->
  <a href="#" class="back-link" data-navigate="screen-return-list">Back</a>

  <h1 class="type-reflective-title ride-detail-title" style="color: var(--ink-primary); margin-top: var(--space-3);">Bangalore to Mysore</h1>

  <!-- RideTrace (220px-tall map card) -->
  <div style="height: 220px; background: var(--surface-raised); border-radius: var(--radius-card); margin-top: var(--space-5); position: relative; overflow: hidden;">
    <svg viewBox="0 0 375 220" preserveAspectRatio="xMidYMid slice" style="width: 100%; height: 100%;">
      <rect width="375" height="220" fill="var(--surface-raised)"/>
      <path d="M 50 180 Q 150 120 200 100 T 320 40" stroke="var(--amber-core)" stroke-width="4" fill="none"/>
      <circle cx="320" cy="40" r="10" stroke="var(--ink-primary)" stroke-width="2" fill="none"/>
      <circle cx="50" cy="180" r="8" fill="var(--ink-primary)"/>
    </svg>
  </div>

  <!-- RideFacts list (stacked layout, populated by initFromData) -->
  <div class="ride-facts" style="margin-top: var(--space-5);">
    <div style="margin-top: var(--space-3);">
      <p class="type-departure-label" style="color: var(--ink-secondary);">Date</p>
      <p class="type-reflective-body" style="color: var(--ink-primary);">12 October 2026</p>
    </div>
    <div style="margin-top: var(--space-3);">
      <p class="type-departure-label" style="color: var(--ink-secondary);">Distance</p>
      <p class="type-reflective-body" style="color: var(--ink-primary);">142 km</p>
    </div>
    <div style="margin-top: var(--space-3);">
      <p class="type-departure-label" style="color: var(--ink-secondary);">Moving time</p>
      <p class="type-reflective-body" style="color: var(--ink-primary);">2h 18m</p>
    </div>
    <div style="margin-top: var(--space-3);">
      <p class="type-departure-label" style="color: var(--ink-secondary);">Elapsed time</p>
      <p class="type-reflective-body" style="color: var(--ink-primary);">2h 31m</p>
    </div>
    <div style="margin-top: var(--space-3);">
      <p class="type-departure-label" style="color: var(--ink-secondary);">Average speed</p>
      <p class="type-reflective-body" style="color: var(--ink-primary);">62 km/h</p>
    </div>
    <div style="margin-top: var(--space-3);">
      <p class="type-departure-label" style="color: var(--ink-secondary);">Max speed</p>
      <p class="type-reflective-body" style="color: var(--ink-primary);">98 km/h</p>
    </div>
    <div style="margin-top: var(--space-3);">
      <p class="type-departure-label" style="color: var(--ink-secondary);">With</p>
      <p class="type-reflective-body" style="color: var(--ink-primary);">Sam, Rio</p>
    </div>
  </div>

  <!-- PhotoStrip -->
  <div style="margin-top: var(--space-6);">
    <a href="#" class="type-departure-body" style="color: var(--amber-core); text-decoration: none; min-height: 44px; display: inline-flex; align-items: center;">Add a photo</a>
    <div style="display: flex; gap: var(--space-2); margin-top: var(--space-3); overflow-x: auto;">
      <div style="width: 120px; height: 120px; background: var(--surface-hairline); border-radius: var(--radius-card); flex-shrink: 0;"></div>
      <div style="width: 120px; height: 120px; background: var(--surface-hairline); border-radius: var(--radius-card); flex-shrink: 0;"></div>
      <div style="width: 120px; height: 120px; background: var(--surface-hairline); border-radius: var(--radius-card); flex-shrink: 0;"></div>
    </div>
  </div>

  <!-- JournalNote -->
  <div style="margin-top: var(--space-6);">
    <p class="type-reflective-body journal-text" style="color: var(--ink-primary);">Left Bangalore around 7am. The highway was quiet - just us and the truckers. The climb past Savandurga was the best part, everything opened up. Stopped at the viewpoint near Mysore for chai. Good ride.</p>
  </div>

  <!-- Delete link -->
  <p class="type-departure-label" style="color: var(--ink-tertiary); margin-top: var(--space-7); min-height: 44px; display: flex; align-items: center; cursor: pointer;">Delete this ride</p>
</div>
```

### 10.2 Verification

Navigate to Return Detail screen:
- See Back link, route name in serif, RideTrace map card with 20px hollow ring and 16px start dot
- RideFacts: 7 facts in stacked layout (label above value), each pair separated by 12px
- PhotoStrip: "Add a photo" link + 3 gray thumbnails
- JournalNote: journal text in serif with token line-height (no inline override)
- "Delete this ride" link at bottom
- Click Back → Return List
- Verify data binding: edit `window.DATA.RIDES[0]` in console, reload → detail reflects changes

---

## Step 11: Final Validation + Polish

### 11.1 Walk Through Navigation Map

Open `demo/index.html` and verify:
- Departure → Start a ride → confirm → Plan the route → Planner → Set destination → Departure
- Departure → Start a ride → confirm → Start Riding → Motion → Hold to end ride → Return Detail → Back → Return List → Back → Departure
- Departure → Join → connected → Plan the route → Planner
- Departure → Past rides → Return List → ride row → Return Detail

### 11.2 Check Acceptance Criteria

Verify each AC in the spec:
- AC-1: Phone frame 375×812, responsive < 400px
- AC-2: Dark theme, contrast floors (4.5:1 Departure/Return, 7:1 Motion), no `--ink-tertiary` in Motion
- AC-3: Inter for operational, Newsreader for reflective, tabular-nums, letter-spacing
- AC-4: Departure screen all states
- AC-5: Motion screen Horizon Line, AheadCue, SpeedReadout, EndRide, convoy dots
- AC-6: Planner screen bottom sheet, alternatives, Set destination
- AC-7: Return List serif title, year divider, ride rows
- AC-8: Return Detail RideTrace, RideFacts, PhotoStrip, JournalNote
- AC-9: All navigation paths work
- AC-10: No backend, no network (except Google Fonts)
- AC-11: Visual quality, spacing, touch targets
- AC-12: All values match tokens.ts

### 11.3 Polish

- Consistent spacing (4pt scale)
- Touch targets: 44px Departure/Return, 56px Motion
- No visual clutter
- Premium feel

### 11.4 Update README

Already done in Step 1.1.

---

## Summary

You now have a complete mock UI demo at `demo/` that:
- Opens as static files (no build, no backend)
- Shows all three registers + Planner
- Uses exact values from `tokens.ts`
- Satisfies all 12 acceptance criteria

Open `demo/index.html` in a browser and walk through the navigation map.
