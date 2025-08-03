import puppeteer from 'puppeteer';

// The Macaulay Library does not surface a developer API. This script is not
// for downloading media from the library, just JSON metadata for public search
// results to allow embedding URL links to the asset's page in the library.
// It should not be used for requests at high volume or in any other abusive manner.

/**
 * Search for media (photos and audio) for a given taxon from Macaulay Library
 * @param taxonCode - The eBird species code (e.g., 'gybtes1' for Gray-bellied Tesia)
 * @returns Array of asset IDs or null if failed
 */
async function searchMacaulayForTaxon(taxonCode: string): Promise<number[] | null> {
  
  let browser;
  
  try {
    console.log(`Searching Macaulay Library media for taxon: ${taxonCode}`);
    
    browser = await puppeteer.launch({
      headless: "new",
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--single-process',
        '--disable-gpu'
      ]
    });
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    
    console.log('Visiting main site to establish session...');
    const mainPageResponse = await page.goto('https://search.macaulaylibrary.org/', {
      waitUntil: 'networkidle2',
      timeout: 30000
    });

    if (!mainPageResponse) {
      throw new Error('No response received');
    } else if (mainPageResponse.status() !== 200) {
      throw new Error(`Main page call failed with status: ${mainPageResponse.status()}`);
    }

    console.log('Session established, fetching API data...');
    const apiUrl = `https://search.macaulaylibrary.org/api/v2/search?taxonCode=${taxonCode}&mediaType=photo&sort=rating_rank_desc`;
    const apiResponse = await page.goto(apiUrl, {
      waitUntil: 'networkidle2',
      timeout: 30000
    });

    if (!apiResponse) {
      throw new Error('No response received');
    } else if (apiResponse.status() !== 200) {
      throw new Error(`API call failed with status: ${apiResponse.status()}`);
    }

    const jsonData = await apiResponse.json();
    
    console.log('Successfully retrieved search data');
    if (Array.isArray(jsonData)) {
      return jsonData.map(item => item.assetId).filter(id => typeof id === 'number');
    }
  
    return null;

  } catch (error) {
    console.error('Error searching Macaulay Library:', error);
    return null;
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

/**
 * Command line interface for searching Macaulay Library
 */
async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.log('Usage: npx tsx search-macaulay-for-taxon.ts <taxonCode>');
    console.log('');
    console.log('Example:');
    console.log('  npx tsx search-macaulay-for-taxon.ts gybtes1');
    process.exit(1);
  }
  
  const taxonCode = args[0];
  
  const result = await searchMacaulayForTaxon(taxonCode);
  
  if (result && Array.isArray(result)) {
    console.log(`Found ${result.length} asset IDs`);
    console.log('Asset IDs:', result.slice(0, 5).join(', ') + (result.length > 5 ? '...' : ''));
  } else {
    console.log('Failed to retrieve data');
    process.exit(1);
  }
}

// Run main function if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}

export { searchMacaulayForTaxon };
