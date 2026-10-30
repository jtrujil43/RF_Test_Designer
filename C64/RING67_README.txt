RING67 - IDEALIZED RING RESONATOR FOR THE COMMODORE 64
===================================================

FILES
RING67.TXT   Complete, unabridged stock C64 BASIC V2 listing.
RING67.PRG   Same program, tokenized with the $0801 load address.

START
Autostart RING67.PRG in a C64 emulator, then type RUN if necessary.
When using a disk image: LOAD"RING67",8 and RUN.
RING67.TXT can also be entered or pasted with an emulator's BASIC paste tool.
Select 1 for the default model or 2 to enter your own parameters.
Bitmap clearing and floating-point calculations take time on a 1 MHz C64.
Emulator warp/fast mode makes the first plots appear sooner.

SCREENS
1. Cyan S21/S12 and green S11/S22 magnitude plots, 0 to -40 dB.
   There are 272 uniformly spaced frequency samples from 0.5 to 67 GHz.
   Exact resonance points are added as small plus signs so the sweep does
   not omit the peaks merely because they fall between plot samples.
2. Relative dielectric constant: an input model curve and recovered modal
   dielectric constants marked with plus signs.
3. A paged table of mode number, resonance frequency in GHz, effective
   microstrip permittivity, and the recovered substrate permittivity.
T opens an additional 134-point table on a 0.5 GHz grid, including both
endpoints. It shows S11/S21 magnitudes in dB and phases in degrees.
This coarse table can miss narrow peaks; the modal table is separate.

KEYS
SPACE  Advance to the next screen or next table page.
T      Open the S-parameter magnitude/phase table.
M      Return to the parameter menu.
R      Return to the S-parameter plots.
Q      Quit and restore the text display and normal BASIC memory limit.
Keys are accepted after the current plot has finished drawing.
On the final S-data page, SPACE returns to the previous screen.

DEFAULT MODEL
Frequency band                    0.500 to 67.000 GHz
Mean ring radius R                5.000 mm
Microstrip width W                0.400 mm
Substrate thickness H             0.254 mm
Input bulk relative epsilon       4.2 at 0.5 GHz; 3.8 at 67 GHz
Coupler field transmission t      0.900
Roundtrip field transmission a    0.995
Symmetry                          S12 = S21; S22 = S11

MODEL EQUATIONS
All frequencies below are in GHz and all lengths are in millimeters.
c = 299.792458 mm*GHz; ring circumference L = 2*pi*R.

The illustrative bulk permittivity follows a prescribed logarithmic law:
  er(f) = er_low + (er_high-er_low)*ln(f/0.5)/ln(67/0.5).

A quasi-static microstrip filling-factor approximation is used:
  u = W/H
  k = 1/sqrt(1+12/u)
For u < 1, add 0.04*(1-u)^2 to k.
  G = (1+k)/2; B = (1-k)/2
  eeff(f) = G*er(f) + B.

The electrical phase for a full circumference is:
  theta(f) = 2*pi*f*L*sqrt(eeff(f))/c.

The synthetic response is a symmetric, passive, reciprocal resonant
two-port band-pass equivalent, with no separate direct feed-through path:
  d   = 1 - t^2*a*exp(-j*theta)
  S11 = S22 = t*(1-a*exp(-j*theta))/d
  S21 = S12 = (1-t^2)*sqrt(a)*exp(-j*theta/2)/d.
Both t and a are real field-amplitude transmission factors. The roundtrip
power transmission is a^2. The port reference planes are idealized.

Resonance mode m satisfies theta(f_m) = 2*pi*m, with m = 1,2,3,... .
The program locates each resonance with 24 bisection iterations, then
recovers the dielectric constant from its frequency, radius and mode:
  eeff_extracted = [m*c/(L*f_m)]^2
  er_extracted  = (eeff_extracted-B)/G.

For the default model, 11 resonances lie in the band. Examples:
  Mode       GHz       Recovered effective er       Recovered bulk er
    1       5.49691            3.013725                  4.004211
    5      27.89926            2.924801                  3.871549
   11      61.84074            2.881228                  3.806544

INTERPRETATION
This generates synthetic S-parameters from the chosen material model;
recovering the input er is a demonstration of the resonance inversion.
It is not an independent dielectric measurement or an electromagnetic
prediction for a particular physical ring, feed, or probe arrangement.

The extracted values exist only at resonances. Values along the continuous
dielectric plot, including the band endpoints, are the assumed model.
A single ring does not provide a unique bulk er at every sweep frequency
from S-parameter magnitudes alone. Geometry and mode identification are
required for the inversion used here.

Coupling and attenuation are frequency independent. The quasi-static
microstrip conversion omits additional line dispersion, bend corrections,
conductor and substrate loss dispersion, radiation, package modes, and
probe/feed effects. Those omissions matter for actual wideband hardware.
The program is intended for visualization and calculation practice.

C64 IMPLEMENTATION
No graphics extension or nonstandard BASIC command is required.
Graphics use VIC bank 1: screen $5C00, bitmap $6000, and a character-ROM
copy at $8000. The BASIC memory ceiling is temporarily set to $5C00.
The program supports up to 99 in-band modes and validates its inputs.
The S-parameter graph floor is -40 dB; tabulated values have a -80 dB floor.
Phase wraps into -180 to +180 degrees; a zero-vector phase is shown as 0.

NUMBER FORMATTING FIX
The fixed-decimal formatter now rounds 10^DP to an exact integer scale.
In C64 BASIC V2, 10^2 evaluates slightly above 100. Using that approximate
scale to split integer and fractional digits previously displayed 48.00
as 47.99.999999, and could make the table columns run together.
The frequency and RF equations are unchanged. Reload the updated
RING67.PRG before running; an already loaded copy retains the old code.

VALIDATION
The ASCII listing has been checked for C64 editor line length, unique
ordered line numbers, branch targets, and two-character variable names.
The PRG's linked-line pointers and tokenized contents were decoded and
compared with the full source. Its program and variable space fit below
the reserved graphics memory.
The numerical model was checked on 10,001 frequencies for passivity;
the lossless limit was also checked for power conservation. Default-mode
dielectric inversion agrees with the input model within 0.000002 in the
host calculation. C64 floating-point arithmetic can differ slightly.
The formatter and default S-data table are now tested in actual VICE 3.10
with the C64 BASIC V2 ROM. The regression covers 160 formatting cases,
including all 134 half-GHz sweep frequencies, decimal precision 0..4,
rounding carries, signs, zero and field padding. All nine S-data pages are
checked for frequency formatting and agreement of both dB and phase
columns with an independent calculation. The default S-parameter bitmap
and restoration of text mode on quit are also exercised.
See ring67-validation.txt for the result, and verify_ring67.mjs to repeat:
  node verify_ring67.mjs "C:\path\to\VICE"
