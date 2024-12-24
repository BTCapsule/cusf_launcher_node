const express = require('express');
const path = require('path');
const fs = require('fs');
const https = require('https');
const os = require('os');
const extract = require('extract-zip');
const app = express();

// Serve static files
app.use(express.static('public'));


let runningProcesses = {
    bitwindow: null,
    enforcer: null,
    thunder: null
};



// Get appropriate download URL based on OS
function getBitcoinUrl() {
    switch (os.platform()) {
        case 'win32':
            return 'https://releases.drivechain.info/L1-bitcoin-patched-latest-x86_64-w64-msvc.zip';
        case 'darwin':
            return 'https://releases.drivechain.info/L1-bitcoin-patched-latest-x86_64-apple-darwin.zip';
        default: // linux
            return 'https://releases.drivechain.info/L1-bitcoin-patched-latest-x86_64-unknown-linux-gnu.zip';
    }
}

function getGrpcurlUrl() {
    switch (os.platform()) {
        case 'win32':
            return 'https://github.com/fullstorydev/grpcurl/releases/download/v1.9.1/grpcurl_1.9.1_windows_x86_64.zip';
        case 'darwin':
            return 'https://github.com/fullstorydev/grpcurl/releases/download/v1.9.1/grpcurl_1.9.1_osx_x86_64.tar.gz';
        default: // linux
            return 'https://github.com/fullstorydev/grpcurl/releases/download/v1.9.1/grpcurl_1.9.1_linux_x86_64.tar.gz';
    }
}

function getBitwindowUrl() {
    switch (os.platform()) {
        case 'win32':
            return 'https://releases.drivechain.info/BitWindow-latest-x86_64-pc-windows-msvc.zip';
        case 'darwin':
            return 'https://releases.drivechain.info/BitWindow-latest-x86_64-apple-darwin.zip';
        default: // linux
            return 'https://releases.drivechain.info/BitWindow-latest-x86_64-unknown-linux-gnu.zip';
    }
}

function getEnforcerUrl() {
    switch (os.platform()) {
        case 'win32':
            return 'https://releases.drivechain.info/bip300301-enforcer-latest-x86_64-pc-windows-gnu.zip';
        case 'darwin':
            return 'https://releases.drivechain.info/bip300301-enforcer-latest-x86_64-apple-darwin.zip';
        default: // linux
            return 'https://releases.drivechain.info/bip300301-enforcer-latest-x86_64-unknown-linux-gnu.zip';
    }
}

function getThunderUrl() {
    switch (os.platform()) {
        case 'win32':
            return 'https://releases.drivechain.info/L2-S9-Thunder-latest-x86_64-pc-windows-gnu.zip';
        case 'darwin':
            return 'https://releases.drivechain.info/L2-S9-Thunder-latest-x86_64-apple-darwin.zip';
        default: // linux
            return 'https://releases.drivechain.info/L2-S9-Thunder-latest-x86_64-unknown-linux-gnu.zip';
    }
}

// Get appropriate data directory based on OS
function getDataDir() {
    switch (os.platform()) {
        case 'win32':
            return path.join(os.homedir(), 'AppData', 'Roaming', 'cusf_launcher');
        case 'darwin':
            return path.join(os.homedir(), 'Library', 'Application Support', 'cusf_launcher');
        default: // linux
            return path.join(os.homedir(), '.local', 'share', 'cusf_launcher');
    }
}


