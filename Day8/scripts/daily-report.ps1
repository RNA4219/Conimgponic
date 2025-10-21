param(
  [Parameter(Mandatory=$true)][string]$Root,
  [Parameter(Mandatory=$true)][string[]]$ReposFull,
  [switch]$CommitToRepo
)

$ErrorActionPreference = 'Stop'
$tz = [System.TimeZoneInfo]::FindSystemTimeZoneById('Tokyo Standard Time')
$nowJst = [System.TimeZoneInfo]::ConvertTime([datetime]::UtcNow, $tz)
$yesterday = $nowJst.Date.AddDays(-1)
$startJst = Get-Date -Date $yesterday -Format 'yyyy-MM-ddT00:00:00zzz'
$endJst = Get-Date -Date $yesterday.AddDays(1).AddSeconds(-1) -Format 'yyyy-MM-ddT23:59:59zzz'
$stamp = Get-Date -Date $nowJst -Format 'yyyyMMdd-HHmm'
$out = Join-Path $Root "logs/$stamp"
$detailsDir = Join-Path $out 'details'
New-Item -ItemType Directory -Force -Path $detailsDir | Out-Null
if ($env:GITHUB_TOKEN) {
  git config --global url."https://$($env:GITHUB_TOKEN)@github.com/".insteadOf 'https://github.com/'
}
$pathspec = @(
  '.', ':(exclude)node_modules/**', ':(exclude)dist/**', ':(exclude)build/**', ':(exclude).next/**',
  ':(exclude)coverage/**', ':(exclude)**/*.min.*', ':(exclude)**/*.map', ':(exclude)**/*.lock',
  ':(exclude)**/*.svg', ':(exclude)**/__snapshots__/**'
)
$bag = [System.Collections.Concurrent.ConcurrentBag[object]]::new()
$worker = {
  param($full,$Root,$start,$end,$pathspec,$detailsDir)
  function Get-DefaultBranch {
    param($dir)
    $ref = (& git -C $dir symbolic-ref --quiet refs/remotes/origin/HEAD 2>$null)
    if ($LASTEXITCODE -eq 0 -and $ref) { return ($ref -replace 'refs/remotes/origin/','') }
    $heads = (& git -C $dir branch -r) -join "`n"
    if ($heads -match 'origin/main') { return 'main' }
    if ($heads -match 'origin/master') { return 'master' }
    'main'
  }
  $owner,$name = $full -split '/'
  $dir = Join-Path $Root $name
  if (-not (Test-Path $dir)) {
    git clone --filter=blob:none --quiet "https://github.com/$owner/$name.git" $dir | Out-Null
  } else {
    git -C $dir fetch --all --prune --quiet | Out-Null
  }
  $branch = Get-DefaultBranch $dir
  $logArgs = @('--no-merges', "--since=$start", "--until=$end", '--pretty=format:%H,%ad,"%s",%an', '--date=iso-strict', "origin/$branch", '--') + $pathspec
  $commitsRaw = git -C $dir log @logArgs
  $commitCount = if ($commitsRaw) { ($commitsRaw -split "`n").Count } else { 0 }
  $fileArgs = @('--no-merges', "--since=$start", "--until=$end", '--pretty=tformat:', '--name-only', "origin/$branch", '--') + $pathspec
  $files = git -C $dir log @fileArgs | Where-Object { $_ } | Sort-Object -Unique
  $adds = 0; $dels = 0
  $numArgs = @('--no-merges', "--since=$start", "--until=$end", '--format=tformat:', '--numstat', "origin/$branch", '--') + $pathspec
  git -C $dir log @numArgs | ForEach-Object {
    if ($_ -match '^(\s*)(\d+|-)(\s+)(\d+|-)(\s+)(.+)$') {
      if ($matches[2] -ne '-') { $adds += [int]$matches[2] }
      if ($matches[4] -ne '-') { $dels += [int]$matches[4] }
    }
  }
  $commitPath = Join-Path $detailsDir "$name-commits.csv"
  'hash,date,subject,author' | Set-Content -Encoding UTF8 $commitPath
  if ($commitsRaw) { ($commitsRaw -split "`n") | Add-Content -Encoding UTF8 $commitPath }
  $filesPath = Join-Path $detailsDir "$name-files.csv"
  'file' | Set-Content -Encoding UTF8 $filesPath
  if ($files) { $files | Add-Content -Encoding UTF8 $filesPath }
  $fileCount = if ($files) { $files.Count } else { 0 }
  $bag.Add([pscustomobject]@{ Repo=$name; Commits=$commitCount; Files=$fileCount; Additions=$adds; Deletions=$dels; Net=$adds-$dels })
}
$ReposFull | ForEach-Object -Parallel $worker -ThrottleLimit 4 -ArgumentList $Root,$startJst,$endJst,$pathspec,$detailsDir | Out-Null
$rows = $bag.ToArray() | Sort-Object Repo
$totals = @{ Commits=0; Files=0; Additions=0; Deletions=0 }
foreach ($key in $totals.Keys) { $totals[$key] = ($rows | Measure-Object $key -Sum).Sum }
$totals['Net'] = $totals['Additions'] - $totals['Deletions']
$csvPath = Join-Path $out 'summary.csv'
$mdPath = Join-Path $out 'summary.md'
$rows | Export-Csv -NoTypeInformation -Encoding UTF8 $csvPath
$md = @("# 24時間アクティビティ ($startJst ～ $endJst)", '', "- **Commits:** $($totals['Commits'])", "- **Files changed:** $($totals['Files'])", "- **Additions / Deletions / Net:** $($totals['Additions']) / $($totals['Deletions']) / $($totals['Net'])", '', '| Repo | Commits | Files | + | - | Net |', '|---|---:|---:|---:|---:|---:|')
foreach ($row in ($rows | Sort-Object Commits -Descending)) {
  $md += "| $($row.Repo) | $($row.Commits) | $($row.Files) | $($row.Additions) | $($row.Deletions) | $($row.Net) |"
}
$md += ''
$md += '> 除外: node_modules/dist/build/.next/coverage/*.min.*/*.map/*.lock/*.svg/__snapshots__'
$md -join "`n" | Set-Content -Encoding UTF8 $mdPath
if ($CommitToRepo) {
  Set-Location $PSScriptRoot
  git config user.name 'github-actions[bot]'
  git config user.email '41898282+github-actions[bot]@users.noreply.github.com'
  $dst = Join-Path 'reports' (Get-Date -Date $yesterday -Format 'yyyyMMdd')
  New-Item -ItemType Directory -Force -Path $dst | Out-Null
  Copy-Item $csvPath (Join-Path $dst 'summary.csv') -Force
  Copy-Item $mdPath (Join-Path $dst 'summary.md') -Force
  git add $dst
  git commit -m "chore(report): daily activity $(Get-Date -Date $nowJst -Format 'yyyy-MM-dd') (JST)" || Write-Host 'no changes'
  git push
}
Write-Host "Done: $out" -ForegroundColor Green
