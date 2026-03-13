# ReadingTracker - Proxmox Deployment Guide

Deploy ReadingTracker on a Proxmox VPS using Docker Compose, with Cloudflare Zero Trust for authentication.

## Prerequisites

- Proxmox VE host with available resources (1 CPU core, 1GB RAM minimum)
- A domain name with DNS managed by Cloudflare
- Cloudflare Zero Trust account (free tier works)
- MyAnimeList API Client ID ([register here](https://myanimelist.net/apiconfig))
- Git repo access (GitHub SSH key or HTTPS token)

---

## 1. Create an LXC Container on Proxmox

### Option A: Debian LXC (recommended, lightweight)

In the Proxmox web UI:

1. **Download template**: Local storage > CT Templates > Templates > download `debian-12-standard`
2. **Create CT**: Click "Create CT"
   - **Hostname**: `readingtracker`
   - **Password**: set a root password
   - **Template**: `debian-12-standard`
   - **Disk**: 8 GB (plenty for app + DB data)
   - **CPU**: 1 core
   - **Memory**: 1024 MB
   - **Network**: DHCP or static IP on your LAN (e.g. `vmbr0`, `192.168.1.50/24`)
   - **DNS**: use host settings or `1.1.1.1`
3. Under **Options**, check **Nesting** (required for Docker in LXC)
4. Start the container

### Option B: VM (if you prefer full isolation)

Create a Debian 12 VM with 1 CPU, 1GB RAM, 10GB disk. Everything below is the same.

### Enable nesting (LXC only)

If you forgot to check nesting during creation, enable it from the Proxmox host shell:

```bash
# On the Proxmox host (not inside the container)
pct set <CTID> --features nesting=1
pct restart <CTID>
```

---

## 2. Initial System Setup

SSH or open the console into your container/VM:

```bash
apt update && apt upgrade -y
apt install -y curl git ca-certificates gnupg
```

---

## 3. Install Docker

```bash
# Add Docker's official GPG key
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc

# Add the Docker repository
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  tee /etc/apt/sources.list.d/docker.list > /dev/null

# Install Docker
apt update
apt install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin

# Verify
docker --version
docker compose version
```

---

## 4. Clone the Repository

```bash
mkdir -p /opt
cd /opt
git clone https://github.com/<your-username>/ReadingTracker.git
cd ReadingTracker
```

If the repo is private, either:
- Use HTTPS with a personal access token: `git clone https://<token>@github.com/...`
- Or set up an SSH key: `ssh-keygen -t ed25519` and add the public key to GitHub

---

## 5. Configure Environment Variables

Create the production `.env` file:

```bash
cat > .env << 'EOF'
# Database password - change this to something strong
DB_PASSWORD=change_me_to_a_strong_password

# MyAnimeList API Client ID
# Get yours at https://myanimelist.net/apiconfig
MAL_CLIENT_ID=your_mal_client_id_here

# Optional: bind mount rip files to a host path
# RIPS_HOST_PATH=/opt/ReadingTracker/data/rips
EOF
```

```bash
chmod 600 .env
```

> **Note**: The production `docker-compose.prod.yml` constructs the full `DATABASE_URL` automatically using `DB_PASSWORD`. You only need to set `DB_PASSWORD` here, not the full connection string.

---

## 6. Build and Start

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

This will:
1. Build the Next.js app in a multi-stage Docker build
2. Start PostgreSQL 16 and wait for it to be healthy
3. Start the app on port 3000

Check that both containers are running:

```bash
docker compose -f docker-compose.prod.yml ps
```

Check logs if something looks wrong:

```bash
docker compose -f docker-compose.prod.yml logs -f app
docker compose -f docker-compose.prod.yml logs -f db
```

---

## 7. Run Database Migrations

The first time (and after any schema changes), run the Prisma migration:

```bash
docker compose -f docker-compose.prod.yml exec app npx prisma migrate deploy
```

Verify the health endpoint:

```bash
curl http://localhost:3000/api/health
```

You should get a `200 OK` response.

---

## 8. Set Up Cloudflare Zero Trust

ReadingTracker has **no built-in auth** -- it relies on Cloudflare Zero Trust to authenticate users and pass the `Cf-Access-Authenticated-User-Email` header.

### 8a. Create a Cloudflare Tunnel

1. Go to [Cloudflare Zero Trust dashboard](https://one.dash.cloudflare.com/)
2. Navigate to **Networks > Tunnels**
3. Click **Create a tunnel** > select **Cloudflared**
4. Name it `readingtracker`
5. Install the connector inside your LXC/VM:

```bash
# Install cloudflared
curl -L --output cloudflared.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
dpkg -i cloudflared.deb
rm cloudflared.deb

# Authenticate and install as a service (follow the token from the dashboard)
cloudflared service install <YOUR_TUNNEL_TOKEN>
```

6. Back in the dashboard, add a **Public hostname**:
   - **Subdomain**: `reading` (or whatever you prefer)
   - **Domain**: select your domain (e.g. `example.com`)
   - **Service**: `http://localhost:3000`

Your app is now accessible at `https://reading.example.com` via the tunnel.

### 8b. Create an Access Application

1. In Zero Trust dashboard, go to **Access > Applications**
2. Click **Add an application** > **Self-hosted**
3. Configure:
   - **Application name**: `ReadingTracker`
   - **Session duration**: 30 days (or your preference)
   - **Application domain**: `reading.example.com`
4. Add an **Access Policy**:
   - **Policy name**: `Allowed Users`
   - **Action**: Allow
   - **Include rule**: Emails -- add the 2-3 email addresses that should have access
5. Save

Now only your allowed users can access the app, and Cloudflare injects the `Cf-Access-Authenticated-User-Email` header automatically. The app's middleware reads this header to identify the current user.

---

## 9. Verify End-to-End

1. Open `https://reading.example.com` in your browser
2. Cloudflare should prompt you to authenticate (email OTP or SSO depending on your config)
3. After auth, you should see the ReadingTracker dashboard
4. Your user account is automatically created on first visit
5. Try adding a series via MAL search to verify the API key works

---

## Maintenance

### Update the app

```bash
cd /opt/ReadingTracker
git pull
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml exec app npx prisma migrate deploy
```

For schema/feature upgrades (including reader+rip rollout), follow `MIGRATION.md` first.

### View logs

```bash
# All services
docker compose -f docker-compose.prod.yml logs -f

# Just the app
docker compose -f docker-compose.prod.yml logs -f app
```

### Database backup

```bash
docker compose -f docker-compose.prod.yml exec db \
  pg_dump -U readingtracker readingtracker > backup_$(date +%Y%m%d).sql
```

### Database restore

```bash
docker compose -f docker-compose.prod.yml exec -T db \
  psql -U readingtracker readingtracker < backup_20260312.sql
```

### Restart services

```bash
docker compose -f docker-compose.prod.yml restart
```

### Full teardown (keeps database volume)

```bash
docker compose -f docker-compose.prod.yml down
```

### Full teardown including database data

```bash
docker compose -f docker-compose.prod.yml down -v
```

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| `app` container keeps restarting | Check logs: `docker compose -f docker-compose.prod.yml logs app`. Usually a missing env var or DB connection issue. |
| Database connection refused | Make sure the `db` service is healthy: `docker compose -f docker-compose.prod.yml ps`. Check that `DB_PASSWORD` in `.env` matches. |
| MAL search returns no results | Verify `MAL_CLIENT_ID` is set correctly in `.env`. Test: `curl -H "X-MAL-CLIENT-ID: <your_id>" "https://api.myanimelist.net/v2/manga?q=one+piece&limit=1"` |
| User not recognized / "unknown user" | Make sure Cloudflare Access is configured and the tunnel is routing correctly. The app reads `Cf-Access-Authenticated-User-Email` header. |
| Prisma migration fails | Check that the DB is running and `DATABASE_URL` resolves. Inside the container: `npx prisma migrate status` |
| Docker won't start in LXC | Enable nesting: `pct set <CTID> --features nesting=1` on the Proxmox host, then restart the container. |
| Port 3000 not reachable from LAN | The app only needs to be reachable by `cloudflared` running on the same host. If you also want direct LAN access, check your Proxmox firewall rules. |
