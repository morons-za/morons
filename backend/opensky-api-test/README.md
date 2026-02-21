# OpenSky API Testing

This folder contains experimental code for testing the OpenSky Network API as a potential data source for automated helicopter tracking.

## Contents

- **opensky-test.html** - Test page to verify OpenSky API credentials and connectivity

## How to Use

1. **Get OpenSky Credentials:**
   - Create account at https://opensky-network.org/
   - Go to your account page: https://opensky-network.org/my-opensky
   - Create an API Client (bottom right section)
   - Download the `credentials.json` file

2. **Test Connection:**
   ```bash
   open backend/opensky-api-test/opensky-test.html
   ```
   - Upload your `credentials.json` file, OR
   - Manually enter your client_id and client_secret
   - Click "Test Connection"

3. **Check Results:**
   - Verify authentication works
   - See your rate limit (4000 credits/day for authenticated users)
   - Optionally test if any South African aircraft are currently flying

## Rate Limits

- **Anonymous**: 400 credits/day
- **Authenticated**: 4000 credits/day
- **Active Contributor** (feeding ADS-B data): 8000 credits/day

## Notes

- This is experimental testing only
- Not integrated with main helicopter tracking system yet
- OpenSky may have incomplete coverage for Cape Town area
- Historical data limited to 30 days
