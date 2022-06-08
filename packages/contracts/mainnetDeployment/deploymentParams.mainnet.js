const externalAddrs  = {
  // https://data.chain.link/eth-usd
  CHAINLINK_ETHUSD_PROXY: "0x8A753747A1Fa494EC906cE90E9f37563A8AF630e", 
  // https://docs.tellor.io/tellor/integration/reference-page
  TELLOR_MASTER:"0x20374E579832859f180536A69093A126Db1c8aE9",
  // https://uniswap.org/docs/v2/smart-contracts/factory/
  UNISWAP_V2_FACTORY: "0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f",
  UNISWAP_V2_ROUTER02: "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D",
  WETH_ERC20: "0xc778417e063141139fce010982780140aa0cd5ab",
}

const liquityAddrsTest = {
  GENERAL_SAFE:"0x6153CD847C9E479b5e755B67854169C4F63A2B65",  // Hardhat dev address
  LQTY_SAFE:"0xE529D1998e808cc3b6985176183A5651a2B923F5",  //  Hardhat dev address
  // LQTY_SAFE:"0x66aB6D9362d4F35596279692F0251Db635165871",
  DEPLOYER: "0xed9DeD8d0ee1d7086EC2BbFD8c5AD999d4BB7034" // Mainnet test deployment address
}

const liquityAddrs = {
  GENERAL_SAFE:"0x6153CD847C9E479b5e755B67854169C4F63A2B65", // TODO
  LQTY_SAFE:"0xE529D1998e808cc3b6985176183A5651a2B923F5", // TODO
  DEPLOYER: "0xed9DeD8d0ee1d7086EC2BbFD8c5AD999d4BB7034",
}

const beneficiaries = {
  TEST_INVESTOR_A: "0x9e929dB7eF585e02bBd921ab084d17797ae63CE0",
  TEST_INVESTOR_B: "0xc78E9AD727BA272b61C89d4B71B28408f66477FE",
  TEST_INVESTOR_C: "0x1E5543e89cAb57Da7e67E7F74cCCd48e60E7a425",
  TEST_INVESTOR_D: "0xffbb4f4b113b05597298b9d8a7d79e6629e726e8",
  TEST_INVESTOR_E: "0x89ff871dbcd0a456fe92db98d190c38bc10d1cc1"
}

const OUTPUT_FILE = './mainnetDeployment/rinkebyDeploymentOutput.json'

const delay = ms => new Promise(res => setTimeout(res, ms));
const waitFunction = async () => {
  return delay(90000) // wait 90s
}

const GAS_PRICE = 20000000 // 1 Gwei
const TX_CONFIRMATIONS = 1

const ETHERSCAN_BASE_URL = 'https://rinkeby.etherscan.io/address'

module.exports = {
  externalAddrs,
  liquityAddrs,
  beneficiaries,
  OUTPUT_FILE,
  waitFunction,
  GAS_PRICE,
  TX_CONFIRMATIONS,
  ETHERSCAN_BASE_URL,
};
