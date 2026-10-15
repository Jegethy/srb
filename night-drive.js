// night-drive.js
// A full-screen night drive: a pseudo-3D road drawn on a canvas, with the
// car radio showing whatever is playing on Last.fm. Loaded on demand by
// main.js when a [data-night-drive] button is pressed, "drive" is typed, or
// the page is opened with #drive.
//
// The road is built the way classic racing games build theirs: a looping
// track of short segments, each with its own curvature. The camera drives
// along it, so markings, posts and lamps stay fixed to the road and sweep
// round bends naturally.

import { PLACEHOLDER_ART } from '/lastfm.js';
import { createRadio } from '/night-drive-radio.js';

const DEFAULT_SPEED_MPH = 50;
const MAX_SPEED_MPH = 90;
const SPEED_STEP_MPH = 10;
const GAUGE_MAX_MPH = 100;
const ACCELERATION_MPH_PER_SECOND = 12;
const BRAKING_MPH_PER_SECOND = 20;
const MPH_TO_METRES_PER_SECOND = 0.447;
// Steering wheel angle at the tightest bend on the track
const MAX_WHEEL_DEGREES = 24;

// World units are metres.
const SEGMENT_LENGTH = 2;
const DRAW_SEGMENTS = 300; // 600 m of road ahead
const DRAW_DISTANCE = DRAW_SEGMENTS * SEGMENT_LENGTH;
const NEAREST_Z = 0.5;
const ROAD_HALF_WIDTH = 3.65; // two UK lanes
const LANE_OFFSET = -ROAD_HALF_WIDTH / 2; // we drive in the left lane
const EDGE_LINE_INSET = 0.15;
const EDGE_LINE_WIDTH = 0.15;
const CENTRE_LINE_HALF_WIDTH = 0.07;
// UK centre line: 4 m painted, 8 m gap
const DASH_EVERY = 6;
const DASH_SEGMENTS = 2;
const POST_EVERY = 13;
const LAMP_EVERY = 45;
// Converts the track's curve values into metres of sideways drift per segment
const CURVE_SCALE = 0.0045;
const MAX_TRACK_CURVE = 1.4;
// The horizon sits this fraction of the way down the view above the dashboard
const HORIZON = 0.62;
const SKYLINE_WIDTH = 2; // the skyline is two screens wide and wraps as the road turns

const COLOURS = {
  skyTop: '#030406',
  skyHorizon: '#1a0a10',
  cityGlow: 'rgba(178, 30, 53, 0.45)',
  skyline: '#07080b',
  road: '#0e0f13',
  verge: '#050608',
  line: '#c5c6c7',
  red: '#b21e35',
  brightRed: '#ff3b55',
  moon: '#d9dadb',
};

// Steering wheel: rim with red stitching across the top, three spokes and an SB hub
const WHEEL_SVG = `
  <svg class="nd-wheel" viewBox="0 0 400 400" aria-hidden="true">
    <path d="M38 196 C70 188 120 186 150 196 L156 238 C120 232 76 234 44 242 Z" fill="#141519" />
    <path d="M362 196 C330 188 280 186 250 196 L244 238 C280 232 324 234 356 242 Z" fill="#141519" />
    <path d="M176 248 L224 248 L236 370 L164 370 Z" fill="#141519" />
    <circle cx="200" cy="200" r="168" fill="none" stroke="#111215" stroke-width="36" />
    <circle cx="200" cy="200" r="185" fill="none" stroke="rgba(255,255,255,0.05)" stroke-width="2" />
    <path d="M54.5 116 A168 168 0 0 1 345.5 116" fill="none" stroke="#b21e35" stroke-width="2" stroke-dasharray="4 6" opacity="0.55" />
    <circle cx="200" cy="215" r="54" fill="#17181c" stroke="#0a0b0d" stroke-width="5" />
    <text x="200" y="228" text-anchor="middle" font-family="Montserrat, sans-serif" font-weight="700" font-size="34" fill="#b21e35">SB</text>
  </svg>`;

