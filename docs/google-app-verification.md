**TL/DR**
### We need
   - To lock down our domain for the app: nxops.net?
   - Terms of Service doc (hosted, public, link to be submitted)
   - Privacy Policy doc (hosted, public, link to be submitted)
   - 5-6m Video description of product (to be submitted)
   - Detailed app description (to be submitted)
   - A contact email for google to engage


To enable your application to use Google OAuth with redirect URIs beyond localhost (e.g., for production environments), you'll need to undergo Google's OAuth app verification process. This ensures your app complies with Google's policies and can securely access user data. Here's a step-by-step guide to initiate and navigate this process:

---

### ✅ Step 1: Configure the OAuth Consent Screen

1. **Access Google Cloud Console**: Navigate to [Google Cloud Console](https://console.cloud.google.com/).

2. **Select or Create a Project**: Choose your existing project or create a new one.

3. **Navigate to OAuth Consent Screen**: In the left sidebar, go to **APIs & Services > OAuth consent screen**.

4. **Set User Type**:

   * **External**: For apps used by users outside your organization.
   * **Internal**: For apps used only within your organization (requires a Google Workspace account).

5. **Provide App Information**:

   * **App Name**: Displayed on the consent screen.
   * **User Support Email**: Contact email for users.
   * **App Logo**: Optional, but recommended for brand recognition.

6. **Add Authorized Domains**: List all domains associated with your app, including those used in redirect URIs.
   - the staging domain - https://nxops.net/
   - the production domain - ?????

7. **Provide Developer Contact Information**: Email addresses for Google to contact regarding the verification process.
   - who is the contact for google?  Friend@niaxp.com? jeff? bill?

8. **Save and Continue**: Proceed through the scopes and summary sections, then save your configuration.

---

### 🔐 Step 2: Determine If Verification Is Required

Verification is necessary if your app:

* Uses **sensitive** or **restricted** scopes (e.g., accessing Gmail, Google Drive).
* Is set to **External** user type and is intended for public use.
* Requests access to user data beyond basic profile information.

If your app uses only non-sensitive scopes and is limited to internal use or testing, verification might not be required. However, unverified apps have limitations, such as a 100-user cap and potential warnings to users during the OAuth flow.

**WE DEFINITELY NEED VERIFICATION**

---

### 📝 Step 3: Prepare for Verification

Before submitting for verification, ensure the following:

1. **Verified Domains**: Use [Google Search Console](https://search.google.com/search-console/about) to verify ownership of all domains listed in your OAuth consent screen.

2. **Privacy Policy and Terms of Service**:

   * Host these documents on your verified domains.
   * Ensure they are accessible and clearly state how user data is handled.
      - Need to create these - who should create 'legalesque' policy docs?  steph?

3. **YouTube Video Demonstration**:

   * Create a short video (5-6 minutes) demonstrating:

     * How users interact with your app.
     * How Google user data is accessed and used.
     * The OAuth consent flow.
   * Upload this video to YouTube and set it as "Unlisted."
   - Friend?

4. **Detailed App Description**:

   * Provide a clear explanation of why your app requires the requested scopes.
   * Describe how user data will be used, stored, and protected.
   - Friend?

---

### 📤 Step 4: Submit for Verification

1. **Return to OAuth Consent Screen**: In the Google Cloud Console, go back to **APIs & Services > OAuth consent screen**.

2. **Click "Publish App"**: This initiates the verification process.

3. **Complete Verification Steps**:

   * Upload your YouTube demonstration video.
   * Provide links to your privacy policy and terms of service.
   * Submit any additional required information.

4. **Await Google's Review**:

   * The review process typically takes 2-3 business days, but it can vary.
   * Monitor your email (provided in the developer contact information) for any communication from Google's Trust & Safety team.
   * Respond promptly to any requests for additional information.

---

### 🔄 Step 5: Post-Verification Actions

Once your app is verified:

* **Monitor for Re-verification Needs**:

  * Significant changes to your app (e.g., adding new scopes, changing app information) may require re-verification.
  * Google may request annual re-verification for apps accessing sensitive or restricted scopes.

* **Maintain Compliance**:

  * Ensure your app continues to adhere to Google's policies.
  * Keep your privacy policy and terms of service up to date.

---

By following these steps, you'll align your application with Google's requirements, enabling secure and verified OAuth integration for production environments.
