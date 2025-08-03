import { BskyAgent } from '@atproto/api';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { searchMacaulayForTaxon } from './search-macaulay-for-taxon.js';

dotenv.config();

interface BirdRecord {
  Order: string;
  Family: string;
  Family_English_name: string;
  Scientific_name: string;
  English_name_AviList: string;
  Range: string;
  IUCN_Red_List_Category: string;
  Species_code_Cornell_Lab: string;
}

/**
 * Parse CSV file and return all bird records
 * Handles CSV with quoted fields that may contain commas
 */
function parseBirdCSV(filePath: string): BirdRecord[] {
  const csvContent = fs.readFileSync(filePath, 'utf-8');
  const lines = csvContent.split('\n');
  const headers = parseCSVLine(lines[0]);
  
  const records: BirdRecord[] = [];
  
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    
    const values = parseCSVLine(line);
    if (values.length < headers.length) continue;
    
    const record: BirdRecord = {
      Order: values[0] || '',
      Family: values[1] || '',
      Family_English_name: values[2] || '',
      Scientific_name: values[3] || '',
      English_name_AviList: values[4] || '',
      Range: values[5] || '',
      IUCN_Red_List_Category: values[6] || '',
      Species_code_Cornell_Lab: values[7] || ''
    };
    
    records.push(record);
  }
  
  return records;
}

/**
 * Parse a single CSV line, handling quoted fields with commas
 */
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  
  result.push(current.trim());
  return result;
}

/**
 * Get a random bird record from the CSV
 */
function getRandomBirdRecord(records: BirdRecord[]): BirdRecord {
  const randomIndex = Math.floor(Math.random() * records.length);
  return records[randomIndex];
}

async function uploadImageToBluesky(agent: BskyAgent, imageUrl: string): Promise<any> {
  try {
    console.log(`Uploading thumbnail from: ${imageUrl}`);
    const imageResponse = await fetch(imageUrl);
    if (!imageResponse.ok) {
      throw new Error(`Failed to fetch image: ${imageResponse.status}`);
    }
    
    const imageBuffer = await imageResponse.arrayBuffer();
    const imageBlob = new Uint8Array(imageBuffer);
    
    const uploadResponse = await agent.uploadBlob(imageBlob, {
      encoding: 'image/jpeg' // Macaulay Library typically uses JPEG
    });
    
    return uploadResponse.data.blob;
  } catch (error) {
    console.warn('Failed to upload thumbnail:', error);
    return null;
  }
}

