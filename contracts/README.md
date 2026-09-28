# PrizeVault

Holds the real-stock prize pool for Daybreak Island (see the main README, "Real-stock prizes").

```bash
git submodule update --init --recursive   # OpenZeppelin 5.7.0, forge-std 1.16.2
forge test                                # unit + fuzz tests
```

Deploy with `node scripts/deploy-vault.mjs` from the repo root.
