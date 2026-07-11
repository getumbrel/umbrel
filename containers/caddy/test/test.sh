#!/bin/bash

# Test script for Caddy HTTPS proxy integration
# This script tests the basic functionality of the Caddy reverse proxy

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "🔧 Setting up Caddy test environment..."

# Create test certificates directory
mkdir -p certs

# Generate test certificates if they don't exist
if [ ! -f certs/test.crt ] || [ ! -f certs/test.key ]; then
    echo "📜 Generating test certificates..."
    openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
        -keyout certs/test.key \
        -out certs/test.crt \
        -subj "/CN=umbrel.local/O=Umbrel Test/C=US" \
        -addext "subjectAltName=DNS:umbrel.local,DNS:localhost,IP:127.0.0.1" \
        2>/dev/null
    echo "✓ Certificates generated"
else
    echo "✓ Certificates already exist"
fi

# Clean up any existing containers
echo "🧹 Cleaning up existing containers..."
docker compose down --remove-orphans 2>/dev/null || true

# Start test environment
echo "🚀 Starting test environment..."
docker compose up -d

# Wait for containers to be ready
echo "⏳ Waiting for containers to start..."
sleep 5

# Check container health
echo "🏥 Checking container health..."
docker compose ps

# Test HTTP to HTTPS redirect
echo ""
echo "🌐 Testing HTTP to HTTPS redirect..."
HTTP_RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:8080/)
if [ "$HTTP_RESPONSE" = "301" ]; then
    echo "✓ HTTP redirect working (status: $HTTP_RESPONSE)"
else
    echo "✗ HTTP redirect failed (status: $HTTP_RESPONSE)"
fi

# Test HTTPS access
echo ""
echo "🔒 Testing HTTPS access..."
HTTPS_RESPONSE=$(curl -sk -o /dev/null -w "%{http_code}" https://localhost:8443/)
if [ "$HTTPS_RESPONSE" = "200" ]; then
    echo "✓ HTTPS access working (status: $HTTPS_RESPONSE)"
else
    echo "✗ HTTPS access failed (status: $HTTPS_RESPONSE)"
fi

# Test app1 routing
echo ""
echo "📱 Testing app1 routing..."
APP1_RESPONSE=$(curl -sk -o /dev/null -w "%{http_code}" https://localhost:8443/app1/)
if [ "$APP1_RESPONSE" = "200" ]; then
    echo "✓ App1 routing working (status: $APP1_RESPONSE)"
else
    echo "✗ App1 routing failed (status: $APP1_RESPONSE)"
fi

# Test app2 routing
echo ""
echo "📱 Testing app2 routing..."
APP2_RESPONSE=$(curl -sk -o /dev/null -w "%{http_code}" https://localhost:8443/app2/)
if [ "$APP2_RESPONSE" = "200" ]; then
    echo "✓ App2 routing working (status: $APP2_RESPONSE)"
else
    echo "✗ App2 routing failed (status: $APP2_RESPONSE)"
fi

# Test security headers
echo ""
echo "🔐 Testing security headers..."
HEADERS=$(curl -sk -I https://localhost:8443/)
if echo "$HEADERS" | grep -q "Strict-Transport-Security"; then
    echo "✓ HSTS header present"
else
    echo "✗ HSTS header missing"
fi

if echo "$HEADERS" | grep -q "X-Frame-Options"; then
    echo "✓ X-Frame-Options header present"
else
    echo "✗ X-Frame-Options header missing"
fi

# Show certificate info
echo ""
echo "📋 Certificate information:"
echo | openssl s_client -connect localhost:8443 -servername umbrel.local 2>/dev/null | \
    openssl x509 -noout -subject -issuer -dates 2>/dev/null || echo "Could not retrieve certificate info"

echo ""
echo "✅ Caddy integration tests completed!"
echo ""
echo "To access the test server:"
echo "  - Main: https://localhost:8443/"
echo "  - App1: https://localhost:8443/app1/"
echo "  - App2: https://localhost:8443/app2/"
echo ""
echo "To clean up, run: docker compose down"
