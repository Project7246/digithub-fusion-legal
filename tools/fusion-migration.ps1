param([switch]$UnfreezeOhio)

# Run manually in the owner's PowerShell. Never paste connection strings into chat.
# No application code is loaded and no courier/QuickBooks API is called.
$ErrorActionPreference = 'Stop'
$script:phase = 'preparation'
$script:sourceFrozen = $false
$script:backupDirectory = $null

function Read-Connection([string]$Label, [string]$Region) {
    $secret = Read-Host "$Label - paste Neon connection STRING (input hidden)" -AsSecureString
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
    try { $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer); $secret.Dispose() }
    try {
        $uri = [Uri]$plain
        if ($uri.Scheme -notin @('postgres','postgresql')) { throw 'Invalid connection format.' }
        if ($uri.Host -notmatch ('\.' + [regex]::Escape($Region) + '\.aws\.neon\.tech$')) {
            throw 'Unexpected database region. Stop and check the selected Neon project.'
        }
        $credentials = $uri.UserInfo -split ':', 2
        if ($credentials.Count -ne 2 -or $uri.AbsolutePath -ne '/neondb') {
            throw 'Expected the existing neondb database and password authentication.'
        }
        return @{
            Host = $uri.Host -replace '-pooler\.', '.'
            User = [Uri]::UnescapeDataString($credentials[0])
            Password = [Uri]::UnescapeDataString($credentials[1])
        }
    } finally { $plain = $null; $uri = $null; $credentials = $null }
}

function Invoke-Pg($Connection, [string]$Program, [string[]]$PgArguments) {
    $names = @('PGHOST','PGPORT','PGUSER','PGPASSWORD','PGDATABASE','PGSSLMODE',
        'PGAPPNAME','PGCONNECT_TIMEOUT','PGOPTIONS','PGSERVICE','PGSERVICEFILE')
    $saved = @{}
    foreach ($name in $names) { $saved[$name] = [Environment]::GetEnvironmentVariable($name, 'Process') }
    try {
        $env:PGHOST = $Connection.Host; $env:PGPORT = '5432'
        $env:PGUSER = $Connection.User; $env:PGPASSWORD = $Connection.Password
        $env:PGDATABASE = 'neondb'; $env:PGSSLMODE = 'require'
        $env:PGAPPNAME = 'fusion-migration'; $env:PGCONNECT_TIMEOUT = '30'
        $env:PGOPTIONS = '-c timezone=UTC -c datestyle=ISO'
        $env:PGSERVICE = $null; $env:PGSERVICEFILE = $null
        # Capture errors: restore failures can include real row values. Never echo them.
        $previousPreference = $ErrorActionPreference
        $ErrorActionPreference = 'Continue'
        try { $result = @(& (Join-Path $script:binDirectory $Program) @PgArguments 2>&1); $code = $LASTEXITCODE }
        finally { $ErrorActionPreference = $previousPreference }
        if ($code -ne 0) { throw "PostgreSQL command failed during $script:phase. Raw output suppressed to protect data." }
        return ($result | Where-Object { $_ -is [string] })
    } finally {
        foreach ($name in $names) { [Environment]::SetEnvironmentVariable($name, $saved[$name], 'Process') }
    }
}

function Invoke-Sql($Connection, [string]$Sql) {
    return Invoke-Pg $Connection 'psql.exe' @('-X','-w','-q','-t','-A','-v','ON_ERROR_STOP=1','-c',$Sql)
}

$fingerprintSql = @'
WITH tables AS (
  SELECT table_name FROM information_schema.tables
  WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
), fingerprints AS (
  SELECT table_name, query_to_xml(format($q$
    SELECT count(*) AS n,
      md5(coalesce(string_agg(md5(to_jsonb(r)::text), ''
        ORDER BY md5(to_jsonb(r)::text)), '')) AS h
    FROM public.%I r
  $q$, table_name), false, true, '') AS x FROM tables
)
SELECT table_name || '|' || (xpath('/row/n/text()', x))[1]::text
       || '|' || (xpath('/row/h/text()', x))[1]::text
