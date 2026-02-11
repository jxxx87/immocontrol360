const express = require('express');
const puppeteer = require('puppeteer');
const cors = require('cors');
const bodyParser = require('body-parser');

const app = express();
const port = 3001;

app.use(cors());
// Increased limit for large HTML payloads
app.use(bodyParser.json({ limit: '10mb' }));

app.post('/generate-pdf', async (req, res) => {
    let browser;
    try {
        const { html, landscape } = req.body;

        if (!html) {
            return res.status(400).send('HTML content missing');
        }

        browser = await puppeteer.launch({
            headless: 'new',
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });

        const page = await browser.newPage();

        // Wait until network is idle so images load
        await page.setContent(html, { waitUntil: 'networkidle0' });

        // Generate PDF
        const pdfBuffer = await page.pdf({
            format: 'A4',
            printBackground: true,
            margin: { top: 0, right: 0, bottom: 0, left: 0 },
            landscape: !!landscape
        });

        res.set({
            'Content-Type': 'application/pdf',
            'Content-Disposition': 'attachment; filename=Rechnung.pdf',
            'Content-Length': pdfBuffer.length
        });

        res.send(pdfBuffer);

    } catch (error) {
        console.error('PDF Generation Error:', error);
        res.status(500).send('Error generating PDF');
    } finally {
        if (browser) await browser.close();
    }
});

app.listen(port, () => {
    console.log(`PDF Server running at http://localhost:${port}`);
});
