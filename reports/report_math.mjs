// Equations, worked values and expected-data tables for the pdfLaTeX report.
// Every closed-form relation printed in the report is re-implemented here and
// compared with handbasic-previews/rf-results.json, so a stale or wrong equation
// fails the build instead of reaching the PDF.
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const C = 299.792458, ETA0 = 376.7303137, MU0 = 4e-7 * Math.PI, Z0 = 50, NP = 8.685889638, PI = Math.PI;
const cx = (re, im = 0) => ({ re, im });
const cadd = (a, b) => cx(a.re + b.re, a.im + b.im);
const csub = (a, b) => cx(a.re - b.re, a.im - b.im);
const cmul = (a, b) => cx(a.re * b.re - a.im * b.im, a.re * b.im + a.im * b.re);
const cdiv = (a, b) => { const n = b.re * b.re + b.im * b.im; return cx((a.re * b.re + a.im * b.im) / n, (a.im * b.re - a.re * b.im) / n); };
const cabs = a => Math.hypot(a.re, a.im);
const db20 = a => 20 * Math.log10(Math.max(cabs(a), 1e-12));
const near = (a, b, tol, label) => assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${label}: ${a} differs from ${b}`);
const N = (x, d = 2) => { const s = Number(x).toFixed(d); return /^-0(\.0+)?$/.test(s) ? s.slice(1) : s; };
const M = (x, d = 2) => '$' + N(x, d) + '$';
const esc = s => String(s).replace(/[\\&%$#_{}~^]/g, c => ({ '\\': '\\textbackslash{}', '&': '\\&', '%': '\\%', '$': '\\$', '#': '\\#', '_': '\\_', '{': '\\{', '}': '\\}', '~': '\\textasciitilde{}', '^': '\\textasciicircum{}' }[c]));
const tab = (cols, header, rows) => `\\begin{tabular}{@{}${cols}@{}}\\toprule\n${header.join(' & ')}\\\\\\midrule\n${rows.map(r => r.join(' & ')).join('\\\\\n')}\\\\\\bottomrule\n\\end{tabular}\n`;
const response = (name, caption) => `\\response{${name}}{${caption}}\n`;

export function buildMath(data, ring) {
  const p = data.programs, prof = data.profile;
  const ER = prof.er, TD = prof.tanDelta, RHO = prof.resistivityNohmM, RH = prof.roughnessUm, H = prof.dielectricThicknessUm, T = prof.copperThicknessUm;
  const FW = data.common.feedWidthUm, EL = data.common.feedEffectiveEr, F = data.common.sampleFrequenciesGHz, FMAX = prof.bandGHz[1];

  // Static microstrip (Hammerstad-Jensen) exactly as the BASIC routines evaluate it.
  const air = u => { const f = 6 + (2 * PI - 6) * Math.exp(-((30.666 / u) ** 0.7528)); return ETA0 / (2 * PI) * Math.log(f / u + Math.sqrt(1 + (2 / u) ** 2)); };
  const hj = W => {
    const u = W / H, tt = T / H, hx = Math.tanh(Math.sqrt(6.517 * u));
    const du1 = tt / PI * Math.log(1 + 4 * Math.E * hx * hx / tt), dur = du1 * (1 + 1 / Math.cosh(Math.sqrt(ER - 1))) / 2;
    const u1 = u + du1, ur = u + dur, z1 = air(u1), z2 = air(ur);
    const a = 1 + Math.log((ur ** 4 + (ur / 52) ** 2) / (ur ** 4 + 0.432)) / 49 + Math.log(1 + (ur / 18.1) ** 3) / 18.7;
    const b = 0.564 * ((ER - 0.9) / (ER + 3)) ** 0.053;
    const ea = (ER + 1) / 2 + (ER - 1) / 2 * (1 + 10 / ur) ** (-a * b);
    return { u, tt, du1, dur, z1, z2, a, b, ea, ee: ea * (z1 / z2) ** 2, z: z2 / Math.sqrt(ea) };
  };
  const hjw = hj(FW);
  near(hjw.z, 50, 1e-6, 'synthesised impedance'); near(hjw.ee, EL, 1e-9, 'synthesised effective permittivity');

  const loss = (f, Z = Z0, W = FW, E = EL) => {
    const ro = RHO * 1e-9, de = Math.sqrt(ro / (PI * f * 1e9 * MU0)) * 1e6, sr = Math.sqrt(ro * PI * f * 1e9 * MU0);
    const kr = 1 + 2 / PI * Math.atan(1.4 * (RH / de) ** 2), ki = Math.exp(-1.2 * (Z / ETA0) ** 0.7);
    const ac = NP / 1000 * sr / (Z * W * 1e-6) * kr * ki, ad = NP * ER / Math.sqrt(E) * (E - 1) / (ER - 1) * PI * f / C * TD;
    return { de, ac, ad, at: ac + ad };
  };
  const rd = p.rdlloss;
  for (const s of rd.samples) { const l = loss(s.fGHz); near(l.at, s.totalDbPerMm, 1e-6, 'loss'); near(l.de, s.skinDepthUm, 1e-6, 'skin depth'); }
  const th = (f, mm, E = EL) => 360 * f * mm * Math.sqrt(E) / C;
  const lam = (f, E = EL) => C / (f * Math.sqrt(E));
  const rdcmm = RHO * 1e-9 / (FW * 1e-6 * T * 1e-6) / 1000, adc = NP * rdcmm / (2 * Z0);
  const fT = RHO * 1e-9 / (PI * MU0 * (T * 1e-6) ** 2) / 1e9;
  const l67 = loss(FMAX);

  const common = String.raw`
