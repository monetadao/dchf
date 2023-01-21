// SPDX-License-Identifier: MIT

pragma solidity ^0.8.14;
import "../TroveManager.sol";

contract TroveManagerTester is TroveManager {
	function computeICR(
		uint256 _coll,
		uint256 _debt,
		uint256 _price
	) external pure returns (uint256) {
		return DfrancMath._computeCR(_coll, _debt, _price);
	}

	function getCollGasCompensation(address _asset, uint256 _coll)
		external
		view
		returns (uint256)
	{
		return _getCollGasCompensation(_asset, _coll);
	}

	function getDCHFGasCompensation(address _asset) external view returns (uint256) {
		return dfrancParams.DCHF_GAS_COMPENSATION(_asset);
	}

	function getCompositeDebt(address _asset, uint256 _debt) external view returns (uint256) {
		return _getCompositeDebt(_asset, _debt);
	}

	function getActualDebtFromComposite(address _asset, uint256 _debtVal)
		external
		view
		returns (uint256)
	{
		return _getNetDebt(_asset, _debtVal);
	}
}
