COMMODORE 64 BASIC V2 / VICE
==========================

This folder contains C64 versions of all ten BASIC programs in the parent
folder. The parent Hand BASIC RF files now share the cardinal probe layout
and MPI profile while retaining their native mobile graphics. No BASIC
extension or graphics cartridge is required for the C64 versions.

RUN IN VICE

Use VICE's Autostart action to open any .prg file in this folder. The .bas
files are editable ASCII source listings; the matching .prg files are
tokenized C64 programs ready to load.

Alternatively, attach RFTEST.d64 to drive 8. It contains all ten programs.
For example, enter these commands at the C64 READY prompt:

  LOAD "RESONATOR2",8
  RUN

To see the disk directory:

  LOAD "$",8
  LIST

Other program names are MATMUL, RDLLOSS, RDXTALK, RFLEAK, STUBTEST, TRLSET,
VARPREC, VIAMATCH and ZCOUPON. Loading another program replaces the
directory listing or previously loaded program in memory.

PROGRAMS

  MATMUL       Matrix calculator, all 25 original menu choices
  RDLLOSS      RDL conductor and dielectric loss coupons
  RDXTALK      Coupled-line crosstalk coupons
  RESONATOR2   Circular or cosine-lobed ring and GSG launch designer
  RFLEAK       Broadside leakage and via-fence coupons
  STUBTEST     Open/short shunt-stub coupons
  TRLSET       Multiline TRL lengths and sampled coverage
  VARPREC      Exact addition/multiplication of up to 88-digit integers
  VIAMATCH     Stud/via impedance matching
  ZCOUPON      Microstrip impedance and width-variation coupons

CARDINAL GSG PROBER CONFIGURATION

The installed-probe profile is MPI TITAN GSG, 150um adjacent-tip pitch,
rated through 67GHz. All RF defaults use that pitch (300um between the two
ground tips). Custom calculations remain available; reports identify a
pitch mismatch or a requested frequency above the installed-probe rating.

RDXTALK uses one GSG probe per side: P1 west, P2 north, P3 south, P4 east.
The aggressor runs W-to-N and the victim S-to-E, avoiding a planar signal
crossover. S21 remains aggressor through, S31 near-end crosstalk and S41
far-end crosstalk. North/south pad triplets are rotated 90 degrees.

The ordinary two-port coupons and RESONATOR2 use P1 west and P2 east, with
north/south probes parked. VIAMATCH retains one modeled west input and
an internal load; its other three probe heads are parked. DOE and TRL
rows are separate coupons/standards measured one at a time with the same
probe pair. The unused station heads are not extra connected DUT ports.

Port numbers are logical DUT port labels. Map the VNA cables and their
calibration to the stated directions for each measurement. In particular,
the two-port east probe is P2, while RDXTALK's east probe is P4.
RDXTALK requires calibration at all four probe planes; the two-port TRLSET
generator alone does not provide the full four-head calibration set.

RDXTALK reports all twelve GSG contact coordinates and an adjustable
minimum adjacent-group centre distance. Its 1000um starting value is an
editable geometric rule, not an MPI-certified body/overtravel clearance.
It may lengthen the requested minimum feed to satisfy the contact rules;
the report lists the actual feed length. The uniform coupled-line model
excludes these fanouts, turns and probe transitions. See
probe-configuration.txt for the coordinate convention and model limits.

The separately supplied RING67.TXT/PRG is an idealized response visualizer
without a physical probe-layout calculation and is preserved separately.

CONTROLS AND C64 ADAPTATIONS

The seven coupon programs use RETURN to advance report pages. Select 1
for the built-in example or 2 for custom inputs. Selecting a sketch first
shows its labels, color legend and dimensions in standard text. Press
RETURN to show the multicolor bitmap, then RETURN to finish in text mode.
The ring designer accepts RETURN for each default. Its graphical pages
show a text legend first: any key opens the bitmap, and any key advances
from the bitmap. M returns to the menu from either phase. Its report and
help pages remain standard text. The matrix calculator uses RETURN
between result pages.

VARPREC reads digit keys directly so that an 88-digit operand is not
limited by the C64's normal 80-column INPUT editor. DEL edits the current
operand; RETURN accepts it. A adds, M multiplies, and Q exits. Operations
reuse the two operands; RUN starts again with new operands. A product can
contain 176 digits and wraps across screen rows.