async function shutdownGracefully() {
    console.log('Shutting down gracefully...');
    
    // Function to kill a process with a timeout
    const killProcess = async (process, name, timeout = 5000) => {
        if (process) {
            return new Promise((resolve) => {
                console.log(`Stopping ${name}...`);
                
                // Set timeout to force kill if process doesn't exit
                const timeoutId = setTimeout(() => {
                    console.log(`Force killing ${name}`);
                    process.kill('SIGKILL');
                    resolve();
                }, timeout);

                // Try graceful shutdown first
                process.kill('SIGTERM');
                
                // Listen for process exit
                process.on('exit', () => {
                    clearTimeout(timeoutId);
                    console.log(`${name} stopped`);
                    resolve();
                });
            });
        }
        return Promise.resolve();
    };

    // Shutdown all processes in sequence
    try {
        await killProcess(runningProcesses.thunder, 'Thunder');
        await killProcess(runningProcesses.bitwindow, 'BitWindow');
        await killProcess(runningProcesses.enforcer, 'Enforcer');
    } catch (error) {
        console.error('Error during shutdown:', error);
    }

    // Exit the process
    process.exit(0);
}


// Serve index.html
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Helper function to handle downloads with proper headers
async function downloadFile(url, downloadPath) {
    return new Promise((resolve, reject) => {
        const options = {
            headers: {
                // Add User-Agent header which GitHub often requires
                'User-Agent': 'CUSF-Launcher'
            }
        };

        https.get(url, options, (response) => {
            // Handle redirects (GitHub releases often redirect)
            if (response.statusCode === 302 || response.statusCode === 301) {
                downloadFile(response.headers.location, downloadPath)
                    .then(resolve)
                    .catch(reject);
                return;
            }

            if (response.statusCode !== 200) {
                reject(new Error(`Failed to download: ${response.statusCode}`));
                return;
            }

            const fileStream = fs.createWriteStream(downloadPath);
            response.pipe(fileStream);

            fileStream.on('finish', () => {
                fileStream.close();
                resolve();
            });

            fileStream.on('error', (err) => {
                fs.unlink(downloadPath, () => {}); // Delete the file if there's an error
                reject(err);
            });
        }).on('error', (err) => {
            fs.unlink(downloadPath, () => {}); // Delete the file if there's an error
            reject(err);
        });
    });
}

// Update the download endpoint to use the new helper function
app.get('/download-l1', async (req, res) => {
    try {
        const dataDir = getDataDir();
        const downloadDir = path.join(dataDir, 'downloads', 'l1');
        await fs.promises.mkdir(downloadDir, { recursive: true });

        const downloads = [
            {
                url: getBitcoinUrl(),
                filename: 'bitcoinpatched.zip'
            },
            {
                url: getGrpcurlUrl(),
                filename: os.platform() === 'win32' ? 'grpcurl.zip' : 'grpcurl.tar.gz'
            },
            {
                url: getBitwindowUrl(),
                filename: 'bitwindow.zip'
            },
            {
                url: getEnforcerUrl(),
                filename: '300301enforcer.zip'
            }
        ];

        // Download all files
        for (const download of downloads) {
            const downloadPath = path.join(downloadDir, download.filename);
            console.log(`Downloading ${download.url} to ${downloadPath}`);
            
            try {
                await downloadFile(download.url, downloadPath);
                
                // Verify file exists and has content
                const stats = await fs.promises.stat(downloadPath);
                if (stats.size === 0) {
                    throw new Error(`Downloaded file ${download.filename} is empty`);
                }
            } catch (err) {
                console.error(`Error downloading ${download.filename}:`, err);
                throw err;
            }
        }

        res.json({
            success: true,
            message: 'All downloads complete',
            path: downloadDir
        });

    } catch (err) {
        console.error('Download error:', err);
        res.status(500).json({
            success: false,
            error: err.message
        });
    }
});


