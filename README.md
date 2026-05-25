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

### `processor.js`
Production Node.js server handling audio/video processing for Hit Talk platform. Runs locally via ngrok and processes requests from Wix frontend.

**Features:**
- **Audio mixer engine** with EQ, compression, reverb, crossfade (FFmpeg)
- **Google Drive API** integration for file storage and retrieval
- **Multi-track mixtape processing** (up to 7 tracks with crossfade)
- **ID3 tagging** and Apple Music auto-import via AppleScript
- **Social clip generation** (9:16 vertical video with blur pad backgrounds)
- **Job queue system** with status tracking and downloadable outputs

**API Endpoints:**
- `POST /api/tag-mp3` — Download, tag, and save MP3 with cover art
- `POST /api/mixtape` — Multi-track crossfade mixer (gated to paid tiers)
- `POST /api/social-clip` — Generate 25-second vertical video audiogram
- `POST /api/full-clip` — Full-length video with waveform visualization
- `GET /api/status/:jobId` — Check processing status
- `GET /api/download/:jobId` — Stream completed files

**Tech:**
- FFmpeg for audio/video processing
- Google Drive API (OAuth service account)
- AppleScript for macOS Music.app integration
- CORS-enabled REST API via ngrok tunnel

## Tech Stack

- **Wix Velo:** Backend .jsw modules, dataset automation, webhook triggers
- **Make.com:** 20+ automation scenarios, multi-platform integrations
- **Node.js:** API processing, FFmpeg audio handling, Google Drive API
- **APIs:** Chartmetric, Twilio, ElevenLabs, Google Workspace

## Live Platform

Visit **[hittalk.net](https://hittalk.net)** to see the platform in action.

## Contact

Available for Wix automation, Make.com workflows, and API integration projects.
