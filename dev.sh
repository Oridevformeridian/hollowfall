#!/bin/bash

# Exit on error
set -e

echo "============================================="
echo "   Hollowfall Dev Server Manager"
echo "============================================="

# Function to kill processes on a port
kill_port() {
  local port=$1
  local pid
  pid=$(lsof -t -i:"$port" || true)
  if [ -n "$pid" ]; then
    echo "Killing process $pid on port $port..."
    kill -9 "$pid" 2>/dev/null || true
  fi
}

echo "Stopping any running dev processes..."
kill_port 3000
kill_port 3001

# Also kill by process pattern to be thorough
pkill -f "ts-node src/index.ts" 2>/dev/null || true
pkill -f "vite" 2>/dev/null || true

echo "Starting backend server (port 3001)..."
npm run dev --prefix server &
SERVER_PID=$!

echo "Starting client Vite server (port 3000)..."
npm run dev --prefix client &
CLIENT_PID=$!

echo "---------------------------------------------"
echo "Servers are running!"
echo "  - Client: http://localhost:3000"
echo "  - Server: http://localhost:3001"
echo "Press Ctrl+C to terminate both servers."
echo "---------------------------------------------"

# Handle cleanup on exit
cleanup() {
  echo ""
  echo "Stopping servers..."
  kill "$SERVER_PID" "$CLIENT_PID" 2>/dev/null || true
  echo "Done."
}

trap cleanup INT TERM EXIT

# Wait for background processes
wait
