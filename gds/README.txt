GDSII UNIT CELLS - CBM BASIC V2 GENERATORS

One script per RF test structure writes a binary GDSII stream with a
continuous ground plane. Library name RFTEST, database unit 1 nm, user unit
1 um. The structure name equals the file name.

  gds_zcoupon.bas    ZCOUPON.GDS     three lines at 0.9 / 1.0 / 1.1 x width
  gds_rdlloss.bas    RDLLOSS.GDS     short, middle and long lines
  gds_stubtest.bas   STUBTEST.GDS    through lines with open (or short) stubs
  gds_trlset.bas     TRLSET.GDS      thru, lines and reflect standards
  gds_rfleak.bas     RFLEAK.GDS      M2 pads, M1 line, V1 layer transitions
  gds_viamatch.bas   VIAMATCH.GDS    bare stud, matched stud, back-to-back
  gds_rdxtalk.bas    RDXTALK.GDS     four-port coupled pairs, 10/20/40 um gap
  gds_resonator2.bas RESONATOR2.GDS  gap-coupled ring with ground arcs

LAYERS
   1 GND    continuous plane, one polygon plus a 150 um margin
   2 V0     vias from M1 to the plane (ground fences, islands)
   3 M1     signal lines, pads, ground rails
   4 V1     vias between M1 and M2
   5 M2     second metal (RFLEAK transitions)
   7 RES    resistor marker (VIAMATCH load, not conductive)
  10 LABEL  port labels on the signal pads
  11 NOTE   annotation text

The plane sits directly under the 6 um polyimide, which is the condition the
legacy microstrip models assume. The as-supplied stack has no plane; delete
layer 1 to see the plane-less coplanar variant. Ground pads are at +/-150 um
from the signal pad and M1 rails follow every signal trace.

RUN
  Needs an SDL build of cbmbasic (the scripts call SYSTEM) and Windows
  certutil, or xxd elsewhere. Text-mode file output turns each 0A byte into
  0D 0A, so a script first writes ASCII hex and then decodes it.

  powershell -File gds/run_gds.ps1                 all cells + verification
  powershell -File gds/run_gds.ps1 -Only zcoupon   selected cells
  powershell -File gds/run_gds.ps1 -NoPreviews     skip SVG/PNG previews
  powershell -File gds/run_gds.ps1 -Cbmbasic path\to\cbmbasic.exe

  Running one script by hand: from this folder, cbmbasic gds_zcoupon.bas
  Choose 1 for the built-in example or 2 to enter custom parameters.

  The shared routines live in gdslib.bas (lines 8000 and up). After editing
  it, run  node gds/sync_gdslib.mjs  to copy it into every script; the
  script also checks the two-character variable-name rules of BASIC V2.

VERIFY
  node gds/verify_gds.mjs [--svg] [NAME.GDS ...]
  Checks the stream structure and units, allowed layers, closed polygons,
  one plane polygon with at least 100 um of margin, via-to-layer
  connectivity, and that every port label sits on metal off the plane net
  with the ground pads at +/-150 um. Prints ALL GDS CHECKS PASSED on success.
  --svg writes previews/NAME.svg and previews/NAME.png (needs ImageMagick).

RFLEAK is a via-connected layer-transition coupon. The legacy isolated-plate
leakage model is not drawn.
