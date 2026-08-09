// Deploy GasSpend on Ronin (or Saigon):
//   DEPLOYER_PRIVATE_KEY=0x... TREASURY=0x... npx hardhat run scripts/deploy-hardhat.js --network ronin
const { ethers } = require('hardhat');

async function main() {
  const [deployer] = await ethers.getSigners();
  const treasury = process.env.TREASURY || deployer.address;
  const rebatePerGas = process.env.REBATE_PER_GAS || ethers.parseUnits('0.00000001', 'ether'); // 10 gwei / gas unit

  console.log('Deploying GasSpend from', deployer.address);
  console.log('treasury     =', treasury);
  console.log('rebatePerGas =', rebatePerGas.toString(), '(wei per gas unit)');

  const GasSpend = await ethers.getContractFactory('GasSpend');
  const c = await GasSpend.deploy(treasury, rebatePerGas);
  await c.waitForDeployment();
  console.log('GasSpend deployed at:', await c.getAddress());
  console.log('Now: send RON to the contract to fund the rebate pool.');

  // Optional: verify on Sourcify
  // await hre.run('verify:verify', { address: await c.getAddress() });
}

main().catch((e) => { console.error(e); process.exit(1); });
