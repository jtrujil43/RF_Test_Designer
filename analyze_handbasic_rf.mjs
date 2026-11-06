// Numerical reference translation of the parent Hand BASIC coupon equations.
// This does not execute or modify the mobile application or BASIC listings.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HandBasicPreview } from './handbasic-preview-runtime.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const output = path.join(root, 'handbasic-previews');
mkdirSync(output, { recursive: true });
// Git checkouts may use LF or CRLF; provenance hashes use canonical UTF-8 LF.
const textSha256 = text => createHash('sha256').update(text.replace(/\r\n?/g, '\n'), 'utf8').digest('hex');
const profile = JSON.parse(readFileSync(path.join(root, 'handbasic-preview-profile.json'), 'utf8'));
const PI = 3.141592654, VC = 299.792458;
const ER = profile.er, H = profile.dielectricThicknessUm, T = profile.copperThicknessUm;
const ZR = profile.referenceOhm ?? 50;
const [F1, F2] = profile.bandGHz;
const TD = profile.tanDelta;
const rhoNohmM = profile.resistivityNohmM ?? 1e9 / profile.conductivitySPerM;
assert.ok(F1 > 0 && F2 > F1 && H > 0 && T >= 0 && T <= H / 2 && ER >= 1 && ER <= 18);
assert.ok(Number.isFinite(TD) && TD >= 0);
const names = ['rdlloss', 'rdxtalk', 'rfleak', 'stubtest', 'trlset', 'viamatch', 'zcoupon'];
const hashes = Object.fromEntries(names.map(name => [name + '.bas', textSha256(readFileSync(path.join(root, name + '.bas'), 'utf8'))]));
const sourceLines = {
  rdlloss: { synthesis: [1210, 1640], design: [380, 490], response: [2340, 2450] },
  rdxtalk: { synthesis: [1430, 1860], coupledModes: [1870, 2150], response: [590, 700], line: [2160, 2230], cardinal: [11000, 11440] },
  rfleak: { synthesis: [1300, 1730], design: [370, 550], response: [2390, 2500] },
  stubtest: { synthesis: [1120, 1550], design: [340, 460], response: [2140, 2310] },
  trlset: { synthesis: [1210, 1640], design: [350, 450], response: [2330, 2440], coverage: [2220, 2280] },
  viamatch: { synthesis: [1380, 1810], design: [390, 580], alternateMatch: [2370, 2410], response: [2560, 2700], impedance: [2750, 2960] },
  zcoupon: { synthesis: [1230, 1660], design: [330, 360], response: [420, 570], line: [1960, 2030] },
};
const dbAmplitude = amplitude => 20 * Math.log(Math.max(.000001, amplitude)) / Math.log(10);

function airImpedance(u) {
  const factor = 6 + (2 * PI - 6) * Math.exp(-Math.pow(30.666 / u, .7528));
  return 376.7303137 / (2 * PI) * Math.log(factor / u + Math.sqrt(1 + (2 / u) ** 2));
}
function quasiStaticEr(u) {
  let aa = 1 + Math.log((u ** 4 + (u / 52) ** 2) / (u ** 4 + .432)) / 49;
  aa += Math.log(1 + (u / 18.1) ** 3) / 18.7;
  const bb = .564 * ((ER - .9) / (ER + 3)) ** .053;
  return (ER + 1) / 2 + (ER - 1) / 2 * (1 + 10 / u) ** (-aa * bb);
}
function microstrip(width, thickness = T) {
  const u = width / H;
  let du = 0, dr = 0;
  if (thickness) {
    const tt = thickness / H;
    let hx = Math.exp(-2 * Math.sqrt(6.517 * u));
    hx = (1 - hx) / (1 + hx);
    du = tt / PI * Math.log(1 + 4 * Math.exp(1) * hx * hx / tt);
    hx = Math.sqrt(ER - 1);
    hx = 2 / (Math.exp(hx) + Math.exp(-hx));
    dr = du * (1 + hx) / 2;
  }
  const z1 = airImpedance(u + du), z2 = airImpedance(u + dr);
  const ea = quasiStaticEr(u + dr);
  return { impedanceOhm: z2 / Math.sqrt(ea), effectiveEr: ea * (z1 / z2) ** 2 };
}
function synthesize(target) {
  let lo = .01 * H, hi = 100 * H;
  assert.ok(target <= microstrip(lo).impedanceOhm && target >= microstrip(hi).impedanceOhm);
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    if (microstrip(mid).impedanceOhm > target) lo = mid;
    else hi = mid;
  }
  const widthUm = (lo + hi) / 2;
  return { widthUm, ...microstrip(widthUm) };
}
const feed = synthesize(ZR);
assert.ok(Math.abs(feed.impedanceOhm - ZR) < 1e-5);

