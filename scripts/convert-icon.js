#!/usr/bin/env node

/**
 * Icon Conversion Script
 * Converts PNG to ICO format for Windows installers
 * 
 * Usage: node scripts/convert-icon.js <input-png> [output-ico]
 * 
 * Requirements:
 * - ffmpeg installed: brew install ffmpeg
 * - OR imagemagick: brew install imagemagick
 * 
 * Example: node scripts/convert-icon.js public/logo.png assets/logo.ico
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const args = process.argv.slice(2);

if (args.length === 0) {
  console.error('Usage: node scripts/convert-icon.js <input-png> [output-ico]');
  console.error('Example: node scripts/convert-icon.js public/logo.png assets/logo.ico');
  process.exit(1);
}

const inputFile = args[0];
const outputFile = args[1] || 'assets/logo.ico';

// Validate input file exists
if (!fs.existsSync(inputFile)) {
  console.error(`Error: Input file not found: ${inputFile}`);
  process.exit(1);
}

console.log(`Converting ${inputFile} to ${outputFile}...`);

try {
  // Try using ffmpeg first
  try {
    execSync(`ffmpeg -i "${inputFile}" -vf scale=256:256 "${outputFile}" -y`, { stdio: 'inherit' });
    console.log(`✓ Successfully created ${outputFile} using ffmpeg`);
    process.exit(0);
  } catch (e) {
    // Try ImageMagick as fallback
    try {
      execSync(`convert "${inputFile}" -define icon:auto-resize=256,128,96,64,48,32,16 "${outputFile}"`, { stdio: 'inherit' });
      console.log(`✓ Successfully created ${outputFile} using ImageMagick`);
      process.exit(0);
    } catch (e2) {
      console.error('Error: Neither ffmpeg nor ImageMagick found');
      console.error('Install one of them:');
      console.error('  brew install ffmpeg');
      console.error('  brew install imagemagick');
      process.exit(1);
    }
  }
} catch (error) {
  console.error('Conversion failed:', error.message);
  process.exit(1);
}
