
Param(
  [string]$Dir = "."
)
node "$PSScriptRoot/rename.mjs" $Dir
Write-Host "Rename complete. Rebuild & reinstall PWA to see the new name."
