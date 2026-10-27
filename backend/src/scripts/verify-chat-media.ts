import mongoose from 'mongoose';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { User } from '../models/User.js';
import { Project } from '../models/Project.js';
import { ProjectMessage } from '../models/ProjectMessage.js';
import { validateMediaMagicBytes } from '../controllers/communicationController.js';

dotenv.config();

const uri =
  process.env.MONGODB_URI ||
  'mongodb+srv://captian16720_db_user:Kiran%4016720@cluster0.zon62u7.mongodb.net/sitetrack?retryWrites=true&w=majority&appName=Cluster0';

async function runTest() {
  console.log('\n======================================================');
  console.log('🧪 PROJECT CHAT MEDIA & VALIDATION VERIFICATION SUITE');
  console.log('======================================================\n');

  // Test 1: Magic Bytes Inspection
  console.log('--- 1. Testing Magic Bytes Verification ---');
  const tempDir = path.resolve(process.cwd(), 'uploads', 'test_tmp');
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  // 1a. Real JPEG header
  const jpegFile = path.join(tempDir, 'sample.jpg');
  fs.writeFileSync(jpegFile, Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]));
  const jpegRes = validateMediaMagicBytes(jpegFile);
  if (jpegRes?.valid && jpegRes.mediaType === 'image' && jpegRes.detectedMime === 'image/jpeg') {
    console.log('✅ Real JPEG header correctly validated as image/jpeg');
  } else {
    throw new Error('Failed to validate JPEG header');
  }

  // 1b. Real PNG header
  const pngFile = path.join(tempDir, 'sample.png');
  fs.writeFileSync(pngFile, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const pngRes = validateMediaMagicBytes(pngFile);
  if (pngRes?.valid && pngRes.mediaType === 'image' && pngRes.detectedMime === 'image/png') {
    console.log('✅ Real PNG header correctly validated as image/png');
  } else {
    throw new Error('Failed to validate PNG header');
  }

  // 1c. Real WebP header ('RIFF'....'WEBP')
  const webpFile = path.join(tempDir, 'sample.webp');
  const webpBuf = Buffer.alloc(16);
  webpBuf.write('RIFF', 0, 4, 'ascii');
  webpBuf.write('WEBP', 8, 4, 'ascii');
  fs.writeFileSync(webpFile, webpBuf);
  const webpRes = validateMediaMagicBytes(webpFile);
  if (webpRes?.valid && webpRes.mediaType === 'image' && webpRes.detectedMime === 'image/webp') {
    console.log('✅ Real WebP header correctly validated as image/webp');
  } else {
    throw new Error('Failed to validate WebP header');
  }

  // 1d. Real MP4 header (bytes 4..7 'ftyp')
  const mp4File = path.join(tempDir, 'sample.mp4');
  const mp4Buf = Buffer.alloc(16);
  mp4Buf.write('ftyp', 4, 4, 'ascii');
  fs.writeFileSync(mp4File, mp4Buf);
  const mp4Res = validateMediaMagicBytes(mp4File);
  if (mp4Res?.valid && mp4Res.mediaType === 'video' && mp4Res.detectedMime === 'video/mp4') {
    console.log('✅ Real MP4 header correctly validated as video/mp4');
  } else {
    throw new Error('Failed to validate MP4 header');
  }

  // 1e. Real WebM header (1A 45 DF A3)
  const webmFile = path.join(tempDir, 'sample.webm');
  fs.writeFileSync(webmFile, Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x01, 0x00, 0x00]));
  const webmRes = validateMediaMagicBytes(webmFile);
  if (webmRes?.valid && webmRes.mediaType === 'video' && webmRes.detectedMime === 'video/webm') {
    console.log('✅ Real WebM header correctly validated as video/webm');
  } else {
    throw new Error('Failed to validate WebM header');
  }

  // 1f. Real PDF header (%PDF-)
  const pdfFile = path.join(tempDir, 'sample.pdf');
  fs.writeFileSync(pdfFile, Buffer.from('%PDF-1.5 test content', 'utf8'));
  const pdfRes = validateMediaMagicBytes(pdfFile);
  if (pdfRes?.valid && pdfRes.mediaType === 'document' && pdfRes.detectedMime === 'application/pdf') {
    console.log('✅ Real PDF header correctly validated as application/pdf');
  } else {
    throw new Error('Failed to validate PDF header');
  }

  // 1g. Spoofed file: Plain text or script disguised as .jpg or .mp4
  const spoofedFile = path.join(tempDir, 'malicious.jpg');
  fs.writeFileSync(spoofedFile, Buffer.from('echo "malicious payload"', 'utf8'));
  const spoofedRes = validateMediaMagicBytes(spoofedFile);
  if (spoofedRes === null) {
    console.log('✅ Spoofed malicious file disguised as .jpg correctly REJECTED by magic bytes check');
  } else {
    throw new Error('Spoofed file was unexpectedly accepted');
  }

  // Clean up temp test files
  try {
    fs.rmSync(tempDir, { recursive: true, force: true });
  } catch (e) {
    // ignore
  }

  // Test 2: Database Model & Pre-validate Hook
  console.log('\n--- 2. Testing Database Message Model with Attachments ---');
  await mongoose.connect(uri);

  const testUser = await User.findOne();
  const testProject = await Project.findOne();

  if (!testUser || !testProject) {
    throw new Error('User or Project missing in database for model verification');
  }

  // 2a. Message with text only
  const msgTextOnly = new ProjectMessage({
    project: testProject._id,
    sender: testUser._id,
    content: 'Text message without attachments',
  });
  await msgTextOnly.validate();
  console.log('✅ Validated text-only message');

  // 2b. Message with attachment only (empty content)
  const msgAttachmentOnly = new ProjectMessage({
    project: testProject._id,
    sender: testUser._id,
    content: '',
    attachments: [
      {
        url: '/api/v1/projects/123/messages/media/site_foundation.jpg',
        name: 'site_foundation.jpg',
        type: 'image',
        mimeType: 'image/jpeg',
        size: 2048500,
      },
    ],
  });
  await msgAttachmentOnly.validate();
  console.log('✅ Validated attachment-only message (allows empty text caption)');

  // 2c. Message with video attachment and caption
  const msgWithVideo = new ProjectMessage({
    project: testProject._id,
    sender: testUser._id,
    content: 'Site walkthrough at block 3',
    attachments: [
      {
        url: '/api/v1/projects/123/messages/media/walkthrough.mp4',
        name: 'walkthrough.mp4',
        type: 'video',
        mimeType: 'video/mp4',
        size: 24500120,
      },
    ],
  });
  await msgWithVideo.validate();
  console.log('✅ Validated video message with caption');

  // 2d. Invalid message: neither content nor attachments
  let caughtError = false;
  try {
    const emptyMsg = new ProjectMessage({
      project: testProject._id,
      sender: testUser._id,
      content: '',
      attachments: [],
    });
    await emptyMsg.validate();
  } catch (err: any) {
    caughtError = true;
    console.log(`✅ Correctly rejected empty message: "${err.errors?.content?.message}"`);
  }

  if (!caughtError) {
    throw new Error('Empty message was not rejected by pre-validate hook');
  }

  await mongoose.disconnect();
  console.log('\n======================================================');
  console.log('🎉 ALL CHAT MEDIA & UPLOAD VALIDATIONS PASSED CLEANLY');
  console.log('======================================================\n');
}

runTest().catch((err) => {
  console.error('❌ Verification failed:', err);
  process.exit(1);
});
