// Hit Talk Local Processor
// Node.js server for audio/video processing via FFmpeg
// Runs on Mac via ngrok, called by Wix frontend
// Portfolio version - sensitive paths removed

require('dotenv').config();

const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const { google } = require('googleapis');

// ─── CONFIG ────────────────────────────────────────────────────────────────
const WORK_DIR        = '/tmp/hit-talk-conversions';
const OUTPUT_DIR      = '/Users/teddytonite/Music/Music/Media.localized/Automatically Add to Music.localized';
const PUBLIC_URL      = process.env.PUBLIC_URL || 'http://localhost:3001';
const CREDS_PATH      = process.env.GOOGLE_CREDENTIALS_PATH;
const DRIVE_FOLDER_ID = process.env.GOOGLE_DRIVE_FOLDER_ID;

const DRIVE_BASE = process.env.DRIVE_BASE || '/path/to/google-drive';


const jobs = {};

// ─── SETUP DIRECTORIES ─────────────────────────────────────────────────────
[WORK_DIR, OUTPUT_DIR, DRIVE_BASE].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    console.log(`✓ Created directory: ${dir}`);
  }
});

// ─── GOOGLE DRIVE API ──────────────────────────────────────────────────────
let driveClient = null;

async function initGoogleDrive() {
  try {
    const credentials = JSON.parse(fs.readFileSync(CREDS_PATH, 'utf8'));
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/drive']
    });
    driveClient = google.drive({ version: 'v3', auth });
    console.log('✓ Google Drive API initialized');
  } catch (err) {
    console.warn('⚠️ Google Drive API init failed:', err.message);
  }
}

async function getOrCreateDriveFolderId(userId) {
  if (!driveClient || !DRIVE_FOLDER_ID) return null;
  try {
    const search = await driveClient.files.list({
      q: `name='${userId}' and '${DRIVE_FOLDER_ID}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
      fields: 'files(id, name)', spaces: 'drive',
      supportsAllDrives: true, includeItemsFromAllDrives: true, orderBy: 'createdTime desc'
    });
    if (search.data.files.length > 0) return search.data.files[0].id;

    const folder = await driveClient.files.create({
      requestBody: { name: userId, mimeType: 'application/vnd.google-apps.folder', parents: [DRIVE_FOLDER_ID] },
      fields: 'id', supportsAllDrives: true
    });
    try {
      await driveClient.permissions.create({
        fileId: folder.data.id,
        requestBody: { role: 'reader', type: 'anyone' }, supportsAllDrives: true
      });
    } catch (e) {}
    return folder.data.id;
  } catch (err) {
    console.warn('  ⚠️ getOrCreateDriveFolderId failed:', err.message);
    return null;
  }
}

async function uploadFileToDrive(filePath, fileName, folderId) {
  try {
    const file = await driveClient.files.create({
      requestBody: { name: fileName, parents: [folderId] },
      media: { mimeType: 'video/mp4', body: fs.createReadStream(filePath) },
      fields: 'id', supportsAllDrives: true
    });
    try {
      await driveClient.permissions.create({
        fileId: file.data.id, requestBody: { role: 'reader', type: 'anyone' }, supportsAllDrives: true
      });
    } catch (e) {}
    return file.data.id;
  } catch (err) {
    console.warn('  ⚠️ uploadFileToDrive failed:', err.message);
    return null;
  }
}

async function uploadFileToDriveAs(filePath, fileName, folderId, mimeType = 'application/octet-stream') {
  try {
    const file = await driveClient.files.create({
      requestBody: { name: fileName, parents: [folderId] },
      media: { mimeType, body: fs.createReadStream(filePath) },
      fields: 'id', supportsAllDrives: true
    });
    try {
      await driveClient.permissions.create({
        fileId: file.data.id, requestBody: { role: 'reader', type: 'anyone' }, supportsAllDrives: true
      });
    } catch (e) {}
    return file.data.id;
  } catch (err) {
    console.warn('  ⚠️ uploadFileToDriveAs failed:', err.message);
    return null;
  }
}

async function getOrCreateNestedDriveFolder(segments) {
  if (!driveClient || !DRIVE_FOLDER_ID) return null;
  let parentId = DRIVE_FOLDER_ID;
  for (const name of segments) {
    try {
      const search = await driveClient.files.list({
        q: `name='${name}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
        fields: 'files(id)', spaces: 'drive', supportsAllDrives: true, includeItemsFromAllDrives: true
      });
      if (search.data.files.length > 0) {
        parentId = search.data.files[0].id;
      } else {
        const created = await driveClient.files.create({
          requestBody: { name, mimeType: 'application/vnd.google-apps.folder', parents: [parentId] },
          fields: 'id', supportsAllDrives: true
        });
        parentId = created.data.id;
        console.log(`  ✓ Created Drive folder "${name}": ${parentId}`);
      }
    } catch (err) {
      console.warn(`  ⚠️ getOrCreateNestedDriveFolder failed at "${name}":`, err.message);
      return null;
    }
  }
  return parentId;
}

