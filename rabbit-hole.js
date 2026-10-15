// rabbit-hole.js
// A small card that starts on a random Wikipedia article; "Go deeper" follows
// a random link out of the current article. Loaded on demand by main.js when a
// [data-rabbit-hole] link is clicked.

const WIKI_API = 'https://en.wikipedia.org/w/api.php';
const WIKI_REST = 'https://en.wikipedia.org/api/rest_v1';
const MAX_LINK_ATTEMPTS = 4;
const TRAIL_LENGTH = 4;

// Commentary for how far down the hole the visitor has gone
const DEPTH_REMARKS = [
  [12, 'Twelve deep. This is how it happens.'],
  [8, 'It’s 2am, isn’t it?'],
  [5, 'You were supposed to be doing something else.'],
  [3, 'Just one more.'],
];

let card = null;
let lastTrigger = null;
let trail = [];
let busy = false;

export function openRabbitHole(trigger) {
  lastTrigger = trigger;
  if (!card) card = createCard();
  card.hidden = false;
  card.querySelector('.rabbit-hole-close').focus();
  if (!trail.length) dig(null);
}

function createCard() {
  const el = document.createElement('aside');
  el.className = 'rabbit-hole';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', 'Wikipedia rabbit hole');
  el.innerHTML = `
    <div class="rabbit-hole-header">
      <p class="rabbit-hole-depth">Down the rabbit hole</p>
      <button class="rabbit-hole-close" type="button" aria-label="Climb out">✕</button>
    </div>
    <div class="rabbit-hole-body" aria-live="polite">
      <p class="rabbit-hole-status">Falling…</p>
    </div>
    <p class="rabbit-hole-trail"></p>
    <div class="rabbit-hole-actions">
      <a class="rabbit-hole-read" href="https://en.wikipedia.org/" target="_blank" rel="noopener">Read on Wikipedia</a>
      <button class="rabbit-hole-deeper" type="button">Go deeper ↓</button>
    </div>
  `;
  document.body.appendChild(el);

  const close = () => {
    el.hidden = true;
    if (lastTrigger && document.contains(lastTrigger)) lastTrigger.focus();
  };
  el.querySelector('.rabbit-hole-close').addEventListener('click', close);
  el.querySelector('.rabbit-hole-deeper').addEventListener('click', () => {
    dig(trail[trail.length - 1] || null);
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !el.hidden) close();
  });
  return el;
}

async function getJson(url) {
  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`${response.status} for ${url}`);
  return response.json();
}

function summaryUrl(title) {
  return `${WIKI_REST}/page/summary/${encodeURIComponent(title.replace(/ /g, '_'))}`;
}

// Article links from a page, excluding lists, dates and other dead ends
async function linksFrom(title) {
  const query = new URLSearchParams({
    action: 'query',
    format: 'json',
    origin: '*',
    prop: 'links',
    titles: title,
    plnamespace: '0',
    pllimit: 'max',
    redirects: '1',
  });
  const data = await getJson(`${WIKI_API}?${query}`);
  const pages = Object.values((data.query && data.query.pages) || {});
  const links = (pages[0] && pages[0].links) || [];
  return links
    .map(link => link.title)
    .filter(t => !/^(List of|Lists of|\d{1,4}$|\d{1,4} in |ISBN|Doi|Wayback Machine)/i.test(t));
}

async function nextArticle(from) {
  if (from) {
    try {
      const links = await linksFrom(from.title);
      for (let attempt = 0; attempt < MAX_LINK_ATTEMPTS && links.length; attempt++) {
        const pick = links.splice(Math.floor(Math.random() * links.length), 1)[0];
        const summary = await getJson(summaryUrl(pick)).catch(() => null);
        if (summary && summary.type === 'standard' && summary.extract) return summary;
      }
    } catch (error) {
      console.warn('Rabbit hole could not follow a link:', error);
    }
  }
  // Start (or restart) somewhere random
  for (let attempt = 0; attempt < MAX_LINK_ATTEMPTS; attempt++) {
    const summary = await getJson(`${WIKI_REST}/page/random/summary`);
    if (summary.type === 'standard' && summary.extract) return summary;
  }
  throw new Error('No suitable article found');
}

async function dig(from) {
  if (busy) return;
  busy = true;
  const body = card.querySelector('.rabbit-hole-body');
  const deeper = card.querySelector('.rabbit-hole-deeper');
  deeper.setAttribute('aria-disabled', 'true');
  body.classList.add('is-loading');

  try {
    const article = await nextArticle(from);
    trail.push({ title: article.title });
    render(article);
  } catch (error) {
    console.warn('Rabbit hole failed:', error);
    const p = document.createElement('p');
    p.className = 'rabbit-hole-status';
    p.textContent = 'The hole caved in. Try again in a moment.';
    body.replaceChildren(p);
  } finally {
    busy = false;
    deeper.removeAttribute('aria-disabled');
    body.classList.remove('is-loading');
  }
}

function render(article) {
  const depth = trail.length;
  const remark = DEPTH_REMARKS.find(([min]) => depth >= min);
  card.querySelector('.rabbit-hole-depth').textContent =
    depth === 1 ? 'Down the rabbit hole' : `${depth} articles deep${remark ? ` · ${remark[1]}` : ''}`;

  const title = document.createElement('h3');
  title.className = 'rabbit-hole-title';
  title.textContent = article.title;

  const extract = document.createElement('p');
  extract.className = 'rabbit-hole-extract';
  extract.textContent = article.extract;

  const nodes = [title];
  if (article.thumbnail && article.thumbnail.source) {
    const img = document.createElement('img');
    img.className = 'rabbit-hole-thumb';
    img.src = article.thumbnail.source;
    img.alt = '';
    img.loading = 'lazy';
    img.decoding = 'async';
    nodes.push(img);
  }
  nodes.push(extract);
  card.querySelector('.rabbit-hole-body').replaceChildren(...nodes);

  const pageUrl = article.content_urls && article.content_urls.desktop && article.content_urls.desktop.page;
  card.querySelector('.rabbit-hole-read').href = pageUrl || `https://en.wikipedia.org/wiki/${encodeURIComponent(article.title)}`;

  const recent = trail.slice(-TRAIL_LENGTH).map(step => step.title);
  card.querySelector('.rabbit-hole-trail').textContent =
    depth > 1 ? `${depth > TRAIL_LENGTH ? '… → ' : ''}${recent.join(' → ')}` : '';
}
