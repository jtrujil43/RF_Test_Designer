// Build the preview gallery and pdflatex source from the final profile/manifests.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildMath, gdsSection } from './report_math.mjs';
const reports = path.dirname(fileURLToPath(import.meta.url));
const root = path.dirname(reports), previews = path.join(root, 'handbasic-previews');
const read = file => JSON.parse(readFileSync(path.join(root, file), 'utf8'));
const profile = read('handbasic-preview-profile.json');
const textHash = value => createHash('sha256').update(String(value).replace(/\r\n?/g, '\n'), 'utf8').digest('hex');
const profileHash = textHash(readFileSync(path.join(root, 'handbasic-preview-profile.json')));
const rf = read('handbasic-previews/rf-preview-manifest.json');
const ring = read('handbasic-previews/resonator2-preview-manifest.json');
const data = read('handbasic-previews/rf-results.json');
const utilities = read('handbasic-previews/utility-preview-manifest.json');
for (const manifest of [rf, ring, data]) assert.equal(manifest.profileSha256, profileHash, 'Stale preview profile');
assert.equal(profile.dielectricThicknessUm, 6);
assert.equal(profile.substrate.thicknessUm, 700);
assert.equal(profile.groundPlane.sourceModelsApplicableToPhysicalStack, false);
assert.equal(data.modelApplicableToPhysicalStack, false);
for (const manifest of [rf, ring]) {
  const items = manifest.previews;
  for (const item of items) {
    const source = item.source || manifest.source;
    const hash = item.sourceSha256 || manifest.sourceSha256;
    assert.equal(textHash(readFileSync(path.join(root, source))), hash, source);
  }
}
for (const item of utilities.programs) assert.equal(textHash(readFileSync(path.join(root, item.source))), item.sourceSha256, item.source);
const assets = path.join(reports, 'assets'); mkdirSync(assets, { recursive: true });
const names = ['physical-stack', 'rdlloss', 'rdxtalk', 'rfleak', 'stubtest', 'stubtest-short', 'trlset', 'viamatch', 'zcoupon',
  'resonator2-dimensions', 'resonator2-circle', 'resonator2-gsg-launch', 'resonator2-modes', 'resonator2-checks', 'resonator2-six-lobes', 'matmul', 'varprec',
  'rdlloss-response', 'rdxtalk-response', 'rfleak-response', 'stubtest-response', 'trlset-response', 'viamatch-response', 'zcoupon-response'];
