export type Sport = 'football' | 'basketball' | 'nfl' | 'cricket' | 'rugby' | 'baseball' | 'f1' | 'hockey';
export type Tier = 'mid' | 'elite' | 'relegation' | 'tank';
export type Kind = 'MOAN' | 'ROAST' | 'COPE' | 'BANTER';

export type Team = {
  id: string;
  name: string;
  sport: Sport;
  city: string;
  primary: string;
  secondary: string;
  record: string;
  mascot: string;
  tier: Tier;
};

export type User = {
  handle: string;
  team: string;
  moanScore: number;
  roastScore: number;
  badges: string[];
  avatar: string;
};

export type Reactions = { laughs: number; agrees: number; cope: number; ratio: number };

export type Moan = {
  id: string;
  user: string;
  team: string;
  kind: Kind;
  minsAgo: number;
  text: string;
  tags: string[];
  reactions: Reactions;
  target?: string;
  media?: { type: string; label: string };
};

export type TrendingTag = { tag: string; moans: number; sport: Sport };

export type LiveEvent = { min: number; text: string; users: number; live?: boolean };

export const TEAMS: Team[] = [
  { id: 'fc-grumble', name: 'FC GRUMBLE', sport: 'football', city: 'Manchester', primary: '#e63946', secondary: '#0a0908', record: '2W-7L-3D', mascot: 'a sad pigeon', tier: 'mid' },
  { id: 'real-tantrum', name: 'REAL TANTRUM', sport: 'football', city: 'Madrid', primary: '#ffd60a', secondary: '#003566', record: '11W-1L-0D', mascot: 'a screaming bull', tier: 'elite' },
  { id: 'whinger-wanderers', name: 'WHINGER WANDERERS', sport: 'football', city: 'London', primary: '#ff006e', secondary: '#000', record: '4W-5L-3D', mascot: 'a foam finger', tier: 'mid' },
  { id: 'cope-city', name: 'COPE CITY FC', sport: 'football', city: 'Liverpool', primary: '#06a77d', secondary: '#fff', record: '0W-12L-0D', mascot: 'a deflated balloon', tier: 'relegation' },
  { id: 'sad-sox', name: 'SAD SOX', sport: 'baseball', city: 'Boston', primary: '#9d0208', secondary: '#fff', record: '34-89', mascot: 'an unwashed sock', tier: 'tank' },
  { id: 'doom-dynamos', name: 'DOOM DYNAMOS', sport: 'basketball', city: 'Brooklyn', primary: '#ff6b1a', secondary: '#0a0908', record: '12-58', mascot: 'a melting ice cube', tier: 'tank' },
  { id: 'panic-pacers', name: 'PANIC PACERS', sport: 'basketball', city: 'Indianapolis', primary: '#fcbf49', secondary: '#003049', record: '40-30', mascot: 'a chicken with no head', tier: 'mid' },
  { id: 'wreck-rovers', name: 'WRECK ROVERS', sport: 'rugby', city: 'Cardiff', primary: '#3a86ff', secondary: '#fff', record: '3W-9L', mascot: 'a broken scrum cap', tier: 'mid' },
  { id: 'cry-cats', name: 'CRY CATS', sport: 'cricket', city: 'Mumbai', primary: '#7209b7', secondary: '#f4ede0', record: '5W-8L', mascot: 'a kitten in a helmet', tier: 'mid' },
  { id: 'fail-falcons', name: 'FAIL FALCONS', sport: 'nfl', city: 'Atlanta', primary: '#d62828', secondary: '#000', record: '3-14', mascot: 'a falcon facing a wall', tier: 'tank' },
  { id: 'sob-stars', name: 'SOB STARS', sport: 'hockey', city: 'Dallas', primary: '#1d3557', secondary: '#a8dadc', record: '18-44-6', mascot: 'a wet hockey glove', tier: 'tank' },
  { id: 'meltdown-mclaren', name: 'MELTDOWN MOTORS', sport: 'f1', city: 'Woking', primary: '#fb8500', secondary: '#000', record: 'P9 in constructors', mascot: 'a smoking tyre', tier: 'mid' },
];

