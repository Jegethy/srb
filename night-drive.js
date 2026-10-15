// night-drive.js
// A full-screen night drive: a pseudo-3D road drawn on a canvas, with the
// car radio showing whatever is playing on Last.fm. Loaded on demand by
// main.js when a [data-night-drive] button is pressed, "drive" is typed, or
// the page is opened with #drive.

import { getLatestTrack, PLACEHOLDER_ART } from '/lastfm.js';

const RADIO_REFRESH_MS = 30000;
const DEFAULT_SPEED_MPH = 50;
const MAX_SPEED_MPH = 90;
const SPEED_STEP_MPH = 10;
const MPH_TO_METRES_PER_SECOND = 0.447;

// World units are metres. NEAR_Z is where the road meets the bottom of the screen.
const NEAR_Z = 2;
const FAR_Z = 260;
const ROAD_HALF_WIDTH = 5;
const DASH_SPACING = 12;
const DASH_LENGTH = 4;
const POST_SPACING = 25;
const LAMP_SPACING = 70;

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
    <canvas class="night-drive-canvas" aria-hidden="true"></canvas>
    <button class="night-drive-exit" type="button">Pull over <span aria-hidden="true">✕</span></button>
    <div class="night-drive-dash">
      <div class="night-drive-radio" aria-live="polite">
        <img class="night-drive-art" src="${PLACEHOLDER_ART}" alt="" width="56" height="56" referrerpolicy="no-referrer" />
        <div class="night-drive-display">
          <p class="night-drive-station">Radio</p>
          <p class="night-drive-track"><span>Tuning in…</span></p>
        </div>
      </div>
      <div class="night-drive-controls">
        <button type="button" class="night-drive-speed-btn" data-speed="-1" aria-label="Slow down">▼</button>
        <p class="night-drive-speed"><span class="night-drive-mph">${reduceMotion ? 0 : DEFAULT_SPEED_MPH}</span> mph</p>
        <button type="button" class="night-drive-speed-btn" data-speed="1" aria-label="Speed up">▲</button>
      </div>
    </div>
    <p class="night-drive-hint">${reduceMotion ? 'Motion is paused to respect your reduced-motion setting' : '↑ ↓ to change speed · Esc to pull over'}</p>
  `;
  document.body.appendChild(overlay);
  document.documentElement.classList.add('night-drive-open');

  const canvas = overlay.querySelector('canvas');
  const ctx = canvas.getContext('2d');
  const mphEl = overlay.querySelector('.night-drive-mph');
  const exitButton = overlay.querySelector('.night-drive-exit');

  const scene = createScene();
  let speedMph = reduceMotion ? 0 : DEFAULT_SPEED_MPH;
  let width = 0;
  let height = 0;
  let frame = 0;
  let lastTime = performance.now();

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (reduceMotion) drawScene(ctx, scene, width, height);
  }

  function tick(now) {
    const dt = Math.min((now - lastTime) / 1000, 0.1);
    lastTime = now;
    updateScene(scene, dt, speedMph * MPH_TO_METRES_PER_SECOND);
    drawScene(ctx, scene, width, height);
    frame = requestAnimationFrame(tick);
  }

  function setSpeed(mph) {
    speedMph = Math.max(0, Math.min(MAX_SPEED_MPH, mph));
    mphEl.textContent = speedMph;
  }

  function onKeydown(e) {
    if (e.key === 'Escape') {
      close();
    } else if (e.key === 'ArrowUp' && !reduceMotion) {
      e.preventDefault();
      setSpeed(speedMph + SPEED_STEP_MPH);
    } else if (e.key === 'ArrowDown' && !reduceMotion) {
      e.preventDefault();
      setSpeed(speedMph - SPEED_STEP_MPH);
    } else if (e.key === 'Tab') {
      trapFocus(e, overlay);
    }
  }

  overlay.querySelectorAll('[data-speed]').forEach(button => {
    button.disabled = reduceMotion;
    button.addEventListener('click', () => setSpeed(speedMph + Number(button.dataset.speed) * SPEED_STEP_MPH));
  });
  exitButton.addEventListener('click', close);
  document.addEventListener('keydown', onKeydown);
  window.addEventListener('resize', resize);

  const radio = startRadio(overlay);
  resize();
  if (!reduceMotion) frame = requestAnimationFrame(tick);
  exitButton.focus();

  function close() {
    cancelAnimationFrame(frame);
    clearInterval(radio);
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
  const focusable = [...container.querySelectorAll('button:not([disabled]), a[href]')];
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

// ---- Car radio ------------------------------------------------------------

function startRadio(overlay) {
  const stationEl = overlay.querySelector('.night-drive-station');
  const trackEl = overlay.querySelector('.night-drive-track');
  const artEl = overlay.querySelector('.night-drive-art');
  let shown = '';

  async function refresh() {
    let track = null;
    try {
      track = await getLatestTrack();
    } catch (error) {
      console.warn('Night drive radio could not reach Last.fm:', error);
    }
    const text = track ? `${track.name} — ${track.artist}` : 'Just the engine and the road tonight';
    if (text === shown) return;
    shown = text;
    stationEl.textContent = track ? (track.isPlaying ? 'Now playing' : 'Last played') : 'Radio off';
    artEl.src = (track && track.art) || PLACEHOLDER_ART;
    artEl.alt = track ? `${track.name} cover art` : '';

    // Scroll long titles across the display like a car stereo
    const span = document.createElement('span');
    span.textContent = text;
    trackEl.replaceChildren(span);
    trackEl.classList.remove('is-scrolling');
    requestAnimationFrame(() => {
      const overflow = span.scrollWidth - trackEl.clientWidth;
      if (overflow > 0) {
        trackEl.style.setProperty('--scroll-distance', `${-overflow - 24}px`);
        trackEl.classList.add('is-scrolling');
      }
    });
  }

  refresh();
  return setInterval(refresh, RADIO_REFRESH_MS);
}

// ---- Scene ----------------------------------------------------------------

function random(min, max) {
  return min + Math.random() * (max - min);
}

function createScene() {
  const stars = Array.from({ length: 140 }, () => ({
    x: Math.random(),
    y: Math.random() * 0.5,
    size: random(0.4, 1.4),
    phase: random(0, Math.PI * 2),
    speed: random(0.5, 2),
  }));

  // Skyline buildings across two screen widths so it can drift with the road's curve
  const buildings = [];
  for (let x = 0; x < 2; x += random(0.012, 0.03)) {
    const w = random(0.01, 0.035);
    const h = random(0.02, 0.12) * (Math.random() < 0.12 ? 1.8 : 1);
    const windows = Array.from({ length: Math.floor(random(0, 6)) }, () => ({
      x: random(0.15, 0.85),
      y: random(0.1, 0.9),
      red: Math.random() < 0.3,
    }));
    buildings.push({ x, w, h, windows });
  }

  return {
    time: 0,
    distance: 0,
    stars,
    buildings,
    vehicles: [],
    nextVehicleIn: random(2, 5),
  };
}

function updateScene(scene, dt, speed) {
  scene.time += dt;
  scene.distance += speed * dt;

  // Oncoming cars (headlights, right-hand lane) and the odd car ahead (tail lights, our lane)
  scene.nextVehicleIn -= dt;
  if (scene.nextVehicleIn <= 0) {
    const oncoming = Math.random() < 0.7;
    scene.vehicles.push({
      oncoming,
      z: FAR_Z,
      speed: oncoming ? random(18, 30) : Math.max(speed * random(0.85, 1.05), 8),
    });
    scene.nextVehicleIn = random(3, 9);
  }
  for (const v of scene.vehicles) {
    v.z += (v.oncoming ? -(speed + v.speed) : v.speed - speed) * dt;
  }
  scene.vehicles = scene.vehicles.filter(v => v.z > NEAR_Z * 0.9 && v.z <= FAR_Z + 1);
}

// The road gently winds; returns a sideways offset (in screen widths) for a depth
function curveAt(scene, z) {
  const bend = Math.sin(scene.distance * 0.004) * 0.6 + Math.sin(scene.distance * 0.0013) * 0.4;
  // A real bend's sideways drift grows with distance, so it projects to a road
  // that is straight close up and bends most towards the horizon. Clamped so
  // points just behind the bottom of the screen don't swing back out.
  const along = Math.max(0, (z - NEAR_Z) / (FAR_Z - NEAR_Z));
  return bend * 0.18 * along;
}

function drawScene(ctx, scene, w, h) {
  const horizon = h * 0.56;
  const scale = Math.min(w, h * 1.4);
  const bob = Math.sin(scene.distance * 0.35) * 0.6;

  // Projects a point on the road plane: x is metres from the road centre, z is depth
  const project = (x, z) => {
    const s = NEAR_Z / z;
    const centre = w / 2 + curveAt(scene, z) * w;
    return {
      x: centre + x * s * scale * 0.11,
      y: horizon + (h - horizon) * s + bob * s,
      s,
    };
  };

  // Sky
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
  const moonR = Math.max(14, scale * 0.035);
  const halo = ctx.createRadialGradient(moonX, moonY, moonR, moonX, moonY, moonR * 5);
  halo.addColorStop(0, 'rgba(217, 218, 219, 0.18)');
  halo.addColorStop(1, 'rgba(217, 218, 219, 0)');
  ctx.fillStyle = halo;
  ctx.fillRect(moonX - moonR * 5, moonY - moonR * 5, moonR * 10, moonR * 10);
  ctx.fillStyle = COLOURS.moon;
  ctx.beginPath();
  ctx.arc(moonX, moonY, moonR, 0, Math.PI * 2);
  ctx.fill();

  // Red city glow and skyline on the horizon, drifting with the curve of the road
  const glow = ctx.createLinearGradient(0, horizon - h * 0.2, 0, horizon);
  glow.addColorStop(0, 'rgba(178, 30, 53, 0)');
  glow.addColorStop(1, COLOURS.cityGlow);
  ctx.fillStyle = glow;
  ctx.fillRect(0, horizon - h * 0.2, w, h * 0.2);

  const drift = (-curveAt(scene, FAR_Z) * 0.5 + 0.5) * w;
  for (const b of scene.buildings) {
    const bx = b.x * w - drift;
    if (bx + b.w * w < 0 || bx > w) continue;
    const bh = b.h * h;
    ctx.fillStyle = COLOURS.skyline;
    ctx.fillRect(bx, horizon - bh, b.w * w, bh + 1);
    for (const win of b.windows) {
      ctx.fillStyle = win.red ? COLOURS.red : 'rgba(197, 198, 199, 0.7)';
      ctx.fillRect(bx + win.x * b.w * w, horizon - bh + win.y * bh, 1.5, 1.5);
    }
  }

  // Ground and road surface
  ctx.fillStyle = COLOURS.verge;
  ctx.fillRect(0, horizon, w, h - horizon);

  const samples = [];
  for (let i = 0; i <= 48; i++) {
    samples.push(NEAR_Z / (0.008 + (i / 48) * (1 - 0.008)));
  }
  const edge = side => samples.map(z => project(side * ROAD_HALF_WIDTH, z));
  const left = edge(-1);
  const right = edge(1);

  ctx.fillStyle = COLOURS.road;
  ctx.beginPath();
  left.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  [...right].reverse().forEach(p => ctx.lineTo(p.x, p.y));
  ctx.closePath();
  ctx.fill();

  // Edge lines, drawn segment by segment so they taper into the distance
  ctx.strokeStyle = 'rgba(197, 198, 199, 0.55)';
  for (const side of [-0.92, 0.92]) {
    const points = samples.map(z => project(side * ROAD_HALF_WIDTH, z));
    for (let i = 1; i < points.length; i++) {
      ctx.lineWidth = Math.max(0.5, points[i].s * 6);
      ctx.beginPath();
      ctx.moveTo(points[i - 1].x, points[i - 1].y);
      ctx.lineTo(points[i].x, points[i].y);
      ctx.stroke();
    }
  }

  // Centre dashes rush towards the viewer. Each is drawn as a strip of short
  // steps so it bends with the road instead of cutting across the curve.
  const dashOffset = scene.distance % DASH_SPACING;
  const DASH_STEPS = 6;
  ctx.fillStyle = COLOURS.line;
  for (let z = FAR_Z - dashOffset; z > NEAR_Z * 0.6; z -= DASH_SPACING) {
    const zNear = Math.max(z - DASH_LENGTH, NEAR_Z * 0.6);
    const points = [];
    for (let i = 0; i <= DASH_STEPS; i++) {
      points.push(project(0, z + (zNear - z) * (i / DASH_STEPS)));
    }
    const halfWidth = p => Math.max(0.3, p.s * 5);
    ctx.globalAlpha = Math.min(1, points[DASH_STEPS].s * 6);
    ctx.beginPath();
    points.forEach((p, i) => (i ? ctx.lineTo(p.x - halfWidth(p), p.y) : ctx.moveTo(p.x - halfWidth(p), p.y)));
    [...points].reverse().forEach(p => ctx.lineTo(p.x + halfWidth(p), p.y));
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // Headlight pool on the road just ahead
  const pool = ctx.createRadialGradient(w / 2, h, 0, w / 2, h, h * 0.45);
  pool.addColorStop(0, 'rgba(197, 198, 199, 0.12)');
  pool.addColorStop(1, 'rgba(197, 198, 199, 0)');
  ctx.fillStyle = pool;
  ctx.fillRect(0, horizon, w, h - horizon);

  // Roadside objects and vehicles, drawn far to near so closer ones overlap
  const objects = [];
  const postOffset = scene.distance % POST_SPACING;
  for (let z = FAR_Z - postOffset; z > NEAR_Z; z -= POST_SPACING) {
    // UK marker posts: red reflectors on the left, white on the right
    objects.push({ z, draw: () => drawPost(ctx, project, -ROAD_HALF_WIDTH - 1.5, z, COLOURS.brightRed, scale) });
    objects.push({ z, draw: () => drawPost(ctx, project, ROAD_HALF_WIDTH + 1.5, z, COLOURS.line, scale) });
  }
  const lampOffset = scene.distance % LAMP_SPACING;
  for (let z = FAR_Z - lampOffset; z > NEAR_Z; z -= LAMP_SPACING) {
    objects.push({ z, draw: () => drawLamp(ctx, project, -ROAD_HALF_WIDTH - 3, z, scale) });
  }
  for (const v of scene.vehicles) {
    objects.push({ z: v.z, draw: () => drawVehicle(ctx, project, v, scale) });
  }
  objects.sort((a, b) => b.z - a.z).forEach(o => o.draw());

  // Vignette to frame the view like a windscreen
  const vignette = ctx.createRadialGradient(w / 2, h * 0.55, Math.min(w, h) * 0.35, w / 2, h * 0.55, Math.max(w, h) * 0.8);
  vignette.addColorStop(0, 'rgba(0, 0, 0, 0)');
  vignette.addColorStop(1, 'rgba(0, 0, 0, 0.65)');
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, w, h);
}

function fade(s) {
  // Distant objects fade into the dark
  return Math.min(1, s * 9);
}

function drawPost(ctx, project, x, z, reflector, scale) {
  const base = project(x, z);
  const postHeight = base.s * scale * 0.12;
  const postWidth = Math.max(1, base.s * scale * 0.012);
  ctx.globalAlpha = fade(base.s);
  ctx.fillStyle = '#2a2b30';
  ctx.fillRect(base.x - postWidth / 2, base.y - postHeight, postWidth, postHeight);
  ctx.fillStyle = reflector;
  ctx.fillRect(base.x - postWidth / 2, base.y - postHeight, postWidth, Math.max(1, postHeight * 0.18));
  ctx.globalAlpha = 1;
}

function drawLamp(ctx, project, x, z, scale) {
  const base = project(x, z);
  const poleHeight = base.s * scale * 0.75;
  const armLength = base.s * scale * 0.12;
  const top = base.y - poleHeight;
  ctx.globalAlpha = fade(base.s);
  ctx.strokeStyle = '#1c1d22';
  ctx.lineWidth = Math.max(1, base.s * scale * 0.012);
  ctx.beginPath();
  ctx.moveTo(base.x, base.y);
  ctx.lineTo(base.x, top);
  ctx.lineTo(base.x + armLength, top);
  ctx.stroke();

  const radius = Math.max(4, base.s * scale * 0.25);
  const light = ctx.createRadialGradient(base.x + armLength, top, 0, base.x + armLength, top, radius);
  light.addColorStop(0, 'rgba(230, 230, 232, 0.9)');
  light.addColorStop(0.1, 'rgba(197, 198, 199, 0.35)');
  light.addColorStop(1, 'rgba(197, 198, 199, 0)');
  ctx.fillStyle = light;
  ctx.fillRect(base.x + armLength - radius, top - radius, radius * 2, radius * 2);
  ctx.globalAlpha = 1;
}

function drawVehicle(ctx, project, vehicle, scale) {
  // Oncoming traffic uses the right-hand lane; cars ahead share ours (UK roads)
  const laneX = vehicle.oncoming ? ROAD_HALF_WIDTH * 0.5 : -ROAD_HALF_WIDTH * 0.5;
  const p = project(laneX, vehicle.z);
  const spread = p.s * scale * 0.09;
  const lampY = p.y - p.s * scale * 0.04;
  const radius = Math.max(1.5, p.s * scale * (vehicle.oncoming ? 0.05 : 0.035));
  const colour = vehicle.oncoming ? '230, 230, 232' : '255, 59, 85';

  ctx.globalAlpha = fade(p.s);
  for (const dx of [-spread, spread]) {
    const g = ctx.createRadialGradient(p.x + dx, lampY, 0, p.x + dx, lampY, radius * 4);
    g.addColorStop(0, `rgba(${colour}, 1)`);
    g.addColorStop(0.25, `rgba(${colour}, 0.5)`);
    g.addColorStop(1, `rgba(${colour}, 0)`);
    ctx.fillStyle = g;
    ctx.fillRect(p.x + dx - radius * 4, lampY - radius * 4, radius * 8, radius * 8);
  }
  ctx.globalAlpha = 1;
}
