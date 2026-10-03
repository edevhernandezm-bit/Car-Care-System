<#
.SYNOPSIS
    Levanta (o detiene) el motor de inferencia Prolog.

.DESCRIPTION
    El motor es el unico que sabe diagnosticar. Este script lo deja escuchando
    en su puerto HTTP y espera a que realmente acepte conexiones, en lugar de
    devolver el control cuando el proceso todavia no ha hecho bind.

    Sin argumentos lo levanta en segundo plano. Con -Detener lo apaga.

.EXAMPLE
    .\scripts\start-prolog.ps1
    .\scripts\start-prolog.ps1 -Puerto 8000
    .\scripts\start-prolog.ps1 -Detener
#>
[CmdletBinding()]
param(
    [int]$Puerto = 8000,

    # Apaga el motor en lugar de levantarlo.
    [switch]$Detener,

    # Ruta al ejecutable de SWI-Prolog. Por defecto toma $env:SWIPL y, si no
    # existe, busca la instalacion estandar de Windows y luego el PATH.
    [string]$Swipl = $env:SWIPL
)

$ErrorActionPreference = 'Stop'

# Raiz del repositorio: este script vive en <raiz>\scripts.
$Raiz    = Split-Path -Parent $PSScriptRoot
$Motor   = Join-Path $Raiz 'Prolog\motor_inferencia.pl'
$LogDir  = Join-Path $env:TEMP 'diagauto-dev'

function Get-ProcesoEnPuerto([int]$puerto) {
    $c = Get-NetTCPConnection -LocalPort $puerto -State Listen -ErrorAction SilentlyContinue
    if ($c) { $c[0].OwningProcess } else { $null }
}

function Resolver-Swipl([string]$indicado) {
    $candidatos = @($indicado, "C:\Program Files\swipl\bin\swipl.exe") | Where-Object { $_ }
    foreach ($c in $candidatos) {
        if (Test-Path -LiteralPath $c) { return $c }
        $enPath = Get-Command $c -ErrorAction SilentlyContinue
        if ($enPath) { return $enPath.Source }
    }
    throw "No se encontro swipl.exe. Indica la ruta con -Swipl o define la variable SWIPL."
}

# --- Detener ---------------------------------------------------------------
if ($Detener) {
    $pidActual = Get-ProcesoEnPuerto $Puerto
    if ($pidActual) {
        Stop-Process -Id $pidActual -Force -ErrorAction SilentlyContinue
        Write-Host "Prolog detenido (PID $pidActual, puerto $Puerto)."
    } else {
        Write-Host "Prolog no estaba corriendo en el puerto $Puerto."
    }
    return
}

# --- Levantar --------------------------------------------------------------
if (-not (Test-Path -LiteralPath $Motor)) {
    throw "No se encontro el motor en $Motor"
}

$ejecutable = Resolver-Swipl $Swipl
$existente  = Get-ProcesoEnPuerto $Puerto
if ($existente) {
    Write-Host "Prolog ya escucha en el puerto $Puerto (PID $existente). No hace falta levantarlo."
    return
}

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

# El objetivo -g va sin espacios y el motor se cita: PowerShell 5.1 parte los
# argumentos de Start-Process en cada espacio, y tanto "sleep(3600)" como el
# path del repositorio ("Car Care System 1.0") contienen separadores.
$objetivo = "server($Puerto),sleep(3600)"
$motorCitado = '"' + $Motor + '"'

$proceso = Start-Process -FilePath $ejecutable `
    -ArgumentList '-q', '-f', $motorCitado, '-g', $objetivo, '-t', 'halt' `
    -WorkingDirectory $Raiz `
    -RedirectStandardOutput (Join-Path $LogDir 'prolog.out') `
    -RedirectStandardError  (Join-Path $LogDir 'prolog.err') `
    -PassThru -WindowStyle Hidden

# El bind tarda un momento. Sin esta espera el script mentiria: devolveria
# "listo" mientras el puerto sigue libre.
$listo = $false
for ($i = 0; $i -lt 40; $i++) {
    Start-Sleep -Milliseconds 250
    if (Get-ProcesoEnPuerto $Puerto) { $listo = $true; break }
    if ($proceso.HasExited) { break }
}

if (-not $listo) {
    $err = Join-Path $LogDir 'prolog.err'
    $detalle = if (Test-Path -LiteralPath $err) { (Get-Content -LiteralPath $err -Raw) } else { '(sin log)' }
    throw "Prolog no abrio el puerto $Puerto.`n$detalle"
}

Write-Host "Prolog escuchando en http://localhost:$Puerto (PID $($proceso.Id))."
Write-Host "  Motor  : $Motor"
Write-Host "  Logs   : $LogDir"