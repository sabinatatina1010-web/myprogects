# SQLite storage for orders, clients, and catalog.
# Windows uses winsqlite3.dll. Linux containers use libsqlite3.so.0.

$script:SabinaSqliteSource = @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

public sealed class SabinaSqlite {
    const int Ok = 0;
    const int Row = 100;
    const int Done = 101;
    const int OpenReadWrite = 2;
    const int OpenCreate = 4;
    const int OpenFullMutex = 0x00010000;
    const int TypeInteger = 1;
    const int TypeFloat = 2;
    const int TypeText = 3;
    const int TypeNull = 5;
    static readonly IntPtr Transient = new IntPtr(-1);

    IntPtr db;

    [DllImport("winsqlite3", CallingConvention = CallingConvention.Cdecl)]
    static extern int sqlite3_open_v2(byte[] filename, out IntPtr db, int flags, IntPtr vfs);

    [DllImport("winsqlite3", CallingConvention = CallingConvention.Cdecl)]
    static extern int sqlite3_close(IntPtr db);

    [DllImport("winsqlite3", CallingConvention = CallingConvention.Cdecl)]
    static extern int sqlite3_exec(IntPtr db, byte[] sql, IntPtr cb, IntPtr arg, out IntPtr err);

    [DllImport("winsqlite3", CallingConvention = CallingConvention.Cdecl)]
    static extern int sqlite3_prepare_v2(IntPtr db, byte[] sql, int nByte, out IntPtr stmt, IntPtr tail);

    [DllImport("winsqlite3", CallingConvention = CallingConvention.Cdecl)]
    static extern int sqlite3_bind_text(IntPtr stmt, int index, byte[] val, int n, IntPtr dtor);

    [DllImport("winsqlite3", CallingConvention = CallingConvention.Cdecl)]
    static extern int sqlite3_bind_int64(IntPtr stmt, int index, long val);

    [DllImport("winsqlite3", CallingConvention = CallingConvention.Cdecl)]
    static extern int sqlite3_bind_null(IntPtr stmt, int index);

    [DllImport("winsqlite3", CallingConvention = CallingConvention.Cdecl)]
    static extern int sqlite3_step(IntPtr stmt);

    [DllImport("winsqlite3", CallingConvention = CallingConvention.Cdecl)]
    static extern int sqlite3_finalize(IntPtr stmt);

    [DllImport("winsqlite3", CallingConvention = CallingConvention.Cdecl)]
    static extern IntPtr sqlite3_column_text(IntPtr stmt, int col);

    [DllImport("winsqlite3", CallingConvention = CallingConvention.Cdecl)]
    static extern long sqlite3_column_int64(IntPtr stmt, int col);

    [DllImport("winsqlite3", CallingConvention = CallingConvention.Cdecl)]
    static extern double sqlite3_column_double(IntPtr stmt, int col);

    [DllImport("winsqlite3", CallingConvention = CallingConvention.Cdecl)]
    static extern int sqlite3_column_type(IntPtr stmt, int col);

    [DllImport("winsqlite3", CallingConvention = CallingConvention.Cdecl)]
    static extern int sqlite3_column_count(IntPtr stmt);

    [DllImport("winsqlite3", CallingConvention = CallingConvention.Cdecl)]
    static extern IntPtr sqlite3_column_name(IntPtr stmt, int col);

    [DllImport("winsqlite3", CallingConvention = CallingConvention.Cdecl)]
    static extern IntPtr sqlite3_errmsg(IntPtr db);

    [DllImport("winsqlite3", CallingConvention = CallingConvention.Cdecl)]
    static extern void sqlite3_free(IntPtr p);

    [DllImport("winsqlite3", CallingConvention = CallingConvention.Cdecl)]
    static extern int sqlite3_changes(IntPtr db);

    static byte[] Utf8(string s) {
        return Encoding.UTF8.GetBytes(s ?? "");
    }

    static byte[] Utf8Z(string s) {
        byte[] raw = Utf8(s);
        byte[] z = new byte[raw.Length + 1];
        Buffer.BlockCopy(raw, 0, z, 0, raw.Length);
        return z;
    }

    static string FromUtf8(IntPtr p) {
        if (p == IntPtr.Zero) return null;
        int len = 0;
        while (Marshal.ReadByte(p, len) != 0) len++;
        if (len == 0) return "";
        byte[] buf = new byte[len];
        Marshal.Copy(p, buf, 0, len);
        return Encoding.UTF8.GetString(buf);
    }

    string ErrorText() {
        return FromUtf8(sqlite3_errmsg(db)) ?? "sqlite error";
    }

    void Check(int rc) {
        if (rc != Ok) throw new InvalidOperationException(ErrorText());
    }

    public void Open(string path) {
        IntPtr handle;
        int rc = sqlite3_open_v2(Utf8Z(path), out handle, OpenReadWrite | OpenCreate | OpenFullMutex, IntPtr.Zero);
        db = handle;
        if (rc != Ok) {
            string msg = ErrorText();
            if (db != IntPtr.Zero) sqlite3_close(db);
            db = IntPtr.Zero;
            throw new InvalidOperationException(msg);
        }
    }

    public void Exec(string sql) {
        IntPtr err;
        int rc = sqlite3_exec(db, Utf8Z(sql), IntPtr.Zero, IntPtr.Zero, out err);
        if (rc != Ok) {
            string msg = FromUtf8(err);
            if (err != IntPtr.Zero) sqlite3_free(err);
            if (string.IsNullOrEmpty(msg)) msg = ErrorText();
            throw new InvalidOperationException(msg);
        }
    }

    IntPtr Prepare(string sql) {
        IntPtr stmt;
        byte[] bytes = Utf8(sql);
        int rc = sqlite3_prepare_v2(db, bytes, bytes.Length, out stmt, IntPtr.Zero);
        if (rc != Ok) throw new InvalidOperationException(ErrorText());
        return stmt;
    }

    void Bind(IntPtr stmt, int index, object value) {
        if (value == null || value is DBNull) {
            Check(sqlite3_bind_null(stmt, index));
            return;
        }
        if (value is bool) {
            Check(sqlite3_bind_int64(stmt, index, ((bool)value) ? 1L : 0L));
            return;
        }
        if (value is byte || value is short || value is int || value is long) {
            Check(sqlite3_bind_int64(stmt, index, Convert.ToInt64(value)));
            return;
        }
        byte[] bytes = Utf8(Convert.ToString(value));
        Check(sqlite3_bind_text(stmt, index, bytes, bytes.Length, Transient));
    }

    public int Run(string sql, object[] args) {
        if (args == null) args = new object[0];
        IntPtr stmt = Prepare(sql);
        try {
            for (int i = 0; i < args.Length; i++) Bind(stmt, i + 1, args[i]);
            int rc = sqlite3_step(stmt);
            if (rc != Done && rc != Row) throw new InvalidOperationException(ErrorText());
            return sqlite3_changes(db);
        } finally {
            sqlite3_finalize(stmt);
        }
    }

    public List<Dictionary<string, object>> Query(string sql, object[] args) {
        if (args == null) args = new object[0];
        List<Dictionary<string, object>> list = new List<Dictionary<string, object>>();
        IntPtr stmt = Prepare(sql);
        try {
            for (int i = 0; i < args.Length; i++) Bind(stmt, i + 1, args[i]);
            while (true) {
                int rc = sqlite3_step(stmt);
                if (rc == Done) break;
                if (rc != Row) throw new InvalidOperationException(ErrorText());
                int n = sqlite3_column_count(stmt);
                Dictionary<string, object> row = new Dictionary<string, object>(StringComparer.OrdinalIgnoreCase);
                for (int c = 0; c < n; c++) {
                    string name = FromUtf8(sqlite3_column_name(stmt, c));
                    int t = sqlite3_column_type(stmt, c);
                    object val = null;
                    if (t == TypeInteger) val = sqlite3_column_int64(stmt, c);
                    else if (t == TypeFloat) val = sqlite3_column_double(stmt, c);
                    else if (t == TypeText) val = FromUtf8(sqlite3_column_text(stmt, c));
                    else if (t == TypeNull) val = null;
                    else val = FromUtf8(sqlite3_column_text(stmt, c));
                    row[name] = val;
                }
                list.Add(row);
            }
            return list;
        } finally {
            sqlite3_finalize(stmt);
        }
    }
}
'@

function Initialize-SabinaSqliteType {
  if ('SabinaSqlite' -as [type]) { return }
  $lib = 'winsqlite3'
  if ($PSVersionTable.Platform -eq 'Unix') { $lib = 'libsqlite3.so.0' }
  $src = $script:SabinaSqliteSource.Replace('winsqlite3', $lib)
  try {
    Add-Type -TypeDefinition $src -Language CSharp -ErrorAction Stop
  } catch {
    if (-not ('SabinaSqlite' -as [type])) { throw }
  }
}

