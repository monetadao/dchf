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
  ADMIN_MULTI: "0x9BB671fc3Fb341fd494f305eD4F1417C86a9413B",
  MON_SAFE: "0x9BB671fc3Fb341fd494f305eD4F1417C86a9413B", // TODO
  DEPLOYER: "0xDDe14fa2ef87F3dEAC674c88a7B125B4f9eda3C0"
}

const monetaCommunityIssuanceParams = {
  ETH_STABILITY_POOL_FUNDING: 729_634,
  BTC_STABILITY_POOL_FUNDING: 729_634,
  ETH_STABILITY_POOL_WEEKLY_DISTRIBUTION: 182_408,
  BTC_STABILITY_POOL_WEEKLY_DISTRIBUTION: 182_408,
}

const REDEMPTION_SAFETY = 14;

// 1 = Deploy Moneta token, 2 = Deploy DCHF Core contracts
const DEPLOYMENT_PHASE = 2;

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
  OUTPUT_FILE,
  waitFunction,
  GAS_PRICE,
  TX_CONFIRMATIONS,
  ETHERSCAN_BASE_URL,
  IsMainnet,
  REDEMPTION_SAFETY,
  DEPLOYMENT_PHASE
};
