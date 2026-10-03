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

// ---------------------------------------------------------------- Marsh Edge Nature Reserve (site map, entrance at the bottom) - gen-l-05
const marsh: LrMap = {
  id: 'marsh',
  kind: 'map',
  title: 'Marsh Edge Nature Reserve: visitor map',
  letters: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'],
  asked: [['A', 'Picnic area'], ['B', 'Sensory garden'], ['D', 'Woodland hide'], ['F', 'Education hut'], ['E', 'Observation tower'], ['G', 'Reed hide']],
  facts: `Orientation: visitor enters at the ENTRANCE at the bottom (south) from MARSH LANE and walks north up the main path. Left = west, right = east.
Printed: ENTRANCE, MARSH LANE (bottom), CAR PARK (bottom left), VISITOR CENTRE (just inside the entrance, right of the main path), LAGOON (big water, upper right), WOODLAND (green area, top left).
The main path runs north to a junction with three paths: west (left), north (straight ahead, lagoon on its right), east (right, along the south shore of the lagoon).
A = Picnic area: directly opposite the visitor centre, left of the main path, next to the car park.
B = Sensory garden: on the west path, just after the junction, on the LEFT (south) side.
C = Toilets (not asked, never mention): on the west path, opposite B (north side).
D = Woodland hide: at the very end of the west path, which turns north through the woodland.
F = Education hut: on the north path, about halfway along, on the LEFT (west) side.
E = Observation tower: at the very end of the north path, at the northern end of the lagoon.
G = Reed hide: at the end of the east path, on the far (east) side of the lagoon.
H = Maintenance yard (not asked, never mention): south of the east path.`,
  svg: wrap(
    'Marsh Edge Nature Reserve: visitor map',
    grass(40, 40, 840, 500) +
      `<rect x="100" y="60" width="200" height="280" rx="20" fill="#bcd9a0" stroke="#5f8a45" stroke-width="1.5"/>` + txt(250, 310, 'WOODLAND', 14, 'font-weight="700"') +
      tree(130, 130) + tree(270, 120) + tree(270, 190) + tree(140, 240) + tree(130, 310) + tree(270, 250) +
      `<ellipse cx="620" cy="200" rx="150" ry="110" fill="#a9cfe8" stroke="#4d8fb8" stroke-width="2"/>` + txt(620, 205, 'LAGOON', 18, 'font-weight="700"') +
      road(0, 560, 900, 56, '') + txt(180, 593, 'MARSH LANE', 15, 'font-weight="700"') +
      path('M450 560 V 330 M450 330 H 200 M200 330 V 140 M450 330 V 110 M450 330 H 835 M835 330 V 240') +
      N(60, 480, 230, 60, 'CAR PARK', '#e4e4ee') +
      L(335, 470, 95, 65, 'A') + N(475, 470, 150, 65, 'VISITOR\nCENTRE', '#f0e0c8') +
      L(305, 345, 110, 65, 'B') + L(305, 245, 110, 70, 'C') +
      L(150, 75, 100, 65, 'D') + L(335, 150, 100, 65, 'F') + L(400, 48, 100, 60, 'E') +
      L(790, 160, 90, 80, 'G') + L(630, 380, 130, 70, 'H') +
      `<path d="M450 640 L 450 590" stroke="#111" stroke-width="4"/><path d="M438 602 L 450 588 L 462 602 Z" fill="#111"/>` + txt(450, 654, 'ENTRANCE', 17, 'font-weight="700"'),
  ),
};