for (const name of names) {
  const svg = path.join(previews, name + '.svg'), png = path.join(assets, name + '.png');
  if (existsSync(png) && statSync(png).mtimeMs >= statSync(svg).mtimeMs) continue;
  // Rasterize code-native vector artwork at three times its screen resolution.
  execFileSync('magick', ['-density', '288', '-background', 'white', svg, png]);
}
copyFileSync(path.join(root, 'handbasic-preview-profile.json'), path.join(reports, 'profile.json'));
const fmt = (n, digits = 4) => Number(n).toFixed(digits).replace(/0+$/, '').replace(/\.$/, '');
const tex = value => String(value).replace(/[\\&%$#_{}~^]/g, c => ({'\\':'\\textbackslash{}','&':'\\&','%':'\\%','$':'\\$','#':'\\#','_':'\\_','{':'\\{','}':'\\}','~':'\\textasciitilde{}','^':'\\textasciicircum{}'}[c]));
const xml = value => String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const math = buildMath(data, ring);
const specs = [
  { name:'rdlloss', title:'RD LLOSS / differential line loss', plain:'RD LLOSS: differential line loss', ports:'Two ports: P1 west, P2 east; north/south parked.',
    purpose:'Three separate coupons use common launches and short, middle and long line lengths. The intended measurement is the change in attenuation with length.',
    requirement:'The sketch now connects top-side ground rails along each line. Replace microstrip width and attenuation synthesis with ungrounded multilayer CPW and size the rails, slots and identical transitions. Include copper thickness, roughness, both dielectric losses, mismatch and calibration.',
    limit:'The source loss approximation also assumes a thick conductor. At 500 MHz its hypothetical skin depth is about 2.952 um, exceeding the 2.2 um copper thickness. Its three-skin-depth condition is reached only above about 8.102 GHz.',
    caption:'Actual native drawing commands; the printed delta length is a hypothetical grounded-model result.' },
  { name:'rdxtalk', title:'RDXTALK / four-port crosstalk', plain:'RDXTALK: four-port crosstalk', ports:'P1 west, P2 north, P3 south, P4 east. Aggressor W-to-N; victim S-to-E.',
    purpose:'Preserve the two parallel coupled conductors and cardinal access fanouts. P1 drives the aggressor; P2 is through, P3 is near-end and P4 is far-end coupling.',
    requirement:'Define the top-ground layout before solving the coupled CPW modes. Ground rails, slots, corners and finite ground regions all affect coupling. Use a four-port multilayer EM model and calibrate all four probe planes.',
    limit:'The current coupled microstrip calculation uses zero-thickness DUT conductors and omits access bends and probe parasitics. Its 1 mm adjacent landing-centre rule is adjustable and does not establish mechanical clearance of the installed probe bodies.',
    caption:'Four cardinal GSG landings with connected outer grounds and no signal crossover. The coupled pair retains an unshielded central gap.' },
  { name:'rfleak', title:'RFLEAK / via-connected layer transition', plain:'RFLEAK: via-connected layer transition', ports:'Two top-side ports: P1 west, P2 east; north/south parked.',
    purpose:'The west trace is on upper layer L1. A central signal via joins it to the right-hand trace on lower layer L2. Separate G-S-G vias at the east end return all three conductors to the top-side probe pads. Ground rails follow the traces and have their own layer transitions.',
    requirement:'Confirm the second patterned metal layer and define its thickness and dielectric separation. Size the signal and ground vias, rails and slots using a multilayer EM model. This connected structure is not an isolated broadside leakage capacitor.',
    limit:'The retained numerical routines calculate coupling between isolated plates, not this via-connected path. Their capacitance, isolation and via-fence rules must not be interpreted as the response of the new drawing.',
    caption:'Top view: connected G-S-G routing and via locations. Signal side view: upper-left L1 drops to lower-right L2, then returns to L1 at the east pads. Not to scale.' },
  { name:'stubtest', title:'STUBTEST / three-port shunt stubs', plain:'STUBTEST: three-port shunt stubs', ports:'Three ports: P1 west, P2 east, P3 north at the shunt-branch end.',
    purpose:'A shunt branch connects the P1-P2 through line to an accessible north-facing P3 GSG port. For two-port reference sweeps, P3 is externally left open or terminated in a short.',
    requirement:'Design the through line, branch, tee junction and all three GSG ground returns as CPW on the actual two-dielectric stack. Keep P3 accessible for calibrated three-port measurements; apply open/short conditions externally at its reference plane.',
    limit:'The native 70 ohm stub synthesis and 20 GHz notch example use the grounded microstrip reference. The retained response sweep calculates the P1-P2 response with P3 externally open or shorted; it does not calculate the full three-port S matrix or establish physical CPW behavior.',
    caption:'Three-port source artwork with P1 west, P2 east and north-facing P3 at the shunt branch end.' },
  { name:'trlset', title:'TRLSET / multiline calibration standards', plain:'TRLSET: multiline TRL standards', ports:'Two ports: P1 west, P2 east; one standard measured at a time.',
    purpose:'The standards retain a common cross section and launches, with a thru and several extra line lengths. The same reflect reference is used across measurements.',
    requirement:'Use the same connected CPW grounds, slots and stack as the DUTs. Choose line lengths from the actual dispersive propagation constant, then check pairwise phase and calibration conditioning across 0.5 to 67 GHz.',
    limit:'The legacy source uses a homogeneous microstrip effective permittivity. Its two-port west/east standards do not supply the complete four-head calibration needed for the cardinal RDXTALK device.',
    caption:'Native schematic of separate standards; row spacing and drawn lengths are illustrative and not a mask layout.' },
  { name:'viamatch', title:'VIAMATCH / one-port stud and via match', plain:'VIAMATCH: one-port stud/via matching', ports:'One external port: P1 west. The RL/RX load is internal; east/north/south parked.',
    purpose:'The original calculation combines surrogate stud/via impedances and an ideal matching network feeding a specified internal load. Its RF output is input reflection or return loss.',
    requirement:'Specify the actual vertical metal path and its top-side return conductors. Replace the source closed cylindrical return with the fabricated geometry and a multilayer port model. Check finite-Q components and self-resonance.',
    limit:'An ungrounded mold substrate does not provide the assumed cylindrical return. The ideal match and its numerical return-loss floor cannot be treated as realizable device performance. This program has no external east through port or S21 prediction.',
    caption:'The right-hand block is the internal load, not a second external probe landing.' },
  { name:'zcoupon', title:'ZCOUPON / impedance and width variation', plain:'ZCOUPON: impedance and width variation', ports:'Two ports: P1 west, P2 east; separate width-variation coupons.',
    purpose:'The source varies conductor width around a nominal value while retaining a common line length. This is a useful measurement concept for process sensitivity.',
    requirement:'For CPW, specify both signal width and ground slot width, finite ground width and top-ground continuity. Define whether the slot is held fixed or changes with the width DOE. Re-synthesize the nominal geometry on the actual stack.',
    limit:'The printed nominal width of about 12.431 um was synthesized for a hypothetical grounded 6 um dielectric. It is not a validated 50 ohm CPW width on EME-G730.',
    caption:'Native low/nominal/high-width artwork. Three rows are separate devices, not simultaneous probe positions.' },
];
let body = String.raw`\documentclass[10pt,letterpaper]{article}
\usepackage[margin=0.68in]{geometry}
\usepackage[T1]{fontenc}\usepackage{lmodern}
\usepackage{graphicx,xcolor,booktabs,array,longtable,fancyhdr,amsmath,amssymb,pdflscape}
\usepackage[hidelinks]{hyperref}
\definecolor{navy}{HTML}{153047}\definecolor{teal}{HTML}{007C89}
\definecolor{muted}{HTML}{526574}\definecolor{alert}{HTML}{A42D2D}
\setlength{\parindent}{0pt}\setlength{\parskip}{6pt}
\setlength{\headheight}{14pt}\pagestyle{fancy}\fancyhf{}
\fancyhead[L]{\small\color{navy}Hand BASIC preview atlas}
\fancyhead[R]{\small\color{muted}500 MHz to 67 GHz}
\fancyfoot[L]{\footnotesize\color{muted}6 um LTC-25000 / 700 um EME-G730 / as-supplied: no ground plane}
\fancyfoot[R]{\small\thepage}
\newcommand{\pageTitle}[2]{{\LARGE\bfseries\color{navy}#1}\par{\small\color{muted}#2}\par\vspace{7pt}}
\newcommand{\subhead}[1]{\par\addvspace{7pt}\noindent{\large\bfseries\color{teal}#1}\par\nobreak\vspace{2pt}}
\newcommand{\callout}[1]{\begingroup\setlength{\fboxsep}{8pt}\fcolorbox{alert}{white}{\parbox{\dimexpr\linewidth-18pt\relax}{\small\color{alert}#1}}\endgroup\par}
\newcommand{\minihead}[1]{\par\addvspace{4pt}\noindent{\bfseries\color{navy}#1}\par\nobreak\vspace{1pt}}
\newcommand{\response}[2]{\begin{center}\includegraphics[width=.9\linewidth,height=.27\textheight,keepaspectratio]{assets/#1.png}\par\smallskip{\footnotesize\color{muted}#2}\end{center}}
\newcommand{\gdsfig}[2]{\begin{center}\includegraphics[width=.96\linewidth,height=.26\textheight,keepaspectratio]{assets/gds-#1.png}\par\smallskip{\footnotesize\color{muted}#2}\end{center}}
\newcommand{\preview}[2]{\begin{center}\includegraphics[width=.96\linewidth,height=.49\textheight,keepaspectratio]{assets/#1.png}\par\smallskip{\footnotesize\color{muted}#2}\end{center}}
\begin{document}
\pageTitle{Hand BASIC preview atlas}{RF test structures for the supplied copper / polyimide / mold-resin stack}
{\huge\bfseries\color{teal}500 MHz to 67 GHz}\par
\vspace{6pt}
This report collects source-derived previews of all ten Hand BASIC programs in the parent folder: eight RF programs and two mathematical utilities. It records the requested physical stack, preserves the cardinal MPI probe arrangement, and identifies the model changes needed before electrical dimensions or performance can be assigned to this stack.
\subhead{Physical configuration supplied by the user}
\begin{tabular}{@{}p{.37\linewidth}p{.58\linewidth}@{}}\toprule
Frequency range & 0.500 to 67.000 GHz\\
Top copper thickness & 2.2 um\\
Insulation & FUJIFILM LTC-25000 polyimide, 6 um cured thickness\\
Substrate & EME-G730 mold resin, 700 um thick\\
RF grounds, as supplied & Top-side GSG grounds only; no continuous ground plane\\
RF grounds, GDSII cells & Continuous ground plane directly under the 6 um polyimide (layer 1), added by request\\
Installed probes & MPI TITAN, rated to 67 GHz, 150 um adjacent-tip pitch\\\bottomrule
\end{tabular}
\vspace{9pt}
\callout{\textbf{The existing grounded models do not predict the supplied stack.} The BASIC programs synthesize microstrip and, in the ring launch, grounded CPW using a homogeneous dielectric and a continuous return plane. That plane is absent in the supplied stack. All printed impedances, widths, electrical lengths, mode frequencies and response curves inherited from those models are hypothetical reference results. They apply to the GDSII unit cells only because those cells add the plane the models assume.}
\subhead{What this delivery establishes}
The atlas supplies native-source artwork, port assignments, drawing-command records and reproducible generation files. It includes 14 RF drawing views and two utility text views. Schematics show program concepts and are not scaled mask layouts. The mobile Hand BASIC app was not executed.
Published material information located for LTC-25000 and EME-G730 did not establish complex permittivity over this frequency range. No actual-stack impedance, loss, crosstalk, leakage isolation or ring resonance is asserted in this report.
\vfill
{\small\color{muted}Drawing revision 3 November 2026. PDF typeset with pdfLaTeX. Legacy numerical equations remain unchanged.}
\newpage
\pageTitle{Stack and RF return path}{The insulation thickness is not the full electromagnetic substrate height}
\begin{center}\includegraphics[width=.99\linewidth,height=.46\textheight,keepaspectratio]{assets/physical-stack.png}\end{center}
The physical structure is a two-dielectric, top-conductor configuration. Coplanar-waveguide fields occupy air, polyimide and mold resin. A 6 um polyimide coating cannot be substituted for the complete CPW substrate or for a 6 um distance to an absent ground plane. A prober chuck or support underneath the mold may also affect the boundary conditions and belongs in the final model.
\subhead{Connected ground conductors are required}
The revised BASIC drawings connect ground rails to the probe grounds and follow straight lines, bends and stub junctions. The ring has two outer half-ring returns connected to the launch banks, without an isolated inner ground island. These are schematic connectivity corrections, not synthesized CPW dimensions. Define physical widths and slots and model the bends, junctions and any required ground bonds or bridges without shorting the signal.
\subhead{Material properties remain open inputs}
\begin{tabular}{@{}p{.29\linewidth}p{.66\linewidth}@{}}\toprule
LTC-25000 & Grade identified in public process work [2]; verified 0.5--67 GHz Dk/Df not located.\\
EME-G730 & Exact suffix and RF data remain unspecified. Manufacturer G730 Ver. GR information concerns process/mechanical properties [3].\\
Reference calculations & Constant er=3.3 and loss tangent=0.01 are illustrative polyimide assumptions only. No mold Dk or Df was assigned.\\\bottomrule
\end{tabular}
The manufacturer's Dk/Df shown for G314 at 1 MHz are for a different grade and frequency. They are not used for EME-G730. Qucs distinguishes the CPW topology from microstrip and includes finite-substrate and conductor-thickness effects [4,5]; a stack-aware CPW or full-wave model is required here.
`;
body += math.common;
for (const s of specs) {
  body += '\n\\newpage\n\\pageTitle{' + tex(s.title) + '}{' + tex(s.ports) + '}\n';
  body += '\\callout{\\textbf{Source artwork only.} Native numerical labels below belong to the legacy grounded reference and do not establish electrical behavior on the supplied ungrounded stack.}\n';
  body += '\\preview{' + s.name + '}{' + tex(s.caption) + '}\n';
  body += '\\subhead{Measurement concept}\n' + tex(s.purpose) + '\n' + math[s.name] + '\n';
  body += '\\subhead{Changes needed for the supplied stack}\n' + tex(s.requirement) + '\n';
  body += '\\textbf{Specific model limit.} ' + tex(s.limit) + '\n';
  if (s.name === 'rdxtalk') body += '\n\\smallskip\\textbf{Port meaning:} S21 is W-to-N aggressor through, S31 is W-to-S near-end coupling, and S41 is W-to-E far-end coupling. Full four-port calibration is required.\n';
  if (s.name === 'stubtest') body += '\nThe gallery also contains \\texttt{stubtest-short.png}. Both artworks retain the same three accessible ports; open or short is an external P3 test condition.\n';
}
const ringPages = [
  ['resonator2-dimensions','Ring dimensions and source assumptions','The source reports a hypothetical 50 ohm trace of 12.4466 um and a ring radius of 6.0635 mm for an illustrative 5 GHz fundamental. Neither dimension is a synthesized CPW design for the actual mold stack.'],
  ['resonator2-circle','Circular ring and west/east access','Connected outer half-ring ground rails follow the signal and join both launch banks. No floating inner ground island is drawn. Rail and slot dimensions and feed-to-ring coupling still require an ungrounded multilayer model; the legacy numerical model assumes a continuous backplane.'],
  ['resonator2-gsg-launch','GSG launch detail','The 150 um contact pitch is retained. The source launch uses a grounded-CPW approximation of zero metal thickness; its neck and pad impedance labels do not describe this ungrounded stack. The 2.2 um metal thickness must be included in a replacement launch model.'],
  ['resonator2-modes','Nominal resonance-mode page','A 5 GHz illustrative fundamental produces 13 nominal reference modes at 5,10,...,65 GHz. These are unloaded length-model positions, not measured resonances, not actual-stack predictions, and not an S21 passband.'],
  ['resonator2-checks','Native model checks','At 6 um insulation, the source input guard permits at most 0.6 um copper; requested copper is 2.2 um. These host previews evaluate the unchanged equations directly outside that interactive guard. The source also flags both microstrip and GCPW thin-metal conditions.'],
  ['resonator2-six-lobes','Six-lobe source variant','The extra variant uses six cosine lobes at 10 percent depth. It illustrates the source shape parameterization, not a validated alternative for the physical stack. It retains two west/east ports and parked north/south heads.'],
];
body += math.resonator;
for (const [name,title,note] of ringPages) {
  body += '\n\\clearpage\\begin{landscape}\n\\pageTitle{' + tex(title) + '}{RESONATOR2 / legacy grounded-model evaluation / no physical-stack electrical prediction}\n';
  body += '\\begin{center}\\includegraphics[width=.98\\linewidth,height=.76\\textheight,keepaspectratio]{assets/' + name + '.png}\\end{center}\n';
  body += '{\\small ' + tex(note) + '}\n\\end{landscape}\n';
}
body += gdsSection(root, assets);
body += String.raw`
\clearpage
\pageTitle{Mathematical utilities}{Source text previews complete the ten-program Hand BASIC inventory}
\begin{center}\includegraphics[width=.94\linewidth,height=.60\textheight,keepaspectratio]{assets/matmul.png}\end{center}
\begin{center}\includegraphics[width=.94\linewidth,height=.19\textheight,keepaspectratio]{assets/varprec.png}\end{center}
These two programs have no RF frequency, dielectric, copper or probe inputs. The previews extract the actual initial PRINT text and first INPUT prompt; menu actions and arithmetic are not executed by the preview generator.
\newpage
\pageTitle{Archived reference calculations}{Debugging the existing equations; excluded from actual-stack design claims}
\callout{\textbf{This archive does not solve the physical stack.} Microstrip widths and line responses assume a hypothetical continuous plane under the polyimide. Leakage capacitance and via matching use separate idealized plate and closed-return surrogates. The ungrounded multilayer structure is not solved. Agreement with source equations establishes reproducibility only. The GDSII unit cells do draw that continuous plane, so the reference curves describe them but not the as-supplied stack.}
The archive uses er=3.3, loss tangent=0.01, copper resistivity=17.2 nOhm m and RMS roughness=0.3 um. The last two values are retained source defaults; none is a measurement on this fabrication. Source equations were translated independently and checked against the source-driven interpreter at 70 values.
\begin{tabular}{@{}p{.21\linewidth}p{.74\linewidth}@{}}\toprule
Program & Example hypothetical result and interpretation\\\midrule
RD LLOSS & 67 GHz loss: 1.2765 dB/mm. Used only to reproduce the source loss-length calculation.\\
RDXTALK & Base-gap S31=-17.608 dB, S41=-15.472 dB at 67 GHz; coupled microstrip reference only.\\
RFLEAK & 0.038958 pF from the parallel-plate formula with assumed er and 6 um gap.\\
STUBTEST & Open-stub reference length 2.46236 mm for the source 20 GHz example.\\
TRLSET & One long line exceeds 40 mm; remaining eligible pairs cover the 201 sampled reference points. This does not establish physical CPW calibration coverage.\\
VIAMATCH & Ideal matching values 0.18212 nH and 0.15927 pF at 20 GHz depend on the surrogate return and load.\\
ZCOUPON & Nominal reference width 12.43114 um is 50 ohms by the microstrip synthesis. It is not a CPW width.\\\bottomrule
\end{tabular}
\begin{center}\includegraphics[width=.97\linewidth,height=.34\textheight,keepaspectratio]{assets/rdlloss-response.png}\end{center}
The gallery stores all seven response plots under a separate, initially collapsed reference section. Raw results, assumptions, source-line provenance and cross-check results are in \texttt{rf-results.json} and \texttt{rf-results.csv}. No actual-stack S-parameter file is generated.
\newpage
\pageTitle{Files, verification and next design steps}{Reproduce the previews and PDF without changing the BASIC listings}
\subhead{Delivered files}
\begin{tabular}{@{}p{.44\linewidth}p{.51\linewidth}@{}}\toprule
\texttt{handbasic-previews/index.html} & Preview gallery, with RF artwork, utility text and reference-plot sections.\\
\texttt{handbasic-preview-profile.json} & User stack and probes; explicit reference assumptions and model applicability.\\
\texttt{handbasic-previews/*.svg / *.png} & Editable vector artwork and viewing images.\\
\texttt{*-commands.json / *manifest.json} & Source commands, source/profile hashes, calculation entry points and limits.\\
\texttt{reports/build.ps1} & Regenerate previews, data, gallery and report with pdfLaTeX.\\
\texttt{reports/handbasic-ltc25000-eme-g730.tex} & Editable report source.\\
\texttt{reports/report\_math.mjs} & Equations, worked values and expected-data text; its self-checks fail the build if a relation disagrees with \texttt{rf-results.json}.\\
\texttt{gds/gds\_*.bas, gds/*.GDS} & Eight cbmbasic scripts and the generated GDSII unit cells with ground plane.\\
\texttt{gds/verify\_gds.mjs, gds/run\_gds.ps1} & Stream, geometry and connectivity checks; regenerate all cells.\\\bottomrule
\end{tabular}
Run \texttt{powershell -File reports/build.ps1} from the project folder. Node.js, ImageMagick and pdfLaTeX are required. The build checks that all RF manifests use the same profile and unchanged BASIC sources; mathematical text previews are literal extraction. Mobile app behavior, probe-body fit, fabricated dimensions and physical RF performance are not validated by this build.
\subhead{Scope of the program inventory}
All ten parent-folder BASIC programs are represented. The C64-only \texttt{RING67.PRG} is a separate synthetic ideal two-port model, not an additional Hand BASIC program; it is not a solver for this physical stack and is not presented as one.
\subhead{Before assigning fabrication dimensions or RF predictions}
Obtain the complex permittivity of both exact cured material grades over 0.5--67 GHz, together with copper conductivity/roughness and the support/chuck boundary. Define connected top-ground regions, CPW slots, optional bridges, the RFLEAK second metal layer and VIAMATCH return geometry. Then solve the finite-thickness multilayer CPW structures and launches, synthesize the nominal 50 ohm geometry, and check calibration on matching standards. Preserve the existing cardinal port counts and assignments during that redesign.
\subhead{Sources}
{\small
[1] MPI Corporation, \href{https://www.mpi-corporation.com/wp-content/uploads/ASTPDF/MPI-Probe-Selection-Guide.pdf}{Probe Selection Guide}, T67, p.6: 67 GHz family and available GSG pitches. Rating is a probe specification, not a guarantee for the DUT or the complete measurement system.\par
[2] EV Group / FUJIFILM, \href{https://www.swtest.org/swtw_library/2024proc/pdf/W06_03_VARGA_SWTest-2024.pdf}{SWTest 2024 digital-lithography process study}. Identifies LTC 25000 in process trials; it is not broadband dielectric characterization.\par
[3] Sumitomo Bakelite, \href{https://www.sumibe.co.jp/product/it-materials/epoxy/sumikon-eme/}{SUMIKON EME semiconductor encapsulants}. G730 Ver. GR and G314 are separate entries. Exact user grade suffix is unconfirmed.\par
[4] Qucs technical documentation, \href{https://qucs.github.io/tech/node86.html}{Coplanar waveguides}. Topology, finite-substrate and conductor-thickness considerations.\par
[5] Qucs technical documentation, \href{https://qucs.github.io/tech/node75.html}{Single microstrip line}. Source model family and thickness corrections.\par
}
\end{document}
`;
body = body.replaceAll('RD LLOSS', 'RDLLOSS')
  .replaceAll('\\begin{tabular}', '\\par\\noindent\\begin{tabular}')
  .replaceAll('\\end{tabular}', '\\end{tabular}\\par')
  .replaceAll(/\bum\b/g, '\\ensuremath{\\mu\\mathrm{m}}')
  .replace('\\begin{document}', '\\hypersetup{pdftitle={Hand BASIC Preview Atlas: LTC-25000 and EME-G730},pdfauthor={RF Test Designer},pdfsubject={500 MHz to 67 GHz source previews and model applicability}}\n\\begin{document}');
writeFileSync(path.join(reports, 'handbasic-ltc25000-eme-g730.tex'), body);

const cards = (items, reference = false) => items.map(([name,title,caption]) => `<article><h3>${xml(title)}</h3><a href="${name}.svg"><img src="${name}.png" alt="${xml(title)}" loading="lazy"></a><p>${xml(caption)}</p><div><a href="${name}.png">PNG</a> · <a href="${name}.svg">SVG</a>${reference ? '' : ' · <a href="' + name + '-commands.json">Source commands</a>'}</div></article>`).join('\n');
const rfCards = specs.map(s=>[s.name,s.plain,s.caption]);
rfCards.splice(4,0,['stubtest-short','STUBTEST: P3 externally shorted','P3 is externally shorted for the reference response; the DUT remains three-port and its numerical labels are hypothetical grounded-reference values.']);
const ringCards = ringPages.map(([n,t,note])=>[n,'RESONATOR2: '+t,note]);
const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Hand BASIC preview atlas</title><style>
body{margin:0;background:#eef3f7;color:#173047;font:16px/1.55 system-ui,sans-serif}main{max-width:1250px;margin:auto;padding:32px}h1{font-size:38px;line-height:1.15}h2{margin-top:36px}a{color:#006a78}header,.notice{padding:22px;border-radius:12px;background:white;margin-bottom:20px}.notice{border-left:6px solid #a42d2d}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,480px),1fr));gap:20px}article{padding:18px;background:white;border-radius:12px;box-shadow:0 2px 7px #15304712}article h3{margin-top:0}img{max-width:100%;height:auto;display:block}article p{font-size:14px}summary{cursor:pointer;font-size:22px;font-weight:650;padding:18px;background:#fff4ef}code{background:#edf3f7;padding:2px 4px}footer{margin:32px 0;color:#526574}.stack{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:10px}.stack div{background:#eef4f7;padding:12px;border-radius:8px}</style><main>
<header><h1>Hand BASIC preview atlas</h1><p>500 MHz to 67 GHz · <a href="../reports/handbasic-ltc25000-eme-g730.pdf">PDF report</a> · <a href="../handbasic-preview-profile.json">Parameter profile</a></p><div class="stack"><div><b>Top copper</b><br>2.2 µm</div><div><b>Insulation</b><br>6 µm LTC-25000</div><div><b>Mold substrate</b><br>700 µm EME-G730</div><div><b>Probes</b><br>MPI TITAN 67 GHz / 150 µm GSG</div></div></header>
<div class="notice"><b>Actual stack: top-side grounds only, no continuous backplane.</b><p>The source models require a continuous return plane. Native numerical labels and archived response plots are hypothetical grounded-reference results, not predictions for this ungrounded multilayer stack. Verified broadband dielectric data were not available; er=3.3 and tanδ=0.01 are illustrative reference assumptions only. These are source-derived host renders, not mobile-app screenshots or fabrication layouts. The GDSII unit cells in <code>../gds</code> add a continuous ground plane under the polyimide, which is the condition the reference models assume.</p></div>
<section><h2>Physical stack</h2><article><img src="physical-stack.png" alt="Actual two-dielectric stack with top-side GSG grounds and no continuous backplane"><p>Connected CPW grounds and the two-material field distribution must be modeled explicitly.</p></article></section>
<h2>RF coupon artwork</h2><div class="grid">${cards(rfCards)}</div><h2>Ring source views</h2><div class="grid">${cards(ringCards)}</div>
<h2>Mathematical utilities</h2><p>RF and material settings do not apply. These are literal initial source-text previews.</p><div class="grid">${cards([['matmul','MATMUL: matrix library','The actual 25-choice source menu.'],['varprec','VARPREC: integer calculator','The actual initial instructions and first input prompt.']])}</div>
<h2>Reference calculations</h2><details><summary>Hypothetical grounded comparison — excluded from actual-stack predictions</summary><p><a href="rf-results.json">Numerical JSON and validation</a> · <a href="rf-results.csv">CSV table</a></p><div class="grid">${cards(specs.map(s=>[s.name+'-response',s.plain+' / grounded reference','Debugging comparison only. The physical EME-G730 stack has no modeled return plane.']),true)}</div></details>
<footer>All ten parent-folder Hand BASIC programs represented. The C64-only RING67 is a separate synthetic model. Rebuild with <code>powershell -File reports/build.ps1</code>. Profile SHA-256: <code>${profileHash}</code>.</footer></main></html>`;
writeFileSync(path.join(previews, 'index.html'), html.replaceAll('RD LLOSS', 'RDLLOSS'));
writeFileSync(path.join(reports, 'report-manifest.json'), JSON.stringify({ profileSha256: profileHash, textHashConvention: 'SHA-256 of UTF-8 text with CRLF/CR normalized to LF', actualStack: profile,
  physicalStackPrediction: false, rfDrawingViews: 14, utilityTextViews: 2, referenceResponsePlots: 7,
  generatedFigureNames: names, sourceHashes: { ...data.common.sourceHashes, 'resonator2.bas':ring.sourceSha256 },
  numericalValidation: data.validation }, null, 2));
console.log('Created gallery, high-resolution report figures and pdfLaTeX source.');
