// Measures REAL gas of logActivityHeavy on a local EVM, then prices it at Ronin's current 21 gwei.
const { VM } = require('@ethereumjs/vm');
const { Address, Account, hexToBytes } = require('@ethereumjs/util');
const { ethers } = require('ethers');
const art = require('../artifacts/GasSpend.json');
const iface = new ethers.Interface(art.abi);
const RON = 10n ** 18n;
const GWEI = 10n ** 9n;

async function call(vm, from, to, data, value = 0n, gas = 120_000_000n) {
  const r = await vm.evm.runCall({ caller: from, to, data: hexToBytes(data), gasLimit: gas, value });
  return r;
}
(async () => {
  const vm = await VM.create();
  const sm = vm.stateManager;
  const owner = Address.fromString('0x1111111111111111111111111111111111111111');
  const alice = Address.fromString('0x2222222222222222222222222222222222222222');
  const treasury = Address.fromString('0x4444444444444444444444444444444444444444');
  for (const a of [owner, alice]) await sm.putAccount(a, new Account(0n, 1000n * RON));

  const initCode = art.bytecode + iface.encodeDeploy([treasury.toString(), 10_000_000_000n]).slice(2);
  let r = await call(vm, owner, undefined, initCode, 0n, 60_000_000n);
  const c = r.createdAddress;
  console.log('deployed at', c.toString());

  const gwei21 = 21n * GWEI;
  console.log('Ronin now: base fee 20 gwei, gas price ~21 gwei, block limit 59,997,440\n');
  console.log('slots | real gas used   | real RON spent @21gwei | % of block limit');
  for (const slots of [100n, 500n, 1000n, 2000n]) {
    r = await call(vm, alice, c, iface.encodeFunctionData('logActivityHeavy', [ethers.ZeroHash, slots]));
    if (r.execResult.exceptionError) throw new Error('heavy failed @' + slots + ': ' + r.execResult.exceptionError);
    const g = r.execResult.executionGasUsed;
    const ron = (g * gwei21) / RON;
    const pct = Number(g) / 59_997_440 * 100;
    console.log(`${slots.toString().padStart(5)} | ${g.toString().padStart(14)} | ${(Number(g) * 21 / 1e9).toFixed(4).padStart(14)} RON  | ${pct.toFixed(1)}%`);
  }

  // over-cap behavior: requesting 9999 slots should be clamped to maxHeavySlots (2000)
  r = await call(vm, alice, c, iface.encodeFunctionData('logActivityHeavy', [ethers.ZeroHash, 9999n]));
  const gCap = r.execResult.executionGasUsed;
  console.log('\nrequested 9999 -> clamped to 2000, gas =', gCap.toString());

  // records are real & permanent
  r = await call(vm, alice, c, iface.encodeFunctionData('heavyRecordCount', [alice.toString()]));
  console.log('alice permanent heavy records:', iface.decodeFunctionResult('heavyRecordCount', r.execResult.returnValue)[0].toString());

  // owner raises cap to 2400 (~53M gas) — near block limit, ~1.11 RON/call @21gwei
  await call(vm, owner, c, iface.encodeFunctionData('setMaxHeavySlots', [2400n]));
  r = await call(vm, alice, c, iface.encodeFunctionData('logActivityHeavy', [ethers.ZeroHash, 2400n]));
  const g2400 = r.execResult.executionGasUsed;
  console.log('after cap->2400: gas =', g2400.toString(),
              '| RON @21gwei =', (Number(g2400) * 21 / 1e9).toFixed(4),
              '| block% =', (Number(g2400) / 59_997_440 * 100).toFixed(1));

  console.log('\nHEAVY TESTS PASSED ✔');
})().catch(e => { console.error('FAIL:', e); process.exit(1); });