const GAUGE_SVG = `
  <svg class="nd-gauge" viewBox="0 0 120 68" aria-hidden="true">
    <path d="M10 62 A50 50 0 0 1 110 62" fill="none" stroke="#24252b" stroke-width="5" stroke-linecap="round" />
    <path class="nd-gauge-fill" d="M10 62 A50 50 0 0 1 110 62" fill="none" stroke="#b21e35" stroke-width="5" stroke-linecap="round" pathLength="100" stroke-dasharray="0 100" />
    <line class="nd-needle" x1="60" y1="62" x2="60" y2="18" stroke="#ff3b55" stroke-width="2.5" stroke-linecap="round" />
    <circle cx="60" cy="62" r="4" fill="#ff3b55" />
  </svg>`;

const POWER_ICON = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1v6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" fill="none"/><path d="M4.6 3.6a5.5 5.5 0 1 0 6.8 0" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" fill="none"/></svg>';
const NEXT_ICON = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 3l6 5-6 5zM8 3l6 5-6 5z" fill="currentColor"/><rect x="13" y="3" width="1.8" height="10" fill="currentColor"/></svg>';

let active = null;

export function startNightDrive(trigger) {
  if (active) return;
  active = createDrive(trigger);
}

function createDrive(trigger) {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const overlay = document.createElement('div');
  overlay.className = 'night-drive';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', 'Night drive');
  overlay.innerHTML = `
    <canvas class="nd-canvas" aria-hidden="true"></canvas>
    <div class="nd-frame" aria-hidden="true">
      <div class="nd-roof"></div>
      <div class="nd-pillar nd-pillar-left"></div>
      <div class="nd-pillar nd-pillar-right"></div>
      <div class="nd-mirror"></div>
    </div>
    <button class="nd-exit" type="button">Pull over <span aria-hidden="true">✕</span></button>
    <p class="nd-hint">${reduceMotion
      ? 'Motion is paused to respect your reduced-motion setting'
      : '↑ ↓ speed · M radio · N next track · Esc pull over'}</p>
    <div class="nd-dash">
      <div class="nd-vent nd-vent-right" aria-hidden="true"></div>
      <div class="nd-headunit">
        <div class="nd-headunit-screen">
          <img class="nd-art" src="${PLACEHOLDER_ART}" alt="" width="64" height="64" referrerpolicy="no-referrer" />
          <div class="nd-lcd" aria-live="polite">
            <p class="nd-station-row"><span class="nd-station">SB FM</span><span class="nd-clock" aria-hidden="true"></span></p>
            <p class="nd-track"><span>Tuning in…</span></p>
          </div>
        </div>
        <div class="nd-headunit-controls">
          <button type="button" class="nd-knob nd-power" aria-label="Radio power" aria-pressed="false">${POWER_ICON}</button>
          <button type="button" class="nd-knob nd-next" aria-label="Next track">${NEXT_ICON}</button>
          <input type="range" class="nd-volume" min="0" max="1" step="0.05" aria-label="Volume" />
          <a class="nd-source" href="https://music.apple.com/" target="_blank" rel="noopener">Previews: Apple Music</a>
        </div>
      </div>
      <div class="nd-cluster">
        <button type="button" class="nd-speed-btn" data-speed="-1" aria-label="Slow down">▼</button>
        <div class="nd-speedo">
          ${GAUGE_SVG}
          <p class="nd-readout"><span class="nd-mph">0</span> mph</p>
        </div>
        <button type="button" class="nd-speed-btn" data-speed="1" aria-label="Speed up">▲</button>
      </div>
      ${WHEEL_SVG}
    </div>
  `;
  document.body.appendChild(overlay);
  document.documentElement.classList.add('night-drive-open');

  const canvas = overlay.querySelector('canvas');
  const ctx = canvas.getContext('2d');
  const dash = overlay.querySelector('.nd-dash');
  const wheel = overlay.querySelector('.nd-wheel');
  const needle = overlay.querySelector('.nd-needle');
  const gaugeFill = overlay.querySelector('.nd-gauge-fill');
  const mphEl = overlay.querySelector('.nd-mph');
  const clockEl = overlay.querySelector('.nd-clock');
  const exitButton = overlay.querySelector('.nd-exit');

  const scene = createScene();
  let targetMph = reduceMotion ? 0 : DEFAULT_SPEED_MPH;
  let mph = 0;
  let wheelAngle = 0;
  let width = 0;
  let height = 0;
  let roadBottom = 0;
  let frame = 0;
  let lastTime = performance.now();

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = window.innerWidth;
    height = window.innerHeight;
    roadBottom = dash.getBoundingClientRect().top;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (reduceMotion) drawScene(ctx, scene, width, height, roadBottom);
  }

  function updateInstruments(dt) {
    // Ease towards the chosen speed like a real car rather than jumping
    const rate = targetMph > mph ? ACCELERATION_MPH_PER_SECOND : BRAKING_MPH_PER_SECOND;
    mph += Math.sign(targetMph - mph) * Math.min(Math.abs(targetMph - mph), rate * dt);
    const fraction = mph / GAUGE_MAX_MPH;
    needle.setAttribute('transform', `rotate(${-90 + fraction * 180} 60 62)`);
    gaugeFill.setAttribute('stroke-dasharray', `${fraction * 100} 100`);
    mphEl.textContent = Math.round(mph);

    // Turn the wheel with the bend under the car
    const segment = scene.track[Math.floor(scene.position / SEGMENT_LENGTH)];
    const target = (segment.curve / (CURVE_SCALE * MAX_TRACK_CURVE)) * MAX_WHEEL_DEGREES;
    wheelAngle += (target - wheelAngle) * Math.min(1, dt * 3);
    wheel.style.transform = `rotate(${wheelAngle}deg)`;
  }

  function updateClock() {
    clockEl.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function tick(now) {
    // The first frame's timestamp can be slightly earlier than lastTime, so clamp at 0
    const dt = Math.max(0, Math.min((now - lastTime) / 1000, 0.1));
    lastTime = now;
    updateInstruments(dt);
    updateScene(scene, dt, mph * MPH_TO_METRES_PER_SECOND);
    drawScene(ctx, scene, width, height, roadBottom);
    frame = requestAnimationFrame(tick);
  }

  function setSpeed(value) {
    targetMph = Math.max(0, Math.min(MAX_SPEED_MPH, value));
  }

  function onKeydown(e) {
    if (e.target.closest && e.target.closest('input') && e.key.startsWith('Arrow')) return;
    if (e.key === 'Escape') {
      close();
    } else if (e.key === 'ArrowUp' && !reduceMotion) {
      e.preventDefault();
      setSpeed(targetMph + SPEED_STEP_MPH);
    } else if (e.key === 'ArrowDown' && !reduceMotion) {
      e.preventDefault();
      setSpeed(targetMph - SPEED_STEP_MPH);
    } else if (e.key.toLowerCase() === 'm' && !e.ctrlKey && !e.metaKey) {
      radio.toggle();
    } else if (e.key.toLowerCase() === 'n' && !e.ctrlKey && !e.metaKey) {
      radio.next();
    } else if (e.key === 'Tab') {
      trapFocus(e, overlay);
    }
  }

  overlay.querySelectorAll('[data-speed]').forEach(button => {
    button.disabled = reduceMotion;
    button.addEventListener('click', () => setSpeed(targetMph + Number(button.dataset.speed) * SPEED_STEP_MPH));
  });
  exitButton.addEventListener('click', close);
  document.addEventListener('keydown', onKeydown);
  window.addEventListener('resize', resize);

  const radio = createRadio(overlay);
  updateClock();
  const clockTimer = setInterval(updateClock, 10000);
  resize();
  if (!reduceMotion) frame = requestAnimationFrame(tick);
  exitButton.focus();

  function close() {
    cancelAnimationFrame(frame);
    clearInterval(clockTimer);
    radio.destroy();
    document.removeEventListener('keydown', onKeydown);
    window.removeEventListener('resize', resize);
    overlay.classList.add('is-closing');
    document.documentElement.classList.remove('night-drive-open');
    setTimeout(() => overlay.remove(), reduceMotion ? 0 : 300);
    if (location.hash === '#drive') {
      history.replaceState(null, '', location.pathname + location.search);
    }
    if (trigger && document.contains(trigger)) trigger.focus();
    active = null;
  }

  return { close };
}

