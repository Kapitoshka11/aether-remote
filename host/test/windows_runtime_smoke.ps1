$raw = Get-Content -Raw -LiteralPath (Join-Path $PSScriptRoot '..\lib\windows-audio.cjs')
$match = [regex]::Match($raw, 'const coreAudioTypeDefinition = String.raw`(?s)(.*?)`;')
if (-not $match.Success) { throw 'Core Audio implementation was not found' }
Add-Type -TypeDefinition $match.Groups[1].Value
$audioState = [AetherAudio]::GetStateJson() | ConvertFrom-Json
if ($audioState.volume -lt 0 -or $audioState.volume -gt 100) { throw 'Windows volume is outside the expected range' }
if ($audioState.isMuted -isnot [bool]) { throw 'Windows mute state is invalid' }

Add-Type -AssemblyName System.Runtime.WindowsRuntime
function Await-WinRt($operation, [Type]$resultType) {
    $method = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetParameters().Count -eq 1 } | Select-Object -First 1
    $task = $method.MakeGenericMethod($resultType).Invoke($null, @($operation))
    $task.Wait()
    $task.Result
}
$managerType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]
$manager = Await-WinRt ($managerType::RequestAsync()) $managerType
if ($null -eq $manager) { throw 'Windows media session manager is unavailable' }
$session = $manager.GetCurrentSession()
if ($session) {
    $propertiesType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties, Windows.Media.Control, ContentType = WindowsRuntime]
    $properties = Await-WinRt ($session.TryGetMediaPropertiesAsync()) $propertiesType
    if ($null -eq $properties) { throw 'Windows media properties are unavailable' }
}
Write-Host "Windows audio and media runtime tests passed. Volume: $($audioState.volume)%"
