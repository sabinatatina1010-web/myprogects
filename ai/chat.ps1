# AI chat proxy. Dot-sourced from server.ps1.
# Uses $SystemPrompt, $Model, $ApiKey, Send-Json and ConvertTo-JsonSafe from that scope.

function Convert-ChatContent($raw) {
  if ($null -eq $raw) { return $null }
  if ($raw -is [string]) {
    $t = [string]$raw
    if (-not $t.Trim()) { return $null }
    return $t
  }

  $parts = New-Object System.Collections.ArrayList
  $items = @($raw)
  foreach ($p in $items) {
    $type = [string]$p.type
    if ($type -eq 'text') {
      $text = [string]$p.text
      if ($text) { [void]$parts.Add(@{ type = 'text'; text = $text }) }
      continue
    }
    if ($type -eq 'image_url') {
      $url = $null
      if ($p.image_url) { $url = [string]$p.image_url.url }
      if (-not $url) { $url = [string]$p.url }
      if ($url -and $url.StartsWith('data:image/')) {
        $img = @{ url = $url }
        $detail = $null
        if ($p.image_url -and $p.image_url.detail) { $detail = [string]$p.image_url.detail }
        if ($detail) { $img['detail'] = $detail } else { $img['detail'] = 'high' }
        [void]$parts.Add(@{ type = 'image_url'; image_url = $img })
      }
      continue
    }
    if ($type -eq 'file') {
      $fname = $null
      $fdata = $null
      if ($p.file) {
        $fname = [string]$p.file.filename
        $fdata = [string]$p.file.file_data
      }
      if (-not $fname) { $fname = [string]$p.filename }
      if (-not $fdata) { $fdata = [string]$p.file_data }
      if ($fname -and $fdata -and $fdata.StartsWith('data:image/')) {
        [void]$parts.Add(@{ type = 'image_url'; image_url = @{ url = $fdata; detail = 'high' } })
      } elseif ($fname -and $fdata -and $fdata.StartsWith('data:')) {
        [void]$parts.Add(@{ type = 'file'; file = @{ filename = $fname; file_data = $fdata } })
      }
      continue
    }
  }

  if ($parts.Count -eq 0) { return $null }
  if ($parts.Count -eq 1 -and $parts[0].type -eq 'text') { return [string]$parts[0].text }
  return ,(@($parts))
}

function Format-ChatCatalog($products, [string]$currency) {
  if ($currency -ne 'rub' -and $currency -ne 'usd') { $currency = 'kzt' }
  $rates = Get-ShopRates
  if (($currency -eq 'rub' -or $currency -eq 'usd') -and (-not $rates.Contains($currency) -or [double]$rates[$currency] -le 0)) {
    return $script:ChatCatalogUnavailable
  }
  $dot = [string][char]0x00B7
  $dash = [string][char]0x2014
  $was = [System.Text.Encoding]::UTF8.GetString([byte[]](0xD0,0xB1,0xD1,0x8B,0xD0,0xBB,0xD0,0xBE))
  $head = [System.Text.Encoding]::UTF8.GetString([byte[]](0xD0,0x90,0xD0,0xBA,0xD1,0x82,0xD1,0x83,0xD0,0xB0,0xD0,0xBB,0xD1,0x8C,0xD0,0xBD,0xD1,0x8B,0xD0,0xB9,0x20,0xD0,0xBA,0xD0,0xB0,0xD1,0x82,0xD0,0xB0,0xD0,0xBB,0xD0,0xBE,0xD0,0xB3,0x20,0xD1,0x81,0xD0,0xB0,0xD0,0xB9,0xD1,0x82,0xD0,0xB0,0x3A))
  $lines = New-Object System.Collections.Generic.List[string]
  $n = 0
  foreach ($p in @($products)) {
    if ($null -eq $p) { continue }
    $active = Get-Prop $p 'active'
    if (($active -is [bool] -and -not $active) -or [string]$active -eq 'false') { continue }
    $name = ((Clip-Text (Get-Prop $p 'name') 160) -replace '[\r\n]+', ' ').Replace('[[HAND_OFF]]', '').Trim()
    if (-not $name) { continue }
    $line = $name
    $size = ((Clip-Text (Get-Prop $p 'size') 80) -replace '[\r\n]+', ' ').Trim()
    if ($size) { $line += ' (' + $size + ')' }
    $tag = ((Clip-Text (Get-Prop $p 'tag') 40) -replace '[\r\n]+', ' ').Trim()
    if ($tag) { $line += ' ' + $dot + ' ' + $tag }
    $price = 0.0
    try { $price = [double](Get-Prop $p 'price') } catch { $price = 0 }
    $cur = [string](Get-Prop $p 'currency')
    if ($cur -ne 'rub' -and $cur -ne 'usd') { $cur = 'kzt' }
    if (($cur -eq 'rub' -or $cur -eq 'usd') -and (-not $rates.Contains($cur) -or [double]$rates[$cur] -le 0)) {
      return $script:ChatCatalogUnavailable
    }
    $shown = ConvertFrom-KztAmount (ConvertTo-KztAmount $price $cur $rates) $currency $rates
    $rounded = if ($currency -eq 'usd') {
      [math]::Round($shown, 2, [MidpointRounding]::AwayFromZero)
    } else {
      [math]::Round($shown, 0, [MidpointRounding]::AwayFromZero)
    }
    $line += ' ' + $dash + ' ' + (Format-ShopAmount ([double]$rounded) $currency)
    $old = 0.0
    try { $old = [double](Get-Prop $p 'old') } catch { $old = 0 }
    if ($old -gt $price) {
      $oldShown = ConvertFrom-KztAmount (ConvertTo-KztAmount $old $cur $rates) $currency $rates
      $oldRounded = if ($currency -eq 'usd') {
        [math]::Round($oldShown, 2, [MidpointRounding]::AwayFromZero)
      } else {
        [math]::Round($oldShown, 0, [MidpointRounding]::AwayFromZero)
      }
      $line += ' (' + $was + ' ' + (Format-ShopAmount ([double]$oldRounded) $currency) + ')'
    }
    $desc = ((Clip-Text (Get-Prop $p 'desc') 400) -replace '[\r\n]+', ' ').Replace('[[HAND_OFF]]', '').Trim()
    if ($desc) { $line += '. ' + $desc }
    $n++
    [void]$lines.Add(('{0}. {1}' -f $n, $line))
  }
  if ($lines.Count -eq 0) { return '' }
  $text = $head + "`n" + ($lines -join "`n")
  if ($text.Length -gt 12000) { $text = $text.Substring(0, 12000) }
  return $text
}