// ─── DOWNLOAD HELPER ───────────────────────────────────────────────────────
function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    const file = fs.createWriteStream(destPath);
    protocol.get(url, (response) => {
      if (response.statusCode === 301 || response.statusCode === 302) {
        file.close();
        return downloadFile(response.headers.location, destPath).then(resolve).catch(reject);
      }
      response.pipe(file);
      file.on('finish', () => { file.close(); resolve(); });
    }).on('error', (err) => { fs.unlink(destPath, () => {}); reject(err); });
  });
}

// ─── FFMPEG HELPER ─────────────────────────────────────────────────────────
function runFFmpeg(command) {
  return new Promise((resolve, reject) => {
    console.log('  Running FFmpeg:', command);
    exec(command, { timeout: 7200000 }, (error, stdout, stderr) => {
      if (error) { console.error('  FFmpeg error:', stderr); reject(new Error(stderr || error.message)); }
      else resolve(stdout);
    });
  });
}

// ─── APPLE MUSIC IMPORT ────────────────────────────────────────────────────
function importIntoAppleMusic(filePath) {
  return new Promise((resolve) => {
    const script = `tell application "Music" to add POSIX file "${filePath}"`;
    exec(`osascript -e '${script}'`, (error, stdout, stderr) => {
      if (error) console.warn(`  ⚠️ Apple Music import failed:`, stderr || error.message);
      else console.log(`  ✅ Apple Music imported: ${path.basename(filePath)}`);
      resolve();
    });
  });
}

