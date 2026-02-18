#!/bin/bash
set -e

# ================================================
# Deploy Ivy Prep Tutor to Oracle Cloud VM
# Usage: ./deploy.sh <server-ip> [ssh-key-path]
# Example: ./deploy.sh 129.146.x.x ~/.ssh/oracle_key
# ================================================

SERVER_IP="$1"
SSH_KEY="${2:-~/.ssh/id_rsa}"
SSH_USER="ubuntu"
REMOTE_DIR="/home/ubuntu/ivy-prep-bot"

if [ -z "$SERVER_IP" ]; then
  echo "Usage: ./deploy.sh <server-ip> [ssh-key-path]"
  echo "Example: ./deploy.sh 129.146.1.2 ~/.ssh/oracle_key"
  exit 1
fi

SSH_CMD="ssh -i $SSH_KEY -o StrictHostKeyChecking=no $SSH_USER@$SERVER_IP"
SCP_CMD="scp -i $SSH_KEY -o StrictHostKeyChecking=no"

echo "==> Deploying to $SERVER_IP..."

# Step 1: Install Docker on the server if not present
echo "==> Ensuring Docker is installed..."
$SSH_CMD << 'REMOTE_SCRIPT'
if ! command -v docker &> /dev/null; then
  echo "Installing Docker..."
  sudo apt-get update
  sudo apt-get install -y ca-certificates curl gnupg
  sudo install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  sudo chmod a+r /etc/apt/keyrings/docker.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
  sudo apt-get update
  sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
  sudo usermod -aG docker $USER
  sudo systemctl enable docker
  echo "Docker installed!"
else
  echo "Docker already installed."
fi
REMOTE_SCRIPT

# Step 2: Create remote directory
echo "==> Creating remote directory..."
$SSH_CMD "mkdir -p $REMOTE_DIR/data $REMOTE_DIR/commands"

# Step 3: Upload project files
echo "==> Uploading project files..."
$SCP_CMD Dockerfile "$SSH_USER@$SERVER_IP:$REMOTE_DIR/"
$SCP_CMD docker-compose.yml "$SSH_USER@$SERVER_IP:$REMOTE_DIR/"
$SCP_CMD .dockerignore "$SSH_USER@$SERVER_IP:$REMOTE_DIR/"
$SCP_CMD package.json "$SSH_USER@$SERVER_IP:$REMOTE_DIR/"
$SCP_CMD package-lock.json "$SSH_USER@$SERVER_IP:$REMOTE_DIR/"
$SCP_CMD tsconfig.json "$SSH_USER@$SERVER_IP:$REMOTE_DIR/"
$SCP_CMD bot.ts "$SSH_USER@$SERVER_IP:$REMOTE_DIR/"
$SCP_CMD .env "$SSH_USER@$SERVER_IP:$REMOTE_DIR/"

# Upload commands directory
$SCP_CMD commands/*.ts "$SSH_USER@$SERVER_IP:$REMOTE_DIR/commands/"

# Upload data directory (presets, tickets, config, logos)
$SCP_CMD -r data/ "$SSH_USER@$SERVER_IP:$REMOTE_DIR/data/"

# Step 4: Build and start
echo "==> Building and starting the bot..."
$SSH_CMD << REMOTE_START
cd $REMOTE_DIR
sudo docker compose down 2>/dev/null || true
sudo docker compose up -d --build
echo ""
echo "==> Waiting for bot to start..."
sleep 5
sudo docker compose logs --tail=20
REMOTE_START

echo ""
echo "==> Deploy complete! Bot should be running on $SERVER_IP"
echo "==> Check logs: ssh -i $SSH_KEY $SSH_USER@$SERVER_IP 'cd $REMOTE_DIR && sudo docker compose logs -f'"
