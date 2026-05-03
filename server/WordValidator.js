const fs = require('fs');
const path = require('path');

class WordValidator {
    constructor() {
        this.allowedWords = new Set();
        this.targetWords = [];
        this.loadDictionaries();
    }

    loadDictionaries() {
        try {
            const wordsPath = path.join(__dirname, 'data', 'words.json');
            const targetsPath = path.join(__dirname, 'data', 'targets.json');

            const wordsData = JSON.parse(fs.readFileSync(wordsPath, 'utf-8'));
            this.allowedWords = new Set(wordsData);

            this.targetWords = JSON.parse(fs.readFileSync(targetsPath, 'utf-8'));
            console.log(`WordValidator: Loaded ${this.allowedWords.size} allowed words and ${this.targetWords.length} target words.`);
        } catch (e) {
            console.error("Failed to load dictionaries, please ensure data/words.json and data/targets.json exist.", e.message);
            // Fallback for tests
            this.targetWords = ["apple"];
            this.allowedWords = new Set(["apple", "grape", "peach", "berry"]);
        }
    }

    isValidGuess(word) {
        return this.allowedWords.has(word.toLowerCase());
    }

    getRandomTarget() {
        const randomIndex = Math.floor(Math.random() * this.targetWords.length);
        return this.targetWords[randomIndex].toLowerCase();
    }

    /**
     * Evaluates a guess against the target word.
     * Returns an array of statuses: 'green', 'yellow', or 'gray'
     */
    evaluateGuess(guess, target) {
        guess = guess.toLowerCase();
        target = target.toLowerCase();
        
        const result = new Array(5).fill('gray');
        const targetChars = target.split('');
        
        // First pass: find exact matches (green)
        for (let i = 0; i < 5; i++) {
            if (guess[i] === target[i]) {
                result[i] = 'green';
                targetChars[i] = null; // Mark as consumed
            }
        }
        
        // Second pass: find partial matches (yellow)
        for (let i = 0; i < 5; i++) {
            if (result[i] !== 'green') {
                const char = guess[i];
                const targetIndex = targetChars.indexOf(char);
                if (targetIndex !== -1) {
                    result[i] = 'yellow';
                    targetChars[targetIndex] = null; // Mark as consumed
                }
            }
        }
        
        return result;
    }
}

module.exports = new WordValidator();