// Keeps keyboard focus inside the overlay while it is open
function trapFocus(e, container) {
  const focusable = [...container.querySelectorAll('button:not([disabled]), a[href], input')];
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}

// ---- Track ----------------------------------------------------------------

function random(min, max) {
  return min + Math.random() * (max - min);
}

function randomInt(min, max) {
  return Math.floor(random(min, max + 1));
}

function easeInOut(from, to, progress) {
  return from + (to - from) * (0.5 - Math.cos(progress * Math.PI) / 2);
}

/**
 * Builds a looping track: straights alternating with gentle left and right
 * bends that ease in and out. Each segment records its curvature and what
 * stands beside it. The track starts and ends straight so the loop is seamless.
 */
function buildTrack() {
  const curves = [];
  const straight = length => {
    for (let i = 0; i < length; i++) curves.push(0);
  };
  const bend = (enter, hold, leave, curve) => {
    for (let i = 0; i < enter; i++) curves.push(easeInOut(0, curve, i / enter));
    for (let i = 0; i < hold; i++) curves.push(curve);
    for (let i = 0; i < leave; i++) curves.push(easeInOut(curve, 0, i / leave));
  };

  straight(80);
  for (let i = 0; i < 14; i++) {
    const direction = Math.random() < 0.5 ? -1 : 1;
    bend(randomInt(50, 90), randomInt(60, 160), randomInt(50, 90), direction * random(0.6, 1.4));
    straight(randomInt(40, 140));
  }
  straight(DRAW_SEGMENTS);

  return curves.map((curve, index) => ({
    curve: curve * CURVE_SCALE,
    dash: index % DASH_EVERY < DASH_SEGMENTS,
    post: index % POST_EVERY === 0,
    lamp: index % LAMP_EVERY === 0,
  }));
}

