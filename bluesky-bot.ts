import { BskyAgent } from '@atproto/api';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { searchMacaulayForTaxon, searchMacaulayByTaxonomy } from './search-macaulay-for-taxon.js';

dotenv.config();

const IUCN_STATUS_MAP = {
  EX: "Extinct",
  EW: "Extinct in the Wild", 
  CR: "Critically Endangered",
  EN: "Endangered",
  VU: "Vulnerable",
  NT: "Near Threatened",
  LC: "Least Concern",
  DD: "Data Deficient",
  NE: "Not Evaluated"
} as const;

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

interface MammalRecord {
  sciName: string;
  mainCommonName: string;
  order: string;
  family: string;
  continentDistribution: string;
  biogeographicRealm: string;
  iucnStatus: string;
  distributionNotes: string;
}

interface MacaulaySearchResult {
  assetIds: number[];
  taxonomyLevel: string;
  commonName?: string;
  getAssetDetails?: (assetId: number) => any;
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
 * Parse mammal CSV file and return all mammal records
 */
function parseMammalCSV(filePath: string): MammalRecord[] {
  const csvContent = fs.readFileSync(filePath, 'utf-8');
  const lines = csvContent.split('\n');
  const headers = parseCSVLine(lines[0]);
  
  const records: MammalRecord[] = [];
  
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    
    const values = parseCSVLine(line);
    if (values.length < headers.length) continue;
    
    const record: MammalRecord = {
      sciName: values[0] || '',
      mainCommonName: values[1] || '',
      order: values[2] || '',
      family: values[3] || '',
      continentDistribution: values[4] || '',
      biogeographicRealm: values[5] || '',
      iucnStatus: values[6] || '',
      distributionNotes: values[7] || ''
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

/**
 * Get a random mammal record from the CSV
 * Re-rolls up to 2 times if the selected species is from Muridae, Soricidae, or Chiroptera
 */
function getRandomMammalRecord(records: MammalRecord[]): MammalRecord {
  const maxRerolls = 2;
  let rerollCount = 0;
  let selectedMammal: MammalRecord;
  
  do {
    const randomIndex = Math.floor(Math.random() * records.length);
    selectedMammal = records[randomIndex];
    
    // Check if we should re-roll: Muridae, Soricidae families or Chiroptera order
    const shouldReroll = 
      selectedMammal.family === 'Muridae' ||
      selectedMammal.family === 'Soricidae' ||
      selectedMammal.order === 'Chiroptera';
    
    if (shouldReroll && rerollCount < maxRerolls) {
      console.log(`Re-rolling selection (${rerollCount + 1}/${maxRerolls}): ${selectedMammal.mainCommonName} is from ${selectedMammal.family === 'Muridae' || selectedMammal.family === 'Soricidae' ? 'family ' + selectedMammal.family : 'order ' + selectedMammal.order}`);
      rerollCount++;
    } else {
      if (shouldReroll && rerollCount >= maxRerolls) {
        console.log(`Keeping ${selectedMammal.mainCommonName} from ${selectedMammal.family === 'Muridae' || selectedMammal.family === 'Soricidae' ? 'family ' + selectedMammal.family : 'order ' + selectedMammal.order} after ${maxRerolls} re-rolls`);
      }
      break;
    }
  } while (rerollCount <= maxRerolls);
  
  return selectedMammal;
}

function decodeHtmlEntities(text: string): string {
  const htmlEntities: { [key: string]: string } = {
    '&amp;': '&',
    '&quot;': '"',
    '&#x27;': "'",
    '&#39;': "'",
    '&apos;': "'",
    '&nbsp;': ' ',
    '&mdash;': '—',
    '&ndash;': '–',
  };

  let decoded = text;
  
  for (const [entity, replacement] of Object.entries(htmlEntities)) {
    decoded = decoded.replace(new RegExp(entity, 'g'), replacement);
  }
  
  decoded = decoded.replace(/&#(\d+);/g, (match, num) => {
    return String.fromCharCode(parseInt(num, 10));
  });
  
  decoded = decoded.replace(/&#x([0-9A-Fa-f]+);/g, (match, hex) => {
    return String.fromCharCode(parseInt(hex, 16));
  });
  
  return decoded;
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
      title: decodeHtmlEntities(titleMatch ? titleMatch[1].trim() : 'Macaulay Library'),
      description: decodeHtmlEntities(description),
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
    
    assetIds = (await searchMacaulayForTaxon(selectedBird.Species_code_Cornell_Lab))?.assetIds || null;
    
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

  let text = `${selectedBird!.English_name_AviList} (${selectedBird!.Scientific_name})\n\nFamily ${selectedBird!.Family} (${selectedBird!.Family_English_name})\n`;
  let footer = `IUCN status: ${IUCN_STATUS_MAP[selectedBird!.IUCN_Red_List_Category] || 'Unknown'}`;
  
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

async function generateMammalPost(testSpeciesSciName?: string): Promise<{ text: string, metadata: { title: string; description: string, uri: string, thumbUrl?: string }}> {
  const csvPath = path.join(process.cwd(), 'data/mdd2.3_spp_filtered.csv');
  console.log('Loading mammal data from CSV...');
  
  if (!fs.existsSync(csvPath)) {
    throw new Error(`CSV file not found at: ${csvPath}`);
  }
  
  const mammalRecords = parseMammalCSV(csvPath);
  console.log(`Loaded ${mammalRecords.length} mammal records`);
  
  if (mammalRecords.length === 0) {
    throw new Error('No mammal records found in CSV file');
  }

  let attempts = 0;
  const maxAttempts = 5;
  let searchResult: MacaulaySearchResult | null = null;
  let selectedMammal: MammalRecord;

  // If testing a specific species, find it in the CSV
  if (testSpeciesSciName) {
    const testMammal = mammalRecords.find(m => m.sciName === testSpeciesSciName);
    if (!testMammal) {
      throw new Error(`Test species ${testSpeciesSciName} not found in CSV data`);
    }
    selectedMammal = testMammal;
    console.log(`🧪 Using test species: ${selectedMammal.mainCommonName} (${selectedMammal.sciName}) - Family: ${selectedMammal.family}`);
    
    // Try searching for the test species
    const speciesFormattedSciName = selectedMammal.sciName.replace('_', ' ');
    console.log(`Formatted scientific name for search: ${speciesFormattedSciName}`);
    
    searchResult = await searchMacaulayByTaxonomy(speciesFormattedSciName, 'species');
    
    if (!searchResult || searchResult.assetIds.length === 0) {
      console.log(`No media found for test species, trying family search...`);
      
      // Try searching by family to see if any species-specific images are available
      searchResult = await searchMacaulayByTaxonomy(selectedMammal.family, 'family');
      
      if (searchResult && searchResult.assetIds.length > 0 && searchResult.getAssetDetails) {
        console.log(`Found ${searchResult.assetIds.length} media assets for family ${selectedMammal.family}, checking for species-specific images...`);
        
        // Look through the family results to find any species-specific images that aren't tagged as "dead"
        const speciesSpecificAssets = searchResult.assetIds.filter(assetId => {
          const assetDetails = searchResult.getAssetDetails!(assetId);
          const taxonomy = assetDetails?.taxonomy;
          
          // Check if it's a species-level result or subspecies of the target species
          if (!taxonomy || !taxonomy.sciName) {
            return false;
          }
          
          // Accept species-level results
          if (taxonomy.category === 'species') {
            return true;
          }
          
          // Accept subspecies results if they belong to the target species
          if (taxonomy.category === 'subspecies') {
            // For subspecies, the scientific name will be like "Odobenus rosmarus rosmarus"
            // We want to match if it starts with our target species name "Odobenus rosmarus"
            const targetSpecies = selectedMammal.sciName.replace('_', ' ');
            return taxonomy.sciName.startsWith(targetSpecies + ' ');
          }
          
          return false;
          
          // Check if it's tagged as "dead"
          const tags = assetDetails?.tags;
          if (tags && Array.isArray(tags)) {
            if (tags.some(tag => tag.toLowerCase().includes('dead'))) {
              return false;
            }
          } else if (typeof tags === 'string') {
            if (tags.toLowerCase().includes('dead')) {
              return false;
            }
          }
          
          return true;
        });
        
        if (speciesSpecificAssets.length > 0) {
          console.log(`Found ${speciesSpecificAssets.length} species-specific images in family results`);
          // Update the search result to only include species-specific assets
          searchResult.assetIds = speciesSpecificAssets;
        } else {
          console.log(`No species-specific images found in family ${selectedMammal.family} results`);
          searchResult = null;
        }
      }
      
      if (!searchResult || searchResult.assetIds.length === 0) {
        throw new Error(`No usable media found for test species ${testSpeciesSciName}`);
      }
    }
  } else {
    // Normal random selection logic

  while (attempts < maxAttempts && (!searchResult || searchResult.assetIds.length === 0)) {
    attempts++;
    console.log(`Attempt ${attempts}: Getting random mammal record...`);
    
    selectedMammal = getRandomMammalRecord(mammalRecords);
    
    console.log(`Selected mammal: ${selectedMammal.mainCommonName} (${selectedMammal.sciName}) - Family: ${selectedMammal.family}`);
    
    // Try searching for the species first - use properly formatted scientific name
    const speciesFormattedSciName = selectedMammal.sciName.replace('_', ' ');
    console.log(`Formatted scientific name for search: ${speciesFormattedSciName}`);
    
    searchResult = await searchMacaulayByTaxonomy(speciesFormattedSciName, 'species');
    
    if (searchResult && searchResult.assetIds.length > 0) {
      console.log(`Found ${searchResult.assetIds.length} media assets for species`);
      break;
    } else {
      console.log(`No media found for ${selectedMammal.mainCommonName}, trying family search...`);
      
      // Try searching by family to see if any species-specific images are available
      searchResult = await searchMacaulayByTaxonomy(selectedMammal.family, 'family');
      
      if (searchResult && searchResult.assetIds.length > 0 && searchResult.getAssetDetails) {
        console.log(`Found ${searchResult.assetIds.length} media assets for family ${selectedMammal.family}, checking for species-specific images...`);
        
        // Look through the family results to find any species-specific images that aren't tagged as "dead"
        const speciesSpecificAssets = searchResult.assetIds.filter(assetId => {
          const assetDetails = searchResult.getAssetDetails!(assetId);
          const taxonomy = assetDetails?.taxonomy;
          
          // Check if it's a species-level result or subspecies of any species
          if (!taxonomy || !taxonomy.sciName) {
            return false;
          }
          
          // Accept species-level results  
          if (taxonomy.category === 'species') {
            return true;
          }
          
          // Accept subspecies results (they're still species-specific)
          if (taxonomy.category === 'subspecies') {
            return true;
          }
          
          return false;
          
          // Check if it's tagged as "dead"
          const tags = assetDetails?.tags;
          if (tags && Array.isArray(tags)) {
            if (tags.some(tag => tag.toLowerCase().includes('dead'))) {
              return false;
            }
          } else if (typeof tags === 'string') {
            if (tags.toLowerCase().includes('dead')) {
              return false;
            }
          }
          
          return true;
        });
        
        if (speciesSpecificAssets.length > 0) {
          console.log(`Found ${speciesSpecificAssets.length} species-specific images in family results`);
          // Update the search result to only include species-specific assets
          searchResult.assetIds = speciesSpecificAssets;
          break;
        } else {
          console.log(`No species-specific images found in family ${selectedMammal.family} results`);
          // Reset searchResult so we try a different family
          searchResult = null;
        }
      }
      
      console.log(`No usable media found for family ${selectedMammal.family}, trying another mammal family...`);
      if (attempts < maxAttempts) {
        console.log('Waiting 5 seconds before trying again...');
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }
  } // End of the while loop for normal selection
  } // End of test species vs normal selection

  if (!searchResult || searchResult.assetIds.length === 0) {
    throw new Error(`Failed to find species-specific media after ${maxAttempts} attempts`);
  }

  const randomAssetId = searchResult.assetIds[Math.floor(Math.random() * searchResult.assetIds.length)];
  console.log(`Selected asset ID: ${randomAssetId}`);

  // Get details about the selected asset to see what it actually shows
  let actualTaxonomy = null;
  if (searchResult.getAssetDetails) {
    const assetDetails = searchResult.getAssetDetails(randomAssetId);
    actualTaxonomy = assetDetails?.taxonomy;
    console.log('Selected asset taxonomy:', actualTaxonomy);
    
    // Verify this is actually a species-level or subspecies result
    if (!actualTaxonomy || (actualTaxonomy.category !== 'species' && actualTaxonomy.category !== 'subspecies')) {
      throw new Error(`Selected asset is not species-specific. Category: ${actualTaxonomy?.category}`);
    }
  }

  // If the image shows a different species than our originally selected mammal,
  // try to find that species in our CSV data for more accurate distribution info
  let postMammal = selectedMammal;
  if (actualTaxonomy && actualTaxonomy.sciName) {
    // Normalize subspecies names to species names (e.g., "Odobenus rosmarus rosmarus" -> "Odobenus rosmarus")
    let normalizedSciName = actualTaxonomy.sciName;
    if (actualTaxonomy.category === 'subspecies') {
      // For subspecies, take only the first two parts (genus + species)
      const parts = actualTaxonomy.sciName.split(' ');
      if (parts.length >= 2) {
        normalizedSciName = parts[0] + ' ' + parts[1];
      }
    }
    
    const imageSpeciesSciName = normalizedSciName.replace(' ', '_'); // Convert back to CSV format
    const matchingMammal = mammalRecords.find(m => m.sciName === imageSpeciesSciName);
    
    if (matchingMammal) {
      console.log(`Found matching CSV data for image species: ${matchingMammal.mainCommonName}`);
      postMammal = matchingMammal;
    } else {
      console.log(`No CSV data found for image species ${normalizedSciName}, using original selection for distribution data`);
    }
  }

  const macaulayUrl = `https://macaulaylibrary.org/asset/${randomAssetId}/embed`;

  // Parse scientific name to get genus and species for fallback
  const sciNameParts = postMammal!.sciName.split('_');
  const genus = sciNameParts[0] || '';
  const species = sciNameParts[1] || '';
  const formattedSciName = genus + (species ? ' ' + species : '');

  let text = '';
  
  // We should always have species-specific information at this point
  if (actualTaxonomy && actualTaxonomy.sciName && actualTaxonomy.comName && 
      (actualTaxonomy.category === 'species' || actualTaxonomy.category === 'subspecies')) {
    
    // Normalize subspecies names for display
    let displaySciName = actualTaxonomy.sciName;
    let displayComName = actualTaxonomy.comName;
    
    if (actualTaxonomy.category === 'subspecies') {
      // For subspecies, normalize to species level for the post
      const parts = actualTaxonomy.sciName.split(' ');
      if (parts.length >= 2) {
        displaySciName = parts[0] + ' ' + parts[1];
      }
      
      // Try to get the species-level common name from our CSV data
      if (postMammal && postMammal.mainCommonName) {
        displayComName = postMammal.mainCommonName;
      } else {
        // Fallback: try to remove subspecies indicators from the common name
        displayComName = actualTaxonomy.comName.replace(/\s+(Atlantic|Pacific|Eastern|Western|Northern|Southern)\s+/i, '');
      }
    }
    
    // The image shows a specific species or subspecies - use normalized names, but CSV data for distribution
    console.log(`Creating post for ${actualTaxonomy.category}: ${displayComName} (${displaySciName})`);
    text = `${displayComName} (${displaySciName})\n\nFamily ${postMammal!.family}\n`;
  } else {
    // This should not happen with our new logic - throw an error
    throw new Error(`No species-specific taxonomy found for selected asset. Taxonomy: ${JSON.stringify(actualTaxonomy)}`);
  }
  
  // Combine distribution and biogeographic realm info
  let distributionInfo = '';
  if (postMammal!.biogeographicRealm) {
    distributionInfo = postMammal!.biogeographicRealm.split('|').map(r => r.trim()).join(', ');
    
    // Add continent info in parentheses if we have it and it's concise
    if (postMammal!.continentDistribution) {
      const continents = postMammal!.continentDistribution.split('|').map(c => c.trim().replace(/\s*\(Continent\)\s*/g, ''));
      if (continents.length <= 3) {
        distributionInfo += ` (${continents.join(', ')})`;
      }
    }
  }
  
  let footer = `IUCN status: ${IUCN_STATUS_MAP[postMammal!.iucnStatus as keyof typeof IUCN_STATUS_MAP] || 'Unknown'}`;
  
  // Add distribution info if it fits
  if (distributionInfo && distributionInfo.length + text.length + footer.length < 280) {
    text += `Range: ${distributionInfo}\n`;
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
    const useMammals = args.includes('--mammals');
    const testSpecies = args.find(arg => arg.startsWith('--test-species='))?.split('=')[1];
    
    if (isDryRun) {
      console.log('🔍 Dry run - will not post to Bluesky');
    }
    
    if (testSpecies) {
      console.log(`🧪 Test mode - using specific species: ${testSpecies}`);
    }
    
    console.log(`Generating ${useMammals ? 'mammal' : 'bird'} post...`);

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

    const { text, metadata } = useMammals ? await generateMammalPost(testSpecies) : await generateBirdPost();

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
