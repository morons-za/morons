#!/bin/bash

# TMNP Helicopter Tracking System - Unified Launcher
# This script starts BOTH the backend admin server AND the static site server
# and opens both interfaces in your browser

cd "$(dirname "$0")"

echo "🚁 TMNP Helicopter Tracking System"
echo "===================================="
echo ""

# Check if Node.js is available
if ! command -v node &> /dev/null; then
    echo "❌ Node.js not found. Please install Node.js first."
    exit 1
fi

# Check if required files exist
if [ ! -f "backend/scripts/index-no-auth.cjs" ]; then
    echo "❌ Backend server script not found at backend/scripts/index-no-auth.cjs"
    exit 1
fi

if [ ! -f "backend/scripts/serve-static-site.cjs" ]; then
    echo "❌ Static site server script not found at backend/scripts/serve-static-site.cjs"
    exit 1
fi

echo "🔧 Checking ports and starting servers..."
echo ""

# Check if ports are already in use and offer to kill them
if lsof -i :4000 > /dev/null 2>&1; then
    echo "⚠️  Port 4000 is already in use"
    echo "   Killing existing process..."
    lsof -ti:4000 | xargs kill -9 2>/dev/null
    sleep 1
    echo "   ✅ Port 4000 is now free"
fi

if lsof -i :8080 > /dev/null 2>&1; then
    echo "⚠️  Port 8080 is already in use"
    echo "   Killing existing process..."
    lsof -ti:8080 | xargs kill -9 2>/dev/null
    sleep 1
    echo "   ✅ Port 8080 is now free"
fi

echo ""

# Function to handle cleanup
cleanup() {
    echo ""
    echo "🛑 Shutting down servers..."
    
    if [ ! -z "$BACKEND_PID" ]; then
        kill $BACKEND_PID 2>/dev/null
        echo "✅ Backend server stopped"
    fi
    
    if [ ! -z "$STATIC_PID" ]; then
        kill $STATIC_PID 2>/dev/null
        echo "✅ Static site server stopped"
    fi
    
    echo "👋 All servers stopped. Goodbye!"
    exit 0
}

# Set trap to handle Ctrl+C
trap cleanup INT TERM

# Start the backend server
echo "🚀 Starting backend admin server (port 4000)..."
cd backend
node scripts/index-no-auth.cjs > logs/server.log 2>&1 &
BACKEND_PID=$!
cd ..

# Wait a moment for backend to start
sleep 2

# Check if backend started successfully
if ps -p $BACKEND_PID > /dev/null; then
    echo "   ✅ Backend server started (PID: $BACKEND_PID)"
    echo "   📍 Admin interface: http://localhost:4000"
else
    echo "   ❌ Failed to start backend server"
    exit 1
fi

echo ""

# Start the static site server
echo "🌐 Starting static site server (port 8080)..."
cd backend/scripts
node serve-static-site.cjs > ../logs/static-site-server.log 2>&1 &
STATIC_PID=$!
cd ../..

# Wait a moment for static site to start
sleep 2

# Check if static site started successfully
if ps -p $STATIC_PID > /dev/null; then
    echo "   ✅ Static site server started (PID: $STATIC_PID)"
    echo "   📍 Public website: http://localhost:8080"
else
    echo "   ❌ Failed to start static site server"
    echo "   🛑 Stopping backend server..."
    kill $BACKEND_PID 2>/dev/null
    exit 1
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✨ Both servers are running!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "📋 Admin Interface (Backend):"
echo "   🔗 http://localhost:4000"
echo "   • Upload and process KML files"
echo "   • Generate PNG violation maps"
echo "   • Validate and optimize files"
echo "   • Build static site"
echo ""
echo "🌍 Public Website (Static Site):"
echo "   🔗 http://localhost:8080"
echo "   • View helicopter flights"
echo "   • Interactive violation map"
echo "   • Search and filter flights"
echo ""
echo "📝 Server Logs:"
echo "   • Backend: backend/logs/server.log"
echo "   • Static Site: backend/logs/static-site-server.log"
echo ""
echo "🔄 Press Ctrl+C to stop both servers"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Open both URLs in browser
sleep 1
echo "🌍 Opening both interfaces in your browser..."

if command -v open &> /dev/null; then
    # macOS
    open "http://localhost:4000"
    sleep 1
    open "http://localhost:8080"
elif command -v xdg-open &> /dev/null; then
    # Linux
    xdg-open "http://localhost:4000" &
    sleep 1
    xdg-open "http://localhost:8080" &
else
    echo "📱 Please open these URLs manually:"
    echo "   • Backend: http://localhost:4000"
    echo "   • Static Site: http://localhost:8080"
fi

echo ""
echo "✅ System ready! Both servers are running."
echo ""

# Keep script running and wait for either process to exit
wait $BACKEND_PID $STATIC_PID

