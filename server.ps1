# Local site server + OpenAI chat proxy (API key stays on server)
# Run: powershell -ExecutionPolicy Bypass -File server.ps1

$ErrorActionPreference = 'Stop'
if ($SabinaWorker -and $ChatRoot) {
  $Root = $ChatRoot
} else {
  $Root = Split-Path -Parent $MyInvocation.MyCommand.Path
}
$Port = 8131
if ($env:PORT -match '^\d+$') { $Port = [int]$env:PORT }
$EnvFile = Join-Path $Root '.env'
$PromptFile = Join-Path $Root 'system-prompt.txt'

function Get-DotEnv {
  $map = @{}
  if (-not (Test-Path $EnvFile)) { return $map }
  Get-Content $EnvFile -Encoding UTF8 | ForEach-Object {
    $line = $_.Trim()
    if (-not $line -or $line.StartsWith('#')) { return }
    $i = $line.IndexOf('=')
    if ($i -lt 1) { return }
    $k = $line.Substring(0, $i).Trim()
    $v = $line.Substring($i + 1).Trim().Trim('"').Trim("'")
    $map[$k] = $v
  }
  return $map
}

$envMap = Get-DotEnv
function Get-Setting([string]$Name, [string]$Fallback = '') {
  $fromProc = [Environment]::GetEnvironmentVariable($Name)
  if ($fromProc) { return $fromProc }
  $fromFile = [string]$envMap[$Name]
  if ($fromFile) { return $fromFile }
  return $Fallback
}
$ApiKey = Get-Setting 'OPENAI_API_KEY'
$Model  = Get-Setting 'OPENAI_MODEL' 'gpt-5.4-mini'

if (-not $ApiKey) {
  Write-Host 'Missing OPENAI_API_KEY in .env or environment' -ForegroundColor Red
  exit 1
}

if (-not (Test-Path $PromptFile)) {
  Write-Host 'Missing system-prompt.txt' -ForegroundColor Red
  exit 1
}

$SystemPrompt = [System.IO.File]::ReadAllText($PromptFile, [System.Text.Encoding]::UTF8)

$script:AdminTokens = [hashtable]::Synchronized(@{})
$script:ChatLock = New-Object System.Object
$script:ChatJobs = New-Object System.Collections.Generic.List[object]
$mutexName = 'Local\SabinaSiteCrm'
if ($PSVersionTable.Platform -eq 'Unix') { $mutexName = 'SabinaSiteCrm' }
try {
  $script:CrmMutex = New-Object System.Threading.Mutex($false, $mutexName)
} catch {
  if (-not $SabinaWorker) {
    Write-Host ("CRM lock is private to one worker: {0}" -f $_.Exception.Message) -ForegroundColor Yellow
  }
  $script:CrmMutex = New-Object System.Threading.Mutex($false)
}
$script:PublicHits = [hashtable]::Synchronized(@{})
$script:PublicHitLock = New-Object System.Object
$script:ChatMaxBytes = 8 * 1024 * 1024
$script:ChatToken = Get-Setting 'CHAT_TOKEN'
if (-not $SabinaWorker) {
  if (-not $script:ChatToken -or $script:ChatToken.Length -lt 24) {
    $tokenBytes = New-Object byte[] 32
    $tokenRng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try { $tokenRng.GetBytes($tokenBytes) } finally { $tokenRng.Dispose() }
    $script:ChatToken = -join ($tokenBytes | ForEach-Object { $_.ToString('x2') })
    try {
      $tokenEnc = New-Object System.Text.UTF8Encoding $false
      [System.IO.File]::AppendAllText($EnvFile, "`r`nCHAT_TOKEN=$($script:ChatToken)`r`n", $tokenEnc)
    } catch {}
  }
}
$AdminPassword = Get-Setting 'ADMIN_PASSWORD'
if (-not $AdminPassword) {
  $passFile = Join-Path $Root 'admin.password'
  if (Test-Path -LiteralPath $passFile) {
    $AdminPassword = ([System.IO.File]::ReadAllText($passFile, [System.Text.Encoding]::UTF8)).Trim()
  }
}
if (-not $AdminPassword) {
  $productsJs = Join-Path $Root 'products.js'
  if (Test-Path -LiteralPath $productsJs) {
    $pj = [System.IO.File]::ReadAllText($productsJs, [System.Text.Encoding]::UTF8)
    if ($pj -match '"adminPass"\s*:\s*"([^"]*)"') { $AdminPassword = $Matches[1] }
  }
}

if (-not $SabinaWorker) {
  $BindHost = 'localhost'
  if ($env:BIND_HOST) { $BindHost = $env:BIND_HOST.Trim() }
  $prefixHost = $BindHost
  if ($prefixHost -in @('0.0.0.0', '*', '+')) { $prefixHost = '*' }
  $prefixes = @("http://${prefixHost}:$Port/")
  if ($prefixHost -eq '*') { $prefixes = @("http://*:${Port}/", "http://+:${Port}/") }
  $listener = $null
  $lastErr = $null
  foreach ($prefix in $prefixes) {
    $tryListener = New-Object System.Net.HttpListener
    $tryListener.Prefixes.Add($prefix)
    try {
      $tryListener.Start()
      $listener = $tryListener
      break
    } catch {
      $lastErr = $_.Exception.Message
      try { $tryListener.Close() } catch {}
    }
  }
  if (-not $listener) {
    Write-Host ("Listener failed on port {0}: {1}" -f $Port, $lastErr) -ForegroundColor Red
    exit 1
  }

  Write-Host ("Site:   http://localhost:{0}/index.html" -f $Port) -ForegroundColor Green
  Write-Host ("Admin:  http://localhost:{0}/admin.html" -f $Port) -ForegroundColor Green
  Write-Host ("AI API: http://localhost:{0}/api/chat" -f $Port) -ForegroundColor Cyan
  if ($prefixHost -eq 'localhost') {
    Write-Host "Bind:   localhost only. Publish this site only behind HTTPS." -ForegroundColor Yellow
  } else {
    Write-Host ("Bind:   {0}:{1}" -f $prefixHost, $Port) -ForegroundColor Yellow
  }
}