function losslessLine(impedance, effectiveEr, lengthMm, fGHz) {
  const ph = 2 * PI * fGHz * lengthMm * Math.sqrt(effectiveEr) / VC;
  const ar = 2 * Math.cos(ph), ai = (impedance / ZR + ZR / impedance) * Math.sin(ph);
  const dn = ar * ar + ai * ai, bi = (impedance / ZR - ZR / impedance) * Math.sin(ph);
  return { tr: 2 * ar / dn, tj: -2 * ai / dn, rr: bi * ai / dn, ri: bi * ar / dn };
}
function coupledModes(width, gap) {
  const u = width / H, g = gap / H;
  assert.ok(u >= .1 && u <= 10 && g >= .1 && g <= 10);
  const z1 = airImpedance(u), e1 = quasiStaticEr(u);
  const evenEr = quasiStaticEr(u * (20 + g * g) / (10 + g * g) + g * Math.exp(-g));
  const a0 = .7287 * (e1 - (ER + 1) / 2) * (1 - Math.exp(-.179 * u));
  const b0 = .747 * ER / (.15 + ER);
  const c1 = b0 - (b0 - .207) * Math.exp(-.414 * u);
  const d0 = .593 + .694 * Math.exp(-.562 * u);
  const oddEr = ((ER + 1) / 2 + a0 - e1) * Math.exp(-c1 * g ** d0) + e1;
  const q1 = .8695 * u ** .194;
  const q2 = 1 + .7519 * g + .189 * g ** 2.31;
  const q3 = .1975 + (16.6 + (8.4 / g) ** 6) ** (-.387) + Math.log(g ** 10 / (1 + (g / 3.4) ** 10)) / 241;
  const q4 = q1 / q2 * 2 / (Math.exp(-g) * u ** q3 + (2 - Math.exp(-g)) * u ** (-q3));
  const q5 = 1.794 + 1.14 * Math.log(1 + .638 / (g + .517 * g ** 2.43));
  const q6 = .2305 + Math.log(g ** 10 / (1 + (g / 5.8) ** 10)) / 281.3 + Math.log(1 + .598 * g ** 1.154) / 5.1;
  const q7 = (10 + 190 * g * g) / (1 + 82.3 * g ** 3);
  const q8 = Math.exp(-6.5 - .95 * Math.log(g) - (g / .15) ** 5);
  const q9 = Math.log(q7) * (q8 + 1 / 16.5);
  const q0 = q4 - q5 / q2 * Math.exp(Math.log(u) * q6 * u ** (-q9));
  return { evenOhm: z1 / (1 - z1 * q4 / 377) / Math.sqrt(evenEr), oddOhm: z1 / (1 - z1 * q0 / 377) / Math.sqrt(oddEr), evenEr, oddEr };
}
const frequencies = [...new Set([F1, F2, .5, 1, 5, 10, 20, 40, 67].filter(f => f >= F1 && f <= F2))].sort((a, b) => a - b);
function grid(extra = []) {
  return [...new Set([...Array.from({ length: 2001 }, (_, i) => F1 + (F2 - F1) * i / 2000), ...frequencies, ...extra.filter(f => f >= F1 && f <= F2)])].sort((a, b) => a - b);
}
function sampled(fn) { return frequencies.map(fn); }
const programs = {};

// RDLLoss: retain the source's 0.3um roughness, length constraints and target.
function rdlLoss(fGHz) {
  const ro = rhoNohmM * 1e-9, mu = 4 * PI * 1e-7;
  const skinDepthUm = Math.sqrt(ro / (PI * fGHz * 1e9 * mu)) * 1e6;
  const sr = Math.sqrt(ro * PI * fGHz * 1e9 * mu);
  const kr = 1 + 2 / PI * Math.atan(1.4 * ((profile.roughnessUm ?? .3) / skinDepthUm) ** 2);
  const ki = Math.exp(-1.2 * (feed.impedanceOhm / 376.7303137) ** .7);
  const conductorDbPerMm = 8.685889638 / 1000 * sr / (feed.impedanceOhm * feed.widthUm * 1e-6) * kr * ki;
  const dielectricDbPerMm = ER === 1 ? 0 : 8.685889638 * ER / Math.sqrt(feed.effectiveEr) * (feed.effectiveEr - 1) / (ER - 1) * PI * fGHz / VC * TD;
  return { fGHz, skinDepthUm, conductorDbPerMm, dielectricDbPerMm, totalDbPerMm: conductorDbPerMm + dielectricDbPerMm, thickConductorApproximationValid: T >= 3 * skinDepthUm };
}
const lossMax = rdlLoss(F2), deltaMm = Math.min(.5 / lossMax.totalDbPerMm, 28);
programs.rdlloss = {
  title: 'Conductor and dielectric loss', ports: 'P1 west / P2 east; north/south parked',
  geometry: { roughnessRmsUm: profile.roughnessUm ?? .3, resistivityNohmM: rhoNohmM, shortLengthMm: 2, maxLongLengthMm: 30, targetDeltaDb: .5, deltaLengthMm: deltaMm, middleLengthMm: 2 + deltaMm / 2, longLengthMm: 2 + deltaMm },
  summary: { atFmax: lossMax, attainedDeltaDbAtFmax: deltaMm * lossMax.totalDbPerMm, lowBandSkinDepthUm: rdlLoss(F1).skinDepthUm, minFrequencyForThreeSkinDepthGHz: (rhoNohmM * 1e-9) / (PI * (4 * PI * 1e-7) * (T / 3 * 1e-6) ** 2) / 1e9 },
  samples: sampled(f => ({ ...rdlLoss(f), differentialLossDb: deltaMm * rdlLoss(f).totalDbPerMm })),
  curve: grid().map(rdlLoss),
  limits: ['Assumed loss tangent is frequency independent and is not a verified LTC-25000 broadband measurement.', 'The source uses a roughness-corrected thick-conductor approximation; it flags T < 3 skin depths.', 'No radiation or launch loss; extract differential loss only after calibration and mismatch checks.'],
};

