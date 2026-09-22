// Front page: the "Meet the instruments" showcase, where tapping an instrument plays it.

import * as audio from './audio.js';
import { INSTRUMENTS, instrumentById, loadInstruments, tileHtml, animateInstrument } from './instruments.js';

const grid = document.getElementById('showcase');
const mascot = document.querySelector('.hero .mascot');
const reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

grid.innerHTML = INSTRUMENTS.map(tileHtml).join('');
for (const tile of grid.children) {
  // Here the tiles are play buttons, not choices.
  tile.removeAttribute('aria-pressed');
  tile.setAttribute('aria-label', `Play the ${instrumentById(tile.dataset.id).name}`);
}

function play(tile) {
  const inst = instrumentById(tile.dataset.id);
  animateInstrument(tile.querySelector('.inst-art'), tile.querySelector('.pow'), inst, reducedMotion);
  loadInstruments().then((buffers) => audio.play(`showcase:${inst.id}`, buffers.get(inst.id)), () => {});
  if (!reducedMotion && mascot && mascot.animate) {
    mascot.animate(
      [{ transform: 'none' }, { transform: 'translateY(-14%) rotate(-8deg)' }, { transform: 'none' }],
      { duration: 260, easing: 'ease-out' },
    );
  }
}

// Sound starts on touch-down for the quickest response; keyboard presses arrive as clicks.
grid.addEventListener('pointerdown', (e) => {
  const tile = e.target.closest('.inst-tile');
  if (tile && e.button <= 0) play(tile);
});
grid.addEventListener('click', (e) => {
  const tile = e.target.closest('.inst-tile');
  if (tile && e.detail === 0) play(tile);
});

document.addEventListener('touchstart', () => {}, { passive: true }); // lets iOS show :active presses
setTimeout(() => loadInstruments().catch(() => {}), 800);