function Send-Bytes($res, [byte[]]$bytes, $contentType, $status = 200, $cache = 'no-store', $cors = $true) {
  $res.StatusCode = $status
  $res.ContentType = $contentType
  $res.Headers['Cache-Control'] = $cache
  $res.Headers['X-Content-Type-Options'] = 'nosniff'
  $res.Headers['Referrer-Policy'] = 'strict-origin-when-cross-origin'
  $res.Headers['X-Frame-Options'] = 'SAMEORIGIN'
  if ($cors) { $res.Headers['Access-Control-Allow-Origin'] = '*' }
  $res.ContentLength64 = $bytes.Length
  $res.OutputStream.Write($bytes, 0, $bytes.Length)
  $res.OutputStream.Close()
}

function Send-Json($res, $obj, $status = 200, $cors = $true) {
  $json = ConvertTo-JsonSafe $obj
  if (-not $json) { $json = 'null' }
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
  Send-Bytes $res $bytes 'application/json; charset=utf-8' $status 'no-store' $cors
}

function Get-Mime($ext) {
  switch ($ext.ToLower()) {
    '.html' { 'text/html; charset=utf-8' }
    '.css'  { 'text/css; charset=utf-8' }
    '.js'   { 'application/javascript; charset=utf-8' }
    '.png'  { 'image/png' }
    '.jpg'  { 'image/jpeg' }
    '.jpeg' { 'image/jpeg' }
    '.svg'  { 'image/svg+xml' }
    '.ico'  { 'image/x-icon' }
    '.webp' { 'image/webp' }
    '.txt'  { 'text/plain; charset=utf-8' }
    '.json' { 'application/json; charset=utf-8' }
    default { 'application/octet-stream' }
  }
}

function Test-JsonWrapper($o) {
  # PowerShell ConvertTo-Json иногда пишет {value:[…], Count:N}, иногда только {value:[…]}
  if ($null -eq $o) { return $false }
  $names = @()
  try { $names = @($o.PSObject.Properties.Name) } catch { return $false }
  return ($names -contains 'value' -and $names -notcontains 'id')
}

function Flatten-CrmList {
  # Разворачивает битые {value} / {value, Count} и собирает объекты с id.
  # Возвращает List[object] (не массив с unary-comma) — иначе @() / foreach
  # получают один элемент-массив и $o.id склеивает все id через пробел.
  param($Node)
  $out = New-Object System.Collections.Generic.List[object]
  function Walk($n) {
    if ($null -eq $n) { return }
    if ($n -is [string]) { return }
    if (Test-JsonWrapper $n) {
      Walk $n.value
      return
    }
    $isEnum = $n -is [System.Collections.IEnumerable] -and
              $n -isnot [string] -and
              $n -isnot [hashtable] -and
              $n -isnot [System.Collections.IDictionary]
    if ($isEnum) {
      foreach ($i in @($n)) { Walk $i }
      return
    }
    $id = $null
    try { $id = [string]$n.id } catch {}
    if ($id -and ($id -notmatch '\s')) { [void]$out.Add($n) }
  }
  Walk $Node
  return $out
}

function ConvertTo-Plain($o) {
  if ($null -eq $o) { return $null }
  if ($o -is [string] -or $o -is [char]) { return [string]$o }
  if ($o -is [bool]) { return [bool]$o }
  if ($o -is [byte] -or $o -is [int16] -or $o -is [int] -or $o -is [long] -or $o -is [decimal] -or $o -is [double] -or $o -is [float]) {
    return $o
  }
  if (Test-JsonWrapper $o) {
    return ConvertTo-Plain $o.value
  }
  if ($o -is [System.Collections.IDictionary]) {
    $h = [ordered]@{}
    foreach ($k in @($o.Keys)) {
      $h[[string]$k] = ConvertTo-Plain $o[$k]
    }
    return $h
  }
  $isEnum = $o -is [System.Collections.IEnumerable] -and $o -isnot [string]
  if ($isEnum) {
    $list = New-Object System.Collections.Generic.List[object]
    foreach ($i in @($o)) {
      [void]$list.Add((ConvertTo-Plain $i))
    }
    # Важно: ToArray(), без unary-comma обёртки — иначе снова {value,Count}
    return $list.ToArray()
  }
  $props = @($o.PSObject.Properties | Where-Object {
    $_.MemberType -eq 'NoteProperty' -or $_.MemberType -eq 'Property'
  })
  if ($props.Count -gt 0) {
    $h = [ordered]@{}
    foreach ($p in $props) {
      if ($p.Name -eq 'SyncRoot' -or $p.Name -eq 'Count' -or $p.Name -eq 'IsReadOnly' -or $p.Name -eq 'IsFixedSize' -or $p.Name -eq 'IsSynchronized' -or $p.Name -eq 'Length') { continue }
      try { $h[$p.Name] = ConvertTo-Plain $p.Value } catch {}
    }
    if ($h.Count -gt 0) { return $h }
  }
  return [string]$o
}

