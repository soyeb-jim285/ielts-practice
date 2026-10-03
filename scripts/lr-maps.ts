// Hand-drawn site plans / floor plans for Listening Part 2 map questions (SVG -> PNG via rsvg-convert).
// Each map: printed landmarks, lettered (unnamed) locations, a fact sheet the script writer must respect,
// and the asked locations in the order the speaker describes them. Add new maps here for new tests.
export interface LrMap {
  id: string;
  kind: 'map' | 'plan';
  title: string;
  /** all lettered locations A.. shown on the picture */
  letters: string[];
  /** asked locations, in speaking order: [letter, name the question shows] */
  asked: [string, string][];
  /** plain-text description handed to the script writer: orientation, printed names, true position of every letter */
  facts: string;
  svg: string;
}

const FONT = 'font-family="DejaVu Sans, Arial, sans-serif"';
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const wrap = (title: string, body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="660" viewBox="0 0 900 660" ${FONT}><rect width="900" height="660" fill="#fff"/>` +
  `<text x="450" y="26" font-size="22" font-weight="700" text-anchor="middle" fill="#111">${esc(title)}</text>${body}</svg>`;
const txt = (x: number, y: number, s: string, size = 15, extra = '') => `<text x="${x}" y="${y}" font-size="${size}" text-anchor="middle" fill="#222" ${extra}>${esc(s)}</text>`;
/** lettered, unnamed location */
const L = (x: number, y: number, w: number, h: number, letter: string, fill = '#fff') =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}" stroke="#222" stroke-width="2.5"/>` +
  `<text x="${x + w / 2}" y="${y + h / 2 + 11}" font-size="32" font-weight="700" text-anchor="middle" fill="#111">${letter}</text>`;
/** printed (named) place */
const N = (x: number, y: number, w: number, h: number, name: string, fill = '#e8e8e8') =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}" stroke="#222" stroke-width="2.5"/>` +
  name.split('\n').map((s, i, a) => txt(x + w / 2, y + h / 2 + 5 + (i - (a.length - 1) / 2) * 18, s, 15, 'font-weight="700"')).join('');
const path = (d: string, w = 14) => `<path d="${d}" fill="none" stroke="#c9c1a8" stroke-width="${w}" stroke-linecap="butt" stroke-linejoin="round"/>`;
const road = (x: number, y: number, w: number, h: number, name: string, vertical = false) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#bdbdbd"/>` +
  (vertical ? `<text transform="translate(${x + w / 2 + 5},${y + h / 2}) rotate(-90)" font-size="15" text-anchor="middle" fill="#222" font-weight="700">${esc(name)}</text>` : txt(x + w / 2, y + h / 2 + 5, name, 15, 'font-weight="700"'));
const grass = (x: number, y: number, w: number, h: number) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="14" fill="#dbe8c8"/>`;
const tree = (x: number, y: number) => `<circle cx="${x}" cy="${y}" r="11" fill="#9ac07a" stroke="#5f8a45" stroke-width="1.5"/>`;
const arrowUp = (x: number, y: number) => `<path d="M ${x - 12} ${y + 14} L ${x} ${y} L ${x + 12} ${y + 14} Z" fill="#111"/>`;

// ---------------------------------------------------------------- Millbrook Heritage Museum (site map, entrance at the bottom)
const millbrook: LrMap = {
  id: 'millbrook',
  kind: 'map',
  title: 'Millbrook Heritage Museum: site map',
  letters: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'],
  asked: [['A', 'Gift shop'], ['B', 'Café'], ['G', 'Herb garden'], ['F', 'Education room'], ['E', 'Old mill']],
  facts: `Orientation: the visitor enters at the ENTRANCE at the bottom (south) of the plan from Mill Lane and walks north up the main path. "Left" = west, "right" = east as the visitor walks north.
