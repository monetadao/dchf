const PriceFeed = artifacts.require('./PriceFeedTester.sol')
const AdminContract = artifacts.require('./AdminContract.sol')
const PriceFeedTestnet = artifacts.require('./PriceFeedTestnet.sol')
const MockChainlink = artifacts.require('./MockAggregator.sol')
const ChainlinkFlagMock = artifacts.require('./ChainlinkFlagMock.sol')
const Curve3Pool = artifacts.require('./Curve3Pool.sol')

const testHelpers = require('../utils/testHelpers.js')
const th = testHelpers.TestHelper
const timeValues = testHelpers.TimeValues
const ZERO_ADDRESS = th.ZERO_ADDRESS

const { dec, assertRevert, toBN } = th

const EMPTY_ADDRESS = '0x' + '0'.repeat(40)

const DEFAULT_INDEX = dec(1, 18)
const DEFAULT_PRICE = dec(100, 18)

const DEFAULT_INDEX_e8 = dec(1, 8)
const DEFAULT_INDEX_e9 = dec(1, 9)
const DEFAULT_PRICE_e8 = dec(100, 8)

const _chfFeed = '0x449d117117838ffa61263b61da6301aa2a88b13a'
const _feed = '0xB9E1E3A9feFf48998E45Fa90847ed4D467E8BcfD' // frax feed
const _usdcFeed = '0x8fFfFfd4AfB6115b954Bd326cbe7B4BA576818f6'
const _daiFeed = '0xAed0c38402a5d19df6E4c03F4E2DceD6e29c1ee9'
const _usdtFeed = '0x3E7d1eAB13ad0104d2750B8863b489D65364e32D'
const _pool3Pool = '0xbEbc44782C7dB0a1A60Cb6fe97d0b483032FF1C7'
const _gvToken = '0xF437C8cEa5Bb0d8C10Bb9c012fb4a765663942f1' // vault token
const _lpToken = '0xd632f22692FaC7611d2AA1C0D552930D43CAEd3B' // curvePool token
const _timeout = timeValues.SECONDS_IN_ONE_DAY