\newpage
\pageTitle{Reference relations}{Closed-form models shared by the coupons. Each relation was re-implemented and compared with the stored results when this report was built.}
\callout{\textbf{Scope.} These are the legacy reference models: a homogeneous microstrip over a continuous plane under the ${H} um polyimide, with $\varepsilon_r=${ER}$ and $\tan\delta=${TD}$. They describe the ground-plane GDSII unit cells and the grounded reference curves. They do not describe the as-supplied stack, which has no plane.}
\subhead{Microstrip synthesis and effective permittivity}
With $u=W/h$ and $t'=T/h$, the thickness-corrected widths are
\[ \Delta u_1=\frac{t'}{\pi}\ln\!\left[1+\frac{4e\,\tanh^2\!\sqrt{6.517\,u}}{t'}\right],\qquad \Delta u_r=\Delta u_1\,\frac{1+\operatorname{sech}\sqrt{\varepsilon_r-1}}{2},\qquad u_1=u+\Delta u_1,\quad u_r=u+\Delta u_r. \]
The air-filled impedance and static effective permittivity are
\[ Z_{air}(u)=\frac{\eta_0}{2\pi}\ln\!\left[\frac{f(u)}{u}+\sqrt{1+\frac{4}{u^2}}\right],\qquad f(u)=6+(2\pi-6)\exp\!\left[-\left(\frac{30.666}{u}\right)^{0.7528}\right], \]
\[ \varepsilon_{eff}(u)=\frac{\varepsilon_r+1}{2}+\frac{\varepsilon_r-1}{2}\left(1+\frac{10}{u}\right)^{-ab},\qquad b=0.564\left(\frac{\varepsilon_r-0.9}{\varepsilon_r+3}\right)^{0.053}, \]
\[ a=1+\frac{1}{49}\ln\frac{u^4+(u/52)^2}{u^4+0.432}+\frac{1}{18.7}\ln\!\left[1+\left(\frac{u}{18.1}\right)^3\right]. \]
The reported impedance and thickness-corrected permittivity are
\[ Z_0=\frac{Z_{air}(u_r)}{\sqrt{\varepsilon_{eff}(u_r)}},\qquad \varepsilon_{eff,t}=\varepsilon_{eff}(u_r)\left[\frac{Z_{air}(u_1)}{Z_{air}(u_r)}\right]^{2},\qquad \eta_0=376.7303\ \Omega. \]
A 30-step bisection on $W\in[0.01h,100h]$ finds the width with $Z_0=50\ \Omega$. For $\varepsilon_r=${ER}$, $h=${H}\,\mu\mathrm{m}$ and $T=${T}\,\mu\mathrm{m}$ this gives $u=${N(hjw.u,4)}$, $t'=${N(hjw.tt,4)}$, $\Delta u_1=${N(hjw.du1,4)}$, $\Delta u_r=${N(hjw.dur,4)}$, $a=${N(hjw.a,4)}$, $b=${N(hjw.b,4)}$, $W=${N(FW,3)}\,\mu\mathrm{m}$, $\varepsilon_{eff,t}=${N(EL,4)}$.
The model is static. The Getsinger dispersion corner, $f_p=Z_0/(2\mu_0 h)=${N(Z0 / (2 * MU0 * H * 1e-6) / 1e12, 2)}$ THz, lies far above the 67 GHz band edge, so frequency-independent $Z_0$ and $\varepsilon_{eff}$ are reasonable for a ${H} um dielectric over a plane.
\subhead{Phase, delay and reflection}
\[ v_p=\frac{c}{\sqrt{\varepsilon_{eff}}}=${N(C / Math.sqrt(EL), 1)}\ \mathrm{mm/ns},\qquad \tau=\frac{\ell\sqrt{\varepsilon_{eff}}}{c},\qquad \theta=\frac{360^\circ f\,\ell\sqrt{\varepsilon_{eff}}}{c},\qquad \lambda_g=\frac{c}{f\sqrt{\varepsilon_{eff}}}. \]
At 5 GHz $\lambda_g=${N(lam(5), 3)}$ mm; at 67 GHz $\lambda_g=${N(lam(67), 3)}$ mm and the delay is ${N(Math.sqrt(EL) / C * 1000, 3)} ps/mm. A mismatch to the $Z_0=50\ \Omega$ reference gives
\[ \Gamma=\frac{Z-Z_0}{Z+Z_0},\qquad \mathrm{RL}=-20\log_{10}|\Gamma|,\qquad \mathrm{IL}=-20\log_{10}|S_{21}|. \]
\subhead{Conductor and dielectric attenuation}
With resistivity $\rho$, RMS roughness $\Delta$ and loss tangent $\tan\delta$,
\[ \delta_s=\sqrt{\frac{\rho}{\pi f\mu_0}},\quad R_s=\sqrt{\pi f\mu_0\rho},\quad K_r=1+\frac{2}{\pi}\arctan\!\left[1.4\left(\frac{\Delta}{\delta_s}\right)^{2}\right],\quad K_i=\exp\!\left[-1.2\left(\frac{Z_0}{\eta_0}\right)^{0.7}\right], \]
\[ \alpha_c=8.686\,\frac{R_s}{Z_0W}\,K_rK_i,\qquad \alpha_d=8.686\,\frac{\pi f}{c}\,\frac{\varepsilon_r}{\sqrt{\varepsilon_{eff}}}\,\frac{\varepsilon_{eff}-1}{\varepsilon_r-1}\tan\delta,\qquad \alpha=\alpha_c+\alpha_d\quad[\mathrm{dB\ per\ unit\ length}]. \]
Here $\rho=${RHO}\ \mathrm{n\Omega\,m}$ and $\Delta=${RH}\,\mu\mathrm{m}$. The roughness factor $K_r$ rises from 1 toward 2 as $\delta_s$ falls below $\Delta$. The expression assumes a conductor thick compared with $\delta_s$. At low frequency, where $\delta_s>T$, current fills the ${T} um copper and the loss approaches the dc limit $\alpha_{dc}=8.686\,R'_{dc}/(2Z_0)$ with $R'_{dc}=\rho/(WT)$.
\subhead{What each coupon returns}
{\small
${tab('p{.15\\linewidth}p{.20\\linewidth}p{.25\\linewidth}p{.33\\linewidth}', ['Structure', 'Measurement', 'Raw data', 'Extracted result'], [
    ['RDLLOSS', '2-port, 3 lines', '$S_{21}$ of each length', 'attenuation $\\alpha(f)$ from $\\Delta\\mathrm{IL}/\\Delta L$'],
    ['RDXTALK', '4-port', '$S_{21},S_{31},S_{41}$ vs gap', 'coupling, $Z_e$, $Z_o$, $\\varepsilon_e$, $\\varepsilon_o$'],
    ['RFLEAK', '2-port + dc', '$S_{21}$, $S_{11}$, $R_{dc}$', 'layer-transition loss and reflection'],
    ['STUBTEST', '2-port', '$S_{21}$ notch frequencies', '$\\varepsilon_{eff}$ and stub end effect'],
    ['TRLSET', '2-port standards', 'thru, lines, reflect', '$\\gamma$, $\\varepsilon_{eff}$, reference planes'],
    ['VIAMATCH', '1-port', '$S_{11}$ of bare and matched', '$Z_{in}$, return loss, tolerance'],
    ['ZCOUPON', '2-port', '$S_{11}$, TDR step, delay', '$Z_0$ and $\\tau$ versus width'],
    ['RESONATOR2', '2-port', '$S_{21}$ resonance peaks', '$f_n$, $Q$, $\\varepsilon_{eff}$, $\\alpha$']])}
}
`;

  // RDLLOSS
  const dL = rd.geometry.deltaLengthMm, LS = rd.geometry.shortLengthMm, LM = rd.geometry.middleLengthMm, LL = rd.geometry.longLengthMm;
  const rdrows = rd.samples.map(s => [N(s.fGHz, 1), N(s.skinDepthUm, 3), N(s.conductorDbPerMm, 4), N(s.dielectricDbPerMm, 4), N(s.totalDbPerMm, 4), N(s.totalDbPerMm * LS, 3), N(s.totalDbPerMm * LL, 3), N(s.differentialLossDb, 4)]);
  const rdlloss = String.raw`
