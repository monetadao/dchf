const IsMainnet = true;

const externalAddrs = {
  // https://data.chain.link/eth-usd
  CHAINLINK_ETHUSD_PROXY: "0x5f4ec3df9cbd43714fe2740f5e3616155c5b8419",
  CHAINLINK_BTCUSD_PROXY: "0xf4030086522a5beea4988f8ca5b36dbc97bee88c",
  CHAINLINK_FLAG_HEALTH: "0x491B1dDA0A8fa069bbC1125133A975BF4e85a91b",
  CHAINLINK_USDCHF_PROXY: "0x449d117117838ffa61263b61da6301aa2a88b13a",

  WETH_ERC20: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
  REN_BTC: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599",
}


const dfrancAddresses = {
  ADMIN_MULTI: "0x0893665BE05c2F1A548045Facc75BF6965d8eC65", // Gnosis Multisig on ETH
  MON_SAFE: "0x0893665BE05c2F1A548045Facc75BF6965d8eC65", // Gnosis Multisig on ETH
  DEPLOYER: "0xfe136C80C898d4268c441Fa003d637893783d1bC" // Change that for deployer
}

// change for real values
const monetaCommunityIssuanceParams = {
  ETH_STABILITY_POOL_FUNDING: 100_000,
  BTC_STABILITY_POOL_FUNDING: 100_000,
  ETH_STABILITY_POOL_WEEKLY_DISTRIBUTION: 25_000,
  BTC_STABILITY_POOL_WEEKLY_DISTRIBUTION: 25_000,

}

// change for real values
const beneficiaries = {
  //MARKETING GROWTH
  "0x4F74e01855E79e4ec65ee67C51540144A698D972": 17_000_000,

  // TEAM ADVISORS (needs to be distributed among all advisors)
  "0xA8FAc0eC4B8F63864C80B36cd74667cEa74D1193": 10_000_000,

  // AIRDROP (needs to be distributed among all airdrop accounts)
  "0x085ad56B4CF061D67D0194e309e07e0F232C65f8": 15_000_000
}

const REDEMPTION_SAFETY = 0;

// 1 = Deploy Moneta token, 2 = Set up Moneta vesting, 3 = Deploy DCHF Core contracts
const DEPLOYMENT_PHASE = 1;

const MON_LOCK_BATCH_SIZE = 100;

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
  beneficiaries,
  OUTPUT_FILE,
  waitFunction,
  GAS_PRICE,
  TX_CONFIRMATIONS,
  ETHERSCAN_BASE_URL,
  IsMainnet,
  REDEMPTION_SAFETY,
  DEPLOYMENT_PHASE,
  MON_LOCK_BATCH_SIZE
};
