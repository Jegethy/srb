// music.js
// Fills the music page with listening data from Last.fm: the current (or most
// recent) track, plus top artists and tracks for the last 30 days.
//
// Requests use JSONP (a <script> tag with a `callback` parameter) rather than
// fetch(). Last.fm API keys are designed to be used from the browser; the
// account's shared secret is what must stay private, and it isn't used here.

const LASTFM_API_KEY = '6cc37d0e3b551d58e09ec9e482a4d230';
const LASTFM_USER = 'Jegethy';
const LASTFM_API_ROOT = 'https://ws.audioscrobbler.com/2.0/';
const REQUEST_TIMEOUT_MS = 8000;
const TOP_LIST_PERIOD = '1month';
const TOP_LIST_LIMIT = 5;
const PLACEHOLDER_ART = '/assets/images/music/album-placeholder.svg';
// Last.fm no longer serves artist photos; every artist image is this grey star.
const LASTFM_PLACEHOLDER_IMAGE_ID = '2a96cbd8b46e442fc41c2b86b821562f';
const IDLE_MESSAGE = "It's all quiet for now…";

let jsonpRequestCount = 0;

/**
 * Calls a Last.fm API method via JSONP and resolves with the parsed response.
 * Rejects on network failure, timeout, or a Last.fm error payload.
 */
function lastfm(method, params = {}) {
  return new Promise((resolve, reject) => {
    const callbackName = `lastfmCallback_${Date.now()}_${jsonpRequestCount++}`;
    const query = new URLSearchParams({
      method,
      ...params,
      api_key: LASTFM_API_KEY,
      format: 'json',
      callback: callbackName,
    });
    const script = document.createElement('script');

    function finish(error, data) {
      clearTimeout(timer);
      script.remove();
      if (error) {
        reject(error);
      } else {
        resolve(data);
      }
    }

    const timer = setTimeout(() => {
      // A response arriving after the timeout must still find a function to call
      window[callbackName] = () => delete window[callbackName];
      finish(new Error(`Last.fm ${method} timed out`));
    }, REQUEST_TIMEOUT_MS);

    window[callbackName] = data => {
      delete window[callbackName];
      if (data && data.error) {
        finish(new Error(`Last.fm ${method} error ${data.error}: ${data.message}`));
      } else {
        finish(null, data);
      }
    };
    script.onerror = () => {
      delete window[callbackName];
      finish(new Error(`Last.fm ${method} request failed`));
    };
    script.src = `${LASTFM_API_ROOT}?${query}`;
    document.head.appendChild(script);
  });
}

// Last.fm returns a bare object instead of a one-item array in some responses.
function toArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

// Returns the largest usable image URL from a Last.fm image array, or ''.
function pickImage(images) {
  const urls = toArray(images)
    .map(image => image['#text'])
    .filter(url => url && !url.includes(LASTFM_PLACEHOLDER_IMAGE_ID));
  const largest = urls[urls.length - 1];
  return largest ? largest.replace(/^http:/, 'https:') : '';
}

function createArtwork(alt) {
  const img = document.createElement('img');
  img.src = PLACEHOLDER_ART;
  img.alt = alt;
  img.width = 50;
  img.height = 50;
  img.loading = 'lazy';
  img.decoding = 'async';
  img.referrerPolicy = 'no-referrer';
  return img;
}

function showListMessage(list, message) {
  const li = document.createElement('li');
  li.textContent = message;
  list.replaceChildren(li);
}

async function loadNowPlaying() {
  const labelEl = document.getElementById('now-playing-label');
  const songEl = document.getElementById('now-playing-song');
  const artistEl = document.getElementById('now-playing-artist');
  const playsEl = document.getElementById('now-playing-plays');
  const artEl = document.getElementById('now-playing-art');

  let track;
  try {
    const data = await lastfm('user.getrecenttracks', { user: LASTFM_USER, limit: 1 });
    // While something is playing, it is returned first with a nowplaying flag
    track = toArray(data.recenttracks && data.recenttracks.track)[0];
  } catch (error) {
    console.warn('Could not load recent tracks:', error);
  }

  if (!track) {
    songEl.textContent = IDLE_MESSAGE;
    artistEl.textContent = '';
    return;
  }

  const trackName = track.name || '';
  const artistName = (track.artist && (track.artist['#text'] || track.artist.name)) || '';
  const isPlaying = Boolean(track['@attr'] && track['@attr'].nowplaying === 'true');

  labelEl.textContent = isPlaying ? 'Now Playing' : 'Last Played';
  songEl.textContent = trackName;
  artistEl.textContent = artistName;
  artEl.src = pickImage(track.image) || PLACEHOLDER_ART;
  artEl.alt = `${trackName} cover art`;

  if (!trackName || !artistName) return;
  try {
    const info = await lastfm('track.getInfo', { artist: artistName, track: trackName, username: LASTFM_USER });
    const plays = Number(info.track && info.track.userplaycount);
    if (plays > 0) {
      playsEl.textContent = plays === 1 ? 'Played once' : `Played ${plays.toLocaleString()} times`;
    }
  } catch (error) {
    console.warn('Could not load play count:', error);
  }
}

/**
 * Renders a top-N list. `config` describes how to read one Last.fm list:
 *   method   – the user.getTop* API method
 *   entries  – picks the array of entries out of the response
 *   label    – text shown for an entry
 *   artwork  – resolves to an image URL for an entry ('' if none)
 */
async function loadTopList(listId, config) {
  const list = document.getElementById(listId);
  let entries;
  try {
    const data = await lastfm(config.method, { user: LASTFM_USER, period: TOP_LIST_PERIOD, limit: TOP_LIST_LIMIT });
    entries = toArray(config.entries(data)).slice(0, TOP_LIST_LIMIT);
  } catch (error) {
    console.warn(`Could not load ${listId}:`, error);
    showListMessage(list, 'Unable to load data');
    return;
  }

  if (!entries.length) {
    showListMessage(list, 'No data');
    return;
  }

  list.replaceChildren(...entries.map(entry => {
    const label = config.label(entry);
    const li = document.createElement('li');
    const img = createArtwork(`${label} artwork`);
    const name = document.createElement('span');
    name.textContent = label;
    li.append(img, name);
    // The list endpoints don't include usable artwork, so fetch it per entry
    config.artwork(entry)
      .then(url => { if (url) img.src = url; })
      .catch(() => {});
    return li;
  }));
}

loadNowPlaying();

loadTopList('top-artists-month', {
  method: 'user.gettopartists',
  entries: data => data.topartists && data.topartists.artist,
  label: artist => artist.name,
  // Use the artist's most popular album cover in place of an artist photo
  artwork: artist => lastfm('artist.getTopAlbums', { artist: artist.name, limit: 1 })
    .then(data => {
      const album = toArray(data.topalbums && data.topalbums.album)[0];
      return pickImage(album && album.image);
    }),
});

loadTopList('top-tracks-month', {
  method: 'user.gettoptracks',
  entries: data => data.toptracks && data.toptracks.track,
  label: track => track.name,
  artwork: track => lastfm('track.getInfo', { artist: track.artist ? track.artist.name : '', track: track.name })
    .then(data => pickImage(data.track && data.track.album && data.track.album.image)),
});