// RDXTALK: source static zero-thickness coupled modes and lossless finite line.
const xtalkVariants = [10, 20, 40].map(gapUm => {
  const mode = coupledModes(45, gapUm);
  function response(fGHz) {
    const even = losslessLine(mode.evenOhm, mode.evenEr, 5, fGHz);
    const odd = losslessLine(mode.oddOhm, mode.oddEr, 5, fGHz);
    return { fGHz,
      nearEndS31Db: dbAmplitude(Math.hypot(even.rr - odd.rr, even.ri - odd.ri) / 2),
      farEndS41Db: dbAmplitude(Math.hypot(even.tr - odd.tr, even.tj - odd.tj) / 2),
      throughS21Db: dbAmplitude(Math.hypot(even.tr + odd.tr, even.tj + odd.tj) / 2) };
  }
  return { label: gapUm + ' um gap', gapUm, mode, samples: sampled(response), curve: grid().map(response) };
});
const pp = profile.probePitchUm, pw = 80, pl = 100, minimumFeed = 500;
const pg = profile.adjacentProbeCentreUm ?? 1000;
let pb = Math.max(minimumFeed, pp + pw / 2 + pp - pw, 45 / 2 + pp - pw), pa = pb + pl / 2;
const minGapOffset = 45 + 20 / 2;
if (Math.hypot(pa, pa + minGapOffset) < pg) { pa = (Math.sqrt(2 * pg * pg - minGapOffset * minGapOffset) - minGapOffset) / 2; pb = pa - pl / 2; }
programs.rdxtalk = {
  title: 'Coupled-line crosstalk', ports: 'P1 west aggressor near; P2 north aggressor far; P3 south victim near; P4 east victim far',
  geometry: { widthUm: 45, coupledLengthMm: 5, baseGapUm: 20, gapsUm: [10, 20, 40], actualFanoutFeedUm: pb, coreEndToPadCentreUm: pa, minAdjacentCentreRuleUm: pg, baseGapAdjacentCentreUm: Math.hypot(pa, pa + 65) },
  summary: { baseGapModes: xtalkVariants[1].mode, baseGapAtFmax: xtalkVariants[1].samples.at(-1) },
  variants: xtalkVariants,
  limits: ['The coupled DUT model has zero metal thickness; 2.2 um copper is used in feed synthesis only.', 'Static Kirschning-Jansen modes with lossless lines; no dielectric/conductor loss, access bends, probe or fanout parasitics.', 'The 1000 um adjustable contact-centre rule is not a certification of MPI probe-body clearance.'],
};

// RFLEAK: series coupling capacitance between two equal reference impedances.
const overlapWidthUm = 80, overlapLengthUm = 100, broadsideGapUm = H, isolationDb = 40;
const capacitancePf = 8.854187817e-6 * ER * overlapWidthUm * overlapLengthUm / broadsideGapUm;
const targetAmplitude = 10 ** (-isolationDb / 20);
const maxCapacitancePf = targetAmplitude / Math.sqrt(1 - targetAmplitude * targetAmplitude) / (4 * PI * F2 * ZR) * 1000;
const fencePitchLimitUm = VC * 1000 / (20 * F2 * Math.sqrt(ER));
const viaCount = Math.ceil(4000 / Math.min(100, fencePitchLimitUm)) + 1;
const leakVariants = [.5, 1, 2].map(areaScale => {
  function response(fGHz) { const x = 4 * PI * fGHz * ZR * capacitancePf * areaScale / 1000; return { fGHz, s21Db: dbAmplitude(x / Math.sqrt(1 + x * x)) }; }
  return { label: areaScale + 'x overlap area', areaScale, capacitancePf: capacitancePf * areaScale, samples: sampled(response), curve: grid().map(response) };
});
programs.rfleak = {
  title: 'Broadside capacitive leakage', ports: 'P1 west / P2 east, both top side; north/south parked',
  geometry: { overlapWidthUm, overlapLengthUm, broadsideGapUm, insulationGapFollowsProfileThickness: true, isolationTargetDb: isolationDb, fenceLengthMm: 4, viaDiameterUm: 40, requestedViaPitchUm: 100 },
  summary: { capacitancePf, maxCapacitancePf, maxOverlapLengthUm: maxCapacitancePf * broadsideGapUm / (8.854187817e-6 * ER * overlapWidthUm), fencePitchLimitUm, actualFencePitchUm: 4000 / (viaCount - 1), viasPerRow: viaCount, nominalAtFmax: leakVariants[1].samples.at(-1), fringingWarning: overlapWidthUm < 5 * broadsideGapUm || overlapLengthUm < 5 * broadsideGapUm },
  variants: leakVariants,
  limits: ['Parallel-plate capacitance omits fringing and radiation; the source warns when plate dimensions are less than five times the gap.', 'The lower-layer pickup uses an access transition to the east top-side probe; the transition is outside this model.', 'Via-fence pitch follows lambda/20 only and predicts no shielding dB. Copper thickness is absent from the plate model.'],
};

