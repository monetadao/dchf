const deploymentHelper = require("../../utils/deploymentHelpers.js")
const testHelpers = require("../../utils/testHelpers.js")
const TroveManagerTester = artifacts.require("./TroveManagerTester.sol")
const th = testHelpers.TestHelper
const dec = th.dec
const toBN = th.toBN

contract('DfrancParameters', async accounts => {
  const ZERO_ADDRESS = th.ZERO_ADDRESS
  const assertRevert = th.assertRevert
  const DECIMAL_PRECISION = toBN(dec(1, 18))
  const [owner, user, A, C, B, multisig] = accounts;

  let contracts
  let priceFeed
  let borrowerOperations
  let dfrancParameters
  let erc20

  let MCR
  let CCR
  let GAS_COMPENSATION
  let MIN_NET_DEBT
  let PERCENT_DIVISOR
  let BORROWING_FEE_FLOOR
  let MAX_BORROWING_FEE
  let REDEMPTION_FEE_FLOOR

  const MCR_SAFETY_MAX = toBN(dec(1000, 18)).div(toBN(100));
  const MCR_SAFETY_MIN = toBN(dec(101, 18)).div(toBN(100));

  const CCR_SAFETY_MAX = toBN(dec(1000, 18)).div(toBN(100));
  const CCR_SAFETY_MIN = toBN(dec(101, 18)).div(toBN(100));

  const PERCENT_DIVISOR_SAFETY_MAX = toBN(200);
  const PERCENT_DIVISOR_SAFETY_MIN = toBN(2);

  const BORROWING_FEE_FLOOR_SAFETY_MAX = toBN(1000) //10%
  const BORROWING_FEE_FLOOR_SAFETY_MIN = toBN(0)

  const MAX_BORROWING_FEE_SAFETY_MAX = toBN(1000) //10%
  const MAX_BORROWING_FEE_SAFETY_MIN = toBN(0);

  const MON_GAS_COMPENSATION_SAFETY_MAX = toBN(dec(400, 18));
  const MON_GAS_COMPENSATION_SAFETY_MIN = toBN(dec(1, 18));

  const MIN_NET_DEBT_SAFETY_MAX = toBN(dec(1800, 18));
  const MIN_NET_DEBT_SAFETY_MIN = toBN(0);

  const REDEMPTION_FEE_FLOOR_SAFETY_MAX = toBN(1000);
  const REDEMPTION_FEE_FLOOR_SAFETY_MIN = toBN(10);


  const openTrove = async (params) => th.openTrove(contracts, params)

  function applyDecimalPrecision(value) {
    return DECIMAL_PRECISION.div(toBN(10000)).mul(toBN(value.toString()))
  }


  describe("Dfranc Parameters", async () => {
    beforeEach(async () => {
      contracts = await deploymentHelper.deployLiquityCore()
      contracts.troveManager = await TroveManagerTester.new()
      const MONContracts = await deploymentHelper.deployMONContractsHardhat(accounts[0])

      priceFeed = contracts.priceFeedTestnet
      troveManager = contracts.troveManager
      activePool = contracts.activePool
      defaultPool = contracts.defaultPool
      borrowerOperations = contracts.borrowerOperations
      dfrancParameters = contracts.dfrancParameters
      erc20 = contracts.erc20

      MCR = await dfrancParameters.MCR_DEFAULT()
      CCR = await dfrancParameters.CCR_DEFAULT()
      GAS_COMPENSATION = await dfrancParameters.DCHF_GAS_COMPENSATION_DEFAULT()
      MIN_NET_DEBT = await dfrancParameters.MIN_NET_DEBT_DEFAULT()
      PERCENT_DIVISOR = await dfrancParameters.PERCENT_DIVISOR_DEFAULT()
      BORROWING_FEE_FLOOR = await dfrancParameters.BORROWING_FEE_FLOOR_DEFAULT()
      MAX_BORROWING_FEE = await dfrancParameters.MAX_BORROWING_FEE_DEFAULT()
      REDEMPTION_FEE_FLOOR = await dfrancParameters.REDEMPTION_FEE_FLOOR_DEFAULT()

      let index = 0;
      for (const acc of accounts) {
        await erc20.mint(acc, await web3.eth.getBalance(acc))
        index++;

        if (index >= 20)
          break;
      }

      await deploymentHelper.connectCoreContracts(contracts, MONContracts)
      await deploymentHelper.connectMONContractsToCore(MONContracts, contracts, false, false)
    })

    it("Formula Checks: Call every function with default value, Should match default values", async () => {
      await dfrancParameters.setMCR(ZERO_ADDRESS, "1100000000000000000")
      await dfrancParameters.setCCR(ZERO_ADDRESS, "1500000000000000000")
      await dfrancParameters.setPercentDivisor(ZERO_ADDRESS, 100)
      await dfrancParameters.setBorrowingFeeFloor(ZERO_ADDRESS, 50)
      await dfrancParameters.setMaxBorrowingFee(ZERO_ADDRESS, 500)
      await dfrancParameters.setDCHFGasCompensation(ZERO_ADDRESS, dec(30, 18))
      await dfrancParameters.setMinNetDebt(ZERO_ADDRESS, dec(300, 18))
      await dfrancParameters.setRedemptionFeeFloor(ZERO_ADDRESS, 50)

      assert.equal((await dfrancParameters.MCR(ZERO_ADDRESS)).toString(), MCR);
      assert.equal((await dfrancParameters.CCR(ZERO_ADDRESS)).toString(), CCR);
      assert.equal((await dfrancParameters.PERCENT_DIVISOR(ZERO_ADDRESS)).toString(), PERCENT_DIVISOR);
      assert.equal((await dfrancParameters.BORROWING_FEE_FLOOR(ZERO_ADDRESS)).toString(), BORROWING_FEE_FLOOR);
      assert.equal((await dfrancParameters.MAX_BORROWING_FEE(ZERO_ADDRESS)).toString(), MAX_BORROWING_FEE);
      assert.equal((await dfrancParameters.DCHF_GAS_COMPENSATION(ZERO_ADDRESS)).toString(), GAS_COMPENSATION);
      assert.equal((await dfrancParameters.MIN_NET_DEBT(ZERO_ADDRESS)).toString(), MIN_NET_DEBT);
      assert.equal((await dfrancParameters.REDEMPTION_FEE_FLOOR(ZERO_ADDRESS)).toString(), REDEMPTION_FEE_FLOOR);
    })

    it("Try to edit Parameters has User, Revert Transactions", async () => {
      await assertRevert(dfrancParameters.setPriceFeed(priceFeed.address, { from: user }));
      await assertRevert(dfrancParameters.setAsDefault(ZERO_ADDRESS, { from: user }));
      await assertRevert(dfrancParameters.setCollateralParameters(
        ZERO_ADDRESS,
        MCR,
        CCR,
        GAS_COMPENSATION,
        MIN_NET_DEBT,
        PERCENT_DIVISOR,
        BORROWING_FEE_FLOOR,
        MAX_BORROWING_FEE,
        REDEMPTION_FEE_FLOOR,
        { from: user }
      ))

      await assertRevert(dfrancParameters.setMCR(ZERO_ADDRESS, MCR, { from: user }))
      await assertRevert(dfrancParameters.setCCR(ZERO_ADDRESS, CCR, { from: user }))
      await assertRevert(dfrancParameters.setDCHFGasCompensation(ZERO_ADDRESS, GAS_COMPENSATION, { from: user }))
      await assertRevert(dfrancParameters.setMinNetDebt(ZERO_ADDRESS, MIN_NET_DEBT, { from: user }))
      await assertRevert(dfrancParameters.setPercentDivisor(ZERO_ADDRESS, PERCENT_DIVISOR, { from: user }))
      await assertRevert(dfrancParameters.setBorrowingFeeFloor(ZERO_ADDRESS, BORROWING_FEE_FLOOR, { from: user }))
      await assertRevert(dfrancParameters.setMaxBorrowingFee(ZERO_ADDRESS, MAX_BORROWING_FEE, { from: user }))
      await assertRevert(dfrancParameters.setRedemptionFeeFloor(ZERO_ADDRESS, REDEMPTION_FEE_FLOOR, { from: user }))
    })

    it("sanitizeParameters: User call sanitizeParameters on Non-Configured Collateral - Set Default Values", async () => {
      await dfrancParameters.sanitizeParameters(ZERO_ADDRESS, { from: user })

      assert.equal(MCR.toString(), (await dfrancParameters.MCR(ZERO_ADDRESS)))
      assert.equal(CCR.toString(), (await dfrancParameters.CCR(ZERO_ADDRESS)))
      assert.equal(GAS_COMPENSATION.toString(), (await dfrancParameters.DCHF_GAS_COMPENSATION(ZERO_ADDRESS)))
      assert.equal(MIN_NET_DEBT.toString(), (await dfrancParameters.MIN_NET_DEBT(ZERO_ADDRESS)))
      assert.equal(PERCENT_DIVISOR.toString(), (await dfrancParameters.PERCENT_DIVISOR(ZERO_ADDRESS)))
      assert.equal(BORROWING_FEE_FLOOR.toString(), (await dfrancParameters.BORROWING_FEE_FLOOR(ZERO_ADDRESS)))
      assert.equal(MAX_BORROWING_FEE.toString(), (await dfrancParameters.MAX_BORROWING_FEE(ZERO_ADDRESS)))
      assert.equal(REDEMPTION_FEE_FLOOR.toString(), (await dfrancParameters.REDEMPTION_FEE_FLOOR(ZERO_ADDRESS)))
    })

    it("sanitizeParameters: User call sanitizeParamaters on Configured Collateral - Ignore it", async () => {
      const newMCR = MCR_SAFETY_MAX
      const newCCR = CCR_SAFETY_MIN
      const newGasComp = MON_GAS_COMPENSATION_SAFETY_MAX
      const newMinNetDebt = MIN_NET_DEBT_SAFETY_MIN
      const newPercentDivisor = PERCENT_DIVISOR_SAFETY_MAX
      const newBorrowingFeeFloor = BORROWING_FEE_FLOOR_SAFETY_MAX
      const newMaxBorrowingFee = MAX_BORROWING_FEE_SAFETY_MIN
      const newRedemptionFeeFloor = REDEMPTION_FEE_FLOOR_SAFETY_MAX

      const expectedBorrowingFeeFloor = applyDecimalPrecision(newBorrowingFeeFloor);
      const expectedMaxBorrowingFee = applyDecimalPrecision(newMaxBorrowingFee);
      const expectedRedemptionFeeFloor = applyDecimalPrecision(newRedemptionFeeFloor);

      await dfrancParameters.setCollateralParameters(
        ZERO_ADDRESS,
        newMCR,
        newCCR,
        newGasComp,
        newMinNetDebt,
        newPercentDivisor,
        newBorrowingFeeFloor,
        newMaxBorrowingFee,
        newRedemptionFeeFloor,
        { from: owner }
      )

      await dfrancParameters.sanitizeParameters(ZERO_ADDRESS, { from: user })

      assert.equal(newMCR.toString(), (await dfrancParameters.MCR(ZERO_ADDRESS)));
      assert.equal(newCCR.toString(), (await dfrancParameters.CCR(ZERO_ADDRESS)));
      assert.equal(newGasComp.toString(), (await dfrancParameters.DCHF_GAS_COMPENSATION(ZERO_ADDRESS)));
      assert.equal(newMinNetDebt.toString(), (await dfrancParameters.MIN_NET_DEBT(ZERO_ADDRESS)));
      assert.equal(newPercentDivisor.toString(), (await dfrancParameters.PERCENT_DIVISOR(ZERO_ADDRESS)));
      assert.equal(expectedBorrowingFeeFloor.toString(), (await dfrancParameters.BORROWING_FEE_FLOOR(ZERO_ADDRESS)));
      assert.equal(expectedMaxBorrowingFee.toString(), (await dfrancParameters.MAX_BORROWING_FEE(ZERO_ADDRESS)));
      assert.equal(expectedRedemptionFeeFloor.toString(), (await dfrancParameters.REDEMPTION_FEE_FLOOR(ZERO_ADDRESS)));
    })

    it("setPriceFeed: Owner change parameter - Failing SafeCheck", async () => {
      await assertRevert(dfrancParameters.setPriceFeed(ZERO_ADDRESS))
    })

    it("setPriceFeed: Owner change parameter - Valid Check", async () => {
      await dfrancParameters.setPriceFeed(priceFeed.address)
    })

    it("setMCR: Owner change parameter - Failing SafeCheck", async () => {
      await dfrancParameters.sanitizeParameters(ZERO_ADDRESS)

      await assertRevert(dfrancParameters.setMCR(ZERO_ADDRESS, MCR_SAFETY_MIN.sub(toBN(1))))
      await assertRevert(dfrancParameters.setMCR(ZERO_ADDRESS, MCR_SAFETY_MAX.add(toBN(1))))
    })

    it("setMCR: Owner change parameter - Valid SafeCheck", async () => {
      await dfrancParameters.sanitizeParameters(ZERO_ADDRESS)

      await dfrancParameters.setMCR(ZERO_ADDRESS, MCR_SAFETY_MIN);
      assert.equal(MCR_SAFETY_MIN.toString(), (await dfrancParameters.MCR(ZERO_ADDRESS)));

      await dfrancParameters.setMCR(ZERO_ADDRESS, MCR_SAFETY_MAX);
      assert.equal(MCR_SAFETY_MAX.toString(), (await dfrancParameters.MCR(ZERO_ADDRESS)));
    })

    it("setCCR: Owner change parameter - Failing SafeCheck", async () => {
      await dfrancParameters.sanitizeParameters(ZERO_ADDRESS)

      await assertRevert(dfrancParameters.setCCR(ZERO_ADDRESS, CCR_SAFETY_MIN.sub(toBN(1))))
      await assertRevert(dfrancParameters.setCCR(ZERO_ADDRESS, CCR_SAFETY_MAX.add(toBN(1))))
    })

    it("setCCR: Owner change parameter - Valid SafeCheck", async () => {
      await dfrancParameters.sanitizeParameters(ZERO_ADDRESS)

      await dfrancParameters.setCCR(ZERO_ADDRESS, CCR_SAFETY_MIN);
      assert.equal(CCR_SAFETY_MIN.toString(), (await dfrancParameters.CCR(ZERO_ADDRESS)));

      await dfrancParameters.setCCR(ZERO_ADDRESS, CCR_SAFETY_MAX);
      assert.equal(CCR_SAFETY_MAX.toString(), (await dfrancParameters.CCR(ZERO_ADDRESS)));
    })

    it("setDCHFGasCompensation: Owner change parameter - Failing SafeCheck", async () => {
      await dfrancParameters.sanitizeParameters(ZERO_ADDRESS)

      await assertRevert(dfrancParameters.setDCHFGasCompensation(ZERO_ADDRESS, MON_GAS_COMPENSATION_SAFETY_MIN.sub(toBN(1))))
      await assertRevert(dfrancParameters.setDCHFGasCompensation(ZERO_ADDRESS, MON_GAS_COMPENSATION_SAFETY_MAX.add(toBN(1))))
    })

    it("setDCHFGasCompensation: Owner change parameter - Valid SafeCheck", async () => {
      await dfrancParameters.sanitizeParameters(ZERO_ADDRESS)

      await dfrancParameters.setDCHFGasCompensation(ZERO_ADDRESS, MON_GAS_COMPENSATION_SAFETY_MIN);
      assert.equal(MON_GAS_COMPENSATION_SAFETY_MIN.toString(), (await dfrancParameters.DCHF_GAS_COMPENSATION(ZERO_ADDRESS)));

      await dfrancParameters.setDCHFGasCompensation(ZERO_ADDRESS, MON_GAS_COMPENSATION_SAFETY_MAX);
      assert.equal(MON_GAS_COMPENSATION_SAFETY_MAX.toString(), (await dfrancParameters.DCHF_GAS_COMPENSATION(ZERO_ADDRESS)));
    })

    it("setMinNetDebt: Owner change parameter - Failing SafeCheck", async () => {
      await dfrancParameters.sanitizeParameters(ZERO_ADDRESS)
      await assertRevert(dfrancParameters.setMinNetDebt(ZERO_ADDRESS, MIN_NET_DEBT_SAFETY_MAX.add(toBN(1))))
    })

    it("setMinNetDebt: Owner change parameter - Valid SafeCheck", async () => {
      await dfrancParameters.sanitizeParameters(ZERO_ADDRESS)

      await dfrancParameters.setMinNetDebt(ZERO_ADDRESS, MIN_NET_DEBT_SAFETY_MIN);
      assert.equal(MIN_NET_DEBT_SAFETY_MIN.toString(), (await dfrancParameters.MIN_NET_DEBT(ZERO_ADDRESS)));

      await dfrancParameters.setMinNetDebt(ZERO_ADDRESS, MIN_NET_DEBT_SAFETY_MAX);
      assert.equal(MIN_NET_DEBT_SAFETY_MAX.toString(), (await dfrancParameters.MIN_NET_DEBT(ZERO_ADDRESS)));
    })

    it("setPercentDivisor: Owner change parameter - Failing SafeCheck", async () => {
      await dfrancParameters.sanitizeParameters(ZERO_ADDRESS)

      await assertRevert(dfrancParameters.setPercentDivisor(ZERO_ADDRESS, PERCENT_DIVISOR_SAFETY_MIN.sub(toBN(1))))
      await assertRevert(dfrancParameters.setPercentDivisor(ZERO_ADDRESS, PERCENT_DIVISOR_SAFETY_MAX.add(toBN(1))))
    })

    it("setPercentDivisor: Owner change parameter - Valid SafeCheck", async () => {
      await dfrancParameters.setPercentDivisor(ZERO_ADDRESS, PERCENT_DIVISOR_SAFETY_MIN);
      assert.equal(PERCENT_DIVISOR_SAFETY_MIN.toString(), (await dfrancParameters.PERCENT_DIVISOR(ZERO_ADDRESS)));

      await dfrancParameters.setPercentDivisor(ZERO_ADDRESS, PERCENT_DIVISOR_SAFETY_MAX);
      assert.equal(PERCENT_DIVISOR_SAFETY_MAX.toString(), (await dfrancParameters.PERCENT_DIVISOR(ZERO_ADDRESS)));
    })

    it("setBorrowingFeeFloor: Owner change parameter - Failing SafeCheck", async () => {
      await dfrancParameters.sanitizeParameters(ZERO_ADDRESS)

      await assertRevert(dfrancParameters.setBorrowingFeeFloor(ZERO_ADDRESS, BORROWING_FEE_FLOOR_SAFETY_MAX.add(toBN(1))))
    })

    it("setBorrowingFeeFloor: Owner change parameter - Valid SafeCheck", async () => {
      const expectedMin = applyDecimalPrecision(BORROWING_FEE_FLOOR_SAFETY_MIN);
      const expectedMax = applyDecimalPrecision(BORROWING_FEE_FLOOR_SAFETY_MAX);

      await dfrancParameters.sanitizeParameters(ZERO_ADDRESS)

      await dfrancParameters.setBorrowingFeeFloor(ZERO_ADDRESS, BORROWING_FEE_FLOOR_SAFETY_MIN);
      assert.equal(expectedMin.toString(), (await dfrancParameters.BORROWING_FEE_FLOOR(ZERO_ADDRESS)));

      await dfrancParameters.setMaxBorrowingFee(ZERO_ADDRESS, MAX_BORROWING_FEE_SAFETY_MAX);
      await dfrancParameters.setBorrowingFeeFloor(ZERO_ADDRESS, BORROWING_FEE_FLOOR_SAFETY_MAX);
      assert.equal(expectedMax.toString(), (await dfrancParameters.BORROWING_FEE_FLOOR(ZERO_ADDRESS)));
    })

    it("setMaxBorrowingFee: Owner change parameter - Failing SafeCheck", async () => {
      await dfrancParameters.sanitizeParameters(ZERO_ADDRESS)

      await assertRevert(dfrancParameters.setMaxBorrowingFee(ZERO_ADDRESS, MAX_BORROWING_FEE_SAFETY_MAX.add(toBN(1))))
    })

    it("setMaxBorrowingFee: Owner change parameter - Valid SafeCheck", async () => {
      const expectedMin = applyDecimalPrecision(MAX_BORROWING_FEE_SAFETY_MIN);
      const expectedMax = applyDecimalPrecision(MAX_BORROWING_FEE_SAFETY_MAX);

      await dfrancParameters.sanitizeParameters(ZERO_ADDRESS)

      await dfrancParameters.setMaxBorrowingFee(ZERO_ADDRESS, MAX_BORROWING_FEE_SAFETY_MIN);
      assert.equal(expectedMin.toString(), (await dfrancParameters.MAX_BORROWING_FEE(ZERO_ADDRESS)));

      await dfrancParameters.setMaxBorrowingFee(ZERO_ADDRESS, MAX_BORROWING_FEE_SAFETY_MAX);
      assert.equal(expectedMax.toString(), (await dfrancParameters.MAX_BORROWING_FEE(ZERO_ADDRESS)));
    })

    it("setRedemptionFeeFloor: Owner change parameter - Failing SafeCheck", async () => {
      await dfrancParameters.sanitizeParameters(ZERO_ADDRESS)

      await assertRevert(dfrancParameters.setRedemptionFeeFloor(ZERO_ADDRESS, REDEMPTION_FEE_FLOOR_SAFETY_MIN.sub(toBN(1))))
      await assertRevert(dfrancParameters.setRedemptionFeeFloor(ZERO_ADDRESS, REDEMPTION_FEE_FLOOR_SAFETY_MAX.add(toBN(1))))
    })

    it("setRedemptionFeeFloor: Owner change parameter - Valid SafeCheck", async () => {
      const expectedMin = applyDecimalPrecision(REDEMPTION_FEE_FLOOR_SAFETY_MIN);
      const expectedMax = applyDecimalPrecision(REDEMPTION_FEE_FLOOR_SAFETY_MAX);

      await dfrancParameters.sanitizeParameters(ZERO_ADDRESS)

      await dfrancParameters.setRedemptionFeeFloor(ZERO_ADDRESS, REDEMPTION_FEE_FLOOR_SAFETY_MIN);
      assert.equal(expectedMin.toString(), (await dfrancParameters.REDEMPTION_FEE_FLOOR(ZERO_ADDRESS)));

      await dfrancParameters.setRedemptionFeeFloor(ZERO_ADDRESS, REDEMPTION_FEE_FLOOR_SAFETY_MAX);
      assert.equal(expectedMax.toString(), (await dfrancParameters.REDEMPTION_FEE_FLOOR(ZERO_ADDRESS)));
    })

    it("setCollateralParameters: Owner change parameter - Failing SafeCheck", async () => {
      await assertRevert(
        dfrancParameters.setCollateralParameters(
          ZERO_ADDRESS,
          MCR_SAFETY_MAX.add(toBN(1)),
          CCR,
          GAS_COMPENSATION,
          MIN_NET_DEBT,
          PERCENT_DIVISOR,
          BORROWING_FEE_FLOOR,
          MAX_BORROWING_FEE,
          REDEMPTION_FEE_FLOOR
        )
      )

      await assertRevert(
        dfrancParameters.setCollateralParameters(
          ZERO_ADDRESS,
          MCR,
          CCR_SAFETY_MAX.add(toBN(1)),
          GAS_COMPENSATION,
          MIN_NET_DEBT,
          PERCENT_DIVISOR,
          BORROWING_FEE_FLOOR,
          MAX_BORROWING_FEE,
          REDEMPTION_FEE_FLOOR
        )
      )

      await assertRevert(
        dfrancParameters.setCollateralParameters(
          ZERO_ADDRESS,
          MCR,
          CCR,
          MON_GAS_COMPENSATION_SAFETY_MAX.add(toBN(1)),
          MIN_NET_DEBT,
          PERCENT_DIVISOR,
          BORROWING_FEE_FLOOR,
          MAX_BORROWING_FEE,
          REDEMPTION_FEE_FLOOR
        )
      )

      await assertRevert(
        dfrancParameters.setCollateralParameters(
          ZERO_ADDRESS,
          MCR,
          CCR,
          GAS_COMPENSATION,
          MIN_NET_DEBT_SAFETY_MAX.add(toBN(1)),
          PERCENT_DIVISOR,
          BORROWING_FEE_FLOOR,
          MAX_BORROWING_FEE,
          REDEMPTION_FEE_FLOOR
        )
      )

      await assertRevert(
        dfrancParameters.setCollateralParameters(
          ZERO_ADDRESS,
          MCR,
          CCR,
          GAS_COMPENSATION,
          MIN_NET_DEBT,
          PERCENT_DIVISOR_SAFETY_MAX.add(toBN(1)),
          BORROWING_FEE_FLOOR,
          MAX_BORROWING_FEE,
          REDEMPTION_FEE_FLOOR
        )
      )

      await assertRevert(
        dfrancParameters.setCollateralParameters(
          ZERO_ADDRESS,
          MCR,
          CCR,
          GAS_COMPENSATION,
          MIN_NET_DEBT,
          PERCENT_DIVISOR,
          BORROWING_FEE_FLOOR_SAFETY_MAX.add(toBN(1)),
          MAX_BORROWING_FEE,
          REDEMPTION_FEE_FLOOR
        )
      )

      await assertRevert(
        dfrancParameters.setCollateralParameters(
          ZERO_ADDRESS,
          MCR,
          CCR,
          GAS_COMPENSATION,
          MIN_NET_DEBT,
          PERCENT_DIVISOR,
          BORROWING_FEE_FLOOR,
          MAX_BORROWING_FEE_SAFETY_MAX.add(toBN(1)),
          REDEMPTION_FEE_FLOOR
        )
      )

      await assertRevert(
        dfrancParameters.setCollateralParameters(
          ZERO_ADDRESS,
          MCR,
          CCR,
          GAS_COMPENSATION,
          MIN_NET_DEBT,
          PERCENT_DIVISOR,
          BORROWING_FEE_FLOOR,
          MAX_BORROWING_FEE,
          REDEMPTION_FEE_FLOOR_SAFETY_MAX.add(toBN(1)),
        )
      )
    })

    it("setCollateralParameters: Owner change parameter - Valid SafeCheck Then Reset", async () => {
      const newMCR = MCR_SAFETY_MAX
      const newCCR = CCR_SAFETY_MIN
      const newGasComp = MON_GAS_COMPENSATION_SAFETY_MAX
      const newMinNetDebt = MIN_NET_DEBT_SAFETY_MAX
      const newPercentDivisor = PERCENT_DIVISOR_SAFETY_MIN
      const newBorrowingFeeFloor = BORROWING_FEE_FLOOR_SAFETY_MAX
      const newMaxBorrowingFee = MAX_BORROWING_FEE_SAFETY_MAX
      const newRedemptionFeeFloor = REDEMPTION_FEE_FLOOR_SAFETY_MIN

      const expectedBorrowingFeeFloor = applyDecimalPrecision(newBorrowingFeeFloor);
      const expectedMaxBorrowingFee = applyDecimalPrecision(newMaxBorrowingFee);
      const expectedRedemptionFeeFloor = applyDecimalPrecision(newRedemptionFeeFloor);

      await dfrancParameters.setCollateralParameters(
        ZERO_ADDRESS,
        newMCR,
        newCCR,
        newGasComp,
        newMinNetDebt,
        newPercentDivisor,
        newBorrowingFeeFloor,
        newMaxBorrowingFee,
        newRedemptionFeeFloor,
        { from: owner }
      )

      assert.equal(newMCR.toString(), (await dfrancParameters.MCR(ZERO_ADDRESS)));
      assert.equal(newCCR.toString(), (await dfrancParameters.CCR(ZERO_ADDRESS)));
      assert.equal(newGasComp.toString(), (await dfrancParameters.DCHF_GAS_COMPENSATION(ZERO_ADDRESS)));
      assert.equal(newMinNetDebt.toString(), (await dfrancParameters.MIN_NET_DEBT(ZERO_ADDRESS)));
      assert.equal(newPercentDivisor.toString(), (await dfrancParameters.PERCENT_DIVISOR(ZERO_ADDRESS)));
      assert.equal(expectedBorrowingFeeFloor.toString(), (await dfrancParameters.BORROWING_FEE_FLOOR(ZERO_ADDRESS)));
      assert.equal(expectedMaxBorrowingFee.toString(), (await dfrancParameters.MAX_BORROWING_FEE(ZERO_ADDRESS)));
      assert.equal(expectedRedemptionFeeFloor.toString(), (await dfrancParameters.REDEMPTION_FEE_FLOOR(ZERO_ADDRESS)));

      await dfrancParameters.setAsDefault(ZERO_ADDRESS);

      assert.equal(MCR.toString(), (await dfrancParameters.MCR(ZERO_ADDRESS)));
      assert.equal(CCR.toString(), (await dfrancParameters.CCR(ZERO_ADDRESS)));
      assert.equal(GAS_COMPENSATION.toString(), (await dfrancParameters.DCHF_GAS_COMPENSATION(ZERO_ADDRESS)));
      assert.equal(MIN_NET_DEBT.toString(), (await dfrancParameters.MIN_NET_DEBT(ZERO_ADDRESS)));
      assert.equal(PERCENT_DIVISOR.toString(), (await dfrancParameters.PERCENT_DIVISOR(ZERO_ADDRESS)));
      assert.equal(BORROWING_FEE_FLOOR.toString(), (await dfrancParameters.BORROWING_FEE_FLOOR(ZERO_ADDRESS)));
      assert.equal(MAX_BORROWING_FEE.toString(), (await dfrancParameters.MAX_BORROWING_FEE(ZERO_ADDRESS)));
      assert.equal(REDEMPTION_FEE_FLOOR.toString(), (await dfrancParameters.REDEMPTION_FEE_FLOOR(ZERO_ADDRESS)));
    })

    it("openTrove(): Borrowing at zero base rate charges minimum fee with different borrowingFeeFloor", async () => {
      await dfrancParameters.sanitizeParameters(ZERO_ADDRESS)
      await dfrancParameters.sanitizeParameters(erc20.address)

      await dfrancParameters.setBorrowingFeeFloor(ZERO_ADDRESS, BORROWING_FEE_FLOOR_SAFETY_MIN)
      await dfrancParameters.setMaxBorrowingFee(erc20.address, MAX_BORROWING_FEE_SAFETY_MAX);
      await dfrancParameters.setBorrowingFeeFloor(erc20.address, BORROWING_FEE_FLOOR_SAFETY_MAX);

      assert.equal(applyDecimalPrecision(BORROWING_FEE_FLOOR_SAFETY_MIN).toString(), (await dfrancParameters.BORROWING_FEE_FLOOR(ZERO_ADDRESS)));
      assert.equal(applyDecimalPrecision(BORROWING_FEE_FLOOR_SAFETY_MAX).toString(), (await dfrancParameters.BORROWING_FEE_FLOOR(erc20.address)));

      await openTrove({ extraDCHFAmount: toBN(dec(5000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: A } })
      await openTrove({ extraDCHFAmount: toBN(dec(5000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: B } })

      await openTrove({ asset: erc20.address, extraDCHFAmount: toBN(dec(5000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: A } })
      await openTrove({ asset: erc20.address, extraDCHFAmount: toBN(dec(5000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: B } })

      const USDVRequest = toBN(dec(10000, 18))
      const txC = await borrowerOperations.openTrove(ZERO_ADDRESS, 0, th._100pct, USDVRequest, ZERO_ADDRESS, ZERO_ADDRESS, { value: dec(100, 'ether'), from: C })
      const txC_Asset = await borrowerOperations.openTrove(erc20.address, dec(100, 'ether'), th._100pct, USDVRequest, ZERO_ADDRESS, ZERO_ADDRESS, { from: C })
      const _DCHFFee = toBN(th.getEventArgByName(txC, "DCHFBorrowingFeePaid", "_DCHFFee"))
      const _USDVFee_Asset = toBN(th.getEventArgByName(txC_Asset, "DCHFBorrowingFeePaid", "_DCHFFee"))

      const expectedFee = (await dfrancParameters.BORROWING_FEE_FLOOR(ZERO_ADDRESS)).mul(toBN(USDVRequest)).div(toBN(dec(1, 18)))
      const expectedFee_Asset = (await dfrancParameters.BORROWING_FEE_FLOOR(erc20.address)).mul(toBN(USDVRequest)).div(toBN(dec(1, 18)))
      assert.isTrue(_DCHFFee.eq(expectedFee))
      assert.isTrue(_USDVFee_Asset.eq(expectedFee_Asset))
    })
  })
})
