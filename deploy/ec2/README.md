# EC2 + Nginx deployment notes

This folder contains production stubs for hosting the Myco Quest backend on EC2.

## Files

- `deploy.sh` - pull latest `main` and restart Docker Compose services.
- `nginx.kingmyco.io.conf` - reverse-proxy config for API/webhook routes.
- `systemd/kingmyco-stack.service` - systemd unit to keep Docker Compose services alive.

## Quick setup

1. Clone repo to `/opt/kingmyco`.
2. Copy `.env.example` to `/opt/kingmyco/.env` and fill production secrets.
3. Install Docker + Docker Compose plugin.
4. Run:
   - `cd /opt/kingmyco`
   - `docker compose --env-file .env up -d --build api heartbeat-worker`
   - `docker compose --env-file .env --profile settlement up -d settlement-worker`
5. Install Nginx and place `nginx.kingmyco.io.conf` under `sites-available`.
6. Enable TLS (Let's Encrypt or your existing certificate manager).

For unattended restarts, install `systemd/kingmyco-stack.service` into `/etc/systemd/system/`.
