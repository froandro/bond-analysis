# Bond Analysis

[![ru](https://img.shields.io/badge/lang-ru-blue.svg)](README.ru.md)
[![en](https://img.shields.io/badge/lang-en-red.svg)](README.en.md)

A professional bond yield calculator. All data is fetched directly from the Moscow Exchange (MOEX).

## What is this for?

You buy a bond and want to know its real return — not just the coupon bid/ask, but the **net yield** after taxes, fees, accrued interest, and time to maturity. This calculator computes:

- **YTM** — yield to maturity with coupon reinvestment
- **Net Yield** — same as YTM, but after tax
- **Payback period** — when coupons cover the premium over par
- **Total profit** over the bond's lifetime
- **Cash flow chart** — month by month
- **Detailed payment schedule** — every single payment

## Screenshots

![Main screen](screenshots/183037.png?raw=true)
![Calculation results](screenshots/183103.png?raw=true)

## How to use

### 1. Find a bond

Enter a ticker, ISIN, or name in the search box. The calculator will fetch it from MOEX and fill in the price, accrued interest (ACI), maturity date, and coupon schedule automatically.

### 2. Enter your parameters

- **Investment amount** — how much money you're allocating
- **Tax rate** — 13% for residents (or 0% for IIS-B type accounts)
- **Broker commission** — usually 0.01–0.1%

Everything else (price, face value, ACI, dates) is filled in automatically.

### 3. Review the results

On the right side you'll see:

- **Net Yield** — the main metric
- **YTM** — gross yield
- **Payback** — when the premium is recovered
- **Number of bonds** — how many fit your budget
- **Chart** — capital growth over time
- **Table** — each payment broken down
- **PDF button** — save the report as a printable document

## Deploy to a VPS

A step-by-step guide for first-time VPS users. Everything is done via SSH.

### Step 1. Connect to your VPS

```bash
ssh root@your-server-ip
```

Enter the password provided by your hosting provider.

### Step 2. Install Node.js

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
```

Verify the installation:

```bash
node -v   # should show v20.x.x
npm -v    # should show 10.x.x
```

### Step 3. Clone the repository

```bash
git clone https://github.com/froandro/bond-analysis.git
cd bond-analysis
```

### Step 4. Install dependencies and build

```bash
npm install
npm run build
```

The built site will be in the `dist` folder.

### Step 5. Run it forever

```bash
npm install -g pm2
pm2 serve dist 3000 --name bond-analysis
pm2 save
pm2 startup
```

The `pm2 startup` command will print another command — run it too (it enables auto-start on server reboot).

Your site will be available at `http://your-server-ip:3000`.

### Step 6. Set up a domain and HTTPS (recommended)

```bash
sudo apt install -y nginx
```

Create a configuration file:

```bash
sudo nano /etc/nginx/sites-available/bond-analysis
```

Paste this (replace `your-domain.com` with your actual domain):

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

Enable the site and reload Nginx:

```bash
sudo ln -s /etc/nginx/sites-available/bond-analysis /etc/nginx/sites-enabled/
sudo nginx -t          # check config
sudo systemctl reload nginx
```

Your site is now on port 80 — accessible by domain without specifying a port.

**HTTPS in 2 minutes (Let's Encrypt):**

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com
```

Enter your email, agree to the terms — done, your site is on HTTPS.

### Troubleshooting

Make sure ports 80 and 3000 are open in your hosting provider's firewall (usually in your hosting panel → firewall or security group).

## Run locally

If you just want to try it out:

```bash
git clone https://github.com/froandro/bond-analysis.git
cd bond-analysis
npm install
npm run dev
```

Open http://localhost:3000 in your browser.

## Tech stack

React 19 · TypeScript · Vite · Tailwind CSS 4 · Recharts · MOEX ISS API

## License

Apache 2.0
