import { createPlatformContentDefinitions } from '@nia/prism/core/utils/platform-definitions';

async function registerPlatformDefinitions() {
  try {
    console.log('Registering platform definitions...');

    // Assuming createPlatformContentDefinitions is a function that registers definitions
    await createPlatformContentDefinitions();

    console.log('Platform definitions registered successfully.');
  } catch (error) {
    console.error('Error registering platform definitions:', error);
  }
}

registerPlatformDefinitions();