// ---- Scene ----------------------------------------------------------------

function createScene() {
  const stars = Array.from({ length: 140 }, () => ({
    x: Math.random(),
    y: Math.random() * 0.5,
    size: random(0.4, 1.4),
    phase: random(0, Math.PI * 2),
    speed: random(0.5, 2),
  }));

  // Skyline buildings across SKYLINE_WIDTH screens, wrapping as the road turns
  const buildings = [];
  for (let x = 0; x < SKYLINE_WIDTH; x += random(0.012, 0.03)) {
    const w = random(0.01, 0.035);
    const h = random(0.02, 0.12) * (Math.random() < 0.12 ? 1.8 : 1);
    const windows = Array.from({ length: Math.floor(random(0, 6)) }, () => ({
      x: random(0.15, 0.85),
      y: random(0.1, 0.9),
      red: Math.random() < 0.3,
    }));
    buildings.push({ x, w, h, windows });
  }

  const track = buildTrack();
  return {
    time: 0,
    track,
    trackLength: track.length * SEGMENT_LENGTH,
    position: 0, // metres along the track
    heading: 0, // radians turned so far, used to swing the skyline
    stars,
    buildings,
    vehicles: [],
    nextVehicleIn: random(2, 5),
  };
}

function updateScene(scene, dt, speed) {
  scene.time += dt;
  const travelled = speed * dt;
  const segment = scene.track[Math.floor(scene.position / SEGMENT_LENGTH)];
  // Turning rate follows the curvature under the car
  scene.heading += (segment.curve / (SEGMENT_LENGTH * SEGMENT_LENGTH)) * travelled;
  scene.position = (((scene.position + travelled) % scene.trackLength) + scene.trackLength) % scene.trackLength;

  // Oncoming cars (headlights, right-hand lane) and the odd car ahead (tail lights, our lane)
  scene.nextVehicleIn -= dt;
  if (scene.nextVehicleIn <= 0) {
    const oncoming = Math.random() < 0.7;
    scene.vehicles.push({
      oncoming,
      distance: DRAW_DISTANCE * 0.9,
      speed: oncoming ? random(18, 30) : Math.max(speed * random(0.85, 1.05), 8),
    });
    scene.nextVehicleIn = random(3, 9);
  }
  for (const v of scene.vehicles) {
    v.distance += (v.oncoming ? -(speed + v.speed) : v.speed - speed) * dt;
  }
  scene.vehicles = scene.vehicles.filter(v => v.distance > 4 && v.distance < DRAW_DISTANCE * 0.95);
}

