const IsMainnet = true;

const externalAddrs = {
  // https://data.chain.link/eth-usd
  CHAINLINK_ETHUSD_PROXY: "0x5f4ec3df9cbd43714fe2740f5e3616155c5b8419",
  CHAINLINK_BTCUSD_PROXY: "0xf4030086522a5beea4988f8ca5b36dbc97bee88c",
  CHAINLINK_FLAG_HEALTH: "0x491B1dDA0A8fa069bbC1125133A975BF4e85a91b",
  CHAINLINK_USDCHF_PROXY: "0x449d117117838ffa61263b61da6301aa2a88b13a",

  WETH_ERC20: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
  WRP_BTC: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599",
}

// change for MULTISIG!!
const dfrancAddresses = {
  ADMIN_MULTI: "0x83737EAe72ba7597b36494D723fbF58cAfee8A69", // Gnosis Multisig on ETH
  MON_SAFE: "0x83737EAe72ba7597b36494D723fbF58cAfee8A69", // Gnosis Multisig on ETH
  DEPLOYER: "0x7d7711efd844e5e204DF29Dc3e109D1aF95a801C" // Change that for deployer
}

// 1 month funding
const monetaCommunityIssuanceParams = {
  ETH_STABILITY_POOL_FUNDING: 729_634,
  BTC_STABILITY_POOL_FUNDING: 729_634,
  ETH_STABILITY_POOL_WEEKLY_DISTRIBUTION: 182_408,
  BTC_STABILITY_POOL_WEEKLY_DISTRIBUTION: 182_408,
}

const REDEMPTION_SAFETY = 14;

// 1 = Deploy Moneta token, 2 = Deploy DCHF Core contracts
const DEPLOYMENT_PHASE = 1;

const OUTPUT_FILE = './deployment/output/mainnetDeploymentOutput.json'

const delay = ms => new Promise(res => setTimeout(res, ms));
const waitFunction = async () => {
  return delay(90000) // wait 90s
}

const GAS_PRICE = 20000000000
const TX_CONFIRMATIONS = 1

const ETHERSCAN_BASE_URL = 'https://etherscan.io/address'

module.exports = {
  externalAddrs,
  dfrancAddresses,
  monetaCommunityIssuanceParams,
  OUTPUT_FILE,
  waitFunction,
  GAS_PRICE,
  TX_CONFIRMATIONS,
  ETHERSCAN_BASE_URL,
  IsMainnet,
  REDEMPTION_SAFETY,
  DEPLOYMENT_PHASE
};
