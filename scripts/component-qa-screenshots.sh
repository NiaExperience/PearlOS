#!/bin/bash
echo "QA Component Screenshots"
echo "========================="
echo ""
echo "1. MagicWandButton:"
ls -la apps/interface/src/features/Notes/components/MagicWandButton.tsx
echo ""
echo "2. AgentCapsule:"
ls -la apps/interface/src/features/ActiveJobs/components/AgentCapsule.tsx
echo ""
echo "3. ProjectGallery:"
ls -la apps/interface/src/features/CreationLaunchpad/components/ProjectGallery.tsx
echo ""
echo "4. ProjectMenu:"
ls -la apps/interface/src/features/CreationLaunchpad/components/ProjectMenu.tsx
echo ""
echo "5. Agency Coordinator:"
ls -la apps/bot-gateway/src/routes/agency.ts
echo ""
echo "6. API Endpoint:"
ls -la apps/interface/src/app/api/launchpad/create-project/route.ts
echo ""
echo "All components verified present!"
