param(
  [int]$Port = 8737
)

$root = $PSScriptRoot
$listener = New-Object System.Net.HttpListener
$prefix = "http://localhost:$Port/"
$listener.Prefixes.Add($prefix)

try {
  $listener.Start()
} catch {
  Write-Output "Could not bind $prefix : $($_.Exception.Message)"
  exit 1
}

Write-Output "Word Roguelike prototype serving at $prefix"
Write-Output "Press Ctrl+C to stop."

$mime = @{
  '.html' = 'text/html; charset=utf-8'
  '.js'   = 'application/javascript; charset=utf-8'
  '.css'  = 'text/css; charset=utf-8'
  '.json' = 'application/json; charset=utf-8'
  '.txt'  = 'text/plain; charset=utf-8'
}

$customWordsPath = Join-Path $root 'custom_words.json'

function Get-FlatWordList {
  param($node)
  $out = @()
  if ($null -eq $node) { return $out }
  if ($node -is [string]) { $out += $node.Trim().ToLower(); return $out }
  if ($node -is [System.Collections.IEnumerable]) {
    foreach ($item in $node) { $out += Get-FlatWordList $item }
    return $out
  }
  if ($node.PSObject.Properties.Name -contains 'value') { $out += Get-FlatWordList $node.value }
  return $out
}

function Add-CustomWord {
  param([string]$word)
  $list = @()
  if (Test-Path $customWordsPath) {
    try {
      $raw = Get-Content $customWordsPath -Raw
      if ($raw) { $list = @(Get-FlatWordList (ConvertFrom-Json $raw)) }
    } catch { $list = @() }
  }
  $list = @($list | Where-Object { $_ -match '^[a-z]+$' } | Select-Object -Unique)
  if ($list -notcontains $word) {
    $list = @($list) + $word
    ('[' + (($list | ForEach-Object { '"' + $_ + '"' }) -join ',') + ']') | Out-File -FilePath $customWordsPath -Encoding utf8 -NoNewline
  }
  return $list
}

try {
  while ($listener.IsListening) {
    $context = $listener.GetContext()
    $req = $context.Request
    $res = $context.Response
    try {
      $path = $req.Url.AbsolutePath

      if ($req.HttpMethod -eq 'POST' -and $path -eq '/api/words') {
        $reader = New-Object System.IO.StreamReader($req.InputStream, [System.Text.Encoding]::UTF8)
        $body = $reader.ReadToEnd()
        $reader.Close()
        $word = $null
        try { $word = [string]((ConvertFrom-Json $body).word) } catch {}
        $res.ContentType = 'application/json; charset=utf-8'
        if (-not $word -or $word -notmatch '^[a-zA-Z]+$') {
          $res.StatusCode = 400
          $bytes = [System.Text.Encoding]::UTF8.GetBytes('{"ok":false,"msg":"invalid word"}')
          $res.OutputStream.Write($bytes, 0, $bytes.Length)
        } else {
          Add-CustomWord ($word.ToLower()) | Out-Null
          $bytes = [System.Text.Encoding]::UTF8.GetBytes('{"ok":true}')
          $res.OutputStream.Write($bytes, 0, $bytes.Length)
        }
      } else {
        if ($path -eq '/') { $path = '/index.html' }
        $filePath = Join-Path $root ($path.TrimStart('/'))
        $filePath = [System.IO.Path]::GetFullPath($filePath)
        if (-not $filePath.StartsWith($root)) {
          $res.StatusCode = 403
        } elseif (-not (Test-Path $filePath -PathType Leaf)) {
          $res.StatusCode = 404
          $bytes = [System.Text.Encoding]::UTF8.GetBytes("Not found: $path")
          $res.OutputStream.Write($bytes, 0, $bytes.Length)
        } else {
          $ext = [System.IO.Path]::GetExtension($filePath)
          $res.ContentType = if ($mime.ContainsKey($ext)) { $mime[$ext] } else { 'application/octet-stream' }
          $bytes = [System.IO.File]::ReadAllBytes($filePath)
          $res.OutputStream.Write($bytes, 0, $bytes.Length)
        }
      }
    } catch {
      $res.StatusCode = 500
    } finally {
      $res.OutputStream.Close()
    }
  }
} finally {
  $listener.Stop()
}
