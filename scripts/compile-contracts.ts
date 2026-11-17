import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import solc from 'solc';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const sourcePath = 'contracts/MLedgerSettlementRegistry.sol';

export async function compileRegistry() {
  const content = await readFile(path.join(root, sourcePath), 'utf8');
  const input = {
    language: 'Solidity',
    sources: { [sourcePath]: { content } },
    settings: {
      optimizer: { enabled: true, runs: 200 },
      outputSelection: {
        '*': {
          '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object'],
        },
      },
    },
  };
  const output = JSON.parse(solc.compile(JSON.stringify(input)));
  const errors = output.errors?.filter((item: { severity: string }) => item.severity === 'error') ?? [];
  if (errors.length) throw new Error(errors.map((item: { formattedMessage: string }) => item.formattedMessage).join('\n'));

  const contract = output.contracts?.[sourcePath]?.MLedgerSettlementRegistry;
  if (!contract?.evm.bytecode.object) throw new Error('Solidity compiler did not produce registry bytecode.');
  return contract;
}

async function main() {
  const contract = await compileRegistry();
  const outputDirectory = path.join(root, 'dist', 'contracts');
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(path.join(outputDirectory, 'MLedgerSettlementRegistry.json'), JSON.stringify({
    contractName: 'MLedgerSettlementRegistry',
    sourceName: sourcePath,
    compilerVersion: solc.version(),
    abi: contract.abi,
    bytecode: `0x${contract.evm.bytecode.object}`,
    deployedBytecode: `0x${contract.evm.deployedBytecode.object}`,
  }, null, 2));
  console.log(`Compiled ${sourcePath} with ${solc.version()}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
