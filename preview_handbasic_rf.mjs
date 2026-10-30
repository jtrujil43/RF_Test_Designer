// Render all seven Hand BASIC RF coupon schematics from their native source.
// Usage: node preview_handbasic_rf.mjs [profile.json]
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HandBasicPreview, sha256, xml } from './handbasic-preview-runtime.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const profilePath = path.resolve(process.argv[2] || path.join(root, 'handbasic-preview-profile.json'));
const profileText = readFileSync(profilePath, 'utf8');
const profile = JSON.parse(profileText);
for (const key of ['copperThicknessUm', 'dielectricThicknessUm', 'er', 'probePitchUm']) {
  if (!Number.isFinite(profile[key]) || profile[key] <= 0) throw Error('Missing/invalid profile value ' + key);
}
if (!(profile.bandGHz?.[0] > 0 && profile.bandGHz[1] >= profile.bandGHz[0])) throw Error('Invalid frequency range');
const output = path.join(root, 'handbasic-previews'); mkdirSync(output, { recursive: true });
const shared = {
  ER: profile.er, H: profile.dielectricThicknessUm, T: profile.copperThicknessUm,
  F1: profile.bandGHz[0], F2: profile.bandGHz[1], NP: 41,
  PP: profile.probePitchUm, PG: profile.adjacentProbeCentreUm ?? 1000,
};
const definitions = [
  { name: 'rdlloss', calculation: 380, graphics: 610, extra: {
    TD: profile.tanDelta ?? .01,
    RS: profile.resistivityNohmM ?? 1e9 / (profile.conductivitySPerM ?? 5.8e7),
    RH: profile.roughnessUm ?? .3,
  }, relevant: ['FW', 'FE', 'DL', 'LS', 'LM', 'T', 'TD', 'RS', 'RH'] },
  { name: 'rdxtalk', calculation: 340, graphics: 770, relevant: ['DW', 'SG', 'L', 'FW', 'PA', 'PB', 'PE', 'PG'] },
  { name: 'rfleak', calculation: 370, graphics: 680, extra: { GH: profile.dielectricThicknessUm }, relevant: ['OW', 'OL', 'GH', 'CV', 'PA', 'NV', 'IB'] },
  { name: 'stubtest', calculation: 340, graphics: 560, relevant: ['FC', 'SY', 'SW', 'SL', 'DE', 'ZS'] },
  { name: 'trlset', calculation: 350, graphics: 620, relevant: ['FW', 'FE', 'NL', 'LT', 'LM'] },
  { name: 'viamatch', calculation: 390, graphics: 760, relevant: ['FW', 'FC', 'PD', 'SH', 'VH', 'XS', 'BS', 'MT'] },
  { name: 'zcoupon', calculation: 330, graphics: 610, relevant: ['FW', 'BW', 'L', 'DP'] },
];
const manifest = {
  kind: 'source-derived Hand BASIC host drawing previews',
  textHashConvention: 'SHA-256 of text with CRLF and CR line endings normalized to LF; no other text normalization',
  profile: path.relative(root, profilePath), profileSha256: sha256(profileText),
  material: profile.materialName ?? 'LTC-25000 polyimide', profileValues: profile,
  physicalStackStatus: profile.groundPlane,
  numericalInterpretation: 'ARCHIVED HYPOTHETICAL GROUNDED-POLYIMIDE REFERENCE ONLY. The physical top-side-ground-only multilayer stack is not solved by these source microstrip feed equations.',
  nativeViewport: { x: 0, y: 56, width: 480, height: 300 },
  outputCanvas: { width: 480, height: 356 },
  hostAnnotation: 'Amber header is added outside the original source viewport; original native drawing commands are preserved.',
  limitations: [
    'These are host renderings of native source drawing commands, not screenshots from the mobile Hand BASIC app.',
    'Schematics are not to scale. Their graphical coordinates are the program artwork, not a fabrication layout.',
    'Profile values seed native numerical setup routines; most native drawings do not display the frequency range or material name.',
    'STR$ labels use nine significant digits in this host renderer; native app font metrics and number rendering may differ.',
    'The analytical model coverage and assumptions are documented in the report; material name alone does not define GHz permittivity or loss.',
    'The source homogeneous microstrip feed model requires a continuous ground plane, which is absent from the confirmed physical stack.',
    'Numbers visible in the legacy source artwork are archived hypothetical grounded-model values, not valid dimensions or predictions for the physical stack.',
    'The EME-G730 dielectric constant and loss are unspecified; no mold-resin electrical properties are assigned here.',
  ], previews: [],
};

