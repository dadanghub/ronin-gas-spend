require('@nomicfoundation/hardhat-toolbox');

module.exports = {
  solidity: {
    version: '0.8.26',
    settings: { optimizer: { enabled: true, runs: 200 } }
  },
  networks: {
    ronin: {
      url: 'https://api.roninchain.com/rpc',
      chainId: 2020,
      accounts: process.env.DEPLOYER_PRIVATE_KEY ? [process.env.DEPLOYER_PRIVATE_KEY] : []
    },
    saigon: {
      url: 'https://saigon-testnet.roninchain.com/rpc',
      chainId: 2021,
      accounts: process.env.DEPLOYER_PRIVATE_KEY ? [process.env.DEPLOYER_PRIVATE_KEY] : []
    }
  },
  // Ronin recommends Sourcify for source verification.
  sourcify: { enabled: true },
  etherscan: {
    apiKey: { ronin: 'empty', saigon: 'empty' },
    customChains: [
      { network: 'ronin', chainId: 2020, urls: { apiURL: 'https://explorer.roninchain.com/api', browserURL: 'https://explorer.roninchain.com' } },
      { network: 'saigon', chainId: 2021, urls: { apiURL: 'https://saigon-explorer.roninchain.com/api', browserURL: 'https://saigon-explorer.roninchain.com' } }
    ]
  }
};