// STUBTEST: 70-ohm stub to north-facing P3; reference sweep terminates P3 externally.
const stub = synthesize(70), su = stub.widthUm / H;
const endExtensionUm = .412 * H * (stub.effectiveEr + .3) * (su + .264) / ((stub.effectiveEr - .258) * (su + .8));
const stubLengthMm = VC / (4 * 20 * Math.sqrt(stub.effectiveEr)) - endExtensionUm / 1000;
const stubVariants = [.9, 1, 1.1].map(lengthScale => {
  const physicalLengthMm = stubLengthMm * lengthScale, electricalLengthMm = physicalLengthMm + endExtensionUm / 1000;
  const notchGHz = VC / (4 * electricalLengthMm * Math.sqrt(stub.effectiveEr));
  function response(fGHz) { const ph = 2 * PI * fGHz * electricalLengthMm * Math.sqrt(stub.effectiveEr) / VC, cc = Math.cos(ph), ss = Math.sin(ph); return { fGHz, throughLossDb: -dbAmplitude(2 * Math.abs(cc) / Math.sqrt(4 * cc * cc + (ZR / 70 * ss) ** 2)) }; }
  const notches = [notchGHz, 3 * notchGHz, 5 * notchGHz].filter(f => f <= F2);
  return { label: lengthScale + 'x length', lengthScale, physicalLengthMm, electricalLengthMm, notchGHz, samples: sampled(response), curve: grid(notches).map(response) };
});
programs.stubtest = {
  title: 'Three-port shunt-stub notch', ports: 'P1 west / P2 east / P3 north at the branch end',
  geometry: { stubOhm: 70, designFrequencyGHz: 20, openStub: true, stubWidthUm: stub.widthUm, effectiveEr: stub.effectiveEr, endExtensionUm, nominalPhysicalLengthMm: stubLengthMm },
  summary: { notchFrequenciesGHz: stubVariants.map(v => v.notchGHz), nominalAtFmax: stubVariants[1].samples.at(-1) },
  variants: stubVariants,
  limits: ['Ideal lossless shunt branch with an open-end correction. Tee, launch, radiation and conductor/dielectric loss are omitted.', 'The response is P1-to-P2 with P3 externally open or shorted; a complete three-port S matrix is not calculated.', 'Analytic notch locations are included in the plotting grid; a sparse uniform sweep could miss them.'],
};

// TRLSET: retain five added lines, 1mm thru and 40mm maximum coupon.
const trlLines = [{ id: 0, centreFrequencyGHz: null, deltaLengthMm: 0, dutLengthMm: 1, fits: true }];
for (let j = 1; j <= 5; j++) {
  const centreFrequencyGHz = F1 * (F2 / F1) ** ((j - 1) / 4), deltaLengthMm = VC / (4 * centreFrequencyGHz * Math.sqrt(feed.effectiveEr));
  trlLines.push({ id: j, centreFrequencyGHz, deltaLengthMm, dutLengthMm: 1 + deltaLengthMm, fits: 1 + deltaLengthMm <= 40 });
}
function trlResponse(fGHz) {
  let bestDistance = 1e9, firstLineId = -1, secondLineId = -1, phaseDeg = 0;
  for (let k = 0; k < 5; k++) for (let j = k + 1; j <= 5; j++) {
    if (!trlLines[k].fits || !trlLines[j].fits) continue;
    let phase = 360 * fGHz * Math.abs(trlLines[j].deltaLengthMm - trlLines[k].deltaLengthMm) * Math.sqrt(feed.effectiveEr) / VC;
    phase -= 180 * Math.floor(phase / 180);
    if (phase <= 20 || phase >= 160 || Math.abs(phase - 90) >= bestDistance) continue;
    bestDistance = Math.abs(phase - 90); firstLineId = k; secondLineId = j; phaseDeg = phase;
  }
  return { fGHz, firstLineId, secondLineId, phaseDeg: firstLineId >= 0 ? phaseDeg : null, covered: firstLineId >= 0 };
}
const logCoverage = Array.from({ length: 201 }, (_, i) => trlResponse(F1 * (F2 / F1) ** (i / 200)));
programs.trlset = {
  title: 'Multiline TRL coverage', ports: 'P1 west / P2 east; north/south parked',
  geometry: { lineCount: 5, thruLengthMm: 1, maxDutLengthMm: 40, lines: trlLines },
  summary: { excludedLineIds: trlLines.filter(l => !l.fits).map(l => l.id), uncoveredOf201LogPoints: logCoverage.filter(p => !p.covered).length, sampled201LogPoints: logCoverage, atBandStart: trlResponse(F1), atBandStop: trlResponse(F2) },
  samples: sampled(trlResponse), curve: grid().map(trlResponse),
  limits: ['Only fitting lines are eligible. The longest quarter-wave line may exceed the 40mm default maximum at the low band edge.', 'A usable pair must have phase strictly between 20 and 160 degrees modulo 180. Sampled coverage is not a proof between samples.', 'This is a two-port west/east standard generator and does not supply a full four-head calibration for RDXTALK.'],
};