function ConvertTo-DbText($v) {
  if ($null -eq $v) { return $null }
  $s = [string]$v
  if ($s -eq '') { return $null }
  return $s
}

function ConvertTo-DbTextKeep($v) {
  if ($null -eq $v) { return '' }
  return [string]$v
}

function ConvertTo-DbLongOrNull($v) {
  if ($null -eq $v -or [string]$v -eq '') { return $null }
  try { return [int64]$v } catch { return $null }
}

function ConvertTo-DbHidden($v) {
  if ($v -is [bool]) { if ($v) { return [int64]1 } else { return [int64]0 } }
  $s = [string]$v
  if ($s -eq '1' -or $s -eq 'true') { return [int64]1 }
  return [int64]0
}

function Get-RowText($row, [string]$key) {
  if ($null -eq $row -or -not $row.ContainsKey($key)) { return $null }
  $v = $row[$key]
  if ($null -eq $v) { return $null }
  return [string]$v
}

function Open-CrmTxn {
  $db = Get-CrmDb
  $db.Exec('BEGIN IMMEDIATE')
  return $db
}

function Close-CrmTxn($db, [bool]$ok) {
  if ($null -eq $db) { return }
  try {
    if ($ok) { $db.Exec('COMMIT') }
    else { $db.Exec('ROLLBACK') }
  } catch {
    try { $db.Exec('ROLLBACK') } catch {}
    if ($ok) { throw }
  }
}

function Get-NextSort($db, [string]$table) {
  $sql = if ($table -eq 'clients') {
    'SELECT COALESCE(MAX(sort_key), 0) AS n FROM clients'
  } else {
    'SELECT COALESCE(MAX(sort_key), 0) AS n FROM orders'
  }
  $rows = $db.Query($sql, $null)
  $n = [int64]0
  if ($rows.Count -gt 0 -and $null -ne $rows[0]['n']) { $n = [int64]$rows[0]['n'] }
  return ($n + 1)
}

function Add-OrderRow($db, $order, [int64]$sort) {
  $items = ConvertTo-OrderItemsJson (Get-Prop $order 'items')
  $vals = New-Object object[] 13
  $vals[0] = [string](Get-Prop $order 'id')
  $vals[1] = ConvertTo-DbText (Get-Prop $order 'createdAt')
  $vals[2] = ConvertTo-DbText (Get-Prop $order 'clientName')
  $vals[3] = ConvertTo-DbText (Get-Prop $order 'clientPhone')
  $vals[4] = ConvertTo-DbLongOrNull (Get-Prop $order 'totalKzt')
  $vals[5] = ConvertTo-DbText (Get-Prop $order 'totalLabel')
  $vals[6] = ConvertTo-DbText (Get-Prop $order 'currency')
  $vals[7] = ConvertTo-DbText (Get-Prop $order 'messenger')
  $vals[8] = ConvertTo-DbText (Get-Prop $order 'status')
  $vals[9] = ConvertTo-DbText (Get-Prop $order 'source')
  $vals[10] = ConvertTo-DbText (Get-Prop $order 'updatedAt')
  $vals[11] = $items
  $vals[12] = $sort
  [void]$db.Run('INSERT INTO orders (id, created_at, client_name, client_phone, total_kzt, total_label, currency, messenger, status, source, updated_at, items_json, sort_key) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)', $vals)
}

function New-OrderFromRow($row) {
  $o = New-Object psobject
  Set-Note $o 'id' (Get-RowText $row 'id')
  foreach ($pair in @(
    @('created_at','createdAt'),
    @('client_name','clientName'),
    @('client_phone','clientPhone'),
    @('total_label','totalLabel'),
    @('currency','currency'),
    @('messenger','messenger'),
    @('status','status'),
    @('source','source'),
    @('updated_at','updatedAt')
  )) {
    $text = Get-RowText $row $pair[0]
    if ($text) { Set-Note $o $pair[1] $text }
  }
  if ($null -ne $row['total_kzt']) { Set-Note $o 'totalKzt' ([int64]$row['total_kzt']) }
  $items = @()
  $raw = Get-RowText $row 'items_json'
  if ($raw -and $raw.Trim() -and $raw.Trim() -ne '[]') {
    try {
      $items = @($raw | ConvertFrom-Json)
    } catch {
      Write-Host ("CRITICAL: Order items parse error (Order ID: {0}): {1}" -f (Get-RowText $row 'id'), $_.Exception.Message) -ForegroundColor Red
      throw
    }
  }
  Set-Note $o 'items' $items
  return $o
}

function New-ClientFromRow($row) {
  $o = New-Object psobject
  Set-Note $o 'id' (Get-RowText $row 'id')
  Set-Note $o 'phone' (ConvertTo-DbTextKeep (Get-RowText $row 'phone'))
  Set-Note $o 'phoneDisplay' (ConvertTo-DbTextKeep (Get-RowText $row 'phone_display'))
  Set-Note $o 'name' (ConvertTo-DbTextKeep (Get-RowText $row 'name'))
  Set-Note $o 'notes' (ConvertTo-DbTextKeep (Get-RowText $row 'notes'))
  $hidden = $false
  if ($null -ne $row['hidden'] -and [int64]$row['hidden'] -ne 0) { $hidden = $true }
  Set-Note $o 'hidden' $hidden
  foreach ($pair in @(
    @('name_at','nameAt'),
    @('notes_at','notesAt'),
    @('hidden_at','hiddenAt'),
    @('last_order_at','lastOrderAt'),
    @('created_at','createdAt'),
    @('updated_at','updatedAt')
  )) {
    $text = Get-RowText $row $pair[0]
    if ($text) { Set-Note $o $pair[1] $text }
  }
  return $o
}

function Save-ClientRow($db, $client, [int64]$sort) {
  $vals = New-Object object[] 13
  $vals[0] = ConvertTo-DbTextKeep (Get-Prop $client 'phone')
  $vals[1] = ConvertTo-DbTextKeep (Get-Prop $client 'phoneDisplay')
  $vals[2] = ConvertTo-DbTextKeep (Get-Prop $client 'name')
  $vals[3] = ConvertTo-DbText (Get-Prop $client 'nameAt')
  $vals[4] = ConvertTo-DbTextKeep (Get-Prop $client 'notes')
  $vals[5] = ConvertTo-DbText (Get-Prop $client 'notesAt')
  $vals[6] = ConvertTo-DbHidden (Get-Prop $client 'hidden')
  $vals[7] = ConvertTo-DbText (Get-Prop $client 'hiddenAt')
  $vals[8] = ConvertTo-DbText (Get-Prop $client 'lastOrderAt')
  $vals[9] = ConvertTo-DbText (Get-Prop $client 'createdAt')
  $vals[10] = ConvertTo-DbText (Get-Prop $client 'updatedAt')
  $vals[11] = $sort
  $vals[12] = [string](Get-Prop $client 'id')
  [void]$db.Run('UPDATE clients SET phone=?, phone_display=?, name=?, name_at=?, notes=?, notes_at=?, hidden=?, hidden_at=?, last_order_at=?, created_at=?, updated_at=?, sort_key=? WHERE id=?', $vals)
}

function Add-ClientRow($db, $client, [int64]$sort) {
  $vals = New-Object object[] 13
  $vals[0] = [string](Get-Prop $client 'id')
  $vals[1] = ConvertTo-DbTextKeep (Get-Prop $client 'phone')
  $vals[2] = ConvertTo-DbTextKeep (Get-Prop $client 'phoneDisplay')
  $vals[3] = ConvertTo-DbTextKeep (Get-Prop $client 'name')
  $vals[4] = ConvertTo-DbText (Get-Prop $client 'nameAt')
  $vals[5] = ConvertTo-DbTextKeep (Get-Prop $client 'notes')
  $vals[6] = ConvertTo-DbText (Get-Prop $client 'notesAt')
  $vals[7] = ConvertTo-DbHidden (Get-Prop $client 'hidden')
  $vals[8] = ConvertTo-DbText (Get-Prop $client 'hiddenAt')
  $vals[9] = ConvertTo-DbText (Get-Prop $client 'lastOrderAt')
  $vals[10] = ConvertTo-DbText (Get-Prop $client 'createdAt')
  $vals[11] = ConvertTo-DbText (Get-Prop $client 'updatedAt')
  $vals[12] = $sort
  [void]$db.Run('INSERT INTO clients (id, phone, phone_display, name, name_at, notes, notes_at, hidden, hidden_at, last_order_at, created_at, updated_at, sort_key) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)', $vals)
}

