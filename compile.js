// Compiles GasSpend.sol with solc 0.8.26 and writes ABI + bytecode to artifacts/.
const fs = require('fs');
const path = require('path');
const solc = require('solc');

const src = fs.readFileSync(path.join(__dirname, '..', 'contracts', 'GasSpend.sol'), 'utf8');
const input = {
  language: 'Solidity',
  sources: { 'GasSpend.sol': { content: src } },
  settings: {
    optimizer: { enabled: true, runs: 200 },
    outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object', 'metadata'] } }
  }
};
const out = JSON.parse(solc.compile(JSON.stringify(input)));
if (out.errors && out.errors.some(e => e.severity === 'error')) {
  console.error(out.errors.map(e => e.formattedMessage).join('\n'));
  process.exit(1);
}
const c = out.contracts['GasSpend.sol']['GasSpend'];
const bytecode = '0x' + c.evm.bytecode.object;
const deployed = '0x' + c.evm.deployedBytecode.object;
const artifact = { contractName: 'GasSpend', abi: c.abi, bytecode, deployedBytecode: deployed, compiler: { version: '0.8.26' }, metadata: JSON.parse(c.metadata) };
fs.mkdirSync(path.join(__dirname, '..', 'artifacts'), { recursive: true });
fs.writeFileSync(path.join(__dirname, '..', 'artifacts', 'GasSpend.json'), JSON.stringify(artifact, null, 2));
console.log('OK  compiled GasSpend 0.8.26');
console.log('ABI functions:', c.abi.filter(x => x.type === 'function').map(x => x.name).join(', '));
console.log('creation bytecode size :', (bytecode.length - 2) / 2, 'bytes');
console.log('deployed bytecode size :', (deployed.length - 2) / 2, 'bytes  (EIP-170 limit 24576)');
