// Robinhood Chain testnet (chain id 46630). The stock tokens are the official
// faucet Stock Tokens (18 decimals), checked on-chain in Keep Digging's
// verify-chain script and again by scripts/check-vault.mjs.
export const CHAIN = {
  id: 46630,
  hexId: '0xb626',
  name: 'Robinhood Chain Testnet',
  rpc: 'https://rpc.testnet.chain.robinhood.com',
  explorer: 'https://explorer.testnet.chain.robinhood.com',
  faucet: 'https://faucet.testnet.chain.robinhood.com',
  currency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
};

export const STOCK_TOKENS = {
  TSLA: '0xC9f9c86933092BbbfFF3CCb4b105A4A94bf3Bd4E',
  AMZN: '0x5884aD2f920c162CFBbACc88C9C51AA75eC09E02',
  NFLX: '0x3b8262A63d25f0477c4DDE23F83cfe22Cb768C93',
  PLTR: '0x1FBE1a0e43594b3455993B5dE5Fd0A7A266298d0',
  AMD: '0x71178BAc73cBeb415514eB542a8995b82669778d',
};

export const VAULT_ABI = [
  {
    type: 'function', name: 'claim', stateMutability: 'nonpayable', outputs: [],
    inputs: [
      { name: 'v', type: 'tuple', components: [
        { name: 'to', type: 'address' }, { name: 'token', type: 'address' }, { name: 'amount', type: 'uint256' },
        { name: 'id', type: 'uint256' }, { name: 'expiry', type: 'uint64' },
      ] },
      { name: 'sig', type: 'bytes' },
    ],
  },
  { type: 'function', name: 'used', stateMutability: 'view', inputs: [{ name: 'id', type: 'uint256' }], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'signer', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'paused', stateMutability: 'view', inputs: [], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'dailyCap', stateMutability: 'view', inputs: [{ name: 'token', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'walletClaimsPerDay', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'hasRole', stateMutability: 'view', inputs: [{ name: 'role', type: 'bytes32' }, { name: 'account', type: 'address' }], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'GUARDIAN_ROLE', stateMutability: 'view', inputs: [], outputs: [{ type: 'bytes32' }] },
  { type: 'function', name: 'pause', stateMutability: 'nonpayable', inputs: [], outputs: [] },
  { type: 'function', name: 'fund', stateMutability: 'nonpayable', inputs: [{ name: 'token', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [] },
];

// EIP-712 voucher, must match PrizeVault.sol
export const VOUCHER_TYPES = {
  Voucher: [
    { name: 'to', type: 'address' }, { name: 'token', type: 'address' }, { name: 'amount', type: 'uint256' },
    { name: 'id', type: 'uint256' }, { name: 'expiry', type: 'uint64' },
  ],
};
export const voucherDomain = (chainId, vault) => ({ name: 'DaybreakIslandPrizes', version: '1', chainId, verifyingContract: vault });
