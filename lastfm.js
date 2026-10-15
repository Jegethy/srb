// lastfm.js
// Shared Last.fm helpers, used by the music page and the night drive radio.
//
// Requests use JSONP (a <script> tag with a `callback` parameter) rather than
// fetch(). Last.fm API keys are designed to be used from the browser; the
// account's shared secret is what must stay private, and it isn't used here.

const LASTFM_API_KEY = '6cc37d0e3b551d58e09ec9e482a4d230';
const LASTFM_API_ROOT = 'https://ws.audioscrobbler.com/2.0/';
const REQUEST_TIMEOUT_MS = 8000;
// Last.fm no longer serves artist photos; every artist image is this grey star.
const LASTFM_PLACEHOLDER_IMAGE_ID = '2a96cbd8b46e442fc41c2b86b821562f';

export const LASTFM_USER = 'Jegethy';
export const PLACEHOLDER_ART = '/assets/images/music/album-placeholder.svg';

let jsonpRequestCount = 0;

/**
 * Calls a Last.fm API method via JSONP and resolves with the parsed response.
 * Rejects on network failure, timeout, or a Last.fm error payload.
 */
export function lastfm(method, params = {}) {
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
export function toArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

// Returns the largest usable image URL from a Last.fm image array, or ''.
export function pickImage(images) {
  const urls = toArray(images)
    .map(image => image['#text'])
    .filter(url => url && !url.includes(LASTFM_PLACEHOLDER_IMAGE_ID));
  const largest = urls[urls.length - 1];
  return largest ? largest.replace(/^http:/, 'https:') : '';
}

/**
 * Resolves with the track currently playing (or most recently played):
 * { name, artist, art, url, isPlaying }, or null if there isn't one.
 */
export async function getLatestTrack() {
  const data = await lastfm('user.getrecenttracks', { user: LASTFM_USER, limit: 1 });
  // While something is playing, it is returned first with a nowplaying flag
  const track = toArray(data.recenttracks && data.recenttracks.track)[0];
  if (!track) return null;
  return {
    name: track.name || '',
    artist: (track.artist && (track.artist['#text'] || track.artist.name)) || '',
    art: pickImage(track.image),
    url: track.url || '',
    isPlaying: Boolean(track['@attr'] && track['@attr'].nowplaying === 'true'),
  };
}