// VIAMATCH: exact source complex transformations for coax-return surrogate.
const viaGeometry = { studHeightUm: 60, studDiameterUm: 40, viaHeightUm: 40, viaDiameterUm: 25, returnRadiusUm: 90, loadPadRadiusUm: 35, matchFrequencyGHz: 20, loadROhm: 25, loadXOhm: 0, branchRoot: 1 };
const studOhm = 60 / Math.sqrt(ER) * Math.log(180 / 40), viaOhm = 60 / Math.sqrt(ER) * Math.log(180 / 25);
const excessPadCapacitancePf = 8.854187817e-6 * ER * PI * (35 ** 2 - 25 ** 2 / 4) / H;
function shunt(r, x, b) { let dn = r * r + x * x; const gg = r / dn, bb = -x / dn + b; dn = gg * gg + bb * bb; return [gg / dn, -bb / dn]; }
function transform(r, x, zc, lengthMm, fGHz) {
  const ph = 2 * PI * fGHz * lengthMm * Math.sqrt(ER) / VC, cc = Math.cos(ph), ss = Math.sin(ph);
  const nr = zc * r * cc, ni = zc * (x * cc + zc * ss), dr = zc * cc - x * ss, di = r * ss, dn = dr * dr + di * di;
  return [(nr * dr + ni * di) / dn, (ni * dr - nr * di) / dn];
}
function bareVia(fGHz) {
  let [r, x] = shunt(25, 0, 2 * PI * fGHz * excessPadCapacitancePf / 1000);
  [r, x] = transform(r, x, viaOhm, .04, fGHz);
  [r, x] = transform(r, x, studOhm, .06, fGHz);
  return [r, x];
}
const [r0, x0] = bareVia(20);
let matchTopology = 1, seriesXOhm, shuntBSiemens;
if (r0 <= ZR) { const xx = Math.sqrt(r0 * (ZR - r0)); seriesXOhm = xx - x0; shuntBSiemens = xx / (r0 * ZR); }
else {
  matchTopology = 2;
  const gg = r0 / (r0 * r0 + x0 * x0), bb = -x0 / (r0 * r0 + x0 * x0), bt = Math.sqrt(gg / ZR - gg * gg);
  shuntBSiemens = bt - bb; seriesXOhm = bt * ZR / gg;
}
function returnLoss(r, x) { return -dbAmplitude(Math.sqrt(((r - ZR) ** 2 + x * x) / ((r + ZR) ** 2 + x * x))); }
function viaResponse(fGHz) {
  let [r, x] = bareVia(fGHz), bareReturnLossDb = returnLoss(r, x);
  const xx = seriesXOhm * (seriesXOhm < 0 ? 20 / fGHz : fGHz / 20), bc = shuntBSiemens * (shuntBSiemens < 0 ? 20 / fGHz : fGHz / 20);
  if (matchTopology === 1) [r, x] = shunt(r, x + xx, bc);
  else { [r, x] = shunt(r, x, bc); x += xx; }
  return { fGHz, bareReturnLossDb, matchedReturnLossDb: returnLoss(r, x), inputROhm: r, inputXOhm: x };
}
assert.ok(viaResponse(20).matchedReturnLossDb > 119.9);
programs.viamatch = {
  title: 'Stud/via input match', ports: 'P1 west only; east/north/south parked; RL/RX is an internal load',
  geometry: viaGeometry,
  summary: { studOhm, viaOhm, excessPadCapacitancePf, bareROhmAtMatch: r0, bareXOhmAtMatch: x0, matchTopology, seriesXOhm, shuntBSiemens,
    seriesElement: seriesXOhm > 0 ? { type: 'L', valueNh: seriesXOhm / (2 * PI * 20) } : { type: 'C', valuePf: -1000 / (2 * PI * 20 * seriesXOhm) },
    shuntElement: shuntBSiemens > 0 ? { type: 'C', valuePf: 1000 * shuntBSiemens / (2 * PI * 20) } : { type: 'L', valueNh: -1 / (2 * PI * 20 * shuntBSiemens) },
    atMatch: viaResponse(20), atFmax: viaResponse(F2) },
  samples: sampled(viaResponse), curve: grid([20]).map(viaResponse),
  limits: ['Closed cylindrical return and homogeneous ER-filled coax segments are surrogates, not a discrete return-via electromagnetic model.', 'Ideal frequency-scaled lumped match and specified internal load; loss, launch parasitics, component self-resonance and fabrication tolerances are omitted.', 'The one-port quantity is return loss; there is no external east through port or S21 prediction.'],
};

// ZCOUPON: zero-loss finite lines of three physical widths.
const impedanceVariants = [.9, 1, 1.1].map(widthScale => {
  const widthUm = feed.widthUm * widthScale, mode = microstrip(widthUm);
  function response(fGHz) { const s = losslessLine(mode.impedanceOhm, mode.effectiveEr, 5, fGHz); return { fGHz, returnLossDb: -dbAmplitude(Math.hypot(s.rr, s.ri)), throughLossDb: -dbAmplitude(Math.hypot(s.tr, s.tj)) }; }
  return { label: widthScale + 'x width', widthScale, widthUm, impedanceOhm: mode.impedanceOhm, effectiveEr: mode.effectiveEr, stepTdrGamma: (mode.impedanceOhm - ZR) / (mode.impedanceOhm + ZR), oneWayDelayPs: 5 * Math.sqrt(mode.effectiveEr) / VC * 1000, samples: sampled(response), curve: grid().map(response) };
});
programs.zcoupon = {
  title: 'Impedance width variation', ports: 'P1 west / P2 east; north/south parked',
  geometry: { nominalWidthUm: feed.widthUm, dutLengthMm: 5, widthVariationPercent: 10 },
  summary: { nominalDelayPs: impedanceVariants[1].oneWayDelayPs, impedanceOhmByWidth: impedanceVariants.map(v => v.impedanceOhm) },
  variants: impedanceVariants,
  limits: ['Finite-thickness static microstrip cross sections, followed by ideal lossless transmission-line mismatch results.', 'Copper thickness changes the synthesized width and effective parameters; actual conductor/dielectric attenuation is omitted in this program.', 'Nominal return loss reaches the program display floor of 120dB; this is a numerical ideal, not a realizable probe measurement.'],
};

