#!/bin/bash
echo "🔄 Hot reloading server metadata..."
curl -s -X POST http://localhost:3000/hot-reload | jq '.message // .error // .' 