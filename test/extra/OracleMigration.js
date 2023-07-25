const { expect } = require('hardhat')
const { ethers, network } = require('hardhat')
const { BigNumber } = require('ethers')
const fetch = require('node-fetch')

const testHelpers = require('../utils/testHelpers.js')
const th = testHelpers.TestHelper
const toBN = th.toBN
const dec = th.dec

const wstETH = '0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0'
const CHAINLINK_USD_CHF = '0x449d117117838ffa61263b61da6301aa2a88b13a'

const ETH = '0x0000000000000000000000000000000000000000'
const WBTC = '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599'

const CHAINLINK_ETH_USD = '0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419'
const CHAINLINK_WBTC_USD = '0xF4030086522a5bEEa4988F8cA5B36dbC97BeE88c'

const borrowerOperationsAddress = '0x9eB2Ce1be2DD6947e4f5Aabe33106f48861DFD74'
const troveManagerAddress = '0x99838142189adE67c1951f9c57c3333281334F7F'
const troveManagerHelpersAddress = '0xaAACB8C39Bd5Acbb0A236112Df8d15411161e518'
const dchfTokenAddress = '0x045da4bFe02B320f4403674B3b7d121737727A36'
const sortedTrovesAddress = '0x1Dd69453a685C735f2ab43E2169b57e9Edf72286'
const communityIssuanceAddress = '0x0fa46e8cBCEff8468DB2Ec2fD77731D8a11d3D86'
const dfrancParamsAddress = '0x6F9990B242873d7396511f2630412A3fcEcacc42'
const adminContractAddress = '0x2748C55219DCa1D9D3c3a57505e99BB04e42F254'
const oldPriceFeedAddress = '0x09AB3C0ce6Cb41C13343879A667a6bDAd65ee9DA'
const monetaAddress = '0x1EA48B9965bb5086F3b468E50ED93888a661fc17'

const MULTISIG = '0x83737EAe72ba7597b36494D723fbF58cAfee8A69'

async function getExternalWstEthPrice(currency) {
  const response = await fetch(
    `https://api.coingecko.com/api/v3/simple/price?ids=wrapped-steth&vs_currencies=${currency}`
  )
  const price = await response.json()
  return price
}

describe('Oracle', function () {
  let WstETHOracle
  let PriceFeed
  let WstEthStabilityPool

  beforeEach(async function () {
    ;[deployer, Account1, Account2, Account3] = await ethers.getSigners()

    const WstETHOracleFactory = await ethers.getContractFactory('WstETHOracle')
    WstETHOracle = await WstETHOracleFactory.deploy()

    const PriceFeedFactory = await ethers.getContractFactory('PriceFeed')
    PriceFeed = await PriceFeedFactory.deploy()
    await PriceFeed.setAddresses(adminContractAddress)

    const wstEthStabilityPoolFactory = await ethers.getContractFactory('StabilityPool')
    WstEthStabilityPool = await wstEthStabilityPoolFactory.deploy()
    await WstEthStabilityPool.setAddresses(
      wstETH,
      borrowerOperationsAddress,
      troveManagerAddress,
      troveManagerHelpersAddress,
      dchfTokenAddress,
      sortedTrovesAddress,
      communityIssuanceAddress,
      dfrancParamsAddress
    )

    // // Add legacy oracles assets
    await PriceFeed.addOracle(ETH, CHAINLINK_ETH_USD, CHAINLINK_USD_CHF)
    await PriceFeed.addOracle(WBTC, CHAINLINK_WBTC_USD, CHAINLINK_USD_CHF)
  })

  describe('Switch oracles in current deployment', function () {
    it('Can add a new asset and fetch the price', async function () {
      const legacyPriceFeed = new ethers.Contract(
        oldPriceFeedAddress,
        ['function getDirectPrice(address _asset) external returns (uint256 _priceAssetInDCHF)'],
        deployer
      )

      const adminContract = new ethers.Contract(
        adminContractAddress,
        [
          'function addNewCollateral(address _stabilityPoolProxyAddress, address _chainlinkOracle, address _chainlinkIndex, uint256 assignedToken, uint256 _tokenPerWeekDistributed, uint256 redemptionLockInDay) external',
        ],
        deployer
      )

      const mon = new ethers.Contract(
        monetaAddress,
        ['function approve(address spender, uint256 amount) external'],
        deployer
      )

      const dfrancParams = new ethers.Contract(
        dfrancParamsAddress,
        [
          'function priceFeed() external returns (address)',
          'function setPriceFeed(address newPriceFeed) external',
        ],
        deployer
      )

      const priceEthBefore = await legacyPriceFeed.callStatic.getDirectPrice(ETH)
      const priceWbtcBefore = await legacyPriceFeed.callStatic.getDirectPrice(WBTC)
      console.log('Price ETH in CHF in old PriceFeed:', priceEthBefore.toString())
      console.log('Price BTC in CHF in old PriceFeed:', priceWbtcBefore.toString())

      const priceEthNewOracleBefore = await PriceFeed.getDirectPrice(ETH)
      const priceWbtcNewOracleBefore = await PriceFeed.getDirectPrice(WBTC)
      console.log('Price ETH in CHF in new PriceFeed:', priceEthNewOracleBefore.toString())
      console.log('Price BTC in CHF in new PriceFeed:', priceWbtcNewOracleBefore.toString())

      expect(priceEthBefore.toString()).eq(priceEthNewOracleBefore.toString())
      expect(priceWbtcBefore.toString()).eq(priceWbtcNewOracleBefore.toString())

      await network.provider.request({
        method: 'hardhat_impersonateAccount',
        params: [MULTISIG],
      })
      // Fund the account with 10 Ether
      await network.provider.request({
        method: 'hardhat_setBalance',
        params: [MULTISIG, '0x8AC7230489E80000'],
      })
      const multisigSigner = await hre.ethers.getSigner(MULTISIG)

      const e18 = BigNumber.from(10).pow(18)
      const amount = e18.mul(100000)
      await mon.connect(multisigSigner).approve(communityIssuanceAddress, amount)

      const previousPriceFeed = await dfrancParams.callStatic.priceFeed()
      expect(previousPriceFeed).eq(legacyPriceFeed.address)

      // Need to switch Oracles before adding asset
      await dfrancParams.connect(multisigSigner).setPriceFeed(PriceFeed.address)

      await adminContract
        .connect(multisigSigner)
        .addNewCollateral(
          WstEthStabilityPool.address,
          WstETHOracle.address,
          CHAINLINK_USD_CHF,
          amount,
          amount.div(4),
          14
        )

      const newPriceFeed = await dfrancParams.callStatic.priceFeed()
      expect(newPriceFeed).eq(PriceFeed.address)

      const registeredOracle = await PriceFeed.registeredOracles(wstETH)
      assert.isTrue(registeredOracle.isRegistered)

      const priceDirect = await PriceFeed.getDirectPrice(wstETH)
      console.log('PriceDirect wstETH in CHF:', priceDirect.toString())

      const priceFetch = await PriceFeed.callStatic.fetchPrice(wstETH)
      console.log('PriceFetch wstETH in CHF:', priceFetch.toString())

      const externalPrice = await getExternalWstEthPrice('chf')
      console.log('PriceFetch wstETH in CHF Coingecko:', externalPrice['wrapped-steth'].chf)

      expect(priceFetch.toString()).to.be.eq(priceFetch.toString())
    })
  })
})
