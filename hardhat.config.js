require("@nomiclabs/hardhat-truffle5");
require("@nomiclabs/hardhat-ethers");
require("@nomiclabs/hardhat-etherscan");
require("solidity-coverage");
require("hardhat-gas-reporter");
require('@openzeppelin/hardhat-upgrades');
require('hardhat-contract-sizer');

const accounts = require("./hardhatAccountsList2k.js");
const accountsList = accounts.accountsList

const fs = require('fs')
const getSecret = (secretKey, defaultValue = '') => {
  const SECRETS_FILE = "./secrets.js"
  let secret = defaultValue
  if (fs.existsSync(SECRETS_FILE)) {
    const { secrets } = require(SECRETS_FILE)
    if (secrets[secretKey]) { secret = secrets[secretKey] }
  }

  return secret
}
const alchemyUrl = () => {
  return `https://eth-mainnet.alchemyapi.io/v2/${getSecret('alchemyAPIKey')}`
}

/*const alchemyUrlRinkeby = () => {
  return `https://eth-rinkeby.alchemyapi.io/v2/${getSecret('alchemyAPIKeyRinkeby')}`
}*/

module.exports = {
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts"
  },
  /*contractSizer: {
    alphaSort: true,
    disambiguatePaths: false,
    runOnCompile: true,
    strict: true,
  },*/
  solidity: {
    version: "0.8.14",
    settings: {
      optimizer: {
        enabled: true,
        runs: 5,
      },
    },
  },
  networks: {
    hardhat: {
      allowUnlimitedContractSize: true,
      accounts: accountsList,
      initialBaseFeePerGas: 0,
      gas: 10000000,  // tx gas limit
      blockGasLimit: 15000000,
      gasPrice: 20000000000,
      hardfork: "london"
    },
    localhost: {
      url: "http://localhost:8545",
      gas: 20000000,  // tx gas limit
    },
    /*mainnet: {
      url: "https://arb1.arbitrum.io/rpc",
      gasPrice: process.env.GAS_PRICE ? parseInt(process.env.GAS_PRICE) : 20000000000,
      accounts: [
        getSecret('DEPLOYER_PRIVATEKEY', '0x0')
      ]
    },*/
    rinkeby: {
      url: "https://eth-rinkeby.alchemyapi.io/v2/2sDTn5oKXqo8Kzjw1XisAoqk_qUJtUk5",
      gas: 10000000,  // tx gas limit
      accounts: ["0xbd6a50838e691b935deaa6a68c8ee3805c5a72d08e219deb9ae002a226fb632b"]
    },
  },
  etherscan: {
    apiKey: getSecret("ETHERSCAN_API_KEY")
  },
  mocha: { timeout: 12000000 },
  rpc: {
    host: "localhost",
    port: 8545
  },
  gasReporter: {
    enabled: (process.env.REPORT_GAS) ? true : false
  }
};