\minihead{Governing relations}
Three lines of identical cross section differ only in length. Launches, pads and ground transitions are common to all three and cancel when insertion losses $\mathrm{IL}_i(f)=-20\log_{10}|S_{21,i}|$ are subtracted:
\[ \alpha(f)\simeq\frac{\mathrm{IL}_L(f)-\mathrm{IL}_S(f)}{L_L-L_S}\ \ [\mathrm{dB/mm}],\qquad \alpha=\alpha_c+\alpha_d\quad\text{(Reference relations)}. \]
The long-line increment is sized so that the loss difference at the top of the band equals a chosen value $\mathrm{IL}_\Delta$:
\[ \Delta L=\frac{\mathrm{IL}_\Delta}{\alpha(f_{max})},\qquad L_M=L_S+\tfrac12\Delta L,\qquad L_L=L_S+\Delta L. \]
\minihead{Worked reference values}
At $f_{max}=${FMAX}$ GHz $\alpha_c=${N(l67.ac, 3)}$ and $\alpha_d=${N(l67.ad, 4)}$ dB/mm, so $\alpha=${N(l67.at, 4)}$ dB/mm and the conductor supplies ${N(100 * l67.ac / l67.at, 1)}\% of the loss. For $\mathrm{IL}_\Delta=${N(rd.geometry.targetDeltaDb, 1)}$ dB, $\Delta L=${N(rd.geometry.targetDeltaDb, 1)}/${N(l67.at, 4)}=${N(dL, 4)}$ mm and the three lines are $L_S=${N(LS, 3)}$, $L_M=${N(LM, 3)}$ and $L_L=${N(LL, 3)}$ mm.
The dc limit is $R'_{dc}=\rho/(WT)=${N(rdcmm, 3)}\ \Omega/\mathrm{mm}$, giving $\alpha_{dc}=${N(adc, 4)}$ dB/mm, close to the $${N(rd.samples[0].totalDbPerMm, 4)}$ dB/mm the model returns at 0.5 GHz. The skin depth equals the ${T} um thickness at $f=\rho/(\pi\mu_0T^2)=${N(fT, 2)}$ GHz, and $3\delta_s\le T$ only above $${N(rd.summary.minFrequencyForThreeSkinDepthGHz, 2)}$ GHz, which is where the thick-conductor assumption becomes valid.
\minihead{Expected test data}
Each line gives a smooth $S_{21}$ that falls with frequency. The three curves are parallel and spaced by $\alpha\,\Delta L/2$. The difference $\Delta\mathrm{IL}(f)$ rises from $${N(rd.samples[0].differentialLossDb, 3)}$ dB at 0.5 GHz to $${N(rd.samples[6].differentialLossDb, 3)}$ dB at ${FMAX} GHz. Growth is close to $\sqrt f$ in mid-band (conductor) with a smaller term linear in $f$ (dielectric). Below about $${N(fT, 1)}$ GHz the curve flattens toward the dc limit. The 0.5 GHz difference of a few hundredths of a dB is comparable to the repeatability of a calibrated VNA trace, so low-frequency points should be averaged or fitted to the $\sqrt f$ plus $f$ form rather than read directly. The longest line is $${N(LL / lam(FMAX), 2)}$ guided wavelengths at ${FMAX} GHz, so a mismatch ripple appears on $S_{11}$ if the launch is not 50 $\Omega$.
${tab('rrrrrrrr', ['$f$ (GHz)', '$\\delta_s$ ($\\mu$m)', '$\\alpha_c$', '$\\alpha_d$', '$\\alpha$', 'IL short', 'IL long', '$\\Delta$IL'], rdrows)}
{\footnotesize Attenuation columns in dB/mm; IL columns in dB for the ${N(LS, 3)} mm and ${N(LL, 3)} mm lines; $\Delta$IL is long minus short.}
${response('rdlloss-response', 'Reference conductor, dielectric and total loss versus frequency (grounded reference model).')}`;

  // RDXTALK
  const xt = p.rdxtalk, ell = xt.geometry.coupledLengthMm;
  const cl = (f, Z, E) => { const t = 2 * PI * f * ell * Math.sqrt(E) / C, s = Math.sin(t), c = Math.cos(t), den = cx(2 * c, (Z / Z0 + Z0 / Z) * s); return { T: cdiv(cx(2), den), G: cdiv(cx(0, (Z / Z0 - Z0 / Z) * s), den) }; };
  for (const v of xt.variants) for (const s of v.samples) {
    const e = cl(s.fGHz, v.mode.evenOhm, v.mode.evenEr), o = cl(s.fGHz, v.mode.oddOhm, v.mode.oddEr), h2 = z => cx(z.re / 2, z.im / 2);
    near(db20(h2(csub(e.G, o.G))), s.nearEndS31Db, 1e-6, 'S31'); near(db20(h2(csub(e.T, o.T))), s.farEndS41Db, 1e-6, 'S41'); near(db20(h2(cadd(e.T, o.T))), s.throughS21Db, 1e-6, 'S21');
  }
  const xv = xt.variants, x20 = xv.find(v => v.gapUm === 20), x20m = x20.mode;
  const xrows = F.map((f, i) => [N(f, 1), ...xv.map(v => M(v.samples[i].nearEndS31Db, 1)), ...xv.map(v => M(v.samples[i].farEndS41Db, 1)), M(x20.samples[i].throughS21Db, 2)]);
  const rdxtalk = String.raw`
\minihead{Governing relations}
The two adjacent conductors are resolved into even and odd modes with impedances $Z_e,Z_o$ and permittivities $\varepsilon_e,\varepsilon_o$. For a section of length $\ell$ in a $Z_0$ system, each mode $m\in\{e,o\}$ has electrical length $\theta_m=2\pi f\ell\sqrt{\varepsilon_m}/c$ and
\[ T_m=\frac{2}{2\cos\theta_m+j\!\left(\frac{Z_m}{Z_0}+\frac{Z_0}{Z_m}\right)\sin\theta_m},\qquad \Gamma_m=\frac{j\!\left(\frac{Z_m}{Z_0}-\frac{Z_0}{Z_m}\right)\sin\theta_m}{2\cos\theta_m+j\!\left(\frac{Z_m}{Z_0}+\frac{Z_0}{Z_m}\right)\sin\theta_m}. \]
The four-port parameters (P1 aggressor near, P2 aggressor far, P3 victim near, P4 victim far) follow from superposition:
\[ S_{11}=\tfrac12(\Gamma_e+\Gamma_o),\quad S_{21}=\tfrac12(T_e+T_o),\quad S_{31}=\tfrac12(\Gamma_e-\Gamma_o),\quad S_{41}=\tfrac12(T_e-T_o). \]
The mode data are recovered from a measurement by the inverse relations $\Gamma_e=S_{11}+S_{31}$, $\Gamma_o=S_{11}-S_{31}$, $T_e=S_{21}+S_{41}$ and $T_o=S_{21}-S_{41}$. The coupling coefficient is $k_c=(Z_e-Z_o)/(Z_e+Z_o)$. Near-end coupling needs only $Z_e\ne Z_o$. Far-end coupling needs a velocity difference $\varepsilon_e\ne\varepsilon_o$ or a mismatch, because the two modes then arrive with different phase.
\minihead{Worked reference values}
For the ${x20.gapUm} um gap, $Z_e=${N(x20m.evenOhm, 3)}\ \Omega$, $Z_o=${N(x20m.oddOhm, 3)}\ \Omega$, $\varepsilon_e=${N(x20m.evenEr, 3)}$, $\varepsilon_o=${N(x20m.oddEr, 3)}$, so $k_c=${N((x20m.evenOhm - x20m.oddOhm) / (x20m.evenOhm + x20m.oddOhm), 4)}$ and $\sqrt{Z_eZ_o}=${N(Math.sqrt(x20m.evenOhm * x20m.oddOhm), 2)}\ \Omega$. Over the ${N(ell, 1)} mm coupled length at ${FMAX} GHz, $\theta_e-\theta_o=${N(th(FMAX, ell, x20m.evenEr) - th(FMAX, ell, x20m.oddEr), 1)}^\circ$. The first quarter-wave of the even mode occurs near $${N(C / (4 * ell * Math.sqrt(x20m.evenEr)), 2)}$ GHz.
\minihead{Expected test data}
At low frequency $S_{31}$ and $S_{41}$ rise at 20 dB per decade, which is 6 dB per octave. For the ${x20.gapUm} um gap $S_{31}$ moves from $${N(x20.samples[0].nearEndS31Db, 1)}$ dB at 0.5 GHz to $${N(x20.samples[1].nearEndS31Db, 1)}$ dB at 1 GHz. Coupling flattens and ripples once the coupled section is about a quarter wavelength, near 9 GHz, then continues to rise to $${N(x20.samples[6].nearEndS31Db, 1)}$ dB (near end) and $${N(x20.samples[6].farEndS41Db, 1)}$ dB (far end) at ${FMAX} GHz. Doubling the gap lowers low-frequency coupling by about 6.5 dB per step ($${N(xv[0].samples[0].nearEndS31Db, 1)}$, $${N(xv[1].samples[0].nearEndS31Db, 1)}$, $${N(xv[2].samples[0].nearEndS31Db, 1)}$ dB at 0.5 GHz for 10, 20, 40 um).
The through path is not a flat 0 dB. The coupled lines are about 21 $\Omega$, so the 50 $\Omega$ ports see a mismatch and $S_{21}$ dips to $${N(x20.samples[3].throughS21Db, 2)}$ dB at 10 GHz and $${N(x20.samples[6].throughS21Db, 2)}$ dB at ${FMAX} GHz in this lossless model. A real device adds conductor loss on top.
${tab('r*{3}{r}*{3}{r}r', ['$f$ (GHz)', '$S_{31}$ 10', '$S_{31}$ 20', '$S_{31}$ 40', '$S_{41}$ 10', '$S_{41}$ 20', '$S_{41}$ 40', '$S_{21}$ 20'], xrows)}
{\footnotesize Columns in dB; the numbers 10, 20 and 40 are the gap in $\mu$m. $S_{21}$ is for the 20 $\mu$m gap.}
${response('rdxtalk-response', 'Reference near-end, far-end and through response for the three gaps (grounded reference model).')}`;

  // RFLEAK
  const rl = p.rfleak;
  for (const v of rl.variants) for (const s of v.samples) { const X = 4 * PI * s.fGHz * 1e9 * Z0 * v.capacitancePf * 1e-12; near(20 * Math.log10(X / Math.sqrt(1 + X * X)), s.s21Db, 1e-6, 'rfleak'); }
  const VD = 40, PP = 150, hv = H, rvia = VD / 2;
  const Rv = RHO * 1e-9 * hv * 1e-6 / (PI * (rvia * 1e-6) ** 2), Lv = MU0 * hv * 1e-6 / (2 * PI) * Math.log(PP / rvia);
  const viaS = f => { const zs = cx(2 * Rv, 2 * 2 * PI * f * 1e9 * Lv), den = cadd(cx(2 * Z0), zs); return { s21: db20(cdiv(cx(2 * Z0), den)), s11: db20(cdiv(zs, den)) }; };
  const lenSig = 5, rdcSig = rdcmm * lenSig + 2 * Rv;
  const rfrows = F.map(f => { const v = viaS(f); return [N(f, 1), N(loss(f).at * lenSig, 3), M(v.s21, 4), M(v.s11, 1)]; });
  const plate = rl.variants, prow = F.map((f, i) => [N(f, 1), ...plate.map(v => M(v.samples[i].s21Db, 2))]);
  const rfleak = String.raw`