// Handle L1 extraction
app.get('/extract-l1', async (req, res) => {
    try {
        const dataDir = getDataDir();
        const downloadDir = path.join(dataDir, 'downloads', 'l1');

        // List of files to extract
        const files = [
            'bitcoinpatched.zip',
            os.platform() === 'win32' ? 'grpcurl.zip' : 'grpcurl.tar.gz',
            'bitwindow.zip',
            '300301enforcer.zip'
        ];

        for (const file of files) {
            const filePath = path.join(downloadDir, file);
            
            if (!fs.existsSync(filePath)) {
                throw new Error(`File not found: ${file}`);
            }

            if (file.endsWith('.zip')) {
                await extract(filePath, { dir: downloadDir });
            } else if (file.endsWith('.tar.gz')) {
                // For tar.gz files (Linux/macOS grpcurl)
                const { execSync } = require('child_process');
                execSync(`tar -xzf "${filePath}" -C "${downloadDir}"`);
            }
        }

        res.json({
            success: true,
            message: 'All extractions complete',
            path: downloadDir
        });
    } catch (err) {
        console.error('Extraction error:', err);
        res.status(500).json({
            success: false,
            error: err.message
        });
    }
});


// Handle starting BitWindow
app.get('/start-bitwindow', async (req, res) => {
    try {
        const dataDir = getDataDir();
        const downloadDir = path.join(dataDir, 'downloads', 'l1');
        
        // Determine BitWindow executable path based on OS
        let bitwindowPath = '';
        switch (os.platform()) {
            case 'win32':
                bitwindowPath = path.join(downloadDir, 'bitwindow.exe');
                break;
            case 'darwin':
                bitwindowPath = path.join(downloadDir, 'bitwindow');
                break;
            default: // linux
                bitwindowPath = path.join(downloadDir,'bitwindow');
                break;
        }

        // Check if executable exists
        if (!fs.existsSync(bitwindowPath)) {
            throw new Error('BitWindow executable not found');
        }

        // Make file executable on Unix-like systems
        if (os.platform() !== 'win32') {
            const { execSync } = require('child_process');
            execSync(`chmod +x "${bitwindowPath}"`);
        }

        // Start BitWindow
        const { spawn } = require('child_process');
        const process = spawn(bitwindowPath, [], {
            detached: true,
            stdio: 'ignore'
        });

        runningProcesses.bitwindow = process;

        res.json({
            success: true,
            message: 'BitWindow started successfully',
            pid: process.pid
        });

    } catch (err) {
        console.error('Error starting BitWindow:', err);
        res.status(500).json({
            success: false,
            error: err.message
        });
    }
});

// Add this new endpoint after your other endpoints
app.get('/check-bitwindow', async (req, res) => {
    try {
        const dataDir = getDataDir();
        const downloadDir = path.join(dataDir, 'downloads', 'l1');
        
        // Determine BitWindow executable path based on OS
        let bitwindowPath = '';
        switch (os.platform()) {
            case 'win32':
                bitwindowPath = path.join(downloadDir, 'bitwindow.exe');
                break;
            case 'darwin':
                bitwindowPath = path.join(downloadDir, 'bitwindow');
                break;
            default: // linux
                bitwindowPath = path.join(downloadDir, 'bitwindow');
                break;
        }

        const exists = fs.existsSync(bitwindowPath);
        
        res.json({
            exists: exists,
            path: bitwindowPath
        });

    } catch (err) {
        console.error('Error checking BitWindow:', err);
        res.status(500).json({
            exists: false,
            error: err.message
        });
    }
});


// Add this after your app creation
const ensureDirectories = async () => {
    try {
        const dataDir = getDataDir();
        const downloadDir = path.join(dataDir, 'downloads', 'l1');
        await fs.promises.mkdir(downloadDir, { recursive: true });
        console.log('Directories created/verified at:', dataDir);
    } catch (err) {
        console.error('Failed to create directories:', err);
    }
};







// Thunder download and extract endpoints
app.get('/download-thunder', async (req, res) => {
    try {
        const dataDir = getDataDir();
        const downloadDir = path.join(dataDir, 'downloads', 'l2');
        await fs.promises.mkdir(downloadDir, { recursive: true });

        const downloadPath = path.join(downloadDir, 'thunder.zip');
        console.log(`Downloading Thunder to ${downloadPath}`);
        
        await downloadFile(getThunderUrl(), downloadPath);
        
        // Verify file exists and has content
        const stats = await fs.promises.stat(downloadPath);
        if (stats.size === 0) {
            throw new Error('Downloaded Thunder file is empty');
        }

        res.json({
            success: true,
            message: 'Thunder download complete',
            path: downloadDir
        });

    } catch (err) {
        console.error('Thunder download error:', err);
        res.status(500).json({
            success: false,
            error: err.message
        });
    }
});

