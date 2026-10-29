// Ícones de manobra em SVG inline (stroke = currentColor).
const ARROW = 'M12 20V5M6 11l6-6 6 6';
const BEND = 'M7 21v-7a4 4 0 0 1 4-4h8M15 6l4 4-4 4';
const body = {
  depart: `<circle cx="12" cy="19" r="2" fill="currentColor" stroke="none"/><path d="M12 15V5M6 10l6-6 6 6"/>`,
  continue: `<path d="${ARROW}"/>`,
  'slight-right': `<g transform="rotate(40 12 12)"><path d="${ARROW}"/></g>`,
  'slight-left': `<g transform="rotate(-40 12 12)"><path d="${ARROW}"/></g>`,
  right: `<path d="${BEND}"/>`,
  left: `<g transform="translate(24 0) scale(-1 1)"><path d="${BEND}"/></g>`,
  'sharp-right': `<g transform="rotate(140 12 12)"><path d="${ARROW}"/></g>`,
  'sharp-left': `<g transform="rotate(-140 12 12)"><path d="${ARROW}"/></g>`,
  uturn: `<path d="M7 21V10a5 5 0 0 1 10 0v8M13 14l4 4 4-4"/>`,
  waypoint: `<path d="M6 21V4M6 5h11l-2.5 4L17 13H6"/>`,
  arrive: `<path d="M12 21s-6-5.5-6-10a6 6 0 0 1 12 0c0 4.5-6 10-6 10z"/><circle cx="12" cy="11" r="2"/>`,
};
export function maneuverIcon(m, size = 24) {
  return `<svg class="mi" viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${body[m] || body.continue}</svg>`;
}