\minihead{Governing relations}
The drawn coupon is a connected path: M2 pads and feeds, a ${N(4, 0)} mm M1 line, and V1 transitions at each end with ground vias at $\pm${PP}\,\mu\mathrm{m}$. Its direct-current resistance and the series impedance of the two transitions are
\[ R_{dc}=\frac{\rho\,\ell}{WT}+2R_v,\qquad R_v=\frac{\rho h_v}{\pi r_v^2},\qquad L_v=\frac{\mu_0h_v}{2\pi}\ln\frac{b}{r_v},\qquad Z_s=2\,(R_v+j\omega L_v), \]
\[ S_{21}=\frac{2Z_0}{2Z_0+Z_s},\qquad S_{11}=\frac{Z_s}{2Z_0+Z_s}. \]
Here $r_v$ is the via radius and $b$ is the distance to the return via; $L_v$ is the coaxial estimate used by the VIAMATCH surrogate. The line itself adds $\mathrm{IL}=\alpha(f)\,\ell$ from the Reference relations.
The legacy isolated-plate model, kept for comparison, treats the overlap as a series capacitor:
\[ C=\frac{\varepsilon_0\varepsilon_rO_WO_L}{g},\qquad X=4\pi fZ_0C,\qquad |S_{21}|=\frac{X}{\sqrt{1+X^2}}. \]
\minihead{Worked reference values}
No second-metal separation is defined, so $h_v=${H}\,\mu\mathrm{m}$ is assumed. With $r_v=${rvia}\,\mu\mathrm{m}$ and $b=${PP}\,\mu\mathrm{m}$: $R_v=${N(Rv * 1e6, 1)}\ \mu\Omega$ and $L_v=${N(Lv * 1e12, 2)}$ pH, so the pair of transitions adds $X=${N(2 * 2 * PI * FMAX * 1e9 * Lv, 2)}\ \Omega$ at ${FMAX} GHz. The signal path is about $4\ \mathrm{mm}$ of M1 plus $2\times0.5\ \mathrm{mm}$ of M2 feed, $\ell=${lenSig}$ mm, so $R_{dc}\approx${N(rdcSig, 2)}\ \Omega$ if M2 has the same width and thickness as M1. For the plate model, $C=${N(rl.summary.capacitancePf, 5)}$ pF for the $${rl.geometry.overlapWidthUm}\times${rl.geometry.overlapLengthUm}\ \mu\mathrm{m}$ overlap and a ${rl.geometry.broadsideGapUm} um gap, and $|S_{21}|$ reaches the ${rl.geometry.isolationTargetDb} dB target only for $C\le${N(rl.summary.maxCapacitancePf * 1000, 3)}$ fF.
\minihead{Expected test data}
For the drawn path the measured $S_{21}$ is a low-loss through response. It follows the line loss with a small extra drop from the transitions, and $S_{11}$ stays well below $-30$ dB until the vias become electrically large. A dc four-wire measurement between the signal pads should read a few ohms and confirms continuity of both V1 transitions. A single via has under $${N(Rv * 1e3, 1)}$ m$\Omega$ here, so a via chain or a through coupon without vias is needed to resolve it. Comparing against a no-via through line of the same length isolates the transition: any $\Delta S_{21}$ beyond a few hundredths of a dB indicates an unexpected via resistance or a layer-to-layer dielectric gap.
${tab('rrrr', ['$f$ (GHz)', 'line IL, 5 mm (dB)', 'via pair $S_{21}$ (dB)', 'via pair $S_{11}$ (dB)'], rfrows)}
The reference isolated-plate model gives the opposite behaviour: a capacitive isolation that falls from tens of dB toward 0 dB as frequency rises.
${tab('rrrr', ['$f$ (GHz)', ...plate.map(v => '$S_{21}$, ' + v.areaScale + '$\\times$ area')], prow)}
{\footnotesize $S_{21}$ in dB for the legacy plate model. Doubling the overlap area doubles $C$ and raises $S_{21}$ by 6 dB at low frequency.}
${response('rfleak-response', 'Legacy isolated-plate leakage versus frequency for three overlap areas. It is not the response of the drawn via-connected path.')}`;

  // STUBTEST
  const sb = p.stubtest, sg = sb.geometry, Es = sg.effectiveEr;
  const stubIL = (f, el) => 10 * Math.log10(1 + (Z0 * Math.tan(2 * PI * f * el * Math.sqrt(Es) / C) / (2 * sg.stubOhm)) ** 2);
  for (const v of sb.variants) for (const s of v.samples) if (s.throughLossDb < 100) near(stubIL(s.fGHz, v.electricalLengthMm), s.throughLossDb, 1e-6, 'stub');
  const sv = sb.variants, selNom = sv.find(v => v.lengthScale === 1).electricalLengthMm;
  const als = loss(sg.designFrequencyGHz, sg.stubOhm, sg.stubWidthUm, Es).at / NP, ys = Z0 / sg.stubOhm;
  const depth = 20 * Math.log10(2 / (2 + ys / Math.tanh(als * selNom)));
  const sbrows = sv.map(v => [v.label.replace('x', '$\\times$'), N(v.physicalLengthMm, 3), N(v.notchGHz, 2), N(3 * v.notchGHz, 2), N(v.notchGHz * v.electricalLengthMm, 2), M(v.samples[3].throughLossDb, 2), M(v.samples[6].throughLossDb, 2)]);
  const stubtest = String.raw`
