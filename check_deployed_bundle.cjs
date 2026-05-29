const https = require('https');

const url = 'https://app.immocontrol360.de/assets/index-CdBAav69.js';

https.get(url, (res) => {
    let data = '';
    res.on('data', (chunk) => {
        data += chunk;
    });
    res.on('end', () => {
        console.log("File downloaded. Length:", data.length);
        console.log("Status Code:", res.statusCode);
        console.log("Headers:", res.headers);
        const containsTiptapImage = data.includes('TiptapImage') || data.includes('tiptapImage');
        console.log("Contains 'TiptapImage' / 'tiptapImage':", containsTiptapImage);
        const containsErrorBoundary = data.includes('ErrorBoundary');
        console.log("Contains 'ErrorBoundary':", containsErrorBoundary);
    });
}).on('error', (err) => {
    console.error("Error fetching file:", err);
});
