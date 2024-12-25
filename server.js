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
    bitcoin: null,
    enforcer: null,
    bitwindow: null,
    thunder: null
};

// When starting processes, store their PIDs
function trackProcess(process, name) {
    runningProcesses[name] = process;
    process.pid && console.log(`${name} started with PID: ${process.pid}`);
}



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

// Serve index.html
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Helper function to handle downloads with proper headers
async function downloadFile(url, downloadPath, retries = 3) {
    return new Promise((resolve, reject) => {
        const attemptDownload = (attemptsLeft) => {
            const options = {
                headers: {
                    'User-Agent': 'CUSF-Launcher'
                },
                timeout: 10000 // 10 second timeout
            };

            const request = https.get(url, options, (response) => {
                if (response.statusCode === 302 || response.statusCode === 301) {
                    downloadFile(response.headers.location, downloadPath)
                        .then(resolve)
                        .catch(reject);
                    return;
                }

                if (response.statusCode !== 200) {
                    if (attemptsLeft > 0) {
                        console.log(`Retry attempt ${4-attemptsLeft} for ${url}`);
                        setTimeout(() => attemptDownload(attemptsLeft - 1), 2000);
                        return;
                    }
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
                    fs.unlink(downloadPath, () => {});
                    if (attemptsLeft > 0) {
                        console.log(`Retry attempt ${4-attemptsLeft} for ${url}`);
                        setTimeout(() => attemptDownload(attemptsLeft - 1), 2000);
                    } else {
                        reject(err);
                    }
                });
            });

            request.on('error', (err) => {
                if (attemptsLeft > 0) {
                    console.log(`Retry attempt ${4-attemptsLeft} for ${url}`);
                    setTimeout(() => attemptDownload(attemptsLeft - 1), 2000);
                } else {
                    fs.unlink(downloadPath, () => {});
                    reject(err);
                }
            });

            request.on('timeout', () => {
                request.destroy();
                if (attemptsLeft > 0) {
                    console.log(`Timeout - Retry attempt ${4-attemptsLeft} for ${url}`);
                    setTimeout(() => attemptDownload(attemptsLeft - 1), 2000);
                } else {
                    reject(new Error('Request timeout'));
                }
            });
        };

        attemptDownload(retries);
    });
}