\minihead{Governing relations}
A shunt stub of impedance $Z_s$ and electrical length $\theta_s=2\pi f\ell_{eff}\sqrt{\varepsilon_s}/c$ loads the through line with
\[ Y_{open}=j\,\frac{\tan\theta_s}{Z_s},\qquad Y_{short}=-j\,\frac{\cot\theta_s}{Z_s},\qquad S_{21}=\frac{2}{2+Z_0Y_{in}}, \]
\[ \mathrm{IL}_{open}=10\log_{10}\!\left[1+\left(\frac{Z_0\tan\theta_s}{2Z_s}\right)^{2}\right],\qquad \mathrm{IL}_{short}=10\log_{10}\!\left[1+\left(\frac{Z_0\cot\theta_s}{2Z_s}\right)^{2}\right]. \]
An open stub notches where $\theta_s=(2k-1)\pi/2$; a short stub notches where $\theta_s=k\pi$:
\[ \ell_{open}=\frac{c}{4f_c\sqrt{\varepsilon_s}}-\Delta\ell,\qquad \ell_{short}=\frac{c}{2f_c\sqrt{\varepsilon_s}},\qquad f_k=(2k-1)\,f_c\ \ (\text{open}). \]
The open-end extension is $\Delta\ell=0.412\,h\,\dfrac{(\varepsilon_s+0.3)(u_s+0.264)}{(\varepsilon_s-0.258)(u_s+0.8)}$ with $u_s=W_s/h$. A lossy stub does not null completely. With stub attenuation $\alpha_s$ in Np per unit length, $Y_{open}$ at resonance is $\coth(\alpha_s\ell)/Z_s$, so the notch depth is
\[ S_{21,min}=\frac{2}{2+\dfrac{Z_0}{Z_s}\coth(\alpha_s\ell)}. \]
\minihead{Worked reference values}
A $${sg.stubOhm}\ \Omega$ stub gives $W_s=${N(sg.stubWidthUm, 3)}\,\mu\mathrm{m}$, $\varepsilon_s=${N(Es, 4)}$ and $\Delta\ell=${N(sg.endExtensionUm, 3)}\,\mu\mathrm{m}$. For $f_c=${sg.designFrequencyGHz}$ GHz, $\ell=${N(C / (4 * sg.designFrequencyGHz * Math.sqrt(Es)), 5)}-${N(sg.endExtensionUm / 1000, 6)}=${N(sg.nominalPhysicalLengthMm, 5)}$ mm. The stub is much narrower than the 50 $\Omega$ line, so its loss is larger: $\alpha_s=${N(als * NP, 3)}$ dB/mm at ${sg.designFrequencyGHz} GHz from the Reference relations, which limits the nominal notch to $S_{21,min}=${N(depth, 1)}$ dB instead of $-\infty$.
\minihead{Expected test data}
$S_{21}$ is near 0 dB at low frequency, then shows a sharp notch at $f_1$ and a second notch at $3f_1$, both inside the 0.5 to ${FMAX} GHz band. The three stubs move the notch by the inverse of their length ($\pm10\%$ length gives $\mp10\%$ frequency). The product $f_1\ell_{eff}$ should be the same for all three stubs and equals $c/(4\sqrt{\varepsilon_s})=${N(C / (4 * Math.sqrt(Es)), 2)}$ GHz\,mm, so any spread shows an error in the stub end effect rather than in $\varepsilon_{eff}$. A measurement of $f_1$ gives $\varepsilon_s=[c/(4f_1\ell_{eff})]^2$. The measured notch will be around $${N(depth, 0)}$ dB deep, not the 120 dB cap of the ideal calculation, because stub loss limits it.
${tab('lrrrrrr', ['Stub', '$\\ell$ (mm)', '$f_1$ (GHz)', '$3f_1$ (GHz)', '$f_1\\ell_{eff}$', 'IL at 10 GHz', 'IL at ' + FMAX + ' GHz'], sbrows)}
{\footnotesize IL in dB from the lossless stub model; $f_1\ell_{eff}$ in GHz mm.}
${response('stubtest-response', 'Reference through loss of the open stub for 0.9, 1.0 and 1.1 times the nominal length (grounded reference model).')}`;

  // TRLSET
  const tr = p.trlset, tl = tr.geometry.lines;
  const bandOf = L => [20 / 360 * C / (L.deltaLengthMm * Math.sqrt(EL)), 160 / 360 * C / (L.deltaLengthMm * Math.sqrt(EL))];
  const trrows = tl.filter(L => L.id > 0).map(L => { const b = bandOf(L); return [String(L.id), N(L.centreFrequencyGHz, 3), N(L.deltaLengthMm, 3), N(L.dutLengthMm, 3), N(b[0], 2) + '--' + N(b[1], 2), L.fits ? 'yes' : 'no']; });
  const trraw = tl.filter(L => L.fits && L.id > 0).map(L => [String(L.id), N(L.dutLengthMm, 3), N(loss(L.centreFrequencyGHz).at * L.dutLengthMm, 2), N(loss(FMAX).at * L.dutLengthMm, 1)]);
  const trsm = tr.samples.map(s => [N(s.fGHz, 1), s.firstLineId + '--' + s.secondLineId, N(s.phaseDeg, 1), N(1 / Math.abs(Math.sin(s.phaseDeg * PI / 180)), 2)]);
  const trlset = String.raw`
