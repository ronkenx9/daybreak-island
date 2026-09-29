// G14: the real-prize flow in a real browser. A test wallet stands in for
// MetaMask (same EIP-1193 calls), backed by a key on the Robinhood fork.
//   node test/browser-prize.mjs [screenshot.png]
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hexToString } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import puppeteer from 'puppeteer-core';
import { startFork } from './fork.mjs';

const PORT = 5296;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
execFileSync('npx', ['vite', 'build'], { stdio: 'ignore' }); // same-origin build served by the game server
const fork = await startFork({ port: 8548 });
const { openDb } = await import('../server/db.mjs');
const { PrizePool } = await import('../server/prizes.mjs');
const { startServer } = await import('../server/index.mjs');
const store = openDb(join(mkdtempSync(join(tmpdir(), 'dbi-browser-')), 'island.db'));
const prizes = new PrizePool({ store, mode: 'testnet', signerKey: fork.signerKey, vault: fork.vault, rpc: fork.RPC, dailyPrizes: 5 });
const srv = startServer({ port: PORT, prod: true, vite: false, secret: 'browser', store, prizes });

const player = privateKeyToAccount(generatePrivateKey());
await fork.fundEth(player.address);
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--mute-audio'] });
const finish = async (code) => { await browser.close(); srv.close(); fork.close(); process.exit(code); };
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  // the injected wallet: every request is answered in Node by the test key
  const calls = [];
  await page.exposeFunction('__wallet', async (method, params) => {
    calls.push(method);
    if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [player.address];
    if (method === 'eth_chainId') return '0xb626';
    if (method === 'wallet_switchEthereumChain' || method === 'wallet_addEthereumChain') return null;
    if (method === 'personal_sign') return player.signMessage({ message: hexToString(params[0]) });
    if (method === 'eth_sendTransaction') return fork.wallet(player).sendTransaction({ to: params[0].to, data: params[0].data });
    throw new Error(`unsupported ${method}`);
  });
  await page.evaluateOnNewDocument(() => { window.ethereum = { request: ({ method, params }) => window.__wallet(method, params ?? []) }; });
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'load' });
  await page.type('#name', 'browser-winner');
  await page.click('#play');
  await page.waitForSelector('#prizes:not([hidden])', { timeout: 10000 });

  await page.click('#link-wallet');
  await page.waitForFunction(() => document.querySelector('#prize-sub').textContent.includes('linked'), { timeout: 10000 });
  const me = [...srv.game.players.values()].find((p) => p.name === 'browser-winner');
  assert.equal(me.wallet, player.address, 'server linked the wallet');

  // a legendary chest right under the player, then dig with the E key like a human
  srv.game.chests.push({ id: 'gold-browser', x: me.x, z: me.z, rarity: 'legendary', loot: { MOON: 90 } });
  await page.keyboard.press('KeyE');
  await page.waitForSelector('#win:not([hidden])', { timeout: 10000 });
  const title = await page.$eval('#win-title', (e) => e.textContent);
  assert.match(title, /You won 1 real \$(TSLA|AMZN|NFLX|PLTR|AMD)!/);
  const ticker = title.match(/\$(\w+)/)[1];
  const before = await fork.balanceOf(ticker, player.address);
  await page.click('#win-collect');
  await page.waitForFunction(() => document.querySelector('#prize-sub').textContent.startsWith('sent!'), { timeout: 20000 });
  for (let i = 0; i < 20 && (await fork.balanceOf(ticker, player.address)) === before; i++) await wait(250);
  assert.equal(await fork.balanceOf(ticker, player.address) - before, 10n ** 18n, `wallet received 1 ${ticker}`);
  await page.waitForFunction(() => document.querySelector('#prize-list')?.textContent.includes('collected'), { timeout: 15000 });
  assert.ok(calls.includes('personal_sign') && calls.includes('eth_sendTransaction'));
  if (process.argv[2]) await page.screenshot({ path: process.argv[2] });
  assert.deepEqual(errs, []);
  console.log(`linked ${player.address}, won and collected 1 ${ticker} in the browser`);
  console.log('BROWSER PRIZE OK');
  await finish(0);
} catch (e) {
  console.error(e);
  await finish(1);
}