$script:ChatCatalogUnavailable = -join @(
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

function Build-ChatCatalogPack {
  $products = @()
  $unavailable = $false
  try {
    $db = Get-CrmDb
    $live = Get-LiveCatalog $db
    if ($live.Persisted) { $products = @($live.Products) }
    else { $unavailable = $true }
  } catch {
    Write-Host ("Chat catalog failed: {0}" -f $_.Exception.Message) -ForegroundColor Red
    $products = @()
    $unavailable = $true
  }
  if ($unavailable) {
    $note = $script:ChatCatalogUnavailable
    return @{ kzt = $note; rub = $note; usd = $note }
  }
  return @{
    kzt = (Format-ChatCatalog $products 'kzt')
    rub = (Format-ChatCatalog $products 'rub')
    usd = (Format-ChatCatalog $products 'usd')
  }
}

function Reply-Chat($res, $obj, $status = 200) {
  Send-Json $res $obj $status $false
}

function Get-HttpErrorBody($ex) {
  try {
    $resp = $ex.Response
    if (-not $resp) { return $null }
    $sr = New-Object System.IO.StreamReader($resp.GetResponseStream(), [System.Text.Encoding]::UTF8)
    $t = $sr.ReadToEnd()
    $sr.Close()
    return $t
  } catch { return $null }
}

function Handle-Chat($req, $res) {
  if ($req.HttpMethod -eq 'OPTIONS') {
    $res.StatusCode = 204
    $res.ContentLength64 = 0
    $res.Close()
    return
  }

  if ($req.HttpMethod -ne 'POST') {
    Reply-Chat $res @{ error = 'POST only' } 405
    return
  }
  if (-not (Test-ChatCookie $req)) {
    Reply-Chat $res @{ error = 'unauthorized' } 401
    return
  }

  $maxBytes = 8 * 1024 * 1024
  if ($script:ChatMaxBytes) { $maxBytes = [int]$script:ChatMaxBytes }
  $body = Read-LimitedBody $req $maxBytes
  if ($null -eq $body) {
    Reply-Chat $res @{ error = 'too large' } 413
    return
  }

  try { $payload = $body | ConvertFrom-Json } catch {
    Reply-Chat $res @{ error = 'bad json' } 400
    return
  }

  $msgList = New-Object System.Collections.ArrayList
  $sys = $SystemPrompt
  $currency = [string]$payload.currency
  if ($currency -ne 'rub' -and $currency -ne 'usd') { $currency = 'kzt' }
  $catalog = ''
  if ($currency -eq 'rub') { $catalog = [string]$global:ChatCatalogRub }
  elseif ($currency -eq 'usd') { $catalog = [string]$global:ChatCatalogUsd }
  else { $catalog = [string]$global:ChatCatalogKzt }
  if (-not $catalog) { $catalog = $script:ChatCatalogUnavailable }
  if ($catalog) { $sys = $SystemPrompt + "`n`n" + $catalog.Trim() }
  [void]$msgList.Add(@{ role = 'system'; content = $sys })

  $hasMedia = $false
  if ($payload.messages) {
    foreach ($m in @($payload.messages)) {
      $role = [string]$m.role
      if ($role -ne 'user' -and $role -ne 'assistant') { continue }
      $content = Convert-ChatContent $m.content
      if ($null -eq $content) { continue }
      if ($content -isnot [string]) { $hasMedia = $true }
      [void]$msgList.Add(@{ role = $role; content = $content })
    }
  } elseif ($payload.message) {
    [void]$msgList.Add(@{ role = 'user'; content = [string]$payload.message })
  } else {
    Reply-Chat $res @{ error = 'empty message' } 400
    return
  }

  if ($msgList.Count -lt 2) {
    Reply-Chat $res @{ error = 'empty message' } 400
    return
  }

  while ($msgList.Count -gt 21) { $msgList.RemoveAt(1) }

  function Strip-FileParts($messages) {
    $out = New-Object System.Collections.ArrayList
    foreach ($m in $messages) {
      $role = [string]$m.role
      $c = $m.content
      if ($c -is [string] -or $role -eq 'system') {
        [void]$out.Add($m)
        continue
      }
      $parts = New-Object System.Collections.ArrayList
      $fileNames = New-Object System.Collections.ArrayList
      foreach ($p in @($c)) {
        if ([string]$p.type -eq 'file') {
          $fn = ''
          if ($p.file) { $fn = [string]$p.file.filename }
          if ($fn) { [void]$fileNames.Add($fn) }
          continue
        }
        [void]$parts.Add($p)
      }
      if ($fileNames.Count -gt 0) {
        $note = 'Attached file(s) could not be passed to the model directly: ' + ($fileNames -join ', ') + '. Ask for a photo of the pages or plain text.'
        $hasText = $false
        foreach ($p in @($parts)) {
          if ([string]$p.type -eq 'text') {
            $p.text = [string]$p.text + "`n`n" + $note
            $hasText = $true
            break
          }
        }
        if (-not $hasText) { [void]$parts.Insert(0, @{ type = 'text'; text = $note }) }
      }
      if ($parts.Count -eq 0) { continue }
      if ($parts.Count -eq 1 -and $parts[0].type -eq 'text') {
        [void]$out.Add(@{ role = $role; content = [string]$parts[0].text })
      } else {
        [void]$out.Add(@{ role = $role; content = $parts })
      }
    }
    return $out
  }

  function Invoke-OpenAI($messages, $maxTokens, $effort) {
    $openaiBodyObj = @{
      model = $Model
      max_completion_tokens = $maxTokens
      reasoning_effort = $effort
      messages = $messages
    }
    $openaiBody = ConvertTo-JsonSafe $openaiBodyObj
    $openaiBytes = [System.Text.Encoding]::UTF8.GetBytes($openaiBody)

    $web = [System.Net.HttpWebRequest]::Create('https://api.openai.com/v1/chat/completions')
    $web.Method = 'POST'
    $web.ContentType = 'application/json'
    $web.Headers['Authorization'] = "Bearer $ApiKey"
    $web.Timeout = 120000
    $web.ReadWriteTimeout = 120000
    $web.ContentLength = $openaiBytes.Length
    $stream = $web.GetRequestStream()
    $stream.Write($openaiBytes, 0, $openaiBytes.Length)
    $stream.Close()

    $resp = $web.GetResponse()
    $sr = New-Object System.IO.StreamReader($resp.GetResponseStream(), [System.Text.Encoding]::UTF8)
    $raw = $sr.ReadToEnd()
    $sr.Close()
    $resp.Close()
    return ($raw | ConvertFrom-Json)
  }

  $effort = if ($hasMedia) { 'none' } else { 'low' }
  $tokens = if ($hasMedia) { 2500 } else { 800 }

  try {
    $ai = Invoke-OpenAI $msgList $tokens $effort
    $reply = $ai.choices[0].message.content
    if (-not $reply) { throw 'empty reply' }
    Reply-Chat $res @{ reply = $reply }
  } catch {
    $err = $_.Exception.Message
    if ($_.Exception.InnerException) { $err = $_.Exception.InnerException.Message }
    $detail = Get-HttpErrorBody $_.Exception
    if ($detail) {
      try {
        $ej = $detail | ConvertFrom-Json
        if ($ej.error.message) { $err = [string]$ej.error.message }
        else { $err = $detail }
      } catch { $err = $detail }
    }

    # retry without binary file parts only (keep images)
    $retryable = $hasMedia -and ($err -match '(?i)unsupported.*file|invalid.*file|unknown parameter.*file|file_data')
    if ($retryable) {
      try {
        $stripped = Strip-FileParts $msgList
        $ai2 = Invoke-OpenAI $stripped 2000 'none'
        $reply2 = $ai2.choices[0].message.content
        if ($reply2) {
          Reply-Chat $res @{ reply = $reply2 }
          return
        }
      } catch {
        $err2 = $_.Exception.Message
        $d2 = Get-HttpErrorBody $_.Exception
        if ($d2) {
          try {
            $ej2 = $d2 | ConvertFrom-Json
            if ($ej2.error.message) { $err = [string]$ej2.error.message }
          } catch {}
        } else { $err = $err2 }
      }
    }

    Write-Host ("OpenAI failed: {0}" -f $err) -ForegroundColor Red
    Reply-Chat $res @{ error = 'chat unavailable' } 502
  }
}
