// SPDX-License-Identifier: MIT

pragma solidity ^0.8.14;
import "@openzeppelin/contracts-upgradeable/utils/math/SafeMathUpgradeable.sol";
import "../Dependencies/DfrancMath.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../Interfaces/IBorrowerOperations.sol";
import "../Interfaces/ITroveManager.sol";
import "../Interfaces/ITroveManagerHelpers.sol";
import "../Interfaces/IStabilityPoolManager.sol";
import "../Interfaces/IPriceFeed.sol";
import "../Interfaces/IMONStaking.sol";
import "./BorrowerOperationsScript.sol";
import "./ETHTransferScript.sol";
import "./MONStakingScript.sol";

contract BorrowerWrappersScript is
	BorrowerOperationsScript,
	ETHTransferScript,
	MONStakingScript
{
	using SafeMathUpgradeable for uint256;

	struct Local_var {
		address _asset;
		uint256 _maxFee;
		address _upperHint;
		address _lowerHint;
		uint256 netDCHFAmount;
	}

	string public constant NAME = "BorrowerWrappersScript";

	ITroveManager immutable troveManager;
	ITroveManagerHelpers immutable troveManagerHelpers;
	IStabilityPoolManager immutable stabilityPoolManager;
	IPriceFeed immutable priceFeed;
	IERC20 immutable dchfToken;
	IERC20 immutable monToken;

	constructor(
		address _borrowerOperationsAddress,
		address _troveManagerAddress,
		address _troveManagerHelpersAddress,
		address _MONStakingAddress
	)
		BorrowerOperationsScript(IBorrowerOperations(_borrowerOperationsAddress))
		MONStakingScript(_MONStakingAddress)
	{
		checkContract(_troveManagerAddress);
		ITroveManager troveManagerCached = ITroveManager(_troveManagerAddress);
		ITroveManagerHelpers troveManagerHelpersCached = ITroveManagerHelpers(_troveManagerHelpersAddress);
		troveManager = troveManagerCached;
		troveManagerHelpers = troveManagerHelpersCached;

		IStabilityPoolManager stabilityPoolCached = troveManagerCached.stabilityPoolManager();
		checkContract(address(stabilityPoolCached));
		stabilityPoolManager = stabilityPoolCached;

		IPriceFeed priceFeedCached = troveManagerCached.vestaParams().priceFeed();
		checkContract(address(priceFeedCached));
		priceFeed = priceFeedCached;

		address dchfTokenCached = address(troveManagerCached.dchfToken());
		checkContract(dchfTokenCached);
		dchfToken = IERC20(dchfTokenCached);

		address monTokenCached = address(IMONStaking(_MONStakingAddress).monToken());
		checkContract(monTokenCached);
		monToken = IERC20(monTokenCached);

		IMONStaking monStakingCached = troveManagerCached.monStaking();
		require(
			_MONStakingAddress == address(monStakingCached),
			"BorrowerWrappersScript: Wrong MONStaking address"
		);
	}

	function claimCollateralAndOpenTrove(
		address _asset,
		uint256 _maxFee,
		uint256 _DCHFamount,
		address _upperHint,
		address _lowerHint
	) external payable {
		uint256 balanceBefore = address(this).balance;

		// Claim collateral
		borrowerOperations.claimCollateral(_asset);

		uint256 balanceAfter = address(this).balance;

		// already checked in CollSurplusPool
		assert(balanceAfter > balanceBefore);

		uint256 totalCollateral = balanceAfter.sub(balanceBefore).add(msg.value);

		// Open trove with obtained collateral, plus collateral sent by user
		borrowerOperations.openTrove{ value: _asset == address(0) ? totalCollateral : 0 }(
			_asset,
			totalCollateral,
			_maxFee,
			_DCHFamount,
			_upperHint,
			_lowerHint
		);
	}

	function claimSPRewardsAndRecycle(
		address _asset,
		uint256 _maxFee,
		address _upperHint,
		address _lowerHint
	) external {
		Local_var memory vars = Local_var(_asset, _maxFee, _upperHint, _lowerHint, 0);
		uint256 collBalanceBefore = address(this).balance;
		uint256 MONBalanceBefore = monToken.balanceOf(address(this));

		// Claim rewards
		stabilityPoolManager.getAssetStabilityPool(vars._asset).withdrawFromSP(0);

		uint256 collBalanceAfter = address(this).balance;
		uint256 MONBalanceAfter = monToken.balanceOf(address(this));
		uint256 claimedCollateral = collBalanceAfter.sub(collBalanceBefore);

		// Add claimed ETH to trove, get more DCHF and stake it into the Stability Pool
		if (claimedCollateral > 0) {
			_requireUserHasTrove(vars._asset, address(this));
			vars.netDCHFAmount = _getNetDCHFAmount(vars._asset, claimedCollateral);
			borrowerOperations.adjustTrove{
				value: vars._asset == address(0) ? claimedCollateral : 0
			}(
				vars._asset,
				claimedCollateral,
				vars._maxFee,
				0,
				vars.netDCHFAmount,
				true,
				vars._upperHint,
				vars._lowerHint
			);
			// Provide withdrawn DCHF to Stability Pool
			if (vars.netDCHFAmount > 0) {
				stabilityPoolManager.getAssetStabilityPool(_asset).provideToSP(vars.netDCHFAmount);
			}
		}

		// Stake claimed MON
		uint256 claimedMON = MONBalanceAfter.sub(MONBalanceBefore);
		if (claimedMON > 0) {
			monStaking.stake(claimedMON);
		}
	}

	function claimStakingGainsAndRecycle(
		address _asset,
		uint256 _maxFee,
		address _upperHint,
		address _lowerHint
	) external {
		Local_var memory vars = Local_var(_asset, _maxFee, _upperHint, _lowerHint, 0);

		uint256 collBalanceBefore = address(this).balance;
		uint256 DCHFBalanceBefore = dchfToken.balanceOf(address(this));
		uint256 MONBalanceBefore = monToken.balanceOf(address(this));

		// Claim gains
		monStaking.unstake(0);

		uint256 gainedCollateral = address(this).balance.sub(collBalanceBefore); // stack too deep issues :'(
		uint256 gainedDCHF = dchfToken.balanceOf(address(this)).sub(DCHFBalanceBefore);

		// Top up trove and get more DCHF, keeping ICR constant
		if (gainedCollateral > 0) {
			_requireUserHasTrove(vars._asset, address(this));
			vars.netDCHFAmount = _getNetDCHFAmount(vars._asset, gainedCollateral);
			borrowerOperations.adjustTrove{
				value: vars._asset == address(0) ? gainedCollateral : 0
			}(
				vars._asset,
				gainedCollateral,
				vars._maxFee,
				0,
				vars.netDCHFAmount,
				true,
				vars._upperHint,
				vars._lowerHint
			);
		}

		uint256 totalDCHF = gainedDCHF.add(vars.netDCHFAmount);
		if (totalDCHF > 0) {
			stabilityPoolManager.getAssetStabilityPool(_asset).provideToSP(totalDCHF);

			// Providing to Stability Pool also triggers MON claim, so stake it if any
			uint256 MONBalanceAfter = monToken.balanceOf(address(this));
			uint256 claimedMON = MONBalanceAfter.sub(MONBalanceBefore);
			if (claimedMON > 0) {
				monStaking.stake(claimedMON);
			}
		}
	}

	function _getNetDCHFAmount(address _asset, uint256 _collateral) internal returns (uint256) {
		uint256 price = priceFeed.fetchPrice(_asset);
		uint256 ICR = troveManagerHelpers.getCurrentICR(_asset, address(this), price);

		uint256 DCHFAmount = _collateral.mul(price).div(ICR);
		uint256 borrowingRate = troveManagerHelpers.getBorrowingRateWithDecay(_asset);
		uint256 netDebt = DCHFAmount.mul(DfrancMath.DECIMAL_PRECISION).div(
			DfrancMath.DECIMAL_PRECISION.add(borrowingRate)
		);

		return netDebt;
	}

	function _requireUserHasTrove(address _asset, address _depositor) internal view {
		require(
			troveManagerHelpers.getTroveStatus(_asset, _depositor) == 1,
			"BorrowerWrappersScript: caller must have an active trove"
		);
	}
}