function drawScene(ctx, scene, w, h, roadBottom) {
  const horizon = roadBottom * HORIZON;
  const span = Math.min(w, h * 1.45);
  const focal = span * 0.9;
  // Camera height is chosen so the road fills about 80% of the width where it meets the dashboard
  const cameraHeight = ((ROAD_HALF_WIDTH * 2) * (roadBottom - horizon)) / (span * 0.8);

  drawSky(ctx, scene, w, h, horizon, focal);

  // ---- Project the road ahead ----
  // Walk forward segment by segment, accumulating the sideways drift of each
  // bend. `x` is the road centre's offset from straight ahead at each point.
  const { track } = scene;
  const base = Math.floor(scene.position / SEGMENT_LENGTH);
  const intoSegment = scene.position - base * SEGMENT_LENGTH;
  let x = 0;
  let dx = -track[base].curve * (intoSegment / SEGMENT_LENGTH);
  const points = []; // road centre at the start of each visible segment, near to far
  const segments = [];
  for (let n = 0; n < DRAW_SEGMENTS; n++) {
    const segment = track[(base + n) % track.length];
    let z1 = n * SEGMENT_LENGTH - intoSegment;
    const z2 = z1 + SEGMENT_LENGTH;
    let x1 = x;
    const x2 = x + dx;
    x += dx;
    dx += segment.curve;
    if (z2 <= NEAREST_Z) continue;
    if (z1 < NEAREST_Z) {
      // Clip the segment that starts behind the camera
      x1 += (x2 - x1) * ((NEAREST_Z - z1) / (z2 - z1));
      z1 = NEAREST_Z;
    }
    segments.push({ segment, z1, z2, x1, x2 });
  }
  segments.forEach(s => points.push({ x: s.x1, z: s.z1 }));
  const last = segments[segments.length - 1];
  points.push({ x: last.x2, z: last.z2 });

  // Screen position of a point `offset` metres across the road at depth z,
  // given the road centre's drift `centre` there.
  const toScreen = (centre, offset, z, height = 0) => ({
    x: w / 2 + ((centre + offset - LANE_OFFSET) * focal) / z,
    y: horizon + ((cameraHeight - height) * focal) / z,
  });

  // Ground, then the road surface as one polygon
  ctx.fillStyle = COLOURS.verge;
  ctx.fillRect(0, horizon, w, h - horizon);

  const strip = (from, to, list = points) => {
    ctx.beginPath();
    list.forEach((p, i) => {
      const s = toScreen(p.x, from, p.z);
      if (i) ctx.lineTo(s.x, s.y);
      else ctx.moveTo(s.x, s.y);
    });
    for (let i = list.length - 1; i >= 0; i--) {
      const s = toScreen(list[i].x, to, list[i].z);
      ctx.lineTo(s.x, s.y);
    }
    ctx.closePath();
    ctx.fill();
  };

  ctx.fillStyle = COLOURS.road;
  strip(-ROAD_HALF_WIDTH, ROAD_HALF_WIDTH);

  // Markings fade into the dark towards the horizon
  const markings = ctx.createLinearGradient(0, horizon, 0, horizon + (roadBottom - horizon) * 0.25);
  markings.addColorStop(0, 'rgba(197, 198, 199, 0)');
  markings.addColorStop(1, 'rgba(197, 198, 199, 0.6)');
  ctx.fillStyle = markings;
  const edge = ROAD_HALF_WIDTH - EDGE_LINE_INSET;
  strip(-edge, -edge + EDGE_LINE_WIDTH);
  strip(edge - EDGE_LINE_WIDTH, edge);

  // Centre line dashes belong to fixed segments, so they follow the bend
  const dashes = ctx.createLinearGradient(0, horizon, 0, horizon + (roadBottom - horizon) * 0.25);
  dashes.addColorStop(0, 'rgba(197, 198, 199, 0)');
  dashes.addColorStop(1, 'rgba(197, 198, 199, 0.95)');
  ctx.fillStyle = dashes;
  for (const s of segments) {
    if (!s.segment.dash) continue;
    strip(-CENTRE_LINE_HALF_WIDTH, CENTRE_LINE_HALF_WIDTH, [{ x: s.x1, z: s.z1 }, { x: s.x2, z: s.z2 }]);
  }

  // Headlight pool on our lane just ahead
  const pool = ctx.createRadialGradient(w / 2, roadBottom, 0, w / 2, roadBottom, (roadBottom - horizon) * 1.4);
  pool.addColorStop(0, 'rgba(197, 198, 199, 0.12)');
  pool.addColorStop(1, 'rgba(197, 198, 199, 0)');
  ctx.fillStyle = pool;
  ctx.fillRect(0, horizon, w, h - horizon);

  // Roadside objects and traffic, drawn far to near so closer ones overlap
  const objects = [];
  for (const s of segments) {
    if (s.segment.post) {
      // UK marker posts: red reflectors on the left, white on the right
      objects.push({ z: s.z1, draw: () => drawPost(ctx, toScreen, s.x1, -ROAD_HALF_WIDTH - 0.8, s.z1, COLOURS.brightRed, focal) });
      objects.push({ z: s.z1, draw: () => drawPost(ctx, toScreen, s.x1, ROAD_HALF_WIDTH + 0.8, s.z1, COLOURS.line, focal) });
    }
    if (s.segment.lamp) {
      objects.push({ z: s.z1, draw: () => drawLamp(ctx, toScreen, s.x1, -ROAD_HALF_WIDTH - 1.5, s.z1, focal) });
    }
  }
  for (const v of scene.vehicles) {
    const s = segments.find(seg => v.distance >= seg.z1 && v.distance < seg.z2);
    if (!s) continue;
    const centre = s.x1 + (s.x2 - s.x1) * ((v.distance - s.z1) / (s.z2 - s.z1));
    objects.push({ z: v.distance, draw: () => drawVehicle(ctx, toScreen, centre, v, focal) });
  }
  objects.sort((a, b) => b.z - a.z).forEach(o => o.draw());

  // Vignette to frame the view like a windscreen
  const vignette = ctx.createRadialGradient(w / 2, h * 0.55, Math.min(w, h) * 0.35, w / 2, h * 0.55, Math.max(w, h) * 0.8);
  vignette.addColorStop(0, 'rgba(0, 0, 0, 0)');
  vignette.addColorStop(1, 'rgba(0, 0, 0, 0.65)');
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, w, h);
}

