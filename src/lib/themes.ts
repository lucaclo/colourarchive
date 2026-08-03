// Six variations on EXHIBITION — the chosen direction: austere, monochrome,
// an editorial serif display carrying the only type in the project, mono
// labels. Each variant shifts one set of levers (face, weight, case, scale,
// placement, ground) while staying unmistakably in the same family.
// Switchable live; once you pick one we bake it in and drop the switcher.

export interface Theme {
  key: string;
  name: string;
  blurb: string;
}

export const THEMES: Theme[] = [
  {
    key: 'ex-noir',
    name: 'Noir',
    blurb: 'The baseline. Near-black, Playfair 700 sentence case, centred. Mono labels.',
  },
  {
    key: 'ex-plate',
    name: 'Plate',
    blurb: 'Inverted to a light museum wall. Fine Playfair, thin rule swatch. Restrained.',
  },
  {
    key: 'ex-column',
    name: 'Column',
    blurb: 'Asymmetric. Title left, Playfair 900 oversized, words breaking. Bold.',
  },
  {
    key: 'ex-didone',
    name: 'Didone',
    blurb: 'Libre Bodoni, uppercase, stark high-contrast. Space Mono labels.',
  },
  {
    key: 'ex-fraunces',
    name: 'Fraunces',
    blurb: 'Warm near-black, Fraunces italic — softer modern didone character.',
  },
  {
    key: 'ex-whisper',
    name: 'Whisper',
    blurb: 'Quiet Source Serif italic on Didone\'s near-black ground, with a little grain.',
  },
];

// Baked-in default: Whisper — Source Serif italic on Didone's near-black
// ground, with a little grain. (Preset switcher removed; other variants above
// remain documented for reference and easy swapping.)
export const DEFAULT_THEME = 'ex-whisper';
