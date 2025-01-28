const express = require('express');
const path = require('path');
const fs = require('fs');
const https = require('https');
const os = require('os');
const extract = require('extract-zip');
const { exec } = require('child_process');
const util = require('util');
const execAsync = util.promisify(exec);
const { execSync } = require('child_process');


const app = express();


// Serve static files
app.use(express.static('public'));

let runningProcesses = {
    bitcoin: null,
    enforcer: null,
    bitwindow: null,
    thunder: null,
    bitnames: null
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
            return 'https://github.com/fullstorydev/grpcurl/releases/download/v1.9.2/grpcurl_1.9.2_linux_x86_64.tar.gz';
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

function getBitNamesUrl() {
    switch (os.platform()) {
        case 'win32':
            return 'https://releases.drivechain.info/L2-S2-BitNames-latest-x86_64-pc-windows-gnu.zip';
        case 'darwin':
            return 'https://releases.drivechain.info/L2-S2-BitNames-latest-x86_64-apple-darwin.zip';
        default: // linux
            return 'https://releases.drivechain.info/L2-S2-BitNames-latest-x86_64-unknown-linux-gnu.zip';
    }
}


// Get appropriate data directory based on OS
function getDataDir() {
    const baseDir = os.platform() === 'win32' 
        ? path.join(os.homedir(), 'AppData', 'Roaming', 'cusf_launcher')
        : os.platform() === 'darwin'
            ? path.join(os.homedir(), 'Library', 'Application Support', 'cusf_launcher')
            : path.join(os.homedir(), '.local', 'share', 'cusf_launcher');

    return {
        base: baseDir,
        l1: path.join(baseDir, 'l1'),
        l2: path.join(baseDir, 'l2'),
        thunder: path.join(baseDir, 'l2', 'thunder'),
        bitnames: path.join(baseDir, 'l2', 'bitnames')
    };
}

// Serve index.html
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});




