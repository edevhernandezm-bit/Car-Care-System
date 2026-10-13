<#
.SYNOPSIS
    Prueba de humo de punta a punta usando los scripts de arranque.

.DESCRIPTION
    Levanta el stack con los scripts de verdad (start-prolog.ps1 y
    start-dev.ps1) y luego exercise el camino que ve un usuario: pide todo por
    el puerto del frontend y comprueba que Vite, Express y Prolog se hablan.

    No escribe en la base de datos de desarrollo: las escrituras (persistencia
    e historial) las cubre la suite e2e contra una base desechable. Aqui se manda
    un POST sin sesion a proposito, para comprobar a traves del proxy de Vite que
    la ruta esta protegida. El catalogo, el diagnostico del motor, el historial y
    el CORS ya los cubre la suite e2e, asi que no se repiten.

    Al terminar apaga lo que levanto, salvo que se pase -Mantener.

.EXAMPLE
    .\scripts\smoke-test.ps1
    .\scripts\smoke-test.ps1 -Mantener
#>
[CmdletBinding()]
param(
    [int]$PuertoApi = 5000,
    [int]$PuertoWeb = 5173,
    [int]$PuertoProlog = 8000,
    [switch]$Mantener,
    [switch]$SinMongo
)

$ErrorActionPreference = 'Stop'

$Raiz    = Split-Path -Parent $PSScriptRoot
$Web     = "http://localhost:$PuertoWeb"
$script:fallos = 0
$script:totales = 0

function Check([string]$nombre, [bool]$ok, [string]$detalle = '') {
    $script:totales++
    if (-not $ok) { $script:fallos++ }
    $marca = if ($ok) { 'PASA ' } else { 'FALLA' }
    $extra = if ($detalle) { "  -> $detalle" } else { '' }
    Write-Host "$marca $nombre$extra"
}

function Invoke-Api([string]$url, [string]$metodo = 'GET', $cuerpo = $null, [hashtable]$cabeceras = $null) {
    $params = @{ Uri = $url; Method = $metodo; UseBasicParsing = $true; ErrorAction = 'Stop' }
    if ($null -ne $cuerpo) {
        $params.Body = ($cuerpo | ConvertTo-Json -Depth 10)
        $params.ContentType = 'application/json'
    }
    if ($cabeceras) { $params.Headers = $cabeceras }

    try {
        $r = Invoke-WebRequest @params
        $json = $null
        if ($r.Content) { try { $json = $r.Content | ConvertFrom-Json } catch { } }
        return [pscustomobject]@{ Status = [int]$r.StatusCode; Json = $json; Headers = $r.Headers; Raw = $r.Content }
    } catch [System.Net.WebException] {
        # Un 4xx/5xx lanza excepcion en PowerShell 5.1: hay que leer la
        # respuesta a mano para poder inspeccionar el cuerpo del error.
        $status = 0; $raw = ''
        $resp = $_.Exception.Response
        if ($resp) {
            $status = [int]$resp.StatusCode
            $lector = New-Object System.IO.StreamReader($resp.GetResponseStream())
            $raw = $lector.ReadToEnd()
            $lector.Close()
        }
        $json = $null
        if ($raw) { try { $json = $raw | ConvertFrom-Json } catch { } }
        return [pscustomobject]@{ Status = $status; Json = $json; Headers = $null; Raw = $raw }
    }
}

# --- Apagado seguro, pase lo que pase ------------------------------------
function Detener-Todo {
    & (Join-Path $PSScriptRoot 'start-dev.ps1')    -Detener 2>$null | Out-Null
    & (Join-Path $PSScriptRoot 'start-prolog.ps1') -Detener -Puerto $PuertoProlog 2>$null | Out-Null
}

function Puerto-escuchando([int]$puerto) {
    [bool](Get-NetTCPConnection -LocalPort $puerto -State Listen -ErrorAction SilentlyContinue)
}

Detener-Todo

