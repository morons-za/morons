#!/usr/bin/env node

const axios = require('axios');

async function checkHealth(url, maxRetries = 30, delay = 10000) {
  console.log(`🔍 Checking health of ${url}`);
  
  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await axios.get(`${url}/health`, { timeout: 5000 });
      
      if (response.status === 200 && response.data.status === 'ok') {
        console.log(`✅ Service is healthy!`);
        console.log(`📊 Flights: ${response.data.flights}, Helicopters: ${response.data.helicopters}`);
        console.log(`⏱️ Uptime: ${Math.round(response.data.uptime)}s`);
        return true;
      }
    } catch (error) {
      console.log(`🔄 Attempt ${i + 1}/${maxRetries} failed: ${error.message}`);
    }
    
    if (i < maxRetries - 1) {
      console.log(`⏳ Waiting ${delay/1000}s before next check...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  console.log(`❌ Service failed health checks after ${maxRetries} attempts`);
  return false;
}

const url = process.argv[2] || 'https://heli-map.onrender.com';
checkHealth(url).then(success => {
  process.exit(success ? 0 : 1);
}); 