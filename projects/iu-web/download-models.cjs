const fs = require('fs');
const https = require('https');
const path = require('path');

const models = [
    'face_expression_model-shard1',
    'face_expression_model-weights_manifest.json',
    'face_landmark_68_model-shard1',
    'face_landmark_68_model-weights_manifest.json',
    'face_recognition_model-shard1',
    'face_recognition_model-shard2',
    'face_recognition_model-weights_manifest.json',
    'ssd_mobilenetv1_model-shard1',
    'ssd_mobilenetv1_model-shard2',
    'ssd_mobilenetv1_model-weights_manifest.json',
    'tiny_face_detector_model-shard1',
    'tiny_face_detector_model-weights_manifest.json'
];

const baseUrl = 'https://raw.githubusercontent.com/justadudewhohacks/face-api.js/master/weights';
const outputDir = path.join(__dirname, 'public', 'models');

if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
}

console.log('Downloading models to:', outputDir);

async function downloadFile(filename) {
    return new Promise((resolve, reject) => {
        const fileUrl = `${baseUrl}/${filename}`;
        const filePath = path.join(outputDir, filename);
        if (fs.existsSync(filePath)) {
            console.log(`Skipping ${filename} (already exists)`);
            resolve();
            return;
        }

        const file = fs.createWriteStream(filePath);
        console.log(`Downloading ${filename}...`);

        https.get(fileUrl, response => {
            if (response.statusCode !== 200) {
                reject(new Error(`Failed to download ${filename}: ${response.statusCode}`));
                return;
            }
            response.pipe(file);
            file.on('finish', () => {
                file.close();
                console.log(`Downloaded ${filename}`);
                resolve();
            });
        }).on('error', err => {
            fs.unlink(filePath, () => { }); // Delete failed file
            reject(err);
        });
    });
}

(async () => {
    try {
        for (const model of models) {
            await downloadFile(model);
        }
        console.log('All models downloaded successfully!');
    } catch (error) {
        console.error('Error downloading models:', error);
        process.exit(1);
    }
})();
