/**
 * Every term Scout uses, in one place.
 *
 * Each infotip that explains one of these words reads its text from here
 * (`data-term` in the markup), so the tip beside a control and the entry in
 * the glossary sheet are the same sentence and can never drift apart. Written
 * from Scout's own arithmetic, not copied from a reference: where a number
 * here differs from a textbook's, it is the one the page actually uses.
 *
 * Plain words, a sentence or three. The sheet is for reading in a car park.
 */

export interface GlossaryEntry {
  id: string;
  term: string;
  text: string;
  /** Section in the sheet, so related words sit together. */
  group: GlossaryGroup;
}

export type GlossaryGroup = 'Sun and sky' | 'Lens' | 'Night' | 'Exposure';

export const GLOSSARY_GROUPS: readonly GlossaryGroup[] = ['Sun and sky', 'Lens', 'Night', 'Exposure'];

export const GLOSSARY: readonly GlossaryEntry[] = [
  // Sun and sky
  { id: 'azimuth', group: 'Sun and sky', term: 'Azimuth', text: 'Compass bearing to the sun from here. 0° is north, 90° east, 180° south, 270° west.' },
  { id: 'altitude', group: 'Sun and sky', term: 'Altitude', text: 'How high the sun is. 0° is on the horizon, 90° is straight overhead.' },
  { id: 'shadow-ratio', group: 'Sun and sky', term: 'Shadow ratio', text: 'Shadow length as a multiple of height. At 1 : 2.4, a metre-tall thing throws a 2.4 m shadow. It grows as the sun drops and means nothing once the sun is down.' },
  { id: 'elevation', group: 'Sun and sky', term: 'Elevation', text: 'How high the ground is above sea level here, from the elevation model. Nothing to do with the sun.' },
  { id: 'golden-hour', group: 'Sun and sky', term: 'Golden hour', text: 'The sun between 6° above the horizon and 4° below it. Warm, low light with long shadows.' },
  { id: 'blue-hour', group: 'Sun and sky', term: 'Blue hour', text: 'The sun between 4° and 6° below the horizon. No direct light, and the sky lights the scene an even blue.' },
  { id: 'twilight', group: 'Sun and sky', term: 'Civil, nautical, astronomical twilight', text: 'The sun 0–6°, 6–12° and 12–18° below the horizon. Each step takes away more of the glow in the sky.' },
  { id: 'horizon-verdict', group: 'Sun and sky', term: 'Lit, bare, blocked', text: 'How a sunrise or sunset reads from the forecast. Blocked: low cloud on the horizon where the sun is, so the light never gets out. Bare: the horizon is open but there is no cloud overhead to catch the colour. Lit: open horizon and cloud overhead, the arrangement colour needs. Two cloud readings, never a score.' },
  { id: 'light', group: 'Sun and sky', term: 'Colour temperature', text: 'The colour of the sunlight in kelvin, and its contrast in stops of shadow fill. Low kelvin is warm (about 2,500 K near sunset), high is cool (about 6,500 K under a high sun). Scout assumes a clear sky; for cloud, see the weather note.' },

  // Lens
  { id: 'depth-of-field', group: 'Lens', term: 'Depth of field', text: 'The stretch in front of and behind the focus point that still looks sharp. It gets deeper as you stop down, use a wider lens or focus further away.' },
  { id: 'hyperfocal', group: 'Lens', term: 'Hyperfocal distance', text: 'Focus here and everything from half this distance to infinity is sharp. It is the deepest focus a lens and aperture can give that still reaches the horizon.' },
  { id: 'coc', group: 'Lens', term: 'Circle of confusion', text: 'How big a blurred point can be and still look like a point. A print seen at arm’s length forgives far more than a file seen at 100%, so it depends on how the photo will be looked at.' },
  { id: 'sharp-print', group: 'Lens', term: 'For print', text: 'Sharp in a 10 × 8 inch print seen from about 25 cm. The circle of confusion is the sensor’s diagonal divided by 1,500 (0.029 mm on full frame). Most published depth-of-field tables use this.' },
  { id: 'sharp-pixel', group: 'Lens', term: 'Pixel-sharp', text: 'Sharp at 100% on screen. The circle of confusion is two pixels, so it depends on the sensor’s resolution, and the zone is much shallower than a print table says. Use it for focus stacks.' },
  { id: 'front-back', group: 'Lens', term: 'Front and back split', text: 'How much of the sharp zone lies in front of the focus point. Close up it is near half; it shrinks as you focus further, reaching none at all at the hyperfocal distance, where everything behind is sharp. The one-third rule is only true at one distance.' },
  { id: 'focus-stack', group: 'Lens', term: 'Focus stacking', text: 'Several frames focused at different distances, merged later, when one frame cannot hold the near and the far sharp at once. Scout picks the fewest frames whose sharp zones overlap.' },
  { id: 'field-of-view', group: 'Lens', term: 'Field of view', text: 'How much of the scene the frame takes in, as an angle or as a width at a distance. A longer lens or a smaller sensor narrows it.' },
  { id: 'crop-factor', group: 'Lens', term: 'Crop factor', text: 'How much smaller a sensor is than full frame, across the diagonal. A 35mm lens on APS-C (1.53×) frames like a 54mm on full frame.' },

  // Night
  { id: 'astro-dark', group: 'Night', term: 'Astronomical darkness', text: 'The sun more than 18° below the horizon. The sky is as dark as it gets, and the Milky Way shows its full contrast.' },
  { id: 'core', group: 'Night', term: 'Milky Way core', text: 'The bright centre of the galaxy, in Sagittarius. Worth going out for when it is above 10°, the sky is astronomically dark and the moon is down, all at once.' },
  { id: 'npf', group: 'Night', term: 'NPF rule', text: 'The longest exposure before stars trail, worked out from the focal length, the aperture and the size of a pixel. Scout uses the pixel and the star’s declination, so a 61 MP body gets a shorter limit than a 24 MP one.' },
  { id: 'rule-500', group: 'Night', term: '500 rule', text: '500 divided by the focal length, in seconds. A film-era rule that ignores the sensor; on a modern high-resolution body the stars already trail at half that time.' },
  { id: 'pixel-pitch', group: 'Night', term: 'Pixel pitch', text: 'The width of one pixel on the sensor, worked out from its size and its megapixels. A smaller pixel shows trailing and soft focus sooner.' },
  { id: 'light-pollution', group: 'Night', term: 'Light-pollution zone', text: 'How bright the night sky is here, from a satellite atlas. Zone 0 is untouched. From zone 9 the core is lost in the glow, whatever the moon does.' },

  // Exposure
  { id: 'stop', group: 'Exposure', term: 'Stop', text: 'A doubling or halving of light. One stop more time is twice as long; six stops is 64 times.' },
  { id: 'nd', group: 'Exposure', term: 'ND filter', text: 'Neutral grey glass that cuts light without changing its colour. Filters are labelled three ways for the same thing: stops (6), factor (ND64) and optical density (1.8).' },
  { id: 'optical-density', group: 'Exposure', term: 'Optical density', text: 'A filter’s strength as a logarithm: 0.3 is one stop, 0.9 three, 3.0 ten. Common on square filters and on the ring of older ones.' },
  { id: 'reciprocity', group: 'Exposure', term: 'Reciprocity failure', text: 'Film gets less sensitive in very long exposures, so it needs more time than the arithmetic says. Each film has its own correction, published by its maker. Digital sensors do not have it.' },
  { id: 'bulb', group: 'Exposure', term: 'Bulb', text: 'The shutter stays open for as long as the button is held. Most cameras time themselves only up to 30 s; past that you need Bulb and a remote.' },
];

export const glossaryEntry = (id: string): GlossaryEntry | undefined => GLOSSARY.find((e) => e.id === id);
