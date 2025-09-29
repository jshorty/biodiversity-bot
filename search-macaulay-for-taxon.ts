import puppeteer from 'puppeteer';

// The Macaulay Library does not surface a developer API. This script is not
// for downloading media from the library, just JSON metadata for public search
// results to allow embedding URL links to the asset's page in the library.
// It should not be used for requests at high volume or in any other abusive manner.

/**
 * Search for media (photos and audio) for a given taxon from Macaulay Library
 * @param taxonCode - The eBird species code (e.g., 'gybtes1' for Gray-bellied Tesia)
 * @param includeChildTaxa - Whether to include child taxa (subspecies, etc.). Needed for mammals but breaks birds.
 * @returns Object with asset IDs and function to get details for specific asset, or null if failed
 */
async function searchMacaulayForTaxon(taxonCode: string, includeChildTaxa: boolean = false): Promise<{assetIds: number[], getAssetDetails: (assetId: number) => any} | null> {
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

    if (!mainPageResponse?.ok) {
      throw new Error(`Main page call failed with status: ${mainPageResponse?.status() || 'unknown'}`);
    }

    console.log('Session established, fetching API data...');
    const apiUrl = `https://search.macaulaylibrary.org/api/v2/search?taxonCode=${taxonCode}&mediaType=photo&sort=rating_rank_desc${includeChildTaxa ? '&includeChildTaxa=true' : ''}`;
    const apiResponse = await page.goto(apiUrl, {
      waitUntil: 'networkidle2',
      timeout: 30000
    });

    if (!apiResponse?.ok) {
      throw new Error(`API call failed with status: ${apiResponse?.status() || 'unknown'}`);
    }

    const jsonData = await apiResponse.json();
    
    console.log('Successfully retrieved search data');
    
    if (!Array.isArray(jsonData)) {
      return null;
    }
    
    // Filter out images tagged as "dead"
    const filteredResults = jsonData.filter(item => {
      const tags = item.tags;
      if (Array.isArray(tags)) {
        return !tags.some(tag => tag.toLowerCase().includes('dead'));
      } else if (typeof tags === 'string') {
        return !tags.toLowerCase().includes('dead');
      }
      return true; // Include if no tags
    });
    
    console.log(`Filtered out ${jsonData.length - filteredResults.length} images tagged as 'dead'`);
    
    const assetIds = filteredResults.map(item => item.assetId).filter(id => typeof id === 'number');
    
    return {
      assetIds,
      getAssetDetails: (assetId: number) => {
        return filteredResults.find(item => item.assetId === assetId);
      }
    };

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
 * Helper function to find the best taxonomy match from API results
 */
function findBestTaxonomyMatch(taxonomyData: any[], searchTerm: string, searchType: 'species' | 'family'): any | null {
  if (!Array.isArray(taxonomyData) || taxonomyData.length === 0) {
    return null;
  }
  
  const searchLower = searchTerm.toLowerCase();
  
  // Look for exact matches first, preferring the requested type
  const exactMatches = taxonomyData.filter(item => {
    const itemName = item.name?.toLowerCase() || '';
    const scientificNameMatch = itemName.includes(` - ${searchLower}`) || itemName.includes(`- ${searchLower}`);
    const typeMatch = item.code?.includes(`,${searchType}`) || false;
    return scientificNameMatch && typeMatch;
  });
  
  if (exactMatches.length > 0) {
    return exactMatches[0];
  }
  
  // If no exact match, try the first result that matches the type
  const typeMatches = taxonomyData.filter(item => item.code?.includes(`,${searchType}`));
  if (typeMatches.length > 0) {
    return typeMatches[0];
  }
  
  // Last resort: take the first result
  return taxonomyData[0];
}

/**
 * Search for media using taxonomy API first, then Macaulay search
 * @param searchTerm - Scientific name or family name
 * @param searchType - Either 'species' or 'family'
 * @returns Object with asset IDs and metadata, or null if failed
 */
async function searchMacaulayByTaxonomy(searchTerm: string, searchType: 'species' | 'family' = 'species'): Promise<{assetIds: number[], taxonomyLevel: string, commonName?: string, getAssetDetails?: (assetId: number) => any} | null> {
  try {
    console.log(`Getting taxon code for ${searchType}: ${searchTerm}`);
    
    const encodedSearchTerm = encodeURIComponent(searchTerm);
    const taxonomyUrl = `https://taxonomy.api.macaulaylibrary.org/ws5.0/taxonomy-all?key=PUB5447877383&taxaLocale=en_US&sortByHasMedia=true&sortByCategory=false&q=${encodedSearchTerm}`;
    
    const response = await fetch(taxonomyUrl);
    if (!response.ok) {
      throw new Error(`Taxonomy API call failed with status: ${response.status}`);
    }
    
    const taxonomyData = await response.json();
    
    if (!Array.isArray(taxonomyData) || taxonomyData.length === 0) {
      console.log(`No taxonomy results found for: ${searchTerm}`);
      return null;
    }
    
    const selectedTaxonomy = findBestTaxonomyMatch(taxonomyData, searchTerm, searchType);
    if (!selectedTaxonomy) {
      return null;
    }
    
    const taxonCode = selectedTaxonomy.code?.split(',')[0];
    const commonName = selectedTaxonomy.name?.split(' - ')[0];
    
    if (!taxonCode) {
      return null;
    }
    
    console.log(`Using taxon code ${taxonCode} to search Macaulay Library`);
    const searchResults = await searchMacaulayForTaxon(taxonCode, true); // Use includeChildTaxa=true for taxonomy searches
    
    if (!searchResults || searchResults.assetIds.length === 0) {
      return null;
    }
    
    return {
      assetIds: searchResults.assetIds,
      taxonomyLevel: searchType,
      commonName,
      getAssetDetails: searchResults.getAssetDetails
    };
    
  } catch (error) {
    console.error('Error in searchMacaulayByTaxonomy:', error);
    return null;
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
  
  if (result?.assetIds) {
    console.log(`Found ${result.assetIds.length} asset IDs`);
    console.log('Asset IDs:', result.assetIds.slice(0, 5).join(', ') + (result.assetIds.length > 5 ? '...' : ''));
  } else {
    console.log('Failed to retrieve data');
    process.exit(1);
  }
}

// Run main function if this file is executed directly
if (process.argv[1]?.endsWith('search-macaulay-for-taxon.ts')) {
  main().catch(console.error);
}

export { searchMacaulayForTaxon, searchMacaulayByTaxonomy };
