// main.js
// Minimal vanilla JavaScript to handle interactive parts of the site.
// Loaded with `defer`, so the DOM is ready when this runs.

// Mobile navigation toggle
const hamburger = document.querySelector('.hamburger');
const nav = document.querySelector('.nav');
if (hamburger && nav) {
  const setMenuOpen = open => {
    nav.classList.toggle('active', open);
    hamburger.setAttribute('aria-expanded', String(open));
  };
  hamburger.addEventListener('click', () => {
    setMenuOpen(!nav.classList.contains('active'));
  });
  // Close the menu when a navigation link is clicked or Escape is pressed
  nav.querySelectorAll('a').forEach(link => {
    link.addEventListener('click', () => setMenuOpen(false));
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && nav.classList.contains('active')) {
      setMenuOpen(false);
      hamburger.focus();
    }
  });
}

// Keep the footer copyright year current
document.querySelectorAll('.year').forEach(el => {
  el.textContent = new Date().getFullYear();
});

// Night drive: loaded only when someone starts one. It can be started from a
// [data-night-drive] button, by typing "drive", or by linking to the page with #drive.
function startNightDrive(trigger) {
  import('/night-drive.js')
    .then(module => module.startNightDrive(trigger))
    .catch(error => console.error('Could not start the night drive:', error));
}

document.querySelectorAll('[data-night-drive]').forEach(button => {
  button.addEventListener('click', () => startNightDrive(button));
});

if (location.hash === '#drive') startNightDrive(null);

const SECRET_WORD = 'drive';
let typed = '';
document.addEventListener('keydown', e => {
  if (e.ctrlKey || e.metaKey || e.altKey || e.key.length !== 1) return;
  if (e.target.closest('input, textarea, [contenteditable]')) return;
  typed = (typed + e.key.toLowerCase()).slice(-SECRET_WORD.length);
  if (typed === SECRET_WORD) {
    typed = '';
    startNightDrive(null);
  }
});

// Rabbit hole: a random walk through Wikipedia, loaded on first use
document.querySelectorAll('[data-rabbit-hole]').forEach(link => {
  link.addEventListener('click', e => {
    e.preventDefault();
    import('/rabbit-hole.js')
      .then(module => module.openRabbitHole(link))
      .catch(() => window.open(link.href, '_blank', 'noopener'));
  });
});

// Populate gallery grid dynamically if it exists
const gallery = document.querySelector('.gallery-grid');
if (gallery) {
  // The block between the gallery-items markers is rewritten by instagram_sync.py.
  // gallery-items:start
  const items = [
    { src: '/assets/images/gallery/images/gallery1.jpg', url: 'https://www.instagram.com/scottrblackmore/', alt: 'Gallery image 1' },
    { src: '/assets/images/gallery/images/gallery2.jpg', url: 'https://www.instagram.com/scottrblackmore/', alt: 'Gallery image 2' },
    { src: '/assets/images/gallery/images/gallery3.jpg', url: 'https://www.instagram.com/scottrblackmore/', alt: 'Gallery image 3' },
    { src: '/assets/images/gallery/images/gallery4.jpg', url: 'https://www.instagram.com/scottrblackmore/', alt: 'Gallery image 4' },
    { src: '/assets/images/gallery/images/gallery5.jpg', url: 'https://www.instagram.com/scottrblackmore/', alt: 'Gallery image 5' },
    { src: '/assets/images/gallery/images/gallery6.jpg', url: 'https://www.instagram.com/scottrblackmore/', alt: 'Gallery image 6' },
    { src: '/assets/images/gallery/images/gallery7.jpg', url: 'https://www.instagram.com/scottrblackmore/', alt: 'Gallery image 7' },
    { src: '/assets/images/gallery/images/gallery8.jpg', url: 'https://www.instagram.com/scottrblackmore/', alt: 'Gallery image 8' },
    { src: '/assets/images/gallery/images/gallery9.jpg', url: 'https://www.instagram.com/scottrblackmore/', alt: 'Gallery image 9' },
  ];
  // gallery-items:end

  // Only tilt for mouse users who haven't asked for reduced motion
  const allowTilt = window.matchMedia('(hover: hover) and (prefers-reduced-motion: no-preference)').matches;

  items.forEach(item => {
    const anchor = document.createElement('a');
    anchor.href = item.url;
    anchor.target = '_blank';
    anchor.rel = 'noopener noreferrer';
    const img = document.createElement('img');
    img.src = item.src;
    img.alt = item.alt || 'Gallery image';
    img.decoding = 'async';
    anchor.appendChild(img);
    gallery.appendChild(anchor);

    if (!allowTilt) return;
    // Add a subtle parallax tilt effect on mouse movement
    anchor.addEventListener('mousemove', e => {
      const rect = anchor.getBoundingClientRect();
      // Normalised coordinates between -0.5 and 0.5
      const x = (e.clientX - rect.left) / rect.width - 0.5;
      const y = (e.clientY - rect.top) / rect.height - 0.5;
      const tiltX = y * -10; // rotateX based on vertical position
      const tiltY = x * 10;  // rotateY based on horizontal position
      img.style.transform = `rotateX(${tiltX}deg) rotateY(${tiltY}deg) scale(1.08)`;
    });
    anchor.addEventListener('mouseleave', () => {
      img.style.transform = '';
    });
  });
}