function Move-CrmJsonAside([string]$path) {
  if (-not (Test-Path -LiteralPath $path)) { return }
  $dest = $path + '.pre-sqlite'
  if (Test-Path -LiteralPath $dest) {
    $dest = $path + '.' + [DateTime]::UtcNow.ToString('yyyyMMddHHmmss') + '.pre-sqlite'
  }
  [System.IO.File]::Move($path, $dest)
}

function Import-CrmJsonOnce($db) {
  $flag = $db.Query("SELECT value FROM meta WHERE key = ?", @('json_imported'))
  if ($flag.Count -gt 0) { return }
  $db.Exec('BEGIN IMMEDIATE')
  try {
    $ordersPath = Join-Path $Root 'orders.json'
    $clientsPath = Join-Path $Root 'clients.json'
    $catalogPath = Join-Path $Root 'catalog.json'
    $ordersDeletedPath = Join-Path $Root 'orders.deleted.json'
    $clientsDeletedPath = Join-Path $Root 'clients.deleted.json'

    $ordersDoc = Read-JsonFile $ordersPath
    if (-not $ordersDoc.Ok) { throw ("orders.json unreadable: " + $ordersDoc.Error) }
    $orderCount = 0
    if (-not $ordersDoc.Missing -and $null -ne $ordersDoc.Data) {
      $flat = @(Flatten-CrmList $ordersDoc.Data)
      $n = $flat.Count
      for ($i = 0; $i -lt $n; $i++) {
        Add-OrderRow $db $flat[$i] ([int64]($n - $i))
        $orderCount++
      }
    }

    $ordersDel = Read-IdSet $ordersDeletedPath
    if (-not $ordersDel.Ok) { throw 'orders.deleted.json unreadable' }
    foreach ($id in @($ordersDel.Ids)) {
      [void]$db.Run('INSERT OR IGNORE INTO order_deleted (id) VALUES (?)', @([string]$id))
    }

    $clientsDoc = Read-JsonFile $clientsPath
    if (-not $clientsDoc.Ok) { throw ("clients.json unreadable: " + $clientsDoc.Error) }
    $clientCount = 0
    if (-not $clientsDoc.Missing -and $null -ne $clientsDoc.Data) {
      $flatC = @(Flatten-CrmList $clientsDoc.Data)
      $n = $flatC.Count
      for ($i = 0; $i -lt $n; $i++) {
        Add-ClientRow $db $flatC[$i] ([int64]($n - $i))
        $clientCount++
      }
    }

    $clientsDel = Read-IdSet $clientsDeletedPath
    if (-not $clientsDel.Ok) { throw 'clients.deleted.json unreadable' }
    foreach ($id in @($clientsDel.Ids)) {
      [void]$db.Run('INSERT OR IGNORE INTO client_deleted (id) VALUES (?)', @([string]$id))
    }

    $catalogDoc = Read-JsonFile $catalogPath
    if (-not $catalogDoc.Ok) { throw ("catalog.json unreadable: " + $catalogDoc.Error) }
    if (-not $catalogDoc.Missing -and $null -ne $catalogDoc.Data) {
      $products = @()
      if ($null -ne $catalogDoc.Data.products) { $products = @($catalogDoc.Data.products) }
      $pj = ConvertTo-JsonSafe $products
      if (-not $pj -or -not $pj.TrimStart().StartsWith('[')) { $pj = '[]' }
      $catVals = New-Object object[] 2
      $catVals[0] = [string]$catalogDoc.Data.updatedAt
      $catVals[1] = $pj
      [void]$db.Run('INSERT INTO catalog (id, updated_at, products_json) VALUES (1, ?, ?)', $catVals)
    }

    $stamp = [DateTime]::UtcNow.ToString('o')
    [void]$db.Run('INSERT INTO meta (key, value) VALUES (?, ?)', @('json_imported', $stamp))
    $db.Exec('COMMIT')
    if (-not $SabinaWorker) {
      Write-Host ("CRM import: {0} orders, {1} clients" -f $orderCount, $clientCount) -ForegroundColor Green
    }
    foreach ($p in @($ordersPath, $clientsPath, $catalogPath, $ordersDeletedPath, $clientsDeletedPath)) {
      try { Move-CrmJsonAside $p } catch {
        Write-Host ("CRM backup rename failed for {0}: {1}" -f $p, $_.Exception.Message) -ForegroundColor Yellow
      }
    }
  } catch {
    try { $db.Exec('ROLLBACK') } catch {}
    throw
  }
}