function render(definition, suffix = '', overrides = {}) {
  const { name, calculation, graphics, extra = {}, relevant } = definition;
  const sourcePath = path.join(root, name + '.bas'), source = readFileSync(sourcePath, 'ascii');
  const runtime = new HandBasicPreview(source).initialize();
  Object.assign(runtime.variables, shared, extra, overrides);
  runtime.run(calculation);
  const parameters = Object.fromEntries([...new Set([...Object.keys(shared), ...relevant])]
    .map(key => [key, runtime.variables[key]]));
  runtime.run(graphics);
  const stem = name + suffix;
  const svg = runtime.svg({ title: name.toUpperCase() + ' Hand BASIC preview',
    metadata: `Legacy grounded-model source artwork, not a physical-stack design. Requested profile: ${profile.bandGHz.join('-')} GHz; ${profile.materialName} ${profile.dielectricThicknessUm} um; copper ${profile.copperThicknessUm} um; EME-G730 ${profile.substrate?.thicknessUm} um. Actual stack has top-side grounds only and no continuous plane. Native numeric labels are archived hypothetical grounded-reference values only. ${profile.probeModel}, ${profile.probePitchUm} um pitch.`,
    banner: ['LEGACY GROUNDED-MODEL ARTWORK',
      'Actual stack: top-side GSG grounds only; no continuous ground plane',
      'Native numbers are hypothetical references, not physical-stack predictions'] });
  writeFileSync(path.join(output, stem + '.svg'), svg);
  execFileSync('magick', ['-background', 'white', path.join(output, stem + '.svg'), path.join(output, stem + '.png')]);
  writeFileSync(path.join(output, stem + '-commands.json'), JSON.stringify(runtime.commands, null, 2) + '\n');
  manifest.previews.push({ name: stem, source: path.relative(root, sourcePath), sourceSha256: sha256(source),
    calculationEntry: calculation, graphicsEntry: graphics, parameters,
    arrays: Object.fromEntries([...runtime.arrays].map(([key, values]) => [key, Object.fromEntries(values)])),
    executedSourceLines: [...runtime.executed].sort((a, b) => a - b), nativeCommandCount: runtime.commands.length,
    setupText: runtime.printed,
    files: [stem + '.svg', stem + '.png', stem + '-commands.json'].map(file => 'handbasic-previews/' + file) });
  console.log(`Rendered ${stem}: ${runtime.commands.length} native source drawing commands`);
}
for (const definition of definitions) render(definition);
render(definitions.find(x => x.name === 'stubtest'), '-short', { SY: 2 });