Printed on the plan: ENTRANCE (bottom centre), MILL LANE (road along the bottom), CAR PARK (bottom left, west of the entrance, reached from the lane), MUSEUM HALL (large building at the top centre, the main path ends at its door), the RIVER (runs down the whole right-hand side), a footbridge over the river, the paved COURTYARD in the middle.
Lettered locations (names are NOT printed; the speaker must give the name of each asked one and its position):
A = Gift shop: immediately inside the entrance, on the right of the main path.
B = Café: immediately inside the entrance, on the left of the main path, opposite A and next to the car park.
C = Workshop (not asked, never mention): on the left (west) side of the courtyard.
H = Toilets (not asked, never mention): on the right (east) side of the courtyard.
G = Herb garden: a green garden just to the west (left) of the Museum Hall, reached by a short path from the main path.
D = Storage building (not asked, never mention): top left corner, behind the herb garden.
F = Education room: a small building just to the east (right) of the Museum Hall, at the end of a side path.
E = Old mill: beside the river on the right, reached by a side path that leaves the main path just north of the courtyard and heads east; it is lower down (south of) the Education room and above (north of) the footbridge.`,
  svg: wrap(
    'Millbrook Heritage Museum: site map',
    grass(40, 40, 700, 500) +
      `<rect x="780" y="40" width="70" height="520" fill="#a9cfe8"/>` + txt(815, 300, 'RIVER', 15, 'font-weight="700" transform="rotate(-90 815 300)"') +
      `<rect x="770" y="395" width="90" height="24" fill="#d9d2b8" stroke="#222" stroke-width="2"/>` + txt(815, 388, 'footbridge', 12) +
      road(0, 560, 300, 56, 'MILL LANE') + road(300, 560, 600, 56, '') +
      path('M450 560 V 200 M450 495 H 480 M450 495 H 420 M290 355 H 330 M570 355 H 600 M570 408 H 770 M450 262 H 700 M670 262 V 190 M450 245 H 235 V 220') +
      `<rect x="330" y="300" width="240" height="120" fill="#e9e2d0" stroke="#222" stroke-width="2"/>` + txt(450, 318, 'COURTYARD', 13) +
      N(60, 470, 250, 70, 'CAR PARK', '#e4e4ee') +
      L(335, 455, 85, 68, 'B') + L(480, 455, 90, 68, 'A') +
      L(190, 320, 100, 70, 'C') + L(600, 320, 95, 70, 'H') +
      N(320, 90, 260, 110, 'MUSEUM HALL', '#f0e0c8') +
      L(120, 130, 170, 90, 'G', '#c6e0a8') + L(60, 50, 100, 55, 'D') +
      L(620, 100, 100, 90, 'F') + L(690, 235, 85, 65, 'E') +
      tree(90, 260) + tree(120, 400) + tree(740, 130) + tree(600, 230) + tree(380, 230) +
      arrowUp(450, 524) + txt(560, 594, 'ENTRANCE', 17, 'font-weight="700"') + `<path d="M520 588 H 462" stroke="#111" stroke-width="2"/>`,
  ),
};

// ---------------------------------------------------------------- Home Farm Park (site map, entrance on the left)
const farm: LrMap = {
  id: 'farm',
  kind: 'map',
  title: 'Home Farm Park: visitor map',
  letters: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'],
  asked: [['A', 'Pig sheds'], ['B', 'Tea room'], ['C', 'Orchard'], ['H', 'Tractor shelter'], ['E', 'Play area']],
  facts: `Orientation: the visitor enters at the ENTRANCE on the left (west) of the plan from Farm Road and walks east along the main path; "left" = north, "right" = south while walking east.
