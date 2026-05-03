const fs = require('fs');
const https = require('https');
const path = require('path');

const targetWordsUrl = 'https://raw.githubusercontent.com/KilledByAPixel/Wordle/main/words.js';

const dir = path.join(__dirname, '../server/data');
if (!fs.existsSync(dir)){
    fs.mkdirSync(dir, { recursive: true });
}

// Just a fallback small list if download fails, but let's try to fetch a known good list.
// A very reliable source is charlie-b/wordle-words
const TARGETS_URL = 'https://gist.githubusercontent.com/cfreshman/a03ef2cba789d8cf00c08f767e0fad7b/raw';
const GUESSES_URL = 'https://gist.githubusercontent.com/cfreshman/cdcdf777450c5b5301e439061d29694c/raw';

function downloadFile(url, dest) {
    return new Promise((resolve, reject) => {
        https.get(url, (res) => {
            if (res.statusCode !== 200) {
                return reject(new Error(`Failed to get '${url}' (${res.statusCode})`));
            }
            const file = fs.createWriteStream(dest);
            res.pipe(file);
            file.on('finish', () => {
                file.close();
                resolve();
            });
        }).on('error', (err) => {
            fs.unlink(dest, () => {});
            reject(err);
        });
    });
}

async function main() {
    try {
        console.log('Downloading targets.txt...');
        await downloadFile(TARGETS_URL, path.join(dir, 'targets.txt'));
        console.log('Downloading guesses.txt...');
        await downloadFile(GUESSES_URL, path.join(dir, 'guesses.txt'));
        
        // Convert txt to json for easier loading
        const targets = fs.readFileSync(path.join(dir, 'targets.txt'), 'utf-8').split('\n').map(w => w.trim()).filter(w => w.length === 5);
        const guesses = fs.readFileSync(path.join(dir, 'guesses.txt'), 'utf-8').split('\n').map(w => w.trim()).filter(w => w.length === 5);
        
        // Guesses list usually needs to include targets as well
        const allGuesses = Array.from(new Set([...targets, ...guesses]));

        fs.writeFileSync(path.join(dir, 'targets.json'), JSON.stringify(targets));
        fs.writeFileSync(path.join(dir, 'words.json'), JSON.stringify(allGuesses));
        
        fs.unlinkSync(path.join(dir, 'targets.txt'));
        fs.unlinkSync(path.join(dir, 'guesses.txt'));

        console.log(`Successfully created words.json (${allGuesses.length} words) and targets.json (${targets.length} words).`);
    } catch (e) {
        console.error('Error downloading word lists:', e.message);
        
        // Fallback minimal list if the URL fails
        console.log("Using fallback word list...");
        const fallbackTargets = ["apple", "grape", "peach", "berry", "mango"];
        fs.writeFileSync(path.join(dir, 'targets.json'), JSON.stringify(fallbackTargets));
        fs.writeFileSync(path.join(dir, 'words.json'), JSON.stringify(fallbackTargets));
    }
}

main();
