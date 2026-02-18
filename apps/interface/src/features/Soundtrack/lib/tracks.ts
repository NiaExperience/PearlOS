/**
 * Soundtrack track metadata
 * Points to bundled MP3 assets in templates/assets/soundtrack
 */

export interface SoundtrackTrack {
  id: string;
  title: string;
  artist: string;
  path: string;
}

export const SOUNDTRACK_TRACKS: SoundtrackTrack[] = [
  {
    id: 'beo-for-the-rest-of-my-life',
    title: 'For the Rest of My Life - Instrumental',
    artist: 'Beò',
    path: '/soundtrack/Beò - For the Rest of My Life - Instrumental version.mp3',
  },
  {
    id: 'damon-power-fireplace',
    title: 'Fireplace with Alex',
    artist: 'Damon Power',
    path: '/soundtrack/Damon Power - Fireplace with Alex.mp3',
  },
  {
    id: 'danihadani-secret-no-2',
    title: 'Secret No 2',
    artist: 'DaniHaDani',
    path: '/soundtrack/DaniHaDani - Secret No 2.mp3',
  },
  {
    id: 'danihadani-with-love',
    title: 'With Love',
    artist: 'DaniHaDani',
    path: '/soundtrack/DaniHaDani - With Love.mp3',
  },
  {
    id: 'eva-tiedemann-falling-in-love',
    title: 'What Falling in Love Feels Like',
    artist: 'Eva Tiedemann',
    path: '/soundtrack/Eva Tiedemann - What Falling in Love Feels Like.mp3',
  },
  {
    id: 'love-the-danger-sadness',
    title: 'Sadness in the Safety - Instrumental',
    artist: 'Love the Danger',
    path: '/soundtrack/Love the Danger - Sadness in the Safety - Instrumental version.mp3',
  },
  {
    id: 'sparrow-tree-shimmering-light',
    title: 'Shimmering Light',
    artist: 'Sparrow Tree',
    path: '/soundtrack/Sparrow Tree - Shimmering Light.mp3',
  },
  {
    id: 'tomer-baruch-sleepless',
    title: 'Sleepless on the Internet',
    artist: 'Tomer Baruch',
    path: '/soundtrack/Tomer Baruch - Sleepless on the Internet.mp3',
  },
  {
    id: 'toti-cisneros-transcendence',
    title: 'Transcendence',
    artist: 'Toti Cisneros',
    path: '/soundtrack/Toti Cisneros - Transcendence.mp3',
  },
];

/**
 * Shuffle array using Fisher-Yates algorithm
 */
export function shuffleTracks(tracks: SoundtrackTrack[]): SoundtrackTrack[] {
  const shuffled = [...tracks];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

