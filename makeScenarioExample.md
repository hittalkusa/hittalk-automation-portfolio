# Make.com Automation Example: Momentum Engine

Automated artist analytics workflow that processes track submissions and delivers engagement reports across multiple platforms.

## Workflow Steps

**Trigger:** Webhook from Wix receives track URL

**Data Collection Module:**
- Chartmetric API → Spotify streams, followers, playlist adds
- SoundCloud API → plays, favorites, reposts, comments
- Deezer API → listeners, shares

**Processing Module:**
- Momentum Score calculation (65–88 range based on engagement velocity)
- Replay Probability (listener retention patterns)
- Viral Lift (growth acceleration metrics)
- Engagement Rate: `(Favorites + Comments + Reposts) ÷ Total Plays`

**Delivery Module:**
- Wix Chat → Full analytics report posted to artist dashboard
- SoundCloud → Comment on track with score + 3 action steps
- Instagram/Facebook → Reply with CTA linking to hitta.lk/join

## Technical Details

**Scenario count:** 20+ active workflows in production  
**Processing volume:** ~60 tracks/month  
**Average runtime:** 15–30 seconds per track  
**Error handling:** Retry logic on API failures, fallback to cached data

**APIs integrated:**
- Chartmetric (music analytics)
- SoundCloud API v2
- Deezer Public API
- Wix Data Collections
- Meta Graph API (Instagram/Facebook)
- Twilio (SMS notifications)

## Business Impact

Replaced manual analyst work (2–3 hours/day) with 100% automated processing. Artists receive engagement reports within 30 seconds of submission.


https://github.com/user-attachments/assets/7911dfc6-7a6e-474e-af0a-c69ef9aa52c4