\minihead{Governing relations}
Multiline TRL measures several lines of known length differences and recovers the propagation constant $\gamma=\alpha+j\beta$. Line $j$ is centred where its length difference from the thru is a quarter wavelength, and the centres are spaced geometrically across the band:
\[ f_{c,j}=F_1\left(\frac{F_2}{F_1}\right)^{\frac{j-1}{N_L-1}},\qquad \Delta L_j=\frac{c}{4f_{c,j}\sqrt{\varepsilon_{eff}}},\qquad L_j=L_{thru}+\Delta L_j. \]
A pair $(i,j)$ is usable when its phase difference lies between $20^\circ$ and $160^\circ$, and the calibration error grows roughly as $1/|\sin\Delta\theta|$:
\[ \Delta\theta_{ij}=\frac{360^\circ f\,|L_i-L_j|\sqrt{\varepsilon_{eff}}}{c},\qquad 20^\circ\le\Delta\theta_{ij}\le160^\circ. \]
The calibration solves for the eigenvalues of the line-thru transfer-matrix ratio, $\lambda=e^{-\gamma\Delta L}$, so
\[ \gamma=-\frac{\ln\lambda}{\Delta L},\qquad \varepsilon_{eff}=\left(\frac{\beta c}{2\pi f}\right)^{2}. \]
The reflect standard fixes the reference plane. For an open with end extension $\Delta\ell_o$, $\Gamma_{open}=e^{-j2\beta\Delta\ell_o}$ is within a few degrees of $+1$ at these dimensions.
\minihead{Worked reference values}
With $F_1=0.5$ GHz, $F_2=${FMAX}$ GHz and $N_L=${tr.geometry.lineCount}$, the line centres are ${tl.filter(L => L.id > 0).map(L => N(L.centreFrequencyGHz, 2)).join(', ')} GHz and the length differences are ${tl.filter(L => L.id > 0).map(L => N(L.deltaLengthMm, 2)).join(', ')} mm. Line 1 would be ${N(tl[1].dutLengthMm, 1)} mm long, which exceeds the ${tr.geometry.maxDutLengthMm} mm limit, so it is dropped. The remaining pairs still cover all ${tr.summary.sampled201LogPoints.length} logarithmically spaced points with ${tr.summary.uncoveredOf201LogPoints} uncovered.
\minihead{Expected test data}
Every standard returns $|S_{21}|=e^{-\alpha L}$ with a phase ramp $-\beta L$ that wraps repeatedly across the band. After calibration the lines give a smooth $\varepsilon_{eff}\approx${N(EL, 3)}$ and an $\alpha(f)$ curve matching the RDLLOSS coupon. The thru and the lines are only usable inside their phase windows, and outside them the extracted $\gamma$ becomes noisy. Because the longest line loses $${N(loss(FMAX).at * tl[2].dutLengthMm, 0)}$ dB at ${FMAX} GHz, it is excluded there by the selection rule rather than by the VNA dynamic range. The open reflect shows $|S_{11}|\approx1$ with a phase that falls with frequency.
${tab('crrrcc', ['Line', '$f_c$ (GHz)', '$\\Delta L$ (mm)', '$L$ (mm)', 'usable $20^\\circ$--$160^\\circ$ (GHz)', 'fits'], trrows)}
${tab('rrrr', ['Line', '$L$ (mm)', 'IL at $f_c$ (dB)', 'IL at ' + FMAX + ' GHz (dB)'], trraw)}
${tab('rcrr', ['$f$ (GHz)', 'pair', '$\\Delta\\theta$ ($^\\circ$)', '$1/|\\sin\\Delta\\theta|$'], trsm)}
{\footnotesize The last table lists the pair the selection rule picks at each sample frequency.}
${response('trlset-response', 'Pair phase difference across the band for the selected line pairs (grounded reference model).')}`;

  // VIAMATCH
  const vm = p.viamatch, vg = vm.geometry, vsum = vm.summary;
  const ZS = vsum.studOhm, ZV = vsum.viaOhm, CP = vsum.excessPadCapacitancePf;
  const tlz = (ZL, Zc, mm, f) => { const t = Math.tan(2 * PI * f * mm * Math.sqrt(ER) / C); return cmul(cx(Zc), cdiv(cadd(ZL, cx(0, Zc * t)), cadd(cx(Zc), cmul(cx(0, t), ZL)))); };
  const zbare = f => { const ZL = cdiv(cx(1), cadd(cx(1 / vg.loadROhm), cx(0, 2 * PI * f * 1e9 * CP * 1e-12))); return tlz(tlz(ZL, ZV, vg.viaHeightUm / 1000, f), ZS, vg.studHeightUm / 1000, f); };
  const Ls = vsum.seriesElement.valueNh * 1e-9, Cs = vsum.shuntElement.valuePf * 1e-12;
  const zmatch = (f, dl = 0, dc = 0) => { const w = 2 * PI * f * 1e9; return cdiv(cx(1), cadd(cdiv(cx(1), cadd(zbare(f), cx(0, w * Ls * (1 + dl)))), cx(0, w * Cs * (1 + dc)))); };
  const rlOf = z => Math.min(120, -db20(cdiv(csub(z, cx(Z0)), cadd(z, cx(Z0)))));
  for (const s of vm.samples) { near(rlOf(zbare(s.fGHz)), s.bareReturnLossDb, 1e-6, 'bare RL'); near(rlOf(zmatch(s.fGHz)), s.matchedReturnLossDb, 1e-6, 'matched RL'); }
  const fc = vg.matchFrequencyGHz;
  let lo = fc, hi = fc;
  while (lo > 0.5 && rlOf(zmatch(lo - 0.01)) >= 10) lo -= 0.01;
  while (hi < FMAX && rlOf(zmatch(hi + 0.01)) >= 10) hi += 0.01;
  const errs = [-0.1, -0.05, 0, 0.05, 0.1];
  const vtol = errs.map(dl => [M(dl * 100, 0) + '\\%', ...errs.map(dc => M(rlOf(zmatch(fc, dl, dc)), 1))]);
  const vrows = vm.samples.map(s => [N(s.fGHz, 1), N(s.bareReturnLossDb, 2), N(s.matchedReturnLossDb, 2), N(s.inputROhm, 2), M(s.inputXOhm, 2)]);
  const bz = zbare(fc);
  const viamatch = String.raw`
\minihead{Governing relations}
The stud and via are short coaxial sections, and the load pad adds an excess capacitance:
\[ Z_S=\frac{60}{\sqrt{\varepsilon_r}}\ln\frac{2R_B}{D_S},\qquad Z_V=\frac{60}{\sqrt{\varepsilon_r}}\ln\frac{2R_B}{D_V},\qquad C_P=\frac{\varepsilon_0\varepsilon_r\,\pi\,(r_p^2-r_v^2)}{h}, \]
with return radius $R_B$, stud and via diameters $D_S,D_V$, pad radius $r_p$ and via radius $r_v$. The load $R_L+jX_L$ is paralleled by $C_P$ and then transformed through the via line and the stud line:
\[ Z_{in}=Z_c\,\frac{Z_L+jZ_c\tan\theta}{Z_c+jZ_L\tan\theta},\qquad \theta=\frac{2\pi f\ell\sqrt{\varepsilon_r}}{c}. \]
A series reactance $X_S$ and a shunt susceptance $B_S$ match the resulting $R+jX$ to $Z_R=50\ \Omega$ at $f_c$:
\[ X_X=\sqrt{R(Z_R-R)},\qquad X_S=X_X-X,\qquad B_S=\frac{X_X}{R\,Z_R},\qquad L=\frac{X_S}{2\pi f_c},\qquad C=\frac{B_S}{2\pi f_c}. \]
The plate area follows from $A=Ch/(\varepsilon_0\varepsilon_r)$, and the narrow line length from $L\,c/(Z_N\sqrt{\varepsilon_N})$.
\minihead{Worked reference values}
$Z_S=${N(ZS, 3)}\ \Omega$, $Z_V=${N(ZV, 3)}\ \Omega$ and $C_P=${N(CP, 5)}$ pF. At $f_c=${fc}$ GHz the bare input is $Z_{in}=${N(bz.re, 3)}+j${N(bz.im, 3)}\ \Omega$. Then $X_X=${N(Math.sqrt(bz.re * (Z0 - bz.re)), 3)}\ \Omega$, $X_S=${N(vsum.seriesXOhm, 3)}\ \Omega$ and $B_S=${N(vsum.shuntBSiemens, 5)}$ S, giving $L=${N(vsum.seriesElement.valueNh, 5)}$ nH and $C=${N(vsum.shuntElement.valuePf, 5)}$ pF.
\minihead{Expected test data}
The bare one-port is dominated by the $25\ \Omega$ load: $S_{11}$ is a nearly flat $-9.5$ dB (return loss $9.5$ dB) because $|\Gamma|=|25-50|/(25+50)=0.33$. On a Smith chart it is a short arc near $25\ \Omega$. The matched port shows a deep notch in $S_{11}$ at $f_c$ and returns toward the bare level away from it. With the ideal component values the model reaches the $${N(rlOf(zmatch(fc)), 0)}$ dB cap at $f_c$. Return loss stays above 10 dB only from $${N(lo, 1)}$ to $${N(hi, 1)}$ GHz. Real components and process spread limit the depth, as the tolerance table shows. The back-to-back stud row (T) gives a two-port reference for de-embedding the stud and via.
${tab('rrrrr', ['$f$ (GHz)', 'bare RL', 'matched RL', 'matched $R$', 'matched $X$'], vrows)}
{\footnotesize Return loss in dB; $R$ and $X$ in ohms for the matched input.}
${tab('r*{5}{r}', ['$\\Delta L$ / $\\Delta C$', ...errs.map(e => M(e * 100, 0) + '\\%')], vtol)}
{\footnotesize Return loss in dB at $f_c$ for fractional errors in the series inductance (rows) and shunt capacitance (columns).}
${response('viamatch-response', 'Reference bare and matched return loss versus frequency (grounded reference model).')}`;

  // ZCOUPON
  const zc = p.zcoupon, zv = zc.variants, elast = ((zv[2].impedanceOhm - zv[0].impedanceOhm) / zv[1].impedanceOhm) / (zv[2].widthScale - zv[0].widthScale);
  const s11 = (G, f, E) => { const t = 2 * PI * f * zc.geometry.dutLengthMm * Math.sqrt(E) / C, e = cx(Math.cos(-2 * t), Math.sin(-2 * t)); return cdiv(cmul(cx(G), csub(cx(1), e)), csub(cx(1), cmul(cx(G * G), e))); };
  for (const v of zv) for (const s of v.samples) near(Math.min(120, -db20(s11(v.stepTdrGamma, s.fGHz, v.effectiveEr))), s.returnLossDb, 1e-6, 'zcoupon RL');
  const peaks = v => 2 * Math.abs(v.stepTdrGamma) / (1 + v.stepTdrGamma ** 2);
  const zrows = zv.map(v => [v.label.replace('x', '$\\times$'), N(v.widthUm, 3), N(v.impedanceOhm, 2), M(v.stepTdrGamma, 4), N(v.oneWayDelayPs, 2), N(-20 * Math.log10(peaks(v)), 1)]);
  const zrl = F.map((f, i) => [N(f, 1), ...[0, 2].map(k => N(zv[k].samples[i].returnLossDb, 1))]);
  const q1 = C / (4 * zc.geometry.dutLengthMm * Math.sqrt(EL));
  const zcoupon = String.raw`