Printed on the plan: ENTRANCE (left edge), FARM ROAD (road down the left edge), CAR PARK (bottom left, south of the entrance), MAIN BARN (centre, the main path ends at its west door), POND (centre right, south-east of the barn).
Lettered locations (names are NOT printed; the speaker must give the name of each asked one and its position):
A = Pig sheds: just inside the entrance, on the left (north) side of the main path.
B = Tea room: just inside the entrance, on the right (south) side of the main path, opposite A.
At the Main Barn the path forks: one path goes north, one goes south.
C = Orchard: reached by the north path, at its end, north of the Main Barn.
D = Lambing shed (not asked, never mention): east of the Main Barn, north of the pond.
G = Sheep field (not asked, never mention): large field on the far right (east).
H = Tractor shelter: at the end of the south path, south of the Main Barn.
E = Play area: beyond the Tractor shelter, further east along the path, south of the pond.`,
  svg: wrap(
    'Home Farm Park: visitor map',
    grass(70, 50, 790, 450) +
      road(0, 40, 50, 560, '', true) + txt(0, 0, 'FARM ROAD', 15, 'font-weight="700" transform="translate(32,520) rotate(-90)"') +
      `<ellipse cx="620" cy="400" rx="85" ry="50" fill="#a9cfe8" stroke="#4d8fb8" stroke-width="2"/>` + txt(620, 405, 'POND', 15, 'font-weight="700"') +
      path('M50 330 H 330 M305 330 V 120 H 330 M305 330 V 520 H 330 M440 520 H 500') +
      N(60, 520, 200, 80, 'CAR PARK', '#e4e4ee') +
      L(100, 235, 120, 70, 'A') + L(100, 355, 120, 70, 'B') +
      N(330, 260, 170, 130, 'MAIN BARN', '#f0e0c8') +
      L(335, 60, 200, 110, 'C', '#c6e0a8') + tree(360, 80) + tree(420, 150) + tree(500, 80) + tree(470, 130) +
      L(570, 230, 110, 70, 'D') + L(330, 485, 110, 70, 'H') + L(500, 490, 150, 90, 'E', '#f2e2b8') +
      `<rect x="715" y="110" width="130" height="200" fill="#c6e0a8" stroke="#222" stroke-width="2.5" stroke-dasharray="8 5"/>` +
      txt(780, 220, 'G', 32, 'font-weight="700"') +
      arrowUp(0, 0).replace(/.*/, '') + `<path d="M12 345 L 50 330 L 12 315 Z" fill="#111"/>` + txt(100, 336, 'ENTRANCE', 15, 'font-weight="700"'),
  ),
};

// ---------------------------------------------------------------- Town library, ground floor plan (entrance at the bottom)
const library: LrMap = {
  id: 'library',
  kind: 'plan',
  title: 'Hollin Town Library: ground floor',
  letters: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'],
  asked: [['A', "Children's area"], ['B', 'Café'], ['D', 'Computer room'], ['E', 'Local history room'], ['F', 'Quiet study area'], ['H', 'Music and DVD room']],
  facts: `Orientation: floor plan; the visitor enters through the ENTRANCE at the bottom (south) and stands in the RECEPTION hall. "Front" = near the entrance, "back" = far from the entrance (top of the plan); left = west, right = east for a visitor facing the back.
Printed on the plan: ENTRANCE (bottom centre), RECEPTION (the entrance hall, bottom centre), TOILETS (bottom left corner), MAIN LENDING LIBRARY (the big open hall in the middle, directly behind reception).
Front row, left to right: TOILETS (printed), A, RECEPTION (printed), B, C.
A = Children's area: immediately left of reception, next to the toilets.
B = Café: immediately right of reception.
C = Meeting room (not asked, never mention): front right corner, next to the café.
Middle row, left to right: D, MAIN LENDING LIBRARY (printed), E.
D = Computer room: middle row, left side of the Main lending library, directly behind (north of) the Children's area.
E = Local history room: middle row, right side of the Main lending library, directly behind the Café and meeting room.
Back row, left to right: F, G, H, I.
F = Quiet study area: back left corner, directly behind the Computer room.
G = Magazine area (not asked, never mention): back row, second from the left, between F and H.
H = Music and DVD room: back row, third from the left, next to G and left of the staff room.
I = Staff room (not asked, never mention): back right corner.`,
  svg: wrap(
    'Hollin Town Library: ground floor',
    `<rect x="60" y="50" width="780" height="540" fill="#fafaf5" stroke="#111" stroke-width="5"/>` +
      // back row
      L(70, 60, 170, 190, 'F') + L(250, 60, 190, 190, 'G') + L(450, 60, 190, 190, 'H') + L(650, 60, 180, 190, 'I') +
      // middle row
      L(70, 270, 190, 140, 'D') + N(270, 270, 330, 140, 'MAIN LENDING\nLIBRARY', '#f0ecd8') + L(610, 270, 220, 140, 'E') +
      // front row
      N(70, 430, 100, 150, 'TOILETS', '#e8e8e8') + L(180, 430, 130, 150, 'A') + N(320, 430, 260, 150, 'RECEPTION', '#f0ecd8') + L(590, 430, 120, 150, 'B') + L(720, 430, 110, 150, 'C') +
      // doors (white gaps in the walls)
      [[150, 248], [330, 248], [520, 248], [720, 248], [110, 408], [680, 408], [230, 428], [610, 428], [740, 428], [100, 428]].map(([x, y]) => `<rect x="${x}" y="${y! - 3}" width="36" height="9" fill="#fafaf5"/>`).join('') +
      `<rect x="400" y="586" width="100" height="10" fill="#fafaf5"/>` +
      `<path d="M450 640 L 450 606" stroke="#111" stroke-width="4"/><path d="M438 618 L 450 604 L 462 618 Z" fill="#111"/>` + txt(450, 654, 'ENTRANCE', 17, 'font-weight="700"'),
  ),
};

export const MAPS: Record<string, LrMap> = { millbrook, farm, library };