for (const name of names) {
  programs[name].calculationContext = 'Hypothetical grounded-polyimide reference only';
  programs[name].physicalStackApplicable = false;
  programs[name].limits.unshift('Not a prediction for the physical ungrounded 6 um LTC-25000 / 700 um EME-G730 stack. The hypothetical continuous plane below the polyimide is absent in the real device.');
  programs[name].sourceLines = sourceLines[name];
  programs[name].sourceSha256 = hashes[name + '.bas'];
}

// Export figures using standard vector plotting primitives, not generated art.
const escape = text => String(text).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const palette = ['#176a98', '#b65b2d', '#3b8159', '#70559a'];
function plot(name, title, unitLabel, series, range, note) {
  const w = 1100, h = 550, left = 95, right = 35, top = 144, bottom = 124;
  const pw = w - left - right, ph = h - top - bottom;
  const x = f => left + Math.log(f / F1) / Math.log(F2 / F1) * pw;
  const y = v => top + (range[1] - Math.max(range[0], Math.min(range[1], v))) / (range[1] - range[0]) * ph;
  const parts = [`<rect width="${w}" height="${h}" fill="white"/>`, `<text x="${left}" y="27" font-size="22" font-weight="bold" fill="#a12d26">HYPOTHETICAL GROUNDED REFERENCE - NOT ACTUAL STACK</text>`, `<text x="${left}" y="59" font-size="26" font-weight="bold">${escape(title)}</text>`, `<text x="${left}" y="90" font-size="22" fill="#52616e">Assumed er=${ER}, tan(delta)=${TD}, Cu ${T} um, dielectric ${H} um; EME-G730 not solved</text>`];
  let legendX = left;
  series.forEach((s, i) => {
    parts.push(`<line x1="${legendX}" x2="${legendX + 27}" y1="119" y2="119" stroke="${palette[i]}" stroke-width="3"/><text x="${legendX + 35}" y="126" font-size="22">${escape(s.label)}</text>`);
    legendX += 36 + s.label.length * 12 + 35;
  });
  for (const f of [.5, 1, 2, 5, 10, 20, 40, 67].filter(f => f >= F1 && f <= F2)) {
    parts.push(`<line x1="${x(f)}" x2="${x(f)}" y1="${top}" y2="${top + ph}" stroke="#dde3e8"/><text x="${x(f)}" y="${top + ph + 29}" font-size="22" text-anchor="middle">${f}</text>`);
  }
  for (let i = 0; i <= 5; i++) {
    const v = range[0] + (range[1] - range[0]) * i / 5;
    parts.push(`<line x1="${left}" x2="${left + pw}" y1="${y(v)}" y2="${y(v)}" stroke="#dde3e8"/><text x="${left - 15}" y="${y(v) + 6}" font-size="22" text-anchor="end">${Number(v.toFixed(3))}</text>`);
  }
  parts.push(`<rect x="${left}" y="${top}" width="${pw}" height="${ph}" fill="none" stroke="#697c8b"/>`);
  series.forEach((s, i) => {
    const segments = []; let points = [];
    for (const p of s.points) {
      if (p.value === null || !Number.isFinite(p.value)) { if (points.length) segments.push(points); points = []; }
      else points.push(`${x(p.fGHz).toFixed(3)},${y(p.value).toFixed(3)}`);
    }
    if (points.length) segments.push(points);
    for (const segment of segments) parts.push(`<polyline points="${segment.join(' ')}" fill="none" stroke="${palette[i]}" stroke-width="2"/>`);
  });
  const words = note.split(' '), noteLines = [''];
  for (const word of words) { if ((noteLines.at(-1) + word).length > 84) noteLines.push(''); noteLines[noteLines.length - 1] += word + ' '; }
  parts.push(`<text x="${left + pw / 2}" y="${h - 62}" font-size="22" text-anchor="middle">Frequency (GHz, logarithmic axis)</text>`, `<text x="25" y="${top + ph / 2}" font-size="22" text-anchor="middle" transform="rotate(-90 25 ${top + ph / 2})">${escape(unitLabel)}</text>`);
  noteLines.slice(0, 2).forEach((line, i) => parts.push(`<text x="${left}" y="${h - 31 + i * 23}" font-size="22" fill="#52616e">${escape(line.trim())}</text>`));
  const svg = path.join(output, name + '-response.svg');
  writeFileSync(svg, `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" font-family="Arial, sans-serif">${parts.join('\n')}</svg>\n`);
  execFileSync('magick', ['-background', 'white', svg, path.join(output, name + '-response.png')]);
  programs[name].responseFigure = 'handbasic-previews/' + name + '-response.png';
}
const points = (curve, key) => curve.map(p => ({ fGHz: p.fGHz, value: p[key] }));
const lossCeiling = Math.ceil(lossMax.totalDbPerMm * 100) / 100;
plot('rdlloss', 'RDLLoss: differential-line attenuation model', 'Attenuation (dB/mm)', ['conductorDbPerMm', 'dielectricDbPerMm', 'totalDbPerMm'].map((key, i) => ({ label: ['Conductor', 'Dielectric', 'Total'][i], points: points(programs.rdlloss.curve, key) })), [0, lossCeiling], 'Below three skin depths, the source flags the conductor approximation; loss tangent is assumed.');
plot('rdxtalk', 'RDXTALK: 45 um lines, 20 um gap, 5 mm coupled length', 'S-parameter magnitude (dB)', ['nearEndS31Db', 'farEndS41Db', 'throughS21Db'].map((key, i) => ({ label: ['S31 near end', 'S41 far end', 'S21 through'][i], points: points(xtalkVariants[1].curve, key) })), [-80, 0], 'Coupled DUT modes use T=0; plotted values below -80 dB are clipped. Full numeric data retain -120 dB floor.');
plot('rfleak', 'RFLEAK: broadside capacitive overlap coupling', 'S21 magnitude (dB)', leakVariants.map(v => ({ label: v.label, points: points(v.curve, 's21Db') })), [-80, 0], 'Parallel-plate estimate only; no shielding performance is inferred from the via-fence pitch.');
plot('stubtest', 'STUBTEST: P1-P2 response with external P3 termination', 'Through loss (dB)', stubVariants.map(v => ({ label: v.label, points: points(v.curve, 'throughLossDb') })), [0, 60], 'Reference-model two-port response with P3 externally open or shorted; the full three-port S matrix is not calculated.');
plot('trlset', 'TRLSET: best phase among the fitting standard pairs', 'Pair phase modulo 180 (degrees)', [{ label: 'Best usable pair', points: points(programs.trlset.curve, 'phaseDeg') }], [0, 180], 'Only 1 mm thru + lines of total DUT length <=40 mm; gaps indicate no usable pair at sampled frequencies.');
plot('viamatch', 'VIAMATCH: one-port bare and ideally matched input', 'Return loss (dB)', ['bareReturnLossDb', 'matchedReturnLossDb'].map((key, i) => ({ label: ['Bare input', 'Matched input'][i], points: points(programs.viamatch.curve, key) })), [0, 60], 'Ideal lumped match at 20 GHz; displayed return loss capped at 60 dB. This is a one-port surrogate model.');
plot('zcoupon', 'ZCOUPON: 5 mm lines with +/-10% width variation', 'Return loss (dB)', impedanceVariants.map(v => ({ label: v.label, points: points(v.curve, 'returnLossDb') })), [0, 80], 'Lossless mismatch only. Return loss capped at 80 dB; nominal ideal response has a 120 dB numeric floor.');

