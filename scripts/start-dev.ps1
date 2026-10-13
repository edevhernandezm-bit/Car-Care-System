<#
.SYNOPSIS
    Levanta (o detiene) la API Express y el frontend de Vite.

.DESCRIPTION
    Deja el proyecto servible como lo veria un usuario: el frontend en 5173 y,
    detras, Express en el puerto de API. El proxy de Vite lee el puerto de la
    API desde $env:PORT, asi que el script exporta la misma variable a los dos
    procesos hijos para que nunca se desincronicen.

    MongoDB no se levanta aqui: es un servicio externo (en este proyecto,
    Docker). El script avisa si no responde, pero no falla, porque la UI puede
    arrancar sin base de datos y fallar solo al guardar.

.EXAMPLE
    .\scripts\start-dev.ps1
    .\scripts\start-dev.ps1 -PuertoApi 5010
    .\scripts\start-dev.ps1 -Detener
#>
[CmdletBinding()]
param(
    [int]$PuertoApi = 5000,
    [int]$PuertoWeb = 5173,
    [switch]$Detener,
    [switch]$SinMongo
)

$ErrorActionPreference = 'Stop'

$Raiz     = Split-Path -Parent $PSScriptRoot
$Backend  = Join-Path $Raiz 'backend'
$Frontend = Join-Path $Raiz 'frontend'
$LogDir   = Join-Path $env:TEMP 'diagauto-dev'

function Get-ProcesoEnPuerto([int]$puerto) {
    $c = Get-NetTCPConnection -LocalPort $puerto -State Listen -ErrorAction SilentlyContinue
    if ($c) { $c[0].OwningProcess } else { $null }
}

function Esperar-Puerto([int]$puerto, $proceso, [int]$segundos = 40) {
    for ($i = 0; $i -lt ($segundos * 4); $i++) {
        Start-Sleep -Milliseconds 250
        if (Get-ProcesoEnPuerto $puerto) { return $true }
        if ($proceso -and $proceso.HasExited) { return $false }
    }
    return $false
}

function Get-Log([string]$nombre) {
    $p = Join-Path $LogDir $nombre
    if (Test-Path -LiteralPath $p) { return (Get-Content -LiteralPath $p -Raw) }
    return '(sin log)'
}

# --- Detener ---------------------------------------------------------------
if ($Detener) {
    foreach ($puerto in @($PuertoWeb, $PuertoApi)) {
        $proceso = Get-ProcesoEnPuerto $puerto
        if ($proceso) {
            Stop-Process -Id $proceso -Force -ErrorAction SilentlyContinue
            Write-Host "Detenido el proceso en el puerto $puerto (PID $proceso)."
        }
    }
    Write-Host "Frontend y API apagados."
    return
}

# --- Comprobaciones previas ----------------------------------------------
foreach ($dir in @($Backend, $Frontend)) {
    if (-not (Test-Path -LiteralPath $dir)) { throw "No existe $dir" }
    if (-not (Test-Path -LiteralPath (Join-Path $dir 'node_modules'))) {
        throw "Faltan dependencias en $dir. Ejecuta: npm install (dentro de esa carpeta)"
    }
}

if (-not $SinMongo) {
    $mongo = Test-NetConnection -ComputerName 127.0.0.1 -Port 27017 -WarningAction SilentlyContinue
    if (-not $mongo.TcpTestSucceeded) {
        Write-Warning "MongoDB no responde en 127.0.0.1:27017. La UI arrancara, pero guardar diagnosticos fallara."
    }
}

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

# Vite toma el puerto de la API de $env:PORT, y Express toma de ahi su propio
# puerto de escucha. Se exporta antes de crear los hijos para que ambos lean lo
# mismo, y se restaura al final para no ensuciar la sesion de quien lo invoco.
$portPrevio = $env:PORT
$env:PORT = [string]$PuertoApi

try {
    # --- API ---
    if (Get-ProcesoEnPuerto $PuertoApi) {
        Write-Host "La API ya escucha en $PuertoApi."
    } else {
        # La API lee backend/.env si existe (lo mismo que `npm run dev`); en un
        # clon sin .env arranca con los valores por defecto del codigo.
        $argumentosApi = if (Test-Path -LiteralPath (Join-Path $Backend '.env')) {
            @('--env-file=.env', 'server.js')
        } else {
            @('server.js')
        }
        $api = Start-Process -FilePath 'node' -ArgumentList $argumentosApi `
            -WorkingDirectory $Backend `
            -RedirectStandardOutput (Join-Path $LogDir 'api.out') `
            -RedirectStandardError  (Join-Path $LogDir 'api.err') `
            -PassThru -WindowStyle Hidden

        if (-not (Esperar-Puerto $PuertoApi $api)) {
            throw "La API no abrio el puerto $PuertoApi.`n$(Get-Log 'api.err')"
        }
        Write-Host "API Express escuchando en http://localhost:$PuertoApi (PID $($api.Id))."
    }

    # --- Frontend ---
    if (Get-ProcesoEnPuerto $PuertoWeb) {
        Write-Host "El frontend ya escucha en $PuertoWeb."
    } else {
        # Se invoca el binario de vite con node en vez de npm: npm dejaria un
        # proceso hijo huerfano que el script no podria limpiar con precision.
        $web = Start-Process -FilePath 'node' -ArgumentList 'node_modules/vite/bin/vite.js' `
            -WorkingDirectory $Frontend `
            -RedirectStandardOutput (Join-Path $LogDir 'web.out') `
            -RedirectStandardError  (Join-Path $LogDir 'web.err') `
            -PassThru -WindowStyle Hidden

        if (-not (Esperar-Puerto $PuertoWeb $web)) {
            throw "El frontend no abrio el puerto $PuertoWeb.`n$(Get-Log 'web.err')"
        }
        Write-Host "Frontend Vite escuchando en http://localhost:$PuertoWeb (PID $($web.Id))."
    }
} finally {
    $env:PORT = $portPrevio
}

Write-Host ''
Write-Host "Abre http://localhost:$PuertoWeb en el navegador."
Write-Host "El navegador habla solo con $PuertoWeb; Vite hace de proxy hacia la API y el motor."
Write-Host "  Logs : $LogDir"
Write-Host "  Parar: .\scripts\start-dev.ps1 -Detener"