app.get('/extract-thunder', async (req, res) => {
    try {
        const dataDir = getDataDir();
        const downloadDir = path.join(dataDir, 'downloads', 'l2');
        const filePath = path.join(downloadDir, 'thunder.zip');

        if (!fs.existsSync(filePath)) {
            throw new Error('Thunder zip file not found');
        }

        await extract(filePath, { dir: downloadDir });

        res.json({
            success: true,
            message: 'Thunder extraction complete',
            path: downloadDir
        });
    } catch (err) {
        console.error('Thunder extraction error:', err);
        res.status(500).json({
            success: false,
            error: err.message
        });
    }
});

app.get('/start-thunder', async (req, res) => {
    try {
        const dataDir = getDataDir();
        const downloadDir = path.join(dataDir, 'downloads', 'l2');
        
        let thunderPath = '';
        switch (os.platform()) {
            case 'win32':
                thunderPath = path.join(downloadDir, 'thunder-latest-x86_64-pc-windows-gnu.exe');
                break;
            case 'darwin':
                thunderPath = path.join(downloadDir, 'thunder-latest-x86_64-apple-darwin');
                break;
            default: // linux
                thunderPath = path.join(downloadDir, 'thunder-latest-x86_64-unknown-linux-gnu');
                break;
        }

        if (!fs.existsSync(thunderPath)) {
            throw new Error('Thunder executable not found');
        }

        if (os.platform() !== 'win32') {
            const { execSync } = require('child_process');
            execSync(`chmod +x "${thunderPath}"`);
        }

        const { spawn } = require('child_process');
        const process = spawn(thunderPath, [], {
            detached: true,
            stdio: 'ignore'
        });

        runningProcesses.thunder = process;

        res.json({
            success: true,
            message: 'Thunder started successfully',
            pid: process.pid
        });

    } catch (err) {
        console.error('Error starting Thunder:', err);
        res.status(500).json({
            success: false,
            error: err.message
        });
    }
});

app.get('/check-thunder', async (req, res) => {
    try {
        const dataDir = getDataDir();
        const downloadDir = path.join(dataDir, 'downloads', 'l2');
        
        let thunderPath = '';
        switch (os.platform()) {
            case 'win32':
                thunderPath = path.join(downloadDir, 'thunder-latest-x86_64-pc-windows-gnu.exe');
                break;
            case 'darwin':
                thunderPath = path.join(downloadDir, 'thunder-latest-x86_64-apple-darwin');
                break;
            default: // linux
                thunderPath = path.join(downloadDir, 'thunder-latest-x86_64-unknown-linux-gnu');
                break;
        }

        const exists = fs.existsSync(thunderPath);
        
        res.json({
            exists: exists,
            path: thunderPath
        });

    } catch (err) {
        console.error('Error checking Thunder:', err);
        res.status(500).json({
            exists: false,
            error: err.message
        });
    }
});

// Handle graceful shutdown
process.on('SIGTERM', shutdownGracefully);
process.on('SIGINT', shutdownGracefully);

// Handle uncaught exceptions
process.on('uncaughtException', async (error) => {
    console.error('Uncaught Exception:', error);
    await shutdownGracefully();
});

// Handle unhandled promise rejections
process.on('unhandledRejection', async (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    await shutdownGracefully();
});

// Start server
const PORT = 3000;
const server = app.listen(PORT, async () => {
    console.log(`Server running at http://localhost:${PORT}`);
    await ensureDirectories();
});

server.on('close', () => {
    console.log('Server closing...');
});