// Helper function to handle downloads with proper headers
async function downloadFile(url, downloadPath, retries = 3) {
    return new Promise((resolve, reject) => {
        const attemptDownload = (attemptsLeft) => {
            console.log(`Attempting download of ${url}, attempts left: ${attemptsLeft}`);
            
            const options = {
                headers: {
                    'User-Agent': 'CUSF-Launcher'
                },
                timeout: 30000 // Increase timeout to 30 seconds
            };

            const request = https.get(url, options, (response) => {
                console.log(`Response status for ${url}: ${response.statusCode}`);
                
                if (response.statusCode === 302 || response.statusCode === 301) {
                    console.log(`Following redirect to ${response.headers.location}`);
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
                    console.log(`Download completed for ${url}`);
                    resolve();
                });

                fileStream.on('error', (err) => {
                    console.error(`File stream error for ${url}:`, err);
                    fs.unlink(downloadPath, () => {});
                    if (attemptsLeft > 0) {
                        setTimeout(() => attemptDownload(attemptsLeft - 1), 2000);
                    } else {
                        reject(err);
                    }
                });
            });

            request.on('error', (err) => {
                console.error(`Request error for ${url}:`, err);
                if (attemptsLeft > 0) {
                    setTimeout(() => attemptDownload(attemptsLeft - 1), 2000);
                } else {
                    fs.unlink(downloadPath, () => {});
                    reject(err);
                }
            });

            request.on('timeout', () => {
                console.log(`Request timeout for ${url}`);
                request.destroy();
                if (attemptsLeft > 0) {
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




// Add this helper function to verify if a file exists and has content
async function verifyFile(filePath) {
    try {
        const stats = await fs.promises.stat(filePath);
        console.log(`Verifying ${filePath}: size = ${stats.size} bytes`);
        return stats.size > 0;
    } catch (err) {
        console.log(`File ${filePath} does not exist or cannot be accessed:`, err.message);
        return false;
    }
}async function verifyFile(filePath) {
    try {
        const stats = await fs.promises.stat(filePath);
        return stats.size > 0;
    } catch (err) {
        return false;
    }
}

// Modify the download-l1 endpoint to check files first
// Add a request counter
let downloadRequestCount = 0;


app.get('/download-l1', async (req, res) => {
    downloadRequestCount++;
    console.log(`Download L1 request #${downloadRequestCount}`);
    console.log('Request headers:', req.headers);
    
    try {
        const dirs = getDataDir();
        const l1Dir = dirs.l1;  
        await fs.promises.mkdir(l1Dir, { recursive: true });

        // Log the directory contents before download
        const existingFiles = await fs.promises.readdir(l1Dir);
        console.log('Existing files before download:', existingFiles);

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

        // Force download all files
        for (const download of downloads) {
            const downloadPath = path.join(l1Dir, download.filename);  // Use l1Dir here
            console.log(`Starting download of ${download.url} to ${downloadPath}`);
            
            try {
                await downloadFile(download.url, downloadPath);
                const verified = await verifyFile(downloadPath);
                if (!verified) {
                    throw new Error(`Downloaded file ${download.filename} is empty or invalid`);
                }
                console.log(`Successfully downloaded ${download.filename}`);
            } catch (err) {
                console.error(`Error downloading ${download.filename}:`, err);
                throw err;
            }
        }

        // Verify downloads after completion
        const finalFiles = await fs.promises.readdir(l1Dir);
        console.log('Files after download:', finalFiles);

        res.json({
            success: true,
            message: 'Downloads complete',
            path: l1Dir,
            files: finalFiles
        });

    } catch (err) {
        console.error('Download error:', err);
        res.status(500).json({
            success: false,
            error: err.message
        });
    }
});

async function createBitcoinConfig() {
    try {
        // Get home directory and create .drivechain directory if it doesn't exist
        const drivechainDir = path.join(os.homedir(), '.drivechain');
        await fs.promises.mkdir(drivechainDir, { recursive: true });

        // Bitcoin config content
        
        
        
        
      const configContent = `# Generated by cusf_launcher
rpcuser=user
rpcpassword=password
zmqpubsequence=tcp://localhost:29000
txindex=1
server=1
signet=1
fallbackfee=0.00021
[signet]
addnode=172.105.148.135:38333
signetblocktime=60
signetchallenge=00141551188e5153533b4fdd555449e640d9cc129456`;



/*

        const configContent = `# Generated by cusf_launcher
rpcuser=user
rpcpassword=password
zmqpubsequence=tcp://localhost:29000
txindex=1
server=1
signet=1
fallbackfee=0.00021
[signet]
addnode=drivechain.live:8383
signetblocktime=60
signetchallenge=00141f61d57873d70d28bd28b3c9f9d6bf818b5a0d6a
rpcallowip=127.0.0.1
rpcbind=127.0.0.1:38332`;

*/



        // Write the config file
        const configPath = path.join(drivechainDir, 'bitcoin.conf');
        await fs.promises.writeFile(configPath, configContent, 'utf8');
        console.log('Bitcoin config file created at:', configPath);
        return true;
    } catch (err) {
        console.error('Error creating bitcoin config:', err);
        return false;
    }
}

app.get('/extract-l1', async (req, res) => {
    try {
        const dirs = getDataDir();
        const l1Dir = dirs.l1;  
        
        // List of files to extract
        const files = [
            'bitcoinpatched.zip',
            'bitwindow.zip',
            '300301enforcer.zip'
        ];

        // Handle grpcurl separately
        const grpcurlFile = os.platform() === 'win32' ? 'grpcurl.zip' : 'grpcurl.tar.gz';
        const grpcurlPath = path.join(l1Dir, grpcurlFile);  // Use l1Dir here

        if (fs.existsSync(grpcurlPath)) {
            console.log(`Extracting ${grpcurlFile}`);
            if (grpcurlFile.endsWith('.zip')) {
                await extract(grpcurlPath, { dir: l1Dir });  // Use l1Dir here
            } else {
                const { execSync } = require('child_process');
                execSync(`tar -xzf "${grpcurlPath}" -C "${l1Dir}"`);  // Use l1Dir here
            }

            // Make grpcurl executable on Unix systems
            if (os.platform() !== 'win32') {
                const { execSync } = require('child_process');
                execSync(`chmod +x "${path.join(l1Dir, 'grpcurl')}"`);  // Use l1Dir here
            }
        }

        // Extract other files
        for (const file of files) {
            const filePath = path.join(l1Dir, file);  // Use l1Dir here
            
            if (!fs.existsSync(filePath)) {
                console.log(`File not found: ${file}, skipping...`);
                continue;
            }

            console.log(`Extracting ${file}`);
            await extract(filePath, { dir: l1Dir });  // Use l1Dir here
        }

        // Create bitcoin.conf after successful extraction
        const configCreated = await createBitcoinConfig();
        if (!configCreated) {
            throw new Error('Failed to create bitcoin.conf');
        }

        res.json({
            success: true,
            message: 'All extractions complete and bitcoin.conf created',
            path: l1Dir  // Use l1Dir here
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
const dirs = getDataDir();
const l1Dir = dirs.l1;  // or dirs.thunder, dirs.bitnames etc.
        
        // Determine BitWindow executable path based on OS
        let bitwindowPath = '';
        switch (os.platform()) {
            case 'win32':
                bitwindowPath = path.join(l1Dir, 'bitwindow.exe');
                break;
            case 'darwin':
                bitwindowPath = path.join(l1Dir, 'bitwindow');
                break;
            default: // linux
                bitwindowPath = path.join(l1Dir, 'bitwindow');
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



app.get('/start-bitcoin', async (req, res) => {
    try {
 const dirs = getDataDir();
const l1Dir = dirs.l1;  // or dirs.thunder, dirs.bitnames etc.
        
        let bitcoinPath = '';
        switch (os.platform()) {
            case 'win32':
                bitcoinPath = path.join(l1Dir, 'L1-bitcoin-patched-latest-x86_64-w64-msvc/Release/bitcoind.exe');
                break;
            case 'darwin':
                bitcoinPath = path.join(l1Dir, 'L1-bitcoin-patched-latest-x86_64-apple-darwin/bitcoind');
                break;
            default: // linux
                bitcoinPath = path.join(l1Dir, 'L1-bitcoin-patched-latest-x86_64-unknown-linux-gnu/bitcoind');
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
      const dirs = getDataDir();
const l1Dir = dirs.l1;  // or dirs.thunder, dirs.bitnames etc.
        
        let enforcerPath = '';
        switch (os.platform()) {
            case 'win32':
                enforcerPath = path.join(l1Dir, 'bip300301-enforcer-latest-x86_64-pc-windows-gnu.exe/bip300301_enforcer-0.2.0-x86_64-pc-windows-gnu.exe');
                break;
            case 'darwin':
                enforcerPath = path.join(l1Dir, 'bip300301-enforcer-latest-x86_64-apple-darwin/bip300301_enforcer-0.2.0-x86_64-apple-darwin');
                break;
            default: // linux
                enforcerPath = path.join(l1Dir, 'bip300301-enforcer-latest-x86_64-unknown-linux-gnu/bip300301_enforcer-0.2.0-x86_64-unknown-linux-gnu');
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



// Add this new endpoint for creating wallet
app.get('/create-wallet', async (req, res) => {
    try {
        const dirs = getDataDir();
        const l1Dir = dirs.l1;
        
        // Determine grpcurl path based on OS
        let grpcurlPath = '';
        switch (os.platform()) {
            case 'win32':
                grpcurlPath = path.join(l1Dir, 'grpcurl.exe');
                break;
            default: // linux and darwin
                grpcurlPath = path.join(l1Dir, 'grpcurl');
                break;
        }

        // Make grpcurl executable on Unix systems
        if (os.platform() !== 'win32') {
            await execAsync(`chmod +x "${grpcurlPath}"`);
        }

        // Execute the grpcurl command
        const { stdout, stderr } = await execAsync(
            `"${grpcurlPath}" -plaintext localhost:50051 cusf.mainchain.v1.WalletService/CreateWallet`
        );

        console.log('Wallet creation output:', stdout);
        if (stderr) console.error('Wallet creation stderr:', stderr);

        res.json({
            success: true,
            message: 'Wallet created successfully'
        });

    } catch (err) {
        console.error('Error creating wallet:', err);
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
const l1Dir = dataDir.l1;  // or dirs.thunder, dirs.bitnames etc.
        
        // Determine BitWindow executable path based on OS
        let bitwindowPath = '';
        switch (os.platform()) {
            case 'win32':
                bitwindowPath = path.join(l1Dir, 'bitwindow.exe');
                break;
            case 'darwin':
                bitwindowPath = path.join(l1Dir, 'bitwindow');
                break;
            default: // linux
                bitwindowPath = path.join(l1Dir, 'bitwindow');
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


const ensureDirectories = async () => {
    try {
        const dirs = getDataDir();
        await fs.promises.mkdir(dirs.l1, { recursive: true });
        await fs.promises.mkdir(dirs.thunder, { recursive: true });
        await fs.promises.mkdir(dirs.bitnames, { recursive: true });
        console.log('Directories created/verified at:', dirs.base);
    } catch (err) {
        console.error('Failed to create directories:', err);
    }
};







// Thunder download and extract endpoints
app.get('/download-thunder', async (req, res) => {
    try {
        const dirs = getDataDir();
        const downloadPath = path.join(dirs.thunder, 'thunder.zip');
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
            path: dirs.thunder
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
        const dirs = getDataDir();
        const downloadPath = path.join(dirs.thunder, 'thunder.zip');

        if (!fs.existsSync(downloadPath)) {
            throw new Error('Thunder zip file not found');
        }

        await extract(downloadPath, { dir: dirs.thunder });

        res.json({
            success: true,
            message: 'Thunder extraction complete',
            path: dirs.thunder
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
const dirs = getDataDir();
const l2Dir = dirs.thunder;  // or dirs.thunder, dirs.bitnames etc.// or dirs.thunder, dirs.bitnames etc.
        
        let thunderPath = '';
        switch (os.platform()) {
            case 'win32':
                thunderPath = path.join(l2Dir, 'thunder-latest-x86_64-pc-windows-gnu.exe');
                break;
            case 'darwin':
                thunderPath = path.join(l2Dir, 'thunder-latest-x86_64-apple-darwin');
                break;
            default: // linux
                thunderPath = path.join(l2Dir, 'thunder-latest-x86_64-unknown-linux-gnu');
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
const dirs = getDataDir();
const l2Dir = dirs.thunder;  // or dirs.thunder, dirs.bitnames etc.
        
        let thunderPath = '';
        switch (os.platform()) {
            case 'win32':
                thunderPath = path.join(l2Dir, 'thunder-latest-x86_64-pc-windows-gnu.exe');
                break;
            case 'darwin':
                thunderPath = path.join(l2Dir, 'thunder-latest-x86_64-apple-darwin');
                break;
            default: // linux
                thunderPath = path.join(l2Dir, 'thunder-latest-x86_64-unknown-linux-gnu');
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


// BitNames download endpoint
app.get('/download-bitnames', async (req, res) => {
    try {
        const dirs = getDataDir();
        const downloadPath = path.join(dirs.bitnames, 'bitnames.zip');
        console.log(`Downloading BitNames to ${downloadPath}`);
        
        await downloadFile(getBitNamesUrl(), downloadPath);
        
        // Verify file exists and has content
        const stats = await fs.promises.stat(downloadPath);
        if (stats.size === 0) {
            throw new Error('Downloaded BitNames file is empty');
        }

        res.json({
            success: true,
            message: 'BitNames download complete',
            path: dirs.bitnames
        });

    } catch (err) {
        console.error('BitNames download error:', err);
        res.status(500).json({
            success: false,
            error: err.message
        });
    }
});

// BitNames extract endpoint
app.get('/extract-bitnames', async (req, res) => {
    try {
        const dirs = getDataDir();
        const downloadPath = path.join(dirs.bitnames, 'bitnames.zip');

        if (!fs.existsSync(downloadPath)) {
            throw new Error('BitNames zip file not found');
        }

        await extract(downloadPath, { dir: dirs.bitnames });

        res.json({
            success: true,
            message: 'BitNames extraction complete',
            path: dirs.bitnames
        });
    } catch (err) {
        console.error('BitNames extraction error:', err);
        res.status(500).json({
            success: false,
            error: err.message
        });
    }
});

// BitNames start endpoint
app.get('/start-bitnames', async (req, res) => {
    try {
const dirs = getDataDir();
const l2Dir = dirs.bitnames;  // or dirs.thunder, dirs.bitnames etc.
        
        let bitnamesPath = '';
        switch (os.platform()) {
            case 'win32':
                bitnamesPath = path.join(l2Dir, 'bitnames-latest-x86_64-pc-windows-gnu.exe');
                break;
            case 'darwin':
                bitnamesPath = path.join(l2Dir, 'bitnames-latest-x86_64-apple-darwin');
                break;
            default: // linux
                bitnamesPath = path.join(l2Dir, 'bitnames-latest-x86_64-unknown-linux-gnu');
                break;
        }

        if (!fs.existsSync(bitnamesPath)) {
            throw new Error('BitNames executable not found');
        }

        if (os.platform() !== 'win32') {
            const { execSync } = require('child_process');
            execSync(`chmod +x "${bitnamesPath}"`);
        }

        const { spawn } = require('child_process');
        const process = spawn(bitnamesPath, [], {
            detached: true,
            stdio: 'ignore'
        });

        runningProcesses.bitnames = process;

        res.json({
            success: true,
            message: 'BitNames started successfully',
            pid: process.pid
        });

    } catch (err) {
        console.error('Error starting BitNames:', err);
        res.status(500).json({
            success: false,
            error: err.message
        });
    }
});

// BitNames check endpoint
app.get('/check-bitnames', async (req, res) => {
    try {
const dirs = getDataDir();
const l2Dir = dirs.bitnames; // or dirs.thunder, dirs.bitnames etc.
        
        let bitnamesPath = '';
        switch (os.platform()) {
            case 'win32':
                bitnamesPath = path.join(l2Dir, 'bitnames-latest-x86_64-pc-windows-gnu.exe');
                break;
            case 'darwin':
                bitnamesPath = path.join(l2Dir, 'bitnames-latest-x86_64-apple-darwin');
                break;
            default: // linux
                bitnamesPath = path.join(l2Dir, 'bitnames-latest-x86_64-unknown-linux-gnu');
                break;
        }

        const exists = fs.existsSync(bitnamesPath);
        
        res.json({
            exists: exists,
            path: bitnamesPath
        });

    } catch (err) {
        console.error('Error checking BitNames:', err);
        res.status(500).json({
            exists: false,
            error: err.message
        });
    }
});




// Add this near your other endpoints
app.post('/reset-folders', async (req, res) => {
    try {
        const homeDir = os.homedir();
        const foldersToDelete = [
            path.join(homeDir, '.drivechain'),
            path.join(homeDir, '.local', 'share', 'cusf_launcher'),
            path.join(homeDir, '.local', 'share', 'bitwindow'),
            path.join(homeDir, '.local', 'share', 'bip300301_enforcer'),
            path.join(homeDir, '.local', 'share', 'bitwindowd'),
            path.join(homeDir, '.local', 'share', 'com.layertwolabs.bitwindow')
        ];

        // First try to stop all running processes
       // await shutdownGracefully();

        // Delete folders
        for (const folder of foldersToDelete) {
            if (fs.existsSync(folder)) {
                if (os.platform() === 'win32') {
                    await execAsync(`rmdir /s /q "${folder}"`);
                } else {
                    await execAsync(`rm -rf "${folder}"`);
                }
                console.log(`Deleted folder: ${folder}`);
            }
        }

        res.json({ success: true });
    } catch (error) {
        console.error('Error during reset:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});


app.delete('/delete-l1', async (req, res) => {
    try {
    const dirs = getDataDir();
const l1Dir = dirs.l1;  // or dirs.thunder, dirs.bitnames etc.

        if (fs.existsSync(l1Dir)) {
            if (os.platform() === 'win32') {
                // For Windows
                await execAsync(`rmdir /s /q "${l1Dir}"`);
            } else {
                // For Linux/MacOS
                await execAsync(`rm -rf "${l1Dir}"`);
            }
        }

        res.json({ 
            success: true,
            message: 'L1 folder deleted successfully'
        });
    } catch (error) {
        console.error('Error deleting L1 folder:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// Add these new endpoints for deleting Thunder and BitNames folders
app.delete('/delete-thunder', async (req, res) => {
    try {
        const dirs = getDataDir();
        const thunderDir = dirs.thunder;
        const localThunderDir = path.join(os.homedir(), '.local', 'share', 'thunder');

        // Delete the thunder directory in cusf_launcher
        if (fs.existsSync(thunderDir)) {
            if (os.platform() === 'win32') {
                await execAsync(`rmdir /s /q "${thunderDir}"`);
            } else {
                await execAsync(`rm -rf "${thunderDir}"`);
            }
        }

        // Delete the .local/share/thunder directory
        if (fs.existsSync(localThunderDir)) {
            if (os.platform() === 'win32') {
                await execAsync(`rmdir /s /q "${localThunderDir}"`);
            } else {
                await execAsync(`rm -rf "${localThunderDir}"`);
            }
        }

        res.json({ success: true });
    } catch (error) {
        console.error('Error deleting Thunder folders:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

app.delete('/delete-bitnames', async (req, res) => {
    try {
        const dirs = getDataDir();
        const bitnamesDir = dirs.bitnames;
        const localBitnamesDir = path.join(os.homedir(), '.local', 'share', 'bitnames');

        // Delete the bitnames directory in cusf_launcher
        if (fs.existsSync(bitnamesDir)) {
            if (os.platform() === 'win32') {
                await execAsync(`rmdir /s /q "${bitnamesDir}"`);
            } else {
                await execAsync(`rm -rf "${bitnamesDir}"`);
            }
        }

        // Delete the .local/share/bitnames directory
        if (fs.existsSync(localBitnamesDir)) {
            if (os.platform() === 'win32') {
                await execAsync(`rmdir /s /q "${localBitnamesDir}"`);
            } else {
                await execAsync(`rm -rf "${localBitnamesDir}"`);
            }
        }

        res.json({ success: true });
    } catch (error) {
        console.error('Error deleting BitNames folders:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

app.post('/stop-l1', async (req, res) => {
    try {
        // Stop BitWindow first
        if (runningProcesses.bitwindow) {
            runningProcesses.bitwindow.kill();
        }
        
        // Stop Enforcer
        if (runningProcesses.enforcer) {
            runningProcesses.enforcer.kill();
        }
        
        // Stop Bitcoin last (give it more time to shut down gracefully)
        if (runningProcesses.bitcoin) {
            runningProcesses.bitcoin.kill();
            // Wait for Bitcoin to shut down
            await new Promise(resolve => setTimeout(resolve, 5000));
        }

        // Clear the running processes
        runningProcesses.bitwindow = null;
        runningProcesses.enforcer = null;
        runningProcesses.bitcoin = null;
        
        res.json({
            success: true,
            message: 'All L1 processes stopped'
        });
    } catch (err) {
        console.error('Error stopping L1 processes:', err);
        res.status(500).json({
            success: false,
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
const PORT = 3001;
const server = app.listen(PORT, async () => {
    console.log(`Server running at http://localhost:${PORT}`);
    await ensureDirectories();
});

server.on('close', () => {
    console.log('Server closing...');
});
