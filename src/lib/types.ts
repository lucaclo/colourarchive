import type { OKLCH } from './color';

export interface Exif {
  capturedAt?: string; // ISO date, from EXIF DateTimeOriginal
  camera?: string;
  lens?: string;
  focalLength?: string;
  aperture?: string;
  shutter?: string;
  iso?: number;
  software?: string; // used to spot film scanners (Noritsu, Frontier, VueScan…)
  location?: { lat: number; lon: number }; // decimal degrees, from GPS EXIF
}

export type Medium = 'film' | 'digital';

// Photographic genre — auto-detected (CLIP), user-overridable. A closed set of
// four; every photo is forced to its nearest one, and can be relabelled.
export type Genre = 'street' | 'portrait' | 'landscape' | 'architecture';
export const GENRES: Genre[] = ['street', 'portrait', 'landscape', 'architecture'];
export const GENRE_LABEL: Record<Genre, string> = {
  street: 'Street',
  portrait: 'Portrait',
  landscape: 'Landscape',
  architecture: 'Architecture',
};

export interface Derivative {
  width: number;
  avif: string; // /img/... path
  webp?: string; // legacy; AVIF is universal now, no longer generated
}

export interface Photo {
  id: string; // content hash (stable ID + derivative basename)
  filename: string; // original filename, preserved for book export
  ext: string;
  width: number;
  height: number;
  bytes: number;
  oklch: OKLCH; // dominant colour
  autoChapter: string; // computed chapter key (before overrides)
  chapter: string; // effective chapter key (after overrides)
  autoMedium: Medium; // guessed film|digital (before overrides)
  medium: Medium; // effective film|digital (after overrides)
  autoGenre?: Genre; // CLIP-guessed genre (before overrides); optional for legacy records
  genre?: Genre; // effective genre (after overrides)
  placeholder: string; // tiny blurred data URI
  derivatives: Derivative[];
  exif: Exif;
  addedAt: string; // when ingested
  source?: string; // attribution for inspiration items (photographer / URL)
  // --- Similarity features (stored, stripped from the client manifest) ------
  embedding?: number[];  // 384-d DINOv2 visual fingerprint (subject + composition)
  colourGrid?: number[]; // 4x4 grid of OKLab [L,a,b] per cell — colour & tonal layout
}

export interface Chapter {
  key: string; // stable machine key, e.g. "hue-210" | "achromatic"
  name: string; // display name (override or default)
  oklch: OKLCH; // representative colour (mean of photos), paints the gap bg
  photos: Photo[]; // ordered within chapter
}

export interface Manifest {
  generatedAt: string;
  count: number;
  chapters: Chapter[]; // ordered around the hue wheel
}

export interface Overrides {
  chapters?: Record<string, string>; // key -> display name
  photos?: Record<string, { chapter?: string; medium?: Medium; genre?: Genre }>; // hash -> reassignment
}
