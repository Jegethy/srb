// night-drive-radio.js
// The night drive's car radio, "SB FM". It plays 30-second previews of what
// Scott has been listening to on Last.fm: whatever is on right now first,
// then recent plays, then this month's top tracks. Previews come from the
// iTunes Search API, which needs no key.
//
// The radio starts switched off; nothing plays until the visitor presses power.
// Fades run on the Web Audio clock and track changes are driven by the audio
// element's own events, so the radio keeps going while the tab is in the
// background (animation frames and timers are paused or throttled there).

import { lastfm, toArray, getLatestTrack, LASTFM_USER, PLACEHOLDER_ART } from '/lastfm.js';

const ITUNES_SEARCH = 'https://itunes.apple.com/search';
const LIVE_REFRESH_MS = 30000;
const RECENT_LIMIT = 40;
const TOP_LIMIT = 30;
const FADE_SECONDS = 1.2;
const SKIP_FADE_SECONDS = 0.25;
const STATIC_SECONDS = 0.35;
const DEFAULT_VOLUME = 0.6;
const MAX_LOOKUP_ATTEMPTS = 8;

/**
 * Wires up the radio inside `root` (the night drive overlay). Returns
 * controls for keyboard shortcuts and cleanup.
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
  // Previews are served with CORS headers, which Web Audio needs to hear them
  audio.crossOrigin = 'anonymous';
  audio.preload = 'auto';
  const silence = silentWavUrl();

  const previews = new Map(); // track key -> iTunes result, or null if not found
  let queue = [];
  let played = new Set();
  let current = null;
  let live = null; // Scott's latest Last.fm track, shown while the radio is off
  let on = false;
  let volume = DEFAULT_VOLUME;
  let changing = false;
  let fadingOut = false;
  let destroyed = false;
  let audioContext = null;
  let fadeGain = null;
  let volumeGain = null;

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

  function showOff() {
    if (live) {
      show(live.isPlaying ? 'Radio off · Scott’s listening to' : 'Radio off · Scott last played', `${live.name} — ${live.artist}`, live.art);
    } else {
      show('Radio off', 'Press power to tune in', PLACEHOLDER_ART);
    }
  }

  function showPlaying(track, preview) {
    show(
      track.live ? 'SB FM · Scott’s listening now' : 'SB FM · From Scott’s plays',
      `${preview.trackName} — ${preview.artistName}`,
      (preview.artworkUrl100 || '').replace('100x100bb', '300x300bb'),
    );
    sourceLink.href = preview.trackViewUrl || 'https://music.apple.com/';
  }

  function setPower(state) {
    on = state;
    powerButton.setAttribute('aria-pressed', String(on));
    root.classList.toggle('nd-radio-on', on);
  }

  // ---- Playlist ----

  const keyOf = track => `${track.artist}|${track.name}`.toLowerCase();

  function addToQueue(tracks) {
    const known = new Set(queue.map(keyOf));
    queue = [...queue, ...tracks.filter(t => t.name && t.artist && !known.has(keyOf(t)) && known.add(keyOf(t)))];
  }

  async function loadPlaylist() {
    const [latest, recent, top] = await Promise.allSettled([
      getLatestTrack(),
      lastfm('user.getrecenttracks', { user: LASTFM_USER, limit: RECENT_LIMIT }),
      lastfm('user.gettoptracks', { user: LASTFM_USER, period: '1month', limit: TOP_LIMIT }),
    ]);
    if (latest.status === 'fulfilled' && latest.value) {
      live = latest.value;
      addToQueue([{ ...live, live: live.isPlaying }]);
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
    let track = null;
    try {
      track = await getLatestTrack();
    } catch (error) {
      console.warn('Radio could not check what is playing:', error);
      return;
    }
    if (!track) return;
    const changed = !live || keyOf(track) !== keyOf(live);
    live = track;
    if (!changed) return;
    if (track.isPlaying) {
      const key = keyOf(track);
      queue = queue.filter(t => keyOf(t) !== key);
      played.delete(key);
      queue.splice(current ? queue.indexOf(current) + 1 : 0, 0, { ...track, live: true });
    }
    if (!on) showOff();
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

  // Look up the following track while this one plays, so the change is quick
  function prefetchNext() {
    const upcoming = nextUnplayed();
    if (upcoming) findPreview(upcoming);
  }

  // ---- Audio ----

  // Built on the first press of the power button, which browsers require
  function ensureAudioGraph() {
    if (!audioContext) {
      try {
        audioContext = new AudioContext();
        fadeGain = audioContext.createGain();
        volumeGain = audioContext.createGain();
        volumeGain.gain.value = volume;
        audioContext.createMediaElementSource(audio).connect(fadeGain).connect(volumeGain).connect(audioContext.destination);
      } catch (error) {
        console.warn('Radio is falling back to plain audio:', error);
        audioContext = null;
      }
    }
    if (audioContext && audioContext.state === 'suspended') audioContext.resume();
  }

  // Ramps the fade level (0–1). These run on the audio clock, not the page's timers.
  function fade(to, seconds) {
    if (!audioContext) {
      audio.volume = to * volume;
      return;
    }
    const gain = fadeGain.gain;
    const now = audioContext.currentTime;
    gain.cancelScheduledValues(now);
    if (seconds <= 0) {
      gain.setValueAtTime(to, now);
    } else {
      gain.setValueAtTime(gain.value, now);
      gain.linearRampToValueAtTime(to, now + seconds);
    }
  }

  // A short burst of filtered noise, like tuning between stations
  function playStatic() {
    if (!audioContext) return;
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
    gain.gain.linearRampToValueAtTime(0.08, t + 0.05);
    gain.gain.linearRampToValueAtTime(0, t + STATIC_SECONDS);
    source.connect(filter).connect(gain).connect(volumeGain);
    source.start();
  }

  async function playNext() {
    if (changing || destroyed || !on) return;
    changing = true;
    fadingOut = false;
    try {
      for (let attempt = 0; attempt < MAX_LOOKUP_ATTEMPTS; attempt++) {
        const track = nextUnplayed();
        if (!track) break;
        current = track;
        played.add(keyOf(track));
        show('SB FM · Tuning…', `${track.name} — ${track.artist}`, artEl.src);
        const preview = await findPreview(track);
        if (!on || destroyed) return;
        if (!preview) continue;

        playStatic();
        fade(0, 0);
        audio.src = preview.previewUrl;
        try {
          await audio.play();
        } catch (error) {
          if (error.name === 'NotAllowedError') throw error;
          console.warn('Radio skipped a preview that would not play:', error);
          continue;
        }
        fade(1, FADE_SECONDS);
        showPlaying(track, preview);
        prefetchNext();
        return;
      }
      if (on) show('SB FM', 'No previews found tonight', PLACEHOLDER_ART);
    } catch (error) {
      // The browser blocked sound; wait for the visitor to press power again
      setPower(false);
      showOff();
      if (error.name !== 'NotAllowedError') console.warn('Radio could not play:', error);
    } finally {
      changing = false;
    }
  }

  // Start fading out as each preview nears its end, then move on when it finishes
  audio.addEventListener('timeupdate', () => {
    if (on && !changing && !fadingOut && audio.duration && audio.currentTime > audio.duration - FADE_SECONDS) {
      fadingOut = true;
      fade(0, Math.max(0.1, audio.duration - audio.currentTime));
    }
  });
  audio.addEventListener('ended', () => {
    if (on && audio.src !== silence) playNext();
  });

  // ---- Controls ----

  function toggle() {
    if (on) {
      setPower(false);
      fade(0, 0.3);
      setTimeout(() => { if (!on) audio.pause(); }, 300);
      showOff();
      return;
    }
    setPower(true);
    ensureAudioGraph();
    const canResume = current && previews.get(keyOf(current)) && audio.src && audio.src !== silence &&
      audio.currentTime < audio.duration - FADE_SECONDS;
    if (canResume) {
      audio.play().then(() => {
        fade(1, 0.6);
        showPlaying(current, previews.get(keyOf(current)));
      }).catch(() => {
        setPower(false);
        showOff();
      });
      return;
    }
    // Some browsers (Safari) only allow sound started directly by a click.
    // Playing a moment of silence now unlocks the player for every track after.
    audio.src = silence;
    audio.play().catch(() => {});
    playNext();
  }

  function next() {
    if (!on || changing) return;
    fade(0, SKIP_FADE_SECONDS);
    setTimeout(playNext, SKIP_FADE_SECONDS * 1000);
  }

  powerButton.addEventListener('click', toggle);
  nextButton.addEventListener('click', next);
  volumeInput.addEventListener('input', () => {
    volume = Number(volumeInput.value);
    if (volumeGain) {
      volumeGain.gain.setTargetAtTime(volume, audioContext.currentTime, 0.05);
    } else if (on) {
      audio.volume = volume;
    }
  });

  setPower(false);
  showOff();
  const liveTimer = setInterval(checkLive, LIVE_REFRESH_MS);
  loadPlaylist().then(() => {
    if (destroyed) return;
    if (!on) showOff();
    // Have the first song ready for when the visitor presses power
    if (queue.length) findPreview(queue[0]);
  });

  function destroy() {
    destroyed = true;
    on = false;
    clearInterval(liveTimer);
    audio.pause();
    audio.removeAttribute('src');
    URL.revokeObjectURL(silence);
    if (audioContext) audioContext.close();
  }

  return { toggle, next, destroy };
}

// A tenth of a second of silence as a WAV file, used to unlock audio playback
function silentWavUrl() {
  const sampleRate = 8000;
  const samples = 800;
  const buffer = new ArrayBuffer(44 + samples * 2);
  const view = new DataView(buffer);
  const text = (offset, value) => [...value].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  text(0, 'RIFF');
  view.setUint32(4, 36 + samples * 2, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, samples * 2, true);
  return URL.createObjectURL(new Blob([buffer], { type: 'audio/wav' }));
}