export const USERS: User[] = [
  { handle: 'GAFFER_GAZ', team: 'fc-grumble', moanScore: 9241, roastScore: 12407, badges: ['CERTIFIED COPER', 'SEASON TICKET HOLDER OF DOOM'], avatar: 'GG' },
  { handle: 'PIE_QUEEN_PAULA', team: 'whinger-wanderers', moanScore: 14882, roastScore: 8011, badges: ['PROFESSIONAL VICTIM', 'PHONE-IN HALL OF FAME'], avatar: 'PQ' },
  { handle: 'CHAD_NUTMEG', team: 'real-tantrum', moanScore: 1402, roastScore: 22019, badges: ['BANTER MERCHANT', 'TROPHY-LICKER'], avatar: 'CN' },
  { handle: 'COPE_LORD_55', team: 'cope-city', moanScore: 31204, roastScore: 220, badges: ['TERMINALLY ONLINE', 'RELEGATION SURVIVOR'], avatar: 'CL' },
  { handle: 'BLEACHER_BRENDA', team: 'sad-sox', moanScore: 8400, roastScore: 7702, badges: ['THE STATPACK', 'FOAM FINGER'], avatar: 'BB' },
  { handle: 'COURTSIDE_KEN', team: 'doom-dynamos', moanScore: 5612, roastScore: 4490, badges: ['ROOKIE WHINGER'], avatar: 'CK' },
  { handle: 'TEN_YARD_TANYA', team: 'fail-falcons', moanScore: 19444, roastScore: 6611, badges: ['28-3 SURVIVOR', 'PERPETUAL DREAD'], avatar: 'TT' },
  { handle: 'SCRUM_DADDY', team: 'wreck-rovers', moanScore: 4012, roastScore: 9805, badges: ['BANTER BARON'], avatar: 'SD' },
  { handle: 'PIT_LANE_PIPPA', team: 'meltdown-mclaren', moanScore: 7733, roastScore: 11202, badges: ['STRATEGY TRUTHER'], avatar: 'PP' },
  { handle: 'ICE_COLD_IGOR', team: 'sob-stars', moanScore: 11030, roastScore: 3488, badges: ['ZAMBONI WHISPERER'], avatar: 'II' },
];

export const MOANS: Moan[] = [
  { id: 'm1', user: 'GAFFER_GAZ', team: 'fc-grumble', kind: 'MOAN', minsAgo: 4,
    text: "Our striker has the first touch of a man wearing oven gloves. We paid £62m for him and he just turned the ball over to a STEWARD.",
    tags: ['#OVENGLOVES', '#62MILLIONDOWNTHEDRAIN'],
    reactions: { laughs: 2104, agrees: 8821, cope: 12, ratio: 4 },
    media: { type: 'placeholder', label: 'PHOTO: striker missing open goal' } },
  { id: 'm2', user: 'CHAD_NUTMEG', team: 'real-tantrum', kind: 'ROAST', target: 'COPE_LORD_55', minsAgo: 9,
    text: "Mate your team's last trophy was when bread cost 30p. Update your bio. Update your life.",
    tags: ['#TROPHYDROUGHT', '#LOAFER'],
    reactions: { laughs: 18209, agrees: 3402, cope: 9921, ratio: 88 } },
  { id: 'm3', user: 'TEN_YARD_TANYA', team: 'fail-falcons', kind: 'MOAN', minsAgo: 22,
    text: "Up 28-3 will haunt me until the day I die. I will see those numbers carved into my headstone. My grandkids will inherit this trauma.",
    tags: ['#283FOREVER', '#GENERATIONALDAMAGE'],
    reactions: { laughs: 9912, agrees: 22014, cope: 80, ratio: 11 } },
  { id: 'm4', user: 'PIE_QUEEN_PAULA', team: 'whinger-wanderers', kind: 'MOAN', minsAgo: 31,
    text: "Manager came out for the press conference WEARING SLIPPERS. Slippers. The disrespect. We are 14th. We pay £180k a week for slippers.",
    tags: ['#SLIPPERGATE', '#STANDARDS'],
    reactions: { laughs: 14002, agrees: 6201, cope: 200, ratio: 19 },
    media: { type: 'placeholder', label: 'PHOTO: manager in actual slippers' } },
  { id: 'm5', user: 'PIT_LANE_PIPPA', team: 'meltdown-mclaren', kind: 'ROAST', target: 'CHAD_NUTMEG', minsAgo: 44,
    text: "You support a team that pays £400m for a roster and you call US embarrassing. The audacity is doing more laps than our pit crew.",
    tags: ['#FINANCIALDOPING', '#PITSTOPS'],
    reactions: { laughs: 11442, agrees: 8921, cope: 421, ratio: 90 } },
  { id: 'm6', user: 'BLEACHER_BRENDA', team: 'sad-sox', kind: 'MOAN', minsAgo: 58,
    text: "We traded our Cy Young winner for a bag of practice balls and a guy named Kyle. Kyle has a 7.42 ERA. KYLE.",
    tags: ['#KYLE', '#FRONTOFFICEFRAUD'],
    reactions: { laughs: 6612, agrees: 9402, cope: 14, ratio: 22 } },
  { id: 'm7', user: 'COPE_LORD_55', team: 'cope-city', kind: 'COPE', minsAgo: 66,
    text: "Ok hear me out. 0-12 is technically a record. Records get you in the history books. We are the most documented team of the season actually.",
    tags: ['#WERETHEFAMOUSONES', '#COPE'],
    reactions: { laughs: 22011, agrees: 109, cope: 30201, ratio: 311 } },
  { id: 'm8', user: 'SCRUM_DADDY', team: 'wreck-rovers', kind: 'ROAST', target: 'CRY_CATS_FAN', minsAgo: 88,
    text: "Cricket fans calling rugby boring is the funniest thing I'll read all week. Your sport has a tea break. A TEA BREAK.",
    tags: ['#TEABREAK', '#FIVEDAYS'],
    reactions: { laughs: 8902, agrees: 4012, cope: 7700, ratio: 144 } },
];

