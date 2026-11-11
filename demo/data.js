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
