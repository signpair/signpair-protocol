# Signpair

Two halves. One signal.

[![Live site](https://img.shields.io/badge/live-signpair.fun-yellow?style=flat-square)](https://signpair.fun)
![Chain](https://img.shields.io/badge/chain-Solana-lightgrey?style=flat-square)

**Chain:** Solana
**Contract address:** pending (the slot at the top of the site stays inert until the address is published)

## Overview

Signpair is a live radar for the busiest Solana markets. It pulls the promoted token list, keeps the Solana entries, picks the deepest pool for each token and lays the ten most traded ones out as a board you can read at a glance.

## Features

- Live board of ten markets with logo, price, 24h move, volume and liquidity
- Ticker that runs on the same feed
- Three views of the same ten: by volume, biggest movers, deepest pools
- One-tap copy of any token address
- Registry of project facts where unconfirmed items stay inert and show "pending"
- Reduced-motion support throughout

## Links

- Site: [signpair.fun](https://signpair.fun)
- X: pending
- GitHub: pending

## Develop

```bash
npm install
npm run build   # writes dist/
npm run gates   # runs the checks, including both branches of every register record
npm run dev     # serves dist/ on http://localhost:4173
```

Deploy the contents of `dist/`.

## License

MIT. See [LICENSE](LICENSE).
