$ErrorActionPreference = 'Stop'
try {
    docker info *> $null
    if ($LASTEXITCODE -ne 0) { throw 'Install/start Docker Desktop with Linux containers, then try again.' }
    docker compose version
    if ($LASTEXITCODE -ne 0) { throw 'Docker Compose v2 is required.' }
    docker run --rm --mount "type=bind,source=$PSScriptRoot,target=/bundle" node:24-alpine node /bundle/setup.mjs
    if ($LASTEXITCODE -ne 0) { throw 'Edit .env as instructed above, then run Start again.' }
    docker compose --project-directory "$PSScriptRoot" -f "$PSScriptRoot/compose.yml" up -d --wait --wait-timeout 300
    if ($LASTEXITCODE -ne 0) { throw 'Startup failed. See README.md for the logs command.' }
    docker compose --project-directory "$PSScriptRoot" -f "$PSScriptRoot/compose.yml" exec -T app node --import tsx /demo/initialize.mjs
    if ($LASTEXITCODE -ne 0) { throw 'Demo account setup failed. See README.md for troubleshooting.' }
    Write-Host "Ready: http://localhost:8787`nSign-in details: $PSScriptRoot/demo-login.txt"
} catch {
    Write-Host $_ -ForegroundColor Red
    exit 1
}
