#!/usr/bin/env bash
set -euo pipefail

echo "=== Workshop Setup ==="

# Check prerequisites
echo "Checking prerequisites..."

if ! command -v node &> /dev/null; then
  echo "ERROR: node is not installed"
  exit 1
fi

if ! command -v npm &> /dev/null; then
  echo "ERROR: npm is not installed"
  exit 1
fi

if ! command -v tmux &> /dev/null; then
  echo "WARNING: tmux is not installed. Terminal sessions will not work."
  echo "  Install with: brew install tmux"
fi

if ! command -v claude &> /dev/null; then
  echo "WARNING: claude CLI is not installed. Claude sessions will not work."
fi

# Install dependencies
echo "Installing dependencies..."
npm install

echo ""
echo "=== Setup complete ==="
echo "Run 'npm run dev' to start the development server."