async function shutdownGracefully() {
    console.log('Shutting down gracefully...');
    
    const killProcess = async (process, name, timeout = 5000) => {
        if (process) {
            return new Promise((resolve) => {
                console.log(`Stopping ${name}...`);
                
                const timeoutId = setTimeout(() => {
                    console.log(`Force killing ${name}`);
                    try {
                        process.kill('SIGKILL');
                    } catch (error) {
                        console.error(`Error force killing ${name}:`, error);
                    }
                    resolve();
                }, timeout);

                try {
                    // For bitcoind, try to stop it gracefully first using RPC
                    if (name === 'Bitcoin') {
                        try {
                            // Send stop command to Bitcoin via RPC
                            const http = require('http');
                            const options = {
                                hostname: 'localhost',
                                port: 38332,
                                path: '/',
                                method: 'POST',
                                headers: {
                                    'Content-Type': 'application/json',
                                },
                                auth: 'user:password'
                            };

                            const req = http.request(options);
                            req.write(JSON.stringify({
                                jsonrpc: '1.0',
                                id: 'shutdown',
                                method: 'stop',
                                params: []
                            }));
                            req.end();

                            console.log('Bitcoin stop command sent via RPC');
                        } catch (error) {
                            console.error('Error sending Bitcoin stop command:', error);
                        }
                    }

                    // Send SIGTERM first for graceful shutdown
                    process.kill('SIGTERM');
                } catch (error) {
                    console.error(`Error sending SIGTERM to ${name}:`, error);
                }
                
                process.on('exit', () => {
                    clearTimeout(timeoutId);
                    console.log(`${name} stopped`);
                    resolve();
                });
            });
        }
        return Promise.resolve();
    };

    try {
        // Shutdown in specific order
        await killProcess(runningProcesses.thunder, 'Thunder');
        await killProcess(runningProcesses.bitwindow, 'BitWindow');
        
        // Give enforcer more time to shut down
        await killProcess(runningProcesses.enforcer, 'Enforcer', 10000);
        
        // Give Bitcoin even more time to shut down gracefully
        await killProcess(runningProcesses.bitcoin, 'Bitcoin', 15000);

        // Double check if processes are still running
        const checkProcesses = async () => {
            const { exec } = require('child_process');
            return new Promise((resolve) => {
                exec('ps aux | grep -E "bitcoind|enforcer"', (error, stdout, stderr) => {
                    if (stdout) {
                        console.log('Remaining processes:', stdout);
                        // Force kill any remaining processes
                        exec('pkill -9 -f "bitcoind|enforcer"', () => {
                            resolve();
                        });
                    } else {
                        resolve();
                    }
                });
            });
        };

        await checkProcesses();

    } catch (error) {
        console.error('Error during shutdown:', error);
        // Force kill everything if there's an error
        try {
            const { exec } = require('child_process');
            exec('pkill -9 -f "bitcoind|enforcer|bitwindow|thunder"');
        } catch (err) {
            console.error('Error force killing processes:', err);
        }
    }

    // Exit the process
    process.exit(0);
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

        // Unref the process so it can run independently
        //process.unref();

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



app.get('/start-bitcoin', async (req, res) => {
    try {
        const dataDir = getDataDir();
        const downloadDir = path.join(dataDir, 'downloads', 'l1');
        
        let bitcoinPath = '';
        switch (os.platform()) {
            case 'win32':
                bitcoinPath = path.join(downloadDir, 'L1-bitcoin-patched-latest-x86_64-w64-msvc/Release/bitcoind.exe');
                break;
            case 'darwin':
                bitcoinPath = path.join(downloadDir, 'L1-bitcoin-patched-latest-x86_64-apple-darwin/bitcoind');
                break;
            default: // linux
                bitcoinPath = path.join(downloadDir, 'L1-bitcoin-patched-latest-x86_64-unknown-linux-gnu/bitcoind');
                break;
        }

        if (!fs.existsSync(bitcoinPath)) {
            throw new Error('Bitcoin executable not found');
        }

        if (os.platform() !== 'win32') {
            const { execSync } = require('child_process');
            execSync(`chmod +x "${bitcoinPath}"`);
        }

        const { spawn } = require('child_process');
        const process = spawn(bitcoinPath, [], {
            detached: true,
            stdio: 'ignore'
        });

        runningProcesses.bitcoin = process;

        res.json({
            success: true,
            message: 'Bitcoin started successfully',
            pid: process.pid
        });

    } catch (err) {
        console.error('Error starting Bitcoin:', err);
        res.status(500).json({
            success: false,
            error: err.message
        });
    }
});

app.get('/start-enforcer', async (req, res) => {
    try {
        const dataDir = getDataDir();
        const downloadDir = path.join(dataDir, 'downloads', 'l1');
        
        let enforcerPath = '';
        switch (os.platform()) {
            case 'win32':
                enforcerPath = path.join(downloadDir, 'bip300301-enforcer-latest-x86_64-pc-windows-gnu.exe/bip300301_enforcer-0.1.0-x86_64-pc-windows-gnu.exe');
                break;
            case 'darwin':
                enforcerPath = path.join(downloadDir, 'bip300301-enforcer-latest-x86_64-apple-darwin/bip300301_enforcer-0.1.0-x86_64-apple-darwin');
                break;
            default: // linux
                enforcerPath = path.join(downloadDir, 'bip300301-enforcer-latest-x86_64-unknown-linux-gnu/bip300301_enforcer-0.1.0-x86_64-unknown-linux-gnu');
                break;
        }

        if (!fs.existsSync(enforcerPath)) {
            throw new Error('Enforcer executable not found');
        }

        if (os.platform() !== 'win32') {
            const { execSync } = require('child_process');
            execSync(`chmod +x "${enforcerPath}"`);
        }

        const { spawn } = require('child_process');
        const process = spawn(enforcerPath, [
            "--node-rpc-addr=localhost:38332",
            "--node-rpc-user=user",
            "--node-rpc-pass=password",
            "--node-zmq-addr-sequence=tcp://localhost:29000",
            "--enable-wallet"
        ], {
            detached: true,
            stdio: 'ignore'
        });

        runningProcesses.enforcer = process;

        res.json({
            success: true,
            message: 'Enforcer started successfully',
            pid: process.pid
        });

    } catch (err) {
        console.error('Error starting Enforcer:', err);
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

        //process.unref();

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


app.get('/stop-bitcoin', async (req, res) => {
    try {
        const http = require('http');
        const options = {
            hostname: 'localhost',
            port: 38332,
            path: '/',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            auth: 'user:password'
        };

        const request = http.request(options, (response) => {
            let data = '';
            response.on('data', (chunk) => {
                data += chunk;
            });
            response.on('end', () => {
                console.log('Bitcoin stop command response:', data);
                res.json({ success: true });
            });
        });

        request.on('error', (error) => {
            console.error('Error stopping Bitcoin:', error);
            res.status(500).json({ success: false, error: error.message });
        });

        request.write(JSON.stringify({
            jsonrpc: '1.0',
            id: 'shutdown',
            method: 'stop',
            params: []
        }));
        request.end();

    } catch (err) {
        console.error('Error stopping Bitcoin:', err);
        res.status(500).json({ success: false, error: err.message });
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
