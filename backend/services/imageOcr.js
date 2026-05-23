/**
 * Image OCR Service
 * Extracts text from images embedded in emails (e.g. screenshots pasted by users).
 * Uses Tesseract.js — pure JavaScript OCR, no system dependencies.
 */

let Tesseract;
let tesseractAvailable = false;

// Lazy-load Tesseract to avoid startup failures if not installed
async function getTesseract() {
  if (!Tesseract) {
    try {
      Tesseract = require('tesseract.js');
      tesseractAvailable = true;
      console.log('[imageOcr] tesseract.js loaded');
    } catch (e) {
      console.warn('[imageOcr] tesseract.js not available:', e.message);
      tesseractAvailable = false;
    }
  }
  return Tesseract;
}

/**
 * Extract base64 image data from an HTML email body.
 * Handles:
 * - data URIs: <img src="data:image/jpeg;base64,....">
 * - CID references (inline attachments) — skipped for now
 */
function extractImagesFromHtml(html) {
  const images = [];
  if (!html) return images;

  // Match data URIs
  const dataUriRegex = /src=["'](data:image\/(jpeg|jpg|png|gif|webp);base64,([^"'\s]+))["']/gi;
  let match;
  while ((match = dataUriRegex.exec(html)) !== null) {
    images.push({
      type: match[2],
      data: match[3],
      dataUri: match[1]
    });
  }

  return images;
}

/**
 * Detect if an email is likely a screenshot (image-only, very little text).
 * @param {string} text - plain text body
 * @param {string} html - HTML body
 * @returns {boolean}
 */
function isLikelyScreenshot(text, html) {
  const textLen = (text || '').trim().length;
  const htmlText = (html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().length;
  const hasImages = (html || '').includes('<img');
  // Consider it a screenshot if total readable text < 200 chars and has images
  return hasImages && (textLen + htmlText) < 300;
}

/**
 * Run OCR on all images found in the email HTML.
 * Returns the concatenated OCR text.
 */
async function runOcrOnEmail(text, html) {
  const result = {
    ocrText: '',
    isScreenshot: false,
    imageCount: 0,
    success: false
  };

  // First check if this looks like a screenshot
  result.isScreenshot = isLikelyScreenshot(text, html);

  if (!result.isScreenshot) {
    return result;
  }

  // Extract images from HTML
  const images = extractImagesFromHtml(html);
  result.imageCount = images.length;

  if (images.length === 0) {
    console.log('[imageOcr] Screenshot detected but no extractable images found (possibly CID attachments)');
    return result;
  }

  console.log(`[imageOcr] Screenshot detected — running OCR on ${images.length} image(s)`);

  const T = await getTesseract();
  if (!T) {
    console.warn('[imageOcr] Tesseract not available, skipping OCR');
    return result;
  }

  const ocrParts = [];

  for (let i = 0; i < images.length; i++) {
    try {
      console.log(`[imageOcr] Processing image ${i + 1}/${images.length} (${images[i].type})...`);
      const { data: { text: ocrText } } = await T.recognize(
        Buffer.from(images[i].data, 'base64'),
        'eng',
        { logger: () => {} } // suppress progress logs
      );
      if (ocrText && ocrText.trim().length > 20) {
        ocrParts.push(ocrText.trim());
        console.log(`[imageOcr] Image ${i + 1} OCR: ${ocrText.length} chars`);
      }
    } catch (e) {
      console.error(`[imageOcr] OCR error on image ${i + 1}:`, e.message);
    }
  }

  result.ocrText = ocrParts.join('\n\n');
  result.success = result.ocrText.length > 50;
  console.log(`[imageOcr] OCR complete — ${result.ocrText.length} chars extracted`);

  return result;
}

module.exports = { runOcrOnEmail, isLikelyScreenshot, extractImagesFromHtml };
