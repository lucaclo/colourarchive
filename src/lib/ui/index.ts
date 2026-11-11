// App-wide interaction layer, loaded once by Layout.astro on every page.
import { startPress } from './press';
import { startSegments } from './segments';
import { startPageHeads } from './page-head';

startPress();
startSegments();
startPageHeads();