function Get-CrmDb {
  if ($script:CrmDb) { return $script:CrmDb }
  Initialize-SabinaSqliteType
  $dataDir = $Root
  if ($env:SABINA_DATA_DIR) { $dataDir = $env:SABINA_DATA_DIR }
  if (-not (Test-Path -LiteralPath $dataDir)) {
    New-Item -ItemType Directory -Force -Path $dataDir | Out-Null
  }
  $path = Join-Path $dataDir 'crm.sqlite'
  $db = New-Object SabinaSqlite
  $db.Open($path)
  $db.Exec(@"
PRAGMA journal_mode=WAL;
PRAGMA busy_timeout=5000;
PRAGMA synchronous=NORMAL;
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  created_at TEXT,
  client_name TEXT,
  client_phone TEXT,
  total_kzt INTEGER,
  total_label TEXT,
  currency TEXT,
  messenger TEXT,
  status TEXT,
  source TEXT,
  updated_at TEXT,
  items_json TEXT NOT NULL DEFAULT '[]',
  sort_key INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS order_deleted (
  id TEXT PRIMARY KEY
);
CREATE TABLE IF NOT EXISTS clients (
  id TEXT PRIMARY KEY,
  phone TEXT,
  phone_display TEXT,
  name TEXT,
  name_at TEXT,
  notes TEXT,
  notes_at TEXT,
  hidden INTEGER NOT NULL DEFAULT 0,
  hidden_at TEXT,
  last_order_at TEXT,
  created_at TEXT,
  updated_at TEXT,
  sort_key INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS ix_clients_phone ON clients(phone);
CREATE INDEX IF NOT EXISTS ix_clients_sort ON clients(sort_key);
CREATE INDEX IF NOT EXISTS ix_orders_sort ON orders(sort_key);
CREATE INDEX IF NOT EXISTS ix_orders_phone ON orders(client_phone);
CREATE INDEX IF NOT EXISTS ix_orders_status ON orders(status);
CREATE TABLE IF NOT EXISTS client_deleted (
  id TEXT PRIMARY KEY
);
CREATE TABLE IF NOT EXISTS catalog (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  updated_at TEXT NOT NULL DEFAULT '',
  products_json TEXT NOT NULL DEFAULT '[]'
);
CREATE TABLE IF NOT EXISTS company (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  name TEXT NOT NULL DEFAULT '',
  bin_iin TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  bank_name TEXT NOT NULL DEFAULT '',
  iban TEXT NOT NULL DEFAULT '',
  bik TEXT NOT NULL DEFAULT ''
);
"@)
  try { $db.Exec('ALTER TABLE orders ADD COLUMN stock_held INTEGER NOT NULL DEFAULT 0') } catch {}
  $script:CrmDb = $db
  Import-CrmJsonOnce $db
  return $script:CrmDb
}

function Send-OrdersState($res, $items, $deleted, $status = 200) {
  $ordersJson = ConvertTo-OrdersFileJson @($items)
  Send-RawJson $res (ConvertTo-WrappedListJson 'orders' $ordersJson $deleted) $status
}

function Send-ClientsState($res, $items, $deleted, $status = 200) {
  $body = ConvertTo-JsonSafe @($items)
  Send-RawJson $res (ConvertTo-WrappedListJson 'clients' $body $deleted) $status
}

function ConvertTo-CatalogJson([string]$updatedAt, $products) {
  $itemsJson = ConvertTo-JsonSafe @($products)
  if (-not $itemsJson -or -not $itemsJson.TrimStart().StartsWith('[')) { $itemsJson = '[]' }
  return ('{"updatedAt":"' + (Escape-JsonString $updatedAt) + '","products":' + $itemsJson + '}')
}

function ConvertFrom-ProductsJson([string]$json) {
  if (-not $json) { return @() }
  $trim = $json.Trim()
  if (-not $trim -or $trim -eq '[]' -or $trim -eq 'null') { return @() }
  $parsed = $trim | ConvertFrom-Json
  if ($null -eq $parsed) { return @() }
  return @($parsed)
}

function Get-DeletedIds($db, [string]$table) {
  $sql = if ($table -eq 'clients') { 'SELECT id FROM client_deleted' } else { 'SELECT id FROM order_deleted' }
  $rows = $db.Query($sql, $null)
  $ids = New-Object System.Collections.Generic.List[string]
  foreach ($row in @($rows)) {
    $id = Get-RowText $row 'id'
    if ($id) { [void]$ids.Add($id) }
  }
  return $ids
}

function Get-CrmPage($db, [string]$table, [string]$deletedTable, $req) {
  $page = Get-PageWindow $req
  $flag = [int64]0
  $beforeSort = [int64]0
  $beforeRow = [int64]0
  $rawSort = [string]$req.QueryString['beforeSort']
  $rawRow = [string]$req.QueryString['beforeRow']
  if ($rawSort -match '^-?\d+$' -and $rawRow -match '^\d+$') {
    $flag = [int64]1
    $beforeSort = [int64]$rawSort
    $beforeRow = [int64]$rawRow
  }
  $countRows = $db.Query(("SELECT COUNT(*) AS n FROM {0} WHERE id NOT IN (SELECT id FROM {1})" -f $table, $deletedTable), $null)
  $total = [int64]0
  if ($countRows.Count -gt 0 -and $null -ne $countRows[0]['n']) { $total = [int64]$countRows[0]['n'] }
  $sql = @"
SELECT rowid AS row_id, t.* FROM $table AS t
WHERE id NOT IN (SELECT id FROM $deletedTable)
AND (? = 0 OR sort_key < ? OR (sort_key = ? AND rowid < ?))
ORDER BY sort_key DESC, rowid DESC
LIMIT ?
"@
  $rows = $db.Query($sql, @($flag, $beforeSort, $beforeSort, $beforeRow, [int]$page.Limit))
  $nextSort = $null
  $nextRow = $null
  if ($rows.Count -ge [int]$page.Limit -and $rows.Count -gt 0) {
    $last = $rows[$rows.Count - 1]
    if ($null -ne $last['sort_key'] -and $null -ne $last['row_id']) {
      $nextSort = [int64]$last['sort_key']
      $nextRow = [int64]$last['row_id']
    }
  }
  return @{
    Rows = $rows
    Total = $total
    Limit = [int]$page.Limit
    Offset = [int]$page.Offset
    NextSort = $nextSort
    NextRow = $nextRow
    First = ($flag -eq 0)
  }
}

function Get-PageWindow($req) {
  $limit = 200
  $offset = 0
  try {
    $rawLimit = [string]$req.QueryString['limit']
    $rawOffset = [string]$req.QueryString['offset']
    if ($rawLimit -match '^\d+$') {
      $n = [int]$rawLimit
      if ($n -lt 1) { $n = 1 }
      if ($n -gt 200) { $n = 200 }
      $limit = $n
    }
    if ($rawOffset -match '^\d+$') {
      $offset = [int]$rawOffset
      if ($offset -lt 0) { $offset = 0 }
    }
  } catch {}
  return @{ Limit = [int]$limit; Offset = [int]$offset }
}

function Send-Pending($res, $pending) {
  if (-not $pending) { return }
  $status = 200
  if ($pending.ContainsKey('Status') -and $null -ne $pending['Status']) { $status = [int]$pending['Status'] }
  if ($pending.ContainsKey('Raw') -and $pending['Raw']) {
    Send-RawJson $res ([string]$pending['Raw']) $status
    return
  }
  if ($pending.ContainsKey('Obj')) { Send-Json $res $pending['Obj'] $status }
}

function Clip-Text($val, [int]$max) {
  $s = ''
  if ($null -ne $val) { $s = [string]$val }
  $s = $s.Trim()
  if ($s.Length -le $max) { return $s }
  return $s.Substring(0, $max)
}

function Get-ShopRates {
  if ($script:ShopRates) { return $script:ShopRates }
  $rates = @{ kzt = [double]1 }
  $path = Join-Path $Root 'products.js'
  if (Test-Path -LiteralPath $path) {
    $text = [System.IO.File]::ReadAllText($path, [System.Text.Encoding]::UTF8)
    foreach ($code in @('kzt', 'rub', 'usd')) {
      $m = [regex]::Match($text, '"' + $code + '"\s*:\s*([0-9]+(?:\.[0-9]+)?)')
      if ($m.Success) { $rates[$code] = [double]::Parse($m.Groups[1].Value, [cultureinfo]::InvariantCulture) }
    }
  }
  $script:ShopRates = $rates
  return $script:ShopRates
}

function Get-DefaultProducts {
  return @()
}

function Get-LiveCatalog($db) {
  $rows = $db.Query('SELECT updated_at, products_json FROM catalog WHERE id = 1', $null)
  if ($rows.Count -gt 0) {
    $at = [string]$rows[0]['updated_at']
    $products = @(ConvertFrom-ProductsJson ([string]$rows[0]['products_json']))
    if ($at -or $products.Count -gt 0) {
      return @{ Products = $products; Persisted = $true; UpdatedAt = $at }
    }
  }
  return @{ Products = @(); Persisted = $false; UpdatedAt = '' }
}

function Write-CatalogBlob($db, $products, [string]$updatedAt) {
  $itemsJson = ConvertTo-JsonSafe @($products)
  if (-not $itemsJson -or -not $itemsJson.TrimStart().StartsWith('[')) { throw 'catalog json failed' }
  $rows = $db.Query('SELECT id FROM catalog WHERE id = 1', $null)
  $vals = New-Object object[] 2
  $vals[0] = $updatedAt
  $vals[1] = $itemsJson
  if ($rows.Count -gt 0) {
    [void]$db.Run('UPDATE catalog SET updated_at = ?, products_json = ? WHERE id = 1', $vals)
  } else {
    [void]$db.Run('INSERT INTO catalog (id, updated_at, products_json) VALUES (1, ?, ?)', $vals)
  }
}

function Find-CatalogProduct($products, [string]$id) {
  foreach ($p in @($products)) {
    if ($null -eq $p) { continue }
    if ([string](Get-Prop $p 'id') -eq $id) { return $p }
  }
  return $null
}

function Get-StockQty($product) {
  $q = Get-Prop $product 'qty'
  if ($null -eq $q) { return $null }
  if ($q -is [string] -and [string]$q -eq '') { return $null }
  try { return [int][math]::Round([double]$q, 0, [MidpointRounding]::AwayFromZero) } catch { return $null }
}

function ConvertTo-KztAmount([double]$amount, [string]$code, $rates) {
  $rate = [double]1
  if ($rates.Contains($code)) {
    $n = [double]$rates[$code]
    if ($n -ne 0) { $rate = $n }
  }
  return $amount / $rate
}

function ConvertFrom-KztAmount([double]$kzt, [string]$code, $rates) {
  $rate = [double]1
  if ($rates.Contains($code)) { $rate = [double]$rates[$code] }
  if ($rate -eq 0) { $rate = 1 }
  return $kzt * $rate
}

function Format-ShopAmount([double]$val, [string]$code) {
  $rounded = if ($code -eq 'usd') {
    [math]::Round($val, 2, [MidpointRounding]::AwayFromZero)
  } else {
    [math]::Round($val, 0, [MidpointRounding]::AwayFromZero)
  }
  $s = if ($code -eq 'usd') {
    $rounded.ToString('0.00', [cultureinfo]::InvariantCulture)
  } else {
    ([int64]$rounded).ToString([cultureinfo]::InvariantCulture)
  }
  $parts = $s.Split('.')
  $int = $parts[0]
  $sign = ''
  if ($int.StartsWith('-')) { $sign = '-'; $int = $int.Substring(1) }
  $grouped = [regex]::Replace($int, '\B(?=(\d{3})+(?!\d))', ' ')
  if ($parts.Length -gt 1) { $grouped = $grouped + '.' + $parts[1] }
  $grouped = $sign + $grouped
  if ($code -eq 'usd') { return '$' + $grouped }
  $sym = if ($code -eq 'rub') { [string][char]0x20BD } else { [string][char]0x20B8 }
  return ($grouped + ' ' + $sym)
}

function Resolve-CreatedAt($raw) {
  $now = [DateTime]::UtcNow
  try {
    $d = [datetimeoffset]::Parse([string]$raw).UtcDateTime
    if ($d -gt $now.AddMinutes(5)) { return $now.ToString('o') }
    if ($d -lt $now.AddDays(-30)) { return $now.ToString('o') }
    return $d.ToString('o')
  } catch {
    return $now.ToString('o')
  }
}

function Resolve-PublicOrder($order, $db) {
  $fail = { param($status, $error, $extra)
    $obj = @{ Ok = $false; Status = $status; Error = $error }
    if ($extra) { $obj.Extra = $extra }
    return $obj
  }
  $name = Clip-Text (Get-Prop $order 'clientName') 80
  if (-not $name) { return (& $fail 400 'missing name' $null) }
  $source = Clip-Text (Get-Prop $order 'source') 20
  if ($source -ne 'cart' -and $source -ne 'buy' -and $source -ne 'contact') { $source = 'cart' }
  $phoneRaw = Clip-Text (Get-Prop $order 'clientPhone') 40
  $displayCur = Clip-Text (Get-Prop $order 'currency') 8
  if ($displayCur -ne 'kzt' -and $displayCur -ne 'rub' -and $displayCur -ne 'usd') { $displayCur = 'kzt' }
  $messenger = Clip-Text (Get-Prop $order 'messenger') 20
  if ($messenger -ne 'telegram') { $messenger = 'whatsapp' }
  $rates = Get-ShopRates
  if ($displayCur -ne 'kzt' -and (-not $rates.Contains($displayCur) -or [double]$rates[$displayCur] -le 0)) {
    $displayCur = 'kzt'
  }

  if ($source -eq 'contact') {
    if (-not $phoneRaw) { return (& $fail 400 'missing contact' $null) }
    $message = [System.Text.Encoding]::UTF8.GetString([byte[]](0xD0,0x97,0xD0,0xB0,0xD1,0x8F,0xD0,0xB2,0xD0,0xBA,0xD0,0xB0,0x20,0xD1,0x81,0x20,0xD1,0x81,0xD0,0xB0,0xD0,0xB9,0xD1,0x82,0xD0,0xB0))
    $itemsIn = Get-Prop $order 'items'
    if ($null -ne $itemsIn) {
      $first = $null
      foreach ($it in @($itemsIn)) { $first = $it; break }
      if ($null -ne $first) {
        $got = Clip-Text (Get-Prop $first 'name') 500
        if ($got) { $message = $got }
      }
    }
    $line = [ordered]@{
      id = 'lead'; name = $message; size = ''; qty = 1; price = 0; currency = 'kzt'
      unitLabel = ''; lineKzt = 0
    }
    $clean = New-Object psobject
    Set-Note $clean 'id' ([string](Get-Prop $order 'id'))
    Set-Note $clean 'createdAt' (Resolve-CreatedAt (Get-Prop $order 'createdAt'))
    Set-Note $clean 'clientName' $name
    Set-Note $clean 'clientPhone' $phoneRaw
    Set-Note $clean 'items' @($line)
    Set-Note $clean 'totalKzt' ([int64]0)
    Set-Note $clean 'totalLabel' ([System.Text.Encoding]::UTF8.GetString([byte[]](0xD0,0x97,0xD0,0xB0,0xD1,0x8F,0xD0,0xB2,0xD0,0xBA,0xD0,0xB0)))
    Set-Note $clean 'currency' 'kzt'
    Set-Note $clean 'messenger' 'whatsapp'
    Set-Note $clean 'status' 'new'
    Set-Note $clean 'source' 'contact'
    return @{ Ok = $true; Order = $clean; PersistStock = $false; Products = $null }
  }

  $digits = Normalize-Phone $phoneRaw
  if ($digits.Length -lt 10 -or $digits.Length -gt 15) { return (& $fail 400 'bad phone' $null) }
  $catalog = Get-LiveCatalog $db
  $products = @($catalog.Products)
  if (-not $catalog.Persisted -or $products.Count -lt 1) {
    return (& $fail 409 'catalog unavailable' $null)
  }
  $rawItems = @(Get-Prop $order 'items')
  if ($rawItems.Count -lt 1 -or $rawItems.Count -gt 30) { return (& $fail 400 'bad items' $null) }
  $wanted = @{}
  $orderIds = New-Object System.Collections.Generic.List[string]
  foreach ($it in $rawItems) {
    if ($null -eq $it) { continue }
    $sku = Clip-Text (Get-Prop $it 'id') 40
    if (-not $sku -or $sku -eq 'lead') { return (& $fail 400 'bad items' $null) }
    $qty = 0
    try { $qty = [int][math]::Round([double](Get-Prop $it 'qty'), 0, [MidpointRounding]::AwayFromZero) } catch { $qty = 0 }
    if ($qty -lt 1) { return (& $fail 400 'bad qty' $null) }
    if (-not $wanted.ContainsKey($sku)) { [void]$orderIds.Add($sku); $wanted[$sku] = 0 }
    $wanted[$sku] = [int]$wanted[$sku] + $qty
  }
  if ($orderIds.Count -lt 1) { return (& $fail 400 'bad items' $null) }

  $built = New-Object System.Collections.Generic.List[object]
  $totalKzt = [int64]0
  $displaySum = [double]0
  foreach ($sku in $orderIds) {
    $product = Find-CatalogProduct $products $sku
    if ($null -eq $product) { return (& $fail 400 'unknown product' $sku) }
    $active = Get-Prop $product 'active'
    if ($active -is [bool] -and -not $active) { return (& $fail 409 'unavailable' $sku) }
    $qty = [int]$wanted[$sku]
    if ($qty -gt 99) { return (& $fail 409 'too many' $sku) }
    $stock = Get-StockQty $product
    if ($null -ne $stock -and $stock -lt $qty) { return (& $fail 409 'out of stock' $sku) }
    $price = 0.0
    try { $price = [double](Get-Prop $product 'price') } catch { return (& $fail 400 'bad price' $sku) }
    if ($price -lt 0) { return (& $fail 400 'bad price' $sku) }
    $cur = Clip-Text (Get-Prop $product 'currency') 8
    if ($cur -ne 'kzt' -and $cur -ne 'rub' -and $cur -ne 'usd') { $cur = 'kzt' }
    if ($cur -ne 'kzt' -and (-not $rates.Contains($cur) -or [double]$rates[$cur] -le 0)) {
      return (& $fail 400 'bad price' $sku)
    }
    $unitKzt = ConvertTo-KztAmount $price $cur $rates
    $lineKzt = [int64][math]::Round($unitKzt * $qty, 0, [MidpointRounding]::AwayFromZero)
    $unitDisplay = ConvertFrom-KztAmount $unitKzt $displayCur $rates
    $unitRounded = if ($displayCur -eq 'usd') {
      [math]::Round($unitDisplay, 2, [MidpointRounding]::AwayFromZero)
    } else {
      [math]::Round($unitDisplay, 0, [MidpointRounding]::AwayFromZero)
    }
    $displaySum += ([double]$unitRounded * $qty)
    $totalKzt += $lineKzt
    $line = [ordered]@{
      id = $sku
      name = (Clip-Text (Get-Prop $product 'name') 160)
      size = (Clip-Text (Get-Prop $product 'size') 80)
      qty = $qty
      price = $price
      currency = $cur
      unitLabel = (Format-ShopAmount ([double]$unitRounded) $displayCur)
      lineKzt = $lineKzt
    }
    [void]$built.Add($line)
  }

  $clean = New-Object psobject
  Set-Note $clean 'id' ([string](Get-Prop $order 'id'))
  Set-Note $clean 'createdAt' (Resolve-CreatedAt (Get-Prop $order 'createdAt'))
  Set-Note $clean 'clientName' $name
  Set-Note $clean 'clientPhone' $phoneRaw
  Set-Note $clean 'items' $built.ToArray()
  Set-Note $clean 'totalKzt' $totalKzt
  Set-Note $clean 'totalLabel' (Format-ShopAmount $displaySum $displayCur)
  Set-Note $clean 'currency' $displayCur
  Set-Note $clean 'messenger' $messenger
  Set-Note $clean 'status' 'new'
  Set-Note $clean 'source' $source
  return @{ Ok = $true; Order = $clean; PersistStock = $false; Products = $null }
}

function Get-StockHeld($row) {
  if ($null -eq $row -or -not $row.ContainsKey('stock_held') -or $null -eq $row['stock_held']) { return 0 }
  try { return [int]$row['stock_held'] } catch { return 0 }
}

function Move-OrderStock($db, $order, [int]$sign) {
  $catalog = Get-LiveCatalog $db
  if (-not $catalog.Persisted) { return $null }
  $products = @($catalog.Products)
  $changed = $false
  foreach ($it in @(Get-Prop $order 'items')) {
    if ($null -eq $it) { continue }
    $itemId = [string](Get-Prop $it 'id')
    if (-not $itemId -or $itemId -eq 'lead') { continue }
    $product = Find-CatalogProduct $products $itemId
    if ($null -eq $product) { continue }
    $stock = Get-StockQty $product
    if ($null -eq $stock) { continue }
    $qty = 0
    try { $qty = [int](Get-Prop $it 'qty') } catch { $qty = 0 }
    if ($qty -lt 1) { continue }
    $next = $stock + ($sign * $qty)
    if ($next -lt 0) { return 'out of stock' }
    Set-Note $product 'qty' ([int]$next)
    $changed = $true
  }
  if ($changed) { Write-CatalogBlob $db $products ([DateTime]::UtcNow.ToString('o')) }
  return $null
}

function Handle-Orders($req, $res, $id) {
  if ($req.HttpMethod -eq 'OPTIONS') {
    $res.StatusCode = 204
    $res.Headers['Access-Control-Allow-Origin'] = '*'
    $res.Headers['Access-Control-Allow-Methods'] = 'GET, POST, PATCH, DELETE, OPTIONS'
    $res.Headers['Access-Control-Allow-Headers'] = 'Content-Type, X-Admin-Token'
    $res.ContentLength64 = 0
    $res.Close()
    return
  }

  $pending = $null
  $bodyText = $null
  if ($req.HttpMethod -eq 'POST' -and -not $id) {
    if (-not (Test-RateAllow 'orders' (Get-ClientIp $req) 60 600)) {
      Send-Json $res @{ error = 'too many requests' } 429
      return
    }
  }
  if ($req.HttpMethod -eq 'POST' -or ($req.HttpMethod -eq 'PATCH' -and $id)) {
    $bodyText = Read-LimitedBody $req 48000
    if ($null -eq $bodyText) {
      Send-Json $res @{ error = 'too large' } 413
      return
    }
  }
  if (($req.HttpMethod -eq 'GET' -and -not $id) -or ($req.HttpMethod -eq 'PATCH' -and $id) -or ($req.HttpMethod -eq 'DELETE' -and $id)) {
    if (-not (Test-Admin $req)) { Send-Json $res @{ error = 'unauthorized' } 401; return }
  }

  Enter-CrmLock
  $db = $null
  $ok = $false
  try {
    if ($req.HttpMethod -eq 'GET' -and -not $id) {
      $db = Open-CrmTxn
      $page = Get-CrmPage $db 'orders' 'order_deleted' $req
      $items = New-Object System.Collections.Generic.List[object]
      foreach ($row in @($page.Rows)) { [void]$items.Add((New-OrderFromRow $row)) }
      $deleted = @()
      if ($page.First) { $deleted = Get-DeletedIds $db 'orders' }
      $ok = $true
      $ordersJson = ConvertTo-OrdersFileJson @($items.ToArray())
      $pending = @{ Raw = (ConvertTo-WrappedListJson 'orders' $ordersJson $deleted $page.Total $page.Limit $page.Offset $page.NextSort $page.NextRow); Status = 200 }
      return
    }

    if ($req.HttpMethod -eq 'POST' -and -not $id) {
      try { $order = $bodyText | ConvertFrom-Json } catch {
        $pending = @{ Obj = @{ error = 'bad json' }; Status = 400 }
        return
      }
      if (-not $order.id) {
        $pending = @{ Obj = @{ error = 'missing id' }; Status = 400 }
        return
      }
      $oid = [string]$order.id
      $db = Open-CrmTxn
      $tomb = $db.Query('SELECT 1 AS n FROM order_deleted WHERE id = ?', @($oid))
      if ($tomb.Count -gt 0) {
        $ok = $true
        $pending = @{ Obj = @{ ok = $true; deleted = $true; id = $oid }; Status = 200 }
        return
      }
      $existing = $db.Query('SELECT 1 AS n FROM orders WHERE id = ?', @($oid))
      if ($existing.Count -gt 0) {
        $ok = $true
        $pending = @{ Obj = @{ ok = $true; existed = $true; id = $oid }; Status = 200 }
        return
      }
      if ($oid -notmatch '^[A-Za-z0-9_-]{6,48}$') {
        $pending = @{ Obj = @{ error = 'bad id' }; Status = 400 }
        return
      }
      $built = Resolve-PublicOrder $order $db
      if (-not $built.Ok) {
        $obj = @{ error = [string]$built.Error }
        if ($built.Extra) { $obj.id = [string]$built.Extra }
        $pending = @{ Obj = $obj; Status = [int]$built.Status }
        return
      }
      Add-OrderRow $db $built.Order (Get-NextSort $db 'orders')
      $ok = $true
      $pending = @{ Obj = @{ ok = $true; id = $oid; totalKzt = (Get-Prop $built.Order 'totalKzt'); totalLabel = (Get-Prop $built.Order 'totalLabel') }; Status = 200 }
      return
    }

    if ($req.HttpMethod -eq 'PATCH' -and $id) {
      try { $patch = $bodyText | ConvertFrom-Json } catch {
        $pending = @{ Obj = @{ error = 'bad json' }; Status = 400 }
        return
      }
      $db = Open-CrmTxn
      $tomb = $db.Query('SELECT 1 AS n FROM order_deleted WHERE id = ?', @($id))
      if ($tomb.Count -gt 0) {
        $ok = $true
        $pending = @{ Obj = @{ error = 'not found' }; Status = 404 }
        return
      }
      $rows = $db.Query('SELECT * FROM orders WHERE id = ?', @($id))
      if ($rows.Count -eq 0) {
        $ok = $true
        $pending = @{ Obj = @{ error = 'not found' }; Status = 404 }
        return
      }
      $current = New-OrderFromRow $rows[0]
      $stamp = [string]$patch.updatedAt
      $cur = [string](Get-Prop $current 'updatedAt')
      $stale = $false
      if ($stamp -and $cur -and -not (Test-StampNewer $stamp $cur)) { $stale = $true }
      if (-not $stale) {
        $prevStatus = Get-RowText $rows[0] 'status'
        if (-not $prevStatus) { $prevStatus = 'new' }
        $status = $prevStatus
        if ($null -ne $patch.status) {
          $status = [string]$patch.status
          if ($status -ne 'new' -and $status -ne 'work' -and $status -ne 'done') {
            $pending = @{ Obj = @{ error = 'bad status' }; Status = 400 }
            return
          }
        }
        $held = Get-StockHeld $rows[0]
        if ($status -ne $prevStatus) {
          $nextHolds = ($status -eq 'work' -or $status -eq 'done')
          if ($nextHolds -and $held -eq 0) {
            $stockErr = Move-OrderStock $db $current -1
            if ($stockErr) {
              $pending = @{ Obj = @{ error = $stockErr }; Status = 409 }
              return
            }
            $held = 1
          } elseif (-not $nextHolds -and $held -ne 0) {
            Move-OrderStock $db $current 1 | Out-Null
            $held = 0
          }
        }
        $nextAt = $stamp
        if (-not $nextAt) { $nextAt = [DateTime]::UtcNow.ToString('o') }
        $vals = New-Object object[] 4
        $vals[0] = ConvertTo-DbText $status
        $vals[1] = $nextAt
        $vals[2] = [int]$held
        $vals[3] = $id
        [void]$db.Run('UPDATE orders SET status = ?, updated_at = ?, stock_held = ? WHERE id = ?', $vals)
      }
      $ok = $true
      $pending = @{ Obj = @{ ok = $true; stale = [bool]$stale }; Status = 200 }
      return
    }

    if ($req.HttpMethod -eq 'DELETE' -and $id) {
      $db = Open-CrmTxn
      $rows = $db.Query('SELECT * FROM orders WHERE id = ?', @($id))
      if ($rows.Count -gt 0 -and (Get-StockHeld $rows[0]) -ne 0) {
        Move-OrderStock $db (New-OrderFromRow $rows[0]) 1 | Out-Null
      }
      [void]$db.Run('INSERT OR IGNORE INTO order_deleted (id) VALUES (?)', @($id))
      [void]$db.Run('DELETE FROM orders WHERE id = ?', @($id))
      $ok = $true
      $pending = @{ Obj = @{ ok = $true }; Status = 200 }
      return
    }

    $pending = @{ Obj = @{ error = 'method not allowed' }; Status = 405 }
  } catch {
    $ok = $false
    Write-Host ("CRM orders: {0}" -f $_.Exception.Message) -ForegroundColor Red
    $pending = @{ Obj = @{ error = 'crm failed' }; Status = 500 }
  } finally {
    if ($db) { Close-CrmTxn $db $ok }
    Exit-CrmLock
    try { Send-Pending $res $pending } catch {}
  }
}

function Normalize-Phone([string]$phone) {
  $d = ($phone -replace '\D', '')
  if ($d.Length -eq 11 -and $d[0] -eq '8') { $d = '7' + $d.Substring(1) }
  if ($d.Length -eq 10) { $d = '7' + $d }
  return $d
}

function Handle-Clients($req, $res, $id) {
  if ($req.HttpMethod -eq 'OPTIONS') {
    $res.StatusCode = 204
    $res.Headers['Access-Control-Allow-Origin'] = '*'
    $res.Headers['Access-Control-Allow-Methods'] = 'GET, POST, DELETE, OPTIONS'
    $res.Headers['Access-Control-Allow-Headers'] = 'Content-Type, X-Admin-Token'
    $res.ContentLength64 = 0
    $res.Close()
    return
  }

  $pending = $null
  $bodyText = $null
  $clientAdmin = $false
  if ($req.HttpMethod -eq 'POST' -and -not $id) {
    if (-not (Test-RateAllow 'clients' (Get-ClientIp $req) 60 600)) {
      Send-Json $res @{ error = 'too many requests' } 429
      return
    }
    $bodyText = Read-LimitedBody $req 16000
    if ($null -eq $bodyText) {
      Send-Json $res @{ error = 'too large' } 413
      return
    }
    $clientAdmin = Test-Admin $req
  }
  if (($req.HttpMethod -eq 'GET' -and -not $id) -or ($req.HttpMethod -eq 'DELETE' -and $id)) {
    if (-not (Test-Admin $req)) { Send-Json $res @{ error = 'unauthorized' } 401; return }
  }

  Enter-CrmLock
  $db = $null
  $ok = $false
  try {
    if ($req.HttpMethod -eq 'GET' -and -not $id) {
      $db = Open-CrmTxn
      $page = Get-CrmPage $db 'clients' 'client_deleted' $req
      $items = New-Object System.Collections.Generic.List[object]
      foreach ($row in @($page.Rows)) { [void]$items.Add((New-ClientFromRow $row)) }
      $deleted = @()
      if ($page.First) { $deleted = Get-DeletedIds $db 'clients' }
      $ok = $true
      $body = ConvertTo-JsonSafe @($items.ToArray())
      $pending = @{ Raw = (ConvertTo-WrappedListJson 'clients' $body $deleted $page.Total $page.Limit $page.Offset $page.NextSort $page.NextRow); Status = 200 }
      return
    }

    if ($req.HttpMethod -eq 'POST' -and -not $id) {
      try { $client = $bodyText | ConvertFrom-Json } catch {
        $pending = @{ Obj = @{ error = 'bad json' }; Status = 400 }
        return
      }
      $phone = Normalize-Phone ([string]$client.phone)
      if (-not $phone -and -not $client.id) {
        $pending = @{ Obj = @{ error = 'missing phone' }; Status = 400 }
        return
      }
      $db = Open-CrmTxn
      if ($client.id) {
        $tomb = $db.Query('SELECT 1 AS n FROM client_deleted WHERE id = ?', @([string]$client.id))
        if ($tomb.Count -gt 0) {
        $ok = $true
        $pending = @{ Obj = @{ ok = $true; deleted = $true; id = [string]$client.id }; Status = 200 }
        return
      }
      }
      $rows = @()
      if ($phone) {
        $rows = $db.Query('SELECT * FROM clients WHERE phone = ? AND id NOT IN (SELECT id FROM client_deleted) ORDER BY sort_key DESC LIMIT 1', @($phone))
      } elseif ($client.id) {
        $rows = $db.Query('SELECT * FROM clients WHERE id = ? AND id NOT IN (SELECT id FROM client_deleted) LIMIT 1', @([string]$client.id))
      }
      if ($rows.Count -gt 0) {
        $existing = New-ClientFromRow $rows[0]
        $blankName = [System.Text.Encoding]::UTF8.GetString([byte[]](0xD0,0x91,0xD0,0xB5,0xD0,0xB7,0x20,0xD0,0xB8,0xD0,0xBC,0xD0,0xB5,0xD0,0xBD,0xD0,0xB8))
        $currentName = [string](Get-Prop $existing 'name')
        $nameOpen = $clientAdmin -or (-not $currentName.Trim()) -or ($currentName.Trim() -eq $blankName)
        if ($nameOpen -and $client.name -and ((Test-StampNewer $client.nameAt $existing.nameAt) -or ((-not $client.nameAt) -and (Test-StampNewer $client.updatedAt $existing.updatedAt)))) {
          Set-Note $existing 'name' (Clip-Text $client.name 80)
          if ($client.nameAt) { Set-Note $existing 'nameAt' ([string]$client.nameAt) }
        }
        if ($phone) { Set-Note $existing 'phone' $phone }
        if ($client.phoneDisplay) { Set-Note $existing 'phoneDisplay' ([string]$client.phoneDisplay) }
        if ($client.lastOrderAt -and (Test-StampNewer $client.lastOrderAt $existing.lastOrderAt)) {
          Set-Note $existing 'lastOrderAt' ([string]$client.lastOrderAt)
        }
        if ($clientAdmin -and $null -ne $client.notes -and (Test-StampNewer $client.notesAt $existing.notesAt)) {
          Set-Note $existing 'notes' (Clip-Text $client.notes 2000)
          Set-Note $existing 'notesAt' ([string]$client.notesAt)
        }
        if ($clientAdmin -and $null -ne $client.hidden -and $client.hiddenAt -and (Test-StampNewer $client.hiddenAt $existing.hiddenAt)) {
          Set-Note $existing 'hidden' ([bool]$client.hidden)
          Set-Note $existing 'hiddenAt' ([string]$client.hiddenAt)
        }
        $newest = [string]$existing.updatedAt
        if ($client.updatedAt -and (Test-StampNewer $client.updatedAt $newest)) { $newest = [string]$client.updatedAt }
        if ($newest) { Set-Note $existing 'updatedAt' $newest }
        if (-not $existing.id) { Set-Note $existing 'id' ([string]$client.id) }
        Save-ClientRow $db $existing (Get-NextSort $db 'clients')
        $savedId = [string]$existing.id
      } else {
        if (-not $client.id) { Set-Note $client 'id' ("c{0}" -f [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()) }
        if ($phone) { Set-Note $client 'phone' $phone }
        if ($client.name) { Set-Note $client 'name' (Clip-Text $client.name 80) }
        if (-not $clientAdmin) {
          Set-Note $client 'notes' ''
          Set-Note $client 'notesAt' $null
          Set-Note $client 'hidden' $false
          Set-Note $client 'hiddenAt' $null
        } else {
          if ($null -ne $client.notes) { Set-Note $client 'notes' (Clip-Text $client.notes 2000) }
        }
        Add-ClientRow $db $client (Get-NextSort $db 'clients')
        $savedId = [string]$client.id
      }
      $ok = $true
      $pending = @{ Obj = @{ ok = $true; id = $savedId }; Status = 200 }
      return
    }

    if ($req.HttpMethod -eq 'DELETE' -and $id) {
      $db = Open-CrmTxn
      [void]$db.Run('INSERT OR IGNORE INTO client_deleted (id) VALUES (?)', @($id))
      [void]$db.Run('DELETE FROM clients WHERE id = ?', @($id))
      $ok = $true
      $pending = @{ Obj = @{ ok = $true }; Status = 200 }
      return
    }

    $pending = @{ Obj = @{ error = 'method not allowed' }; Status = 405 }
  } catch {
    $ok = $false
    Write-Host ("CRM clients: {0}" -f $_.Exception.Message) -ForegroundColor Red
    $pending = @{ Obj = @{ error = 'crm failed' }; Status = 500 }
  } finally {
    if ($db) { Close-CrmTxn $db $ok }
    Exit-CrmLock
    try { Send-Pending $res $pending } catch {}
  }
}

function Handle-Catalog($req, $res) {
  if ($req.HttpMethod -eq 'OPTIONS') {
    $res.StatusCode = 204
    $res.Headers['Access-Control-Allow-Origin'] = '*'
    $res.Headers['Access-Control-Allow-Methods'] = 'GET, PUT, OPTIONS'
    $res.Headers['Access-Control-Allow-Headers'] = 'Content-Type, X-Admin-Token'
    $res.ContentLength64 = 0
    $res.Close()
    return
  }

  $pending = $null
  $payload = $null
  if ($req.HttpMethod -eq 'PUT') {
    if (-not (Test-Admin $req)) { Send-Json $res @{ error = 'unauthorized' } 401; return }
    $reader = New-Object System.IO.StreamReader($req.InputStream, [System.Text.Encoding]::UTF8)
    $bodyText = $reader.ReadToEnd()
    $reader.Close()
    try { $payload = $bodyText | ConvertFrom-Json } catch {
      Send-Json $res @{ error = 'bad json' } 400
      return
    }
    if ($null -eq $payload.products) {
      Send-Json $res @{ error = 'missing products' } 400
      return
    }
  }

  Enter-CrmLock
  $db = $null
  $ok = $false
  try {
    if ($req.HttpMethod -eq 'GET') {
      $db = Open-CrmTxn
      $rows = $db.Query('SELECT updated_at, products_json FROM catalog WHERE id = 1', $null)
      $updatedAt = ''
      $products = @()
      if ($rows.Count -gt 0) {
        $updatedAt = [string]$rows[0]['updated_at']
        $products = ConvertFrom-ProductsJson ([string]$rows[0]['products_json'])
      }
      $ok = $true
      $pending = @{ Raw = (ConvertTo-CatalogJson $updatedAt $products); Status = 200 }
      return
    }
    if ($req.HttpMethod -eq 'PUT') {
      $db = Open-CrmTxn
      $rows = $db.Query('SELECT updated_at, products_json FROM catalog WHERE id = 1', $null)
      $serverAt = ''
      $currentProducts = @()
      if ($rows.Count -gt 0) {
        $serverAt = [string]$rows[0]['updated_at']
        $currentProducts = ConvertFrom-ProductsJson ([string]$rows[0]['products_json'])
      }
      $base = [string]$payload.baseUpdatedAt
      if ($serverAt -and $base -ne $serverAt) {
        $ok = $true
        $pending = @{ Raw = (ConvertTo-CatalogJson $serverAt $currentProducts); Status = 409 }
        return
      }
      $list = New-Object System.Collections.Generic.List[object]
      foreach ($p in @($payload.products)) {
        if ($null -ne $p) { [void]$list.Add($p) }
      }
      $newAt = [string]$payload.updatedAt
      if (-not $newAt) { $newAt = [DateTime]::UtcNow.ToString('o') }
      $itemsJson = ConvertTo-JsonSafe $list.ToArray()
      if (-not $itemsJson -or -not $itemsJson.TrimStart().StartsWith('[')) { $itemsJson = '[]' }
      if ($rows.Count -gt 0) {
        $vals = New-Object object[] 2
        $vals[0] = $newAt
        $vals[1] = $itemsJson
        [void]$db.Run('UPDATE catalog SET updated_at = ?, products_json = ? WHERE id = 1', $vals)
      } else {
        $vals = New-Object object[] 2
        $vals[0] = $newAt
        $vals[1] = $itemsJson
        [void]$db.Run('INSERT INTO catalog (id, updated_at, products_json) VALUES (1, ?, ?)', $vals)
      }
      $ok = $true
      $pending = @{ Obj = @{ ok = $true; updatedAt = $newAt }; Status = 200 }
      return
    }
    $pending = @{ Obj = @{ error = 'method not allowed' }; Status = 405 }
  } catch {
    $ok = $false
    Write-Host ("CRM catalog: {0}" -f $_.Exception.Message) -ForegroundColor Red
    $pending = @{ Obj = @{ error = 'crm failed' }; Status = 500 }
  } finally {
    if ($db) { Close-CrmTxn $db $ok }
    Exit-CrmLock
    try { Send-Pending $res $pending } catch {}
  }
}

function New-CompanyObject($row) {
  $o = New-Object psobject
  foreach ($name in @('name','bin_iin','address','phone','email','bank_name','iban','bik')) {
    $text = ''
    if ($null -ne $row -and $row.ContainsKey($name) -and $null -ne $row[$name]) { $text = [string]$row[$name] }
    Set-Note $o $name $text
  }
  return $o
}

function Test-CompanyInput($payload) {
  $name = Clip-Text (Get-Prop $payload 'name') 120
  $bin = ([regex]::Replace((Clip-Text (Get-Prop $payload 'bin_iin') 32), '\D', ''))
  $iban = ([regex]::Replace((Clip-Text (Get-Prop $payload 'iban') 40), '\s', '')).ToUpper()
  $phone = Clip-Text (Get-Prop $payload 'phone') 40
  $bank = Clip-Text (Get-Prop $payload 'bank_name') 80
  $email = Clip-Text (Get-Prop $payload 'email') 80
  if ($name.Length -lt 2) { return 'missing name' }
  if ($bin -notmatch '^\d{12}$' -or $bin -eq '900101300000') { return 'bad bin' }
  if ($iban -notmatch '^KZ[0-9A-Z]{18}$' -or $iban -eq 'KZ123456789012345678') { return 'bad iban' }
  if ($bank.Length -lt 2) { return 'missing bank' }
  if ($phone.Length -lt 5 -or $phone -match '000[\s-]*00[\s-]*00') { return 'bad phone' }
  if ($email -and $email -notmatch '^[^@\s]+@[^@\s]+\.[^@\s]+$') { return 'bad email' }
  return $null
}

function Handle-Company($req, $res) {
  if ($req.HttpMethod -eq 'OPTIONS') {
    $res.StatusCode = 204
    $res.Headers['Access-Control-Allow-Origin'] = '*'
    $res.Headers['Access-Control-Allow-Methods'] = 'GET, PUT, OPTIONS'
    $res.Headers['Access-Control-Allow-Headers'] = 'Content-Type, X-Admin-Token'
    $res.ContentLength64 = 0
    $res.Close()
    return
  }
  $bodyText = $null
  if ($req.HttpMethod -eq 'PUT') {
    if (-not (Test-Admin $req)) { Send-Json $res @{ error = 'unauthorized' } 401; return }
    $bodyText = Read-LimitedBody $req 8000
    if ($null -eq $bodyText) { Send-Json $res @{ error = 'too large' } 413; return }
  } elseif ($req.HttpMethod -ne 'GET') {
    Send-Json $res @{ error = 'method not allowed' } 405
    return
  }

  Enter-CrmLock
  $db = $null
  $ok = $false
  $pending = $null
  try {
    $db = Open-CrmTxn
    if ($req.HttpMethod -eq 'GET') {
      $rows = $db.Query('SELECT name, bin_iin, address, phone, email, bank_name, iban, bik FROM company WHERE id = 1', $null)
      $row = $null
      if ($rows.Count -gt 0) { $row = $rows[0] }
      $ok = $true
      $pending = @{ Obj = (New-CompanyObject $row); Status = 200 }
      return
    }
    try { $payload = $bodyText | ConvertFrom-Json } catch {
      $pending = @{ Obj = @{ error = 'bad json' }; Status = 400 }
      return
    }
    $bad = Test-CompanyInput $payload
    if ($bad) {
      $pending = @{ Obj = @{ error = $bad }; Status = 400 }
      return
    }
    $name = Clip-Text (Get-Prop $payload 'name') 120
    $bin = ([regex]::Replace((Clip-Text (Get-Prop $payload 'bin_iin') 32), '\D', ''))
    $iban = ([regex]::Replace((Clip-Text (Get-Prop $payload 'iban') 40), '\s', '')).ToUpper()
    $phone = Clip-Text (Get-Prop $payload 'phone') 40
    $bank = Clip-Text (Get-Prop $payload 'bank_name') 80
    $email = Clip-Text (Get-Prop $payload 'email') 80
    $address = Clip-Text (Get-Prop $payload 'address') 160
    $bik = (Clip-Text (Get-Prop $payload 'bik') 20).ToUpper()
    $vals = New-Object object[] 8
    $vals[0] = $name
    $vals[1] = $bin
    $vals[2] = $address
    $vals[3] = $phone
    $vals[4] = $email
    $vals[5] = $bank
    $vals[6] = $iban
    $vals[7] = $bik
    $have = $db.Query('SELECT id FROM company WHERE id = 1', $null)
    if ($have.Count -gt 0) {
      [void]$db.Run('UPDATE company SET name=?, bin_iin=?, address=?, phone=?, email=?, bank_name=?, iban=?, bik=? WHERE id=1', $vals)
    } else {
      [void]$db.Run('INSERT INTO company (id, name, bin_iin, address, phone, email, bank_name, iban, bik) VALUES (1,?,?,?,?,?,?,?,?)', $vals)
    }
    $ok = $true
    $pending = @{ Obj = @{ ok = $true }; Status = 200 }
  } catch {
    $ok = $false
    Write-Host ("CRM company: {0}" -f $_.Exception.Message) -ForegroundColor Red
    $pending = @{ Obj = @{ error = 'crm failed' }; Status = 500 }
  } finally {
    if ($db) { Close-CrmTxn $db $ok }
    Exit-CrmLock
    try { Send-Pending $res $pending } catch {}
  }
}
