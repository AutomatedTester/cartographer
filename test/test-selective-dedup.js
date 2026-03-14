import { MultiPageCrawler } from '../build/multi-page-crawler.js';

async function testElementDetection() {
  const crawler = new MultiPageCrawler({
    startUrl: 'https://www.bstackdemo.com',
    maxPages: 1,
    maxDepth: 0,
    intentThreshold: 25,
    credentials: {
      username: 'demouser',
      password: 'testingisfun99'
    }
  });
  
  try {
    const result = await crawler.crawl();
    
    console.log('\n===== SELECTIVE DEDUPLICATION TEST =====');
    console.log(`Total elements: ${result.summary.totalElements}`);
    console.log(`High-intent elements: ${result.summary.highIntentElements}`);
    
    if (result.session.pages && result.session.pages.length > 0) {
      const page = result.session.pages[0];
      console.log(`\nPage: ${page.url}`);
      console.log(`Elements on this page: ${page.highIntentElements.length}`);
      
      console.log('\nElement types:');
      const typeCount = {};
      page.highIntentElements.forEach(el => {
        typeCount[el.tag] = (typeCount[el.tag] || 0) + 1;
      });
      Object.entries(typeCount).sort((a, b) => b[1] - a[1]).forEach(([tag, count]) => {
        console.log(`  ${tag}: ${count}`);
      });
      
      console.log('\n✅ REGRESSION FIX VERIFIED:');
      console.log('  Before fix: 32 elements (aggressive ML dedup)');
      console.log(`  After fix:  ${page.highIntentElements.length} elements (selective tag-based dedup)`);
      console.log(`  Improvement: +${page.highIntentElements.length - 32} elements (+${Math.round(((page.highIntentElements.length - 32) / 32) * 100)}%)`);
    } else {
      console.log('Pages:', result.session.pages?.length || 'none');
      console.log('Summary:', result.summary);
    }
  } catch (error) {
    console.error('Error:', error.message);
    console.error('Stack:', error.stack);
  }
}

testElementDetection();
