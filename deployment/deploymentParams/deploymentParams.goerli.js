const IsMainnet = true;

const externalAddrs = {
  // https://data.chain.link/eth-usd
  CHAINLINK_ETHUSD_PROXY: "0xD4a33860578De61DBAbDc8BFdb98FD742fA7028e",
  CHAINLINK_BTCUSD_PROXY: "0xA39434A63A52E749F02807ae27335515BA4b07F7",
  CHAINLINK_FLAG_HEALTH: "0x491B1dDA0A8fa069bbC1125133A975BF4e85a91b",
  CHAINLINK_USDCHF_PROXY: "0xAb5c49580294Aff77670F839ea425f5b78ab3Ae7",

  WETH_ERC20: "0xB4FBF271143F4FBf7B91A5ded31805e42b2208d6",
  REN_BTC: "0xda4a47edf8ab3c5eeeb537a97c5b66ea42f49cda",
}


const dfrancAddresses = {
  ADMIN_MULTI: "0x9E0F2E2b98233472398A1aEFd0255d675af25cf7",
  MON_SAFE: "0x9E0F2E2b98233472398A1aEFd0255d675af25cf7", // TODO
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
const DEPLOYMENT_PHASE = 1;

const OUTPUT_FILE = './deployment/output/goerliDeploymentOutput.json'

const delay = ms => new Promise(res => setTimeout(res, ms));
const waitFunction = async () => {
  return delay(90000) // wait 90s
}

const GAS_PRICE = 25000000000
const TX_CONFIRMATIONS = 1

const ETHERSCAN_BASE_URL = 'https://goerli.etherscan.io/address'

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