// ---------------------------------------------------------------- Kingsway Sports Centre, ground floor (entrance at the bottom) - gen-l-06
const kingsway: LrMap = {
  id: 'kingsway',
  kind: 'plan',
  title: 'Kingsway Sports Centre: ground floor',
  letters: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'],
  asked: [['B', 'Café'], ['A', 'Gym'], ['C', 'Sports hall'], ['F', 'Climbing wall'], ['E', 'Dance studio']],
  facts: `Orientation: floor plan; visitor enters at the ENTRANCE at the bottom (south) into RECEPTION, then a corridor runs north. Left = west, right = east for a visitor walking north.
Printed: ENTRANCE, RECEPTION (bottom centre), SWIMMING POOL (top right, east of the corridor).
Front row, left to right: A, RECEPTION, B.
A = Gym: immediately left of reception.
B = Café: immediately right of reception.
West side of the corridor, from the front: C, D, E.
C = Sports hall: first big room on the left as you walk up the corridor.
D = Physio room (not asked, never mention): second on the left.
E = Dance studio: the last room on the left, in the far north-west corner.
East side of the corridor, from the front: F, G, then SWIMMING POOL (printed).
F = Climbing wall: first room on the right, directly opposite the sports hall.
G = Squash courts (not asked, never mention): second on the right, between F and the pool.
H = Meeting room (not asked, never mention): at the very end of the corridor, straight ahead.`,
  svg: wrap(
    'Kingsway Sports Centre: ground floor',
    `<rect x="60" y="50" width="780" height="540" fill="#fafaf5" stroke="#111" stroke-width="5"/>` +
      L(70, 450, 270, 130, 'A') + N(350, 450, 200, 130, 'RECEPTION', '#f0ecd8') + L(560, 450, 270, 130, 'B') +
      L(70, 330, 320, 110, 'C') + L(70, 195, 320, 125, 'D') + L(70, 60, 320, 125, 'E') +
      L(510, 330, 320, 110, 'F') + L(510, 215, 320, 105, 'G') + N(510, 60, 320, 145, 'SWIMMING POOL', '#cfe6f5') +
      L(400, 60, 100, 90, 'H') +
      `<path d="M450 640 L 450 606" stroke="#111" stroke-width="4"/><path d="M438 618 L 450 604 L 462 618 Z" fill="#111"/>` + txt(450, 654, 'ENTRANCE', 17, 'font-weight="700"'),
  ),
};

// ---------------------------------------------------------------- Calderbrook Library, ground floor (entrance at the bottom)
const calderbrook: LrMap = {
  id: 'calderbrook',
  kind: 'plan',
  title: 'Calderbrook Library: ground floor',
  letters: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'],
  asked: [['A', 'Café'], ['C', 'Teen zone'], ['E', 'Quiet reading room'], ['F', 'Computer suite'], ['H', "Children's library"], ['D', 'Local history room']],
  facts: `Orientation: floor plan; the visitor enters through the ENTRANCE at the bottom into the FOYER and faces the back (top of the plan); left = west, right = east.
Printed on the plan: ENTRANCE, FOYER (front centre), MAIN LIBRARY (big open area, middle row centre, straight ahead of the foyer), TOILETS (small room in the middle of the back row).
Front row, left to right: A, FOYER, B.  Middle row: C, MAIN LIBRARY, D.  Back row, left to right: E, F, TOILETS, G, H.
A = Café: immediately left of the foyer. B = staff and returns room (not asked, never mention): immediately right of the foyer.
C = Teen zone: middle row, left of the Main library, directly behind (further from the entrance than) the café.
E = Quiet reading room: back left corner, behind the teen zone.
F = Computer suite: back row, next to the quiet room, on its right and immediately left of the toilets.
G = Meeting room (not asked, never mention): back row, right of the toilets.
H = Children's library: back right corner.
D = Local history room: middle row, right of the Main library, directly in front of (nearer the entrance than) the children's library.`,
  svg: wrap(
    'Calderbrook Library: ground floor',
    `<rect x="60" y="50" width="780" height="540" fill="#fafaf5" stroke="#111" stroke-width="5"/>` +
      L(70, 60, 170, 180, 'E') + L(250, 60, 170, 180, 'F') + N(430, 60, 130, 180, 'TOILETS', '#e8e8e8') + L(570, 60, 120, 180, 'G') + L(700, 60, 130, 180, 'H') +
      L(70, 255, 220, 165, 'C') + N(300, 255, 300, 165, 'MAIN LIBRARY', '#f0ecd8') + L(610, 255, 220, 165, 'D') +
      L(70, 435, 230, 145, 'A') + N(310, 435, 280, 145, 'FOYER', '#f0ecd8') + L(600, 435, 230, 145, 'B') +
      `<rect x="400" y="586" width="100" height="10" fill="#fafaf5"/>` +
      `<path d="M450 640 L 450 606" stroke="#111" stroke-width="4"/><path d="M438 618 L 450 604 L 462 618 Z" fill="#111"/>` + txt(450, 654, 'ENTRANCE', 17, 'font-weight="700"'),
  ),
};

