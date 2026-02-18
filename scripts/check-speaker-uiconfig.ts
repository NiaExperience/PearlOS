// check-speaker-uiConfig.ts
// Script to fetch and pretty-print the uiConfig for the Speaker DynamicContent definition from the DB.
// Usage: npx ts-node scripts/check-speaker-uiConfig.ts

import fetch from 'node-fetch';

async function main() {

  // API fetch
  try {
    const res = await fetch("http://localhost:3000/api/contentDetail?tenantId=9b765bd4-7023-478e-88e8-57583da4ffaf&type=Speaker&query=%7B%22%24or%22%3A%5B%7B%22content%22%3A%7B%22%24like%22%3A%22%25Lisa%20Bauer%25%22%7D%7D%5D%7D");
    if (!res.ok) throw new Error(`API returned status ${res.status}`);
    const apiData = await res.json();
    if (!apiData.definition) {
      console.error('No definition found in API response.');
    } else {
      console.log('\nSpeaker uiConfig from API:');
      console.log(JSON.stringify(apiData.definition.uiConfig, null, 2));
    }

    const res2 = await fetch("http://localhost:3000/api/contentList?tenantId=9b765bd4-7023-478e-88e8-57583da4ffaf&type=Exhibitor&query=%7B%7D");
    if (!res2.ok) throw new Error(`API returned status ${res2.status}`);
    const apiData2 = await res2.json();
    if (!apiData2.definition) {
      console.error('No definition found in API response.');
    } else {
      console.log('\nExhibitor uiConfig from API:');
      console.log(JSON.stringify(apiData2.definition.uiConfig, null, 2));
    }

  } catch (err) {
    console.error('Error fetching from API:', err);
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
}); 