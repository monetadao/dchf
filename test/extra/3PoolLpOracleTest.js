const { expect } = require('hardhat')
const { ethers, network } = require('hardhat')

const testHelpers = require('../utils/testHelpers.js')
const timeValues = testHelpers.TimeValues
const th = testHelpers.TestHelper
const assertRevert = th.assertRevert
const dec = th.dec

const ADMIN_CONTRACT = '0x2748C55219DCa1D9D3c3a57505e99BB04e42F254'

const _chfFeed = '0x449d117117838ffa61263b61da6301aa2a88b13a'
const _usdcFeed = '0x8fFfFfd4AfB6115b954Bd326cbe7B4BA576818f6'
const _daiFeed = '0xAed0c38402a5d19df6E4c03F4E2DceD6e29c1ee9'
const _usdtFeed = '0x3E7d1eAB13ad0104d2750B8863b489D65364e32D'
const _pool3Pool = '0xbEbc44782C7dB0a1A60Cb6fe97d0b483032FF1C7'
const _timeout = timeValues.SECONDS_IN_ONE_DAY

const deployParams = [_chfFeed, _usdcFeed, _daiFeed, _usdtFeed, _pool3Pool, _timeout]

describe('3Crv LpOracle', function () {
  let LpOracle
  let PriceFeed

  beforeEach(async function () {
    ;[Owner, Account1, Account2, Account3, Account4] = await ethers.getSigners()

    const LpOracleFactory = await ethers.getContractFactory('Chainlink3PoolLpOracle')
    LpOracle = await LpOracleFactory.deploy(...deployParams)

    const PriceFeedFactory = await ethers.getContractFactory('PriceFeed')
    PriceFeed = await PriceFeedFactory.deploy()
    await PriceFeed.setAddresses(ADMIN_CONTRACT)
  })

  describe('Add asset to PriceFeed and fetching price', function () {
    it('Registers a new Chainlink3PoolLpOracle', async function () {
      await PriceFeed.addOracle(_pool3Pool, LpOracle.address)

      const registeredOracle = await PriceFeed.registeredOracles(_pool3Pool)
      expect(registeredOracle).to.be.eq(LpOracle.address)
    })

    it('Can read priceDirect and priceFetch', async function () {
      await PriceFeed.addOracle(_pool3Pool, LpOracle.address)

      const registeredOracle = await PriceFeed.registeredOracles(_pool3Pool)
      expect(registeredOracle).to.be.eq(LpOracle.address)

      const priceDirect = await PriceFeed.getDirectPrice(_pool3Pool)
      console.log('PriceDirect 3Crv in CHF:', priceDirect.toString())

      const priceFetch = await PriceFeed.callStatic.fetchPrice(_pool3Pool)
      console.log('PriceFetch 3Crv in CHF:', priceFetch.toString())

      expect(priceDirect.toString()).to.be.eq(priceFetch.toString())
    })

    it('Can read priceDirect and priceFetch', async function () {
      const feedValue = await LpOracle.feedValue()
      const chfValue = await LpOracle.chfValue()

      console.log('Get feedValue 3PoolLpOracle:', feedValue.value_.toString())
      console.log('Get chfValue 3PoolLpOracle:', chfValue.value_.toString())

      expect(+feedValue.value_).to.be.greaterThan(0)
      expect(+chfValue.value_).to.be.greaterThan(0)

      console.log('Get feedTimestamp 3PoolLpOracle:', feedValue.timestamp.toNumber())
      console.log('Get chfTimestamp 3PoolLpOracle:', chfValue.timestamp.toNumber())

      expect(feedValue.timestamp.toNumber()).to.be.greaterThan(1672531200) // 1-1-2023
      expect(chfValue.timestamp.toNumber()).to.be.greaterThan(1672531200) // 1-1-2023
    })

    it('Exact math for final CHF value', async function () {
      const feedValue = await LpOracle.feedValue()
      const chfValue = await LpOracle.chfValue()
      const decimalPrecision = await LpOracle.DECIMAL_PRECISION()

      const expectedValue = (feedValue.value_ * decimalPrecision) / chfValue.value_
      const oracleValue = await LpOracle.value()

      console.log('Get final CHFValue 3PoolLpOracle:', oracleValue.toString())
      console.log('Get expected CHFValue 3PoolLpOracle:', expectedValue.toString())

      th.assertIsApproximatelyEqual(expectedValue.toString(), oracleValue.toString(), (error = 1000))
    })
  })

  describe('Getters and public vars from LpOracle', function () {
    it('Params are correctly set in constructor', async function () {
      const chfFeed = await LpOracle.chfFeed()
      const usdcFeed = await LpOracle.usdcFeed()
      const daiFeed = await LpOracle.daiFeed()
      const usdtFeed = await LpOracle.usdtFeed()
      const pool3Pool = await LpOracle.pool3Pool()
      const timeout = await LpOracle.timeout()

      expect(chfFeed.toLowerCase()).to.be.eq(_chfFeed.toLowerCase())
      expect(usdcFeed.toLowerCase()).to.be.eq(_usdcFeed.toLowerCase())
      expect(daiFeed.toLowerCase()).to.be.eq(_daiFeed.toLowerCase())
      expect(usdtFeed.toLowerCase()).to.be.eq(_usdtFeed.toLowerCase())
      expect(pool3Pool.toLowerCase()).to.be.eq(_pool3Pool.toLowerCase())
      expect(timeout.toNumber()).to.be.eq(_timeout)

      const chfScale = await LpOracle.chfScale()
      expect(chfScale.toString()).to.be.eq(dec(1, 10).toString())

      const decimalPrecision = await LpOracle.DECIMAL_PRECISION()
      expect(decimalPrecision.toString()).to.be.eq(dec(1, 18).toString())

      const usdcScale = await LpOracle.usdcScale()
      const usdtScale = await LpOracle.usdtScale()
      const daiScale = await LpOracle.daiScale()

      expect(usdcScale.toString()).to.be.eq(dec(1, 10).toString())
      expect(usdtScale.toString()).to.be.eq(dec(1, 10).toString())
      expect(daiScale.toString()).to.be.eq(dec(1, 10).toString())
    })
  })

  describe('Initialization PriceFeed', function () {
    it('Is properly initialized and reverts after a re-initializing attempt', async function () {
      assert.isTrue(await PriceFeed.isInitialized())

      await assertRevert(PriceFeed.setAddresses(ADMIN_CONTRACT), 'Already initialized')
    })
  })
})