try {
    Write-Host '== 1. Arrancando el motor con scripts/start-prolog.ps1 =='
    & (Join-Path $PSScriptRoot 'start-prolog.ps1') -Puerto $PuertoProlog
    Check 'el motor Prolog levanta y espera a abrir su puerto' (Puerto-escuchando $PuertoProlog) "puerto $PuertoProlog"

    Write-Host ''
    Write-Host '== 2. Arrancando API y frontend con scripts/start-dev.ps1 =='
    & (Join-Path $PSScriptRoot 'start-dev.ps1') -PuertoApi $PuertoApi -PuertoWeb $PuertoWeb -SinMongo:$SinMongo
    Check 'la API levanta y espera a abrir su puerto' (Puerto-escuchando $PuertoApi) "puerto $PuertoApi"
    Check 'el frontend levanta y espera a abrir su puerto' (Puerto-escuchando $PuertoWeb) "puerto $PuertoWeb"

    Write-Host ''
    Write-Host "== 3. El navegador (puerto $PuertoWeb) habla con el stack =="

    $indice = Invoke-Api "$Web/"
    Check 'GET / sirve la pagina' ($indice.Status -eq 200 -and $indice.Raw -match '<div id="root">') "status $($indice.Status)"

    Write-Host ''
    Write-Host '== 4. La API responde y protege =='

    $cambio = Invoke-Api "$Web/api/config/tipo-cambio"
    Check 'el tipo de cambio es positivo' ($cambio.Status -eq 200 -and $cambio.Json.usd_mxn -gt 0) `
        "fuente=$($cambio.Json.fuente) usd_mxn=$($cambio.Json.usd_mxn)"

    # Catalogo, POST del motor, historial y CORS los cubre la suite e2e
    # (pruebas 07/08/09, 06/11, 04 y 09) contra una base desechable. Aqui queda el
    # camino que la e2e no mira: la peticion cruzando el proxy de Vite. Desde 1.7
    # el diagnostico exige sesion, asi que sin cookie lo correcto es un 401; eso
    # comprueba a la vez que el proxy reenvia y que la ruta esta protegida.
    $protegido = Invoke-Api "$Web/api/diagnosticos" 'POST' @{
        vehiculo = @{ marca = 'x'; modelo = 'x'; anio = 0 }
        sintomas = @()
        fallas   = @(@{ falla = 'f'; certeza = 99 })
    }
    Check 'una ruta de datos sin sesion responde 401 a traves del proxy' ($protegido.Status -eq 401) "status $($protegido.Status)"
    Check 'el 401 no filtra el detalle del schema' ($protegido.Raw -notmatch 'Path "|ValidationError') $protegido.Raw

    # /health no pasa por el proxy de Vite (solo enruta /api): lo pide el
    # balanceador contra el puerto de la API.
    $salud = Invoke-Api "http://localhost:$PuertoApi/health"
    Check '/health responde 200 sin sesion' ($salud.Status -eq 200 -and $salud.Json.status -eq 'ok') "status $($salud.Status) db=$($salud.Json.db)"

    $fuente = Invoke-Api "$Web/src/lib/api.js"
    Check 'el cliente ya no llama directo al motor' ($fuente.Raw -notmatch 'localhost:8000')
    Check 'el cliente usa el gateway same-origin' ($fuente.Raw -match '/api/prolog/api/diagnostico')
}
catch {
    Write-Host ''
    Write-Host "ERROR durante la prueba: $_" -ForegroundColor Red
    $script:totales++
    $script:fallos++
}
finally {
    if ($Mantener) {
        Write-Host ''
        Write-Host "Se dejo el stack corriendo (puerto web $PuertoWeb)."
    } else {
        Write-Host ''
        Write-Host '== Apagando el stack =='
        Detener-Todo
    }
}

Write-Host ''
if ($script:fallos -eq 0) {
    Write-Host "TODO EN VERDE ($script:totales comprobaciones)" -ForegroundColor Green
    exit 0
} else {
    Write-Host "$script:fallos de $script:totales comprobaciones fallaron" -ForegroundColor Red
    exit 1
}
