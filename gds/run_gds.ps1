param(
    [string[]]$Only,
    [string]$Cbmbasic = (Join-Path $PSScriptRoot '..\..\cbmbasic\cbmbasic-sdl-builds\Windows-11-x64\cbmbasic.exe'),
    [switch]$NoPreviews
)
# Syncs the shared library, runs every gds_*.bas with the built-in example (input 1),
# decodes the GDSII output and verifies it. The cbmbasic build must support SYSTEM.
$ErrorActionPreference = 'Stop'
$env:PATH += ";$env:SystemRoot\System32;$env:SystemRoot"
$magick = Get-ChildItem 'C:\Program Files\ImageMagick*\magick.exe' -ErrorAction SilentlyContinue | Select-Object -First 1
if ($magick) { $env:PATH += ";$($magick.DirectoryName)" }
if (-not (Test-Path -LiteralPath $Cbmbasic)) {
    $onPath = Get-Command cbmbasic -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $onPath) { throw "cbmbasic not found: $Cbmbasic or on PATH (pass -Cbmbasic <path to an SDL build>)" }
    $Cbmbasic = $onPath.Source
}
$Cbmbasic = (Resolve-Path -LiteralPath $Cbmbasic).Path

Push-Location -LiteralPath $PSScriptRoot
try {
    & node sync_gdslib.mjs
    if ($LASTEXITCODE -ne 0) { throw 'sync_gdslib.mjs failed' }
    $scripts = Get-ChildItem -Filter 'gds_*.bas'
    if ($Only) { $scripts = $scripts | Where-Object { $Only -contains ($_.BaseName -replace '^gds_', '') } }
    foreach ($script in $scripts) {
        $name = ($script.BaseName -replace '^gds_', '').ToUpper()
        Remove-Item -LiteralPath "$name.HEX", "$name.GDS" -ErrorAction SilentlyContinue
        $timer = [Diagnostics.Stopwatch]::StartNew()
        $text = '1' | & $Cbmbasic $script.Name 2>&1
        $timer.Stop()
        if (-not (Test-Path -LiteralPath "$name.GDS")) { $text | Select-Object -Last 8; throw "$name.GDS was not written" }
        Remove-Item -LiteralPath "$name.HEX" -ErrorAction SilentlyContinue
        '{0}: {1:N1} s' -f $name, $timer.Elapsed.TotalSeconds
    }
    $verify = @('verify_gds.mjs')
    if (-not $NoPreviews) { $verify += '--svg' }
    if ($Only) { $verify += ($Only | ForEach-Object { "$($_.ToUpper()).GDS" }) }
    & node @verify
    if ($LASTEXITCODE -ne 0) { throw 'GDS verification failed' }
}
finally { Pop-Location }