function generateJobId() {
  return `job_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

function getOrCreateLocalUserFolder(userId) {
  const userFolder = path.join(DRIVE_BASE, userId);
  if (!fs.existsSync(userFolder)) fs.mkdirSync(userFolder, { recursive: true });
  return userFolder;
}

// ═══════════════════════════════════════════════════════════════════════════
// ─── HITTALK MIXER ENGINE ─────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

function buildMixerFilters(s) {
  if (!s) return '';

  const filters = [];

  if (s.eq && s.eq.hpf > 0) {
    filters.push(`highpass=f=${s.eq.hpf}`);
  }

  if (s.eq && s.eq.lpf && s.eq.lpf < 22000) {
    filters.push(`lowpass=f=${s.eq.lpf}`);
  }

  if (s.eq && Array.isArray(s.eq.bands)) {
    s.eq.bands.forEach(band => {
      if (band.gain !== 0) {
        const hz = band.freq.toLowerCase().includes('k')
          ? parseFloat(band.freq) * 1000
          : parseFloat(band.freq);
        filters.push(`equalizer=f=${hz}:width_type=o:width=2:g=${band.gain}`);
      }
    });
  }

  if (s.fx && typeof s.fx.bassGain === 'number' && s.fx.bassGain !== 0) {
    filters.push(`bass=g=${s.fx.bassGain}`);
  }

  if (s.eq && s.eq.stereoWide && s.fx && s.fx.stereoWidth) {
    filters.push(`stereotools=mlev=${s.fx.stereoWidth}`);
  }

  if (s.fx && s.fx.reverb && s.fx.reverb.enabled) {
    const r = s.fx.reverb;
    const inGain  = 0.8;
    const outGain = parseFloat(r.wet)   || 0.2;
    const delay   = parseInt(r.delay)   || 80;
    const decay   = parseFloat(r.decay) || 0.4;
    filters.push(`aecho=${inGain}:${outGain}:${delay}:${decay}`);
  }

  if (s.fx && s.fx.saturation && s.fx.saturation.enabled) {
    const drive = parseFloat(s.fx.saturation.drive) || 3;
    filters.push(`acrusher=level_in=${drive}:level_out=1:bits=16:mode=log:aa=1`);
  }

  if (s.dynamics && s.dynamics.compression && s.dynamics.compression.enabled) {
    const c = s.dynamics.compression;
    const threshold = parseInt(c.threshold) || -18;
    const ratio     = parseFloat(c.ratio)   || 4;
    const attack    = parseInt(c.attack)    || 100;
    const release   = parseInt(c.release)   || 400;
    filters.push(
      `acompressor=threshold=${threshold}dB:ratio=${ratio}:attack=${attack}:release=${release}`
    );
  }

  if (s.dynamics && s.dynamics.loudnorm && s.dynamics.loudnorm.enabled) {
    const l = s.dynamics.loudnorm;
    const lufs     = parseInt(l.lufs)       || -14;
    const truePeak = parseFloat(l.truePeak) || -1;
    filters.push(`loudnorm=I=${lufs}:lra=11:tp=${truePeak}`);
  }

  if (s.dynamics && s.dynamics.limiter) {
    filters.push(`alimiter=level_in=1:level_out=1:limit=0.891:attack=5:release=50`);
  }

  return filters.join(',');
}

function buildXfadeChain(trackCount, mixerSettings) {
  if (trackCount === 1) {
    return { xfadeChain: '', finalLabel: '0:a' };
  }

  if (!mixerSettings || !mixerSettings.crossfade) {
    let filterLines = [];
    let lastLabel   = '[0:a]';
    for (let i = 1; i < trackCount; i++) {
      const outLabel = i === trackCount - 1 ? '[out]' : `[cf${i}]`;
      filterLines.push(`${lastLabel}[${i}:a]acrossfade=d=3:c1=tri:c2=tri${outLabel}`);
      lastLabel = outLabel;
    }
    return { xfadeChain: filterLines.join(';'), finalLabel: 'out' };
  }

  const dur   = parseFloat(mixerSettings.crossfade.duration) || 3;
  const curve = mixerSettings.crossfade.curve || 'qsin';

  let chain     = [];
  let prevLabel = '[0:a]';

  for (let i = 1; i < trackCount; i++) {
    const isLast   = i === trackCount - 1;
    const outLabel = isLast ? '[xout]' : `[tmp${i}]`;
    chain.push(`${prevLabel}[${i}:a]xfade=transition=${curve}:duration=${dur}${outLabel}`);
    prevLabel = outLabel;
  }

  return { xfadeChain: chain.join(';'), finalLabel: 'xout' };
}

function buildFadeFilters(mixerSettings) {
  if (!mixerSettings || !mixerSettings.crossfade) return { fadeIn: null, fadeOut: null };
  const fadeIn  = parseFloat(mixerSettings.crossfade.fadeIn)  || 0;
  const fadeOut = parseFloat(mixerSettings.crossfade.fadeOut) || 0;
  return {
    fadeIn:  fadeIn  > 0 ? `afade=t=in:st=0:d=${fadeIn}` : null,
    fadeOut: fadeOut > 0 ? fadeOut : null
  };
}

// ─── SOCIAL CLIP PROCESSOR ─────────────────────────────────────────────────
async function processSocialClip(jobId, audioUrl, imageUrl, outputName, userId) {
  console.log(`\n[${jobId}] Starting Social Clip processing...`);
  const audioPath     = path.join(WORK_DIR, `${jobId}_audio.mp3`);
  const imagePath     = path.join(WORK_DIR, `${jobId}_cover.jpg`);
  const socialClipDir = '/tmp/hit-talk-output';

  if (!fs.existsSync(socialClipDir)) fs.mkdirSync(socialClipDir, { recursive: true });
  const tempOutput = path.join(socialClipDir, outputName);

  try {
    jobs[jobId].status = 'PROCESSING';

    await downloadFile(audioUrl, audioPath);
    await downloadFile(imageUrl, imagePath);

    const ffmpegCmd = [
      'ffmpeg -y', `-loop 1 -i "${imagePath}"`, `-i "${audioPath}"`,
      `-filter_complex`,
      `"[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=20:20,eq=brightness=-0.3[bg];[0:v]scale=900:900:force_original_aspect_ratio=decrease,pad=900:900:(ow-iw)/2:(oh-ih)/2:color=black@0[art];[bg][art]overlay=(W-w)/2:(H-h)/2,fade=t=in:st=0:d=1,fade=t=out:st=28:d=2[v];[1:a]atrim=start=60,asetpts=PTS-STARTPTS,afade=t=in:st=0:d=1,afade=t=out:st=28:d=2,aformat=sample_rates=44100:channel_layouts=stereo[a]"`,
      `-map "[v]" -map "[a]"`, `-c:v libx264 -preset fast -crf 23`,
      `-c:a aac -b:a 192k`, `-t 30`, `-movflags +faststart`, `"${tempOutput}"`
    ].join(' ');

    await runFFmpeg(ffmpegCmd);

    const driveFolderId = await getOrCreateDriveFolderId(userId);
    let driveFileUrl = null;
    if (driveClient && driveFolderId) {
      const fileId = await uploadFileToDrive(tempOutput, outputName, driveFolderId);
      if (fileId) driveFileUrl = `https://drive.google.com/file/d/${fileId}/view`;
    } else {
      fs.copyFileSync(tempOutput, path.join(getOrCreateLocalUserFolder(userId), outputName));
    }

    jobs[jobId].status = 'SUCCESS'; jobs[jobId].outputPath = tempOutput;
    jobs[jobId].driveFolderUrl = driveFileUrl;
    jobs[jobId].downloadUrl = `${PUBLIC_URL}/api/download/${jobId}`;
    jobs[jobId].completedAt = new Date().toISOString();
    console.log(`[${jobId}] ✅ Social Clip complete! Drive: ${driveFileUrl}`);
    [audioPath, imagePath].forEach(f => { try { fs.unlinkSync(f); } catch (e) {} });
  } catch (err) {
    console.error(`[${jobId}] ❌ Social Clip failed:`, err.message);
    jobs[jobId].status = 'FAILED'; jobs[jobId].error = err.message;
    [audioPath, imagePath].forEach(f => { try { fs.unlinkSync(f); } catch (e) {} });
  }
}