// ---------------------------------------------------------------- Aldwick market town, heritage walk (start at the bottom, crossing the river northwards) - gen-l-08
const aldwick: LrMap = {
  id: 'aldwick',
  kind: 'map',
  title: 'Aldwick: heritage walk',
  letters: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'],
  asked: [['A', 'Old brewery'], ['C', 'Wool hall'], ['D', 'Corn Exchange'], ['F', 'Museum'], ['G', 'Old grammar school']],
  facts: `Orientation: the walk starts at TOURIST INFORMATION at the bottom (south) of the plan and goes north along BRIDGE STREET over the OLD BRIDGE; "left" = west, "right" = east while walking north.
Printed: TOURIST INFORMATION (left of Bridge Street at the bottom), RIVER ASH (east-west band across the plan), OLD BRIDGE, BRIDGE STREET, TANNER LANE (leaves Bridge Street to the right/east between the bridge and the square), MARKET SQUARE, HIGH STREET (north from the square), TOWN HALL (left/west side of High Street), ST MARY'S CHURCH (top, end of High Street), CAR PARK (south of the river, east of the brewery).
Lettered locations (names NOT printed):
A = Old brewery: south of the river, on the right of Bridge Street just before the bridge.
B = Almshouses (never mention): south of the river, on the left of Bridge Street, opposite A.
C = Wool hall: at the far (east) end of Mill Lane.
H = Bookshop (never mention): on the left of Bridge Street between the bridge and the square, opposite Mill Lane.
D = Corn Exchange: on the west (left) side of Market Square.
E = Coaching inn (may be mentioned only as the building on the east side of the square that people mistake for the Corn Exchange).
F = Museum: on the right (east) of High Street, directly opposite the Town Hall.
G = Old grammar school: just past the Town Hall on the same side of the street, almost opposite the church.`,
  svg: wrap(
    'Aldwick: heritage walk',
    grass(30, 40, 840, 400) +
      `<rect x="0" y="455" width="900" height="45" fill="#a9cfe8"/>` + txt(160, 483, 'RIVER ASH', 15, 'font-weight="700"') +
      road(440, 250, 40, 390, '') + road(440, 60, 40, 190, '') +
      `<text transform="translate(466,562) rotate(-90)" font-size="12" text-anchor="middle" fill="#222" font-weight="700">BRIDGE STREET</text>` +
      `<text transform="translate(466,160) rotate(-90)" font-size="14" text-anchor="middle" fill="#222" font-weight="700">HIGH STREET</text>` +
      `<rect x="434" y="452" width="52" height="51" fill="#d9d2b8" stroke="#222" stroke-width="2"/>` + txt(530, 478, 'OLD BRIDGE', 12) +
      road(480, 385, 290, 30, 'TANNER LANE') +
      `<rect x="330" y="255" width="260" height="95" fill="#e9e2d0" stroke="#222" stroke-width="2"/>` + txt(460, 308, 'MARKET SQUARE', 15, 'font-weight="700"') +
      N(170, 570, 130, 50, 'TOURIST\nINFORMATION', '#e4e4ee') + L(490, 520, 110, 80, 'A') + L(330, 520, 100, 80, 'B') + N(640, 520, 130, 80, 'CAR PARK', '#e4e4ee') +
      L(300, 380, 130, 60, 'H') + L(770, 365, 95, 70, 'C') +
      L(190, 260, 130, 85, 'D') + L(600, 260, 110, 85, 'E') +
      N(310, 130, 120, 100, 'TOWN HALL', '#f0e0c8') + L(490, 130, 110, 100, 'F') +
      L(310, 55, 120, 65, 'G') + N(490, 50, 130, 65, "ST MARY'S\nCHURCH", '#f0e0c8') +
      tree(120, 120) + tree(160, 340) + tree(700, 200) + tree(780, 120) + tree(120, 400) +
      `<path d="M446 640 L 460 624 L 474 640 Z" fill="#111"/>` + txt(560, 632, 'START', 17, 'font-weight="700"') + `<path d="M512 626 H 478" stroke="#111" stroke-width="2"/>`,
  ),
};