FROM fingerprints ORDER BY table_name;
'@

$schemaSql = @'
SELECT table_name || '|' || column_name || '|' || udt_schema || '.' || udt_name
  || '|' || is_nullable || '|' || coalesce(column_default, '')
  || '|' || coalesce(character_maximum_length::text, '')
  || '|' || coalesce(numeric_precision::text, '') || '|' || coalesce(numeric_scale::text, '')
  || '|' || coalesce(identity_generation, '') || '|' || coalesce(generation_expression, '')
FROM information_schema.columns WHERE table_schema = 'public'
ORDER BY table_name, column_name;
'@

$sequenceSql = @'
SELECT schemaname || '.' || sequencename || '|'
  || start_value || '|' || min_value || '|' || max_value || '|' || increment_by
  || '|' || cycle || '|' || cache_size || '|' || coalesce(last_value::text, 'NULL')
FROM pg_sequences WHERE schemaname = 'public' ORDER BY sequencename;
'@

try {
    $candidates = @(Get-ChildItem -LiteralPath (Join-Path $env:TEMP 'claude') -Filter pg_dump.exe -File -Recurse -ErrorAction SilentlyContinue)
    if ($candidates.Count -ne 1) { throw 'Expected exactly one previously downloaded PostgreSQL toolset.' }
    $script:binDirectory = $candidates[0].DirectoryName
    foreach ($program in @('pg_dump.exe','pg_restore.exe','psql.exe')) {
        if (-not (Test-Path -LiteralPath (Join-Path $script:binDirectory $program))) { throw 'PostgreSQL tool missing.' }
    }
    $source = Read-Connection 'OHIO source: DigitHub Fusion / billowing-poetry-08559264' 'us-east-2'
    if ($UnfreezeOhio) {
        $script:phase = 'restoring Ohio write access'
        Invoke-Sql $source 'SET default_transaction_read_only = off; ALTER DATABASE neondb RESET default_transaction_read_only;' | Out-Null
        Invoke-Sql $source "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = current_database() AND usename = current_user AND pid <> pg_backend_pid() AND backend_type = 'client backend';" | Out-Null
        if ((Invoke-Sql $source 'SHOW default_transaction_read_only;') -ne 'off') { throw 'Ohio is still read-only.' }
        Write-Host 'Ohio writes restored. Keep maintenance on until the app DATABASE_URL is confirmed.'
        exit 0
    }
    $target = Read-Connection 'SINGAPORE destination: Fusion Singapore / wispy-dream-34764792' 'ap-southeast-1'
    $script:phase = 'read-only preflight'
    foreach ($connection in @($source,$target)) {
        $version = [int](Invoke-Sql $connection "SELECT current_setting('server_version_num');")
        if ($version -lt 180000 -or $version -ge 190000) { throw 'Expected PostgreSQL 18 on both projects.' }
        $tables = [int](Invoke-Sql $connection "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE';")
        if ($tables -ne 47) { throw 'Expected 47 public tables. Stop for schema review.' }
        if ((Invoke-Sql $connection 'SHOW default_transaction_read_only;') -ne 'off') {
            throw 'A database is already read-only. Stop and inspect its current migration state.'
        }
    }
    $overrides = [int](Invoke-Sql $source "SELECT count(*) FROM pg_db_role_setting s, unnest(s.setconfig) c WHERE c LIKE 'default_transaction_read_only=%';")
    if ($overrides -ne 0) { throw 'Existing read-only overrides require manual review.' }
    Write-Host 'Preflight passed: Ohio source, Singapore destination, PostgreSQL 18, 47 tables each.'
    Write-Host 'This will BACK UP BOTH databases, freeze Ohio writes and terminate its existing sessions,'
    Write-Host 'then replace the Singapore copy with a fresh full restore and verify every public row.'
    Write-Host 'Ohio records are not deleted. Maintenance must remain ON. The app connection is NOT switched here.'
    if ((Read-Host 'Type MIGRATE to proceed') -cne 'MIGRATE') { Write-Host 'Cancelled. No database changes.'; exit 0 }
    $script:backupDirectory = Join-Path $env:LOCALAPPDATA ('FusionMigration\' + [DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss'))
    New-Item -ItemType Directory -Path $script:backupDirectory -Force | Out-Null
    $script:phase = 'backing up the existing Singapore copy'
    Invoke-Pg $target 'pg_dump.exe' @('-w','-Fc','--no-owner','--no-privileges','-f',(Join-Path $script:backupDirectory 'singapore-before.dump')) | Out-Null
    $script:phase = 'freezing Ohio writes'
    Invoke-Sql $source 'ALTER DATABASE neondb SET default_transaction_read_only = on;' | Out-Null
    $script:sourceFrozen = $true
    $failedTerminations = [int](Invoke-Sql $source "SELECT count(*) FILTER (WHERE NOT pg_terminate_backend(pid, 5000)) FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid() AND backend_type = 'client backend';")
    if ($failedTerminations -ne 0) { throw 'Some existing Ohio sessions could not be stopped.' }
    if ((Invoke-Sql $source 'SHOW default_transaction_read_only;') -ne 'on') { throw 'Ohio write freeze was not confirmed.' }
    Write-Host 'Ohio new sessions are read-only; prior application sessions terminated.'
    $script:phase = 'creating the final Ohio backup'
    Invoke-Pg $source 'pg_dump.exe' @('-w','-Fc','--no-owner','--no-privileges','-f',(Join-Path $script:backupDirectory 'ohio-final.dump')) | Out-Null
    $script:phase = 'restoring Singapore atomically'
    Invoke-Pg $target 'pg_restore.exe' @('-w','--clean','--if-exists','--single-transaction','--exit-on-error','--no-owner','--no-privileges','-d','neondb',(Join-Path $script:backupDirectory 'ohio-final.dump')) | Out-Null
    $script:phase = 'verifying full row fingerprints, columns and sequence states'
    foreach ($check in @(@('Rows',$fingerprintSql),@('Columns',$schemaSql),@('Sequences',$sequenceSql))) {
        $before = @(Invoke-Sql $source $check[1]); $after = @(Invoke-Sql $target $check[1])
        if (($before -join "`n") -cne ($after -join "`n")) { throw ($check[0] + ' comparison failed. Do not switch the app.') }
        Write-Host ($check[0] + ': MATCH (' + $before.Count + ' entries)')
    }
    Write-Host 'VERIFIED: fresh Singapore copy matches the frozen Ohio database.'
    Write-Host 'Ohio remains read-only. Keep maintenance ON; next change only DigitalOcean DATABASE_URL.'
    Write-Host ('Private backups: ' + $script:backupDirectory)
    Write-Host 'Do not share/upload backup files. Report only the MATCH lines and VERIFIED status.'
} catch {
    Write-Host ('STOPPED during: ' + $script:phase)
    # Never print arbitrary external exception details or captured PostgreSQL output.
    if ($script:sourceFrozen) {
        Write-Host 'Ohio remains READ-ONLY. Do not turn off maintenance or switch DATABASE_URL.'
        Write-Host 'Rollback write freeze: rerun this script with -UnfreezeOhio, using the Ohio connection.'
    } else { Write-Host 'No Ohio write freeze was confirmed. Keep maintenance ON and report this phase.' }
    if ($script:backupDirectory) { Write-Host ('Private backup folder: ' + $script:backupDirectory) }
    exit 1
} finally {
    if ($source) { $source.Password = $null }; if ($target) { $target.Password = $null }
}
