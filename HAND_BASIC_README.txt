HAND BASIC RF TEST DESIGNER - CARDINAL PROBE UPDATE
2026-10-30

The eight RF .bas files in this directory are the original Hand BASIC
versions. They now share the probe layout and equipment profile used by
the versions in the C64 subfolder. Their native SCREEN, CSET, RECT, LINE,
CIRCLE, TRIANGLE and GPRINT commands and touch/keyboard controls remain.
The C64 bitmap machine-code renderer has not been copied into these files.

Updated programs:
  rdlloss.bas    Conductor/dielectric loss coupons
  rdxtalk.bas    Four-port coupled-line crosstalk coupons
  rfleak.bas     Broadside leakage and via-fence coupons
  stubtest.bas   Open/short shunt-stub coupons
  trlset.bas     Multiline TRL lengths and coverage
  viamatch.bas   One-port stud/via input matching
  zcoupon.bas    Impedance and width-variation coupons
  resonator2.bas Circular/cosine-lobed ring and GSG launch design

PROBE ASSIGNMENTS

Installed profile: MPI TITAN GSG probes, 150um adjacent-tip pitch, rated
through 67GHz. Defaults already use 150um pitch (300um ground-to-ground).
Custom pitch/frequency calculations remain available, with explicit
installed-equipment mismatch notices.

RDXTALK uses P1 WEST, P2 NORTH, P3 SOUTH and P4 EAST. The aggressor is
W-to-N and the victim S-to-E. Their central parallel coupled lines and
fanouts do not cross. North/south GSG triplets are rotated 90 degrees.
S21 remains aggressor through, S31 near-end and S41 far-end crosstalk.
The program reports twelve contact coordinates, requested versus actual
fanout length, and an adjustable minimum adjacent-group centre distance.

The two-port programs use P1 WEST and P2 EAST, with north/south heads
parked. Multiple DOE/TRL rows are separate coupons measured one at a time.
VIAMATCH retains a single external WEST input and an internal RL/RX load;
east/north/south heads are parked. Port numbers are logical DUT labels,
so use the corresponding VNA cable and calibration mapping.

Both leakage probe footprints are on the top surface. Access from the
lower-layer pickup to the east landing pads uses a transition/via outside
the parallel-plate capacitance model. Fanout/bend/probe parasitics remain
outside the core analytical models. The 1000um initial adjacent-centre
rule is adjustable; exact probe-body and overtravel clearance still
depends on the mounting geometry. RDXTALK needs four calibrated probe
planes; TRLSET remains a two-port west/east standard generator.

The detailed shared coordinate convention and default contact positions
are documented in C64/probe-configuration.txt.

LOAD IN HAND BASIC

Use NEW before loading/importing a revised ASCII listing so removed or
renumbered old lines do not remain in memory. Load the desired .bas file
through Hand BASIC's normal file/import workflow, then RUN. Existing
example/custom menus and touch/keyboard page advances are retained.

MATMUL.BAS and varprec.bas have no RF probes and were not changed. The
already-updated C64 .bas/.prg files and RFTEST.d64 were not regenerated
or changed by this propagation.

VERIFICATION

verify_handbasic_cardinal.mjs checks the native graphics commands, ASCII
and 72-column source limits, ordered line numbers, branch targets,
equipment notices and agreement with C64's contact/clearance equations.
The protected RF equations were compared to the pre-update source files.
Optional VICE numerical/text drivers check the portable shared layout
and profile routines only; VICE does not execute Hand BASIC graphics.
The mobile Hand BASIC app was not available for end-to-end execution.

preview_handbasic_cardinal.mjs records and renders the actual native
RDXTALK drawing statements on the host. The source-derived preview is
handbasic-previews/rdxtalk.png; it is a drawing check, not an app screenshot.

Repeat static checks:
  node verify_handbasic_cardinal.mjs

Repeat portable numerical/text checks with VICE:
  node verify_handbasic_cardinal.mjs C:\path\to\VICE\bin

Render the source-derived drawing (requires ImageMagick on PATH):
  node preview_handbasic_cardinal.mjs