async function fetchPageMetadata(url: string): Promise<{ title: string; description: string, uri: string, thumbUrl?: string }> {
  try {
    const response = await fetch(url);
    const html = await response.text();
    
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    const descMatch = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["'][^>]*>/i) ||
                     html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*name=["']description["'][^>]*>/i);
    
    const ogImageMatch = html.match(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["'][^>]*>/i) ||
                        html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:image["'][^>]*>/i);
    
    let description = descMatch ? descMatch[1].trim() : 'Click through for attribution.';
    const copyrightIndex = description.indexOf('©');
    if (copyrightIndex !== -1) {
      description = description.substring(copyrightIndex);
    }
    
    return {
      title: titleMatch ? titleMatch[1].trim() : 'Macaulay Library',
      description,
      uri: url,
      thumbUrl: ogImageMatch ? ogImageMatch[1] : undefined
    };
  } catch (error) {
    console.warn('Failed to fetch page metadata:', error);
    return {
      title: 'Macaulay Library',
      description: 'Click through for attribution.',
      uri: url,
    };
  }
}

async function generateBirdPost(): Promise<{ text: string, metadata: { title: string; description: string, uri: string, thumbUrl?: string }}> {
  const csvPath = path.join(process.cwd(), 'data/avilist2025_spp_filtered.csv');
  console.log('Loading bird data from CSV...');
  
  if (!fs.existsSync(csvPath)) {
    throw new Error(`CSV file not found at: ${csvPath}`);
  }
  
  const birdRecords = parseBirdCSV(csvPath);
  console.log(`Loaded ${birdRecords.length} bird records`);
  
  if (birdRecords.length === 0) {
    throw new Error('No bird records found in CSV file');
  }

  let attempts = 0;
  const maxAttempts = 3;
  let assetIds: number[] | null = null;
  let selectedBird: BirdRecord;

  while (attempts < maxAttempts && (!assetIds || assetIds.length === 0)) {
    attempts++;
    console.log(`Attempt ${attempts}: Getting random bird record...`);
    
    selectedBird = getRandomBirdRecord(birdRecords);
    
    console.log(`Selected bird: ${selectedBird.English_name_AviList} (${selectedBird.Scientific_name}) - Code: ${selectedBird.Species_code_Cornell_Lab}`);
    
    assetIds = await searchMacaulayForTaxon(selectedBird.Species_code_Cornell_Lab);
    
    if (assetIds && assetIds.length > 0) {
      console.log(`Found ${assetIds.length} media assets`);
      break;
    } else {
      console.log(`No media found for ${selectedBird.English_name_AviList}, trying another bird...`);
    }
  }

  if (!assetIds || assetIds.length === 0) {
    throw new Error(`Failed to find media after ${maxAttempts} attempts`);
  }

  const randomAssetId = assetIds[Math.floor(Math.random() * assetIds.length)];
  console.log(`Selected asset ID: ${randomAssetId}`);

  const macaulayUrl = `https://macaulaylibrary.org/asset/${randomAssetId}/embed`;

  const statusMap = {
    EX: "Extinct",
    EW: "Extinct in the Wild", 
    CR: "Critically Endangered",
    EN: "Endangered",
    VU: "Vulnerable",
    NT: "Near Threatened",
    LC: "Least Concern",
    DD: "Data Deficient",
    NE: "Not Evaluated"
  };

  
  let text = `${selectedBird!.English_name_AviList} (${selectedBird!.Scientific_name})\n\nFamily ${selectedBird!.Family} (${selectedBird!.Family_English_name})\n`;
  let footer = `IUCN status: ${statusMap[selectedBird!.IUCN_Red_List_Category] || 'Unknown'}\n\n`;
  if ((text + footer + status).length < 300) {
    footer = status + footer;
  }
  
  if (selectedBird!.Range && selectedBird!.Range.length + text.length + footer.length < 300) {
    text += `Range: ${selectedBird!.Range}\n`;
  }
  
  if (text.length + footer.length < 300) {
    text += footer;
  }
  
  if (text.length > 300) {
    throw new Error('Generated post text exceeds 300 characters limit');
  }
  
  console.log('Fetching page metadata for link card...');
  const metadata = await fetchPageMetadata(macaulayUrl);
  return { text, metadata };
}


async function main() {
  try {
    const args = process.argv.slice(2);
    const isDryRun = args.includes('--dry-run');
    if (isDryRun) {
      console.log('🔍 Dry run - will not post to Bluesky');
    }

    let agent: BskyAgent | null = null;
    agent = new BskyAgent({
    service: 'https://bsky.social',
    });

    console.log('Logging in to Bluesky...');
    await agent.login({ 
    identifier: process.env.BLUESKY_USERNAME!, 
    password: process.env.BLUESKY_PASSWORD! 
    });
    console.log('Successfully logged in to Bluesky');

    const { text, metadata } = await generateBirdPost();

    console.log('\n--- Post content ---');
    console.log(text);
    console.log('--- End of post ---\n');

    if (isDryRun) {
      console.log('✅ DRY-RUN completed successfully! Above is what would be posted to Bluesky.');
    } else {
      console.log('Posting to Bluesky...');

      let thumbBlob = null;
      if (metadata.thumbUrl) {
        thumbBlob = await uploadImageToBluesky(agent!, metadata.thumbUrl);
      }

      const external: any = {
        uri: metadata.uri,
        title: metadata.title,
        description: metadata.description
      };

      if (thumbBlob) {
        external.thumb = thumbBlob;
      }

      const postData = {
        text,
        embed: {
          $type: 'app.bsky.embed.external',
          external
        }
      }
      
      await agent!.post(postData);
      console.log('Successfully posted to Bluesky!');
    }

  } catch (error) {
    console.error('Error running bot:', error);
    process.exit(1);
  }
}

main().catch(console.error);