function drawSky(ctx, scene, w, h, horizon, focal) {
  const sky = ctx.createLinearGradient(0, 0, 0, horizon);
  sky.addColorStop(0, COLOURS.skyTop);
  sky.addColorStop(1, COLOURS.skyHorizon);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, horizon + 1);

  for (const star of scene.stars) {
    const twinkle = 0.55 + 0.45 * Math.sin(scene.time * star.speed + star.phase);
    ctx.globalAlpha = twinkle * 0.8;
    ctx.fillStyle = COLOURS.line;
    ctx.fillRect(star.x * w, star.y * horizon, star.size, star.size);
  }
  ctx.globalAlpha = 1;

  // Moon with a soft halo
  const moonX = w * 0.8;
  const moonY = horizon * 0.28;
  const moonR = Math.max(14, Math.min(w, h * 1.4) * 0.035);
  const halo = ctx.createRadialGradient(moonX, moonY, moonR, moonX, moonY, moonR * 5);
  halo.addColorStop(0, 'rgba(217, 218, 219, 0.18)');
  halo.addColorStop(1, 'rgba(217, 218, 219, 0)');
  ctx.fillStyle = halo;
  ctx.fillRect(moonX - moonR * 5, moonY - moonR * 5, moonR * 10, moonR * 10);
  ctx.fillStyle = COLOURS.moon;
  ctx.beginPath();
  ctx.arc(moonX, moonY, moonR, 0, Math.PI * 2);
  ctx.fill();

  // Red city glow and skyline, which swing across as the road turns
  const glow = ctx.createLinearGradient(0, horizon - h * 0.2, 0, horizon);
  glow.addColorStop(0, 'rgba(178, 30, 53, 0)');
  glow.addColorStop(1, COLOURS.cityGlow);
  ctx.fillStyle = glow;
  ctx.fillRect(0, horizon - h * 0.2, w, h * 0.2);

  const loop = SKYLINE_WIDTH * w;
  const shift = ((scene.heading * focal) % loop + loop) % loop;
  for (const b of scene.buildings) {
    let bx = b.x * w - shift;
    if (bx + b.w * w < 0) bx += loop;
    if (bx > w) continue;
    const bh = b.h * h;
    ctx.fillStyle = COLOURS.skyline;
    ctx.fillRect(bx, horizon - bh, b.w * w, bh + 1);
    for (const win of b.windows) {
      ctx.fillStyle = win.red ? COLOURS.red : 'rgba(197, 198, 199, 0.7)';
      ctx.fillRect(bx + win.x * b.w * w, horizon - bh + win.y * bh, 1.5, 1.5);
    }
  }
}