// ---------------------------------------------------------------- Dunmouth Maritime Museum, ground floor plan (entrance at the bottom)
const dunmouth: LrMap = {
  id: 'dunmouth',
  kind: 'plan',
  title: 'Dunmouth Maritime Museum: ground floor',
  letters: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'],
  asked: [['B', 'Cloakroom'], ['A', 'Museum shop'], ['D', 'Café'], ['C', 'Learning studio'], ['G', 'Ship models gallery'], ['E', 'Film theatre']],
  facts: `Orientation: floor plan; the visitor enters at the ENTRANCE at the bottom (south) into the ENTRANCE HALL and walks north into the ATRIUM. Left = west, right = east for a visitor facing north.
Printed on the plan: ENTRANCE (bottom centre), ENTRANCE HALL (front, centre), TOILETS (front row, far right), ATRIUM (large central hall directly ahead of the entrance hall), LIFT AND STAIRS (back wall, centred, at the far end of the atrium).
Front row, left to right: A, ENTRANCE HALL (printed), B, TOILETS (printed).
A = Museum shop: front left, on the left as you enter, opposite B.
B = Cloakroom: front right, on the right as you enter, immediately next to (left of) the toilets.
Middle row, left to right: C, ATRIUM (printed), D.
C = Learning studio: left side of the atrium, directly opposite D.
D = Café: right side of the atrium, about halfway along it, directly opposite C.
Back row, left to right: E, F, LIFT AND STAIRS (printed), G, H.
E = Film theatre: back left corner of the building.
F = Staff offices (not asked, never mention): back row, between E and the lift.
G = Ship models gallery: back row, immediately to the right of the lift and stairs.
H = Stores (not asked, never mention): back right corner, beyond G.`,
  svg: wrap(
    'Dunmouth Maritime Museum: ground floor',
    `<rect x="60" y="50" width="780" height="540" fill="#fafaf5" stroke="#111" stroke-width="5"/>` +
      L(70, 60, 190, 190, 'E') + L(270, 60, 130, 190, 'F') + N(410, 60, 80, 190, 'LIFT AND\nSTAIRS', '#f0ecd8') + L(500, 60, 180, 190, 'G') + L(690, 60, 140, 190, 'H') +
      L(70, 270, 180, 140, 'C') + N(260, 270, 380, 140, 'ATRIUM', '#f0ecd8') + L(650, 270, 180, 140, 'D') +
      L(70, 430, 180, 150, 'A') + N(260, 430, 380, 150, 'ENTRANCE HALL', '#f0ecd8') + L(650, 430, 90, 150, 'B') + N(750, 430, 80, 150, 'TOILETS', '#e8e8e8') +
      `<rect x="400" y="586" width="100" height="10" fill="#fafaf5"/>` +
      `<path d="M450 640 L 450 606" stroke="#111" stroke-width="4"/><path d="M438 618 L 450 604 L 462 618 Z" fill="#111"/>` + txt(450, 654, 'ENTRANCE', 17, 'font-weight="700"'),
  ),
};

export const MAPS: Record<string, LrMap> = { millbrook, farm, library, marsh, kingsway, calderbrook, aldwick, dunmouth };

