/**
 * `tz-lookup` ships as plain CommonJS with no types of its own, and there is no
 * `@types/tz-lookup` on npm. The whole surface is one function.
 */
declare module 'tz-lookup' {
  /** IANA zone name for a coordinate, e.g. "Asia/Tokyo". Throws if out of range. */
  export default function tzLookup(latitude: number, longitude: number): string;
}
