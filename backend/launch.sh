#!/bin/bash

# Helicopter KML Server Launcher
# This script starts the backend server and opens the interface

cd "$(dirname "$0")"

echo "🚁 Helicopter KML Server Launcher"
echo "=================================="

# Check if Node.js is available
if ! command -v node &> /dev/null; then
    echo "❌ Node.js not found. Please install Node.js first."
    exit 1
fi

# Check if the server script exists
if [ ! -f "scripts/index-no-auth.cjs" ]; then
    echo "❌ Server script not found at scripts/index-no-auth.cjs"
    exit 1
fi

echo "🔧 Starting backend server..."

# Function to handle cleanup
cleanup() {
    echo ""
    echo "🛑 Shutting down server..."
    kill $SERVER_PID 2>/dev/null
    echo "✅ Server stopped"
    exit 0
}

# Set trap to handle Ctrl+C
trap cleanup INT TERM

# Start the server in background
node scripts/index-no-auth.cjs &
SERVER_PID=$!

# Wait a moment for server to start
sleep 1

# Check if server started successfully
if ps -p $SERVER_PID > /dev/null; then
    echo "✅ Server started successfully (PID: $SERVER_PID)"
    echo "🌐 Server URL: http://localhost:4000"
    
    # Server starts much faster now - no heavy KML scanning
    echo "⚙️ Server ready (metadata loaded from cache files)"
    
    # Open the server URL in default browser
    if command -v open &> /dev/null; then
        echo "🌍 Opening browser..."
        open "http://localhost:4000"
    elif command -v xdg-open &> /dev/null; then
        echo "🌍 Opening browser..."
        xdg-open "http://localhost:4000"
    else
        echo "📱 Please open http://localhost:4000 in your browser"
    fi
    
    echo ""
    echo "📋 Available actions:"
    echo "   • Upload KML files via drag & drop"
    echo "   • Process and optimize KML files"
    echo "   • Validate file status"
    echo "   • View metadata and uploads"
    echo ""
    echo "🔄 Press Ctrl+C to stop the server"
    
    # Wait for server process
    wait $SERVER_PID
else
    echo "❌ Failed to start server"
    exit 1
fi