// ─── FULL CLIP PROCESSOR ───────────────────────────────────────────────────
// Same as Social Clip but plays the entire audio file — no -t duration cap.
// Uses -shortest so FFmpeg stops when the audio ends naturally.
async function processFullClip(jobId, audioUrl, imageUrl, outputName, userId) {
  console.log(`\n[${jobId}] Starting Full Clip processing...`);
  const audioPath    = path.join(WORK_DIR, `${jobId}_audio.mp3`);
  const imagePath    = path.join(WORK_DIR, `${jobId}_cover.jpg`);
  const fullClipDir  = '/tmp/hit-talk-output';

  if (!fs.existsSync(fullClipDir)) fs.mkdirSync(fullClipDir, { recursive: true });
  const tempOutput = path.join(fullClipDir, outputName);

  try {
    jobs[jobId].status = 'PROCESSING';

    await downloadFile(audioUrl, audioPath);
    await downloadFile(imageUrl, imagePath);

    // Full length video — vertical 9:16 with blurred background, same as social clip
    // but -shortest instead of -t 30 so the full audio plays through
    const ffmpegCmd = [
      'ffmpeg -y',
      `-loop 1 -i "${imagePath}"`,
      `-i "${audioPath}"`,
      `-filter_complex`,
      `"[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=20:20,eq=brightness=-0.3[bg];[0:v]scale=900:900:force_original_aspect_ratio=decrease,pad=900:900:(ow-iw)/2:(oh-ih)/2:color=black@0[art];[bg][art]overlay=(W-w)/2:(H-h)/2[v];[1:a]aformat=sample_rates=44100:channel_layouts=stereo[a]"`,
      `-map "[v]" -map "[a]"`,
      `-c:v libx264 -preset fast -crf 23`,
      `-c:a aac -b:a 192k`,
      `-pix_fmt yuv420p`,
      `-shortest`,
      `-movflags +faststart`,
      `"${tempOutput}"`
    ].join(' ');

    await runFFmpeg(ffmpegCmd);

    const driveFolderId = await getOrCreateDriveFolderId(userId);
    let driveFileUrl = null;
    if (driveClient && driveFolderId) {
      const fileId = await uploadFileToDrive(tempOutput, outputName, driveFolderId);
      if (fileId) driveFileUrl = `https://drive.google.com/file/d/${fileId}/view`;
    } else {
      fs.copyFileSync(tempOutput, path.join(getOrCreateLocalUserFolder(userId), outputName));
    }

    jobs[jobId].status         = 'SUCCESS';
    jobs[jobId].outputPath     = tempOutput;
    jobs[jobId].driveFolderUrl = driveFileUrl;
    jobs[jobId].downloadUrl    = `${PUBLIC_URL}/api/download/${jobId}`;
    jobs[jobId].completedAt    = new Date().toISOString();
    console.log(`[${jobId}] ✅ Full Clip complete! Drive: ${driveFileUrl}`);
    [audioPath, imagePath].forEach(f => { try { fs.unlinkSync(f); } catch (e) {} });
  } catch (err) {
    console.error(`[${jobId}] ❌ Full Clip failed:`, err.message);
    jobs[jobId].status = 'FAILED'; jobs[jobId].error = err.message;
    [audioPath, imagePath].forEach(f => { try { fs.unlinkSync(f); } catch (e) {} });
  }
}

