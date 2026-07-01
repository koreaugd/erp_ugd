<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://ai.google.dev/static/site-assets/images/share-ais-513315318.png" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

## ERP Data Sync Rule

All branch-entered ERP business data must be visible from every computer for the same branch. New code must save business data to the shared backend through Firestore/GAS/Sheets helpers such as `gasClient.saveSharedData`; `localStorage` may be used only as a temporary cache, draft, or fallback and must be merged with shared data instead of replacing it.

View your app in AI Studio: https://ai.studio/apps/83ebb8c7-69ed-4ffa-a5a9-dc0fd4db5d76

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`