\minihead{Governing relations}
A uniform line of impedance $Z$ and length $\ell$ in a $Z_0$ system reflects with
\[ \Gamma=\frac{Z-Z_0}{Z+Z_0},\qquad S_{11}=\frac{\Gamma\left(1-e^{-j2\theta}\right)}{1-\Gamma^2e^{-j2\theta}},\qquad Z=Z_0\,\frac{1+\Gamma}{1-\Gamma}. \]
$\Gamma$ is also the height of the TDR step. Ripple extremes follow from the phase:
\[ |S_{11}|_{max}=\frac{2|\Gamma|}{1+\Gamma^2}\ \ (\theta=90^\circ\ \text{odd multiples}),\qquad |S_{11}|_{min}=0\ \ (\theta=180^\circ\ \text{multiples}),\qquad f_k=(2k-1)\frac{c}{4\ell\sqrt{\varepsilon_{eff}}}. \]
The width-to-impedance elasticity of the coupon family is
\[ \eta_W=\frac{\Delta Z/Z}{\Delta W/W}\bigg|_{\pm10\%}. \]
\minihead{Worked reference values}
The nominal width ${N(zc.geometry.nominalWidthUm, 3)} um gives $Z=50\ \Omega$ and $\Gamma\approx0$. The $0.9\times$ and $1.1\times$ widths give $Z=${N(zv[0].impedanceOhm, 2)}$ and $${N(zv[2].impedanceOhm, 2)}\ \Omega$, so $\eta_W=${N(elast, 2)}$: a 1\% width increase lowers $Z$ by about ${N(-elast, 2)}\%$, or ${N(-elast * 0.5, 2)}\ \Omega$. Over $\ell=${zc.geometry.dutLengthMm}$ mm the first quarter-wave frequency is $${N(q1, 2)}$ GHz, with odd multiples at $${N(3 * q1, 1)}$, $${N(5 * q1, 1)}$ and $${N(7 * q1, 1)}$ GHz.
\minihead{Expected test data}
The nominal line should look like a through with $S_{11}$ below about $-40$ dB in the reference model. In a real part, process width error shows as a ripple on $S_{11}$ that peaks at the odd quarter-wave frequencies and nulls between them, and as a step of height $\Gamma$ in TDR. For the $0.9\times$ and $1.1\times$ lines the ripple peaks are about $${N(-20 * Math.log10(peaks(zv[0])), 1)}$ and $${N(-20 * Math.log10(peaks(zv[2])), 1)}$ dB (return loss), with delay $${N(zv[0].oneWayDelayPs, 2)}$, $${N(zv[1].oneWayDelayPs, 2)}$ and $${N(zv[2].oneWayDelayPs, 2)}$ ps. The delay barely changes with width because $\varepsilon_{eff}$ moves only from $${N(zv[0].effectiveEr, 3)}$ to $${N(zv[2].effectiveEr, 3)}$; the impedance is the sensitive quantity.
${tab('lrrrrr', ['Line', '$W$ ($\\mu$m)', '$Z$ ($\\Omega$)', '$\\Gamma$', '$\\tau$ (ps)', 'peak RL (dB)'], zrows)}
${tab('rrr', ['$f$ (GHz)', 'RL, $0.9\\times$ (dB)', 'RL, $1.1\\times$ (dB)'], zrl)}
{\footnotesize The nominal line returns the 120 dB numerical cap at every frequency.}
${response('zcoupon-response', 'Reference return and through loss of the three width variants (grounded reference model).')}`;

  // RESONATOR2
  const rc = ring.circular, F0 = rc.F0, Lr = rc.LL, Wr = rc.W * 1000, Er = rc.EE;
  near(C / (F0 * Math.sqrt(Er)), Lr, 1e-6, 'ring circumference');
  const modes = Array.from({ length: rc.NM }, (_, i) => i + 1).map(n => {
    const f = n * F0, l = loss(f, Z0, Wr, Er), aNp = l.at / NP, beta = 2 * PI * f * Math.sqrt(Er) / C, Qu = beta / (2 * aNp);
    return { n, f, aL: l.at * Lr, Qu, fwhm: f / Qu, fin: Qu / n };
  });
  const mrows = modes.map(m => [String(m.n), N(m.f, 1), N(m.aL, 1), N(m.Qu, 1), N(m.fwhm, 2), N(m.fin, 2)]);
  const resonator = String.raw`