contract('PriceFeed', async (accounts) => {
  const [owner, alice] = accounts
  let priceFeedTestnet
  let priceFeed
  let zeroAddressPriceFeed
  let chainFlagMock
  let mockChainlink
  let mockChainlinkIndex
  let curve3Pool
  let adminContract

  // new contracts to test
  let chainlinkOracle
  let chainlink3PoolLpOracle
  let chainlinkPaired3PoolLpOracle

  const setAddressesAndOracle = async (asset, oracleContract) => {
    await priceFeed.setAddresses(adminContract.address, { from: owner })
    await priceFeed.addOracle(asset, oracleContract.address)
  }

  const setAddresses = async () => {
    await priceFeed.setAddresses(adminContract.address, { from: owner })
  }

  const getFetchPriceWithContractValues = async (oracleContract) => {
    return getFetchPriceWithDifferentValue(oracleContract, undefined, undefined)
  }

  const getFetchPriceWithDifferentValue = async (oracleContract, price, index) => {
    if (price === undefined) price = (await oracleContract.feedValue()).value_

    if (index === undefined) index = (await oracleContract.chfValue()).value_

    price = price.toString()
    index = index.toString()

    return toBN(price)
      .mul(toBN(dec(1, 18)))
      .div(toBN(index))
      .toString()
  }

  const getPriceFromPriceFeed = async (asset) => {
    price = priceFeed.fetchPrice(asset)
    return price
  }

  beforeEach(async () => {
    chainFlagMock = await ChainlinkFlagMock.new()
    ChainlinkFlagMock.setAsDeployed(chainFlagMock)

    priceFeedTestnet = await PriceFeedTestnet.new()
    PriceFeedTestnet.setAsDeployed(priceFeedTestnet)

    priceFeed = await PriceFeed.new()
    PriceFeed.setAsDeployed(priceFeed)

    zeroAddressPriceFeed = await PriceFeed.new()
    PriceFeed.setAsDeployed(zeroAddressPriceFeed)

    mockChainlink = await MockChainlink.new()
    MockChainlink.setAsDeployed(mockChainlink)

    mockChainlinkIndex = await MockChainlink.new()
    MockChainlink.setAsDeployed(mockChainlinkIndex)

    adminContract = await AdminContract.new()
    AdminContract.setAsDeployed(adminContract)

    curve3Pool = await Curve3Pool.new()
    Curve3Pool.setAsDeployed(curve3Pool)

    // Set Chainlink latest and prev round Id's to non-zero
    await mockChainlink.setLatestRoundId(3)
    await mockChainlink.setPrevRoundId(2)
    await mockChainlinkIndex.setLatestRoundId(3)
    await mockChainlinkIndex.setPrevRoundId(2)

    // Set current and prev prices in both oracles
    await mockChainlink.setPrice(DEFAULT_PRICE_e8)
    await mockChainlink.setPrevPrice(DEFAULT_PRICE_e8)
    // Start with 1e8 as price index
    await mockChainlinkIndex.setPrice(DEFAULT_INDEX_e8)
    await mockChainlinkIndex.setPrevPrice(DEFAULT_INDEX_e8)

    // Decimals have influence in constructors -> scale
    await mockChainlink.setDecimals(8)
    await mockChainlinkIndex.setDecimals(8)

    // Set mock price updateTimes in both oracles to very recent
    const now = await th.getLatestBlockTimestamp(web3)
    await mockChainlink.setUpdateTime(now)
    await mockChainlinkIndex.setUpdateTime(now)

    const ChainlinkOracle = await ethers.getContractFactory('ChainlinkOracle')
    const Chainlink3PoolLpOracle = await ethers.getContractFactory('Chainlink3PoolLpOracle')
    const ChainlinkPaired3PoolLpOracle = await ethers.getContractFactory('ChainlinkPaired3PoolLpOracle')

    const chainlinkOracleParams = [mockChainlinkIndex.address, mockChainlink.address, _timeout]
    const threePoolLpOracleParams = [
      mockChainlinkIndex.address,
      _usdcFeed,
      _daiFeed,
      _usdtFeed,
      curve3Pool.address,
      _timeout,
    ]
    const paired3PoolLpOracleParams = [
      mockChainlinkIndex.address,
      _usdcFeed,
      _daiFeed,
      _usdtFeed,
      _feed,
      curve3Pool.address,
      _lpToken,
      _gvToken,
      _timeout,
    ]

    chainlinkOracle = await ChainlinkOracle.deploy(...chainlinkOracleParams)
    chainlink3PoolLpOracle = await Chainlink3PoolLpOracle.deploy(...threePoolLpOracleParams)
    chainlinkPaired3PoolLpOracle = await ChainlinkPaired3PoolLpOracle.deploy(...paired3PoolLpOracleParams)
  })

  describe('PriceFeed internal testing contract', async (accounts) => {
    it('fetchPrice before setPrice should return the default price', async () => {
      const price = await priceFeedTestnet.getPrice()
      assert.equal(price, dec(200, 18))
    })
    it('should be able to fetchPrice after setPrice, output of former matching input of latter', async () => {
      await priceFeedTestnet.setPrice(dec(100, 18))
      const price = await priceFeedTestnet.getPrice()
      assert.equal(price, dec(100, 18))
    })
  })

  describe('Mainnet PriceFeed setup', async (accounts) => {
    it('setAddressesAndOracle should fail after address has already been set', async () => {
      // Owner can successfully set any address
      const txOwner = await priceFeed.setAddresses(adminContract.address, {
        from: owner,
      })
      assert.isTrue(txOwner.receipt.status)

      await assertRevert(priceFeed.setAddresses(adminContract.address, { from: owner }))

      await assertRevert(
        priceFeed.setAddresses(adminContract.address, { from: alice }),
        'Ownable: caller is not the owner'
      )
    })
  })

  // Dfranc Tests :: Start
  it('Validate mapping on setAddressesAndOracle', async () => {
    await setAddressesAndOracle(ZERO_ADDRESS, chainlinkOracle)
    assert.equal(await priceFeed.registeredOracles(ZERO_ADDRESS), chainlinkOracle.address)
  })

  it('addOracle as User: Reverts', async () => {
    await setAddressesAndOracle(ZERO_ADDRESS, chainlinkOracle)
    await assertRevert(
      priceFeed.addOracle(EMPTY_ADDRESS, chainlinkOracle.address, {
        from: alice,
      }),
      'Ownable: caller is not the owner'
    )
  })

  it('addOracle as Owner: Oracle Works, index price is 0, reverts', async () => {
    await setAddresses()
    await mockChainlinkIndex.setPrice(0)
    await assertRevert(
      priceFeed.addOracle(EMPTY_ADDRESS, chainlinkOracle.address),
      'ChainlinkOracle__value_invalidValue()'
    )
  })

  it('addOracle as Owner: Oracle price is 0, index works, reverts', async () => {
    await setAddresses()
    await mockChainlink.setPrice(0)
    await assertRevert(
      priceFeed.addOracle(EMPTY_ADDRESS, chainlinkOracle.address),
      'ChainlinkOracle__value_invalidValue()'
    )
  })

  it('addOracle as Owner: Oracle Works, index timestamp is 0, reverts', async () => {
    await setAddresses()
    await mockChainlinkIndex.setUpdateTime(0)
    await assertRevert(
      priceFeed.addOracle(EMPTY_ADDRESS, chainlinkOracle.address),
      'ChainlinkOracle__value_staleFeed()'
    )
  })

  it('addOracle as Owner: Oracle timestamp is 0, index works, reverts', async () => {
    await setAddresses()
    await mockChainlink.setUpdateTime(0)
    await assertRevert(
      priceFeed.addOracle(EMPTY_ADDRESS, chainlinkOracle.address),
      'ChainlinkOracle__value_staleFeed()'
    )
  })

  it('addOracle as Owner: Oracle Works, index timestamp is 2024, reverts', async () => {
    await setAddresses()
    await mockChainlinkIndex.setUpdateTime(1704067200)
    await assertRevert(
      priceFeed.addOracle(EMPTY_ADDRESS, chainlinkOracle.address),
      'ChainlinkOracle__value_invalidTimestamp()'
    )
  })

  it('addOracle as Owner: Oracle timestamp is 2024, index works, reverts', async () => {
    await setAddresses()
    await mockChainlink.setUpdateTime(1704067200)
    await assertRevert(
      priceFeed.addOracle(EMPTY_ADDRESS, chainlinkOracle.address),
      'ChainlinkOracle__value_invalidTimestamp()'
    )
  })

  it('addOracle as Owner: All chainlink responses are good, add new oracle', async () => {
    await mockChainlink.setPrice(dec(1236, 8))
    await mockChainlinkIndex.setPrice(dec(2, 8))

    await setAddressesAndOracle(ZERO_ADDRESS, chainlinkOracle)

    const price = await getFetchPriceWithContractValues(chainlinkOracle)
    assert.equal(price, await getFetchPriceWithDifferentValue(chainlinkOracle, dec(1236, 18), dec(2, 18)))
  })

  it('ChainlinkWorking: Oracle Works, index zero address, return price', async () => {
    await setAddressesAndOracle(ZERO_ADDRESS, chainlinkOracle)

    await mockChainlink.setPrice(dec(1234, 8))

    await priceFeed.fetchPrice(EMPTY_ADDRESS)

    const price = await getFetchPriceWithContractValues(chainlinkOracle)

    assert.equal(price, await getFetchPriceWithDifferentValue(chainlinkOracle, dec(1234, 18), dec(1, 18)))
  })

  it('ChainlinkWorking: Flag returns true, return lastGoodPrice and currentGoodIndex', async () => {
    await setAddressesAndOracle(ZERO_ADDRESS, chainlinkOracle)
    await chainFlagMock.setFlag(true)

    await mockChainlink.setPrice(dec(1234, 8))
    await mockChainlinkIndex.setPrice(dec(2, 9))

    const priceFromFeed = await priceFeed.fetchPrice(EMPTY_ADDRESS)
    const price = await getFetchPriceWithContractValues(chainlinkOracle)

    assert.equal(price, priceFromFeed)

    assert.equal(price, await getFetchPriceWithDifferentValue(chainlinkOracle, dec(1234, 18), dec(20, 18)))
    assert.notEqual(
      price,
      await getFetchPriceWithDifferentValue(chainlinkOracle, DEFAULT_PRICE, DEFAULT_INDEX)
    )
  })

  it('ChainlinkWorking: Oracle works, index broken, still returns the price in this new version', async () => {
    await setAddressesAndOracle(ZERO_ADDRESS, chainlinkOracle)

    await mockChainlink.setPrevPrice(dec(1234, 8))
    await mockChainlink.setPrice(dec(1234, 8))
    await mockChainlinkIndex.setPrice(dec(2, 9))
    await mockChainlinkIndex.setPrevPrice(dec(1, 9))
    await mockChainlinkIndex.setLatestRoundId(0)

    const priceFromFeed = await priceFeed.fetchPrice(EMPTY_ADDRESS)
    const price = await getFetchPriceWithContractValues(chainlinkOracle)

    assert.equal(price, priceFromFeed)

    assert.equal(price, await getFetchPriceWithDifferentValue(chainlinkOracle, dec(1234, 18), dec(20, 18)))
    assert.notEqual(
      price,
      await getFetchPriceWithDifferentValue(chainlinkOracle, dec(1234, 18), DEFAULT_INDEX)
    )
  })

  // Dfranc Tests :: End

  it('C1 Chainlink working: fetchPrice should return the correct price, taking into account a small number of decimal digits on the aggregator', async () => {
    const mockChainlinkI = await MockChainlink.new()

    // Oracle price is 1e9
    await mockChainlinkI.setDecimals(0)
    await mockChainlinkI.setPrevPrice(dec(1, 9))
    await mockChainlinkI.setPrice(dec(1, 9))

    // Set mock price updateTimes in both oracles to very recent
    const now = await th.getLatestBlockTimestamp(web3)
    await mockChainlinkI.setUpdateTime(now)

    // Scale is set on deployment
    const ChainlinkOracleI = await ethers.getContractFactory('ChainlinkOracle')
    const chainlinkOracleParamsI = [mockChainlinkIndex.address, mockChainlinkI.address, _timeout]
    const chainlinkOracleI = await ChainlinkOracleI.deploy(...chainlinkOracleParamsI)

    await th.fastForwardTime(1000, web3.currentProvider)

    await setAddressesAndOracle(ZERO_ADDRESS, chainlinkOracleI)

    const priceFromFeed = await priceFeed.fetchPrice(EMPTY_ADDRESS)
    const price = await priceFeed.getDirectPrice(EMPTY_ADDRESS)

    assert.isTrue(price.eq(priceFromFeed))

    // Check PriceFeed gives 1e9, with 18 digit precision
    assert.isTrue(price.eq(toBN(dec(1, 27))))
  })

  it('C1 Chainlink working: fetchPrice should return the correct price, taking into account a big number of decimal digits on the aggregator', async () => {
    const mockChainlinkI = await MockChainlink.new()

    // Oracle price is 0.0001
    await mockChainlinkI.setDecimals(18)
    await mockChainlinkI.setPrevPrice(dec(1, 14))
    await mockChainlinkI.setPrice(dec(1, 14))

    // Set mock price updateTimes in both oracles to very recent
    const now = await th.getLatestBlockTimestamp(web3)
    await mockChainlinkI.setUpdateTime(now)

    // Scale is set on deployment
    const ChainlinkOracleI = await ethers.getContractFactory('ChainlinkOracle')
    const chainlinkOracleParamsI = [mockChainlinkIndex.address, mockChainlinkI.address, _timeout]
    const chainlinkOracleI = await ChainlinkOracleI.deploy(...chainlinkOracleParamsI)

    await th.fastForwardTime(1000, web3.currentProvider)

    await setAddressesAndOracle(ZERO_ADDRESS, chainlinkOracleI)

    const priceFromFeed = await priceFeed.fetchPrice(EMPTY_ADDRESS)
    const price = await priceFeed.getDirectPrice(EMPTY_ADDRESS)

    assert.isTrue(price.eq(priceFromFeed))

    // Check PriceFeed gives 0.0001 with 18 digit precision
    assert.isTrue(price.eq(toBN(dec(1, 14))))
  })

  // --- Chainlink timeout ---

  it('C1 chainlinkWorking: Chainlink is out of date by <24hrs: is still ok', async () => {
    await setAddressesAndOracle(ZERO_ADDRESS, chainlinkOracle)

    await mockChainlink.setPrevPrice(dec(1234, 8))
    await mockChainlink.setPrice(dec(1234, 8))
    await th.fastForwardTime(timeValues.SECONDS_IN_ONE_DAY - 60, web3.currentProvider) // fast forward 24hrs - 1 min

    const priceFetchTx = await priceFeed.fetchPrice(EMPTY_ADDRESS)

    assert.equal(
      priceFetchTx,
      await getFetchPriceWithDifferentValue(chainlinkOracle, dec(1234, 18), dec(1, 18))
    )
  })

  it('C1 reverts: Chainlink is out of date by >24hrs: reverts', async () => {
    await setAddressesAndOracle(ZERO_ADDRESS, chainlinkOracle)

    await mockChainlink.setPrevPrice(dec(1234, 8))
    await mockChainlink.setPrice(dec(1234, 8))
    await th.fastForwardTime(timeValues.SECONDS_IN_ONE_DAY + 60, web3.currentProvider) // fast forward 24hrs + 1 min

    await assertRevert(priceFeed.fetchPrice(EMPTY_ADDRESS), 'ChainlinkOracle__value_staleFeed()')
  })

  // --- Chainlink invalid timestamp ---

  it('C1 reverts: Invalid timestamp', async () => {
    await setAddressesAndOracle(ZERO_ADDRESS, chainlinkOracle)

    const now = await th.getLatestBlockTimestamp(web3)
    await mockChainlink.setUpdateTime(now + 60) // 1 min in the future

    await mockChainlink.setPrevPrice(dec(1234, 8))
    await mockChainlink.setPrice(dec(1234, 8))

    await assertRevert(priceFeed.fetchPrice(EMPTY_ADDRESS), 'ChainlinkOracle__value_invalidTimestamp()')
  })

  // --- Chainlink invalid value ---

  it('C1 reverts: Invalid value', async () => {
    await setAddressesAndOracle(ZERO_ADDRESS, chainlinkOracle)

    // Set an invalid negative price
    await mockChainlink.setPrevPrice(dec(1234, 8))
    await mockChainlink.setPrice(dec(-1234, 8))

    await assertRevert(priceFeed.fetchPrice(EMPTY_ADDRESS), 'ChainlinkOracle__value_invalidValue()')
  })

  // Dfranc Tests :: Ends
})