function ConvertTo-JsonSafe($obj) {
  if ($null -eq $obj) { return 'null' }

  # Явный массив / список → собираем JSON поэлементно (ConvertTo-Json -InputObject, не pipeline)
  $isList = $obj -is [System.Array] -or
            $obj -is [System.Collections.ArrayList] -or
            $obj -is [System.Collections.Generic.List[object]] -or
            ($obj -is [System.Collections.IList] -and $obj -isnot [string])

  if ($isList) {
    $parts = New-Object System.Collections.Generic.List[string]
    foreach ($item in @($obj)) {
      if ($null -eq $item) { continue }
      if (Test-JsonWrapper $item) {
        foreach ($inner in @(Flatten-CrmList $item)) {
          $plainInner = ConvertTo-Plain $inner
          $chunkInner = ConvertTo-Json -InputObject $plainInner -Depth 80 -Compress
          if ($chunkInner) { [void]$parts.Add($chunkInner) }
        }
        continue
      }
      $plain = ConvertTo-Plain $item
      if ($plain -is [System.Array]) {
        # вложенный массив как значение одного слота — сериализуем целиком
        $chunk = ConvertTo-Json -InputObject $plain -Depth 80 -Compress
      } else {
        $chunk = ConvertTo-Json -InputObject $plain -Depth 80 -Compress
      }
      if ($chunk) { [void]$parts.Add($chunk) }
    }
    return ('[' + ($parts -join ',') + ']')
  }

  $plain = ConvertTo-Plain $obj
  if ($plain -is [System.Array]) {
    return (ConvertTo-JsonSafe $plain)
  }
  $json = ConvertTo-Json -InputObject $plain -Depth 80 -Compress
  if (-not $json) { return '{}' }
  return $json
}

function Write-JsonFileAtomic([string]$path, [string]$json) {
  $tmp = $path + '.' + [guid]::NewGuid().ToString('n') + '.tmp'
  $enc = New-Object System.Text.UTF8Encoding $false
  [System.IO.File]::WriteAllText($tmp, $json, $enc)
  try {
    if (Test-Path -LiteralPath $path) {
      [System.IO.File]::Replace($tmp, $path, ($path + '.bak'), $true)
    } else {
      [System.IO.File]::Move($tmp, $path)
    }
  } catch {
    Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue
    throw
  }
}

function Enter-CrmLock {
  try {
    [void]$script:CrmMutex.WaitOne()
  } catch {
    $ex = $_.Exception
    while ($ex -and $ex.InnerException) { $ex = $ex.InnerException }
    if ($ex -isnot [System.Threading.AbandonedMutexException]) { throw }
  }
}

function Exit-CrmLock {
  try { [void]$script:CrmMutex.ReleaseMutex() } catch {}
}

