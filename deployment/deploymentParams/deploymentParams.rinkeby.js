const IsMainnet = false;

const externalAddrs = {
  // https://data.chain.link/eth-usd
  CHAINLINK_ETHUSD_PROXY: "0x8A753747A1Fa494EC906cE90E9f37563A8AF630e",
  CHAINLINK_BTCUSD_PROXY: "0xECe365B379E1dD183B20fc5f022230C044d51404",
  CHAINLINK_FLAG_HEALTH: "0x491B1dDA0A8fa069bbC1125133A975BF4e85a91b",
  CHAINLINK_USDCHF_PROXY: "0x5e601CF5EF284Bcd12decBDa189479413284E1d2",

  WETH_ERC20: "0xdf032bc4b9dc2782bb09352007d4c57b75160b15",
  REN_BTC: "0x577D296678535e4903D59A4C929B718e1D575e0A",
}


const dfrancAddresses = {
  ADMIN_MULTI: "0x010cB76dD45A00Da96429a24587872d2dB46904E",
  MON_SAFE: "0x010cB76dD45A00Da96429a24587872d2dB46904E", // TODO
  DEPLOYER: "0x4F74e01855E79e4ec65ee67C51540144A698D972"
}

const monetaCommunityIssuanceParams = {
  ETH_STABILITY_POOL_FUNDING: 100_000,
  BTC_STABILITY_POOL_FUNDING: 100_000,
  ETH_STABILITY_POOL_WEEKLY_DISTRIBUTION: 25_000,
  BTC_STABILITY_POOL_WEEKLY_DISTRIBUTION: 25_000,

}

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
const DEPLOYMENT_PHASE = 3;

const MON_LOCK_BATCH_SIZE = 100;

const OUTPUT_FILE = './deployment/output/rinkebyDeploymentOutput.json'

const delay = ms => new Promise(res => setTimeout(res, ms));
const waitFunction = async () => {
  return delay(90000) // wait 90s
}

const GAS_PRICE = 25000000000
const TX_CONFIRMATIONS = 1

const ETHERSCAN_BASE_URL = 'https://rinkeby.etherscan.io/address'

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