\newpage
\pageTitle{RESONATOR2 / ring resonator measurement}{Two ports P1 west and P2 east, gap-coupled to a circular ring with connected outer ground rails}
\subhead{Measurement concept}
A ring whose mean circumference is one guided wavelength at the design frequency $F_0$ resonates at integer multiples of $F_0$. Two weakly coupled ports see $S_{21}$ peaks at those frequencies. The peak positions give $\varepsilon_{eff}$ and the peak widths give loss, independent of the launches.
\minihead{Governing relations}
\[ L_{ring}=\frac{c}{F_0\sqrt{\varepsilon_{eff}}},\qquad R=\frac{L_{ring}}{2\pi},\qquad f_n=\frac{n\,c}{L_{ring}\sqrt{\varepsilon_{eff}}}=nF_0,\qquad n=1,2,\dots \]
With loaded quality factor $Q_L=f_n/\Delta f_{3dB}$ and peak transmission $S_{21}(f_n)$ (linear), the unloaded $Q$ and attenuation follow from
\[ Q_u=\frac{Q_L}{1-|S_{21}(f_n)|},\qquad \alpha=\frac{\beta}{2Q_u}=\frac{\pi f_n\sqrt{\varepsilon_{eff}}}{c\,Q_u},\qquad \varepsilon_{eff}=\left(\frac{c}{L_{ring}f_n/n}\right)^{2}. \]
The round-trip loss is $A_n=\alpha(f_n)L_{ring}$ and the finesse is $\mathcal{F}=\mathrm{FSR}/\Delta f=Q_u/n$. Distinct peaks need $\mathcal{F}\gtrsim1$.
\minihead{Worked reference values}
For $F_0=${F0}$ GHz and $\varepsilon_{eff}=${N(Er, 4)}$, $L_{ring}=${N(Lr, 3)}$ mm and $R=${N(rc.R, 4)}$ mm. The ring conductor is $W=${N(Wr, 3)}\ \mu\mathrm{m}$. The loss uses the Reference relations at each $f_n$.
\minihead{Expected test data}
The first peak is at ${F0} GHz and the next ones are at integer multiples up to ${F0 * rc.NM} GHz, for ${rc.NM} nominal modes. This reference line is lossy because the conductor is only ${N(Wr, 1)} um wide: the round-trip loss at the fundamental is already ${N(modes[0].aL, 1)} dB and reaches ${N(modes[rc.NM - 1].aL, 0)} dB at ${F0 * rc.NM} GHz. The unloaded $Q$ is only ${N(modes[0].Qu, 1)} at the fundamental and ${N(modes[rc.NM - 1].Qu, 1)} at the top mode, so the linewidth $f_n/Q_u$ equals the ${F0} GHz mode spacing near $n=${N(modes.find(m => m.fin < 1).n, 0)}$ and the peaks merge above that. Expect clear resonances for the first few modes and a smooth, strongly damped $S_{21}$ above, with peak depth set by the coupling gap. A wider conductor or a thicker metal would raise $Q_u$ and keep the higher modes distinct.
${tab('rrrrrr', ['$n$', '$f_n$ (GHz)', '$A_n$ (dB)', '$Q_u$', '$f_n/Q_u$ (GHz)', 'finesse'], mrows)}
{\footnotesize $A_n$ is the round-trip loss in dB; finesse below 1 means adjacent peaks overlap.}
`;

  return { common, rdlloss, rdxtalk, rfleak, stubtest, trlset, viamatch, zcoupon, resonator };
}

// GDSII section: the cells are validated by gds/verify_gds.mjs, whose summary is parsed here.
export function gdsSection(root, assets) {
  const gdsDir = path.join(root, 'gds');
  const cells = [
    ['ZCOUPON', 'gds_zcoupon.bas', 'three 5 mm lines at 0.9, 1.0 and 1.1 times the 50 ohm width'],
    ['RDLLOSS', 'gds_rdlloss.bas', 'three lines of 2.000, 2.196 and 2.392 mm'],
    ['STUBTEST', 'gds_stubtest.bas', 'through lines with open stubs at 0.9, 1.0 and 1.1 times 2.462 mm'],
    ['TRLSET', 'gds_trlset.bas', 'thru, four lines of 28.996 to 1.711 mm, and an open reflect'],
    ['RFLEAK', 'gds_rfleak.bas', 'M2 pads, 4 mm M1 line, V1 transitions with ground vias'],
    ['VIAMATCH', 'gds_viamatch.bas', 'bare stud, matched stud with L-C network, back-to-back studs'],
    ['RDXTALK', 'gds_rdxtalk.bas', 'four-port crosstalk coupons at 10, 20 and 40 um gap'],
    ['RESONATOR2', 'gds_resonator2.bas', 'ring resonator with 2 um coupling gaps and ground arcs'],
  ];
  const out = execFileSync('node', ['verify_gds.mjs', ...cells.map(c => c[0] + '.GDS')], { cwd: gdsDir, encoding: 'utf8' });
  assert.ok(out.includes('ALL GDS CHECKS PASSED'), 'GDSII verification failed:\n' + out);
  const info = {};
  let cur = null;
  for (const line of out.split(/\r?\n/)) {
    let m;
    if ((m = line.match(/^(\w+): (\d+) bytes/))) cur = info[m[1]] = { bytes: +m[2] };
    else if (cur && (m = line.match(/elements by layer (\{.*\})/))) cur.layers = JSON.parse(m[1]);
    else if (cur && (m = line.match(/geometry ([\d.]+) x ([\d.]+) um/))) { cur.w = +m[1]; cur.h = +m[2]; }
  }
  const rows = cells.map(([name, script, what]) => {
    const i = info[name]; assert.ok(i && i.layers && i.w, 'missing verification summary for ' + name);
    return [name, esc(script), N(i.w / 1000, 2) + ' $\\times$ ' + N(i.h / 1000, 2), String((i.layers['2'] || 0) + (i.layers['4'] || 0)), N(i.bytes / 1024, 1), esc(what)];
  });
  const figs = cells.map(([name]) => {
    const src = path.join(gdsDir, 'previews', name + '.png'), dst = path.join(assets, 'gds-' + name + '.png');
    assert.ok(existsSync(src), 'missing GDS preview ' + src);
    if (!existsSync(dst) || statSync(dst).mtimeMs < statSync(src).mtimeMs) {
      if (name === 'STUBTEST') execFileSync('magick', [src, '-rotate', '90', dst]);
      else copyFileSync(src, dst);
    }
    return `\\gdsfig{${name}}{${name}.GDS${name === 'STUBTEST' ? ' (rotated 90 degrees)' : ''}: ${esc(cells.find(c => c[0] === name)[2])}.}`;
  });
  const layers = tab('rlp{.72\\linewidth}', ['Layer', 'Name', 'Use'], [
    ['1', 'GND', 'continuous ground plane, one polygon over the whole cell plus a 150 $\\mu$m margin'],
    ['2', 'V0', 'vias from M1 down to the plane (ground fences, ground islands)'],
    ['3', 'M1', 'first metal: signal lines, pads, ground rails'],
    ['4', 'V1', 'vias between M1 and M2'],
    ['5', 'M2', 'second metal: pads, feeds and jumpers where a layer change is drawn'],
    ['7', 'RES', 'resistor marker (not conductive)'],
    ['10', 'LABEL', 'port labels placed on the signal pads'],
    ['11', 'NOTE', 'annotation text']]);
  const cellTable = tab('llrrrp{.30\\linewidth}', ['Cell', 'Script', 'Size (mm)', 'Vias', 'kB', 'Contents'], rows);
  const text = String.raw`
\clearpage
\pageTitle{GDSII unit cells}{Eight ground-plane unit cells generated by CBM BASIC V2 scripts in the gds folder}
\subhead{What the scripts produce}
Each cell has its own script, for example \texttt{gds\_zcoupon.bas}, that asks for the stack parameters, synthesizes the 50 $\Omega$ width with the same Hammerstad--Jensen routine the report uses, and writes a binary GDSII stream \texttt{NAME.GDS}. The library name is RFTEST, the structure name equals the file name, and the database unit is 1 nm with a 1 $\mu$m user unit. Port labels sit on the signal pad of each G--S--G landing at 150 $\mu$m pitch.
\subhead{Ground plane}
At your request every cell carries a continuous ground plane on layer 1, directly beneath the 6 um polyimide. That is the condition the legacy models assume, so the reference numbers and expected data in this report apply to these cells directly, within the limits of the illustrative $\varepsilon_r$ and $\tan\delta$. The as-supplied stack has no plane. Dropping layer 1 and keeping the M1 ground rails gives the plane-less coplanar variant, for which the model changes listed with each structure are required. M1 ground rails follow each signal trace on both sides, and V0 via fences tie them to the plane.
\subhead{Layer map}
${layers}
\subhead{Cells}
{\small ${cellTable}}
\subhead{Checks and generation}
\texttt{gds/verify\_gds.mjs} re-reads each stream and confirms the record structure and units, that polygons are closed and only the layers above appear, that one plane polygon extends at least 100 $\mu$m beyond all other geometry, and that vias join the intended layers. It also checks port labels: each sits on metal and off the plane net, and the ground pads at $\pm150\ \mu$m are tied to the plane. This report build runs the same checks and stops if any cell fails.
Generate the cells with \texttt{powershell -File gds/run\_gds.ps1}. The scripts call \texttt{SYSTEM}, so they need an SDL build of cbmbasic. The stream is first written as ASCII hex because text-mode file output turns each 0x0A byte into 0x0D 0x0A; the script then decodes it with \texttt{certutil} on Windows or \texttt{xxd} elsewhere. Two deliberate differences from the legacy programs: RFLEAK is drawn as a via-connected layer transition rather than an isolated plate, and the ring uses the synthesized microstrip width ($12.431\ \mu$m) instead of the grounded-CPW value ($12.447\ \mu$m).
${figs.join('\n')}
`;
  return text;
}
