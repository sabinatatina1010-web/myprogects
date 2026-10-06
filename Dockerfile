FROM mcr.microsoft.com/powershell:lts-ubuntu-22.04

RUN apt-get update \
    && apt-get install -y --no-install-recommends libsqlite3-0 sqlite3 ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && src="$(find /usr/lib -name 'libsqlite3.so.0' | head -n 1)" \
    && test -n "$src" \
    && ln -sfn "$src" /usr/lib/libsqlite3.so.0

WORKDIR /app
COPY . .
# Keep the database out of the web root. Checkpoint folds the WAL into one file
# so the first container start does not depend on a split sqlite+wal pair.
RUN mkdir -p /seed /app/data \
    && if [ -f /app/crm.sqlite ]; then mv /app/crm.sqlite /seed/crm.sqlite; fi \
    && if [ -f /app/crm.sqlite-wal ]; then mv /app/crm.sqlite-wal /seed/crm.sqlite-wal; fi \
    && if [ -f /seed/crm.sqlite ]; then sqlite3 /seed/crm.sqlite "PRAGMA wal_checkpoint(TRUNCATE);"; fi \
    && rm -f /seed/crm.sqlite-wal /seed/crm.sqlite-shm /app/crm.sqlite-shm

ENV PORT=8131 \
    BIND_HOST=* \
    SABINA_DATA_DIR=/app/data

EXPOSE 8131

HEALTHCHECK --interval=30s --timeout=15s --start-period=40s --retries=3 \
  CMD ["pwsh", "-NoProfile", "-Command", "try { $r = Invoke-WebRequest -Uri http://127.0.0.1:8131/index.html -UseBasicParsing -TimeoutSec 8; if ($r.StatusCode -ne 200) { exit 1 } } catch { exit 1 }"]

ENTRYPOINT ["pwsh", "-NoProfile", "-File", "/app/docker-entrypoint.ps1"]
