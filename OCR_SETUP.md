# OCR API Setup Guide

Complete guide for setting up MyScript and Google Cloud Vision API for handwriting recognition.

---

## MyScript API Setup

MyScript offers 2000 free handwriting recognition requests per month. It's excellent for cursive writing and supports multiple languages.

### Step-by-Step Setup

#### 1. Create MyScript Account

1. Go to [https://developer.myscript.com](https://developer.myscript.com)
2. Click **"Sign Up"** in the top right
3. Fill in your details:
   - Email address
   - Password
   - First and last name
4. Verify your email address (check inbox for confirmation email)
5. Log in to the developer portal

#### 2. Create an Application

1. Once logged in, click **"+ New Application"** or **"Create Application"**
2. Fill in application details:
   - **Application Name**: Choose any name (e.g., "Obsidian Handwrite")
   - **Application Type**: Select **"Web"**
   - **Recognition Type**: Select **"iink"** (this is their handwriting recognition engine)
3. Click **"Create"** or **"Submit"**

#### 3. Get Your API Keys

1. After creating the application, you'll see your application dashboard
2. Look for two important keys:
   - **Application Key** (also called "App Key")
   - **HMAC Key** (authentication key)
3. **Copy both keys** - you'll need them for the plugin

> **Important**: Keep these keys private! Don't share them or commit them to public repositories.

#### 4. Add Keys to Plugin

1. Open Obsidian
2. Go to **Settings → Community Plugins → Handwrite** (or Annotate)
3. In the OCR Settings section:
   - **OCR Provider**: Select "MyScript"
   - **MyScript Application Key**: Paste your Application Key
   - **MyScript HMAC Key**: Paste your HMAC Key
4. Click outside the text boxes to save

#### 5. Test It

1. Create a new handwriting section
2. Draw some text
3. Click **"Extract Text (OCR)"**
4. If setup is correct, you'll see recognized text

### MyScript Free Tier Limits

- **2000 requests per month** (resets monthly)
- The plugin tracks your usage in settings
- After 2000 requests, you'll need to:
  - Wait for next month's reset
  - Switch to Google Cloud Vision
  - Upgrade to a paid MyScript plan

### Troubleshooting MyScript

**"Invalid credentials" error**:
- Double-check you copied both keys correctly (no extra spaces)
- Make sure you selected "iink" recognition type when creating app
- Verify your account is activated (check email)

**"Quota exceeded" error**:
- You've used all 2000 free requests this month
- Check usage counter in plugin settings
- Switch to Google Cloud Vision temporarily

---

## Google Cloud Vision API Setup

Google Cloud Vision offers 1000 free requests per month. It's better for print-style handwriting and supports image/PDF OCR.

### Step-by-Step Setup

#### 1. Create Google Cloud Account

1. Go to [https://console.cloud.google.com](https://console.cloud.google.com)
2. Sign in with your Google account (or create one)
3. Accept the Google Cloud Terms of Service if prompted

> **Note**: Google may ask for payment information, but you won't be charged unless you explicitly upgrade. The free tier is truly free for 1000 requests/month.

#### 2. Create a New Project

1. In the top navigation bar, click the **project dropdown** (next to "Google Cloud")
2. Click **"New Project"**
3. Enter project details:
   - **Project Name**: e.g., "Obsidian OCR"
   - **Organization**: Leave as "No organization" (unless you have one)
4. Click **"Create"**
5. Wait a few seconds for the project to be created
6. Select your new project from the dropdown

#### 3. Enable Cloud Vision API

1. In the left sidebar, go to **"APIs & Services" → "Library"**
   - Or use the search bar and type "API Library"
2. Search for **"Cloud Vision API"**
3. Click on **"Cloud Vision API"** in the results
4. Click the **"Enable"** button
5. Wait for the API to be enabled (takes ~30 seconds)

#### 4. Create API Key

1. Go to **"APIs & Services" → "Credentials"**
2. Click **"+ Create Credentials"** at the top
3. Select **"API Key"** from the dropdown
4. A popup appears with your new API key
5. **Copy the API key** immediately
6. (Optional but recommended) Click **"Restrict Key"**:
   - **Application restrictions**: Select "None" (or "HTTP referrers" for web use)
   - **API restrictions**: Select "Restrict key"
   - Choose **"Cloud Vision API"** from the list
   - Click **"Save"**

> **Security Note**: Restricting your API key prevents it from being used for other Google services if it's leaked.

#### 5. Add API Key to Plugin

1. Open Obsidian
2. Go to **Settings → Community Plugins → Handwrite** (or Annotate)
3. In the OCR Settings section:
   - **OCR Provider**: Select "Google Cloud Vision"
   - **Google Cloud API Key**: Paste your API key
4. Click outside the text box to save

#### 6. Test It

1. Create a new handwriting section
2. Draw some text
3. Click **"Extract Text (OCR)"**
4. If setup is correct, you'll see recognized text

### Google Cloud Vision Free Tier Limits

- **1000 requests per month** (resets monthly)
- First 1000 requests are free every month
- After 1000 requests, you'll be charged (if billing is enabled)
- The plugin tracks your usage in settings

### Staying Within Free Tier

To avoid charges:

1. **Monitor usage**: Check the usage counter in plugin settings
2. **Disable billing**: In Google Cloud Console → "Billing"
   - You can disable billing to prevent any charges
   - API will stop working after 1000 requests, but you won't be charged
3. **Switch providers**: Alternate between MyScript and Google Cloud Vision

### Troubleshooting Google Cloud Vision

**"API key not valid" error**:
- Double-check you copied the API key correctly
- Make sure Cloud Vision API is enabled for your project
- If you restricted the key, verify "Cloud Vision API" is in the allowed list

**"Quota exceeded" error**:
- You've used all 1000 free requests this month
- Wait for next month's reset
- Switch to MyScript temporarily
- Or enable billing to continue (will start charging after 1000)

**"This API project is not authorized" error**:
- Cloud Vision API isn't enabled for your project
- Go back to Step 3 and enable it
- Wait a few minutes after enabling before testing

---

## Comparison: MyScript vs Google Cloud Vision

| Feature | MyScript | Google Cloud Vision |
|---------|----------|---------------------|
| **Free Tier** | 2000 requests/month | 1000 requests/month |
| **Best For** | Cursive handwriting | Print-style handwriting |
| **Accuracy** | 98% (cursive) | 95% (print) |
| **Languages** | 70+ languages | 50+ languages |
| **Math Support** | ✅ Yes (LaTeX output) | ❌ Limited |
| **Setup Difficulty** | Easy | Moderate |
| **Payment Info Required** | ❌ No | ⚠️ Sometimes |

## Recommendations

### For Most Users
- **Start with MyScript**: Easier setup, no payment info needed, higher free tier
- **Use Google Cloud Vision as backup**: When MyScript quota runs out

### For Specific Use Cases
- **Cursive writing**: MyScript (much better accuracy)
- **Math equations**: MyScript (supports LaTeX output)
- **Print handwriting**: Google Cloud Vision (slightly better)
- **Image/PDF OCR**: Google Cloud Vision only (MyScript works on strokes only)

### Combined Strategy (4000 Free Requests/Month!)
1. Set up **both** services
2. Use MyScript as primary (2000 free)
3. When MyScript quota runs out, switch to Google Cloud Vision (1000 more free)
4. Manually switch providers in plugin settings when needed

---

## Privacy & Data

### MyScript
- Handwriting strokes sent to MyScript servers for recognition
- See [MyScript Privacy Policy](https://developer.myscript.com/privacy-policy)
- Data is processed but not permanently stored

### Google Cloud Vision
- Images sent to Google Cloud for OCR
- See [Google Cloud Privacy Notice](https://cloud.google.com/terms/cloud-privacy-notice)
- Data may be used to improve Google services (check privacy settings)

### Keep Data Local?
- Both services require sending data to cloud servers
- If you need 100% local/offline OCR:
  - Consider Tesseract OCR (lower accuracy, but fully local)
  - Future plugin update may add Tesseract support

---

## Support

### Need Help?

**MyScript Issues**:
- [MyScript Developer Support](https://developer.myscript.com/support)
- [MyScript Documentation](https://developer.myscript.com/docs)

**Google Cloud Issues**:
- [Cloud Vision API Documentation](https://cloud.google.com/vision/docs)
- [Google Cloud Support](https://cloud.google.com/support)

**Plugin Issues**:
- GitHub Issues for the respective plugin
- Check plugin documentation

---

**Setup complete!** You should now have OCR working in your Obsidian handwriting plugin. 🎉
