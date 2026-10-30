param([switch]$SkipPreviews)
$ErrorActionPreference = 'Stop'
$project = Split-Path -Parent $PSScriptRoot
Push-Location -LiteralPath $project
try {
    if (-not $SkipPreviews) {
        foreach ($script in @('preview_handbasic_rf.mjs','preview_handbasic_ring.mjs',
            'preview_handbasic_utilities.mjs','analyze_handbasic_rf.mjs')) {
            & node $script
            if ($LASTEXITCODE -ne 0) { throw "Preview generation failed: $script" }
        }
    }
    & node reports/create_report.mjs
    if ($LASTEXITCODE -ne 0) { throw 'Report source generation failed' }
    $buildDirectory = Join-Path $project 'tmp/pdfs/handbasic-report'
    New-Item -ItemType Directory -Path $buildDirectory -Force | Out-Null
    Push-Location -LiteralPath $PSScriptRoot
    try {
        foreach ($pass in 1..2) {
            & pdflatex -no-shell-escape -interaction=nonstopmode -halt-on-error `
                -file-line-error "-output-directory=$buildDirectory" handbasic-ltc25000-eme-g730.tex
            if ($LASTEXITCODE -ne 0) { throw "pdfLaTeX pass $pass failed" }
        }
    }
    finally { Pop-Location }
    Copy-Item -LiteralPath (Join-Path $buildDirectory 'handbasic-ltc25000-eme-g730.pdf') `
        -Destination (Join-Path $PSScriptRoot 'handbasic-ltc25000-eme-g730.pdf') -Force
    Copy-Item -LiteralPath (Join-Path $buildDirectory 'handbasic-ltc25000-eme-g730.log') `
        -Destination (Join-Path $PSScriptRoot 'handbasic-ltc25000-eme-g730.log') -Force
    Write-Output 'Built reports/handbasic-ltc25000-eme-g730.pdf with pdfLaTeX'
}
finally { Pop-Location }