export const TRENDING: TrendingTag[] = [
  { tag: '#SLIPPERGATE', moans: 22841, sport: 'football' },
  { tag: '#KYLE', moans: 18120, sport: 'baseball' },
  { tag: '#283FOREVER', moans: 14002, sport: 'nfl' },
  { tag: '#OVENGLOVES', moans: 11209, sport: 'football' },
  { tag: '#TROPHYDROUGHT', moans: 9803, sport: 'football' },
  { tag: '#TEABREAK', moans: 7211, sport: 'cricket' },
  { tag: '#WERETHEFAMOUSONES', moans: 6022, sport: 'football' },
  { tag: '#PITSTOPS', moans: 4901, sport: 'f1' },
];

export const LIVE_THREAD: {
  match: string;
  competition: string;
  minute: number;
  score: { home: number; away: number };
  events: LiveEvent[];
} = {
  match: 'FC GRUMBLE vs REAL TANTRUM',
  competition: 'CONTINENTAL CUP — QUARTER FINAL',
  minute: 67,
  score: { home: 0, away: 4 },
  events: [
    { min: 4, text: "GOAL — TANTRUM (1-0). Defence parted like the Red Sea.", users: 412 },
    { min: 12, text: "GRUMBLE manager arguing with own assistant. We are TWELVE MINUTES IN.", users: 800 },
    { min: 23, text: "GOAL — TANTRUM (2-0). Header. Unmarked. Of course.", users: 1411 },
    { min: 34, text: "GRUMBLE STRIKER fluffs an open net from 4 yards. He is now my Roman Empire.", users: 2201 },
    { min: 45, text: "Half time. Crowd booing the snacks at this point.", users: 3402 },
    { min: 51, text: "GOAL — TANTRUM (3-0). I am putting my scarf in the bin live on stream.", users: 4900 },
    { min: 58, text: "Substitution: GRUMBLE bring on a 17-year-old. Pray for him.", users: 5210 },
    { min: 64, text: "GOAL — TANTRUM (4-0). The 17-year-old just witnessed his own funeral.", users: 7811 },
    { min: 67, text: "GRUMBLE FAN ON CAMERA EATING HIS SCARF. WE ARE LIVE.", users: 12044, live: true },
  ],
};

export const RIVALRY = {
  a: 'fc-grumble',
  b: 'real-tantrum',
  meetings: 184,
  aWins: 41,
  bWins: 122,
  draws: 21,
  biggestMoan: { user: 'GAFFER_GAZ', text: "Tantrum fans call us 'small'. We have 158,000 season ticket holders. They have 158,000 lawyers." },
  biggestRoast: { user: 'CHAD_NUTMEG', text: "Asked a Grumble fan what their proudest moment was. He said 'finishing 4th'. Mate. Finishing. FOURTH." },
  trophyGap: { a: 3, b: 47 },
};

export const teamById = (id: string) => TEAMS.find(t => t.id === id);
export const userByHandle = (h: string) => USERS.find(u => u.handle === h);
export const fmt = (n: number) => n.toLocaleString();
