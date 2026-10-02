$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath($PSScriptRoot)
$rootPrefix = $root.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
$listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 8000)

try {
  $listener.Start()
} catch {
  Write-Error 'Could not start the local app on port 8000. Close the other app using that port and try again.'
  exit 1
}

$url = 'http://127.0.0.1:8000/'
Write-Host "Local PDF Name Review is running at $url"
Write-Host 'Keep this window open while using the app. Press Ctrl+C to stop it.'
$browserPaths = @(
  (Join-Path ${env:ProgramFiles(x86)} 'Google\Chrome\Application\chrome.exe'),
  (Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe'),
  (Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe'),
  (Join-Path $env:ProgramFiles 'Microsoft\Edge\Application\msedge.exe')
)
$browser = $browserPaths | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if ($browser) {
  Start-Process -FilePath $browser -ArgumentList $url
} else {
  Start-Process $url
}

try {
  while ($listener.Server.IsBound) {
    $client = $listener.AcceptTcpClient()
    try {
      $stream = $client.GetStream()
      $reader = [IO.StreamReader]::new($stream, [Text.Encoding]::ASCII, $false, 1024, $true)
      $requestLine = $reader.ReadLine()
      while ($reader.ReadLine() -ne '') { }

      $status = '200 OK'
      $contentType = 'application/octet-stream'
      $bytes = [byte[]]@()
      if ($requestLine -match '^GET\s+(\S+)\s+HTTP/') {
        $requestPath = [Uri]::UnescapeDataString(([Uri]$url).GetLeftPart([UriPartial]::Authority) + $Matches[1])
        $relativePath = ([Uri]$requestPath).AbsolutePath.TrimStart('/')
        if ([string]::IsNullOrWhiteSpace($relativePath)) { $relativePath = 'index.html' }
        $filePath = [IO.Path]::GetFullPath((Join-Path $root $relativePath))

        if ($filePath.StartsWith($rootPrefix, [StringComparison]::OrdinalIgnoreCase) -and (Test-Path -LiteralPath $filePath -PathType Leaf)) {
          $bytes = [IO.File]::ReadAllBytes($filePath)
          $contentType = switch ([IO.Path]::GetExtension($filePath).ToLowerInvariant()) {
            '.html' { 'text/html; charset=utf-8' }
            '.js' { 'application/javascript; charset=utf-8' }
            '.css' { 'text/css; charset=utf-8' }
            '.pdf' { 'application/pdf' }
            default { 'application/octet-stream' }
          }
        } else {
          $status = '404 Not Found'
          $bytes = [Text.Encoding]::UTF8.GetBytes('Not found')
          $contentType = 'text/plain; charset=utf-8'
        }
      } else {
        $status = '400 Bad Request'
        $bytes = [Text.Encoding]::UTF8.GetBytes('Bad request')
        $contentType = 'text/plain; charset=utf-8'
      }

      $headers = [Text.Encoding]::ASCII.GetBytes("HTTP/1.1 $status`r`nContent-Type: $contentType`r`nContent-Length: $($bytes.Length)`r`nConnection: close`r`nCache-Control: no-store`r`n`r`n")
      $stream.Write($headers, 0, $headers.Length)
      if ($bytes.Length -gt 0) { $stream.Write($bytes, 0, $bytes.Length) }
      $stream.Flush()
    } catch {
      Write-Warning $_.Exception.Message
    } finally {
      if ($reader) { $reader.Dispose() }
      if ($client) { $client.Dispose() }
    }
  }
} finally {
  $listener.Stop()
}