// main.js
// Minimal vanilla JavaScript to handle interactive parts of the site.

document.addEventListener('DOMContentLoaded', () => {
  // Mobile navigation toggle
  const hamburger = document.querySelector('.hamburger');
  const nav = document.querySelector('.nav');
  if (hamburger && nav) {
    hamburger.addEventListener('click', () => {
      nav.classList.toggle('active');
    });
    // Close the menu when a navigation link is clicked (useful on mobile)
    nav.querySelectorAll('a').forEach(link => {
      link.addEventListener('click', () => {
        nav.classList.remove('active');
      });
    });
  }

  // Populate gallery grid dynamically if it exists
  const gallery = document.querySelector('.gallery-grid');
  if (gallery) {
    // When this script runs in pages (e.g. pages/gallery.html), the images
    // should be referenced relative to the page, not the site root. Use
    // `../assets/...` to account for the additional directory level.
    const items = [
      { src: '../assets/images/gallery/images/gallery1.jpg', url: 'https://instagram.com/' },
      { src: '../assets/images/gallery/images/gallery2.jpg', url: 'https://instagram.com/' },
      { src: '../assets/images/gallery/images/gallery3.jpg', url: 'https://instagram.com/' },
      { src: '../assets/images/gallery/images/gallery4.jpg', url: 'https://instagram.com/' },
      { src: '../assets/images/gallery/images/gallery5.jpg', url: 'https://instagram.com/' },
      { src: '../assets/images/gallery/images/gallery6.jpg', url: 'https://instagram.com/' },
      { src: '../assets/images/gallery/images/gallery7.jpg', url: 'https://instagram.com/' },
      { src: '../assets/images/gallery/images/gallery8.jpg', url: 'https://instagram.com/' },
      { src: '../assets/images/gallery/images/gallery9.jpg', url: 'https://instagram.com/' },
    ];
    items.forEach(item => {
      const anchor = document.createElement('a');
      anchor.href = item.url;
      anchor.target = '_blank';
      anchor.rel = 'noopener noreferrer';
      const img = document.createElement('img');
      img.src = item.src;
      img.alt = 'Gallery image';
      anchor.appendChild(img);
      gallery.appendChild(anchor);
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
        img.style.transform = 'none';
      });
    });
  }
});