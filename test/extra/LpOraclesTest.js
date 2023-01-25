const { expect } = require('hardhat')
const { ethers, network } = require('hardhat')

const testHelpers = require('../utils/testHelpers.js')
const timeValues = testHelpers.TimeValues
const th = testHelpers.TestHelper
const toBN = th.toBN
const dec = th.dec
const ZERO_ADDRESS = th.ZERO_ADDRESS

const GV_FRAX = '0xF437C8cEa5Bb0d8C10Bb9c012fb4a765663942f1'
const CHAINLINK_USD_CHF = '0x449d117117838ffa61263b61da6301aa2a88b13a'
const ADMIN_CONTRACT = '0x2748C55219DCa1D9D3c3a57505e99BB04e42F254'

const CHAINLINK_ETHUSD = '0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419'
const CHAINLINK_BTCUSD = '0xf4030086522a5beea4988f8ca5b36dbc97bee88c'
const WBTC_ADDRESS = '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599'

const _chfFeed = '0x449d117117838ffa61263b61da6301aa2a88b13a'
const _chfFeedTimeout = timeValues.SECONDS_IN_ONE_DAY // 86400s (24h)
const _feed = '0xB9E1E3A9feFf48998E45Fa90847ed4D467E8BcfD' // frax feed
const _timeout = timeValues.SECONDS_IN_ONE_DAY
const _usdcFeed = '0x8fFfFfd4AfB6115b954Bd326cbe7B4BA576818f6'
const _usdcTimeout = timeValues.SECONDS_IN_ONE_DAY
const _daiFeed = '0xAed0c38402a5d19df6E4c03F4E2DceD6e29c1ee9'
const _daiTimeout = timeValues.SECONDS_IN_ONE_DAY
const _usdtFeed = '0x3E7d1eAB13ad0104d2750B8863b489D65364e32D'
const _usdtTimeout = timeValues.SECONDS_IN_ONE_DAY
const _gvToken = '0xF437C8cEa5Bb0d8C10Bb9c012fb4a765663942f1' // vault token
const _lpToken = '0xd632f22692FaC7611d2AA1C0D552930D43CAEd3B' // curvePool token

const deployParams = [
  _chfFeed,
  _chfFeedTimeout,
  _feed,
  _timeout,
  _usdcFeed,
  _usdcTimeout,
  _daiFeed,
  _daiTimeout,
  _usdtFeed,
  _usdtTimeout,
  _gvToken,
  _lpToken,
]

const ethParams = [_chfFeed, _chfFeedTimeout, CHAINLINK_ETHUSD, _timeout]
const btcParams = [_chfFeed, _chfFeedTimeout, CHAINLINK_BTCUSD, _timeout]

