// Phase 0 smoke test: open the WS, send one loc, expect a `welcome` then a `state`
// broadcast echoing our fix (docs/SETUP_BACKEND.md §10). Delete or keep as a smoke test.
// Usage: node wstest.mjs [rideCode] — mints a ride via POST /rides if none is given.
const code = process.argv[2] ?? (await (await fetch("http://localhost:8080/rides", { method: "POST" })).json()).code;
const ws = new WebSocket(`ws://localhost:8080/ws?ride=${code}&name=tester`);
let gotWelcome = false;
let gotState = false;
ws.onopen = () => {
  console.log("connected, ride:", code);
  ws.send(JSON.stringify({ type: "loc", lat: 12.9716, lng: 77.5946, heading: 45, speed: 6.2, ts: Math.floor(Date.now() / 1000) }));
};
ws.onmessage = (e) => {
  const msg = JSON.parse(e.data);
  if (msg.type === "welcome") { gotWelcome = true; console.log("welcome id:", msg.id); }
  if (msg.type === "state") { gotState = true; console.log("state:", e.data); }
};
setTimeout(() => {
  console.log(gotWelcome && gotState ? "PASS: welcome + state received" : `FAIL: welcome=${gotWelcome} state=${gotState}`);
  process.exit(gotWelcome && gotState ? 0 : 1);
}, 1500);
