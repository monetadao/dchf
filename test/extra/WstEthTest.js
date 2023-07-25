const { expect } = require('hardhat')
const { ethers } = require('hardhat')
const fetch = require('node-fetch')

const testHelpers = require('../utils/testHelpers.js')
const th = testHelpers.TestHelper
const toBN = th.toBN
const dec = th.dec

const wstETH = '0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0'
const CHAINLINK_USD_CHF = '0x449d117117838ffa61263b61da6301aa2a88b13a'
const ADMIN_CONTRACT = '0x2748C55219DCa1D9D3c3a57505e99BB04e42F254'

async function getExternalWstEthPrice(currency) {
  const response = await fetch(
    `https://api.coingecko.com/api/v3/simple/price?ids=wrapped-steth&vs_currencies=${currency}`
  )
  const price = await response.json()
  return price
}

// npx hardhat test test/extra/WstEthTest.js

describe('Oracle', function () {
  let WstETHOracle
  let PriceFeed

  beforeEach(async function () {
    ;[Owner, Account1, Account2, Account3] = await ethers.getSigners()

    const WstETHOracleFactory = await ethers.getContractFactory('WstETHOracle')
    WstETHOracle = await WstETHOracleFactory.deploy()

    const PriceFeedFactory = await ethers.getContractFactory('PriceFeed')
    PriceFeed = await PriceFeedFactory.deploy()
    await PriceFeed.setAddresses(ADMIN_CONTRACT)
  })

  describe('Add asset to price feed', function () {
    it('Can add a new asset and fetch the price', async function () {
      await PriceFeed.addOracle(wstETH, WstETHOracle.address, CHAINLINK_USD_CHF)

      const registeredOracle = await PriceFeed.registeredOracles(wstETH)
      assert.isTrue(registeredOracle.isRegistered) // true

      const priceDirect = await PriceFeed.getDirectPrice(wstETH)
      console.log('PriceDirect wstETH in CHF:', priceDirect.toString())

      const priceFetch = await PriceFeed.callStatic.fetchPrice(wstETH)
      console.log('PriceFetch wstETH in CHF:', priceFetch.toString())

      const externalPrice = await getExternalWstEthPrice('chf')
      console.log('PriceFetch wstETH in CHF Coingecko:', externalPrice['wrapped-steth'].chf)

      expect(priceFetch.toString()).to.be.eq(priceFetch.toString())
    })

    it('Fetches the price, gas reporting purposes', async function () {
      await PriceFeed.addOracle(wstETH, WstETHOracle.address, CHAINLINK_USD_CHF)

      let tx = await PriceFeed.fetchPrice(wstETH)
      let txData = await tx.wait()
      console.log('gasUsed:', txData.cumulativeGasUsed.toNumber()) // 99492

      tx = await PriceFeed.fetchPrice(wstETH)
      txData = await tx.wait()
      console.log('gasUsed:', txData.cumulativeGasUsed.toNumber()) // 199447

      // Extra calls to make the sample representative
      await PriceFeed.connect(Account1).fetchPrice(wstETH)
      await PriceFeed.connect(Account2).fetchPrice(wstETH)
      await PriceFeed.connect(Account3).fetchPrice(wstETH)
    })

    it('Can read getRoundData and latestRoundData', async function () {
      const getLatestRoundData = await WstETHOracle.latestAnswer()
      console.log('GetLatestRoundData lpOracle answer:', +getLatestRoundData.answer)
      console.log('GetLatestRoundData lpOracle timestamp:', +getLatestRoundData.updatedAt)

      const externalPrice = await getExternalWstEthPrice('usd')
      console.log('PriceFetch wstETH in USD Coingecko:', externalPrice['wrapped-steth'].usd)

      expect(+getLatestRoundData.answer).to.be.greaterThan(0)
      expect(getLatestRoundData.updatedAt.toNumber()).to.be.greaterThan(1689066718) // 11-7-2023

      const blockNumBefore = await ethers.provider.getBlockNumber()
      const blockBefore = await ethers.provider.getBlock(blockNumBefore)
      const timestampBefore = blockBefore.timestamp
      const diff = timestampBefore - getLatestRoundData.updatedAt.toNumber()

      expect(diff).lt((await PriceFeed.TIMEOUT()).toNumber())
    })
  })

  describe('Getters from LpOracle', function () {
    it('Returns correctly the decimals', async function () {
      const decimals = await WstETHOracle.decimals()
      expect(decimals).to.equal(18)
    })
    it('Returns correctly the decimals adjustment var', async function () {
      const decimalsAdjustment = await WstETHOracle.DECIMAL_ADJUSTMENT()
      expect(decimalsAdjustment.toString()).to.be.deep.equal(dec(1, 8))
    })
  })

  describe('Getters from PriceFeed', function () {
    it('AdminContract is the owner', async function () {
      const adminContract = await PriceFeed.adminContract()
      expect(ADMIN_CONTRACT).to.eq(adminContract)
    })
  })
})
