// Roman Town — where the sun and the moon stand in the sky at a moment, seen
// from a place: azimuth from north, clockwise, and elevation above the
// horizon, in radians, and how much of the moon is lit. Low precision (a
// degree or so), from the usual short series (the Astronomical Almanac's for
// the sun, the moon's main terms after Meeus).
const RomanTownSky = (() => {
  const RAD = Math.PI / 180;

  function at(date, latDeg, lonDeg) {
    const d = date.getTime() / 86400000 - 10957.5; // days from J2000.0
    const e = (23.439 - 0.0000004 * d) * RAD, phi = latDeg * RAD;
    // the sun's ecliptic longitude
    const g = (357.529 + 0.98560028 * d) * RAD;
    const ls = (280.459 + 0.98564736 * d + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * RAD;
    // the moon's
    const Lm = 218.316 + 13.176396 * d, Mm = (134.963 + 13.064993 * d) * RAD, F = (93.272 + 13.22935 * d) * RAD;
    const D = (297.85 + 12.190749 * d) * RAD;
    const lm = (Lm + 6.289 * Math.sin(Mm) + 1.274 * Math.sin(2 * D - Mm) + 0.658 * Math.sin(2 * D)) * RAD;
    const bm = 5.128 * Math.sin(F) * RAD;
    // the sky turning: the local sidereal time
    const theta = (280.16 + 360.9856235 * d + lonDeg) * RAD;
    const place = (lam, beta) => {
      const ra = Math.atan2(Math.sin(lam) * Math.cos(e) - Math.tan(beta) * Math.sin(e), Math.cos(lam));
      const dec = Math.asin(Math.sin(beta) * Math.cos(e) + Math.cos(beta) * Math.sin(e) * Math.sin(lam));
      const H = theta - ra;
      const el = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H));
      const az = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(dec) * Math.cos(phi)) + Math.PI;
      return { az, el };
    };
    const sun = place(ls, 0), moon = place(lm, bm);
    // the moon lit as far as she stands from the sun
    const elong = Math.acos(Math.cos(lm - ls) * Math.cos(bm));
    moon.lit = (1 - Math.cos(elong)) / 2;
    return { sun, moon };
  }

  // The sky over a Roman town at a moment, its clock the visitor's: the
  // town as far north as Rome, as far east as the middle of the visitor's
  // time zone, so the sun is highest about noon by their clock.
  function local(date = new Date()) {
    const y = date.getFullYear();
    const std = Math.max(new Date(y, 0, 1).getTimezoneOffset(), new Date(y, 6, 1).getTimezoneOffset());
    return at(date, 41.9, -std / 4);
  }

  return { at, local };
})();
