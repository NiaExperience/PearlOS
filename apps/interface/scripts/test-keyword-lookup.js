import axios from 'axios';

async function testKeywordLookup() {
  try {
    const response = await axios.post('http://localhost:3000/api/keyword-lookup', {
      keyword: 'Manual Test'
    }, {
      headers: {
        'Content-Type': 'application/json'
      }
    });

    console.log('✅ Success:');
    console.log(response.data);
  } catch (error) {
    console.error('❌ Error:');
    if (error.response) {
      console.log('Status:', error.response.status);
      console.log('Data:', error.response.data);
    } else {
      console.log(error.message);
    }
  }
}

testKeywordLookup(); 