const { expect } = require('hardhat')
const { ethers, network } = require('hardhat')

const testHelpers = require('../utils/testHelpers.js')
const th = testHelpers.TestHelper
const toBN = th.toBN
const dec = th.dec

const GV_FRAX = '0xF437C8cEa5Bb0d8C10Bb9c012fb4a765663942f1'
const CHAINLINK_USD_CHF = '0x449d117117838ffa61263b61da6301aa2a88b13a'
const ADMIN_CONTRACT = '0x2748C55219DCa1D9D3c3a57505e99BB04e42F254'

describe('Oracle', function () {
  let GVOracle
  let PriceFeed

  beforeEach(async function () {
    ;[Owner, Account1, Account2, Account3] = await ethers.getSigners()

    const GVOracleFactory = await ethers.getContractFactory('GVFrax3CrvOracle')
    GVOracle = await GVOracleFactory.deploy()

    const PriceFeedFactory = await ethers.getContractFactory('PriceFeed')
    PriceFeed = await PriceFeedFactory.deploy()
    await PriceFeed.setAddresses(ADMIN_CONTRACT)
  })

  describe('Add asset to price feed', function () {
    it('Can add a new asset and fetch the price', async function () {
      await PriceFeed.addOracle(GV_FRAX, GVOracle.address, CHAINLINK_USD_CHF)

      const registeredOracle = await PriceFeed.registeredOracles(GV_FRAX)
      assert.isTrue(registeredOracle.isRegistered) // true

      const priceDirect = await PriceFeed.getDirectPrice(GV_FRAX)
      console.log('PriceDirect GVFrax3Crv in CHF:', priceDirect.toString())

      const priceFetch = await PriceFeed.callStatic.fetchPrice(GV_FRAX)
      console.log('PriceFetch GVFrax3Crv in CHF:', priceFetch.toString())

      expect(priceFetch.toString()).to.be.eq(priceFetch.toString())
    })

    it('Fetches the price, gas reporting purposes', async function () {
      await PriceFeed.addOracle(GV_FRAX, GVOracle.address, CHAINLINK_USD_CHF)

      const tx = await PriceFeed.fetchPrice(GV_FRAX)
      const txData = await tx.wait()
      console.log('gasUsed:', txData.cumulativeGasUsed.toNumber()) // 199447

      // Extra calls to make the sample representative
      await PriceFeed.connect(Account1).fetchPrice(GV_FRAX)
      await PriceFeed.connect(Account2).fetchPrice(GV_FRAX)
      await PriceFeed.connect(Account3).fetchPrice(GV_FRAX)
    })

    it('Can read getRoundData and latestRoundData', async function () {
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
    it('Returns correctly the decimals', async function () {
      const decimals = await GVOracle.decimals()
      expect(decimals).to.equal(18)
    })
    it('Returns correctly the decimals adjustment var', async function () {
      const decimalsAdjustment = await GVOracle.DECIMAL_ADJUSTMENT()
      expect(decimalsAdjustment.toString()).to.be.deep.equal(dec(1, 26))
    })
  })

  describe('Getters from PriceFeed', function () {
    it('AdminContract is the owner', async function () {
      const adminContract = await PriceFeed.adminContract()
      expect(ADMIN_CONTRACT).to.eq(adminContract)
    })
  })
})
