# IELTS Practice — local Docker demo

This package runs the web app/API, Postgres, LiveKit and the examiner worker on
**the same computer as your browser**. No source checkout or local Node/Python
installation is needed. The app image includes the generated Speaking/Writing
question bank and seeds it automatically. Your recordings stay in a Docker volume.

## Start

1. Install and start **Docker Desktop** (Windows/macOS) or Docker Engine with
   **Compose v2** (Linux). Windows must use Linux containers.
2. Extract the entire ZIP to a writable folder. Do not run from inside the ZIP.
3. Copy `.env.example` to `.env` and paste your **OpenRouter** and **Soniox** keys.
   Alternatively, run Start once and it creates `.env` for you. On Windows,
   enable file extensions so the file is not accidentally saved as `.env.txt`.
4. Run:
   - **Windows:** double-click `start.bat`.
   - **macOS:** open Terminal in this folder and run `sh start.sh`.
     `start.command` is also provided; Finder may require permission to open it.
   - **Linux:** run `sh start.sh` from this folder.
5. Wait for the images to download and services to become healthy. Open
   **http://localhost:8787** in Chrome/Edge and allow microphone access.
6. Sign in with the email/password in **`demo-login.txt`**, generated on first
   setup. Choose Speaking → live test. The demo account has no daily test quota.

Keep this installation's generated `.env`: its internal credentials and demo
password are reused across restarts. No R2, Resend, Cloudflare, domain, HTTPS
certificate, OpenAI key, LiveKit Cloud account or GPU is required for this bundle.

Starting containers, seeding questions and creating the login do not run paid
inference. Starting a live exam or submitting work for AI feedback uses the supplied
accounts and can incur charges. Internet access is required for providers and the
initial image download. The full call is not offline.

## Computer requirements

- Linux x86-64, Windows x86-64 with Docker Desktop, or macOS with Docker Desktop.
- The app and worker are pinned **Linux AMD64 images**. Apple Silicon uses Docker's
  AMD64 emulation; enable it if needed. This is slower and is not native ARM support.
  Windows ARM and other architectures are not a verified target.
- Start with **4 CPU cores and 6 GB RAM available to Docker**, plus several GB of
  free disk space for images, the database and recordings. These are planning
  allowances, not measured minimums; CPU speed affects live turn detection.
- Ports **8787, 7880 and 7881 (TCP), 7882 (UDP)** must be free on localhost.

## Included and separate content

The package uses pinned, publicly pullable app and worker image digests. It includes
the app's generated Speaking/Writing bank, live examiner, local recordings, scoring
and history. Existing production users, attempts, recordings and databases are not
copied. Listening/Reading archives and their media are separate from the app image;
their test lists remain empty unless content is imported. No paid content-generation
step runs at setup.

The demo account is preverified locally; no verification email is sent to a real
address. Other email flows use development logging rather than real delivery. Use
the supplied login instead of signing up for the hosted site.

## Stop, restart and preserve data

Run these commands **inside the extracted folder**:

```sh
docker compose down
```

This stops/removes containers but preserves the named database and recordings
volumes. Run Start again to restart. Do not delete `.env` or change the generated
credentials. Do not use `docker compose down -v` unless you intend to delete all
demo data. This Compose project is separate from other IELTS deployments.

## Troubleshooting

```sh
docker compose ps
docker compose logs --tail=100 app livekit worker
```

- **Cannot connect to Docker:** start Docker Desktop; Linux users need permission
  to use Docker. No app images are built on your computer.
- **Port already allocated:** stop the conflicting program or another copy of the
  demo. Changing only a published media port will break the preconfigured ICE path.
- **Image download fails:** check access to GHCR and Docker Hub. A corporate proxy
  may block them. The images are fetched by digest, not an unpinned `latest` tag.
- **Startup timeout:** check the logs and Docker's available memory. Re-run Start
  once the underlying problem is fixed; migrations and account setup are repeatable.
- **No microphone/audio:** use `http://localhost:8787`, not a LAN IP, a remote
  browser, or a Docker container address. Check browser permission, input/output
  device and VPN/firewall software. All media is forwarded through localhost.
- **Provider/auth/balance errors:** check the two keys, provider account balance
  and entitlement to the configured models. Then run Start again to apply changes.
- **Lost `.env` with existing data:** restore the original file. Generating new
  passwords does not update the existing Postgres password or demo login.

For a no-paid-inference installation check:

```sh
docker compose exec -T app node --import tsx /demo/check.mjs
```

It checks the demo login, question bank, signed local recording uploads/downloads,
and LiveKit's authenticated room API. It does not call Soniox/OpenRouter or prove
that a real examiner call works on your microphone/network.

## Why this is local-only

The app runs its existing development mode so local disk storage and email-free
setup work. All published ports bind to `127.0.0.1`. LiveKit and the worker share the
app's container network namespace, so internal localhost callbacks and media work
without host networking. The ICE address is deliberately `127.0.0.1`.

Do not expose this package on a public server or change the bindings to `0.0.0.0`.
Internet hosting needs a separate HTTPS, authentication, storage and public-media
configuration. Docker Desktop networking, Apple Silicon emulation and browser
behaviour still need verification on the recipient's actual machine.

## For the person sending this

From the repository root, run:

```sh
python3 scripts/package-local-demo.py
```

Send **`dist/ielts-practice-local-demo.zip`** and provide the two provider keys
separately. The packager includes only the named deployment files: never `.env`,
`demo-login.txt`, production data or source-checkout files. Images download on first
start; the ZIP is a deployment bundle, not an offline image archive. Rebuild the ZIP
after changing these files. Image version upgrades are explicit edits to `compose.yml`.