const result = {
  schemaVersion: 1,
  method: 'Independent JavaScript reference translation of the current parent Hand BASIC source equations; not an app screenshot or full-wave solver.',
  profile,
  profileSha256: textSha256(readFileSync(path.join(root, 'handbasic-preview-profile.json'), 'utf8')),
  modelApplicableToPhysicalStack: false,
  applicability: {
    actualSubstrate: profile.substrate ?? profile.substrateMaterial ?? 'EME-G730 mold resin (user specified)',
    actualGroundLocation: profile.groundPlane?.actualLocation ?? 'No continuous ground plane; only top-side GSG grounds',
    modeledStack: 'Ideal homogeneous LTC-25000 layer over a continuous ground plane, with air above',
    materialStatus: 'er and tan(delta) are illustrative constant assumptions, not verified LTC-25000 or EME-G730 broadband material properties',
    actualMoldStackPredicted: false,
    reasons: ['Physical device has no continuous ground plane, while the reference microstrip equations require one.', 'The 700 um EME-G730 layer and ungrounded multilayer coplanar return field are not modeled.', 'Broadband er and tan(delta) for both materials remain unverified.'],
    copperThicknessToDielectricRatio: T / H,
  },
  common: { feedWidthUm: feed.widthUm, feedEffectiveEr: feed.effectiveEr, feedImpedanceOhm: feed.impedanceOhm, referenceOhm: ZR, sampleFrequenciesGHz: frequencies, curveGrid: '2001 linear points plus exact band endpoints, named sample frequencies and known stub notch frequencies; plotted on logarithmic frequency axis', sourceHashes: hashes },
  programs,
  validation: { feedTargetOhmAbsoluteError: Math.abs(feed.impedanceOhm - ZR), idealViaMatchReturnLossDb: viaResponse(20).matchedReturnLossDb, finiteValuesChecked: true },
};
const sourceChecks = [];
function compare(source, label, actual, expected) {
  assert.ok(Number.isFinite(actual) && Math.abs(actual - expected) <= 2e-11 * Math.max(1, Math.abs(expected)), `${source} ${label}: ${actual} vs ${expected}`);
  sourceChecks.push({ source, label, actual, expected, absoluteError: Math.abs(actual - expected) });
}
const setupEntry = { rdlloss: 380, rdxtalk: 340, rfleak: 370, stubtest: 340, trlset: 350, viamatch: 390, zcoupon: 330 };
for (const name of names) {
  const runtime = new HandBasicPreview(readFileSync(path.join(root, name + '.bas'), 'ascii')).initialize();
  Object.assign(runtime.variables, { ER, H, T, F1, F2, NP: 41, PP: profile.probePitchUm,
    PG: profile.adjacentProbeCentreUm, TD, RS: rhoNohmM, RH: profile.roughnessUm ?? .3, GH: H });
  runtime.run(setupEntry[name]);
  const v = runtime.variables;
  compare(name, '50-ohm physical feed width (um)', v.FW, feed.widthUm);
  compare(name, 'feed effective er', v.FE, feed.effectiveEr);
  if (name === 'rdlloss') {
    compare(name, 'differential length (mm)', v.DL, deltaMm);
    for (const f of [F1, 20, F2]) {
      v.F = f; runtime.run(2340); const expected = rdlLoss(f);
      compare(name, f + ' GHz conductor dB/mm', v.AC, expected.conductorDbPerMm);
      compare(name, f + ' GHz dielectric dB/mm', v.AD, expected.dielectricDbPerMm);
      compare(name, f + ' GHz skin depth (um)', v.DE, expected.skinDepthUm);
    }
  } else if (name === 'rdxtalk') {
    compare(name, 'actual fanout feed (um)', v.PB, pb);
    for (const variant of xtalkVariants) {
      v.W = 45; v.SG = variant.gapUm; runtime.run(1870);
      for (const [key, target] of Object.entries({ ZE: variant.mode.evenOhm, ZO: variant.mode.oddOhm, EV: variant.mode.evenEr, OD: variant.mode.oddEr })) compare(name, variant.gapUm + 'um gap ' + key, v[key], target);
    }
  } else if (name === 'rfleak') {
    for (const [key, target] of Object.entries({ CV: capacitancePf, CM: maxCapacitancePf, LA: programs.rfleak.summary.maxOverlapLengthUm, PM: fencePitchLimitUm, PA: programs.rfleak.summary.actualFencePitchUm, NV: viaCount })) compare(name, key, v[key], target);
  } else if (name === 'stubtest') {
    for (const [key, target] of Object.entries({ SW: stub.widthUm, SE: stub.effectiveEr, SL: stubLengthMm, DE: endExtensionUm })) compare(name, key, v[key], target);
  } else if (name === 'trlset') {
    for (const line of trlLines) {
      compare(name, 'line ' + line.id + ' delta (mm)', runtime.arrays.get('DL').get(String(line.id)), line.deltaLengthMm);
      compare(name, 'line ' + line.id + ' fits', runtime.arrays.get('OK').get(String(line.id)), Number(line.fits));
    }
  } else if (name === 'viamatch') {
    for (const [key, target] of Object.entries({ ZS: studOhm, ZV: viaOhm, CP: excessPadCapacitancePf, R0: r0, X0: x0, XS: seriesXOhm, BS: shuntBSiemens, MT: matchTopology })) compare(name, key, v[key], target);
    v.F = 20; runtime.run(2750);
    compare(name, 'bare input R at 20GHz', v.R, r0);
    compare(name, 'bare input X at 20GHz', v.X, x0);
  } else if (name === 'zcoupon') compare(name, 'nominal width BW (um)', v.BW, feed.widthUm);
}
result.validation.sourceInterpreterCrossChecks = sourceChecks;
result.validation.sourceInterpreterCrossCheckCount = sourceChecks.length;
for (const [name, program] of Object.entries(programs)) {
  for (const curve of [program.curve, ...(program.variants ?? []).map(v => v.curve)].filter(Boolean)) {
    for (const row of curve) for (const [key, value] of Object.entries(row)) if (typeof value === 'number') assert.ok(Number.isFinite(value), `${name} ${key}`);
  }
}
writeFileSync(path.join(output, 'rf-results.json'), JSON.stringify(result, null, 2) + '\n');
const csv = ['program,variant,calculation_context,physical_stack_applicable,f_GHz,quantity,value,unit'];
function addCsv(name, variant, samples) {
  for (const row of samples) for (const [quantity, value] of Object.entries(row)) {
    if (quantity === 'fGHz') continue;
    const unit = quantity.endsWith('DbPerMm') ? 'dB/mm' : quantity.endsWith('Db') ? 'dB' : quantity.endsWith('Um') ? 'um' : quantity.endsWith('Ohm') ? 'ohm' : quantity.endsWith('Deg') ? 'deg' : '';
    csv.push([name, variant, 'hypothetical_grounded_reference', false, row.fGHz, quantity, value ?? '', unit].join(','));
  }
}
for (const [name, program] of Object.entries(programs)) {
  if (program.samples) addCsv(name, 'nominal', program.samples);
  for (const variant of program.variants ?? []) addCsv(name, variant.label, variant.samples);
}
writeFileSync(path.join(output, 'rf-results.csv'), csv.join('\n') + '\n');
console.log(`Generated ${names.length} hypothetical grounded-reference response plots; ${sourceChecks.length} numerical cross-checks passed.`);
