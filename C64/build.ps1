param(
    [string]$ViceDirectory = ''
)

$ErrorActionPreference = 'Stop'

function Find-ViceTool([string]$Name) {
    if ($ViceDirectory) {
        $tool = Join-Path $ViceDirectory ($Name + '.exe')
        if (Test-Path -LiteralPath $tool) { return $tool }
        throw "Cannot find $Name.exe in $ViceDirectory"
    }
    $command = Get-Command $Name -ErrorAction SilentlyContinue
    if ($command) { return $command.Source }
    throw "Supply -ViceDirectory with the folder containing VICE's petcat.exe and c1541.exe."
}

$petcat = Find-ViceTool 'petcat'
$c1541 = Find-ViceTool 'c1541'
$sources = @(Get-ChildItem -LiteralPath $PSScriptRoot -File |
    Where-Object { $_.Extension -ieq '.bas' } | Sort-Object Name)
$graphical = @('rdlloss','rdxtalk','rfleak','stubtest','trlset',
    'viamatch','zcoupon','resonator2')
$runtime = [IO.File]::ReadAllText((Join-Path $PSScriptRoot 'bitmap-runtime.inc'))
$runtime = ($runtime -replace '\r\n', "`n").Trim()
$temporarySource = [IO.Path]::GetTempFileName()

try {
    foreach ($source in $sources) {
        $text = [IO.File]::ReadAllText($source.FullName)
        if ($graphical -contains $source.BaseName.ToLowerInvariant()) {
            $embedded = (($text -split '\r?\n' | Where-Object {
                $_ -match '^(\d+)\s' -and [int]$Matches[1] -ge 30000
            }) -join "`n").Trim()
            if ($embedded -ne $runtime) {
                throw 'Renderer copies differ. Run node sync_bitmap_runtime.mjs first.'
            }
        }
        $previous = -1
        foreach ($line in ($text -split '\r?\n')) {
            if (-not $line.Trim()) { continue }
            if ($line -notmatch '^(\d+)\s+(.+)$') {
                throw "Invalid numbered line in $($source.Name): $line"
            }
            $number = [int]$Matches[1]
            if ($number -le $previous -or $number -gt 63999) {
                throw "Line numbers must increase and stay below 64000: $($source.Name)"
            }
            if ($line.Length -gt 80) {
                throw "Line $number exceeds the C64 editor's 80 columns: $($source.Name)"
            }
            if ($line -match '[^\x20-\x7E]') {
                throw "Non-ASCII source at line $number in $($source.Name)"
            }
            $previous = $number
        }
        # petcat uses lowercase ASCII for ordinary uppercase PETSCII letters.
        [IO.File]::WriteAllText($temporarySource, $text.ToLowerInvariant(),
            [Text.Encoding]::ASCII)
        $output = Join-Path $PSScriptRoot ($source.BaseName + '.prg')
        & $petcat -w2 -f -o $output -- $temporarySource
        if ($LASTEXITCODE -ne 0) { throw "petcat failed: $($source.Name)" }
        Write-Output ("Built {0} ({1} bytes)" -f
            [IO.Path]::GetFileName($output), (Get-Item -LiteralPath $output).Length)
    }

    $disk = Join-Path $PSScriptRoot 'RFTEST.d64'
    & $c1541 -format 'rf test designer,64' d64 $disk
    if ($LASTEXITCODE -ne 0) { throw 'Cannot create RFTEST.d64' }
    foreach ($source in $sources) {
        $program = Join-Path $PSScriptRoot ($source.BaseName + '.prg')
        & $c1541 -attach $disk -write $program $source.BaseName.ToLowerInvariant()
        if ($LASTEXITCODE -ne 0) { throw "Cannot add $($source.Name) to disk" }
    }
    Write-Output 'Built RFTEST.d64'
}
finally {
    Remove-Item -LiteralPath $temporarySource -Force
}
