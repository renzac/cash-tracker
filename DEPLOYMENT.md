# Antigravity Finance - Hosting & Device Access

To access your finance app from your phone or any other device, you need to host it on a public web server. Here are the two best ways to do it.

## Option 1: The Quickest Way (Drag & Drop)
This will give you a public link in less than 30 seconds.

1.  Open [Netlify Drop](https://app.netlify.com/drop) in your browser.
2.  Drag your entire project folder (`antigraviy_cash tracker`) into the big circle on that webpage.
3.  **Done!** Netlify will give you a generated URL (like `https://your-app-name.netlify.app`).
4.  **Copy this link** and open it on your phone.

---

## Option 2: The Professional Way (GitHub + Vercel)
**Recommended for the best experience.** This setup allows you to simply save your files, and the website updates automatically!

### 1. Upload to GitHub
1.  Go to [GitHub.com](https://github.com/new) and create a repository named `ag-finance`.
2.  Open your terminal in the project folder and run these commands:
    ```bash
    git init
    git add .
    git commit -m "Initial Launch"
    git remote add origin https://github.com/YOUR_USERNAME/ag-finance.git
    git branch -M main
    git push -u origin main
    ```

### 2. Connect to Vercel
1.  Go to [Vercel.com](https://vercel.com/new) and log in with your GitHub account.
2.  Find your `ag-finance` repository and click **Import**.
3.  Vercel will automatically detect the settings. Just click **Deploy**.
4.  **Note**: I have already added a `vercel.json` file for you, which ensures your app works perfectly as a mobile PWA (Offline support and fast loading).

---

## How to Access From Other Devices
1.  **Get your Public Link**: Follow either Option 1 or Option 2 above.
2.  **Open the Link**: Type that URL into the browser on your phone, tablet, or laptop.
3.  **Login**: Use your password (e.g., `Ren@007`).
4.  **Sync**: Because we set up **Supabase**, any transaction you add on your phone will immediately show up on your laptop!

### Pro Tip: Mobile App Feel
On iPhone (Safari) or Android (Chrome), tap the **"Share"** or **"Menu"** button and select **"Add to Home Screen"**. The app will now look and feel like a real mobile app on your phone!
