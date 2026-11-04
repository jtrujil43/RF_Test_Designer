HAND BASIC PREVIEW ATLAS - LTC-25000 / EME-G730

Open handbasic-ltc25000-eme-g730.pdf or ../handbasic-previews/index.html.
The editable report source is handbasic-ltc25000-eme-g730.tex.

User stack: 2.2um top copper, 6um LTC-25000 insulation, 700um EME-G730 mold,
no continuous ground plane, MPI TITAN67GHz GSG probes at150um tip pitch.
Frequency range:500MHz..67GHz.

The existing BASIC programs require grounded transmission-line models.
Their numeric artwork labels and response plots are hypothetical grounded
reference calculations only. They do not predict the ungrounded mold stack.
The report explains the needed ungrounded multilayer CPW model and missing
broadband material inputs. No original BASIC or C64 files are changed.

All ten parent-folder Hand BASIC programs are represented:8RF programs and
2mathematical utilities. RF images execute native source drawing statements
with a limited host interpreter. Utility images extract initial literal
source text. Neither method executes the mobile Hand BASIC app.

The report also gives, in each Measurement concept section, the governing
equations, worked reference values and the expected test data (tables and
response plots). Those relations are re-implemented in report_math.mjs and
compared with ../handbasic-previews/rf-results.json at build time; a mismatch
stops the build. A GDSII unit-cell section lists the eight generators in
../gds (each with a ground plane) and re-runs their verifier during the build.
The expected-data values are grounded reference-model values with illustrative
er and loss tangent, not predictions for the as-supplied stack.
RF_Test_Structures-ltc25000-eme-g730.pdf/.tex is an earlier hand-edited draft
kept as supplied; the build does not regenerate it.

Rebuild from the project folder:
  powershell -File reports/build.ps1

Requirements:Node.js,ImageMagick,pdfLaTeX on PATH. The report also runs
../gds/verify_gds.mjs on the generated GDSII cells (run ../gds/run_gds.ps1
first if they are missing). The build regenerates
source-derived PNG/SVG previews and reference JSON/CSV, checks profile and
source hashes, creates the gallery and report source, then runs pdfLaTeX
twice. Intermediate LaTeX files are in tmp/pdfs/handbasic-report.

To reuse existing verified previews:
  powershell -File reports/build.ps1 -SkipPreviews

Profile values and assumptions are in ../handbasic-preview-profile.json.
The rendered report assets are retained in reports/assets.
