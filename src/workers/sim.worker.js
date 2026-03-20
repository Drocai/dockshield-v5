// sim.worker.js — Deterministic physics off main thread
// Receives input frames, returns authoritative boat state + collision events

const BOATS = {
  regular: { ac: 0.018, dr: 0.984, tu: 0.045, mx: 1.8, wx: 1.0 },
  pontoon: { ac: 0.012, dr: 0.988, tu: 0.03, mx: 1.2, wx: 0.7 },
  speedboat: { ac: 0.025, dr: 0.978, tu: 0.055, mx: 2.2, wx: 1.4 },
};

let state = {
  x: 0, z: 0, y: 0, rY: Math.PI, rX: 0, rZ: 0,
  speed: 0, angVel: 0, boatClass: 'pontoon',
  score: 0, distTrav: 0, maxSpd: 0, nearMiss: 0,
  prevX: 0, prevZ: 0, t0: Date.now(),
  wx: { ws: 2, wd: 180, g: 0 },
};

let obstacles = []; // [{x, z, r}]
let dockX = 0, dockZ = -250, dockR = 12;
let tick = 0;
let running = false;

function waveY(x, z, t) {
  return Math.sin(x * 0.02 + t) * 0.5 + Math.sin(z * 0.03 + t * 0.8) * 0.4 + Math.sin((x + z) * 0.05 + t * 1.2) * 0.2;
}

function dist(ax, az, bx, bz) {
  const dx = ax - bx, dz = az - bz;
  return Math.sqrt(dx * dx + dz * dz);
}

function step(input) {
  const bt = BOATS[state.boatClass] || BOATS.pontoon;
  const wxP = 1 - Math.min(state.wx.ws * state.wx.ws * 0.003 * bt.wx, 0.4);
  const t = (Date.now() - state.t0) / 1000;

  // Apply input
  const throt = (input.w ? 1 : 0) - (input.s ? 0.5 : 0) + (input.touchThrottle || 0);
  const steer = (input.a ? 1 : 0) - (input.d ? 1 : 0) + (input.touchSteer || 0);

  state.speed = Math.max(Math.min(state.speed + throt * bt.ac * wxP, bt.mx), -bt.mx * 0.3);
  state.speed *= bt.dr;

  if (Math.abs(state.speed) > 0.05) {
    const turnMod = wxP * (1 - Math.min(state.wx.g * 0.02, 0.2));
    state.angVel += steer * bt.tu * turnMod;
  }
  state.angVel *= 0.85;
  state.rY += state.angVel;

  // Direction
  const dx = -Math.sin(state.rY);
  const dz = -Math.cos(state.rY);
  state.prevX = state.x;
  state.prevZ = state.z;
  state.x += dx * state.speed;
  state.z += dz * state.speed;

  // Wind drift
  const wr = state.wx.wd * Math.PI / 180;
  state.x += Math.sin(wr) * state.wx.ws * 0.001 * bt.wx;
  state.z += Math.cos(wr) * state.wx.ws * 0.001 * bt.wx;

  // Buoyancy
  const bowY = waveY(state.x + dx * 2.5, state.z + dz * 2.5, t);
  const sternY = waveY(state.x - dx * 2.5, state.z - dz * 2.5, t);
  state.y += (((bowY + sternY) / 2) - state.y) * 0.1;
  state.rX += ((Math.atan2(bowY - sternY, 5) + (state.speed * 0.12)) - state.rX) * 0.1;
  state.rZ = -state.angVel * 3.0;

  // Distance tracking
  const segDist = dist(state.x, state.z, state.prevX, state.prevZ);
  state.distTrav += segDist;
  const absSpd = Math.abs(state.speed * 45);
  if (absSpd > state.maxSpd) state.maxSpd = absSpd;

  // Scoring
  const dockDist = dist(state.x, state.z, dockX, dockZ);
  if (dockDist < 250) state.score += Math.max(0, Math.round(Math.abs(state.speed) * 10));

  // Collision detection
  let collision = false;
  for (const obs of obstacles) {
    const d = dist(state.x, state.z, obs.x, obs.z);
    if (d < 2.8 + (obs.r || 0)) {
      collision = true;
      break;
    }
    if (d < 7) state.nearMiss++;
  }

  // Dock reached
  const docked = dockDist < dockR;

  tick++;

  return {
    type: 'state',
    tick,
    x: state.x, z: state.z, y: state.y,
    rY: state.rY, rX: state.rX, rZ: state.rZ,
    speed: state.speed, angVel: state.angVel,
    absSpeed: absSpd,
    dockDist,
    score: state.score,
    distTrav: state.distTrav,
    maxSpd: state.maxSpd,
    nearMiss: Math.min(state.nearMiss, 99),
    collision,
    docked,
    elapsed: (Date.now() - state.t0) / 1000,
  };
}

self.onmessage = function (e) {
  const msg = e.data;

  switch (msg.type) {
    case 'init':
      state.boatClass = msg.boatClass || 'pontoon';
      state.x = msg.spawnX || 0;
      state.z = msg.spawnZ || 50;
      state.y = 0;
      state.rY = msg.rY || Math.PI;
      state.speed = 0;
      state.angVel = 0;
      state.score = 0;
      state.distTrav = 0;
      state.maxSpd = 0;
      state.nearMiss = 0;
      state.t0 = Date.now();
      state.prevX = state.x;
      state.prevZ = state.z;
      obstacles = msg.obstacles || [];
      dockX = msg.dockX || 0;
      dockZ = msg.dockZ || -250;
      dockR = msg.dockR || 12;
      tick = 0;
      running = true;
      self.postMessage({ type: 'ready' });
      break;

    case 'input':
      if (!running) return;
      const result = step(msg);
      self.postMessage(result);
      if (result.collision || result.docked) {
        running = false;
        self.postMessage({
          type: 'end',
          won: result.docked,
          score: state.score + (result.docked ? Math.max(0, Math.round(500 - result.elapsed * 3)) : 0),
          elapsed: result.elapsed,
          maxSpd: state.maxSpd,
          distTrav: state.distTrav,
          nearMiss: state.nearMiss,
        });
      }
      break;

    case 'weather':
      state.wx = msg.wx;
      break;

    case 'stop':
      running = false;
      break;
  }
};
