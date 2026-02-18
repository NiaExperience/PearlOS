-- Add 'soundtrack' to your assistant's supportedFeatures array
-- Replace 'pearl' with your assistant's subdomain if different

UPDATE assistants 
SET "supportedFeatures" = ARRAY_APPEND("supportedFeatures", 'soundtrack')
WHERE "subDomain" = 'pearl' 
  AND NOT ('soundtrack' = ANY("supportedFeatures"));

-- Verify it was added
SELECT "name", "subDomain", "supportedFeatures" 
FROM assistants 
WHERE "subDomain" = 'pearl';