// ---------------------------------------------------------------- Hartwell Botanic Garden (site map, entrance at the bottom) - gen-l-10
const botanic: LrMap = {
  id: 'botanic',
  kind: 'map',
  title: 'Hartwell Botanic Garden: visitor plan',
  letters: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'],
  asked: [['A', 'Herb garden'], ['E', 'Rose garden'], ['F', 'Tea house'], ['G', 'Boathouse'], ['C', 'Rock garden']],
  facts: `Orientation: the visitor enters at the ENTRANCE at the bottom (south) from GARDEN ROAD and walks north up LIME AVENUE, which ends at the PALM HOUSE (top centre). Left = west, right = east.
Printed: ENTRANCE, GARDEN ROAD, VISITOR CENTRE (just inside the entrance, left of the avenue), CAR PARK (just inside the entrance, right of the avenue), LAKE (right, middle), GREAT LAWN (open lawn, left), PALM HOUSE (top centre), LIME AVENUE, footbridge.
A = Herb garden: left of the avenue, immediately beyond (north of) the visitor centre.
E = Rose garden: right of the avenue, directly opposite A, immediately beyond (north of) the car park.
B = Fern house (not asked, never mention): left of the avenue, beyond A.
H = Bee garden (not asked, never mention): south-east of the lake, east of E.
F = Tea house: a path leaves the avenue to the right about halfway up (above E, below the Palm House) and ends at F on the near (west) shore of the lake.
G = Boathouse: on the far (east) bank of the lake, directly across the water from F; reached by the path from F going north then east over the footbridge at the top (north) end of the lake.
C = Rock garden: far left (west) end of a path that leaves the avenue to the left just before the Palm House.
D = Orchard (not asked, never mention): top left corner behind C.`,
  svg: wrap(
    'Hartwell Botanic Garden: visitor plan',
    grass(40, 45, 820, 515) +
      `<rect x="60" y="290" width="170" height="180" rx="20" fill="#eaf3da" stroke="#9ac07a" stroke-width="1.5"/>` + txt(145, 385, 'GREAT LAWN', 14, 'font-weight="700"') +
      `<ellipse cx="690" cy="315" rx="95" ry="70" fill="#a9cfe8" stroke="#4d8fb8" stroke-width="2"/>` + txt(690, 320, 'LAKE', 18, 'font-weight="700"') +
      `<rect x="680" y="205" width="20" height="45" fill="#a9cfe8"/>` +
      path('M450 575 V 170 M400 525 H 450 M400 428 H 450 M400 328 H 450 M450 435 H 500 M450 290 H 500 M450 215 H 200 M540 255 V 217 H 800 V 270 M650 440 H 670') +
      `<rect x="662" y="209" width="56" height="16" fill="#d9d2b8" stroke="#222" stroke-width="2"/>` + txt(690, 200, 'footbridge', 12) +
      N(340, 60, 220, 110, 'PALM HOUSE', '#f0e0c8') +
      N(250, 490, 150, 70, 'VISITOR\nCENTRE', '#f0e0c8') + N(500, 495, 200, 65, 'CAR PARK', '#e4e4ee') +
      L(250, 385, 150, 85, 'A', '#c6e0a8') + L(250, 285, 150, 85, 'B') + L(500, 390, 150, 90, 'E', '#c6e0a8') + L(670, 400, 100, 80, 'H', '#c6e0a8') +
      L(500, 255, 80, 70, 'F') + L(795, 270, 60, 70, 'G') + L(80, 170, 120, 90, 'C', '#d8d4c4') + L(60, 60, 200, 80, 'D', '#c6e0a8') +
      tree(120, 520) + tree(200, 540) + tree(300, 110) + tree(600, 110) + tree(780, 120) + tree(830, 400) + tree(560, 200) + tree(820, 520) + tree(150, 300).replace(/.*/, '') +
      road(0, 575, 900, 55, '') + txt(170, 608, 'GARDEN ROAD', 15, 'font-weight="700"') +
      txt(468, 365, 'LIME AVENUE', 13, 'font-weight="700" transform="rotate(-90 468 365)"') +
      arrowUp(450, 548) + txt(570, 608, 'ENTRANCE', 17, 'font-weight="700"') + `<path d="M512 603 H 462" stroke="#111" stroke-width="2"/>`,
  ),
};
MAPS.botanic = botanic;