function Escape-JsonString([string]$s) {
  if ($null -eq $s) { return '' }
  return $s.Replace('\', '\\').Replace('"', '\"').Replace("`r", '\r').Replace("`n", '\n').Replace("`t", '\t')
}

function ConvertTo-JsonScalar($v) {
  if ($null -eq $v) { return 'null' }
  if ($v -is [bool]) { if ($v) { return 'true' } else { return 'false' } }
  if ($v -is [byte] -or $v -is [int16] -or $v -is [int] -or $v -is [long] -or $v -is [decimal] -or $v -is [double] -or $v -is [float]) {
    return ([string]$v).Replace(',', '.')
  }
  return '"' + (Escape-JsonString ([string]$v)) + '"'
}

function Get-Prop($o, [string]$name) {
  if ($null -eq $o) { return $null }
  if ($o -is [System.Collections.IDictionary]) {
    if (@($o.Keys) -contains $name) { return $o[$name] }
    return $null
  }
  try { return $o.$name } catch { return $null }
}

function Test-IsBlank($val) {
  if ($null -eq $val) { return $true }
  if ($val -is [System.Array]) { return $true }
  if ($val -is [string] -or $val -is [char]) { return ([string]$val) -eq '' }
  return $false
}

function ConvertTo-OrderItemsJson($items) {
  $list = New-Object System.Collections.Generic.List[object]
  if ($null -eq $items) { return '[]' }
  if ($items -is [System.Collections.IDictionary]) {
    [void]$list.Add($items)
  } elseif ($items -is [System.Collections.IEnumerable] -and $items -isnot [string]) {
    foreach ($i in $items) {
      if ($i -is [string]) { continue }
      [void]$list.Add($i)
    }
  } else {
    [void]$list.Add($items)
  }
  $parts = New-Object System.Collections.Generic.List[string]
  foreach ($it in $list) {
    $keys = @('id','name','size','qty','price','currency','unitLabel','lineKzt')
    $fields = New-Object System.Collections.Generic.List[string]
    foreach ($k in $keys) {
      $val = Get-Prop $it $k
      if (Test-IsBlank $val) { continue }
      [void]$fields.Add(('"{0}":{1}' -f $k, (ConvertTo-JsonScalar $val)))
    }
    # любые доп. поля
    if ($it -is [System.Collections.IDictionary]) {
      foreach ($k in @($it.Keys)) {
        if ($keys -contains [string]$k) { continue }
        [void]$fields.Add(('"{0}":{1}' -f (Escape-JsonString ([string]$k)), (ConvertTo-JsonScalar $it[$k])))
      }
    }
    [void]$parts.Add('{' + ($fields -join ',') + '}')
  }
  return '[' + ($parts -join ',') + ']'
}

function ConvertTo-OrdersFileJson($orders) {
  # Ручная сборка: ConvertTo-Json в PS разворачивает items из [x] в {x}
  $orderParts = New-Object System.Collections.Generic.List[string]
  $src = New-Object System.Collections.Generic.List[object]
  foreach ($o in @($orders)) {
    if ($null -eq $o) { continue }
    # если сюда попал целый массив заказов (ошибка unwrap) — разворачиваем
    $isEnum = $o -is [System.Collections.IEnumerable] -and
              $o -isnot [string] -and
              $o -isnot [hashtable] -and
              $o -isnot [System.Collections.IDictionary]
    $oidProbe = $null
    try { $oidProbe = $o.id } catch {}
    if ($isEnum -and ($null -eq $oidProbe -or $oidProbe -is [System.Array] -or [string]$oidProbe -match '\s')) {
      foreach ($inner in @($o)) {
        if ($null -ne $inner) { [void]$src.Add($inner) }
      }
      continue
    }
    [void]$src.Add($o)
  }
  foreach ($o in $src) {
    if ($null -eq $o) { continue }
    $id = Get-Prop $o 'id'
    if ($null -eq $id -or $id -is [System.Array]) { continue }
    $id = [string]$id
    if (-not $id -or $id -match '\s') { continue }
    $fields = New-Object System.Collections.Generic.List[string]
    foreach ($k in @('id','createdAt','clientName','clientPhone','totalKzt','totalLabel','currency','messenger','status','source','updatedAt')) {
      $val = Get-Prop $o $k
      if (Test-IsBlank $val) { continue }
      [void]$fields.Add(('"{0}":{1}' -f $k, (ConvertTo-JsonScalar $val)))
    }
    [void]$fields.Add('"items":' + (ConvertTo-OrderItemsJson (Get-Prop $o 'items')))
    [void]$orderParts.Add('{' + ($fields -join ',') + '}')
  }
  return '[' + ($orderParts -join ',') + ']'
}

function Set-Note($obj, [string]$name, $value) {
  if ($null -eq $obj) { return }
  $has = $false
  foreach ($p in @($obj.PSObject.Properties)) {
    if ($p.Name -eq $name) { $has = $true; break }
  }
  if ($has) { $obj.$name = $value }
  else { $obj | Add-Member -NotePropertyName $name -NotePropertyValue $value -Force }
}

function Test-StampNewer($incoming, $existing) {
  $a = [string]$incoming
  $b = [string]$existing
  if (-not $a) { return $false }
  if (-not $b) { return $true }
  try {
    $da = [datetimeoffset]::Parse($a).UtcDateTime
    $db = [datetimeoffset]::Parse($b).UtcDateTime
    return ($da -ge $db)
  } catch { return $false }
}

function Read-JsonFile([string]$path) {
  $bak = $path + '.bak'
  if (-not (Test-Path -LiteralPath $path)) {
    return @{ Ok = $true; Missing = $true; Data = $null }
  }
  try {
    $raw = [System.IO.File]::ReadAllText($path, [System.Text.Encoding]::UTF8)
    if (-not $raw.Trim()) {
      if (Test-Path -LiteralPath $bak) {
        $braw = [System.IO.File]::ReadAllText($bak, [System.Text.Encoding]::UTF8)
        if ($braw.Trim()) {
          $data = $braw | ConvertFrom-Json
          [System.IO.File]::Copy($bak, $path, $true)
          return @{ Ok = $true; Missing = $false; Data = $data; Restored = $true }
        }
      }
      return @{ Ok = $true; Missing = $false; Data = $null }
    }
    return @{ Ok = $true; Missing = $false; Data = ($raw | ConvertFrom-Json) }
  } catch {
    if (Test-Path -LiteralPath $bak) {
      try {
        $braw = [System.IO.File]::ReadAllText($bak, [System.Text.Encoding]::UTF8)
        $data = $braw | ConvertFrom-Json
        [System.IO.File]::Copy($bak, $path, $true)
        return @{ Ok = $true; Missing = $false; Data = $data; Restored = $true }
      } catch {}
    }
    return @{ Ok = $false; Missing = $false; Data = $null; Error = [string]$_.Exception.Message }
  }
}

function Read-IdSet([string]$path) {
  $doc = Read-JsonFile $path
  if (-not $doc.Ok) { return @{ Ok = $false; Ids = (New-Object System.Collections.Generic.List[string]) } }
  $ids = New-Object System.Collections.Generic.List[string]
  $seen = @{}
  if (-not $doc.Missing -and $null -ne $doc.Data) {
    foreach ($x in @($doc.Data)) {
      if ($x -isnot [string]) { continue }
      $s = [string]$x
      if (-not $s -or ($s -match '\s') -or $seen.ContainsKey($s)) { continue }
      $seen[$s] = $true
      [void]$ids.Add($s)
    }
  }
  return @{ Ok = $true; Ids = $ids }
}

function Write-IdSet([string]$path, $ids) {
  $seen = @{}
  $clean = New-Object System.Collections.Generic.List[string]
  foreach ($id in @($ids)) {
    $s = [string]$id
    if (-not $s -or $seen.ContainsKey($s)) { continue }
    $seen[$s] = $true
    [void]$clean.Add($s)
  }
  while ($clean.Count -gt 5000) { $clean.RemoveAt(0) }
  $parts = New-Object System.Collections.Generic.List[string]
  foreach ($s in $clean) { [void]$parts.Add('"' + (Escape-JsonString $s) + '"') }
  Write-JsonFileAtomic $path ('[' + ($parts -join ',') + ']')
}

function Test-IdListed($ids, [string]$id) {
  foreach ($x in @($ids)) { if ([string]$x -eq $id) { return $true } }
  return $false
}

function ConvertTo-WrappedListJson([string]$listKey, [string]$listJson, $deleted, $total = $null, $limit = $null, $offset = $null, $nextSort = $null, $nextRow = $null) {
  if (-not $listJson -or -not $listJson.TrimStart().StartsWith('[')) { $listJson = '[]' }
  $delParts = New-Object System.Collections.Generic.List[string]
  foreach ($id in @($deleted)) {
    $s = [string]$id
    if ($s) { [void]$delParts.Add('"' + (Escape-JsonString $s) + '"') }
  }
  $extra = ''
  if ($null -ne $limit) {
    $extra = ',"total":' + ([int64]$total) + ',"limit":' + ([int64]$limit) + ',"offset":' + ([int64]$offset)
  }
  if ($null -ne $nextSort -and $null -ne $nextRow) {
    $extra += ',"nextSort":' + ([int64]$nextSort) + ',"nextRow":' + ([int64]$nextRow)
  }
  return ('{"' + $listKey + '":' + $listJson + ',"deleted":[' + ($delParts -join ',') + ']' + $extra + '}')
}

function Send-RawJson($res, [string]$json, $status = 200) {
  if (-not $json) { $json = '{}' }
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
  Send-Bytes $res $bytes 'application/json; charset=utf-8' $status
}

function Get-ClientIp($req) {
  try {
    $ip = $req.RemoteEndPoint.Address.ToString()
    if ($ip) { return $ip }
  } catch {}
  return '0'
}

function Test-SameSecret([string]$a, [string]$b) {
  if ($null -eq $a) { $a = '' }
  if ($null -eq $b) { $b = '' }
  $ba = [System.Text.Encoding]::UTF8.GetBytes($a)
  $bb = [System.Text.Encoding]::UTF8.GetBytes($b)
  $diff = ($ba.Length -bxor $bb.Length)
  $n = [Math]::Max($ba.Length, $bb.Length)
  for ($i = 0; $i -lt $n; $i++) {
    $x = 0
    $y = 0
    if ($i -lt $ba.Length) { $x = $ba[$i] }
    if ($i -lt $bb.Length) { $y = $bb[$i] }
    $diff = $diff -bor ($x -bxor $y)
  }
  return ($diff -eq 0)
}

function Test-ChatCookie($req) {
  $want = [string]$script:ChatToken
  $gateVar = Get-Variable -Name ChatGate -Scope Global -ErrorAction SilentlyContinue
  if ($gateVar -and [string]$gateVar.Value) { $want = [string]$gateVar.Value }
  if (-not $want) { return $false }
  $raw = [string]$req.Headers['Cookie']
  if (-not $raw) { return $false }
  $got = ''
  foreach ($part in $raw.Split(';')) {
    $piece = $part.Trim()
    if ($piece.StartsWith('sabina_chat=')) {
      $got = $piece.Substring('sabina_chat='.Length)
      break
    }
  }
  return (Test-SameSecret $got $want)
}

function Test-RateAllow([string]$bucket, [string]$ip, [int]$limit, [int]$windowSec) {
  if (-not $script:PublicHits) { return $true }
  $key = $bucket + '|' + $ip
  $now = [DateTime]::UtcNow
  $allow = $true
  if ($script:PublicHitLock) { [System.Threading.Monitor]::Enter($script:PublicHitLock) }
  try {
    $list = $script:PublicHits[$key]
    if (-not $list) {
      $list = New-Object System.Collections.Generic.List[datetime]
      $script:PublicHits[$key] = $list
    }
    $cutoff = $now.AddSeconds(-1 * $windowSec)
    for ($i = $list.Count - 1; $i -ge 0; $i--) {
      if ($list[$i] -lt $cutoff) { $list.RemoveAt($i) }
    }
    if ($list.Count -ge $limit) { $allow = $false }
    else { [void]$list.Add($now) }
  } finally {
    if ($script:PublicHitLock) { [System.Threading.Monitor]::Exit($script:PublicHitLock) }
  }
  return $allow
}

function Read-LimitedBody($req, [int]$maxBytes) {
  $stream = $req.InputStream
  $buf = New-Object byte[] 4096
  $ms = New-Object System.IO.MemoryStream
  $total = 0
  while ($true) {
    $n = $stream.Read($buf, 0, $buf.Length)
    if ($n -le 0) { break }
    $total += $n
    if ($total -gt $maxBytes) {
      $ms.Dispose()
      return $null
    }
    $ms.Write($buf, 0, $n)
  }
  $text = [System.Text.Encoding]::UTF8.GetString($ms.ToArray())
  $ms.Dispose()
  return $text
}

function Test-Admin($req) {
  $token = [string]$req.Headers['X-Admin-Token']
  if (-not $token) { return $false }
  if (-not $script:AdminTokens.ContainsKey($token)) { return $false }
  if ([DateTime]$script:AdminTokens[$token] -lt [DateTime]::UtcNow) {
    $script:AdminTokens.Remove($token)
    return $false
  }
  return $true
}

function Handle-AdminLogin($req, $res) {
  if ($req.HttpMethod -eq 'OPTIONS') {
    $res.StatusCode = 204
    $res.Headers['Access-Control-Allow-Origin'] = '*'
    $res.Headers['Access-Control-Allow-Methods'] = 'POST, OPTIONS'
    $res.Headers['Access-Control-Allow-Headers'] = 'Content-Type, X-Admin-Token'
    $res.ContentLength64 = 0
    $res.Close()
    return
  }
  if ($req.HttpMethod -ne 'POST') { Send-Json $res @{ error = 'POST only' } 405; return }
  $reader = New-Object System.IO.StreamReader($req.InputStream, [System.Text.Encoding]::UTF8)
  $body = $reader.ReadToEnd()
  $reader.Close()
  try { $payload = $body | ConvertFrom-Json } catch {
    Send-Json $res @{ error = 'bad json' } 400
    return
  }
  $pass = [string]$payload.password
  if (-not $AdminPassword -or $pass -ne $AdminPassword) {
    Send-Json $res @{ error = 'unauthorized' } 401
    return
  }
  $token = [Guid]::NewGuid().ToString('N') + [Guid]::NewGuid().ToString('N')
  $script:AdminTokens[$token] = [DateTime]::UtcNow.AddHours(12)
  Send-Json $res @{ token = $token }
}

function Enter-ChatLock {
  if ($script:ChatLock) { [System.Threading.Monitor]::Enter($script:ChatLock) }
}

function Exit-ChatLock {
  if ($script:ChatLock) {
    try { [System.Threading.Monitor]::Exit($script:ChatLock) } catch {}
  }
}

function Clear-FinishedChats {
  Enter-ChatLock
  try {
    for ($i = $script:ChatJobs.Count - 1; $i -ge 0; $i--) {
      $job = $script:ChatJobs[$i]
      if (-not $job.Handle.IsCompleted) { continue }
      try { $null = $job.Ps.EndInvoke($job.Handle) } catch {}
      try { $job.Ps.Dispose() } catch {}
      try { $job.Runspace.Dispose() } catch {}
      $script:ChatJobs.RemoveAt($i)
    }
  } finally {
    Exit-ChatLock
  }
}

function Start-ChatAsync($req, $res) {
  if ($req.HttpMethod -eq 'OPTIONS') {
    $res.StatusCode = 204
    $res.ContentLength64 = 0
    $res.Close()
    return
  }
  if ($req.HttpMethod -ne 'POST') {
    Send-Json $res @{ error = 'POST only' } 405 $false
    return
  }
  $maxBytes = 8 * 1024 * 1024
  if ($script:ChatMaxBytes) { $maxBytes = [int]$script:ChatMaxBytes }
  if ($req.ContentLength64 -gt $maxBytes) {
    Send-Json $res @{ error = 'too large' } 413 $false
    return
  }
  if (-not (Test-ChatCookie $req)) {
    Send-Json $res @{ error = 'unauthorized' } 401 $false
    return
  }
  $ip = Get-ClientIp $req
  if (-not (Test-RateAllow 'chat' $ip 20 600)) {
    Send-Json $res @{ error = 'too many requests' } 429 $false
    return
  }
  if (-not (Test-RateAllow 'chat-all' 'all' 60 600)) {
    Send-Json $res @{ error = 'too many requests' } 429 $false
    return
  }

  $pack = @{ kzt = ''; rub = ''; usd = '' }
  try { $pack = Build-ChatCatalogPack } catch {
    Write-Host ("Chat catalog pack failed: {0}" -f $_.Exception.Message) -ForegroundColor Red
    $note = -join @(
      [char]0x0414, [char]0x0430, [char]0x043D, [char]0x043D, [char]0x044B, [char]0x0435, [char]0x0020,
      [char]0x043F, [char]0x043E, [char]0x0020, [char]0x043A, [char]0x0430, [char]0x0442, [char]0x0430,
      [char]0x043B, [char]0x043E, [char]0x0433, [char]0x0443, [char]0x0020, [char]0x0432, [char]0x0440,
      [char]0x0435, [char]0x043C, [char]0x0435, [char]0x043D, [char]0x043D, [char]0x043E, [char]0x0020,
      [char]0x043D, [char]0x0435, [char]0x0434, [char]0x043E, [char]0x0441, [char]0x0442, [char]0x0443,
      [char]0x043F, [char]0x043D, [char]0x044B, [char]0x002E, [char]0x0020, [char]0x041D, [char]0x0435,
      [char]0x0020, [char]0x043D, [char]0x0430, [char]0x0437, [char]0x044B, [char]0x0432, [char]0x0430,
      [char]0x0442, [char]0x044C, [char]0x0020, [char]0x0446, [char]0x0435, [char]0x043D, [char]0x044B,
      [char]0x0020, [char]0x0438, [char]0x0020, [char]0x0442, [char]0x043E, [char]0x0432, [char]0x0430,
      [char]0x0440, [char]0x044B, [char]0x002E
    )
    $pack = @{ kzt = $note; rub = $note; usd = $note }
  }

  $rs = $null
  $ps = $null
  Enter-ChatLock
  try {
    for ($i = $script:ChatJobs.Count - 1; $i -ge 0; $i--) {
      $job = $script:ChatJobs[$i]
      if (-not $job.Handle.IsCompleted) { continue }
      try { $null = $job.Ps.EndInvoke($job.Handle) } catch {}
      try { $job.Ps.Dispose() } catch {}
      try { $job.Runspace.Dispose() } catch {}
      $script:ChatJobs.RemoveAt($i)
    }
    if ($script:ChatJobs.Count -ge 4) {
      Send-Json $res @{ error = 'chat busy' } 429 $false
      return
    }
    $rs = [runspacefactory]::CreateRunspace()
    $rs.Open()
    $rs.SessionStateProxy.SetVariable('SabinaWorker', $true)
    $rs.SessionStateProxy.SetVariable('ChatRoot', $Root)
    $rs.SessionStateProxy.SetVariable('ChatReq', $req)
    $rs.SessionStateProxy.SetVariable('ChatRes', $res)
    $rs.SessionStateProxy.SetVariable('ChatGate', [string]$script:ChatToken)
    $rs.SessionStateProxy.SetVariable('ChatCatalogKzt', [string]$pack.kzt)
    $rs.SessionStateProxy.SetVariable('ChatCatalogRub', [string]$pack.rub)
    $rs.SessionStateProxy.SetVariable('ChatCatalogUsd', [string]$pack.usd)
    $ps = [powershell]::Create()
    $ps.Runspace = $rs
    [void]$ps.AddScript({
      $ErrorActionPreference = 'Stop'
      $SabinaWorker = $true
      try {
        Set-Location -LiteralPath $ChatRoot
        . (Join-Path $ChatRoot 'server.ps1')
        Handle-Chat $ChatReq $ChatRes
      } catch {
        Write-Host ("Chat worker failed: {0}" -f $_.Exception.Message) -ForegroundColor Red
        try { Send-Json $ChatRes @{ error = 'internal' } 500 $false } catch {}
      }
    })
    $handle = $ps.BeginInvoke()
    $script:ChatJobs.Add(@{ Ps = $ps; Runspace = $rs; Handle = $handle })
    $rs = $null
    $ps = $null
  } finally {
    if ($ps) { try { $ps.Dispose() } catch {} }
    if ($rs) { try { $rs.Dispose() } catch {} }
    Exit-ChatLock
  }
}

# Чат: разбор сообщений, картинки и вызов OpenAI.
. (Join-Path $Root 'ai\chat.ps1')

. (Join-Path $Root 'crm-db.ps1')

if (-not $SabinaWorker) {
  try {
    Get-CrmDb | Out-Null
    Write-Host 'CRM:    SQLite crm.sqlite' -ForegroundColor Green
  } catch {
    try { $listener.Stop() } catch {}
    Write-Host ("CRM database failed: {0}" -f $_.Exception.Message) -ForegroundColor Red
    exit 1
  }
}

function Handle-SiteRequest($ctx) {
  $req = $ctx.Request
  $res = $ctx.Response
  try {
    $path = [System.Uri]::UnescapeDataString($req.Url.AbsolutePath.TrimStart('/'))
    if ($path -eq '') { $path = 'index.html' }

    if ($path -eq 'api/chat') {
      Start-ChatAsync $req $res
      return
    }

    if ($path -eq 'api/admin/login') {
      Handle-AdminLogin $req $res
      return
    }

    if ($path -eq 'api/catalog') {
      Handle-Catalog $req $res
      return
    }

    if ($path -eq 'api/company') {
      Handle-Company $req $res
      return
    }

    if ($path -eq 'api/orders' -or $path -match '^api/orders/([^/]+)$') {
      $oid = $null
      if ($path -match '^api/orders/([^/]+)$') { $oid = $Matches[1] }
      Handle-Orders $req $res $oid
      return
    }

    if ($path -eq 'api/clients' -or $path -match '^api/clients/([^/]+)$') {
      $cid = $null
      if ($path -match '^api/clients/([^/]+)$') { $cid = $Matches[1] }
      Handle-Clients $req $res $cid
      return
    }

    if ($path -match '(^|/)\.env$' -or $path -match '\.ps1$' -or $path -match '(^|/)Dockerfile$' -or $path -match '(^|/)docker-compose\.yml$' -or $path -match '(^|/)\.dockerignore$' -or $path -match '(^|/)system-prompt\.txt$' -or $path -match '(^|/)orders\.json$' -or $path -match '(^|/)clients\.json$' -or $path -match '(^|/)catalog\.json$' -or $path -match '(^|/)admin\.password$' -or $path -match '(^|/)orders\.deleted\.json$' -or $path -match '(^|/)clients\.deleted\.json$' -or $path -match '\.bak$' -or $path -match '(^|/)crm\.sqlite' -or $path -match '\.pre-sqlite$') {
      Send-Json $res @{ error = 'forbidden' } 403
      return
    }

    $file = Join-Path $Root ($path -replace '/', [IO.Path]::DirectorySeparatorChar)
    $full = [System.IO.Path]::GetFullPath($file)
    $rootFull = [System.IO.Path]::GetFullPath($Root).TrimEnd('\', '/')
    if (-not ($full.Equals($rootFull, [System.StringComparison]::OrdinalIgnoreCase) -or
              $full.StartsWith($rootFull + [IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase))) {
      Send-Json $res @{ error = 'forbidden' } 403
      return
    }
    if (-not (Test-Path -LiteralPath $full -PathType Leaf)) {
      $bytes = [System.Text.Encoding]::UTF8.GetBytes('Not found')
      Send-Bytes $res $bytes 'text/plain; charset=utf-8' 404
      return
    }

    $info = Get-Item -LiteralPath $full
    $ext = [System.IO.Path]::GetExtension($full)
    $etag = '"' + $info.Length + '-' + $info.LastWriteTimeUtc.Ticks + '"'
    $cache = 'no-store'
    if ($ext -match '^\.(png|jpe?g|webp|gif|svg|ico|css|js|woff2?)$') { $cache = 'no-cache' }
    $res.Headers['ETag'] = $etag
    $res.Headers['Cache-Control'] = $cache
    $res.Headers['Access-Control-Allow-Origin'] = '*'
    if ($path -eq 'index.html' -and $script:ChatToken) {
      try {
        $res.AppendHeader('Set-Cookie', ('sabina_chat=' + $script:ChatToken + '; Path=/; HttpOnly; SameSite=Strict; Max-Age=604800'))
      } catch {}
    }
    $inm = [string]$req.Headers['If-None-Match']
    if ($inm -and $inm -eq $etag) {
      $res.StatusCode = 304
      $res.ContentLength64 = 0
      $res.OutputStream.Close()
      return
    }

    $bytes = [System.IO.File]::ReadAllBytes($full)
    Send-Bytes $res $bytes (Get-Mime $ext) 200 $cache
  } catch {
    Write-Host ("Request failed: {0}" -f $_.Exception.Message) -ForegroundColor Red
    try { Send-Json $res @{ error = 'internal' } 500 } catch {}
  }
}

function Start-SiteWorkers {
  $script:HttpQueue = New-Object 'System.Collections.Concurrent.BlockingCollection[object]' 64
  $script:SiteWorkers = @()
  $workerCount = 4
  for ($i = 0; $i -lt $workerCount; $i++) {
    $rs = [runspacefactory]::CreateRunspace()
    $rs.Open()
    $rs.SessionStateProxy.SetVariable('WorkerRoot', $Root)
    $rs.SessionStateProxy.SetVariable('WorkerQueue', $script:HttpQueue)
    $rs.SessionStateProxy.SetVariable('WorkerTokens', $script:AdminTokens)
    $rs.SessionStateProxy.SetVariable('WorkerChats', $script:ChatJobs)
    $rs.SessionStateProxy.SetVariable('WorkerChatLock', $script:ChatLock)
    $rs.SessionStateProxy.SetVariable('WorkerHits', $script:PublicHits)
    $rs.SessionStateProxy.SetVariable('WorkerHitLock', $script:PublicHitLock)
    $rs.SessionStateProxy.SetVariable('WorkerChatToken', [string]$script:ChatToken)
    $ps = [powershell]::Create()
    $ps.Runspace = $rs
    [void]$ps.AddScript({
      $ErrorActionPreference = 'Stop'
      $SabinaWorker = $true
      try {
        Set-Location -LiteralPath $WorkerRoot
        . (Join-Path $WorkerRoot 'server.ps1')
        $script:AdminTokens = $WorkerTokens
        $script:ChatJobs = $WorkerChats
        $script:ChatLock = $WorkerChatLock
        $script:PublicHits = $WorkerHits
        $script:PublicHitLock = $WorkerHitLock
        if ($WorkerChatToken) { $script:ChatToken = [string]$WorkerChatToken }
        Get-CrmDb | Out-Null
      } catch {
        Write-Host ("Worker failed: {0}" -f $_.Exception.Message) -ForegroundColor Red
        return
      }
      foreach ($ctx in $WorkerQueue.GetConsumingEnumerable()) {
        try {
          Handle-SiteRequest $ctx
        } catch {
          Write-Host ("Worker Failure: {0}" -f $_.Exception.Message) -ForegroundColor Red
          try { Send-Json $ctx.Response @{ error = 'internal' } 500 } catch {}
        }
      }
    })
    $handle = $ps.BeginInvoke()
    $script:SiteWorkers += @{ Ps = $ps; Runspace = $rs; Handle = $handle }
  }
}

if (-not $SabinaWorker) {
  Start-SiteWorkers
  Write-Host 'Workers: 4, queue 64' -ForegroundColor Green
  while ($listener.IsListening) {
    $ctx = $listener.GetContext()
    $queued = $false
    try { $queued = $script:HttpQueue.TryAdd($ctx, 200) } catch { $queued = $false }
    if (-not $queued) {
      try { Send-Json $ctx.Response @{ error = 'busy' } 503 } catch {}
    }
  }
}
