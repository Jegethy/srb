// night-drive-radio.js
// The night drive's car radio, "SB FM". It plays 30-second previews of what
// Scott has been listening to on Last.fm: whatever is on right now first,
// then recent plays, then this month's top tracks. Previews come from the
// iTunes Search API, which needs no key.

import { lastfm, toArray, getLatestTrack, LASTFM_USER, PLACEHOLDER_ART } from '/lastfm.js';

const ITUNES_SEARCH = 'https://itunes.apple.com/search';
const LIVE_REFRESH_MS = 30000;
const RECENT_LIMIT = 40;
const TOP_LIMIT = 30;
const FADE_SECONDS = 1.2;
const STATIC_SECONDS = 0.35;
const DEFAULT_VOLUME = 0.6;
const MAX_LOOKUP_ATTEMPTS = 8;

/**
 * Wires up the radio inside `root` (the night drive overlay) and switches it
 * on. Returns controls for keyboard shortcuts and cleanup.
 */
export function createRadio(root) {
  const stationEl = root.querySelector('.nd-station');
  const trackEl = root.querySelector('.nd-track');
  const artEl = root.querySelector('.nd-art');
  const powerButton = root.querySelector('.nd-power');
  const nextButton = root.querySelector('.nd-next');
  const volumeInput = root.querySelector('.nd-volume');
  const sourceLink = root.querySelector('.nd-source');

  const audio = new Audio();
  audio.preload = 'auto';
  const previews = new Map(); // track key -> iTunes result, or null if not found
  let queue = [];
  let played = new Set();
  let current = null;
  let liveKey = '';
  let on = false;
  let volume = DEFAULT_VOLUME;
  let fadeFrame = 0;
  let changing = false;
  let audioContext = null;
  let destroyed = false;

  volumeInput.value = String(volume);

  // ---- Display ----

  function show(station, text, art) {
    stationEl.textContent = station;
    artEl.src = art || PLACEHOLDER_ART;
    const span = document.createElement('span');
    span.textContent = text;
    trackEl.replaceChildren(span);
    trackEl.classList.remove('is-scrolling');
    // Scroll long titles across the display like a car stereo
    requestAnimationFrame(() => {
      const overflow = span.scrollWidth - trackEl.clientWidth;
      if (overflow > 0) {
        trackEl.style.setProperty('--scroll-distance', `${-overflow - 24}px`);
        trackEl.classList.add('is-scrolling');
      }
    });
  }

  function setPower(state) {
    on = state;
    powerButton.setAttribute('aria-pressed', String(on));
    root.classList.toggle('nd-radio-on', on);
  }

  // ---- Playlist ----

  const keyOf = track => `${track.artist}|${track.name}`.toLowerCase();

  function addToQueue(tracks, { front = false } = {}) {
    const known = new Set(queue.map(keyOf));
    const fresh = tracks.filter(t => t.name && t.artist && !known.has(keyOf(t)) && known.add(keyOf(t)));
    queue = front ? [...fresh, ...queue] : [...queue, ...fresh];
  }

  async function loadPlaylist() {
    const [live, recent, top] = await Promise.allSettled([
      getLatestTrack(),
      lastfm('user.getrecenttracks', { user: LASTFM_USER, limit: RECENT_LIMIT }),
      lastfm('user.gettoptracks', { user: LASTFM_USER, period: '1month', limit: TOP_LIMIT }),
    ]);
    if (live.status === 'fulfilled' && live.value) {
      liveKey = keyOf(live.value);
      addToQueue([{ ...live.value, live: live.value.isPlaying }]);
    }
    if (recent.status === 'fulfilled') {
      addToQueue(toArray(recent.value.recenttracks && recent.value.recenttracks.track).map(t => ({
        name: t.name,
        artist: (t.artist && (t.artist['#text'] || t.artist.name)) || '',
      })));
    }
    if (top.status === 'fulfilled') {
      const tracks = toArray(top.value.toptracks && top.value.toptracks.track).map(t => ({
        name: t.name,
        artist: (t.artist && t.artist.name) || '',
      }));
      addToQueue(tracks.sort(() => Math.random() - 0.5));
    }
  }

  // When Scott starts a new song mid-drive, play it next
  async function checkLive() {
    try {
      const track = await getLatestTrack();
      if (!track || !track.isPlaying || keyOf(track) === liveKey) return;
      liveKey = keyOf(track);
      queue = queue.filter(t => keyOf(t) !== liveKey);
      played.delete(liveKey);
      const next = current ? queue.indexOf(current) + 1 : 0;
      queue.splice(next, 0, { ...track, live: true });
    } catch (error) {
      console.warn('Radio could not check what is playing:', error);
    }
  }

  // ---- Preview lookup ----

  function normalise(text) {
    return text
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/\(.*?\)|\[.*?\]/g, ' ')
      .replace(/\s-\s.*$/, ' ')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  async function findPreview(track) {
    const key = keyOf(track);
    if (previews.has(key)) return previews.get(key);
    const query = new URLSearchParams({
      term: `${normalise(track.artist)} ${normalise(track.name)}`,
      media: 'music',
      entity: 'song',
      limit: '10',
      country: 'GB',
    });
    let match = null;
    try {
      const response = await fetch(`${ITUNES_SEARCH}?${query}`);
      const data = await response.json();
      const artist = normalise(track.artist);
      const title = normalise(track.name);
      match = (data.results || []).find(r =>
        r.previewUrl &&
        normalise(r.artistName || '').includes(artist) &&
        normalise(r.trackName || '').startsWith(title)
      ) || null;
    } catch (error) {
      console.warn('Radio could not search for a preview:', error);
      return null; // don't cache network failures
    }
    previews.set(key, match);
    return match;
  }

  function nextUnplayed() {
    if (queue.every(t => played.has(keyOf(t)))) played = new Set(); // start the loop again
    const start = current ? queue.indexOf(current) + 1 : 0;
    for (let i = 0; i < queue.length; i++) {
      const track = queue[(start + i) % queue.length];
      if (!played.has(keyOf(track))) return track;
    }
    return null;
  }

  // ---- Audio ----

  function fadeTo(target, seconds) {
    cancelAnimationFrame(fadeFrame);
    const from = audio.volume;
    const start = performance.now();
    return new Promise(resolve => {
      const step = now => {
        const progress = Math.min(1, (now - start) / (seconds * 1000));
        audio.volume = from + (target - from) * progress;
        if (progress < 1) fadeFrame = requestAnimationFrame(step);
        else resolve();
      };
      fadeFrame = requestAnimationFrame(step);
    });
  }

  // A short burst of filtered noise, like tuning between stations
  function playStatic() {
    try {
      audioContext = audioContext || new AudioContext();
      const length = Math.floor(audioContext.sampleRate * STATIC_SECONDS);
      const buffer = audioContext.createBuffer(1, length, audioContext.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
      const source = audioContext.createBufferSource();
      source.buffer = buffer;
      const filter = audioContext.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = 1800;
      const gain = audioContext.createGain();
      const t = audioContext.currentTime;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.08 * volume, t + 0.05);
      gain.gain.linearRampToValueAtTime(0, t + STATIC_SECONDS);
      source.connect(filter).connect(gain).connect(audioContext.destination);
      source.start();
    } catch {
      // Static is decoration; ignore browsers without Web Audio
    }
  }

  async function playNext() {
    if (changing || destroyed) return;
    changing = true;
    try {
      if (!audio.paused) await fadeTo(0, 0.4);
      for (let attempt = 0; attempt < MAX_LOOKUP_ATTEMPTS && on; attempt++) {
        const track = nextUnplayed();
        if (!track) break;
        current = track;
        played.add(keyOf(track));
        show('SB FM · Tuning…', `${track.name} — ${track.artist}`, artEl.src);
        const preview = await findPreview(track);
        if (!preview || !on || destroyed) continue;

        playStatic();
        audio.src = preview.previewUrl;
        audio.volume = 0;
        await audio.play();
        fadeTo(volume, FADE_SECONDS);
        show(
          track.live ? 'SB FM · Scott’s listening now' : 'SB FM · From Scott’s plays',
          `${preview.trackName} — ${preview.artistName}`,
          (preview.artworkUrl100 || '').replace('100x100bb', '300x300bb'),
        );
        sourceLink.href = preview.trackViewUrl || 'https://music.apple.com/';
        return;
      }
      if (on) show('SB FM', 'No previews found tonight', PLACEHOLDER_ART);
    } catch (error) {
      // Browsers block sound until the visitor interacts with the page
      setPower(false);
      show('Radio off', 'Press the power button to listen', PLACEHOLDER_ART);
      if (error.name !== 'NotAllowedError') console.warn('Radio could not play:', error);
    } finally {
      changing = false;
    }
  }

  // Fade out and move on just before each preview ends
  audio.addEventListener('timeupdate', () => {
    if (on && !changing && audio.duration && audio.currentTime > audio.duration - FADE_SECONDS) {
      playNext();
    }
  });
  audio.addEventListener('ended', () => { if (on) playNext(); });

  // ---- Controls ----

  async function toggle() {
    if (on) {
      setPower(false);
      await fadeTo(0, 0.4);
      audio.pause();
      show('Radio off', current ? `${current.name} — ${current.artist}` : 'Press the power button to listen', artEl.src);
    } else {
      setPower(true);
      if (audio.src && current && previews.get(keyOf(current))) {
        await audio.play().catch(() => setPower(false));
        if (on) {
          fadeTo(volume, 0.6);
          show(current.live ? 'SB FM · Scott’s listening now' : 'SB FM · From Scott’s plays', `${current.name} — ${current.artist}`, artEl.src);
        }
      } else {
        playNext();
      }
    }
  }

  function next() {
    if (on) playNext();
  }

  powerButton.addEventListener('click', toggle);
  nextButton.addEventListener('click', next);
  volumeInput.addEventListener('input', () => {
    volume = Number(volumeInput.value);
    if (on && !changing) {
      cancelAnimationFrame(fadeFrame);
      audio.volume = volume;
    }
  });

  const liveTimer = setInterval(checkLive, LIVE_REFRESH_MS);
  show('SB FM', 'Tuning in…', PLACEHOLDER_ART);
  loadPlaylist().then(() => {
    setPower(true);
    playNext();
  });

  function destroy() {
    destroyed = true;
    on = false;
    clearInterval(liveTimer);
    cancelAnimationFrame(fadeFrame);
    audio.pause();
    audio.removeAttribute('src');
    if (audioContext) audioContext.close();
  }

  return { toggle, next, destroy };
}