// ─── TAG MP3 PROCESSOR ─────────────────────────────────────────────────────
async function tagAndUploadMp3({ userId, trackTitle, artistName, genres, moods, coverArtUrl, musicFileUrl }) {
  const jobId = generateJobId();
  console.log(`\n[${jobId}] ▶ tagAndUploadMp3 — ${trackTitle} — ${artistName}`);

  const safeTitle  = (trackTitle  || 'unknown').replace(/[^a-zA-Z0-9_\- ]/g, '').trim().replace(/ +/g, '_');
  const safeArtist = (artistName  || 'unknown').replace(/[^a-zA-Z0-9_\- ]/g, '').trim().replace(/ +/g, '_');
  const outputName = `${safeTitle}_${safeArtist}_tagged.mp3`;

  const rawCoverPath     = path.join(WORK_DIR, `${jobId}_cover_raw.jpg`);
  const squaredCoverPath = path.join(WORK_DIR, `${jobId}_cover_sq.jpg`);
  const rawAudioPath     = path.join(WORK_DIR, `${jobId}_audio.mp3`);
  const taggedAudioPath  = path.join(OUTPUT_DIR, outputName);

  try {
    await downloadFile(coverArtUrl, rawCoverPath);
    await downloadFile(musicFileUrl, rawAudioPath);
    await runFFmpeg(`ffmpeg -y -i "${rawCoverPath}" -vf "crop=min(iw\\,ih):min(iw\\,ih),scale=1000:1000" "${squaredCoverPath}"`);

    const genreTag = Array.isArray(genres) ? genres[0] || '' : String(genres);
    const moodTag  = Array.isArray(moods)  ? moods.join(', ') : String(moods);

    await runFFmpeg(
      `ffmpeg -y -i "${rawAudioPath}" -i "${squaredCoverPath}" ` +
      `-map 0:a -map 1:v -c:a libmp3lame -b:a 256k -ar 44100 -ac 2 -id3v2_version 3 ` +
      `-metadata title="${(trackTitle  || '').replace(/"/g, '\\"')}" ` +
      `-metadata artist="${(artistName || '').replace(/"/g, '\\"')}" ` +
      `-metadata genre="${genreTag.replace(/"/g, '\\"')}" ` +
      `-metadata comment="${moodTag.replace(/"/g, '\\"')}" ` +
      `-metadata:s:v comment="Cover(front)" "${taggedAudioPath}"`
    );

    console.log(`[${jobId}] ✅ Tagged MP3 dropped into Apple Music inbox`);
    await importIntoAppleMusic(taggedAudioPath);

    if (driveClient) {
      const safeUserId = (userId || jobId).replace(/[^a-zA-Z0-9_\-]/g, '');
      const folderId   = await getOrCreateNestedDriveFolder(['Tagged MP3s', safeUserId]);
      if (folderId) {
        const fileId = await uploadFileToDriveAs(taggedAudioPath, outputName, folderId, 'audio/mpeg');
        if (fileId) console.log(`[${jobId}] ☁ Drive backup: https://drive.google.com/file/d/${fileId}/view`);
      }
    }
  } catch (err) {
    console.error(`[${jobId}] ❌ tagAndUploadMp3 failed:`, err.message);
  } finally {
    [rawCoverPath, squaredCoverPath, rawAudioPath].forEach(f => { try { fs.unlinkSync(f); } catch (_) {} });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// ─── MIXTAPE PROCESSOR ────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════
async function processMixtape({ jobId, tracks, ownerId, mixtapeTitle, coverArtUrl, mixerSettings }) {
  console.log(`\n[${jobId}] 🎛 Mixtape started — ${tracks.length} tracks for owner: ${ownerId}`);
  if (mixerSettings) {
    console.log(`[${jobId}] 🎚 Mixer settings received — custom processing active`);
  } else {
    console.log(`[${jobId}] 🎚 No mixer settings — using default behavior`);
  }

  const trackPaths      = [];
  const normalizedPaths = [];
  const tempFiles       = [];

  try {
    jobs[jobId].status = 'PROCESSING';

    // ── Step 1 — Download all tracks ─────────────────────────────────────
    for (let i = 0; i < tracks.length; i++) {
      const { url, title } = tracks[i];
      const dest = path.join(WORK_DIR, `${jobId}_track_${i}.mp3`);
      console.log(`[${jobId}]   ⬇ Downloading track ${i + 1}/${tracks.length}: ${title}`);
      await downloadFile(url, dest);
      trackPaths.push(dest);
      tempFiles.push(dest);
    }

    // ── Step 2 — Apply per-track fade-in / fade-out if mixer is active ───
    const fadeSettings = buildFadeFilters(mixerSettings);

    if (mixerSettings && (fadeSettings.fadeIn || fadeSettings.fadeOut)) {
      for (let i = 0; i < trackPaths.length; i++) {
        const isFirst   = i === 0;
        const isLast    = i === trackPaths.length - 1;
        const fadedPath = path.join(WORK_DIR, `${jobId}_track_${i}_faded.mp3`);

        let afFilters = [];

        if (isFirst && fadeSettings.fadeIn) {
          afFilters.push(fadeSettings.fadeIn);
        }

        if (isLast && fadeSettings.fadeOut) {
          try {
            const duration  = await getAudioDuration(trackPaths[i]);
            const fadeStart = Math.max(0, duration - fadeSettings.fadeOut);
            afFilters.push(`afade=t=out:st=${fadeStart.toFixed(2)}:d=${fadeSettings.fadeOut}`);
          } catch (e) {
            console.warn(`[${jobId}] ⚠️ Could not get duration for fade-out: ${e.message}`);
          }
        }

        if (afFilters.length > 0) {
          console.log(`[${jobId}]   🎚 Applying fades to track ${i + 1}: ${afFilters.join(',')}`);
          await runFFmpeg(
            `ffmpeg -y -i "${trackPaths[i]}" -af "${afFilters.join(',')}" ` +
            `-c:a libmp3lame -b:a 256k -ar 44100 -ac 2 "${fadedPath}"`
          );
          normalizedPaths.push(fadedPath);
          tempFiles.push(fadedPath);
        } else {
          normalizedPaths.push(trackPaths[i]);
        }
      }
    } else {
      // No fades — use tracks directly (original behavior)
      trackPaths.forEach(p => normalizedPaths.push(p));
    }

    // ── Step 3 — Download and square cover art ────────────────────────────
    const safeTitle  = (mixtapeTitle || 'mixtape').replace(/[^a-zA-Z0-9_\- ]/g, '').trim().replace(/ +/g, '_');

    const outFmt     = (mixerSettings && mixerSettings.output && mixerSettings.output.format) || 'mp3';
    const outputName = `${safeTitle}_mixtape.${outFmt}`;
    const outputPath = path.join(WORK_DIR, `${jobId}_${outputName}`);
    tempFiles.push(outputPath);

    let coverPath    = null;
    let squaredCover = null;

    const shouldEmbedCover = !mixerSettings || (mixerSettings.output && mixerSettings.output.embedCover !== false);

    if (coverArtUrl && shouldEmbedCover) {
      coverPath    = path.join(WORK_DIR, `${jobId}_mixtape_cover_raw.jpg`);
      squaredCover = path.join(WORK_DIR, `${jobId}_mixtape_cover_sq.jpg`);
      tempFiles.push(coverPath, squaredCover);

      try {
        console.log(`[${jobId}] 🖼 Downloading cover art: ${coverArtUrl}`);
        await downloadFile(coverArtUrl, coverPath);
        await runFFmpeg(
          `ffmpeg -y -i "${coverPath}" ` +
          `-vf "crop=min(iw\\,ih):min(iw\\,ih),scale=1000:1000" "${squaredCover}"`
        );
        console.log(`[${jobId}] ✅ Cover art squared`);
      } catch (e) {
        console.warn(`[${jobId}] ⚠️ Cover art processing failed:`, e.message);
        squaredCover = null;
      }
    }

    // ── Step 4 — Build crossfade chain ─────────────────────────────────
    console.log(`[${jobId}] 🎚 Building crossfaded mixtape...`);

    let codecArgs;
    let sampleRate;

    if (mixerSettings && mixerSettings.output) {
      const o = mixerSettings.output;
      sampleRate = o.sampleRate || 44100;
      if (outFmt === 'wav') {
        codecArgs = `-c:a pcm_s16le`;
      } else if (outFmt === 'flac') {
        codecArgs = `-c:a flac`;
      } else if (outFmt === 'aac') {
        codecArgs = `-c:a aac -b:a ${o.bitrate || '256k'}`;
      } else {
        codecArgs = `-c:a libmp3lame -b:a ${o.bitrate || '256k'}`;
      }
    } else {
      sampleRate = 44100;
      codecArgs  = `-c:a libmp3lame -b:a 128k`;
    }

    const audioFilters = buildMixerFilters(mixerSettings);

    if (normalizedPaths.length === 1) {
      console.log(`[${jobId}]   Single track — skipping crossfade`);

      const afArg   = audioFilters ? `-af "${audioFilters}"` : '';
      const inputs  = squaredCover ? `-i "${normalizedPaths[0]}" -i "${squaredCover}"` : `-i "${normalizedPaths[0]}"`;
      const mapping = squaredCover
        ? `-map 0:a -map 1:v -metadata:s:v comment="Cover(front)"`
        : `-map 0:a`;

      await runFFmpeg(
        `ffmpeg -y ${inputs} ${mapping} ${afArg} ` +
        `-threads 0 ${codecArgs} -ar ${sampleRate} -ac 2 -id3v2_version 3 ` +
        `-metadata title="${safeTitle.replace(/_/g, ' ')}" ` +
        `-metadata artist="Hit Talk" ` +
        `"${outputPath}"`
      );

    } else {
      const { xfadeChain, finalLabel } = buildXfadeChain(normalizedPaths.length, mixerSettings);
      const inputFlags     = normalizedPaths.map(p => `-i "${p}"`).join(' ');
      const coverInputIndex = normalizedPaths.length;

      if (squaredCover) {
        let filterComplex;

        if (audioFilters) {
          filterComplex = `${xfadeChain};[${finalLabel}]${audioFilters}[finalout]`;
        } else {
          filterComplex = xfadeChain;
        }

        const audioMap = audioFilters ? `[finalout]` : `[${finalLabel}]`;

        console.log(`[${jobId}]   filter_complex: ${filterComplex}`);
        console.log(`[${jobId}]   audio map: ${audioMap}`);

        await runFFmpeg(
          `ffmpeg -y ${inputFlags} -i "${squaredCover}" ` +
          `-filter_complex "${filterComplex}" ` +
          `-threads 0 -map "${audioMap}" -map ${coverInputIndex}:v ` +
          `-c:v mjpeg -disposition:v:0 attached_pic ` +
          `${codecArgs} -ar ${sampleRate} -ac 2 ` +
          `-id3v2_version 3 ` +
          `-metadata title="${safeTitle.replace(/_/g, ' ')}" ` +
          `-metadata artist="Hit Talk" ` +
          `-metadata:s:v comment="Cover(front)" ` +
          `"${outputPath}"`
        );

      } else {
        let filterComplex;
        let audioMap;

        if (audioFilters) {
          filterComplex = `${xfadeChain};[${finalLabel}]${audioFilters}[finalout]`;
          audioMap = `[finalout]`;
        } else {
          filterComplex = xfadeChain;
          audioMap = `[${finalLabel}]`;
        }

        console.log(`[${jobId}]   filter_complex: ${filterComplex}`);

        await runFFmpeg(
          `ffmpeg -y ${inputFlags} ` +
          `-filter_complex "${filterComplex}" ` +
          `-threads 0 -map "${audioMap}" ` +
          `${codecArgs} -ar ${sampleRate} -ac 2 ` +
          `-id3v2_version 3 ` +
          `-metadata title="${safeTitle.replace(/_/g, ' ')}" ` +
          `-metadata artist="Hit Talk" ` +
          `"${outputPath}"`
        );
      }
    }

    console.log(`[${jobId}] ✅ Mixtape rendered: ${outputPath}`);

    // ── Step 5 — Copy to Apple Music inbox + force import ─────────────────
    const appleInboxPath = path.join(OUTPUT_DIR, outputName);
    fs.copyFileSync(outputPath, appleInboxPath);
    await importIntoAppleMusic(appleInboxPath);

    // ── Step 6 — Upload to Drive ──────────────────────────────────────────
    let driveFileUrl = null;
    if (driveClient) {
      const safeOwnerId = (ownerId || jobId).replace(/[^a-zA-Z0-9_\-]/g, '');
      const folderId    = await getOrCreateNestedDriveFolder(['Tagged MP3s', safeOwnerId]);
      if (folderId) {
        const driveMime = outFmt === 'mp3' ? 'audio/mpeg'
          : outFmt === 'wav'  ? 'audio/wav'
          : outFmt === 'flac' ? 'audio/flac'
          : outFmt === 'aac'  ? 'audio/aac'
          : 'audio/mpeg';
        const fileId = await uploadFileToDriveAs(outputPath, outputName, folderId, driveMime);
        if (fileId) {
          driveFileUrl = `https://drive.google.com/file/d/${fileId}/view`;
          console.log(`[${jobId}] ☁ Mixtape on Drive: ${driveFileUrl}`);
        }
      }
    }

    jobs[jobId].status         = 'SUCCESS';
    jobs[jobId].outputPath     = appleInboxPath;
    jobs[jobId].driveFolderUrl = driveFileUrl;
    jobs[jobId].downloadUrl    = `${PUBLIC_URL}/api/download/${jobId}`;
    jobs[jobId].completedAt    = new Date().toISOString();

    console.log(`[${jobId}] 🎉 Mixtape complete! Drive: ${driveFileUrl}`);

  } catch (err) {
    console.error(`[${jobId}] ❌ Mixtape failed:`, err.message);
    jobs[jobId].status = 'FAILED';
    jobs[jobId].error  = err.message;
  } finally {
    tempFiles.forEach(f => { try { fs.unlinkSync(f); } catch (_) {} });
  }
}

// ─── AUDIO DURATION HELPER ────────────────────────────────────────────────
function getAudioDuration(filePath) {
  return new Promise((resolve, reject) => {
    exec(
      `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`,
      (error, stdout) => {
        if (error) return reject(error);
        const secs = parseFloat(stdout.trim());
        if (isNaN(secs)) return reject(new Error('Could not parse duration'));
        resolve(secs);
      }
    );
  });
}

// ─── HTTP SERVER ───────────────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, ngrok-skip-browser-warning');

  if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

  // ── Health check ──
  if (req.url === '/api/health' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'healthy', activeJobs: Object.keys(jobs).length }));
    return;
  }

  // ── Social Clip ──
  if (req.url === '/api/social-clip' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', () => {
      try {
        const { audioUrl, imageUrl, outputName, userId } = JSON.parse(body);
        if (!audioUrl || !imageUrl) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'audioUrl and imageUrl are required' }));
          return;
        }
        const jobId = generateJobId();
        const safeOutputName = `${(outputName || jobId).replace(/\.[^.]+$/, '')}_social_clip.mp4`;
        jobs[jobId] = { jobId, status: 'PROCESSING', outputPath: null, driveFolderUrl: null, downloadUrl: null, error: null, createdAt: new Date().toISOString() };
        processSocialClip(jobId, audioUrl, imageUrl, safeOutputName, userId || jobId);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, jobId }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  // ── Full Clip ──
  if (req.url === '/api/full-clip' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', () => {
      try {
        const { audioUrl, imageUrl, outputName, userId } = JSON.parse(body);
        if (!audioUrl || !imageUrl) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'audioUrl and imageUrl are required' }));
          return;
        }
        const jobId = generateJobId();
        const safeOutputName = `${(outputName || jobId).replace(/\.[^.]+$/, '')}_full_clip.mp4`;
        jobs[jobId] = { jobId, status: 'PROCESSING', outputPath: null, driveFolderUrl: null, downloadUrl: null, error: null, createdAt: new Date().toISOString() };
        processFullClip(jobId, audioUrl, imageUrl, safeOutputName, userId || jobId);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, jobId }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  // ── Tag MP3 ──
  if (req.url === '/api/tag-mp3' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', async () => {
      try {
        const { userId, trackTitle, artistName, genres = [], moods = [], coverArtUrl, musicFileUrl } = JSON.parse(body);
        if (!coverArtUrl || !musicFileUrl) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'coverArtUrl and musicFileUrl are required' }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, message: 'Tagging job started' }));
        tagAndUploadMp3({ userId, trackTitle, artistName, genres, moods, coverArtUrl, musicFileUrl })
          .catch(err => console.error('❌ tagAndUploadMp3 error:', err.message));
      } catch (err) {
        console.error('❌ /api/tag-mp3 parse error:', err.message);
      }
    });
    return;
  }

  // ── Mixtape ──
  if (req.url === '/api/mixtape' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', async () => {
      try {
        const { tracks, ownerId, mixtapeTitle, coverArtUrl, mixerSettings } = JSON.parse(body);
        if (!tracks || !Array.isArray(tracks) || tracks.length === 0) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'tracks array is required' }));
          return;
        }
        const jobId = generateJobId();
        jobs[jobId] = {
          jobId, status: 'PROCESSING',
          outputPath: null, driveFolderUrl: null,
          downloadUrl: null, error: null,
          createdAt: new Date().toISOString()
        };
        console.log(`\n✅ Mixtape job queued: ${jobId} — ${tracks.length} tracks`);
        if (mixerSettings) {
          console.log(`   🎚 Mixer active: xfade=${mixerSettings.crossfade?.curve || 'default'} ` +
            `dur=${mixerSettings.crossfade?.duration || '?'}s ` +
            `comp=${mixerSettings.dynamics?.compression?.enabled} ` +
            `loudnorm=${mixerSettings.dynamics?.loudnorm?.enabled} ` +
            `reverb=${mixerSettings.fx?.reverb?.enabled} ` +
            `format=${mixerSettings.output?.format || 'mp3'}`
          );
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, jobId }));
        processMixtape({ jobId, tracks, ownerId, mixtapeTitle, coverArtUrl, mixerSettings })
          .catch(err => console.error('❌ processMixtape error:', err.message));
      } catch (err) {
        console.error('❌ /api/mixtape parse error:', err.message);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  // ── Status check ──
  if (req.url.startsWith('/api/status/') && req.method === 'GET') {
    const jobId = req.url.replace('/api/status/', '');
    const job   = jobs[jobId];
    if (!job) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: `Job not found: ${jobId}` }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      success: true, status: job.status,
      downloadUrl: job.downloadUrl || null,
      driveFolderUrl: job.driveFolderUrl || null,
      error: job.error || null
    }));
    return;
  }

  // ── Download file ──
  if (req.url.startsWith('/api/download/') && req.method === 'GET') {
    const jobId = req.url.replace('/api/download/', '');
    const job   = jobs[jobId];
    if (!job || job.status !== 'SUCCESS' || !job.outputPath || !fs.existsSync(job.outputPath)) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'File not found or not ready' }));
      return;
    }
    const fileName = path.basename(job.outputPath);
    const fileSize = fs.statSync(job.outputPath).size;
    res.writeHead(200, {
      'Content-Type': 'audio/mpeg',
      'Content-Disposition': `attachment; filename="${fileName}"`,
      'Content-Length': fileSize
    });
    fs.createReadStream(job.outputPath).pipe(res);
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

// ─── START ─────────────────────────────────────────────────────────────────
initGoogleDrive().then(() => {
  server.listen(3001, () => {
    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('✅ Hit Talk Local Processor RUNNING');
    console.log('═══════════════════════════════════════════════════════════');
    console.log(`✅ Server:      http://localhost:3001`);
    console.log(`✅ Public URL:  ${PUBLIC_URL}`);
    console.log(`✅ FFmpeg:      Available`);
    console.log(`✅ Drive Base:  ${DRIVE_BASE}`);
    console.log(`✅ Tagged MP3s: ${OUTPUT_DIR}`);
    console.log(`✅ Endpoints:   /api/tag-mp3 | /api/mixtape | /api/social-clip | /api/full-clip`);
    console.log('═══════════════════════════════════════════════════════════\n');
  });
});

process.on('SIGINT', () => { console.log('\n✓ Shutting down...'); process.exit(0); });