// Distant objects fade into the dark
function fade(z) {
  return Math.max(0, Math.min(1, (DRAW_DISTANCE - z) / (DRAW_DISTANCE * 0.6)));
}

function drawPost(ctx, toScreen, centre, offset, z, reflector, focal) {
  const base = toScreen(centre, offset, z);
  const scale = focal / z;
  const postHeight = 1.0 * scale;
  const postWidth = Math.max(1, 0.12 * scale);
  ctx.globalAlpha = fade(z);
  ctx.fillStyle = '#2a2b30';
  ctx.fillRect(base.x - postWidth / 2, base.y - postHeight, postWidth, postHeight);
  ctx.fillStyle = reflector;
  ctx.fillRect(base.x - postWidth / 2, base.y - postHeight, postWidth, Math.max(1, postHeight * 0.18));
  ctx.globalAlpha = 1;
}

function drawLamp(ctx, toScreen, centre, offset, z, focal) {
  const base = toScreen(centre, offset, z);
  const scale = focal / z;
  const top = base.y - 8 * scale;
  const armEnd = base.x + 1.6 * scale;
  ctx.globalAlpha = fade(z);
  ctx.strokeStyle = '#1c1d22';
  ctx.lineWidth = Math.max(1, 0.15 * scale);
  ctx.beginPath();
  ctx.moveTo(base.x, base.y);
  ctx.lineTo(base.x, top);
  ctx.lineTo(armEnd, top);
  ctx.stroke();

  const radius = Math.max(4, 2.5 * scale);
  const light = ctx.createRadialGradient(armEnd, top, 0, armEnd, top, radius);
  light.addColorStop(0, 'rgba(230, 230, 232, 0.9)');
  light.addColorStop(0.1, 'rgba(197, 198, 199, 0.35)');
  light.addColorStop(1, 'rgba(197, 198, 199, 0)');
  ctx.fillStyle = light;
  ctx.fillRect(armEnd - radius, top - radius, radius * 2, radius * 2);
  ctx.globalAlpha = 1;
}

function drawVehicle(ctx, toScreen, centre, vehicle, focal) {
  // Oncoming traffic uses the right-hand lane; cars ahead share ours (UK roads)
  const lane = vehicle.oncoming ? -LANE_OFFSET : LANE_OFFSET;
  const z = vehicle.distance;
  const scale = focal / z;
  const radius = Math.max(1.5, (vehicle.oncoming ? 0.2 : 0.14) * scale);
  const colour = vehicle.oncoming ? '230, 230, 232' : '255, 59, 85';

  ctx.globalAlpha = fade(z);
  for (const side of [-0.75, 0.75]) {
    const p = toScreen(centre, lane + side, z, 0.7);
    const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, radius * 4);
    g.addColorStop(0, `rgba(${colour}, 1)`);
    g.addColorStop(0.25, `rgba(${colour}, 0.5)`);
    g.addColorStop(1, `rgba(${colour}, 0)`);
    ctx.fillStyle = g;
    ctx.fillRect(p.x - radius * 4, p.y - radius * 4, radius * 8, radius * 8);
  }
  ctx.globalAlpha = 1;
}
