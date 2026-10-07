<#
.SYNOPSIS
    Instala las dependencias de npm de backend y frontend (una sola vez).

.DESCRIPTION
    Prepara el proyecto para arrancar por primera vez en un equipo nuevo:
    comprueba que Node.js y npm esten disponibles, instala las dependencias
    de backend y frontend, avisa si falta SWI-Prolog o MongoDB y muestra los
    pasos siguientes para levantar el sistema.

    No instala servicios (MongoDB es un servicio externo); solo deja las
    dependencias de Node listas para los scripts de arranque.

.EXAMPLE
    .\scripts\setup.ps1
    npm run setup
#>
[CmdletBinding()]
param(
    [switch]$SinPrologCheck
)

$ErrorActionPreference = 'Stop'

# npm 12 rechaza allow-scripts heredado del entorno (.npmrc global del usuario)
# en instalaciones de proyecto (EALLOWSCRIPTS). Este script no requiere scripts
# de dependencias, asi que se descarta la variable antes de instalar.
Remove-Item Env:\npm_config_allow_scripts -ErrorAction SilentlyContinue

$Raiz     = Split-Path -Parent $PSScriptRoot
$Backend  = Join-Path $Raiz 'backend'
$Frontend = Join-Path $Raiz 'frontend'

function Get-Comando([string]$nombre) {
    (Get-Command $nombre -ErrorAction SilentlyContinue) -ne $null
}

Write-Host 'Car Care System - instalacion de dependencias'
Write-Host ''

# --- Prerrequisitos -------------------------------------------------------
if (-not (Get-Comando 'node'))    { throw 'No se encontro Node.js. Instala la version 20 o superior.' }
if (-not (Get-Comando 'npm'))     { throw 'No se encontro npm. Node.js deberia incluirlo; revisa el PATH.' }

$nodeVersion = (& node --version)
$npmVersion  = (& npm --version)
Write-Host "  Node.js : $nodeVersion"
Write-Host "  npm     : $npmVersion"
Write-Host ''

# --- Dependencias de backend y frontend ----------------------------------
foreach ($dir in @($Backend, $Frontend)) {
    if (-not (Test-Path -LiteralPath $dir)) {
        throw "No existe la carpeta $dir"
    }
    Write-Host "Instalando dependencias en $dir ..."
    Push-Location $dir
    try {
        & npm install
        if ($LASTEXITCODE -ne 0) {
            throw "npm install fallo en $dir (codigo $LASTEXITCODE)"
        }
    } finally {
        Pop-Location
    }
}

Write-Host ''

# --- Avisos sobre servicios externos -------------------------------------
if (-not (Get-Comando 'swipl')) {
    Write-Warning 'No se encontro SWI-Prolog en el PATH. El motor no arrancara hasta instalarlo; define SWIPL con la ruta a swipl.exe si lo tienes instalado.'
}

$mongo = Test-NetConnection -ComputerName 127.0.0.1 -Port 27017 -WarningAction SilentlyContinue
if (-not $mongo.TcpTestSucceeded) {
    Write-Warning 'MongoDB no responde en 127.0.0.1:27017. El sistema arrancara, pero guardar datos fallara hasta levantarlo.'
}

Write-Host ''
Write-Host 'Dependencias listas. Siguientes pasos:'
Write-Host '  1. Copia el entorno:   Copy-Item backend\.env.example backend\.env'
Write-Host '  2. Edita backend\.env  (define SESSION_SECRET y el administrador inicial)'
Write-Host '  3. Motor Prolog:        .\scripts\start-prolog.ps1'
Write-Host '  4. API y frontend:      .\scripts\start-dev.ps1'