# QUICK START — exact order

1. Go to GitHub and create a new **Public** repository named `wtf-scifi-stremio`.
2. You may initialize it with a README or leave it empty.
3. Upload the **contents** of this folder to the repository root. The repository root should directly contain `.github`, `config`, `data`, `scripts`, `package.json`, and `README.md`.
4. GitHub → repository **Settings** → **Pages** → **Build and deployment** → Source: **GitHub Actions**.
5. GitHub → **Actions** and wait for both workflows to succeed.
6. If GitHub asks you to enable Actions for the repository, enable them.
7. Open `https://YOUR_USERNAME.github.io/wtf-scifi-stremio/`.
8. Install `https://YOUR_USERNAME.github.io/wtf-scifi-stremio/manifest.json` into Stremio.
9. Make sure the TV uses the same Stremio account, then restart Stremio on the TV.
10. Come back to ChatGPT and say: `My repo is YOUR_USERNAME/wtf-scifi-stremio. Set up the daily automation.`

At that point ChatGPT can directly update the repository and create the daily scheduled discovery task.
