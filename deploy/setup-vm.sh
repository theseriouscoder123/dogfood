#!/usr/bin/env bash
# One-time setup of the public demo on a fresh Ubuntu VM (made for Oracle Cloud's Always Free
# Ampere A1 machine, but any Ubuntu 22.04/24.04 box with ports 80 and 443 reachable works).
# Run from the repository folder:   bash deploy/setup-vm.sh
set -euo pipefail
cd "$(dirname "$0")/.."
REPO="$(pwd)"

echo "==> Installing Docker"
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sudo sh
  sudo usermod -aG docker "$USER" || true
fi

echo "==> Opening ports 80 and 443 in the VM's own firewall"
# Oracle's Ubuntu images ship iptables rules that reject everything but SSH. The cloud-side
# security list must allow 80 and 443 too (see "Live demo" in README.md).
for port in 80 443; do
  if ! sudo iptables -C INPUT -p tcp --dport "$port" -m state --state NEW -j ACCEPT 2>/dev/null; then
    # Insert above the image's catch-all REJECT rule (its position differs between images).
    pos="$(sudo iptables -L INPUT --line-numbers | awk '$2 == "REJECT" {print $1; exit}')"
    sudo iptables -I INPUT "${pos:-1}" -p tcp --dport "$port" -m state --state NEW -j ACCEPT
  fi
done
if command -v netfilter-persistent >/dev/null 2>&1; then sudo netfilter-persistent save; fi

echo "==> Working out the public address"
IP="${PUBLIC_IP:-$(curl -fsS https://api.ipify.org)}"
DEMO_HOST="${DEMO_HOST:-${IP//./-}.sslip.io}"
echo "DEMO_HOST=$DEMO_HOST" > .env
echo "    $DEMO_HOST"

echo "==> Building and starting (the first build takes a few minutes)"
sudo docker compose -f docker-compose.yml -f deploy/docker-compose.demo.yml up -d --build

echo "==> Scheduling a reset to fresh demo data every 6 hours"
chmod +x deploy/reset-demo.sh
echo "0 */6 * * * root cd $REPO && ./deploy/reset-demo.sh >> /var/log/verdict-demo-reset.log 2>&1" | sudo tee /etc/cron.d/verdict-demo-reset >/dev/null

cat <<EOF

Done. In a minute or two (first start seeds the demo data and fetches HTTPS certificates):
  Portal:            https://$DEMO_HOST
  Emails (Mailpit):  https://mail.$DEMO_HOST
  Webhook receiver:  https://hooks.$DEMO_HOST
Logs:  sudo docker compose -f docker-compose.yml -f deploy/docker-compose.demo.yml logs -f api caddy
EOF
