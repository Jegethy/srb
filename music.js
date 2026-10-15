// music.js
// Fills the music page with listening data from Last.fm: the current (or most
// recent) track, plus top artists and tracks for the last 30 days.

import { lastfm, toArray, pickImage, getLatestTrack, LASTFM_USER, PLACEHOLDER_ART } from '/lastfm.js';

const TOP_LIST_PERIOD = '1month';
const TOP_LIST_LIMIT = 5;
const IDLE_MESSAGE = "It's all quiet for now…";

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

  let track = null;
  try {
    track = await getLatestTrack();
  } catch (error) {
    console.warn('Could not load recent tracks:', error);
  }

  if (!track) {
    songEl.textContent = IDLE_MESSAGE;
    artistEl.textContent = '';
    return;
  }

  labelEl.textContent = track.isPlaying ? 'Now Playing' : 'Last Played';
  songEl.textContent = track.name;
  artistEl.textContent = track.artist;
  artEl.src = track.art || PLACEHOLDER_ART;
  artEl.alt = `${track.name} cover art`;

  if (!track.name || !track.artist) return;
  try {
    const info = await lastfm('track.getInfo', { artist: track.artist, track: track.name, username: LASTFM_USER });
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