// This additional figure is explanatory artwork from the user-specified stack,
// not an output of the legacy BASIC model or a solved CPW layout.
const physicalSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="740" viewBox="0 0 1080 740">
<title>Confirmed physical stack and top-side return-path requirement</title>
<desc>${xml(profile.stackAssumption)}</desc>
<defs><marker id="arrow" markerWidth="7" markerHeight="7" refX="3.5" refY="3.5" orient="auto-start-reverse"><path d="M0 0L7 3.5L0 7Z" fill="#334155"/></marker></defs>
<rect width="1080" height="740" fill="white"/>
<g font-family="Arial,sans-serif" fill="#172b45">
<text x="30" y="42" font-size="29" font-weight="bold">Physical stack and top-side return path</text>
<text x="30" y="71" font-size="18">User-specified dimensions; vertical scale and conductor widths are schematic.</text>
<text x="30" y="116" font-size="22" font-weight="bold">Cross-section across the probe landing</text>
<text x="95" y="151" font-size="17">${profile.probeModel}; ${profile.probePitchUm} µm adjacent-tip pitch</text>
<path d="M140 176H320M320 176H500" fill="none" stroke="#334155" marker-start="url(#arrow)" marker-end="url(#arrow)"/>
<text x="206" y="169" font-size="16">${profile.probePitchUm} µm</text><text x="386" y="169" font-size="16">${profile.probePitchUm} µm</text>
<rect x="80" y="200" width="120" height="24" fill="#245e99"/><rect x="285" y="200" width="70" height="24" fill="#b86b19"/><rect x="440" y="200" width="120" height="24" fill="#245e99"/>
<text x="132" y="194" font-size="20" font-weight="bold">G</text><text x="312" y="194" font-size="20" font-weight="bold">S</text><text x="492" y="194" font-size="20" font-weight="bold">G</text>
<rect x="50" y="224" width="540" height="50" fill="#ead8ef" stroke="#916e9a"/>
<text x="140" y="255" font-size="20">${profile.dielectricThicknessUm} µm LTC-25000 polyimide</text>
<rect x="50" y="274" width="540" height="218" fill="#dce8ee" stroke="#93a4af"/>
<text x="139" y="362" font-size="23">${profile.substrate?.thicknessUm} µm EME-G730 mold resin</text>
<text x="111" y="397" font-size="17">Broadband dielectric properties are not supplied.</text>
<path d="M607 200V224M601 200H613M601 224H613M607 224V274M601 274H613M607 274V492M601 492H613" stroke="#334155" fill="none"/>
<text x="621" y="219" font-size="17">${profile.copperThicknessUm} µm Cu</text>
<text x="621" y="255" font-size="17">${profile.dielectricThicknessUm} µm</text>
<text x="621" y="390" font-size="17">${profile.substrate?.thicknessUm} µm</text>
<text x="64" y="525" font-size="21" fill="#a13c21" font-weight="bold">No continuous metal ground plane</text>
<text x="64" y="552" font-size="16">Copper colors distinguish signal (brown) and grounds (blue).</text>
<path d="M723 107V568" stroke="#cbd5e1"/>
<text x="750" y="116" font-size="22" font-weight="bold">Top-view concept</text>
<text x="750" y="144" font-size="17">Return conductors must be designed.</text>
<rect x="768" y="195" width="55" height="280" fill="#245e99"/><rect x="887" y="195" width="22" height="280" fill="#b86b19"/><rect x="973" y="195" width="55" height="280" fill="#245e99"/>
<text x="787" y="184" font-size="22" font-weight="bold">G</text><text x="890" y="184" font-size="22" font-weight="bold">S</text><text x="992" y="184" font-size="22" font-weight="bold">G</text>
<text x="753" y="510" font-size="17">Rail width, gaps and ground ties: TBD</text>
<text x="753" y="536" font-size="17">Concept only; no impedance assigned</text>
<rect x="30" y="588" width="1020" height="112" rx="6" fill="#fff2d7" stroke="#d4aa57"/>
<text x="48" y="617" font-size="19" font-weight="bold">Isolated landing grounds do not define the return path between probe planes.</text>
<text x="48" y="646" font-size="18">Continuous top-side conductors and their connections require a multilayer CPW / EM design.</text>
<text x="48" y="676" font-size="17">No 50-ohm width, gap, or mold-resin permittivity is inferred from the legacy grounded-model artwork.</text>
<text x="30" y="729" font-size="16">Requested band: ${profile.bandGHz[0]}–${profile.bandGHz[1]} GHz | Ground connectivity and material RF data remain design inputs.</text>
</g></svg>\n`;
writeFileSync(path.join(output, 'physical-stack.svg'), physicalSvg);
execFileSync('magick', ['-background', 'white', path.join(output, 'physical-stack.svg'), path.join(output, 'physical-stack.png')]);
manifest.physicalStackFigure = {
  kind: 'Explanatory schematic from user-specified physical stack; not source BASIC artwork or an EM solution',
  files: ['handbasic-previews/physical-stack.svg', 'handbasic-previews/physical-stack.png'],
  dimensionsToScale: false, noGroundPlane: true,
  assignedMoldDielectricProperties: false, assignedCoplanarImpedance: false,
};
writeFileSync(path.join(output, 'rf-preview-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
