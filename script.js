/**
 * Image Content Filtering Script
 * This script processes images, performs OCR to extract text,
 * and filters out images containing sensitive content
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { OpenAI } = require('openai');
const sharp = require('sharp');
const tesseract = require('node-tesseract-ocr');
const openai = new OpenAI(process.env.OPENAI_API_KEY);

// Get folder path from command line arguments
const folder = process.argv[2];
if (!folder) {
  console.error('Please provide a folder path as an argument');
  process.exit(1);
}

// Configuration
const tesseractConfig = {
  lang: "eng",
  oem: 1,
  psm: 3,
  char_whitelist: " abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"
};

// Create directory for filtered images
const dacyFolder = path.join(folder, 'dacy');
if (!fs.existsSync(dacyFolder)) {
  fs.mkdirSync(dacyFolder);
}

// Get all files recursively
function getAllFiles(dirPath, arrayOfFiles) {
  const files = fs.readdirSync(dirPath);
  arrayOfFiles = arrayOfFiles || [];

  files.forEach(file => {
    const filePath = path.join(dirPath, file);
    if (fs.statSync(filePath).isDirectory()) {
      arrayOfFiles = getAllFiles(filePath, arrayOfFiles);
    } else {
      arrayOfFiles.push(filePath);
    }
  });

  return arrayOfFiles;
}

// Perform OCR on image
async function performOcr(imagePath) {
  try {
    const text = await tesseract.recognize(imagePath, tesseractConfig);
    return text.replace(/\n/g, " ");
  } catch (error) {
    console.error(`OCR error on ${imagePath}: ${error.message}`);
    return "";
  }
}

// Check content with OpenAI
async function checkContentWithOpenAI(text) {
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        { role: "system", content: "You are a helpful assistant." },
        { role: "user", content: `If this text has any of the following themes: nsfw, sexual sentiment, sex related words, domestic abuse, child abuse, substance use, racism, violence, guns, suicidal, vaccinations, talks about deep social issues, racism, inequality, abortions, liberals vs conservatives, return only TRUE, if it doesn't return FALSE. Text: ${text}` }
      ]
    });
    
    return response.choices[0].message.content.toLowerCase().includes('true');
  } catch (error) {
    console.error(`OpenAI API error: ${error.message}`);
    // Wait and retry on API errors
    await new Promise(resolve => setTimeout(resolve, 15000));
    return false;
  }
}

// Crop image based on OCR data
async function cropImage(imagePath) {
  try {
    const metadata = await sharp(imagePath).metadata();
    const { width, height } = metadata;
    
    if (!width || !height) {
      return false;
    }
    
    // Perform basic cropping logic
    if (height <= width) {
      // Landscape or square image: crop top portion
      await sharp(imagePath)
        .extract({ left: 0, top: 0, width, height: Math.floor(height * 0.7) })
        .toFile(imagePath + '.tmp');
      
      fs.renameSync(imagePath + '.tmp', imagePath);
    } else if (height > width) {
      // Portrait image: crop to square
      await sharp(imagePath)
        .extract({ left: 0, top: 0, width, height: width })
        .toFile(imagePath + '.tmp');
      
      fs.renameSync(imagePath + '.tmp', imagePath);
    } else if (width / height > 0.5) {
      // Delete if aspect ratio is unusual
      fs.unlinkSync(imagePath);
      return false;
    }
    
    return true;
  } catch (error) {
    console.error(`Image processing error on ${imagePath}: ${error.message}`);
    return false;
  }
}

// Main processing function
async function processImages() {
  const paths = getAllFiles(folder).filter(file => 
    !file.includes(path.join(folder, 'dacy')) && 
    ['.jpg', '.jpeg', '.png', '.gif', '.bmp'].includes(path.extname(file).toLowerCase())
  );
  
  console.log(`Found ${paths.length} images to process`);
  let processed = 0;
  let filtered = 0;
  
  for (const imagePath of paths) {
    try {
      console.log(`Processing image ${++processed} of ${paths.length}: ${imagePath}`);
      
      // Extract text from image
      const text = await performOcr(imagePath);
      if (!text) {
        console.log('Cannot perform OCR, probably removed or unsupported image');
        continue;
      }
      
      console.log('Extracted text:', text.substring(0, 100) + (text.length > 100 ? '...' : ''));
      
      // Check if content contains sensitive material
      const hasSensitiveContent = await checkContentWithOpenAI(text);
      
      if (hasSensitiveContent) {
        console.log("Sensitive content detected, moving to filtered folder");
        filtered++;
        
        try {
          const destPath = path.join(dacyFolder, path.basename(imagePath));
          fs.copyFileSync(imagePath, destPath);
          fs.unlinkSync(imagePath);
          continue;
        } catch (error) {
          console.error(`Error moving file: ${error.message}`);
        }
      }
      
      // If no sensitive content, crop the image
      await cropImage(imagePath);
      
    } catch (error) {
      console.error(`Error processing ${imagePath}: ${error.message}`);
    }
  }
  
  console.log(`Finished processing. Filtered ${filtered} images containing sensitive content.`);
}

// Run the main function
processImages().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