describe('Oracle', function () {
  let GVOracle
  let PriceFeed

  beforeEach(async function () {
    ;[Owner, Account1, Account2, Account3] = await ethers.getSigners()

    const GVOracleFactory = await ethers.getContractFactory('Chainlink3PoolPairedLpOracle')
    GVOracle = await GVOracleFactory.deploy(...deployParams)

    const ChainlinkOracleFactory = await ethers.getContractFactory('ChainlinkOracle')
    ChainlinkOracleETH = await ChainlinkOracleFactory.deploy(...ethParams)
    ChainlinkOracleBTC = await ChainlinkOracleFactory.deploy(...btcParams)

    const PriceFeedFactory = await ethers.getContractFactory('PriceFeed')
    PriceFeed = await PriceFeedFactory.deploy()
    await PriceFeed.setAddresses(ADMIN_CONTRACT)
  })

  describe('Add asset to price feed', function () {
    it('Can add a new Chainlink3PoolPairedLpOracle asset and fetch the price', async function () {
      await PriceFeed.addOracle(GV_FRAX, GVOracle.address)

      const registeredOracle = await PriceFeed.registeredOracles(GV_FRAX)
      expect(registeredOracle).to.be.eq(GVOracle.address)

      const priceDirect = await PriceFeed.getDirectPrice(GV_FRAX)
      console.log('PriceDirect GVFrax3Crv in CHF:', priceDirect.toString())

      const priceFetch = await PriceFeed.callStatic.fetchPrice(GV_FRAX)
      console.log('PriceFetch GVFrax3Crv in CHF:', priceFetch.toString())

      expect(priceFetch.toString()).to.be.eq(priceFetch.toString())
    })

    it('Can add ETH as a new Chainlink asset and fetch the price', async function () {
      await PriceFeed.addOracle(ZERO_ADDRESS, ChainlinkOracleETH.address)

      const registeredOracle = await PriceFeed.registeredOracles(ZERO_ADDRESS)
      expect(registeredOracle).to.be.eq(ChainlinkOracleETH.address)

      const priceDirect = await PriceFeed.getDirectPrice(ZERO_ADDRESS)
      console.log('PriceDirect ETH in CHF:', priceDirect.toString())

      const priceFetch = await PriceFeed.callStatic.fetchPrice(ZERO_ADDRESS)
      console.log('PriceFetch ETH in CHF:', priceFetch.toString())

      expect(priceFetch.toString()).to.be.eq(priceFetch.toString())
    })

    it('Can add BTC as a new Chainlink asset and fetch the price', async function () {
      await PriceFeed.addOracle(WBTC_ADDRESS, ChainlinkOracleBTC.address)

      const registeredOracle = await PriceFeed.registeredOracles(WBTC_ADDRESS)
      expect(registeredOracle).to.be.eq(ChainlinkOracleBTC.address)

      const priceDirect = await PriceFeed.getDirectPrice(WBTC_ADDRESS)
      console.log('PriceDirect ETH in CHF:', priceDirect.toString())

      const priceFetch = await PriceFeed.callStatic.fetchPrice(WBTC_ADDRESS)
      console.log('PriceFetch ETH in CHF:', priceFetch.toString())

      expect(priceFetch.toString()).to.be.eq(priceFetch.toString())
    })

    it.skip('Fetches the price, gas reporting purposes', async function () {
      await PriceFeed.addOracle(GV_FRAX, GVOracle.address, CHAINLINK_USD_CHF)

      const tx = await PriceFeed.fetchPrice(GV_FRAX)
      const txData = await tx.wait()
      console.log('gasUsed:', txData.cumulativeGasUsed.toNumber()) // 199447

      // Extra calls to make the sample representative
      await PriceFeed.connect(Account1).fetchPrice(GV_FRAX)
      await PriceFeed.connect(Account2).fetchPrice(GV_FRAX)
      await PriceFeed.connect(Account3).fetchPrice(GV_FRAX)
    })

    it.skip('Can read getRoundData and latestRoundData', async function () {
      const getLatestRoundData = await GVOracle.latestAnswer()
      console.log('GetLatestRoundData lpOracle answer:', +getLatestRoundData.answer)
      console.log('GetLatestRoundData lpOracle timestamp:', +getLatestRoundData.updatedAt)

      expect(+getLatestRoundData.answer).to.be.greaterThan(0)
      expect(getLatestRoundData.updatedAt.toNumber()).to.be.greaterThan(1672531200) // 1-1-2023

      const blockNumBefore = await ethers.provider.getBlockNumber()
      const blockBefore = await ethers.provider.getBlock(blockNumBefore)
      const timestampBefore = blockBefore.timestamp
      const diff = timestampBefore - getLatestRoundData.updatedAt.toNumber()

      expect(diff).lt((await PriceFeed.TIMEOUT()).toNumber())
    })
  })

  describe('Getters from LpOracle', function () {
    it.skip('Returns correctly the decimals', async function () {
      const decimals = await GVOracle.decimals()
      expect(decimals).to.equal(18)
    })
    it.skip('Returns correctly the decimals adjustment var', async function () {
      const decimalsAdjustment = await GVOracle.DECIMAL_ADJUSTMENT()
      expect(decimalsAdjustment.toString()).to.be.deep.equal(dec(1, 26))
    })
  })

  describe('Getters from PriceFeed', function () {
    it.skip('AdminContract is the owner', async function () {
      const adminContract = await PriceFeed.adminContract()
      expect(ADMIN_CONTRACT).to.eq(adminContract)
    })
  })
})