Graphical sections now use the VIC-II's native 160 x 200 multicolor bitmap
mode. Menus, labels, dimensions and reports use standard 40 x 25 text.
Yellow represents signal copper, cyan represents grounds, and white marks
vias, contacts, components or axes as explained on each text legend.
The ring designer plots the actual circular/cosine-lobed ring, GSG launch
geometry and nominal mode-position graph. Coupon drawings show the line,
stub, leakage, TRL or matching topology. Fine features are enlarged where
needed for visibility; numerical dimensions remain authoritative.

Each graphical BASIC listing embeds the same small native drawing helper
as DATA. It installs itself on first use, clears and draws in RAM outside
the BASIC program, and restores standard text on exit. Each PRG is fully
self-contained; no additional file, graphics extension or cartridge is
loaded at runtime. MATMUL and VARPREC remain standard-text applications.
See bitmap-runtime-notes.txt for the memory map and drawing interface.

Matrix control flow and variable names were adapted to BASIC V2. Existing
RREF/rank, LU, power and eigenvalue issues were corrected in the C64 copy.
RF exponential terms are guarded at negligible magnitudes, and leakage
target calculations avoid cancellation at tiny positive isolation values.
See MATMUL-notes.txt, resonator2-notes.txt, RF-notes.txt and
varprec-notes.txt for details and verification evidence.

The C64 uses roughly nine significant decimal digits for ordinary numeric
variables. VARPREC implements exact integer arithmetic with digit arrays.
The original RF model assumptions and limitations still apply. Numerical
synthesis and especially TRL coverage can take time at normal C64 speed;
VICE warp mode speeds up these calculations.

The 2026-11-03 drawings connect ground rails along the signal routes and
around stub junctions and the ring's outer halves. RFLEAK has a top view
and a signal side view: upper-left L1 drops through a via to lower-right
L2; three east vias return G-S-G to top-side pads. Its isolated-plate
numerical model is unchanged and does not predict this connected path.
VIAMATCH retains its single west input and internal load.

REBUILD AFTER EDITING

The ready-made PRGs and D64 need no rebuilding to run. To rebuild them,
use PowerShell with VICE's petcat.exe and c1541.exe installed:

  .\build.ps1 -ViceDirectory 'C:\path\to\VICE\bin'

If these tools are already on PATH, run .\build.ps1 without arguments.
Use the directory that actually contains the executables. The script
checks line numbers, ASCII characters and the 80-column source-line limit,
then rebuilds every PRG and RFTEST.d64. It normalizes a temporary source
copy to petcat's lowercase-ASCII convention for uppercase PETSCII text.
It does not modify the editable source listings.

The shared renderer source is bitmap-runtime.asm. After changing it, run:

  node .\build_bitmap_runtime.mjs
  node .\sync_bitmap_runtime.mjs

Then run build.ps1 as above. The second command updates the embedded
renderer at BASIC lines 30000 and above in the eight graphical listings.
build.ps1 checks that their embedded copies match bitmap-runtime.inc.

OPTIONAL REPEATABLE CHECKS

With Node.js installed, check program links and disk-file contents:

  node .\verify_artifacts.mjs

The verify_bitmap.mjs, verify_rf.mjs, verify_matrix.mjs,
verify_resonator.mjs and verify_varprec.mjs scripts run isolated VICE
instances against the actual
C64 BASIC V2 ROM. Each takes the VICE executable directory as its first
argument. For example:

  node .\verify_rf.mjs 'C:\path\to\VICE\bin'

Test instances run without a visible window and close after testing. They
do not require or control an already-open VICE window. Temporary test
drivers exercise the shipped numerical routines; the shipped programs
remain interactive.

verify_bitmap.mjs checks bitmap/text transitions and writes decoded
captures of the actual VIC-II bitmap RAM into previews/. It covers every
graphical program plus circular/lobed ring and zero-mode variants.

verify_cardinal_geometry.mjs checks default contacts and 20000 randomized
fanout geometries. Passing previews/rdxtalk.png also checks the actual
bitmap contact orientations and independent W-N/S-E signal connectivity.
verify_cardinal_profile.mjs checks C64 coordinate calculations, layout
input guards and the installed-probe pitch/frequency notices.

VICE references:
  https://vice-emu.sourceforge.io/vice_16.html  (petcat)
  https://vice-emu.sourceforge.io/vice_12.html  (monitor/testing)
