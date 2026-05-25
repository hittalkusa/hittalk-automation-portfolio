# Hit Talk Automation Portfolio

Code samples from **Hit Talk** (hittalk.net) — a music industry platform built with Wix Velo, Make.com, and Node.js automation.

## What's in this repo

### `couponManager.jsw`
Wix Velo backend module for referral code generation and validation. Handles:
- Unique slug availability checking
- Member data updates via wixData API
- Custom field management (Cash App/Venmo/PayPal handles)

### `makeScenarioExample.md`
Make.com workflow that automates artist report generation:
- Pulls data from Spotify, SoundCloud, Chartmetric APIs
- Calculates Momentum Score and engagement metrics
- Delivers reports via Wix Chat and social media comments

### `ffmpegProcessor.js`
Node.js server (via ngrok) that processes audio files:
- Downloads tracks from Google Drive
- Applies FFmpeg effects (normalize, crossfade, ID3 tagging)
- Uploads processed files back to shared drive
- Integrates with Apple Music via AppleScript

## Tech Stack

- **Wix Velo:** Backend .jsw modules, dataset automation, webhook triggers
- **Make.com:** 20+ automation scenarios, multi-platform integrations
- **Node.js:** API processing, FFmpeg audio handling, Google Drive API
- **APIs:** Chartmetric, Twilio, ElevenLabs, Google Workspace

## Live Platform

Visit **[hittalk.net](https://hittalk.net)** to see the platform in action.

## Contact

Available for Wix automation, Make.com workflows, and API integration projects.
